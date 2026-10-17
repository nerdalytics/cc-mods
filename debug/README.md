# Debug

A mod for mod authors. It shows where in Claude Code's interface a mod can draw, and what your terminal draws there. Install it while you look for the site to hook, then uninstall it.

```text
/plugin install debug --marketplace nerdalytics/cc-mods
/plugin uninstall debug@cc-mods
```

## What it shows

- **Render sites.** Each site a mod can draw in draws a red `X` and its name in front of what it draws, for example `X PromptHint` or `X TurnDuration`. The sites are `AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress`, `CommandOutput`, `Spinner`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`, `AbovePrompt` and `Pane`.
- **The `markers` pane.** It opens when the session starts. A pane draws at the side of the transcript, and the `Pane` site marks it too.
- **The probe pane.** `/probe` opens a pane that draws what a pane can hold:
  - Text: bold, orange and dim.
  - A `Raster`: a 32 by 6 grid of coloured blocks.
  - An `Image`: a 64 by 32 pixel gradient in a box 32 columns wide and 8 rows tall. On a terminal that draws pictures, the gradient shows. On one that doesn't, the box shows `[image not drawn: alt text]`.

In Warp, the Raster draws and the Image shows its alt text. The mod doesn't say why. The API types name kitty and Ghostty as terminals that draw an `Image`.

## License

MIT, see [`LICENSE`](LICENSE).
