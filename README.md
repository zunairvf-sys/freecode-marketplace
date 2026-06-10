# FreeCode Official Marketplace

A community plugin catalog for FreeCode Code: agents, skills, commands, hooks, rules, MCP server configs, and contexts — installable via the FreeCode plugin marketplace system.

## Structure

- `.FREECODE-plugin/` — marketplace + plugin manifests (`marketplace.json`, `plugin.json`)
- `plugins/` — individual plugins, each with its own `agents/`, `skills/`, `commands/` as applicable:
  - `core`, `testing`, `security`, `languages` — everyday development, TDD/eval, security review, and language/framework patterns
  - `frontend`, `devops`, `data-ml`, `healthcare`, `finance`, `bizops`, `content`, `agent-ops` — domain-specific skills and agents
  - plus 35+ standalone plugins (playwright, plugin-dev, security-guidance, language LSP servers, etc.)
- `hooks/` — hook definitions (runtime scripts not yet ported — see `hooks/NOTE.md`)
- `rules/` — reusable rule sets
- `contexts/` — context profiles (dev/research/review)
- `mcp-configs/` — example MCP server configurations
- `examples/` — sample workflows and scenario fixtures
- `assets/` — icons and images

## Installing

```
freecode plugin marketplace add <this-repo-url>
freecode plugin install freecode-core@freecode-marketplace
```

Browse `.FREECODE-plugin/marketplace.json` for the full list of installable plugins.

## License

MIT
