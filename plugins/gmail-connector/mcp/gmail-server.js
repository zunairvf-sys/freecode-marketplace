/**
 * Gmail MCP Server - API-based Gmail integration (zero-dependency)
 *
 * Uses raw JSON-RPC over stdio — no external npm dependencies required.
 *
 * Tools exposed:
 *   - auth_gmail                 Get OAuth authorization URL
 *   - auth_gmail_exchange_code   Exchange authorization code for tokens
 *   - gmail_read_inbox           List recent messages
 *   - gmail_read_message         Read a full message by ID
 *   - gmail_search_messages      Search messages by query
 *   - gmail_compose_draft        Create a draft email
 *   - gmail_send_message         Send an email immediately
 *   - gmail_reply_to_thread      Reply to an existing thread
 *   - gmail_add_labels           Add labels to messages
 *   - gmail_get_labels           List all labels
 *   - gmail_delete_message       Move a message to trash
 *   - gmail_mark_as_read         Mark messages as read/unread
 *   - gmail_thread_history       Get full thread conversation
 *   - gmail_send_html            Send HTML-formatted email
 */

const { readFile, writeFile } = require("fs");
const { promisify } = require("util");

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// --- Token helpers ---

function getTokenPath() {
  const p = process.env.GMAIL_TOKEN_FILE || "~/.freecode/.gmail-token.json";
  return p.startsWith("~") ? (process.env.HOME || process.env.USERPROFILE || "") + p.slice(1) : p;
}

async function getToken() {
  try { return JSON.parse(await readFileAsync(getTokenPath(), "utf-8")); }
  catch { return null; }
}

async function saveToken(t) {
  await writeFileAsync(getTokenPath(), JSON.stringify(t, null, 2));
}

// --- Gmail API Client ---

class GmailClient {
  constructor() {
    this.baseUrl = "https://gmail.googleapis.com/gmail/v1";
    this.clientId = process.env.GMAIL_CLIENT_ID;
    this.clientSecret = process.env.GMAIL_CLIENT_SECRET;
    this.redirectUri = process.env.GMAIL_REDIRECT_URI || "http://localhost:41122";
    this.token = null;
  }

  async ensureAuthenticated() {
    this.token = await getToken();
    if (!this.token || this.token.expiry_time < Date.now() / 1000) {
      if (this.token && this.token.refresh_token) {
        await this.refreshAccessToken();
        return true;
      }
      return false;
    }
    return true;
  }

