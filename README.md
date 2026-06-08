# FreeCode Official Marketplace

A community plugin catalog for FreeCode Code: agents, skills, commands, hooks, rules, MCP server configs, and contexts — installable via the FreeCode plugin marketplace system.

## Structure

- `.FREECODE-plugin/` — marketplace + plugin manifests (`marketplace.json`, `plugin.json`)
- `agents/` — subagent definitions
- `skills/` — SKILL.md catalog (auto-loaded into agent context by name + description)
- `commands/` — slash command definitions
- `hooks/` — hook definitions (runtime scripts not yet ported — see `hooks/NOTE.md`)
- `rules/` — reusable rule sets
- `contexts/` — context profiles (dev/research/review)
- `mcp-configs/` — example MCP server configurations
- `examples/` — sample workflows and scenario fixtures
- `assets/` — icons and images

## Installing

```
freecode plugin marketplace add <this-repo-url>
freecode plugin install freecode-marketplace@freecode-marketplace
```

## License

MIT
