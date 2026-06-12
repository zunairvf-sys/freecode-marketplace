#!/usr/bin/env node
/**
 * Gmail MCP Server — rich structured data edition
 *
 * Every tool returns a structured JSON object (not prose) so the LM can reason
 * about the data. Text fields are still present for quick reading, but the
 * primary output is always a parsed, structured payload.
 *
 * Tools:
 *   auth_gmail                   Get OAuth URL (starts local callback server)
 *   auth_gmail_exchange_code     Exchange code for tokens
 *   gmail_list_messages          List messages with full metadata per result
 *   gmail_get_message            Get a single message: all headers + full MIME tree + body parts
 *   gmail_get_raw_headers        Get every header of a message as key→value map
 *   gmail_get_attachments        List all attachments on a message with size, mimeType, partId
 *   gmail_download_attachment    Download an attachment as base64 (or save path)
 *   gmail_search_messages        Search with full metadata per result
 *   gmail_get_thread             Full thread: every message with headers + snippets
 *   gmail_send_message           Send email (text or HTML)
 *   gmail_reply_to_thread        Reply in a thread (sets In-Reply-To + References correctly)
 *   gmail_compose_draft          Save a draft
 *   gmail_get_labels             List labels with counts
 *   gmail_modify_labels          Add/remove labels
 *   gmail_mark_read              Mark read/unread
 *   gmail_trash_message          Move to trash
 *   gmail_batch_get_metadata     Batch-fetch metadata for up to 50 message IDs in one call
 */

const { readFile, writeFile } = require("fs");
const { promisify } = require("util");
const http = require("http");
const { URL } = require("url");
const readline = require("readline");

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

function getTokenPath() {
  const p = process.env.GMAIL_TOKEN_FILE || "~/.freecode/.gmail-token.json";
  return p.startsWith("~")
    ? (process.env.HOME || process.env.USERPROFILE || "") + p.slice(1)
    : p;
}

async function getToken() {
  try { return JSON.parse(await readFileAsync(getTokenPath(), "utf-8")); }
  catch { return null; }
}

async function saveToken(token) {
  await writeFileAsync(getTokenPath(), JSON.stringify(token, null, 2));
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "http://localhost:41122";

function getAuthUrl() {
  const scope = encodeURIComponent([
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ].join(" "));
  return (
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${scope}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent`
  );
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    data.expiry_time = Date.now() / 1000 + (data.expires_in || 3600);
    await saveToken(data);
    return data;
  }
  throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
}

async function ensureAuthenticated() {
  const token = await getToken();
  if (!token) return false;
  if (token.expiry_time < Date.now() / 1000 + 60) {
    if (!token.refresh_token) return false;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }),
    });
    const newToken = await res.json();
    if (!newToken.access_token) return false;
    newToken.expiry_time = Date.now() / 1000 + (newToken.expires_in || 3600);
    newToken.refresh_token = token.refresh_token;
    await saveToken(newToken);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Local OAuth callback server
// ---------------------------------------------------------------------------

let callbackServer = null;

function startCallbackServer() {
  if (callbackServer) return;
  let redirect;
  try { redirect = new URL(REDIRECT_URI); } catch { return; }
  if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") return;
  const port = Number(redirect.port) || 80;

  const page = (title, msg) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:system-ui;text-align:center;padding:60px 20px">` +
    `<h2>${title}</h2><p>${msg}</p><p>You can close this tab.</p></body></html>`;

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, REDIRECT_URI); } catch { res.writeHead(400); res.end(); return; }
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (error) {
      res.writeHead(400);
      res.end(page("Authorization failed", `Google returned: <code>${error}</code>`));
    } else if (code) {
      try {
        await exchangeCode(code);
        res.writeHead(200);
        res.end(page("Gmail connected", "Authentication succeeded. Token saved."));
      } catch (e) {
        res.writeHead(500);
        res.end(page("Token exchange failed", e.message));
      }
    } else {
      res.writeHead(404);
      res.end(page("Not found", "No code in request."));
    }
    setTimeout(() => { server.close(); if (callbackServer === server) callbackServer = null; }, 1000);
  });

  server.on("error", () => { if (callbackServer === server) callbackServer = null; });
  server.listen(port);
  callbackServer = server;
}

// ---------------------------------------------------------------------------
// Gmail REST API client
// ---------------------------------------------------------------------------

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