  getAuthUrl() {
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
    );
    return [
      `https://accounts.google.com/o/oauth2/v2/auth`,
      `?client_id=${this.clientId}`,
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}`,
      `&scope=${scope}`,
      `&response_type=code`,
      `&access_type=offline`,
      `&prompt=consent`,
    ].join("");
  }

  async exchangeCode(code) {
    const data = await this._postJson("https://oauth2.googleapis.com/token", new URLSearchParams({
      code, client_id: this.clientId, client_secret: this.clientSecret,
      redirect_uri: this.redirectUri, grant_type: "authorization_code",
    }));
    if (data.access_token) {
      data.expiry_time = Date.now() / 1000 + (data.expires_in || 3600);
      this.token = data;
      await saveToken(data);
      return data;
    }
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  async refreshAccessToken() {
    const t = await this._postJson("https://oauth2.googleapis.com/token", new URLSearchParams({
      client_id: this.clientId, client_secret: this.clientSecret,
      grant_type: "refresh_token", refresh_token: this.token.refresh_token,
    }));
    t.expiry_time = Date.now() / 1000 + t.expires_in;
    t.refresh_token = this.token.refresh_token;
    await saveToken(t);
    this.token = t;
  }

  async _postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: typeof body === "string" ? body : new URLSearchParams(body),
    });
    return res.json();
  }

  async request(method, path, body) {
    const opts = {
      method,
      headers: {
        "Authorization": `Bearer ${this.token.access_token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async listMessages({ maxResults = "20", query } = {}) {
    const qs = new URLSearchParams({ maxResults, q: query || "", includeSpamTrash: "false" });
    const data = await this.request("GET", `/users/me/messages?${qs}`);
    return data.messages || [];
  }

  getMessage(id) { return this.request("GET", `/users/me/messages/${id}`); }
  sendMessage(uid, raw) { return this.request("POST", `/users/${uid}/messages/send`, { raw }); }
  createDraft(uid, msg) { return this.request("POST", `/users/${uid}/drafts`, { message: msg }); }
  modifyMessage(id, body) { return this.request("PUT", `/users/me/messages/${id}/modify`, body); }
  deleteMessage(id) { return this.request("DELETE", `/users/me/messages/${id}`); }
  listLabels() { return this.request("GET", `/users/me/labels`); }
  getThread(id) { return this.request("GET", `/users/me/threads/${id}`); }

  labelMessage(id, add = [], remove = []) {
    const body = {};
    if (add.length) body.addLabelIds = add;
    if (remove.length) body.removeLabelIds = remove;
    return this.request("PUT", `/users/me/messages/${id}/modify`, body);
  }
}

// --- MIME helpers ---

function encodeMime(from, to, subject, body, html, replyTo, cc) {
  const b = "----=_Part_0";
  let m = `From: ${from}\r\nTo: ${Array.isArray(to) ? to.join(", ") : to}\r\n`;
  if (cc) m += `Cc: ${cc}\r\n`;
  if (replyTo) m += `Reply-To: ${replyTo}\r\n`;
  m += `Subject: ${subject}\r\nMIME-Version: 1.0\r\n`;
  if (html) {
    m += `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n`;
    m += `--${b}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${body.replace(/<[^>]*>/g, "")}\r\n`;
    m += `--${b}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${body}\r\n--${b}--\r\n`;
  } else {
    m += `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${body}\r\n`;
  }
  return Buffer.from(m).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodeMime(raw) {
  const dec = Buffer.from(
    (raw || "").replace(/-/g, "+").replace(/_/g, "/").replace(/=/g, ""),
    "base64"
  ).toString("utf-8");
  const hdrs = {};
  const ie = dec.indexOf("\r\n\r\n");
  if (ie > -1) {
    dec.slice(0, ie).split("\r\n").forEach(l => {
      const c = l.indexOf(":");
      if (c > -1) hdrs[l.slice(0, c).toLowerCase()] = l.slice(c + 2);
    });
  }
  return { headers: hdrs, subject: hdrs.subject || "", from: hdrs.from || "", to: hdrs.to || "", date: hdrs.date || "", body: dec.slice(ie + 4) };
}

// --- Raw MCP JSON-RPC over stdio (no SDK needed) ---

const gmail = new GmailClient();
let _reqId = 0;

// Tool definitions: [name, description, {params}, handler]
const tools = [];

function defTool(name, desc, params, handler) {
  tools.push({ name, description: desc, inputSchema: { type: "object", properties: params, required: [] }, handler });
}

const unauth = { content: [{ type: "text", text: "Not authenticated with Gmail. Call auth_gmail to get the authorization URL, complete the browser flow, then call auth_gmail_exchange_code with the code." }], isError: true };

defTool("auth_gmail", "Get the OAuth authorization URL for Gmail. Open this URL in your browser, authorize the app, then copy the authorization code from the redirect URL and pass it to auth_gmail_exchange_code.", {}, async () => {
  return { content: [{ type: "text", text: `Open this URL in your browser to authorize Gmail access:\n\n${gmail.getAuthUrl()}\n\nAfter authorizing, copy the 'code' parameter from the redirect URL and pass it to auth_gmail_exchange_code.` }] };
});

defTool("auth_gmail_exchange_code", "Exchange an OAuth authorization code for Gmail access tokens.", { code: { type: "string", description: "Authorization code from redirect URL" } }, async ({ code }) => {
  try {
    await gmail.exchangeCode(code.trim());
    return { content: [{ type: "text", text: "Gmail authentication successful! Token saved." }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Auth failed: ${e.message}` }], isError: true };
  }
});

defTool("gmail_read_inbox", "List recent messages in your inbox.", { maxResults: { type: "string", description: "Max messages (default 20)" }, query: { type: "string", description: "Search query" } }, async ({ maxResults, query }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const msgs = await gmail.listMessages({ maxResults, query: query || undefined });
  return { content: [{ type: "text", text: `Found ${msgs.length} messages.\n${msgs.slice(0, 10).map((m, i) => `${i + 1}. ID: ${m.id} | Thread: ${m.threadId} | ${m.snippet || ""}`).join("\n")}` }] };
});

defTool("gmail_read_message", "Read a full email by message ID.", { messageId: { type: "string", description: "Gmail message ID" } }, async ({ messageId }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const msg = await gmail.getMessage(messageId);
  const d = decodeMime(msg.payload?.parts?.find(p => p.mimeType === "text/plain")?.body?.data || msg.payload?.body?.data || "");
  return { content: [{ type: "text", text: `From: ${d.from}\nTo: ${d.to}\nDate: ${d.date}\nSubject: ${d.subject}\n\n${d.body}` }] };
});

defTool("gmail_search_messages", 'Search messages (from:, to:, subject:, has:attachment, is:unread, etc.).', { query: { type: "string", description: "Gmail search query" }, maxResults: { type: "string", description: "Max results" } }, async ({ query, maxResults }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const msgs = await gmail.listMessages({ maxResults, query });
  const results = await Promise.all(msgs.slice(0, 10).map(async m => { const f = await gmail.getMessage(m.id); return { id: m.id, snippet: m.snippet, labels: f.labelIds }; }));
  return { content: [{ type: "text", text: `Search results for "${query}":\n${JSON.stringify(results, null, 2)}` }] };
});

defTool("gmail_send_message", "Send an email immediately.", { to: { type: "string", description: "Recipient(s)" }, subject: { type: "string", description: "Subject" }, body: { type: "string", description: "Body" }, html: { type: "boolean", description: "HTML body?" }, cc: { type: "string", description: "CC" }, replyTo: { type: "string", description: "Reply-To" } }, async ({ to, subject, body, html, cc, replyTo }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const raw = encodeMime(process.env.GMAIL_FROM_ADDRESS || "me", to, subject, body, html, replyTo, cc);
  const s = await gmail.sendMessage("me", raw);
  return { content: [{ type: "text", text: `Email sent. ID: ${s.id} Thread: ${s.threadId}` }] };
});

defTool("gmail_compose_draft", "Create a draft email without sending.", { to: { type: "string", description: "Recipient(s)" }, subject: { type: "string", description: "Subject" }, body: { type: "string", description: "Body" }, html: { type: "boolean", description: "HTML body?" } }, async ({ to, subject, body, html }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const draft = await gmail.createDraft("me", { raw: encodeMime("", to, subject, body, html) });
  return { content: [{ type: "text", text: `Draft created. ID: ${draft.id}` }] };
});

defTool("gmail_reply_to_thread", "Reply to an email thread.", { threadId: { type: "string", description: "Thread ID" }, body: { type: "string", description: "Reply text" } }, async ({ threadId, body }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const t = await gmail.getThread(threadId);
  const d = decodeMime(t.messages[t.messages.length - 1].payload.body.data || "");
  const s = await gmail.sendMessage("me", encodeMime("", d.from, `Re: ${d.subject}`, body));
  return { content: [{ type: "text", text: `Reply sent. ID: ${s.id}` }] };
});

defTool("gmail_get_labels", "List all Gmail labels.", {}, async () => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const l = await gmail.listLabels();
  return { content: [{ type: "text", text: `Labels (${(l.labels || []).length}):\n${(l.labels || []).map(x => `  ${x.id} - ${x.name} (${x.messageCount} msgs)`).join("\n")}` }] };
});

defTool("gmail_add_labels", "Add or remove labels from a message.", { messageId: { type: "string", description: "Message ID" }, addLabels: { type: "string", description: "Comma-separated labels to add" }, removeLabels: { type: "string", description: "Comma-separated labels to remove" } }, async ({ messageId, addLabels, removeLabels }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  await gmail.labelMessage(messageId, addLabels ? addLabels.split(",").map(s => s.trim()) : [], removeLabels ? removeLabels.split(",").map(s => s.trim()) : []);
  return { content: [{ type: "text", text: `Labels updated for ${messageId}.` }] };
});

defTool("gmail_delete_message", "Move a message to Trash.", { messageId: { type: "string", description: "Message ID" } }, async ({ messageId }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  await gmail.deleteMessage(messageId);
  return { content: [{ type: "text", text: `Message ${messageId} trashed.` }] };
});

defTool("gmail_mark_as_read", "Mark a message as read or unread.", { messageId: { type: "string", description: "Message ID" }, markRead: { type: "boolean", description: "true=read, false=unread" } }, async ({ messageId, markRead }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const body = markRead ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] };
  await gmail.modifyMessage(messageId, body);
  return { content: [{ type: "text", text: `Message ${messageId} marked as ${markRead ? "read" : "unread"}.` }] };
});

defTool("gmail_thread_history", "Get full conversation thread.", { threadId: { type: "string", description: "Thread ID" } }, async ({ threadId }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const t = await gmail.getThread(threadId);
  const summary = (t.messages || []).map((m, i) => { const d = decodeMime(m.payload.body.data || ""); return `${i + 1}. [${d.date}] ${d.from}: ${d.subject}`; }).join("\n");
  return { content: [{ type: "text", text: `Thread ${threadId} (${(t.messages || []).length} msgs):\n${summary}` }] };
});

defTool("gmail_send_html", "Send an HTML-formatted email.", { to: { type: "string", description: "Recipient(s)" }, subject: { type: "string", description: "Subject" }, htmlBody: { type: "string", description: "HTML content" }, cc: { type: "string", description: "CC" } }, async ({ to, subject, htmlBody, cc }) => {
  if (!(await gmail.ensureAuthenticated())) return unauth;
  const s = await gmail.sendMessage("me", encodeMime("", to, subject, htmlBody, true, null, cc));
  return { content: [{ type: "text", text: `HTML email sent. ID: ${s.id}` }] };
});

// --- MCP JSON-RPC server ---

function write(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handleRequest(msg) {
  const id = msg.id;

  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gmail-api-connector", version: "1.0.1" } } };
  }

  if (msg.method === "notifications/initialized") {
    return null;
  }

  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
    };
  }

  if (msg.method === "tools/call") {
    const tool = tools.find(t => t.name === msg.params?.name);
    if (!tool) return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${msg.params?.name}` } };
    try {
      const result = await tool.handler(msg.params || {});
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${msg.method}` } };
}

// Read stdin line by line
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = await handleRequest(msg);
    if (response) write(response);
  } catch (e) {
    console.error("MCP error:", e.message);
  }
});

console.error("Gmail MCP server running on stdio");
