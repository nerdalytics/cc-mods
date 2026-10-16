# cc-mods

Mods for Claude Code, published as a plugin marketplace.

| Mod | What it does |
|---|---|
| [statusline](statusline/) | A live status line around the prompt: limits, costs, prompt cache and git, plus a handoff before the cache goes cold. |
| [debug](debug/) | Marks every place in Claude Code's interface a mod can draw in, for mod authors. |

## Install a mod

In Claude Code:

```text
/plugin install <mod> --marketplace nerdalytics/cc-mods
```

Update with `claude plugin update <mod>@cc-mods`, remove with `claude plugin uninstall <mod>@cc-mods`.

## License

MIT
