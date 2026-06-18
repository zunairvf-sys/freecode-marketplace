#!/usr/bin/env python3
"""
FreeCode Computer Use MCP Server for Windows.
screenshot, mouse, keyboard, clipboard, window management, PowerShell.
Pure Python - no C++ compile required.
"""
import asyncio, base64, io, os, subprocess, time
import pyautogui, pyperclip, psutil
from PIL import Image
from mcp.server.fastmcp import FastMCP

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

mcp = FastMCP("freecode-computer-use-windows")


def _screenshot_b64(region=None) -> str:
    img = pyautogui.screenshot(region=region)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ── Screenshot ─────────────────────────────────────────────────────────────────

@mcp.tool()
def screenshot(left: int = None, top: int = None, width: int = None, height: int = None) -> list:
    """Take a screenshot. Optionally specify left/top/width/height for a region. Returns base64 PNG image."""
    region = None
    if all(v is not None for v in [left, top, width, height]):
        region = (left, top, width, height)
    b64 = _screenshot_b64(region)
    return [{"type": "image", "data": b64, "mimeType": "image/png"}]


@mcp.tool()
def screen_size() -> str:
    """Get screen width and height in pixels."""
    w, h = pyautogui.size()
    return f'{{"width": {w}, "height": {h}}}'


# ── Mouse ──────────────────────────────────────────────────────────────────────

@mcp.tool()
def cursor_position() -> str:
    """Get current mouse cursor position."""
    x, y = pyautogui.position()
    return f'{{"x": {x}, "y": {y}}}'


@mcp.tool()
def mouse_move(x: int, y: int, duration: float = 0.1) -> str:
    """Move mouse cursor to (x, y). duration controls movement speed in seconds."""
    pyautogui.moveTo(x, y, duration=duration)
    return f"Moved to ({x}, {y})"


@mcp.tool()
def left_click(x: int = None, y: int = None) -> str:
    """Left-click at (x, y). Omit coordinates to click at current position."""
    if x is not None and y is not None:
        pyautogui.click(x, y)
    else:
        pyautogui.click()
    return f"Left clicked at ({x}, {y})"


@mcp.tool()
def right_click(x: int = None, y: int = None) -> str:
    """Right-click at (x, y). Omit coordinates to click at current position."""
    if x is not None and y is not None:
        pyautogui.rightClick(x, y)
    else:
        pyautogui.rightClick()
    return f"Right clicked at ({x}, {y})"


@mcp.tool()
def middle_click(x: int = None, y: int = None) -> str:
    """Middle-click at (x, y)."""
    if x is not None and y is not None:
        pyautogui.middleClick(x, y)
    else:
        pyautogui.middleClick()
    return f"Middle clicked at ({x}, {y})"


@mcp.tool()
def double_click(x: int = None, y: int = None) -> str:
    """Double-click at (x, y)."""
    if x is not None and y is not None:
        pyautogui.doubleClick(x, y)
    else:
        pyautogui.doubleClick()
    return f"Double clicked at ({x}, {y})"


@mcp.tool()
def left_click_drag(start_x: int, start_y: int, end_x: int, end_y: int, duration: float = 0.3) -> str:
    """Click and drag from (start_x, start_y) to (end_x, end_y)."""
    pyautogui.moveTo(start_x, start_y)
    pyautogui.dragTo(end_x, end_y, duration=duration, button="left")
    return f"Dragged ({start_x},{start_y}) -> ({end_x},{end_y})"


@mcp.tool()
def left_mouse_down(x: int = None, y: int = None) -> str:
    """Press and hold left mouse button. Optionally move to (x, y) first."""
    if x is not None and y is not None:
        pyautogui.moveTo(x, y)
    pyautogui.mouseDown(button="left")
    return "Left mouse button pressed"


@mcp.tool()
def left_mouse_up(x: int = None, y: int = None) -> str:
    """Release left mouse button. Optionally move to (x, y) first."""
    if x is not None and y is not None:
        pyautogui.moveTo(x, y)
    pyautogui.mouseUp(button="left")
    return "Left mouse button released"


@mcp.tool()
def scroll(x: int, y: int, direction: str, clicks: int = 3) -> str:
    """Scroll at position (x, y). direction: up/down/left/right. clicks: number of scroll steps."""
    if direction == "up":
        pyautogui.scroll(clicks, x=x, y=y)
    elif direction == "down":
        pyautogui.scroll(-clicks, x=x, y=y)
    elif direction == "left":
        pyautogui.hscroll(-clicks, x=x, y=y)
    elif direction == "right":
        pyautogui.hscroll(clicks, x=x, y=y)
    return f"Scrolled {direction} {clicks} clicks at ({x},{y})"


