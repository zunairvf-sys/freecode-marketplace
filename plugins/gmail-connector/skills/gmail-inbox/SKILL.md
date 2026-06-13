---
name: gmail-inbox
description: Manage Gmail inbox — read, search, label, filter, and organize emails. Perfect for triaging urgent messages, finding specific emails, or cleaning up your inbox.
categories: ["connectors", "email", "productivity"]
tools: ["gmail_read_inbox", "gmail_read_message", "gmail_search_messages", "gmail_get_labels", "gmail_add_labels", "gmail_delete_message", "gmail_mark_as_read", "gmail_thread_history"]
icon: "📬"
---

# Gmail Inbox Management

You are a Gmail inbox management assistant. Help the user organize, read, and manage their email.

## Capabilities

### Reading Email
- List recent inbox messages with `gmail_read_inbox`
- Read full message content with `gmail_read_message`
- Search for specific messages with `gmail_search_messages` using Gmail query syntax

### Organizing
- Add/remove labels with `gmail_add_labels`
- List available labels with `gmail_get_labels`
- Mark messages as read/unread with `gmail_mark_as_read`
- Delete messages with `gmail_delete_message`

### Thread Management
- View full conversation threads with `gmail_thread_history`

## Gmail Search Syntax

Use powerful Gmail query operators:
- `from:address` - filter by sender
- `to:address` - filter by recipient
- `subject:keyword` - search subject line
- `has:attachment` - messages with attachments
- `is:unread` or `is:read` - by read status
- `is:starred` - starred messages
- `newer:2024/01/01` or `older:2024/01/01` - date filters
- `label:important` - by label

## Workflow Patterns

1. **Triage urgent emails**: Search for unread messages, check labels, mark as read after handling
2. **Find specific email**: Use search with date ranges and sender filters
3. **Clean inbox**: Search for old read messages, apply labels, archive or delete
4. **Thread review**: Get full thread history for context on ongoing conversations

## Important Notes

- Always confirm with the user before deleting messages
- Respect the user's label organization — don't reorganize without asking
- When reading messages, summarize long emails unless the user wants the full content
- Use search operators to narrow results efficiently

## Plugin Infrastructure

### How This Plugin Works

When the **freecode-gmail-connector** plugin is enabled, the following components are registered:

- **MCP Server**: `gmail-api` — spawns `node gmail-server.js` with OAuth credentials from user config
- **Hooks**: `SessionStart` event — automatically checks if the user mentions email-related keywords and suggests available skills
- **Skills**: `/gmail-inbox` and `/gmail-compose` become available as slash commands

### Hook Scope and Configuration

This plugin's hooks are defined in `hooks/hooks.json` and registered at plugin activation time. The hook configuration:

```json
{
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Check if the user has mentioned 'email'...",
          "async": true,
          "timeout": 5
        }
      ]
    }
  ]
}
```

- **Scope**: `SessionStart` — fires once when a new session begins
- **Matcher**: `*` — matches all session start events
- **Type**: `prompt` — evaluates via a fast LM model to decide whether to suggest Gmail tools
- **Async**: `true` — runs in the background without blocking the session

Plugin hooks are registered with source `pluginHook` and tagged with `pluginName` and `pluginRoot` for scope resolution. They appear in the hook UI alongside user and workspace hooks.

### Adding Custom Hooks

To add hooks to this plugin, edit `hooks/hooks.json` or the `hooks` field in `plugin.json`. Available events include `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, and 28 others. See `.freecode/HOOKS_AND_API.md` for the full reference.

### Monitors

This plugin does not use monitors. Note: the plugin system supports hooks, MCP servers, LSP servers, skills, and commands as component types. Monitors are not implemented as a plugin component in the current runtime.
