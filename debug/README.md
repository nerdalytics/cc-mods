# Debug

A mod for mod authors. It shows where in Claude Code's interface a mod can draw, and what your terminal draws there. Install it while you look for the site to hook, then uninstall it.

```text
/plugin install debug --marketplace nerdalytics/cc-mods
/plugin uninstall debug@cc-mods
```

## What it shows

- **Render sites.** Each site a mod can draw in draws a red `X` and its name in front of what it draws, for example `X PromptHint` or `X TurnDuration`. The sites are `AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress`, `CommandOutput`, `Spinner`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`, `AbovePrompt` and `Pane`.
- **The `markers` pane.** It opens when the session starts. A pane draws at the side of the transcript, and the `Pane` site marks it too.
- **The probe pane.** `/debug:probe` opens a pane that draws what a pane can hold:
  - Text: bold, orange and dim.
  - A `Raster`: a 32 by 6 grid of coloured blocks.
  - An `Image`: a 64 by 32 pixel gradient in a box 32 columns wide and 8 rows tall. On a terminal that draws pictures, the gradient shows. On one that doesn't, the box shows `[image not drawn: alt text]`.
- **The PR trace pane.** `/debug:pr-trace` opens a pane that lists the statusline mod's PR fetches: the time, the branch, and the PR's pending, passed and failed checks, or the `gh` error. It needs the statusline mod's trace, which only a build that writes it provides, and shows `No PR fetch yet.` until the first fetch.
- **The handoff trace pane.** `/debug:handoff-trace` opens a pane that shows, with the time, why the statusline mod's handoff ran or did not in the minutes before the cache expires. Each line names the gate that held, for example a subagent at work with its type and status, or says the handoff started. The pane shows `No handoff window yet.` until the cache comes within minutes of expiring.

In Warp, the Raster draws and the Image shows its alt text. The mod doesn't say why. The API types name kitty and Ghostty as terminals that draw an `Image`.

## License

MIT, see [`LICENSE`](LICENSE).
