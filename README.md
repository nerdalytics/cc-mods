# cc-mods

Mods for Claude Code, published as a plugin marketplace.

| Mod | What it does |
|---|---|
| [statusline](statusline/) | A live status line around the prompt: limits, costs, prompt cache and git, with a drag-and-drop pane for its order and a pane for its colours, plus a handoff before the cache goes cold. |
| [debug](debug/) | Marks every place in Claude Code's interface a mod can draw in, for mod authors. |

## Install a mod

In Claude Code:

```text
/plugin install <mod> --marketplace nerdalytics/cc-mods
```

Update with `/plugin marketplace update cc-mods` and then `/reload-plugins`, which loads the new version into the running session. Remove with `/plugin uninstall <mod>@cc-mods`.

## License

MIT