# ── Keyboard ───────────────────────────────────────────────────────────────────

@mcp.tool()
def type_text(text: str, interval: float = 0.02) -> str:
    """Type text at the current cursor position. interval = seconds between keystrokes."""
    pyautogui.typewrite(text, interval=interval)
    return f"Typed {len(text)} characters"


@mcp.tool()
def key(hotkey: str) -> str:
    """Press a key or key combination. Examples: enter, ctrl+c, alt+f4, win, ctrl+shift+esc, f5, escape, tab, backspace."""
    if "+" in hotkey:
        parts = [p.strip() for p in hotkey.split("+")]
        pyautogui.hotkey(*parts)
    else:
        pyautogui.press(hotkey)
    return f"Pressed: {hotkey}"


@mcp.tool()
async def hold_key(key_name: str, duration: float = 0.5) -> str:
    """Hold a key for a duration then release. Useful for held modifier keys."""
    pyautogui.keyDown(key_name)
    await asyncio.sleep(duration)
    pyautogui.keyUp(key_name)
    return f"Held '{key_name}' for {duration}s"


# ── Clipboard ──────────────────────────────────────────────────────────────────

@mcp.tool()
def read_clipboard() -> str:
    """Read the current clipboard text content."""
    return pyperclip.paste()


@mcp.tool()
def write_clipboard(text: str) -> str:
    """Write text to the clipboard."""
    pyperclip.copy(text)
    return "Clipboard updated"


# ── Applications ───────────────────────────────────────────────────────────────

@mcp.tool()
def open_application(name: str) -> str:
    """Launch an application by executable name (e.g. notepad, chrome) or full path."""
    try:
        if os.path.isabs(name) and os.path.exists(name):
            subprocess.Popen([name])
        else:
            subprocess.Popen(["cmd", "/c", "start", "", name])
        return f"Launched: {name}"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def list_granted_applications() -> str:
    """List currently running processes / open applications."""
    procs = []
    for p in psutil.process_iter(["pid", "name", "status"]):
        try:
            procs.append(f"{p.info['pid']:6}  {p.info['name']}")
        except Exception:
            pass
    return "\n".join(procs[:150])


# ── Utilities ──────────────────────────────────────────────────────────────────

@mcp.tool()
async def wait(seconds: float) -> str:
    """Wait for the specified number of seconds."""
    await asyncio.sleep(seconds)
    return f"Waited {seconds}s"


@mcp.tool()
def find_on_screen(image_b64: str, confidence: float = 0.8) -> str:
    """Find a template image on screen. Pass base64 PNG. Returns center (x,y) if found."""
    img_data = base64.b64decode(image_b64)
    needle = Image.open(io.BytesIO(img_data))
    try:
        loc = pyautogui.locate(needle, pyautogui.screenshot(), confidence=confidence)
        if loc:
            cx, cy = pyautogui.center(loc)
            return f'{{"found": true, "x": {cx}, "y": {cy}}}'
        return '{"found": false}'
    except Exception as e:
        return f'{{"found": false, "error": "{e}"}}'


@mcp.tool()
def run_powershell(script: str, timeout: int = 30) -> str:
    """Run a PowerShell script/command. Returns stdout, stderr, and exit code."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, timeout=timeout
        )
        return f"exit_code: {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    except subprocess.TimeoutExpired:
        return f"Timed out after {timeout}s"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
async def computer_batch(actions: list) -> str:
    """Run multiple computer-use actions in one call. Each action: {tool: str, input: dict}. No round-trips."""
    results = []
    for action in actions:
        tool_name = action.get("tool", "")
        inp = action.get("input", {})
        try:
            fn = globals().get(tool_name)
            if fn is None:
                results.append(f"[{tool_name}] unknown tool")
                continue
            result = fn(**inp)
            if asyncio.iscoroutine(result):
                result = await result
            if isinstance(result, list):
                results.append(f"[{tool_name}] <image>")
            else:
                results.append(f"[{tool_name}] {str(result)[:200]}")
        except Exception as e:
            results.append(f"[{tool_name}] ERROR: {e}")
    return "\n".join(results)


if __name__ == "__main__":
    mcp.run(transport="stdio")
