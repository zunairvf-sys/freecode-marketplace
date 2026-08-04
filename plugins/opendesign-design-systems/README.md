# opendesign-design-systems

**151 portable design-system packages** for FreeCode — each a self-contained
`manifest.json` + `DESIGN.md` + `tokens.css` (plus optional `design-tokens.json`,
`USAGE.md`, `components.html`, `tailwind-v4.css`).

Adapted from the [Open Design](https://github.com/nexu-io/open-design) catalog
(Apache-2.0). See [`NOTICE`](./NOTICE) and [`LICENSE`](./LICENSE).

## Categories

AI & LLM · Media & Consumer · Productivity & SaaS · Creative & Artistic ·
Modern & Minimal · Professional & Corporate · Backend & Data · Developer Tools ·
Bold & Expressive · Themed & Unique · Automotive · Fintech & Crypto ·
Morphism & Effects · E-Commerce & Retail · Layout & Structure · Retro &
Nostalgic · Editorial · Social & Messaging · Starter.

Full catalog: [`INDEX.json`](./INDEX.json).

## How FreeCode uses these

Selecting a design system composes its `DESIGN.md` (design prose) and
`tokens.css` (semantic tokens) into the generation prompt — the core lever for
on-brand, high-craft output instead of generic UI. The design canvas lists them
from this plugin and injects the chosen one at generate time (see
`docs/design-frontend-enhancement-plan.md`, Epic D).

Each package keeps its original machine-readable shape, so the FreeCode design
receiver and any compatible agent can discover and compose them the same way.
