# Debug

A mod for mod authors: it marks every place in Claude Code's interface a mod can draw in. Each render site draws a red `X` and its name in front of what it draws, and a `markers` pane opens when the session starts. Install it while you look for the site to hook, then uninstall it.

`/debug:probe` opens a pane that draws text, a `Raster` and an `Image`. The `Image` shows its alt text where the terminal draws no pictures, so the pane tells you what yours supports.

```text
/plugin install debug --marketplace nerdalytics/cc-mods
/plugin uninstall debug@cc-mods
```

## License

MIT, see [`LICENSE`](LICENSE).
