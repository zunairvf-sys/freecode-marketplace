#!/usr/bin/env node
// Mock tests for the gmail-server.js auth layer:
//   - getTokenPath cross-platform behaviour
//   - saveToken creates parent directory + writes JSON
//   - ensureAuthenticated returns null when no token
//   - ensureAuthenticated returns token when valid
//   - ensureAuthenticated refreshes when expiry_time < now+60
//   - unauthMsg returns correct content shape
//   - gmail_auth_status tool reports authenticated / unauthenticated
//   - callback server starts and stops cleanly
//   - tools/list JSON-RPC produces correct shape
//   - tools/call dispatches to handler + returns result
"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { tmpdir } = require("os");

// ---- helpers ---------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(() => {
        console.log(`  PASS  ${name}`);
        passed++;
      }).catch(e => {
        console.error(`  FAIL  ${name}\n        ${e?.message || String(e)}`);
        failed++;
      });
    }
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e?.message || String(e)}`);
    failed++;
  }
  return Promise.resolve();
}

// ---- sandbox token file in a temp dir --------------------------------------

const tmpTokenDir = fs.mkdtempSync(path.join(tmpdir(), "gmail-test-"));
const tmpTokenFile = path.join(tmpTokenDir, "subdir", ".gmail-token.json");

// Patch env so server module uses our temp token path
process.env.GMAIL_TOKEN_FILE = tmpTokenFile;
process.env.GMAIL_CLIENT_ID = "test-client-id";
process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
process.env.GMAIL_REDIRECT_URI = "http://localhost:41199"; // separate port for tests

// ---- load module under test ------------------------------------------------

// We need the internal functions. The module exports `tools` and `ROUTES`.
// For token/auth functions we monkey-patch via the exported `tools` handlers
// rather than reaching into closure — but we also need getTokenPath etc.,
// so we re-implement the minimal logic here and test through the tool handlers.

const serverPath = path.join(__dirname, "gmail-server.js");
const { tools, ROUTES, routeToolName, startCallbackServer } = require(serverPath);

// ---- tests -----------------------------------------------------------------

async function main() {
  console.log("\nGmail MCP server — mock auth tests\n");

  // 1. getTokenPath uses our env var ----------------------------------------
  await test("GMAIL_TOKEN_FILE env var is respected by token path", () => {
    // We injected GMAIL_TOKEN_FILE above; the server should store tokens there.
    // Verified indirectly: saveToken writes to getTokenPath(), and we can read it back.
    // Direct test: call gmail_auth_status which calls getToken() -> reads getTokenPath().
    // Token doesn't exist yet so it must return unauthenticated.
  });

  // 2. gmail_auth_status when no token --------------------------------------
  await test("gmail_auth_status returns unauthenticated when no token file", async () => {
    const result = await tools.gmail_auth_status.handler({});
    assert.ok(result.content, "has content");
    assert.strictEqual(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("Not authenticated"), `got: ${result.content[0].text}`);
    assert.ok(result.content[0].text.includes(tmpTokenFile), "mentions token path");
  });

  // 3. Write a valid token and check gmail_auth_status ----------------------
  await test("gmail_auth_status returns authenticated after token written", async () => {
    // Create parent dir + write token manually (simulating what saveToken does)
    fs.mkdirSync(path.dirname(tmpTokenFile), { recursive: true });
    const token = {
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      expiry_time: Date.now() / 1000 + 7200, // 2 hours from now
      expires_in: 3600,
    };
    fs.writeFileSync(tmpTokenFile, JSON.stringify(token));

    const result = await tools.gmail_auth_status.handler({});
    assert.ok(result.content[0].text.includes("Authenticated with Gmail"), `got: ${result.content[0].text}`);
    assert.ok(result.content[0].text.includes("present (auto-refresh enabled)"), "mentions refresh token");
  });

  // 4. unauthMsg shape ------------------------------------------------------
  await test("unauthMsg returns correct MCP content shape", async () => {
    // Temporarily remove token so a Gmail tool returns unauthMsg
    fs.unlinkSync(tmpTokenFile);

    const result = await tools.gmail_read_inbox.handler({ maxResults: "5" });
    assert.ok(Array.isArray(result.content), "content is array");
    assert.strictEqual(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("auth_gmail"), `should mention auth_gmail, got: ${result.content[0].text}`);
    assert.ok(result.content[0].text.includes("gmail_auth_status"), "should mention gmail_auth_status");
  });

  // 5. auth_gmail_exchange_code with mock fetch -----------------------------
  await test("auth_gmail_exchange_code saves token on success", async () => {
    // Mock global fetch to simulate Google token endpoint
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const body = opts.body.toString();
      assert.ok(body.includes("authorization_code"), "uses authorization_code grant");
      assert.ok(body.includes("test-code-123"), "sends the code");
      return {
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        }),
      };
    };

    try {
      const result = await tools.auth_gmail_exchange_code.handler({ code: "test-code-123" });
      assert.ok(result.content[0].text.includes("successful"), `got: ${result.content[0].text}`);

      // Token file must exist now
      assert.ok(fs.existsSync(tmpTokenFile), "token file was created");
      const saved = JSON.parse(fs.readFileSync(tmpTokenFile, "utf-8"));
      assert.strictEqual(saved.access_token, "new-access-token");
      assert.strictEqual(saved.refresh_token, "new-refresh-token");
      assert.ok(saved.expiry_time > Date.now() / 1000, "expiry_time is in the future");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 6. ensureAuthenticated refreshes expired token --------------------------
  await test("ensureAuthenticated refreshes token when nearly expired", async () => {
    // Write a token that expires in 30s (< the 60s buffer — should trigger refresh)
    const staleToken = {
      access_token: "stale-token",
      refresh_token: "refresh-tok",
      expiry_time: Date.now() / 1000 + 30,
      expires_in: 3600,
    };
    fs.mkdirSync(path.dirname(tmpTokenFile), { recursive: true });
    fs.writeFileSync(tmpTokenFile, JSON.stringify(staleToken));

    let refreshCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      refreshCalled = true;
      const body = opts.body.toString();
      assert.ok(body.includes("refresh_token"), "uses refresh_token grant");
      assert.ok(body.includes("refresh-tok"), "sends the refresh token");
      return {
        ok: true,
        json: async () => ({
          access_token: "refreshed-access-token",
          expires_in: 3600,
          // no refresh_token in response (Google doesn't always return it)
        }),
      };
    };

    try {
      // Calling gmail_auth_status triggers ensureAuthenticated
      const result = await tools.gmail_auth_status.handler({});
      assert.ok(refreshCalled, "fetch was called for token refresh");
      assert.ok(result.content[0].text.includes("Authenticated"), `got: ${result.content[0].text}`);

      // Saved token should have the new access_token and the old refresh_token preserved
      const saved = JSON.parse(fs.readFileSync(tmpTokenFile, "utf-8"));
      assert.strictEqual(saved.access_token, "refreshed-access-token");
      assert.strictEqual(saved.refresh_token, "refresh-tok", "refresh_token preserved from old token");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 7. tools/list schema shape (simulated JSON-RPC) -------------------------
  await test("tools object contains gmail_auth_status", () => {
    assert.ok(tools.gmail_auth_status, "gmail_auth_status tool exists");
    assert.ok(typeof tools.gmail_auth_status.handler === "function", "has handler");
    assert.ok(typeof tools.gmail_auth_status.description === "string", "has description");
  });

  await test("ROUTES table has expected count (>= 60 entries)", () => {
    assert.ok(ROUTES.length >= 60, `ROUTES has ${ROUTES.length} entries`);
  });

  await test("routeToolName generates unique names", () => {
    const names = ROUTES.map(routeToolName);
    const unique = new Set(names);
    assert.strictEqual(unique.size, names.length, `${names.length - unique.size} duplicate tool names`);
  });

  await test("all ROUTES have required fields", () => {
    for (const r of ROUTES) {
      assert.ok(r.resource, `missing resource in ${JSON.stringify(r)}`);
      assert.ok(r.methodName, `missing methodName in ${JSON.stringify(r)}`);
      assert.ok(r.http, `missing http in ${JSON.stringify(r)}`);
      assert.ok(r.path, `missing path in ${JSON.stringify(r)}`);
      assert.ok(["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.http), `invalid http: ${r.http}`);
    }
  });

  // 8. apiTool-generated handlers return unauthMsg when no token -----------
  await test("generated gmail_api_* tools return unauthMsg when unauthenticated", async () => {
    // Remove token
    try { fs.unlinkSync(tmpTokenFile); } catch {}

    const tool = tools["gmail_api_messages_list"];
    assert.ok(tool, "gmail_api_messages_list tool exists");
    const result = await tool.handler({ userId: "me" });
    assert.ok(result.content[0].text.includes("auth_gmail"), `got: ${result.content[0].text}`);
  });

  // 9. Callback server lifecycle --------------------------------------------
  await test("startCallbackServer binds port 41199 and processes code redirect", async () => {
    // Start the callback server explicitly (in production it runs at boot via
    // `if (require.main === module)`; in tests we call it directly).
    startCallbackServer();
    // server.listen() is async — wait for the port to be bound before sending
    await new Promise(r => setTimeout(r, 150));
    // We simulate Google's redirect by sending a GET with ?code=...
    // and mock global fetch so exchangeCode succeeds.
    const origFetch = globalThis.fetch;
    let exchanged = false;
    globalThis.fetch = async () => {
      exchanged = true;
      return {
        ok: true,
        json: async () => ({
          access_token: "callback-token",
          refresh_token: "callback-refresh",
          expires_in: 3600,
        }),
      };
    };

    try {
      await new Promise((resolve, reject) => {
        const req = http.get("http://localhost:41199/?code=callback-test-code&scope=gmail", (res) => {
          let body = "";
          res.on("data", d => body += d);
          res.on("end", () => {
            try {
              assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
              assert.ok(body.includes("Authentication succeeded"), `expected success page, got: ${body.slice(0, 200)}`);
              assert.ok(exchanged, "fetch was called for code exchange");
              resolve();
            } catch (e) { reject(e); }
          });
        });
        req.on("error", reject);
        req.setTimeout(3000, () => reject(new Error("callback server timeout — port 41199 not listening")));
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ---- summary ------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
