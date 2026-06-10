# Persona Output Styles Plugin

This plugin bundles a collection of role-based output styles. Each one
changes FreeCode's persona, focus, and tone for the rest of a session by
replacing (or extending) the system prompt.

## What it does

Installing this plugin makes the following output styles available, in
addition to the built-in `default` style:

- `api-architect` — API design, contracts, versioning, and integration architecture
- `content-writer` — Long-form writing, editing, and content strategy assistant
- `customer-support` — Support ticket triage, response drafting, and knowledge-base lookups
- `data-analyst` — Data exploration, analysis, and visualization assistant
- `database-administrator` — Schema design, query optimization, migrations, and data integrity
- `devops-engineer` — Infrastructure, CI/CD, deployment, and observability-focused engineering
- `email-manager` — Inbox triage, drafting replies, and email-related MCP tool workflows
- `frontend-designer` — UI/UX-focused frontend engineering: component design, styling, accessibility, responsive layout
- `game-designer` — Game design, mechanics prototyping, and game-engine code assistance
- `personal-assistant` — Daily routine management: tasks, reminders, scheduling, and habit tracking
- `presentation-builder` — Slide deck structuring, narrative flow, and presentation content
- `project-manager` — Planning, task breakdown, status tracking, and stakeholder communication
- `qa-tester` — Test planning, test-case writing, and bug investigation
- `research-assistant` — Literature review, summarization, and structured research synthesis
- `security-auditor` — Security review, vulnerability analysis, and hardening recommendations
- `seo-specialist` — SEO research, on-page optimization, and content-performance analysis
- `social-media-manager` — Social content drafting, scheduling, and platform MCP tool workflows
- `video-maker` — Video editing & production assistant: scripts, timelines, MCP video/render tool workflows

## Usage

After installing this plugin, switch to a style with:

```
/output-style api-architect
```

or set it as the project default in `.FREECODE/settings.json`:

```json
{
  "outputStyle": "frontend-designer"
}
```

Each style is a plain markdown file with YAML frontmatter
(`name`, `description`, `keep-coding-instructions`) under `output-styles/`.
Styles with `keep-coding-instructions: true` keep FreeCode's normal
software-engineering tool-use instructions and add a persona on top; styles
with `keep-coding-instructions: false` (e.g. `video-maker`, `email-manager`,
`social-media-manager`) replace the default coding-assistant framing entirely
for non-engineering workflows.

## Customizing

To tweak a style, create a local copy of this plugin (or copy the relevant
`.md` file into your project's `.FREECODE/output-styles/` directory) and edit
the prompt text and frontmatter to taste.
