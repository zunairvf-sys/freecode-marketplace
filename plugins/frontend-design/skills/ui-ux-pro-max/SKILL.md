---
name: ui-ux-pro-max
description: UI/UX design intelligence for web and mobile. Searchable local database with 84 styles, 192 color palettes, 74 font pairings, 192 product types, 98 UX guidelines, 104 icon entries, 16 GSAP motion presets, and 25 chart types across 22 stacks (React, Next.js, Vue, Nuxt, Svelte, Astro, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui, Jetpack Compose, Angular, Laravel, JavaFX, WPF, WinUI, Avalonia, Uno Platform, UWP, Three.js, and HTML/CSS). Use when designing, building, or reviewing UI: pages, components, color schemes, typography, layout, accessibility, animation, or data visualization.
---

# UI/UX Pro Max - Design Intelligence

Searchable database of UI/UX design rules with priority-based recommendations: 84 styles, 192 color palettes, 74 font pairings, 192 product types with reasoning rules, 98 UX guidelines, 104 icon entries, 16 GSAP motion presets, and 25 chart types across 22 technology stacks.

## When to Apply

Use this skill when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**: designing new pages, creating/refactoring UI components, choosing color/typography/spacing/layout systems, reviewing UI for UX/accessibility/consistency, implementing navigation/animation/responsive behavior, or improving perceived quality and usability.

Skip it for pure backend logic, API/database design, non-visual performance work, infrastructure/DevOps, or non-visual scripts — unless the task changes how something **looks, feels, moves, or is interacted with**.

---

## Mandatory Pre-Code Gate (READ BEFORE WRITING ANY CODE)

This is a hard gate, not a suggestion. Do not write a single line of component/page/style code until Steps A–C below are complete. This applies every time the skill is invoked in a fresh session — reference files are cheap to read and stale assumptions are expensive to unwind.

### Step A — Bootstrap the reference files if they don't exist

`references/quick-reference.md` and `references/pro-rules.md` are not shipped pre-written in every install. If either is missing:

1. Run the full domain dump for each priority category (accessibility, touch, style, layout, typography, color, animation, forms, navigation, chart) using `--domain <domain> -n 50` (or the closest the script supports) against `search.py`.
2. Write the consolidated output to `references/quick-reference.md`, organized under the same 10 priority headers used in the table below (one section per category, full rule text — not summarized, not truncated).
3. Run the app-specific query set (icon discipline, touch feedback, dark-mode contrast, safe-area layout, accessibility) and write it to `references/pro-rules.md`, ending with a canonical Pre-Delivery Checklist section.
4. These two files are now part of the project — do not regenerate them on every task. Only regenerate if the person explicitly asks for a refresh, or if `search.py`'s underlying data version has changed (check `skill.json`/CLI version if present).

If both files already exist, skip straight to Step B.

### Step B — Read both reference files in full

- `view` `references/quick-reference.md` in its entirety.
- `view` `references/pro-rules.md` in its entirety.

Do not rely on the priority-table summary further down in this document as a substitute — that table is a routing aid, not the rule content itself.

### Step C — Read FreeCode's own project memory before applying any of it

The UI database has no idea what FreeCode's design system already decided. Before generating or reviewing UI:

