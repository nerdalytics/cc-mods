# Statusline

A status line for Claude Code that updates while you work. It draws two rows around the prompt. It also ships a handoff skill that runs before the prompt cache goes cold.

<img width="1041" height="45" alt="The git row with the project folder, current folder and branch, above the status row with the model, the 7d and 5h limits, the context, prompts, cost and cache" src="https://github.com/user-attachments/assets/a6a36fa3-bc46-4ebc-b493-13feb520410e" />

## Install

In Claude Code:

```text
/plugin install statusline --marketplace nerdalytics/cc-mods
```

Claude Code asks to add the marketplace, installs the mod, and asks for its options. [Options](#options) explains each one, and `/config` changes them later.

Then install what the mod needs, listed under [Needs](#needs). That is a Nerd Font in your terminal and `git`. For pull request details, also run `gh auth login`.

### Update and remove

In Claude Code:

```text
/plugin marketplace update cc-mods
/reload-plugins
/plugin uninstall statusline@cc-mods
```

The first command fetches the marketplace and installs the versions it bumps, and `/reload-plugins` loads them into the running session, so you don't need a new one. The last command removes the mod.

## What it shows

The mod draws a status row and a git row. An option places each one above or below the prompt.

### Status row

By default the status row sits under the prompt, below Claude Code's hint line. Its tags, left to right:

| Tag | Shows | On hover |
|---|---|---|
| Model name | The main loop's model. Its colour shows the family, and Mythos is bold. A gradient sweeps across the name, faster the higher the effort of the last request. It stops when that request carried no effort. | |
| `7d`, `5h` | Two bars per limit. The top half is the time left until the window resets. The bottom half is the usage left. Limits belong to your account, so once any of your sessions is refused on one, this session shows it used up too, until it resets. Any other window Claude Code reports shows as its name and a percentage. | The time until the reset. |
| `◇` `◆` `○` `◔` `◑` `◕` `●` `⊙` | The context window as two bars. The top half is the smart zone left, the first 200,000 tokens by default, where recall is precise. The bottom half is the context left before auto-compaction, at the threshold Claude Code reports. Past the threshold the bottom fills again in red, one full bar per 25% over. The glyph is a diamond inside the smart zone, a moon that fills up beyond it, and `⊙` past the threshold. The badge turns from green to red as the context fills. With the `smart_zone` option off, the bar shows only the context left, in full-height blocks. | The tokens left. |
| `⏎` | The prompts you sent, then the model requests the main conversation made for them. | Once a subagent has run, the subagents that ran and the requests they made. |
| `Σ` | What the main conversation cost. | Its tokens. |
| Bolt | What its subagents cost. It appears once a subagent has run. | Their tokens. |
| `◷` | Green while the prompt cache is warm, with the time left before it expires and what the next prompt's cached prefix costs to read. Red once the cache is cold, with `cold` and what writing the cache again costs. | While green, what the next prompt will cost once the cache is cold. |

Once the cache is cold and this session has written a handoff, a line appears under Claude Code's hint line. It shows what the next message costs in this session and an estimate of what a fresh start from the handoff costs. The `Start fresh` button next to it clears the session and starts a new one from the handoff file. The line hides while you type, while Claude is working, and while a subagent is still running.

### Git row

By default the git row sits above the prompt. Its parts, left to right:

- The project folder. When you `cd` elsewhere, the current folder follows it.
- The branch. The default branch shows bare, and any other branch after `⎇`. A branch made from a branch other than the default shows that branch first.
- The worktree after `⎇`, unless the branch name already contains it.
- The pull request, as `PR` and its number in one colour for its state: yellow when open, white as a draft, purple once merged and grey once closed. An open or draft pull request is followed by its glyphs: a pencil for a draft, a check when the review approved it, a cross when changes were requested, `⋯` when a review is required, and an envelope and a count for the comments. A merged or closed pull request shows only its number.
- `↑` and `↓` with the commits ahead and behind. A `?` after them means no remote has the branch, so the mod counts against the default branch.
- A warning sign when a merge or rebase is in progress, files are unmerged, merging the default branch would conflict, or GitHub reports an open or draft pull request as conflicting.
- The checks of an open or draft pull request as GitHub draws them. A dot and a count show the running checks, each failed check gets a cross, and a check and a count show the passed ones.
- `+`, `-` and `~` with the lines added, the lines deleted and the files changed.

Outside a repository the row shows only the folders.

### Clicking and hovering

A value on a grey background shows more when you hover over it. A value on no background has nothing more to show. A label on dark green is a button.

The git row is made of links, and a click opens them the way your terminal opens any link:

- The folders, the branch and the worktree open their folder on disk in your default app.
- The pull request's `PR` and number open the pull request.
- `↓` opens the branch's commit history on its remote's website. A count with `?` has no link.
- A failed check's cross opens that check.
- The running and passed counts open the pull request's checks.

### End of turn

The line that closes a turn, `✻ Cooked for 7s · done 11:22 PM`, gets the tokens per second the turn generated in its verb: `✻ Cooked at 52 tok/s for 7s · done 11:22 PM`. The count is the output tokens of the main conversation's requests in that turn, divided by the turn's length. The input, the cache reads and writes, and a subagent's tokens are not in it. It uses the status row's units: a plain number under 1000, `K` with one decimal and `M` with two. The `turn_rate` option turns it off.

### Costs

Costs are estimates. The mod prices each request in the session's transcripts with Anthropic's published rates. It fetches the rates from the pricing page at the session's first token count, and again at each later count until a fetch succeeds. Fast mode on Opus 5.5, Opus 5 and Opus 4.8 costs twice the rate. A `~` before a cost means some requests had no price, and `$?` means none had.

## Handoff

`/statusline:handoff` writes `HANDOFF-<YYYY-MM-DD-HHMM>.md` at the project's root. The file summarises the conversation so the next session can start from it. If you pass an argument, it names what the next session will focus on, and the summary covers that.

With the `auto_handoff` option on, the mod runs the handoff itself. It waits until the session is idle and the prompt cache is five minutes from expiring, so the handoff still reads the cache at the cheap rate.

It does this only on a cache that lives an hour. Claude Code gives the main conversation one on a subscription, and the mod also counts a cache written for five minutes if a later request read it back whole after more than five idle minutes with no other request in between. A cache that really lasts five minutes goes cold at every short pause, and writing it again costs little.

It runs once between two of your prompts. It does not run in these cases:

- A subagent is at work.
- A usage limit is used up.
- The 5h limit has reached 98%, or 90% on Fable and Mythos. The rest is left for your own prompts.

Claude Code can switch the main conversation to five-minute caches on its own, and 2.1.300 does so behind a server flag. Setting `"promptCacheTtl": "1h"` in `settings.json` keeps the hour-long cache, at the higher hour-long write rate.

After `/compact` the old cache has no use. The cache countdown and the handoff wait for the next request.

## Options

<img width="2008" height="1050" alt="Statusline prefixed config options" src="https://github.com/user-attachments/assets/41627983-d2ff-4b84-affc-0892ac008550" />

Change these in `/config`, under the plugin. Each title there starts with `Statusline:`.

| Option | Key | Default | What it does |
|---|---|---|---|
| Git row | `row_git` | true | Shows the git row. |
| Git row › position | `row_git_position` | above | Places the git row `above` or `below` the prompt. Below means under Claude Code's hint line. |
| Status row | `row_status` | true | Shows the status row. |
| Status row › position | `row_status_position` | below | Places the status row `above` or `below` the prompt. When both rows share a place, the git row comes first. |
| Status row › model, limits, context, turns, costs, cache | `segment_model`, `segment_limits`, `segment_context`, `segment_turns`, `segment_tokens`, `segment_cache` | true | One toggle per tag of the status row. |
| Compact spacing | `compact` | false | Removes the space between the status row's tags. The model name keeps one column after it. In the git row it removes the spaces between and inside the folders, branch and worktree. The rest of the git row keeps its spaces. A default branch keeps one space before it, because it has no `⎇` to separate it from the folder. |
| Hand off before the cache goes cold | `auto_handoff` | true | Runs `/statusline:handoff` as described under [Handoff](#handoff). |
| Offer a fresh start from the handoff | `fresh_start` | true | Shows the cold-cache line with the `Start fresh` button. |
| Smart zone on the context bar | `smart_zone` | true | Set to false, the context bar drops the smart zone. Each cell becomes a full-height block of the context left before auto-compaction. The glyph becomes a moon that fills across the whole window, and `⊙` past the threshold. |
| Smart zone (tokens) | `smart_zone_tokens` | 200000 | The size of the smart zone that the context bar's top half shows. 0 draws the bar as if `smart_zone` were off. |
| Turn line › tokens per second | `turn_rate` | true | Shows the tokens per second in the line that closes a turn, as described under [End of turn](#end-of-turn). |

## Needs

- Claude Code 2.1.287 or later, the version that added mods. The mod was built against 2.1.296, and its tests pass on 2.1.301.
- A [Nerd Font](https://www.nerdfonts.com/) in the terminal. The mod uses its glyphs for the subagent bolt, the pull request's draft, review, comment and check marks, the conflict warning, and the `Start fresh` button's icon.
- `git` for the git row, and `gh`, signed in, for the pull request details.

## What it reads and sends

The mod reads the session's transcripts under `~/.claude/projects/` to count tokens and requests. When `$CLAUDE_CONFIG_DIR` is set, it reads `$CLAUDE_CONFIG_DIR/projects/` instead. It also reads the end of every transcript written in the last five hours, to find a limit any of your sessions was refused on. It runs `git` in the project folder.

Over the network, it fetches `https://platform.claude.com/docs/en/about-claude/pricing.md` for the rates. It runs `gh pr view`, which asks GitHub for the branch's pull request. That happens when the branch changes and about once a minute after that, while the branch is on a remote and is not the default branch. Nothing else leaves the machine.

## License

MIT, see [`LICENSE`](LICENSE). The handoff skill is adapted from Matt Pocock's MIT-licensed `handoff`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).
