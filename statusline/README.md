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
| Bolt | What its subagents cost. It appears once a subagent has run, unless `merge_costs` adds it to `Σ`. | Their tokens. |
| `●` `◕` `◑` `◔` `○` | Green while the prompt cache is warm, with the time left before it expires and what the next prompt's cached prefix costs to read. The glyph starts full and loses a quarter of its fill for each quarter of the cache's lifetime that passes. Once the cache is cold, the chip turns red and shows an empty `○`, `cold` and what writing the cache again costs. | While green, what the next prompt will cost once the cache is cold. |

Once this session has written a handoff, a line appears under Claude Code's hint line. With the cache cold it shows what the next message costs in this session and an estimate of what a fresh start from the handoff costs. With the cache still warm, as after a handoff the mod ran while you were away, it shows the fresh start's estimate alone, and hides when you send your next message. Neither line appears for a handoff the session has moved past, meaning a request of the main conversation more than five minutes after the handoff file was written. The `Start fresh` button next to it clears the session and starts a new one from the handoff file. It hides while Claude is working and while a subagent is still running, and stays while you type, as a reminder. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets.

Once the context has used 90% of the smart zone, another line appears there: `You're nearly out of the Smart zone.`, with `Smart zone` linking to its [definition](https://www.aihero.dev/ai-coding-dictionary/smart-zone), and a `Compact` button that runs `/compact`. Past the smart zone it reads `You're out of the Smart zone. Same model, just into the dumb zone now.`, and the further the context grows the further in it says: `just into` up to 1.25 times the smart zone, then `well into`, `deep into` from 1.5 times and `very deep into` from 2 times. The line follows the `smart_zone_tokens` option. It stays while Claude works, a subagent runs and you type: the `Compact` button queues `/compact`, which runs once the session is idle. The line disappears while a compaction runs, whoever started it, and comes back if the compaction ends without compacting, for example when you cancel it with Esc. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets. The `compact_hint` option turns it off, and with the `smart_zone` option off it never appears.

With the `auto_compact` option on, the mod runs `/compact` itself, without the button. It waits until the session is idle and the context has used 90% of the smart zone, the point where the line appears. It runs once between two of your prompts. Like the handoff, it does not run while a subagent is at work, with a usage limit used up, or with the 5h limit at 98%, or 90% on Fable and Mythos. The option is off by default, because a compaction replaces the conversation with its summary.

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

With the `auto_handoff` option on, the mod runs the handoff itself. It waits until the session is idle and the prompt cache is five minutes from expiring, so the handoff still reads the cache at the cheap rate. Unless `"idleCompaction": false` is in `settings.json`, it runs ten minutes before instead. See [Idle compaction](#idle-compaction).

It does this only on a cache that lives an hour. Claude Code gives the main conversation one on a subscription, and the mod also counts a cache written for five minutes if a later request read it back whole after more than five idle minutes with no other request in between. A cache that really lasts five minutes goes cold at every short pause, and writing it again costs little.

It runs once between two of your prompts. It does not run in these cases:

- A subagent is pending or running. One that only waits, on a plan's approval or on work listed on its own, does not stop it.
- A turn is running, or you have not sent a prompt since the mod loaded.
- A usage limit is used up.
- The 5h limit has reached 98%, or 90% on Fable and Mythos. The rest is left for your own prompts.

The debug mod's `/debug:handoff-trace` pane shows, with the time, why the handoff ran or did not in the minutes before the cache expires.

Claude Code can switch the main conversation to five-minute caches on its own, and 2.1.300 does so behind a server flag. Setting `"promptCacheTtl": "1h"` in `settings.json` keeps the hour-long cache, at the higher hour-long write rate.

After `/compact` the old cache has no use. The cache countdown and the handoff wait for the next request.

### Idle compaction

Claude Code compacts a long conversation on its own while the session is idle. The changelog in the Claude Code binary (2.1.302) says a conversation of 200K tokens or more, left idle for about 54 minutes, is compacted before its one-hour cache expires, so the next message does not reprocess it all. It applies in the terminal from v2.1.290, and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes the 200K minimum. `"idleCompaction": false` in `settings.json` turns it off. Setting it to `true` changes nothing, because it is on by default.

A handoff after that compaction would summarise the compacted conversation, not the whole one. So the mod reads `idleCompaction` when the session starts and sets the lead by it, on an hour's cache:

| `idleCompaction` | The handoff and the pings act | Minutes into the hour |
|---|---|---|
| unset or `true` | 10 minutes before expiry | 50 |
| `false` | 5 minutes before expiry | 55 |

The mod makes this choice without checking the conversation's size. A conversation under the 200K minimum is not compacted, and the handoff still runs five minutes earlier. A change to the setting takes effect at the next session start or after `/reload-plugins`. A five-minute cache keeps its one-minute lead.

Idle compaction does not replace the pings. It makes the next message cheaper by shrinking the conversation, and it empties the cache, as `/compact` does. A ping keeps the cache and the conversation as they are.

### Keeping the cache warm

Claude Code's documentation says it requests the one-hour cache only on a Claude subscription within the plan's included usage. Past the plan's limit, on an API key or on a cloud provider, the main conversation gets five minutes, and subagents get five minutes everywhere. See [which TTL each request gets](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets). On a five-minute cache the handoff above does not run on its own.

The `keep_warm_pings` option, 0 by default, sends minimal prompts of its own to keep the cache warm. It sends one just before the cache expires (five minutes ahead on a one-hour cache, ten with idle compaction on, a minute ahead on a five-minute one), up to the number you set between two of your prompts, and runs the handoff after the last one. The handoff then also runs on a five-minute cache. A read restarts the cache's timer at the read price, and the clock runs from the start of the request. See [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

The pings are turns in your conversation: each adds a short message and a one-word answer to it, and they show in the transcript. They do not run before your first prompt after the mod loads, nor while a subagent is at work or the 5h window is near its limit, the same cases as the handoff. A `/compact` ends them, because it empties the cache.

**Avoid pings where you can.** A fresh session from the handoff starts with a small context, so each message in it costs less and answers sooner than in a long conversation, which the pings only keep warm. The `Start fresh` button does this. A ping is a cache read, so a count of pings costs as much as writing the cache again once at the write price divided by the read price:

| Model | Read price | 5-minute cache, writes at 1.25 times | 1-hour cache, writes at 2 times |
|---|---|---|---|
| Opus 5.5, Sonnet 5.5 | 0.05 times | 25 pings, about 1h40 | 40 pings, about 37 hours |
| Other models | 0.1 times | 12 pings, about 50 minutes | 20 pings, about 18 hours |
| Fable 5.1, Mythos 5.1 | 0.025 times | 50 pings, about 3h20 | 80 pings, about 73 hours |

The prices are the API's multipliers from the prompt caching page. The count leaves out the pings' own output tokens and the messages they add, and the times assume a ping every 4 minutes on a five-minute cache and every 55 on a one-hour one. On a subscription the limit is usage rather than dollars, and the documentation does not say how cache reads count toward it.

## Order and hide

`/statusline:order` opens a pane with two lists. Press a row, drag it, release to drop it.

- **Rows.** The git and pull request row and the status row sit around the `━━ your prompt ━━` marker, drawn in bold cyan. A row above the marker draws above your prompt. A row below it draws under your prompt. A drop writes `row_git_position`, `row_status_position` and `row_order`.
- **Status row.** The tags are listed in the order they draw. A drop writes `segment_order`.
- **Hidden.** Each list has a dim `╌╌ hidden: switched off ╌╌` marker. A row or tag dropped under it is switched off: `row_git`, `row_status` or `segment_<name>` becomes false, and the pane draws it dim and struck through. Dragged back above the marker, it is switched on again. The markers do not drag.

Each drop writes only the options it changed, one `/config` write at a time. The same options are in `/config`.

## Options

<img width="2008" height="1050" alt="Statusline prefixed config options" src="https://github.com/user-attachments/assets/41627983-d2ff-4b84-affc-0892ac008550" />

Change these in `/config`, under the plugin. Each title there starts with `Statusline:`.

| Option | Key | Default | What it does |
|---|---|---|---|
| Git row | `row_git` | true | Shows the git row. |
| Git row › position | `row_git_position` | above | Places the git row `above` or `below` the prompt. Below means under Claude Code's hint line. |
| Status row | `row_status` | true | Shows the status row. |
| Status row › position | `row_status_position` | below | Places the status row `above` or `below` the prompt. When both rows share a place, the git row comes first, unless `row_order` is `status_first`. |
| Status row › model, limits, context, turns, costs, cache | `segment_model`, `segment_limits`, `segment_context`, `segment_turns`, `segment_tokens`, `segment_cache` | true | One toggle per tag of the status row. |
| Rows › order | `row_order` | git_first | Which row comes first when both draw on the same side of the prompt: `git_first` or `status_first`. |
| Status row › costs › merge | `merge_costs` | false | Draws one `Σ` tag with the cost of the main conversation and its subagents together. Hovering it shows their tokens added up. The bolt tag no longer appears. Before a subagent has run, nothing changes. |
| Status row › order | `segment_order` | model,limits,context,turns,tokens,cache | The status row's tags, left to right, as a comma list. A name left out goes last; an unknown one is ignored. |
| Compact spacing | `compact` | false | Removes the space between the status row's tags. The model name keeps one column after it. In the git row it removes the spaces between and inside the folders, branch and worktree. The rest of the git row keeps its spaces. A default branch keeps one space before it, because it has no `⎇` to separate it from the folder. |
| Hand off before the cache goes cold | `auto_handoff` | true | Runs `/statusline:handoff` as described under [Handoff](#handoff). |
| Keep the cache warm (pings) | `keep_warm_pings` | 0 | The most pings sent between two of your prompts, 0 for none, as described under [Keeping the cache warm](#keeping-the-cache-warm). The handoff runs after the last one, on a five-minute cache too. |
| Offer a fresh start from the handoff | `fresh_start` | true | Shows the line with the `Start fresh` button once a handoff exists: with the cache cold, or until your next message while it is warm. |
| Compact when the smart zone is nearly used | `auto_compact` | false | Runs `/compact` as described under [Status row](#status-row). |
| Offer a compaction when the smart zone is nearly used | `compact_hint` | true | Shows the line with the `Compact` button once the context has used 90% of the smart zone, as described under [Status row](#status-row). |
| Dismissed offers stay hidden (minutes) | `dismiss_minutes` | 0 | How long the cross on the `Start fresh` and `Compact` lines hides its line. 0 hides it for the rest of the session. |
| Smart zone on the context bar | `smart_zone` | true | Set to false, the context bar drops the smart zone. Each cell becomes a full-height block of the context left before auto-compaction. The glyph becomes a moon that fills across the whole window, and `⊙` past the threshold. |
| Smart zone (tokens) | `smart_zone_tokens` | 200000 | The size of the smart zone that the context bar's top half shows. 0 draws the bar as if `smart_zone` were off. |
| Turn line › tokens per second | `turn_rate` | true | Shows the tokens per second in the line that closes a turn, as described under [End of turn](#end-of-turn). |

## Needs

- Claude Code 2.1.287 or later, the version that added mods. The mod was built against 2.1.296, and its tests pass on 2.1.301.
- A [Nerd Font](https://www.nerdfonts.com/) in the terminal. The mod uses its glyphs for the subagent bolt, the pull request's draft, review, comment and check marks, the conflict warning, and the `Start fresh` button's icon.
- `git` for the git row, and `gh`, signed in, for the pull request details.

## What it reads and sends

The mod reads the session's transcripts under `~/.claude/projects/` to count tokens and requests. When `$CLAUDE_CONFIG_DIR` is set, it reads `$CLAUDE_CONFIG_DIR/projects/` instead. It also reads the end of every transcript written in the last five hours, to find a limit any of your sessions was refused on. It runs `git` in the project folder.

Over the network, it fetches `https://platform.claude.com/docs/en/about-claude/pricing.md` for the rates. It runs `gh pr view`, which asks GitHub for the branch's pull request. That happens when the branch changes and about once a minute after that (every 10 seconds while its checks are running or queued), while the branch is on a remote and is not the default branch. Nothing else leaves the machine.

## License

MIT, see [`LICENSE`](LICENSE). The handoff skill is adapted from Matt Pocock's MIT-licensed `handoff`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).
