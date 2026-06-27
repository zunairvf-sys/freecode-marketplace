---
name: canvas-design
description: >
  Create visual designs, posters, social media graphics, and branded visual content
  as PNG or PDF files using Python Pillow canvas drawing. Triggers: "design a poster",
  "create a graphic", "social media post design", "visual design", "make a banner",
  "create a flyer", "design an image", "canvas art", "PNG design", "visual content",
  "make a logo concept", "create visual", "poster design", "flyer design". Use this
  skill whenever the user wants to create visual graphic designs, posters, banners,
  or any visual content that needs to be exported as PNG/PDF. Make sure to invoke
  this skill for any request involving graphic design or visual content creation.
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

# Canvas Design

A skill for creating visual designs, posters, and graphics using Python Pillow (PIL) with a bundled font library.

## File Locations

This skill is installed under the FreeCode plugins directory. All bundled resources are relative to the skill directory:

```
~/.freecode/plugins/canvas-design/
├── .FREECODE-plugin/
│   └── plugin.json
└── skills/
    └── canvas-design/
        ├── SKILL.md                ← This file
        ├── canvas-fonts/           ← 54 bundled TTF font files
        │   ├── InstrumentSans-Bold.ttf
        │   ├── Lora-Regular.ttf
        │   ├── EricaOne-Regular.ttf
        │   └── ... (51 more fonts)
        └── references/
            └── fonts.md            ← Complete font library reference
```

**Important:** When writing Python scripts, use the full path to fonts:
```python
font = ImageFont.truetype('C:/Users/<username>/.freecode/plugins/canvas-design/skills/canvas-fonts/InstrumentSans-Bold.ttf', 72)
```

On Unix-style systems:
```python
font = ImageFont.truetype('/home/<username>/.freecode/plugins/canvas-design/skills/canvas-fonts/InstrumentSans-Bold.ttf', 72)
```

Use `os.path.expanduser('~/.freecode/plugins/canvas-design/skills/canvas-fonts/')` to resolve the font directory portably.

## What This Skill Does

Creates high-quality PNG and PDF visual designs programmatically using Python's Pillow library. Outputs are pixel-perfect, resolution-independent graphics suitable for social media, presentations, posters, and branded content.

## Available Tools

- **Python Pillow (PIL)** — Image creation, drawing, text rendering, compositing, filters
- **54 bundled fonts** — See `references/fonts.md` for the complete font list
- **Python** — Full access to Pillow API for canvas operations

## Font Library

54 Google Fonts are bundled in `canvas-fonts/`. Key fonts by category:

**Headlines/Display:** EricaOne, InstrumentSans Bold, Outfit Bold, PoiretOne, YoungSerif
**Body/Text:** Lora, InstrumentSerif, CrimsonPro, NationalPark, WorkSans
**Mono/Code:** DMMono, GeistMono, IBMPlexMono, JetBrainsMono, RedHatMono
**Decorative:** BigShoulders, Boldonse, Gloock, NothingYouCouldDo, PixelifySans, Silkscreen
**Geometric:** BricolageGrotesque, InstrumentSans, SmoochSans, Tektur

See `references/fonts.md` for the complete list with weights/styles.

## Design Workflow

### 1. Understand Requirements
- Ask about dimensions (social media post? banner? poster?)
- Brand colors, fonts, mood
- Content hierarchy (headline, body, call-to-action)
- Any visual references

### 2. Design Planning
Plan the layout:
- Background (solid color, gradient, pattern, image)
- Text placement and hierarchy
- Visual elements (shapes, lines, icons)
- Margins and padding

### 3. Implementation

Write a Python script that creates the design using Pillow:

```python
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

# Setup canvas
width, height = 1080, 1080  # common dimensions
canvas = Image.new('RGB', (width, height), color='#faf9f5')
draw = ImageDraw.Draw(canvas)

# Load fonts
font_path = 'canvas-fonts/InstrumentSans-Bold.ttf'
title_font = ImageFont.truetype(font_path, 72)
body_font = ImageFont.truetype('canvas-fonts/Lora-Regular.ttf', 32)

# Draw elements
draw.rectangle([(0, 0), (width, height)], fill='#141413')
draw.text((100, 400), 'YOUR TITLE', fill='#d97757', font=title_font)
draw.text((100, 520), 'Body text here', fill='#b0aea5', font=body_font)

# Save
canvas.save('output.png', 'PNG')
```

### 4. Common Patterns

**Gradients:**
```python
def gradient_bg(width, height, top_color, bottom_color):
    img = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        ratio = y / height
        r = int(top_color[0] * (1-ratio) + bottom_color[0] * ratio)
        g = int(top_color[1] * (1-ratio) + bottom_color[1] * ratio)
        b = int(top_color[2] * (1-ratio) + bottom_color[2] * ratio)
        draw.line([(0,y), (width,y)], fill=(r,g,b))
    return img
```

**Text alignment:**
```python
def text_bbox(draw, text, font):
    return draw.textbbox((0, 0), text, font=font)

# Center text
bbox = text_bbox(draw, text, font)
w = bbox[2] - bbox[0]
x = (canvas.width - w) // 2
draw.text((x, y), text, fill=color, font=font)
```

**Shapes:**
```python
# Circle
draw.ellipse([(x-r, y-r), (x+r, y+r)], fill=color)

# Rounded rectangle (via crop of circle)
# Draw polygon
draw.polygon(points, fill=color, outline=outline_color, width=2)
```

**Image compositing:**
```python
canvas.paste(background_image, (0, 0))
canvas.paste(overlay, (x, y), mask=overlay)  # with transparency mask
```

## Design System

Default FreeCode brand colors:
- Dark: `#141413`
- Light: `#faf9f5`
- Mid-gray: `#b0aea5`
- Light-gray: `#e8e6dc`
- Orange: `#d97757`
- Blue: `#6a9bcc`
- Green: `#788c5d`

## Standard Dimensions

| Format | Size |
|---|---|
| Social media post (square) | 1080 × 1080 |
| Social media post (portrait) | 1080 × 1350 |
| Twitter/X header | 1500 × 500 |
| YouTube thumbnail | 1280 × 720 |
| Presentation slide | 1920 × 1080 |
| Business card | 1050 × 600 (3.5" × 2" at 300dpi) |
| Poster (A4) | 2480 × 3508 (at 300dpi) |

## Output

Save as PNG for web/digital use. For print-ready output, save as PDF:
```python
canvas.save('output.pdf', 'PDF', resolution=300)
```

## Tips

- Always specify font size — default fonts are tiny
- Use `draw.textbbox()` to measure text before positioning
- Build layers: background -> shapes -> text -> overlays
- Preview at scale — what looks good at 1080px may need adjustment at poster size
- Keep text within safe margins (5-10% from edges)

## Font Reference

See `references/fonts.md` for the complete font library.

## Remember

- The font files are relative to the skill directory at `canvas-fonts/<filename>.ttf`
- When the user specifies a font name, match it to the closest available font
- Always use `ImageFont.truetype()` — never use `ImageFont.load_default()` for production designs
- Run the Python script with Bash to generate the actual output file
- Show the user the output file path so they can view it
