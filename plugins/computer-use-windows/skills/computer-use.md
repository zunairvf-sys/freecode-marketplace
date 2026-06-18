# Windows Computer Use

You have full Windows desktop control via the `computer-use-windows` MCP server.

## Available tools

- **screenshot** — capture the full screen or a region (returns image)
- **cursor_position** — get current mouse position
- **mouse_move** — move mouse to (x, y)
- **left_click / right_click / middle_click / double_click** — click at coordinates
- **left_click_drag** — drag from one point to another
- **left_mouse_down / left_mouse_up** — hold/release mouse button
- **scroll** — scroll up/down/left/right at a position
- **type** — type text at current focus
- **key** — press a key or hotkey (e.g. `ctrl+c`, `alt+f4`, `win`, `enter`)
- **hold_key** — hold a key for a duration
- **read_clipboard / write_clipboard** — clipboard access
- **open_application** — launch an app by name or path
- **list_granted_applications** — list running processes
- **screen_size** — get screen dimensions
- **find_on_screen** — locate an image on screen, returns center coordinates
- **run_powershell** — execute PowerShell commands
- **computer_batch** — batch multiple actions in one call
- **wait** — pause execution

## Workflow

Always take a screenshot first to understand the current screen state before clicking or typing. After any action that changes the screen, take another screenshot to verify the result.
