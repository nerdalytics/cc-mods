# cc-mods

Mods for Claude Code, published as a plugin marketplace.

| Mod | What it does |
|---|---|
| [cockpit](cockpit/) | Live gauges around the prompt: limits, costs, prompt cache and git, with a drag-and-drop pane for its order and a pane for its colours, plus a handoff before the cache goes cold. |
| [debug](debug/) | Marks every place in Claude Code's interface a mod can draw in, for mod authors. |

## Install a mod

In Claude Code:

```text
/plugin install <mod> --marketplace nerdalytics/cc-mods
```

Update with `/plugin marketplace update cc-mods` and then `/reload-plugins`, which loads the new version into the running session. Remove with `/plugin uninstall <mod>@cc-mods`.

## Versions

Each mod's version follows [Compatible Versioning](https://gitlab.com/staltz/comver), written as `MAJOR.MINOR.0`. The minor number goes up for a release that keeps every option, command and documented behaviour working as before; the major number goes up for any release that does not, and the minor number starts over at 0. A mod's README lists under Upgrading what each major release breaks.

## License

MIT
