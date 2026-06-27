---
name: algorithmic-art
description: >
  Create generative algorithmic art as interactive p5.js HTML artifacts with seeded
  randomness, parameter controls, and export. Triggers: "generative art", "algorithmic
  art", "p5.js art", "visual art", "creative coding", "interactive art", "art blocks",
  "generative design", "abstract art generation", "pattern generation", "make generative
  art", "create algorithmic art", "art generator", "seeded art", "procedural art".
  Use this skill whenever the user wants to create visual generative art, interactive
  art pieces, or explore algorithmic visual patterns. Make sure to invoke this skill
  for any request involving generative or algorithmic visual art creation.
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
  - render_widget
  - WebFetch
---

# Algorithmic Art

A skill for creating generative algorithmic art as self-contained interactive HTML artifacts using p5.js.

## File Locations

This skill is installed under the FreeCode plugins directory. When invoked, resolve bundled resources relative to this skill's directory:

```
~/.freecode/plugins/algorithmic-art/
├── .FREECODE-plugin/
│   └── plugin.json
└── skills/
    └── algorithmic-art/
        ├── SKILL.md                 ← This file
        └── templates/
            ├── generator_template.js  ← p5.js best practices template
            └── viewer_template.html   ← Full HTML viewer with UI controls
```

To read a bundled template:
```
~/.freecode/plugins/algorithmic-art/skills/algorithmic-art/templates/generator_template.js
~/.freecode/plugins/algorithmic-art/skills/algorithmic-art/templates/viewer_template.html
```

**Important:** The LLM does not automatically know where plugin files are installed. Always use the full path shown above when reading templates or scripts. Relative paths like `templates/` will not resolve correctly — construct the full path from the skill's install location.

## Core Philosophy

Every piece of algorithmic art starts with a concept — an artistic vision expressed as an algorithm. Your job is to translate the user's creative intent into a living, breathing visual system that can be explored through parameters.

## Workflow

### Phase 1: Artistic Direction

1. Discuss the concept with the user. Ask:
   - What mood or feeling should the piece evoke?
   - Any visual references or styles they admire?
   - Static image or animated?
   - Color palette preferences?

2. Write a brief "Algorithmic Philosophy" document that captures:
   - The core visual metaphor
   - Key algorithmic choices
   - Parameter exploration space

### Phase 2: Implementation

3. Use the bundled templates as your starting point:
   - `templates/generator_template.js` — p5.js best practices and utility functions
   - `templates/viewer_template.html` — Full HTML viewer with UI controls, seed navigation, and export

4. Key implementation principles:
   - **Seeded randomness**: Always use `randomSeed(seed)` and `noiseSeed(seed)` for reproducibility
   - **Parameter object**: Keep all tunable values in a single `params` object
   - **Clean separation**: `update()` logic separate from `display()` logic
   - **Performance**: Pre-calculate where possible, limit expensive operations

5. The generated HTML artifact should include:
   - Canvas area for the art
   - Sidebar with parameter controls (sliders, color pickers, etc.)
   - Seed navigation (previous/next seed buttons + current seed display)
   - Regenerate button
   - Export button (saves as PNG)
   - Clean, branded UI

### Phase 3: Iteration

6. Present the artifact to the user using `render_widget` or saving as an HTML file
7. Gather feedback and iterate on parameters, algorithm, or visual design
8. Each iteration is a new version with a new seed

## Algorithmic Patterns

Draw from these proven patterns when designing your algorithm:

- **Particle systems**: Agents moving through space, leaving trails
- **Flow fields**: Perlin noise guiding particle movement
- **Recursive fractals**: Self-similar branching structures
- **Tessellation**: Tiling patterns with variation
- **Vector fields**: Direction fields rendered as lines or particles
- **Growth systems**: Organic growth from rules (L-systems, cellular automata)
- **Swarm behavior**: Emergent patterns from simple agent rules
- **Reaction-diffusion**: Chemical simulation patterns

## Parameter Design

Parameters should be:

- **Meaningful**: Each should noticeably affect the output
- **Explorable**: Range should produce interesting variation
- **Named clearly**: "branchAngle" not "ba" or "theta"

Common parameter categories:

- Counts (particles, elements, branches)
- Scales (size, speed, spacing)
- Probabilities (event likelihood)
- Angles (rotation, direction)
- Colors (palette, gradients)

## Output

Always produce a complete, self-contained HTML file. Include:

- p5.js library (from CDN: `https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js`)
- Embedded CSS for clean UI
- Embedded JavaScript with the generative algorithm
- Parameter controls in a sidebar
- Seed controls for exploration
- Export functionality

## Templates Reference

Use the bundled templates as your starting point. **Read them using full paths:**

```
~/.freecode/plugins/algorithmic-art/skills/algorithmic-art/templates/generator_template.js
~/.freecode/plugins/algorithmic-art/skills/algorithmic-art/templates/viewer_template.html
```

After reading, adapt the template — don't copy verbatim. Modify parameters, controls, and algorithm to match each unique piece.

**Output artifacts:** The generated HTML may include the p5.js CDN script tag (`https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js`) — this is for the user's browser to load p5.js when they open the file. The output artifact is self-contained and runs locally in the browser.

## Examples

### Example 1: Flow Field Particles

```javascript
let params = {
  seed: 42,
  particleCount: 2000,
  speed: 1.5,
  noiseScale: 0.008,
  trailOpacity: 15,
  colorPalette: ['#d97757', '#6a9bcc', '#788c5d', '#b0aea5']
};
```

### Example 2: Recursive Branching Tree

```javascript
let params = {
  seed: 123,
  branchLength: 120,
  branchAngle: 25,
  branchDepth: 10,
  lengthDecay: 0.7,
  colorPalette: ['#5a3e28', '#788c5d', '#b0aea5']
};
```

---

## Technical Reference

See `templates/generator_template.js` for p5.js best practices, utility functions, and patterns.

## Remember

- The art is guided by the user's vision, not by the template
- Parameters should feel alive and responsive — small changes should produce visible, interesting differences
- Always seed your randomness for reproducibility
- Every piece should be exportable as a clean PNG

Good luck creating beautiful generative art!