async function gmailReq(method, path, body) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GMAIL_BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Gmail API ${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// Batch HTTP multipart — runs up to 100 sub-requests in a single HTTPS round-trip.
// Returns array of parsed response bodies in the same order as `requests`.
async function gmailBatch(requests) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const boundary = "batch_boundary_freecode";
  let body = "";
  requests.forEach((req, i) => {
    body += `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item${i}>\r\n\r\n`;
    body += `${req.method || "GET"} ${req.path}\r\n`;
    if (req.headers) {
      for (const [k, v] of Object.entries(req.headers)) body += `${k}: ${v}\r\n`;
    }
    body += "\r\n";
    if (req.body) body += JSON.stringify(req.body) + "\r\n";
  });
  body += `--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
  });

  const raw = await res.text();
  // Parse multipart response: extract each HTTP sub-response body
  const responseBoundaryMatch = res.headers.get("content-type")?.match(/boundary=([^\s;,]+)/);
  const rb = responseBoundaryMatch ? responseBoundaryMatch[1] : boundary;
  const parts = raw.split(`--${rb}`).slice(1);
  return parts.map(part => {
    const bodyStart = part.indexOf("\r\n\r\n", part.indexOf("\r\n\r\n") + 4);
    if (bodyStart === -1) return null;
    const jsonBody = part.slice(bodyStart + 4).replace(/\r?\n?--$/, "").trim();
    if (!jsonBody) return null;
    try { return JSON.parse(jsonBody); } catch { return null; }
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

function headerVal(payload, name) {
  const h = (payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

/** Return ALL headers as { name: value } map, multi-value headers become arrays */
function allHeaders(payload) {
  const out = {};
  for (const h of payload?.headers || []) {
    const k = h.name.toLowerCase();
    if (out[k] === undefined) out[k] = h.value;
    else if (Array.isArray(out[k])) out[k].push(h.value);
    else out[k] = [out[k], h.value];
  }
  return out;
}

function decodeB64Url(data) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/**
 * Walk the MIME tree and return a structured breakdown:
 * {
 *   bodies: [{ mimeType, content, size }]        — all decoded text/plain + text/html parts
 *   attachments: [{ partId, filename, mimeType, size, attachmentId }]
 *   inlineImages: [{ partId, contentId, mimeType, size, attachmentId }]
 *   rawTree: <the full payload object for deep inspection>
 * }
 */
function parseMimeTree(payload) {
  const result = { bodies: [], attachments: [], inlineImages: [] };

  function walk(part, depth) {
    if (!part) return;
    const mime = part.mimeType || "";
    const disp = headerVal(part, "Content-Disposition");
    const filename = part.filename || headerVal(part, "Content-Disposition").match(/filename="?([^";]+)/i)?.[1] || "";
    const contentId = headerVal(part, "Content-ID").replace(/[<>]/g, "");
    const isAttachment = disp.toLowerCase().startsWith("attachment") || (filename && !contentId);
    const isInline = contentId && filename && !mime.startsWith("text/");

    if (mime.startsWith("text/") && !isAttachment) {
      const content = decodeB64Url(part.body?.data);
      result.bodies.push({
        mimeType: mime,
        content,
        size: part.body?.size || content.length,
        partId: part.partId || "0",
      });
    } else if (isInline) {
      result.inlineImages.push({
        partId: part.partId,
        contentId,
        mimeType: mime,
        size: part.body?.size || 0,
        attachmentId: part.body?.attachmentId || null,
        filename,
      });
    } else if (isAttachment || (filename && part.body?.attachmentId)) {
      result.attachments.push({
        partId: part.partId,
        filename: filename || "unnamed",
        mimeType: mime,
        size: part.body?.size || 0,
        attachmentId: part.body?.attachmentId || null,
      });
    }

    for (const sub of part.parts || []) walk(sub, depth + 1);
  }

  walk(payload, 0);
  return result;
}

/** Pick the best plain-text body. Prefer text/plain, fall back to stripped text/html */
function bestBody(parsed) {
  const plain = parsed.bodies.find(b => b.mimeType === "text/plain");
  if (plain) return plain.content;
  const html = parsed.bodies.find(b => b.mimeType === "text/html");
  if (html) return html.content.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  return "";
}

/** Strip quoted reply sections (lines starting with >) from a body string */
function stripQuotedReply(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const out = [];
  let inQuote = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">") || /^On .+ wrote:$/.test(trimmed)) {
      inQuote = true;
      continue;
    }
    if (inQuote && trimmed === "") continue;
    inQuote = false;
    out.push(line);
  }
  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------
// MIME encode for sending
// ---------------------------------------------------------------------------

function encodeMime({ from, to, cc, bcc, replyTo, subject, textBody, htmlBody, inReplyTo, references }) {
  const boundary = "----=_Part_" + Date.now();
  let mime = "";
  mime += `From: ${from || "me"}\r\n`;
  mime += `To: ${Array.isArray(to) ? to.join(", ") : to}\r\n`;
  if (cc) mime += `Cc: ${cc}\r\n`;
  if (bcc) mime += `Bcc: ${bcc}\r\n`;
  if (replyTo) mime += `Reply-To: ${replyTo}\r\n`;
  if (inReplyTo) mime += `In-Reply-To: ${inReplyTo}\r\n`;
  if (references) mime += `References: ${references}\r\n`;
  mime += `Subject: ${subject}\r\n`;
  mime += "MIME-Version: 1.0\r\n";

  if (htmlBody && textBody) {
    mime += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    mime += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${textBody}\r\n`;
    mime += `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${htmlBody}\r\n`;
    mime += `--${boundary}--\r\n`;
  } else if (htmlBody) {
    mime += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    const stripped = htmlBody.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
    mime += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${stripped}\r\n`;
    mime += `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${htmlBody}\r\n`;
    mime += `--${boundary}--\r\n`;
  } else {
    mime += `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${textBody || ""}\r\n`;
  }

  return Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const NOT_AUTHED = {
  content: [{
    type: "text",
    text: JSON.stringify({ error: "not_authenticated", message: "Call auth_gmail first, complete browser flow, then auth_gmail_exchange_code." }),
  }],
};

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(e) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "api_error", message: String(e?.message || e) }) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools = {

  auth_gmail: {
    description: "Get the OAuth authorization URL for Gmail. Opens a local callback server to capture the redirect automatically.",
    parameters: {},
    handler: async () => {
      startCallbackServer();
      return ok({
        action: "open_url",
        url: getAuthUrl(),
        instructions: "Open the URL in a browser. On success the token is saved automatically. If the browser shows an error, copy the 'code' param from the redirect URL and pass it to auth_gmail_exchange_code.",
      });
    },
  },

  auth_gmail_exchange_code: {
    description: "Exchange an OAuth authorization code for access + refresh tokens.",
    parameters: { code: { type: "string", description: "The authorization code from the redirect URL" } },
    handler: async ({ code }) => {
      try {
        await exchangeCode(code);
        return ok({ success: true, message: "Authenticated. Token saved. You can now use all Gmail tools." });
      } catch (e) { return err(e); }
    },
  },

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  gmail_list_messages: {
    description: "List messages with full metadata (from, to, subject, date, snippet, labels, attachment count). Returns structured array. Replaces the old gmail_read_inbox.",
    parameters: {
      maxResults: { type: "number", description: "Max messages (1-100, default 20)" },
      query: { type: "string", description: "Gmail search query. E.g. 'is:unread from:alice@example.com has:attachment'" },
      pageToken: { type: "string", description: "Page token from previous response for pagination" },
      includeSpamTrash: { type: "boolean", description: "Include spam/trash (default false)" },
    },
    handler: async ({ maxResults = 20, query = "", pageToken, includeSpamTrash = false }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const qs = new URLSearchParams({
          maxResults: String(Math.min(100, maxResults)),
          q: query,
          includeSpamTrash: String(includeSpamTrash),
        });
        if (pageToken) qs.set("pageToken", pageToken);

        const list = await gmailReq("GET", `/users/me/messages?${qs}`);
        const ids = (list.messages || []).map(m => m.id);

        if (ids.length === 0) {
          return ok({ total: 0, messages: [], nextPageToken: list.nextPageToken || null });
        }

        // Batch-fetch metadata for all returned IDs
        const batchReqs = ids.map(id => ({
          method: "GET",
          path: `/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Content-Type`,
        }));
        const results = await gmailBatch(batchReqs);

        const messages = results.map(msg => {
          if (!msg || msg.error) return { id: msg?.id, error: msg?.error?.message || "fetch_failed" };
          const mime = parseMimeTree(msg.payload);
          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: headerVal(msg.payload, "Subject"),
            from: headerVal(msg.payload, "From"),
            to: headerVal(msg.payload, "To"),
            date: headerVal(msg.payload, "Date"),
            snippet: msg.snippet || "",
            labels: msg.labelIds || [],
            unread: (msg.labelIds || []).includes("UNREAD"),
            attachmentCount: mime.attachments.length,
            hasInlineImages: mime.inlineImages.length > 0,
            sizeEstimate: msg.sizeEstimate || 0,
          };
        });

        return ok({
          total: list.resultSizeEstimate || messages.length,
          count: messages.length,
          nextPageToken: list.nextPageToken || null,
          messages,
        });
      } catch (e) { return err(e); }
    },
  },

  gmail_get_message: {
    description: "Get a single message with ALL headers, complete MIME tree breakdown, decoded body parts, attachment list, and inline image list. Use this when you need full details of an email.",
    parameters: {
      messageId: { type: "string", description: "Gmail message ID" },
      stripQuotedReply: { type: "boolean", description: "Strip quoted reply sections from body (default true)" },
      includeRawTree: { type: "boolean", description: "Include the raw MIME payload tree for deep inspection (default false)" },
    },
    handler: async ({ messageId, stripQuotedReply: doStrip = true, includeRawTree = false }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const msg = await gmailReq("GET", `/users/me/messages/${messageId}?format=full`);
        const mime = parseMimeTree(msg.payload);
        const headers = allHeaders(msg.payload);
        const plainBody = bestBody(mime);
        const body = doStrip ? stripQuotedReply(plainBody) : plainBody;

        const result = {
          id: msg.id,
          threadId: msg.threadId,
          labels: msg.labelIds || [],
          unread: (msg.labelIds || []).includes("UNREAD"),
          sizeEstimate: msg.sizeEstimate || 0,
          historyId: msg.historyId,
          internalDate: msg.internalDate,
          // Key headers extracted for convenience
          subject: headers["subject"] || "",
          from: headers["from"] || "",
          to: headers["to"] || "",
          cc: headers["cc"] || "",
          date: headers["date"] || "",
          messageId: headers["message-id"] || "",
          inReplyTo: headers["in-reply-to"] || "",
          references: headers["references"] || "",
          // All headers for full inspection
          headers,
          // Body
          body,
          bodyMimeType: mime.bodies[0]?.mimeType || "text/plain",
          bodyParts: mime.bodies.map(b => ({ mimeType: b.mimeType, size: b.size, partId: b.partId })),
          // Attachments
          attachments: mime.attachments,
          attachmentCount: mime.attachments.length,
          // Inline images
          inlineImages: mime.inlineImages,
          // Snippet
          snippet: msg.snippet || "",
        };

        if (includeRawTree) result.rawPayloadTree = msg.payload;

        return ok(result);
      } catch (e) { return err(e); }
    },
  },

  gmail_get_raw_headers: {
    description: "Return every header of a message as a key→value map. Useful for debugging routing, DKIM, spam scores, or reply threading.",
    parameters: { messageId: { type: "string", description: "Gmail message ID" } },
    handler: async ({ messageId }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const msg = await gmailReq("GET", `/users/me/messages/${messageId}?format=metadata&metadataHeaders=*`);
        const headers = allHeaders(msg.payload);
        return ok({ id: msg.id, headerCount: Object.keys(headers).length, headers });
      } catch (e) { return err(e); }
    },
  },

  gmail_get_attachments: {
    description: "List every attachment on a message with its partId, filename, mimeType, and size. Does not download content.",
    parameters: { messageId: { type: "string", description: "Gmail message ID" } },
    handler: async ({ messageId }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const msg = await gmailReq("GET", `/users/me/messages/${messageId}?format=full`);
        const mime = parseMimeTree(msg.payload);
        return ok({
          messageId,
          attachmentCount: mime.attachments.length,
          inlineImageCount: mime.inlineImages.length,
          attachments: mime.attachments.map(a => ({
            ...a,
            downloadTool: "gmail_download_attachment",
            hint: `Use gmail_download_attachment with messageId="${messageId}" and attachmentId="${a.attachmentId}"`,
          })),
          inlineImages: mime.inlineImages,
        });
      } catch (e) { return err(e); }
    },
  },

  gmail_download_attachment: {
    description: "Download an attachment by its attachmentId and return as base64. Get the attachmentId from gmail_get_attachments.",
    parameters: {
      messageId: { type: "string", description: "Gmail message ID the attachment belongs to" },
      attachmentId: { type: "string", description: "Attachment ID (from gmail_get_attachments)" },
      filename: { type: "string", description: "Filename hint (informational only)" },
    },
    handler: async ({ messageId, attachmentId, filename = "" }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const data = await gmailReq("GET", `/users/me/messages/${messageId}/attachments/${attachmentId}`);
        const sizeBytes = data.size || 0;
        const base64 = (data.data || "").replace(/-/g, "+").replace(/_/g, "/");
        return ok({
          messageId,
          attachmentId,
          filename,
          sizeBytes,
          sizeMB: (sizeBytes / 1048576).toFixed(2),
          encoding: "base64",
          data: base64,
        });
      } catch (e) { return err(e); }
    },
  },

  gmail_search_messages: {
    description: "Search with Gmail query syntax. Returns full metadata per match (not just snippets). Supports: from:, to:, subject:, has:attachment, is:unread, newer_than:7d, filename:pdf, etc.",
    parameters: {
      query: { type: "string", description: "Gmail search query" },
      maxResults: { type: "number", description: "Max results (1-100, default 20)" },
      pageToken: { type: "string", description: "Pagination token" },
    },
    handler: async ({ query, maxResults = 20, pageToken }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const qs = new URLSearchParams({ q: query || "", maxResults: String(Math.min(100, maxResults)) });
        if (pageToken) qs.set("pageToken", pageToken);
        const list = await gmailReq("GET", `/users/me/messages?${qs}`);
        const ids = (list.messages || []).map(m => m.id);
        if (ids.length === 0) return ok({ query, total: 0, messages: [], nextPageToken: null });

        const batchReqs = ids.map(id => ({
          method: "GET",
          path: `/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID`,
        }));
        const results = await gmailBatch(batchReqs);

        const messages = results.map(msg => {
          if (!msg || msg.error) return { error: msg?.error?.message || "fetch_failed" };
          const mime = parseMimeTree(msg.payload);
          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: headerVal(msg.payload, "Subject"),
            from: headerVal(msg.payload, "From"),
            to: headerVal(msg.payload, "To"),
            date: headerVal(msg.payload, "Date"),
            messageId: headerVal(msg.payload, "Message-ID"),
            snippet: msg.snippet || "",
            labels: msg.labelIds || [],
            unread: (msg.labelIds || []).includes("UNREAD"),
            attachmentCount: mime.attachments.length,
            sizeEstimate: msg.sizeEstimate || 0,
          };
        });

        return ok({
          query,
          total: list.resultSizeEstimate || messages.length,
          count: messages.length,
          nextPageToken: list.nextPageToken || null,
          messages,
        });
      } catch (e) { return err(e); }
    },
  },

  gmail_get_thread: {
    description: "Get a full email thread with every message's headers and body. Returns structured conversation array sorted chronologically.",
    parameters: {
      threadId: { type: "string", description: "Gmail thread ID" },
      stripQuotedReply: { type: "boolean", description: "Strip quoted reply text from each message (default true)" },
    },
    handler: async ({ threadId, stripQuotedReply: doStrip = true }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const thread = await gmailReq("GET", `/users/me/threads/${threadId}?format=full`);
        const messages = (thread.messages || []).map(msg => {
          const mime = parseMimeTree(msg.payload);
          const plainBody = bestBody(mime);
          return {
            id: msg.id,
            threadId: msg.threadId,
            date: headerVal(msg.payload, "Date"),
            from: headerVal(msg.payload, "From"),
            to: headerVal(msg.payload, "To"),
            cc: headerVal(msg.payload, "CC"),
            subject: headerVal(msg.payload, "Subject"),
            messageId: headerVal(msg.payload, "Message-ID"),
            inReplyTo: headerVal(msg.payload, "In-Reply-To"),
            snippet: msg.snippet || "",
            labels: msg.labelIds || [],
            unread: (msg.labelIds || []).includes("UNREAD"),
            body: doStrip ? stripQuotedReply(plainBody) : plainBody,
            attachments: mime.attachments,
            attachmentCount: mime.attachments.length,
          };
        });

        return ok({
          threadId,
          messageCount: messages.length,
          subject: messages[0]?.subject || "",
          participants: [...new Set(messages.flatMap(m => [m.from, ...(m.to?.split(",") || [])]).map(s => s.trim()).filter(Boolean))],
          messages,
        });
      } catch (e) { return err(e); }
    },
  },

  gmail_batch_get_metadata: {
    description: "Fetch metadata for up to 50 message IDs in a single API call. Useful when you already have IDs and need from/to/subject/date quickly.",
    parameters: {
      messageIds: { type: "array", items: { type: "string" }, description: "Array of message IDs (max 50)" },
    },
    handler: async ({ messageIds }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const ids = (messageIds || []).slice(0, 50);
        if (ids.length === 0) return ok({ messages: [] });

        const batchReqs = ids.map(id => ({
          method: "GET",
          path: `/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To`,
        }));
        const results = await gmailBatch(batchReqs);

        const messages = results.map((msg, i) => {
          if (!msg || msg.error) return { id: ids[i], error: msg?.error?.message || "fetch_failed" };
          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: headerVal(msg.payload, "Subject"),
            from: headerVal(msg.payload, "From"),
            to: headerVal(msg.payload, "To"),
            date: headerVal(msg.payload, "Date"),
            messageId: headerVal(msg.payload, "Message-ID"),
            inReplyTo: headerVal(msg.payload, "In-Reply-To"),
            labels: msg.labelIds || [],
            unread: (msg.labelIds || []).includes("UNREAD"),
            snippet: msg.snippet || "",
            sizeEstimate: msg.sizeEstimate || 0,
          };
        });

        return ok({ count: messages.length, messages });
      } catch (e) { return err(e); }
    },
  },

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  gmail_send_message: {
    description: "Send an email. Supports plain text and/or HTML body. Set both textBody and htmlBody for a proper multipart/alternative message.",
    parameters: {
      to: { type: "string", description: "Recipient(s), comma-separated" },
      subject: { type: "string", description: "Subject line" },
      textBody: { type: "string", description: "Plain text body" },
      htmlBody: { type: "string", description: "HTML body (optional — use with or instead of textBody)" },
      cc: { type: "string", description: "CC recipients" },
      bcc: { type: "string", description: "BCC recipients" },
      replyTo: { type: "string", description: "Reply-To address" },
    },
    handler: async ({ to, subject, textBody, htmlBody, cc, bcc, replyTo }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const from = process.env.GMAIL_FROM_ADDRESS || "me";
        const raw = encodeMime({ from, to, cc, bcc, replyTo, subject, textBody, htmlBody });
        const sent = await gmailReq("POST", `/users/me/messages/send`, { raw });
        return ok({ success: true, id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds });
      } catch (e) { return err(e); }
    },
  },

  gmail_reply_to_thread: {
    description: "Reply to a thread. Automatically sets In-Reply-To and References headers from the last message so Gmail groups it correctly.",
    parameters: {
      threadId: { type: "string", description: "Thread ID to reply to" },
      textBody: { type: "string", description: "Reply body (plain text)" },
      htmlBody: { type: "string", description: "Reply body (HTML, optional)" },
      replyAll: { type: "boolean", description: "Reply-all (CC all original recipients). Default false." },
    },
    handler: async ({ threadId, textBody, htmlBody, replyAll = false }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const thread = await gmailReq("GET", `/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=CC&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
        const last = thread.messages[thread.messages.length - 1];
        const from = process.env.GMAIL_FROM_ADDRESS || "me";
        const replyTo = headerVal(last.payload, "From");
        const subject = headerVal(last.payload, "Subject");
        const origMsgId = headerVal(last.payload, "Message-ID");
        const origRefs = headerVal(last.payload, "References");
        const references = [origRefs, origMsgId].filter(Boolean).join(" ").trim();

        let cc = undefined;
        if (replyAll) {
          const origTo = headerVal(last.payload, "To");
          const origCc = headerVal(last.payload, "CC");
          cc = [origTo, origCc].filter(Boolean).join(", ");
        }

        const raw = encodeMime({
          from,
          to: replyTo,
          cc,
          subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
          textBody,
          htmlBody,
          inReplyTo: origMsgId,
          references,
        });
        const sent = await gmailReq("POST", `/users/me/messages/send`, { raw, threadId });
        return ok({ success: true, id: sent.id, threadId: sent.threadId, repliedTo: replyTo });
      } catch (e) { return err(e); }
    },
  },

  gmail_compose_draft: {
    description: "Create a draft (not sent). Returns draft ID and message ID.",
    parameters: {
      to: { type: "string", description: "Recipient(s)" },
      subject: { type: "string", description: "Subject" },
      textBody: { type: "string", description: "Plain text body" },
      htmlBody: { type: "string", description: "HTML body (optional)" },
      cc: { type: "string", description: "CC" },
    },
    handler: async ({ to, subject, textBody, htmlBody, cc }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const from = process.env.GMAIL_FROM_ADDRESS || "me";
        const raw = encodeMime({ from, to, cc, subject, textBody, htmlBody });
        const draft = await gmailReq("POST", `/users/me/drafts`, { message: { raw } });
        return ok({ success: true, draftId: draft.id, messageId: draft.message?.id });
      } catch (e) { return err(e); }
    },
  },

  // -------------------------------------------------------------------------
  // Labels & management
  // -------------------------------------------------------------------------

  gmail_get_labels: {
    description: "List all labels with message counts and types.",
    parameters: {},
    handler: async () => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const data = await gmailReq("GET", `/users/me/labels`);
        const labels = (data.labels || []).map(l => ({
          id: l.id,
          name: l.name,
          type: l.type,
          messageListVisibility: l.messageListVisibility,
          labelListVisibility: l.labelListVisibility,
          messagesTotal: l.messagesTotal,
          messagesUnread: l.messagesUnread,
          threadsTotal: l.threadsTotal,
          threadsUnread: l.threadsUnread,
        }));
        const system = labels.filter(l => l.type === "system");
        const user = labels.filter(l => l.type === "user");
        return ok({ total: labels.length, systemLabels: system, userLabels: user });
      } catch (e) { return err(e); }
    },
  },

  gmail_modify_labels: {
    description: "Add or remove labels from a message. Pass label IDs (e.g. 'UNREAD', 'STARRED', or a user label ID from gmail_get_labels).",
    parameters: {
      messageId: { type: "string", description: "Message ID to modify" },
      addLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to add" },
      removeLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to remove" },
    },
    handler: async ({ messageId, addLabelIds = [], removeLabelIds = [] }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const updated = await gmailReq("POST", `/users/me/messages/${messageId}/modify`, {
          addLabelIds,
          removeLabelIds,
        });
        return ok({ success: true, messageId, labels: updated.labelIds || [] });
      } catch (e) { return err(e); }
    },
  },

  gmail_mark_read: {
    description: "Mark a message as read or unread.",
    parameters: {
      messageId: { type: "string", description: "Message ID" },
      read: { type: "boolean", description: "true = mark read, false = mark unread" },
    },
    handler: async ({ messageId, read = true }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        const body = read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] };
        const updated = await gmailReq("POST", `/users/me/messages/${messageId}/modify`, body);
        return ok({ success: true, messageId, read, labels: updated.labelIds || [] });
      } catch (e) { return err(e); }
    },
  },

  gmail_trash_message: {
    description: "Move a message to Trash.",
    parameters: { messageId: { type: "string", description: "Message ID to trash" } },
    handler: async ({ messageId }) => {
      if (!(await ensureAuthenticated())) return NOT_AUTHED;
      try {
        await gmailReq("POST", `/users/me/messages/${messageId}/trash`, {});
        return ok({ success: true, messageId, trashed: true });
      } catch (e) { return err(e); }
    },
  },

};

// ---------------------------------------------------------------------------
// JSON-RPC stdio server
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (raw) => {
  let request;
  try { request = JSON.parse(raw); }
  catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }) + "\n");
    return;
  }

  const { id, method, params } = request;

  if (method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gmail-mcp-rich", version: "2.0.0" },
      },
      id,
    }) + "\n");
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    const toolList = Object.entries(tools).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: {
        type: "object",
        properties: t.parameters,
        required: [],
      },
    }));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", result: { tools: toolList }, id }) + "\n");
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const tool = tools[toolName];
    if (!tool) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
        id,
      }) + "\n");
      return;
    }
    try {
      const result = await tool.handler(args);
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        result: { content: result.content, isError: result.isError },
        id,
      }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: JSON.stringify({ error: "handler_crash", message: e.message }) }], isError: true },
        id,
      }) + "\n");
    }
    return;
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32601, message: `Unknown method: ${method}` },
    id,
  }) + "\n");
});

process.stderr.write("Gmail MCP server v2 (rich data) running on stdio\n");