1. Read `${FREECODE_PLUGIN_ROOT}/.freecode/FREECODE.md` (loads every turn already, but re-confirm it's in context).
2. Read `${FREECODE_PLUGIN_ROOT}/.freecode/PROJECT_FACTS.md` and `${FREECODE_PLUGIN_ROOT}/.freecode/DESIGN.md` if present — these carry FreeCode's actual settled decisions (e.g. signal teal `#5EEAD4` accent, glassmorphism scoped to chrome only, sharp corners, no rounded bubbles, sidepanel width 320–420px).
3. Read `${FREECODE_PLUGIN_ROOT}/.freecode/CORRECTIONS.md` if present — this is where past wrong turns (including past UI mistakes) get recorded so they aren't repeated.
4. **FreeCode's own `DESIGN.md` / `PROJECT_FACTS.md` always wins over a generic recommendation from this skill's database.** If the design system suggests something that conflicts with an already-settled FreeCode decision (e.g. suggesting rounded corners for a "Claymorphism" style match), the settled decision wins — flag the conflict to the person rather than silently overriding either one.
5. If `DESIGN.md` doesn't exist yet and this is a new design decision (new component category, new page type, first design-system run for this project), that's a signal to *create* `DESIGN.md` with the output of Step D below, not just leave it in this skill's own `design-system/` folder disconnected from FreeCode's memory.

Only once A, B, and C are done should Step D (generation) begin.

### Step D — Generate, and write settled decisions back to FreeCode's memory

After running `--design-system` (see Workflow below) and settling on a direction with the person:

1. Persist the raw output via `--persist --output-dir` as normal (Step 2b below).
2. Additionally append a short, concrete summary of the settled decision (palette, typography, style name, spacing dial, anti-patterns to avoid for this project) to `${FREECODE_PLUGIN_ROOT}/.freecode/DESIGN.md`, following the entry style already used there — specific and actionable, not vague ("use signal teal `#5EEAD4` as accent, sharp corners only" not "make it look modern").
3. Do not duplicate an existing `DESIGN.md` entry — extend or update it if the topic already has one.

This closes the loop: FreeCode's memory system (`FREECODE.md`/`PROJECT_FACTS.md`/`DESIGN.md`/`CORRECTIONS.md`) is the durable, cross-session source of truth; this skill's `references/` and `design-system/` folders are the on-disk working data that feeds it.

---

## Rule Categories by Priority

*Follow priority 1→10 to decide which category to focus on first; use `--domain <domain>` to query full details. Full rule text for every category lives in `references/quick-reference.md` (see Mandatory Pre-Code Gate above — read it in full, don't rely on this summary table alone).*

| Priority | Category            | Impact   | Domain                | Key Checks (Must Have)                                                | Anti-Patterns (Avoid)                                                |
| -------- | -------------------- | -------- | ---------------------- | ----------------------------------------------------------------------| ---------------------------------------------------------------------|
| 1        | Accessibility        | CRITICAL | `ux`                   | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels                    | Removing focus rings, Icon-only buttons without labels                |
| 2        | Touch & Interaction  | CRITICAL | `ux`                   | Min size 44x44px, 8px+ spacing, Loading feedback                       | Reliance on hover only, Instant state changes (0ms)                   |
| 3        | Performance          | HIGH     | `ux`                   | WebP/AVIF, Lazy loading, Reserve space (CLS < 0.1)                     | Layout thrashing, Cumulative Layout Shift                             |
| 4        | Style Selection      | HIGH     | `style`, `product`     | Match product type, Consistency, SVG icons (no emoji)                  | Mixing flat & skeuomorphic randomly, Emoji as icons, generic AI purple/blue gradients unless the palette was chosen deliberately |
| 5        | Layout & Responsive  | HIGH     | `ux`                   | Mobile-first breakpoints, Viewport meta, No horizontal scroll          | Horizontal scroll, Fixed px container widths, Disable zoom            |
| 6        | Typography & Color   | MEDIUM   | `typography`, `color`  | Base 16px, Line-height 1.5, Semantic color tokens                      | Text < 12px body, Gray-on-gray, Raw hex in components                 |
| 7        | Animation            | MEDIUM   | `ux`, `gsap`           | Duration 150-300ms, Motion conveys meaning, Spatial continuity         | Decorative-only animation, Animating width/height, No reduced-motion  |
| 8        | Forms & Feedback     | MEDIUM   | `ux`                   | Visible labels, Error near field, Helper text, Progressive disclosure  | Placeholder-only label, Errors only at top, Overwhelm upfront         |
| 9        | Navigation Patterns  | HIGH     | `ux`                   | Predictable back, Bottom nav <=5, Deep linking                         | Overloaded nav, Broken back behavior, No deep links                   |
| 10       | Charts & Data        | LOW      | `chart`                | Legends, Tooltips, Accessible colors                                   | Relying on color alone to convey meaning                              |

---

## Running the Search Tool

The search script lives inside this skill's own directory, not the project directory. Always invoke it by its full path — do not assume a particular working directory:

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain <domain>
```

If `python` is not found, try `python3`, then `py -3`. Requires Python 3.x, no external dependencies.

## Workflow

### Step 1: Analyze User Requirements

Extract from the user request:

- **Product type**: SaaS, e-commerce, portfolio, dashboard, entertainment, tool, productivity, or hybrid
- **Target audience & context**: age group, usage context (commute, leisure, work)
- **Style keywords**: playful, vibrant, minimal, dark mode, content-first, immersive, etc.
- **Stack**: detect from the project — check `package.json` deps (react/next/vue/svelte/nuxt/@angular), `pubspec.yaml` (Flutter), `*.xcodeproj`/`Package.swift` (SwiftUI), `composer.json` (Laravel), or React Native markers (`app.json` + `react-native` dep). If nothing is detectable, ask the user or default to `html-tailwind`. **Never assume a stack** — a hardcoded default silently misroutes every recommendation.

### Step 2: Generate Design System (REQUIRED for new pages/projects)

Always start with `--design-system` to get comprehensive recommendations with reasoning:

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

This searches product/style/color/landing/typography domains in parallel, applies reasoning rules from `ui-reasoning.csv`, and returns pattern, style, colors, typography, effects, and anti-patterns to avoid.

**Example:**

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "fuel forecourt operator dashboard enterprise SaaS" --design-system -p "OpsInsight 365"
```

### Step 2b: Persist Design System (Master + Overrides Pattern)

To save the design system for retrieval across sessions, add `--persist` **and always pass `--output-dir` pointed at the project root** — without it, files are written relative to whatever directory the tool happens to run from:

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<query>" --design-system --persist -p "Project Name" --output-dir "<project-root>"
```

This creates:

- `design-system/<project-slug>/MASTER.md` — Global Source of Truth
- `design-system/<project-slug>/pages/` — Folder for page-specific overrides

With a page-specific override, add `--page "dashboard"` to also create `design-system/<project-slug>/pages/dashboard.md`.

If `design-system/<project-slug>/MASTER.md` already exists, `--persist` **skips writing and leaves it untouched** unless you also pass `--force` — check whether it exists first (and read it) before regenerating, so you don't silently discard prior decisions.

**Retrieval when building a specific page:**

1. Read `${FREECODE_PLUGIN_ROOT}/.freecode/DESIGN.md` first (FreeCode's own settled decisions — see Step C above).
2. Then read `design-system/<project-slug>/MASTER.md`.
3. Check if `design-system/<project-slug>/pages/<page-name>.md` exists — if so, its rules override Master.
4. Otherwise use Master rules exclusively.
5. If `DESIGN.md` conflicts with Master or the page override, `DESIGN.md` wins (see Step C.4).

### Step 2c: Design Dials (optional)

Three optional 1-10 sliders that tune `--design-system` output without changing your query. Add any combination of them to the same command:

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<query>" --design-system --variance <1-10> --motion <1-10> --density <1-10>
```

| Dial         | Low (1-3)                                                       | Mid (4-7)                            | High (8-10)                                               |
| ------------ | ---------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------|
| `--variance` | Centered / minimal (biases toward Minimalism-style categories)   | Balanced / modern                     | Bold / asymmetric (biases toward Brutalism, Bento Grids)  |
| `--motion`   | Subtle micro-interactions                                        | Standard scroll/stagger motion        | Complex choreography (pin, Flip, SplitText)                |
| `--density`  | Spacious (24-96px spacing scale)                                  | Standard (16-64px, current default)   | Dense/dashboard (8-32px spacing scale)                     |

- `--motion` attaches a ready-to-use GSAP snippet (with framework notes, Do/Don't, and performance notes) pulled from `--domain gsap`, matched to the resolved tier (Subtle/Standard/Complex).
- `--density` overrides the `--space-*` CSS variable table in the ASCII/markdown/MASTER.md output — use it for dashboards (high) vs. marketing pages (low) without hand-editing tokens.
- Leaving a dial unset keeps that part of the output exactly as it was before (no behavior change).

**Example:**

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "internal fuel operations analytics dashboard" --design-system --variance 8 --motion 7 --density 8 -p "OpsInsight Console"
```

### Step 3: Supplement with Detailed Searches (as needed)

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<keyword>" --domain <domain> [-n <max_results>]
```

| Need                             | Domain         | Example                                                |
| --------------------------------- | -------------- | ------------------------------------------------------- |
| Product type patterns             | `product`      | `--domain product "entertainment social"`               |
| More style options                 | `style`        | `--domain style "glassmorphism dark"`                   |
| Color palettes                     | `color`        | `--domain color "enterprise saas"`                       |
| Font pairings                      | `typography`   | `--domain typography "modern sans"`                      |
| Individual Google Fonts             | `google-fonts` | `--domain google-fonts "sans serif popular variable"`    |
| Chart recommendations              | `chart`        | `--domain chart "real-time dashboard"`                    |
| UX best practices                  | `ux`           | `--domain ux "animation accessibility"`                   |
| Landing page structure             | `landing`      | `--domain landing "hero social-proof"`                    |
| Icon recommendations                | `icons`        | `--domain icons "navigation outline"`                     |
| GSAP animation presets              | `gsap`         | `--domain gsap "scroll reveal stagger"`                   |
| React/Next.js performance           | `react`        | `--domain react "rerender memo list"`                     |
| App/native interface guidelines     | `web`          | `--domain web "accessibilityLabel touch safe-areas"`      |

Domain is auto-detected from the query if `--domain` is omitted — but auto-detection can misroute overlapping terms (e.g. "font" matches both `typography` and `google-fonts`). If results look off-topic, pass `--domain` explicitly.

### Step 4: Stack Guidelines

```
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "<keyword>" --stack <stack>
```

**Available stacks:** `react`, `nextjs`, `vue`, `svelte`, `astro`, `nuxtjs`, `nuxt-ui`, `angular`, `laravel`, `swiftui`, `react-native`, `flutter`, `jetpack-compose`, `html-tailwind`, `shadcn`, `threejs`, `javafx`, `wpf`, `winui`, `avalonia`, `uno`, `uwp`. Use the stack detected in Step 1.

---

## If a Search Returns 0 Results

Do not fabricate output. Instead:

1. Retry once with broader or differently-worded keywords (try product + style separately rather than combined).
2. If still empty, fall back to the priority table above and say explicitly that this recommendation came from built-in defaults, not a database match (e.g. "no palette match for X, using general SaaS defaults").
3. Never present a 0-result search as if it returned data.

## Example Workflow

**User request:** "Make a dashboard for tank monitoring." (stack detected as React from `package.json`)

```
# Step A/B/C: bootstrap + read references, then read FreeCode's own DESIGN.md/PROJECT_FACTS.md
# (only bootstrap references/*.md if they don't already exist — see Mandatory Pre-Code Gate)

# Step 2: design system
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "fuel forecourt tank monitoring dashboard industrial" --design-system -p "Tank Monitor"

# Step 3: supplement
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "real-time gauge alert states" --domain ux

# Step 4: stack guidelines
python "${FREECODE_PLUGIN_ROOT}/.freecode/skills/ui-ux-pro-max/scripts/search.py" "rerender memo list" --stack react

# Step D: write the settled palette/typography/style decision back to
# ${FREECODE_PLUGIN_ROOT}/.freecode/DESIGN.md so future sessions don't re-derive it
```

Then synthesize the design system + detailed searches + FreeCode's own settled decisions, and implement.

## Output Formats

`--design-system` supports `-f ascii` (default, terminal display), `-f markdown` (documentation), and `--json` (machine-readable, includes the raw design system dict plus persistence status).

## Tips for Better Results

- Use **multi-dimensional keywords** — combine product + industry + tone + density: `"enterprise saas dense dashboard"`, not just `"app"`
- Try different phrasings for the same need: `"industrial dark"` → `"dense dashboard"` → `"content-first minimal"`
- Use `--design-system` first for full recommendations, then `--domain` to deep-dive any dimension you're unsure about
- Pass the detected stack explicitly for implementation-specific guidance

| Problem                          | What to Do                                                                                            |
| ---------------------------------| ------------------------------------------------------------------------------------------------------|
| Can't decide on style/color      | Re-run `--design-system` with different keywords                                                       |
| Dark mode contrast issues        | `references/quick-reference.md` §6: `color-dark-mode` + `color-accessible-pairs`                       |
| Animations feel unnatural        | `references/quick-reference.md` §7: `spring-physics` + `easing` + `exit-faster-than-enter`              |
| Form UX is poor                  | `references/quick-reference.md` §8: `inline-validation` + `error-clarity` + `focus-management`         |
| Navigation feels confusing       | `references/quick-reference.md` §9: `nav-hierarchy` + `bottom-nav-limit` + `back-behavior`               |
| Layout breaks on small screens   | `references/quick-reference.md` §5: `mobile-first` + `breakpoint-consistency`                           |
| Performance / jank               | `references/quick-reference.md` §3: `virtualize-lists` + `main-thread-budget` + `debounce-throttle`     |

## Before Delivering App UI

Read `references/pro-rules.md` (already required in full under the Mandatory Pre-Code Gate above — this is a second, final pass, not the first read) and run through its canonical Pre-Delivery Checklist. It covers icon/visual-element discipline, interaction feedback, light/dark contrast, safe-area layout, and accessibility — scoped to native/mobile app UI (iOS/Android/React Native/Flutter).

Also re-check against `${FREECODE_PLUGIN_ROOT}/.freecode/CORRECTIONS.md` before delivery — if a past session already flagged a UI mistake in this project, don't repeat it.