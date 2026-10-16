# Statusline

A live status line for Claude Code, drawn around the prompt, and a handoff skill that runs before the prompt cache goes cold.

<img width="1041" height="45" alt="The git row (project folder, current folder, branch) above the status row (model, 7d and 5h limits, context, prompts, cost, cache)" src="https://github.com/user-attachments/assets/a6a36fa3-bc46-4ebc-b493-13feb520410e" />

## Install

In Claude Code:

```text
/plugin install statusline --marketplace nerdalytics/cc-mods
```

It asks to add the marketplace, then installs the mod and asks for its options (see [Options](#options)); `/config` changes them later. Then set up what it needs (see [Needs](#needs)): a Nerd Font in your terminal, `git`, and `gh auth login` if you want pull request details.

### Update and remove

```sh
claude plugin update statusline@cc-mods
claude plugin uninstall statusline@cc-mods
```

## What it shows

Two rows, each placed above or below the prompt with an option (see [Options](#options)). By default the status row sits under the prompt, below Claude Code's own hint line, and reads left to right:

| Tag | Shows | Hovered |
|---|---|---|
| model name | the main loop's model, its colour by family, Mythos bold. A gradient sweeps across it, faster the higher the effort of the last request, and stands still when that request carried no effort | |
| `7d`, `5h` | two bars per limit: the top half is the time left until the window resets, the bottom half the usage left. Limits are your account's: once any of your sessions is refused on one, it shows used up here too, until it resets. Any other window Claude Code reports shows as its name and percentage | the time until the reset |
| `◇` `◆` `○` `◔` `◑` `◕` `●` `⊙` | the context window as two bars: the top half is the smart zone left (the first 200,000 tokens by default, where recall is precise), the bottom half the context left before auto-compaction, at the threshold Claude Code reports. The glyph says the zone: a diamond in the smart zone, a moon filling up beyond it, `⊙` past the threshold, when the bottom refills red. The badge runs from green to red as the context fills. With the `smart_zone` option off, the bar shows only the context left, in full-height blocks | the tokens left |
| `⏎` | prompts you sent / model requests the main conversation made for them | subagents that ran / the requests they made |
| `Σ` | what the main conversation cost | its tokens |
| bolt | what its subagents cost, once one has run | their tokens |
| `◷` | green: the time left before the prompt cache expires, and what the next prompt's cached prefix costs to read. Red: `cold`, and what it costs to write it again | while green, what it will cost once cold. |

Once the cache is cold and the session has written a handoff, a line under Claude Code's hint line says what the next message costs here and about what a fresh start from the handoff costs, followed by a `Start fresh` button: it clears the session and starts the new one from the handoff file. It hides while you type, while Claude is working, and while a subagent is still at work.

The git row, above the prompt by default: the project folder (and the current folder when you `cd` elsewhere), the branch (bare when it is the default branch, after `⎇` otherwise) and the one it was made from, the worktree, the pull request (`#n`, a pencil for a draft, review approved (check), changes requested (cross) or required (`⋯`), an envelope and the comment count, and the checks as GitHub draws them: a dot and the count running, a cross for each failed check, a check and the count passed), `↑`/`↓` commits ahead and behind (`?` when counted against the default branch because no remote has the branch), a warning sign for a conflict, and `+`/`-`/`~` lines added, lines deleted and files changed. Outside a repository it shows the folders alone.

How to read it: a value on grey has more to show on hover; one on no background has not. A label on dark green is a button. The folder line is links: the folders, the branch and the worktree open their folder on disk in your default app, the pull request number its page, `↓` the branch's history on GitHub, each failed check's cross that check, the running and passed counts the pull request's checks.

Costs are estimates: each request in the session's transcripts is priced with Anthropic's published rates, fetched from the pricing page at the session's first count, and again at the next count while that fails. Fast mode on Opus 5.5, 5 and 4.8 is priced at twice the rate. A `~` before a cost means some requests had no price; `$?` means none had.

## Handoff

`/statusline:handoff` writes `HANDOFF-<YYYY-MM-DD-HHMM>.md` at the project's root: a summary of the conversation for the next session to start from. An argument, if you give one, says what the next session will focus on, and the summary is tailored to it.

With the `auto_handoff` option on, the mod runs it on its own once the session is idle and the prompt cache is five minutes from expiring, so the handoff still reads the cache at the cheap rate. It does so only on the hour-long cache Claude Code gives the main conversation on a subscription: a five-minute cache goes cold at every short pause, and writing it again costs little. It runs once per stretch between your prompts, and not while a subagent is at work. It does not run while a usage limit is used up, or once the 5h limit reaches 98% (90% on Fable and Mythos), leaving what is left to your own prompts. Claude Code can switch the main conversation to five-minute caches on its own (2.1.300 does so behind a server flag); `"promptCacheTtl": "1h"` in `settings.json` keeps it on the hour, at the dearer hour-long write rate. After `/compact` the old cache is of no use, so there is no countdown, and no handoff, until the next request.

## Options

<img width="2178" height="1100" alt="Statusline prefixed config options" src="https://github.com/user-attachments/assets/8927759d-625a-4dd0-ac5f-7d6451cac108" />

In `/config`, under the plugin:

| Option | Default | What it does |
|---|---|---|
| Statusline: Git row (`row_git`) | on | the folder line above the prompt |
| Statusline: Git row › position (`row_git_position`) | above | `above` the prompt, or `below` it, under Claude Code's hint line |
| Statusline: Status row (`row_status`) | on | the row under the prompt |
| Statusline: Status row › position (`row_status_position`) | below | `above` or `below` the prompt; two rows in one place stack the git row first |
| Statusline: Status row › model, limits, context, turns, costs, cache (`segment_model`, `segment_limits`, `segment_context`, `segment_turns`, `segment_tokens`, `segment_cache`) | on | one toggle per segment of the status row |
| Statusline: Compact spacing (`compact`) | off | no space between the status row's tags (the model name keeps one column after it), nor in the git row's folders, branch and worktree; the rest of the git row keeps its spaces, and so does a default branch, which has no `⎇` to part it from the folder |
| Statusline: Hand off before the cache goes cold (`auto_handoff`) | on | runs `/statusline:handoff` as above |
| Statusline: Offer a fresh start from the handoff (`fresh_start`) | on | the line under the status row once the cache is cold, with the button |
| Statusline: Smart zone on the context bar (`smart_zone`) | on | off, the context bar drops the smart zone: each cell is a full-height block of the context left before auto-compaction, and the glyph a moon filling across the whole window (`⊙` past the threshold) |
| Statusline: Smart zone (tokens) (`smart_zone_tokens`) | 200000 | the size of the smart zone the context bar's top half shows; 0 draws the bar as with `smart_zone` off |

## Needs

- Claude Code 2.1.287 or later, the version that added mods. Built against 2.1.296; its tests pass on 2.1.301.
- A [Nerd Font](https://www.nerdfonts.com/) in the terminal, for the subagent bolt, the pull request's draft, review, comment and check marks, the conflict warning, and the `Start fresh` button's icon.
- `git` for the second row; `gh`, signed in, for the pull request details.

## What it reads and sends

It reads the session's transcripts under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`) to count tokens and requests, and the end of every transcript written in the last five hours for a limit a session was refused on, and runs `git` in the project folder. Over the network it fetches `https://platform.claude.com/docs/en/about-claude/pricing.md` for the rates, and `gh pr view` asks GitHub for the branch's pull request when the branch changes and about once a minute after that, while the branch is on a remote and is not the default branch. Nothing else leaves the machine.

## License

MIT, see [`LICENSE`](LICENSE). The handoff skill is adapted from Matt Pocock's MIT-licensed `handoff`; see [`ATTRIBUTION.md`](ATTRIBUTION.md).
