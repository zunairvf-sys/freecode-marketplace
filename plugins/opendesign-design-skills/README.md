# opendesign-design-skills

**292 agent-agnostic design skills** for FreeCode — a large breadth library of
design-system definitions, aesthetic direction, taste calibration, editorial and
brand systems, decks, motion, data-viz, and production patterns.

Adapted from the [Open Design](https://github.com/nexu-io/open-design) corpus
(Apache-2.0) into FreeCode's `SKILL.md` format. See [`NOTICE`](./NOTICE) and
[`LICENSE`](./LICENSE) for attribution.

## What's inside

Each skill is a `skills/<name>/SKILL.md` with FreeCode-standard frontmatter
(`name`, `description`, `triggers`) and design guidance in the body. Categories
span:

- **Design systems & aesthetics** — apple-hig, brutalist, swiss-international,
  editorial, and dozens of named system skills.
- **Craft & taste** — creative-director, design-review, color-expert,
  copywriting, design-brief, design-consultation.
- **Surfaces** — decks, docs, cards (twitter/xiaohongshu), articles, magazines,
  data reports, d3-visualization, algorithmic-art.
- **Brand** — brand-extract, brand-guidelines, brandkit.

Full list: [`INDEX.json`](./INDEX.json).

## How FreeCode uses these

- **Design canvas** — the design receiver discovers skills the workspace has
  installed at `<workspace>/.freecode/design/<name>/SKILL.md`; enabling this
  plugin seeds the design-generation subset there so the canvas produces
  on-brand, high-craft output instead of generic UI.
- **Any agent** — the skills are plain SKILL.md, so any SKILL.md-capable agent
  can trigger them by their `triggers`.

## Excluded on purpose

Host-locked skills that cannot run outside the original renderer were dropped:
custom `question-form` "atoms", daemon-IPC "scenarios", video-template preview
modes, and Open Design's own company/pitch decks. See `NOTICE` for details.
