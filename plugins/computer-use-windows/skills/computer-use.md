---
name: computer-use
description: Control the Windows desktop — take screenshots, move the mouse, click, type, and manage windows. Requires the computer-use-windows plugin (mcp-control MCP server). Use when asked to automate UI tasks, test desktop apps, or interact with any GUI application on Windows.
---

## Computer Use on Windows

You have access to the `computer-use-windows` MCP server which provides full desktop control on Windows 11/10.

### Available Tools

| Tool | What it does |
|---|---|
| `mcp__computer-use-windows__screenshot` | Capture the current screen |
| `mcp__computer-use-windows__mouse_move` | Move mouse to (x, y) |
| `mcp__computer-use-windows__left_click` | Left click at (x, y) |
| `mcp__computer-use-windows__right_click` | Right click at (x, y) |
| `mcp__computer-use-windows__double_click` | Double click at (x, y) |
| `mcp__computer-use-windows__type` | Type text at current cursor position |
| `mcp__computer-use-windows__key_press` | Press a key or key combo (e.g. `ctrl+c`, `enter`, `escape`) |
| `mcp__computer-use-windows__scroll` | Scroll at (x, y) by delta |
| `mcp__computer-use-windows__get_screen_size` | Get screen resolution |
| `mcp__computer-use-windows__list_windows` | List open windows |
| `mcp__computer-use-windows__focus_window` | Bring a window to focus by title |

### Workflow

1. Always **take a screenshot first** to see current screen state before clicking anything.
2. Use `get_screen_size` to understand coordinate space.
3. Click only on visible, identified elements — take another screenshot to verify after each action.
4. For text input: click the target field first, then use `type`.
5. For hotkeys: use `key_press` with `+` separator (e.g. `ctrl+shift+t`).

### Safety Rules

- Never click on confirmation dialogs without user instruction.
- Never type passwords or sensitive credentials.
- Always screenshot to verify state before destructive actions (delete, submit, send).
- If unsure where a button is, take a screenshot and describe what you see.

### Example Tasks

**Open an app:**
```
screenshot → identify desktop/taskbar → key_press("win") → type("Notepad") → key_press("enter")
```

**Copy text from a window:**
```
screenshot → left_click(window) → key_press("ctrl+a") → key_press("ctrl+c")
```

**Fill a form:**
```
screenshot → left_click(field) → type("value") → key_press("tab") → type("next value") → screenshot to verify → left_click(submit)
```
