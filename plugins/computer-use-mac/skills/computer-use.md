---
name: computer-use
description: Control the macOS desktop — take screenshots, move the mouse, click, type, scroll, and manage app windows. Requires the computer-use-mac plugin (mac-use-mcp MCP server, macOS 13+). Use when asked to automate UI tasks, test desktop apps, or interact with any GUI application on macOS.
---

## Computer Use on macOS

You have access to the `computer-use-mac` MCP server which provides full desktop control on macOS 13+ via JXA (JavaScript for Automation) — no Xcode or external dependencies required.

### Available Tools

| Tool | What it does |
|---|---|
| `mcp__computer-use-mac__screenshot` | Capture the current screen |
| `mcp__computer-use-mac__left_click` | Left click at (x, y) |
| `mcp__computer-use-mac__right_click` | Right click at (x, y) |
| `mcp__computer-use-mac__double_click` | Double click at (x, y) |
| `mcp__computer-use-mac__mouse_move` | Move mouse to (x, y) |
| `mcp__computer-use-mac__type` | Type text at current cursor |
| `mcp__computer-use-mac__key_press` | Press a key or combo (e.g. `cmd+c`, `return`, `escape`) |
| `mcp__computer-use-mac__scroll` | Scroll at (x, y) by delta |
| `mcp__computer-use-mac__focus_app` | Focus an application by name |
| `mcp__computer-use-mac__list_apps` | List running applications |
| `mcp__computer-use-mac__get_screen_info` | Get screen size and display info |

### Workflow

1. Always **take a screenshot first** before clicking anything.
2. Use `get_screen_info` to understand display resolution and coordinate space.
3. Use `focus_app` before interacting with a specific app — ensures keystrokes go to the right target.
4. Screenshot after each action to verify the result before continuing.
5. For text input: click target field → `type`. For combos: `key_press("cmd+shift+4")`.

### Safety Rules

- Never click confirmation/destructive dialogs without explicit user instruction.
- Never type passwords, API keys, or sensitive credentials.
- Always screenshot to verify state before submitting forms or triggering sends.
- macOS may show a permissions dialog for Accessibility/Screen Recording on first run — the user must approve these manually.

### Permissions Required (first run)

macOS requires user approval in **System Settings → Privacy & Security**:
- **Accessibility** — for mouse/keyboard control
- **Screen Recording** — for screenshots

Prompt the user to approve these if the first screenshot returns an error.

### Example Tasks

**Open an app:**
```
focus_app("Finder") → screenshot → key_press("cmd+space") → type("Terminal") → key_press("return")
```

**Copy text from a window:**
```
focus_app("Safari") → screenshot → left_click(window) → key_press("cmd+a") → key_press("cmd+c")
```

**Fill a form:**
```
screenshot → left_click(field) → type("value") → key_press("tab") → screenshot → left_click(submit)
```
