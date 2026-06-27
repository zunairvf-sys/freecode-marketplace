---
name: slack-gif-creator
description: >
  Create polished animated GIFs with text, transitions, and easing — optimized for Slack,
  Discord, and other chat platforms. Triggers: "create a GIF", "make an animated gif",
  "slack gif", "animated reaction", "gif with text", "celebration gif", "announcement gif",
  "animated message", "gif animation", "text animation". Use this skill whenever the user
  wants to create animated GIFs with custom text, transitions, or animations for sharing
  in chat platforms. Make sure to invoke this skill for any request involving GIF creation.
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

# Slack GIF Creator

A skill for creating polished animated GIFs with smooth transitions and professional text animations.

## File Locations

This skill is installed under the FreeCode plugins directory. All bundled resources are relative to the skill directory:

```
~/.freecode/plugins/slack-gif-creator/
├── .FREECODE-plugin/
│   └── plugin.json
└── skills/
    └── slack-gif-creator/
        ├── SKILL.md              ← This file
        └── core/
            ├── gif_builder.py    ← Main GIF builder with frame rendering
            ├── easing.py         ← Easing functions for smooth animations
            ├── frame_composer.py ← Frame composition and layout
            └── validators.py     ← Slack GIF size/dimension validators
```

**Important:** When importing core modules in your Python scripts, use the full path:
```python
import sys
sys.path.append(os.path.expanduser('~/.freecode/plugins/slack-gif-creator/skills/slack-gif-creator/core'))
from gif_builder import GifBuilder
```

On Windows:
```python
sys.path.append(r'C:\Users\<username>\.freecode\plugins\slack-gif-creator\skills\slack-gif-creator\core')
```

## What This Skill Does

Creates smooth, professional animated GIFs optimized for chat platforms. Supports:
- Text animations (fade-in, typewriter, bounce, scale)
- Color transitions and gradient backgrounds
- Smooth easing curves (ease-in, ease-out, ease-in-out)
- Multi-frame compositions with layered text
- Platform-specific optimization (Slack: 10MB max, Discord: 10MB/MB)

## Dependencies

- **Python Pillow (PIL)** — `pip install Pillow`
- **Python imageio** — `pip install imageio` (optional, for better GIF optimization)

## Core Components

### GifBuilder (`core/gif_builder.py`)

Main entry point. Creates animated GIFs with frame-by-frame rendering.

```python
from gif_builder import GifBuilder

builder = GifBuilder(width=480, height=270, fps=24)

# Add a text animation
builder.add_text_animation(
    text="Hello World!",
    x=240, y=135,
    font_path="path/to/font.ttf",
    font_size=48,
    color=(217, 119, 87),
    animation="fade_in",
    duration=30  # frames
)

# Build and save
builder.save("output.gif", optimization_passes=2)
```

### Easing Functions (`core/easing.py`)

Smooth animation curves. Available easings:
- `linear` — constant speed
- `ease_in` — starts slow, accelerates
- `ease_out` — starts fast, decelerates
- `ease_in_out` — slow start and end, fast middle
- `bounce` — elastic bounce effect

```python
from easing import ease_in, ease_out, ease_in_out, bounce

# Position over 60 frames
for frame in range(60):
    t = frame / 59  # normalize to 0-1
    y = 100 + int(200 * ease_out(t))
```

### Frame Composer (`core/frame_composer.py`)

Handles layer composition and layout within each frame.

```python
from frame_composer import FrameComposer

composer = FrameComposer(width=480, height=270, bg_color=(20, 20, 19))

# Add background gradient
composer.add_gradient_bg(top_color=(20, 20, 19), bottom_color=(40, 40, 39))

# Add text layer
composer.add_text("Title", x=240, y=100, font=font, color=(217, 119, 87), anchor="center")

# Render frame
frame = composer.render()
```

### Validators (`core/validators.py`)

Ensures GIFs meet platform requirements.

```python
from validators import validate_slack_gif, validate_discord_gif

# Check before saving
issues = validate_slack_gif("output.gif")
if issues:
    for issue in issues:
        print(f"Warning: {issue}")
```

**Slack limits:**
- Max file size: 10MB
- Max dimensions: 480px width (Slack resizes wider GIFs)
- Recommended: 480×270 or smaller

## Design Workflow

### 1. Understand Requirements
- What should the GIF say?
- What mood/animation style? (celebratory, informative, subtle, bold)
- Target platform? (Slack, Discord, general)

### 2. Plan the Animation
- Frame count and duration
- Animation type (fade, typewriter, bounce, scale, slide)
- Color palette and background
- Text layout

### 3. Build the Script

```python
#!/usr/bin/env python
import os
import sys
sys.path.append(os.path.expanduser('~/.freecode/plugins/slack-gif-creator/skills/slack-gif-creator/core'))

from gif_builder import GifBuilder
from PIL import ImageFont

builder = GifBuilder(480, 270, fps=24)

# Load a font
font = ImageFont.truetype(os.path.expanduser("~/.freecode/plugins/canvas-design/skills/canvas-fonts/InstrumentSans-Bold.ttf"), 48)

# Add animated text
builder.add_text_animation(
    text="🎉 Great Work! 🎉",
    x=240, y=135,
    font=font,
    font_size=48,
    color=(217, 119, 87),
    animation="fade_in",
    duration=30,
    anchor="center"
)

# Save optimized GIF
builder.save("celebration.gif", optimization_passes=2)
```

### 4. Run and Deliver
Execute the script with Bash and show the user the output GIF path.

## Common Animation Patterns

### Fade In
Text gradually appears from transparent to solid.

### Typewriter
Characters appear one at a left to right.

### Bounce
Text bounces into place with elastic easing.

### Scale
Text scales up from small to full size.

### Slide
Text slides in from left, right, top, or bottom.

## Tips

- Keep GIFs under 10MB for Slack compatibility
- Use 480px width maximum — Slack auto-resizes wider GIFs
- 24fps is a good balance between smoothness and file size
- Use `optimization_passes=2` to reduce file size
- For longer animations, reduce fps to 15 to save space
- Test the GIF in Slack before distributing

## Remember

- Core scripts are in `core/` — always use full paths when importing
- Use `validate_slack_gif()` before delivering final GIFs
- Always show the user the output file path
- Offer to adjust dimensions or frame count if the GIF is too large
