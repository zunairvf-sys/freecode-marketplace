#!/usr/bin/env node
// Parity test: every Gmail API v1 method documented in servergmail.md must have
// a matching entry in the ROUTES table inside gmail-server.js (and vice versa),
// so every gmail_api_<resource>_<method> tool the LM sees actually maps to a
// real Gmail API endpoint with the right HTTP verb and path.
"use strict";

const fs = require("fs");
const path = require("path");

const SERVER_FILE = path.join(__dirname, "gmail-server.js");
const SPEC_FILE = path.join(__dirname, "servergmail.md");

function extractRoutesFromServer(src) {
  const routes = [];
  const re = /\{\s*resource:\s*"([^"]+)",\s*methodName:\s*"([^"]+)",\s*http:\s*"([^"]+)",\s*path:\s*"([^"]+)"\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    routes.push({ resource: m[1], methodName: m[2], http: m[3], path: m[4] });
  }
  return routes;
}

function extractRoutesFromSpec(src) {
  const routes = [];
  let currentResource = null;
  let currentMethod = null;
  for (const line of src.split(/\r?\n/)) {
    let m = line.match(/^# Resource:\s*(v1\.\S+)/);
    if (m) {
      currentResource = m[1];
      currentMethod = null;
      continue;
    }
    m = line.match(/^### (\w+)/);
    if (m) {
      currentMethod = m[1];
      continue;
    }
    m = line.match(/^(GET|POST|PUT|PATCH|DELETE)\s+`(\/gmail\/v1[^`]*)`/);
    if (m && currentResource && currentMethod) {
      routes.push({
        resource: currentResource,
        methodName: currentMethod,
        http: m[1],
        path: m[2].replace(/^\/gmail\/v1/, ""),
      });
      currentMethod = null; // each ### heading documents exactly one HTTP route
    }
  }
  return routes;
}

function routeKey(r) {
  return `${r.resource}.${r.methodName} ${r.http} ${r.path}`;
}

function routeToolName(route) {
  const group = route.resource.replace(/^v1\.users\.?/, "").replace(/\./g, "_") || "users";
  return `gmail_api_${group}_${route.methodName}`;
}

function main() {
  const serverSrc = fs.readFileSync(SERVER_FILE, "utf8");
  const specSrc = fs.readFileSync(SPEC_FILE, "utf8");

  const serverRoutes = extractRoutesFromServer(serverSrc);
  const specRoutes = extractRoutesFromSpec(specSrc);

  if (serverRoutes.length === 0) {
    console.error("FAIL: could not find any ROUTES entries in gmail-server.js");
    process.exit(1);
  }
  if (specRoutes.length === 0) {
    console.error("FAIL: could not find any method entries in servergmail.md");
    process.exit(1);
  }

  const serverKeys = new Set(serverRoutes.map(routeKey));
  const specKeys = new Set(specRoutes.map(routeKey));

  const missingInServer = specRoutes.filter(r => !serverKeys.has(routeKey(r)));
  const extraInServer = serverRoutes.filter(r => !specKeys.has(routeKey(r)));

  // Ensure tool names are unique (no collisions between gmail_api_* tools).
  const toolNames = serverRoutes.map(routeToolName);
  const dupes = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);

  console.log(`servergmail.md methods: ${specRoutes.length}`);
  console.log(`gmail-server.js ROUTES: ${serverRoutes.length}`);

  let ok = true;

  if (missingInServer.length) {
    ok = false;
    console.error(`\nFAIL: ${missingInServer.length} method(s) in servergmail.md have no matching ROUTES entry:`);
    for (const r of missingInServer) console.error(`  - ${routeKey(r)}`);
  }

  if (extraInServer.length) {
    console.warn(`\nWARN: ${extraInServer.length} ROUTES entry(ies) not found in servergmail.md (ok if intentional extras):`);
    for (const r of extraInServer) console.warn(`  - ${routeKey(r)}`);
  }

  if (dupes.length) {
    ok = false;
    console.error(`\nFAIL: duplicate generated tool names: ${[...new Set(dupes)].join(", ")}`);
  }

  if (ok) {
    console.log("\nPASS: every servergmail.md method has a matching gmail_api_* tool.");
  } else {
    process.exit(1);
  }
}

main();
