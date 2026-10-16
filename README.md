# cc-mods

Mods for Claude Code, published as a plugin marketplace.

| Mod | What it does |
|---|---|
| [statusline](statusline/) | A live status line around the prompt: limits, costs, prompt cache and git, plus a handoff before the cache goes cold. |
| [debug](debug/) | Marks every place in Claude Code's interface a mod can draw in, for mod authors. |

## Install a mod

Each mod's README has an install block to paste into Claude Code, which installs the mod and checks what it needs. Or install it yourself, in a shell:

```sh
claude plugin marketplace add nerdalytics/cc-mods
claude plugin install <mod>@cc-mods
```

Then type `/reload-plugins` in Claude Code, or start a new session. Adding the marketplace is needed once; after that, `claude plugin install <mod>@cc-mods` installs any mod listed here.

Update with `claude plugin update <mod>@cc-mods`, remove with `claude plugin uninstall <mod>@cc-mods`.

## License

MIT
