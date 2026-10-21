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

The mod draws a status row and a git row, and under the prompt a line for each of the cold cache, the smart zone and the limit forecast when it applies. An option places each one above or below the prompt, and [`/statusline:order`](#order-and-hide) sets the order of the ones on a side and of each row's tags. Spacers push a row's tags towards the left and right edges, and the `density` option sets how close the tags sit. See [Spacing and alignment](#spacing-and-alignment).

### Status row

By default the status row sits under the prompt, below Claude Code's hint line. Its tags, left to right, are named in `segment_order` as `model`, `limit_7d`, `limit_5h`, `context`, `turns`, `tokens` and `cache`:

| Tag | Shows | On hover |
|---|---|---|
| Model name | The main loop's model. Its colour shows the family, and Mythos is bold. A gradient sweeps across the name, faster the higher the effort of the last request. It stops when that request carried no effort. With the `gradients` option off the name is one colour and does not sweep, so it no longer shows the effort. | |
| `7d`, `5h` | One tag per limit, each with two bars. The top half is the time left until the window resets. The bottom half is the usage left. Limits belong to your account, so once the API refuses any of your sessions on one, this session shows it used up too, until it resets. Any other window Claude Code reports shows as its name and a percentage after the 5h tag. | The time until the reset. |
| `◇` `◆` `○` `◔` `◑` `◕` `●` `⊙` | The context window as two bars. The top half is the smart zone left, the first 200,000 tokens by default, where recall is precise. The bottom half is the context left before auto-compaction, at the threshold Claude Code reports. Past the threshold the bottom fills again in red, one full bar per 25% over. The glyph is a diamond inside the smart zone, a moon that fills up beyond it, and `⊙` past the threshold. The badge turns from green to red as the context fills. With the `smart_zone` option off, the bar shows only the context left, in full-height blocks. | The tokens left. |
| `⏎` | The prompts you sent, then the model requests the main conversation made for them. | Once a subagent has run, the subagents that ran and the requests they made. |
| `Σ` | What the main conversation cost. | Its tokens. |
| Bolt | What its subagents cost. It appears once a subagent has run, unless `merge_costs` adds it to `Σ`. | Their tokens. |
| `●` `◕` `◑` `◔` `○` | Green while the prompt cache is warm, with the time left before it expires and what the next prompt's cached prefix costs to read. The glyph starts full and loses a quarter of its fill for each quarter of the cache's lifetime that passes. Once the cache is cold, the chip turns red and shows an empty `○`, `cold` and what writing the cache again costs. | While green, what the next prompt will cost once the cache is cold. |

Once this session has written a handoff, a line appears under Claude Code's hint line. With the cache cold it shows what the next message costs in this session and an estimate of what a fresh start from the handoff costs. With the cache still warm, as when the mod ran a handoff while you were away, it shows the fresh start's estimate alone, and hides when you send your next message. Neither line appears once the session has moved past the handoff, which happens when the main conversation makes a request more than five minutes after the handoff file was written. The `Start fresh` button next to it clears the session and starts a new one from the handoff file. It hides while Claude is working and while a subagent is still running, and stays while you type, as a reminder. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets.

Once the context has used 90% of the smart zone, another line appears there, `You're nearly out of the Smart zone.`, with `Smart zone` linking to its [definition](https://www.aihero.dev/ai-coding-dictionary/smart-zone) and a `Compact` button that runs `/compact`. Past the smart zone it reads `You're out of the Smart zone. Same model, just into the dumb zone now.`

The wording moves further in as the context grows, on a log scale where each step is half as far again as the last. It says `just into` up to 1.5 times the smart zone, `well into` from 1.5 times, `deep into` from 2.25 times and `very deep into` from 3.375 times. On the default 200,000-token zone those steps fall at 300K, 450K and 675K tokens. The line follows the `smart_zone_tokens` option.

The line stays while Claude works, while a subagent runs and while you type, because the `Compact` button queues `/compact`, which runs once the session is idle. The line disappears while a compaction runs, whoever started it, and comes back if the compaction ends without compacting, for example when you cancel it with Esc. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets. The `compact_hint` option turns it off, and with the `smart_zone` option off it never appears.

With the `auto_compact` option on, the mod runs `/compact` itself, without the button. It waits until the session is idle and the context has used 90% of the smart zone, the point where the line appears. It runs once between two of your prompts. Like the handoff, it does not run while a subagent is at work, with a usage limit used up, or with the 5h limit at 98%, or 90% on Fable and Mythos. The option is off by default, because a compaction replaces the conversation with its summary.

When the 7d or 5h limit would reach 100% before it resets, a line under the hint line warns you, such as `5h at 70%: at this pace it runs out in 1h17m, 43m before it resets.` `limit_forecast_position` can move it above the prompt. The pace is the one the window has run at since it began, idle stretches included, so a quiet night counts. The figure is the account's, and every session's responses move it. A session hears it only in its own responses, so the line shows only for a session that got one in the last 10 minutes. The session you are prompting warns, and an idle one stays quiet. It waits until a tenth of the window has passed, because the pace is noise before that. It does not run on a window at 100%, which the bars already show. Turn it off with `limit_forecast`.

### Git row

By default the git row sits above the prompt. Its parts, left to right by default, each with its name in `git_order`:

- `folders`: the project folder. When you `cd` elsewhere, the current folder follows it.
- `branch`: the default branch shows bare, and any other branch after `⎇`. A branch made from a branch other than the default shows that branch first.
- `worktree`: the worktree after `⎇`, unless the branch name already contains it.
- `pr`: the pull request, as `PR` and its number in one colour for its state: yellow when open, white as a draft, purple once merged and grey once closed. A draft has a pencil after it.
- `review`: for an open or draft pull request, a check when the review approved it, a cross when changes were requested, and `⋯` when a review is required.
- `comments`: for an open or draft pull request, an envelope and a count for its comments.
- `sync`: `↑` and `↓` with the commits ahead and behind. A `?` after them means no remote has the branch, so the mod counts against the default branch.
- `conflict`: a warning sign when a merge or rebase is in progress, files are unmerged, merging the default branch would conflict, or GitHub reports an open or draft pull request as conflicting.
- `checks`: the checks of an open or draft pull request as GitHub draws them. A dot and a count show the running checks, each failed check gets a cross, and a check and a count show the passed ones.
- `changes`: `+`, `-` and `~` with the lines added, the lines deleted and the files changed.

Outside a repository the row shows only the folders. Each part's gradient follows the order it draws in, whatever that order is.

### Clicking and hovering

A value on a grey background shows more when you hover over it. A value on no background has nothing more to show. A label on indigo, between two half blocks, is a button. These are the default colours, and [`/statusline:colors`](#colours) changes them.

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

It does this only on a cache that lives an hour. Claude Code gives the main conversation one on a subscription. The mod also counts a cache written for five minutes as an hour's when a later request read it back whole after more than five idle minutes, with no other request in between. A cache that really lasts five minutes goes cold at every short pause, and writing it again costs little.

It runs once between two of your prompts. It does not run in these cases:

- A subagent is pending or running. One that only waits, on a plan's approval or on work listed on its own, does not stop it.
- A turn is running, or you have not sent a prompt in this session. A reload of the mod keeps the time of your last prompt.
- A usage limit is used up.
- The 5h limit has reached 98%, or 90% on Fable and Mythos. The rest is left for your own prompts.

The debug mod's `/debug:handoff-trace` pane shows, with the time, why the handoff ran or did not in the minutes before the cache expires.

Claude Code can switch the main conversation to five-minute caches on its own, and 2.1.300 does so behind a server flag. Setting `"promptCacheTtl": "1h"` in `settings.json` keeps the hour-long cache, at the higher hour-long write rate.

After `/compact` the old cache has no use. The cache countdown and the handoff wait for the next request.

### Idle compaction

Claude Code compacts a long conversation on its own while the session is idle. The changelog in the Claude Code 2.1.302 binary says Claude Code compacts a conversation of 200K tokens or more that has been idle for about 54 minutes, before its one-hour cache expires, so the next message does not reprocess it all. It applies in the terminal from v2.1.290, and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes the 200K minimum. `"idleCompaction": false` in `settings.json` turns it off. Setting it to `true` changes nothing, because it is on by default.

A handoff after that compaction would summarise the compacted conversation, not the whole one. So the mod reads `idleCompaction` when the session starts and sets the lead by it, on an hour's cache:

| `idleCompaction` | The handoff and the pings act | Minutes into the hour |
|---|---|---|
| unset or `true` | 10 minutes before expiry | 50 |
| `false` | 5 minutes before expiry | 55 |

The mod makes this choice without checking the conversation's size. Claude Code leaves a conversation under the 200K minimum alone, and the handoff still runs five minutes earlier. A change to the setting takes effect at the next session start or after `/reload-plugins`. A five-minute cache keeps its one-minute lead.

Idle compaction does not replace the pings. It makes the next message cheaper by shrinking the conversation, and it empties the cache, as `/compact` does. A ping keeps the cache and the conversation as they are.

### Keeping the cache warm

Claude Code's documentation says it requests the one-hour cache only on a Claude subscription within the plan's included usage. Past the plan's limit, on an API key or on a cloud provider, the main conversation gets five minutes, and subagents get five minutes everywhere. See [which TTL each request gets](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets). On a five-minute cache the handoff above does not run on its own.

The `keep_warm_pings` option, 0 by default, sends minimal prompts of its own to keep the cache warm. It sends one just before the cache expires, up to the number you set between two of your prompts, and runs the handoff after the last one. On a one-hour cache a ping goes out five minutes ahead, or ten with idle compaction on, and on a five-minute cache a minute ahead. The handoff then also runs on a five-minute cache. A read restarts the cache's timer at the read price, and the clock runs from the start of the request. See [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

The pings are turns in your conversation. Each adds a short message and a one-word answer to it, and they show in the transcript. They do not run before your first prompt after the mod loads, nor while a subagent is at work or the 5h window is near its limit, the same cases as the handoff. A `/compact` ends them, because it empties the cache.

**Avoid pings where you can.** A fresh session from the handoff starts with a small context, so each message in it costs less and answers sooner than in a long conversation, which the pings only keep warm. The `Start fresh` button does this. A ping is a cache read, so a count of pings costs as much as writing the cache again once at the write price divided by the read price:

| Model | Read price | 5-minute cache, writes at 1.25 times | 1-hour cache, writes at 2 times |
|---|---|---|---|
| Opus 5.5, Sonnet 5.5 | 0.05 times | 25 pings, about 1h40 | 40 pings, about 37 hours |
| Other models | 0.1 times | 12 pings, about 50 minutes | 20 pings, about 18 hours |
| Fable 5.1, Mythos 5.1 | 0.025 times | 50 pings, about 3h20 | 80 pings, about 73 hours |

The prices are the API's multipliers from the prompt caching page. The count leaves out the pings' own output tokens and the messages they add, and the times assume a ping every 4 minutes on a five-minute cache and every 55 on a one-hour one. On a subscription the limit is usage rather than dollars, and the documentation does not say how cache reads count toward it.

## Order and hide

`/statusline:order` opens a pane with three lists. Press a row, drag it, release to drop it. In a narrow pane a long label wraps under itself, and a press anywhere on it picks it up.

- **Lines.** The git and pull request row, the status row, and the lines of the cold-cache fresh start, the smart-zone compaction and the limit forecast sit around the `━━ your prompt ━━` marker, drawn in bold cyan. A line above the marker draws above your prompt. A line below it draws under your prompt, below the hint line. Lines on one side stack in the order listed, so the three offer lines can sit above, under, or between the rows. A drop writes `line_order` and the dropped line's `…_position` option.
- **Git row.** The parts are listed in the order they draw. A drop writes `git_order`.
- **Status row.** The tags are listed in the order they draw. A drop writes `segment_order`.
- **Hidden.** Each list has a dim `╌╌ hidden: switched off ╌╌` marker. Dropping a line, part or tag under it switches it off, which sets its `row_git`, `row_status`, `git_<name>`, `segment_<name>`, `fresh_start`, `compact_hint` or `limit_forecast` option to false, and the pane draws it dim and struck through. Dragging it back above the marker switches it on again. The markers do not drag.
- **Spacers.** Under each hidden marker waits a spacer, dim. Drag it out to add a spacer where you drop it, and another one waits in its place, so you can add as many as you want. Drop a spacer under the marker to take it away. In the git and status rows a spacer pushes tags apart, as described under [Spacing and alignment](#spacing-and-alignment). Among the lines a spacer is a blank line on its side of the prompt. It has nothing of its own to show, so it always draws, even while the offer lines beside it are not showing: a spacer next to the fresh-start line leaves its blank line when the offer is gone.

Each drop writes only the options it changed, one `/config` write at a time. The same options are in `/config`.

## Colours

`/statusline:colors` opens a pane with a field for every colour the mod draws, grouped by what it colours, each after a swatch of how it draws now. That lets you pick colours by what they mean, for example a context bar whose three colours you can tell apart.

- Type a colour as six hex digits, such as `#22d3d8`, with or without the `#`, and press Enter to save it. An empty field, or the default typed out, goes back to the default. A colour that does not read writes nothing and says so.
- A gradient has two fields, its light end and its dark end. The badge of a limit and the mark of a chip sit on the dark end.
- Some colours do more than one job, and the field's label says which. The palette colours the git row's parts in turn and the model's name by family. The cold cache's light end also colours the fresh-start line's `$`. The warnings colour sets the compaction line's diamond and link and the limit forecast's sign.
- The button at the top turns gradients off and on. With them off each gradient draws in its first colour, the model's name does not sweep, and the pane asks for that first colour only. The context bar keeps its three colours, as bands rather than a blend, because each one means something: plenty left, half used, nearly full. A dark end you saved stays saved, and comes back when you turn gradients on again.

Each save writes the `colors` option, a comma list of `name=#rrggbb` with only the colours you changed, and the button writes `gradients`. Both are in `/config` too.

## Spacing and alignment

The `density` option sets how close the tags sit, in three steps:

| `density` | Between the tags | Inside the git row's folders and branch |
|---|---|---|
| `compact` | No space in the status row. The git row keeps one, because its parts have no chips to tell them apart. | No spaces: `spike›cc-mods`, `⎇develop` |
| `standard`, the default | One column | One space: `spike › cc-mods`, `⎇ develop` |
| `roomy` | Two columns, in both rows | One space, as `standard` |

Under `compact` the model name keeps one column after it, because it has no tag of its own to stop it running into the next one.

A row starts at the left edge unless it has spacers. A spacer takes a share of the columns the row's tags leave free, so the tags before it are pushed left and the tags after it right. Spacers next to each other take a share each, so two side by side push twice as hard as one. A spacer is never narrower than the row's gap under `density`, so with no columns free it still shows: no column under `compact` in the status row, one under `standard`, and two under `roomy`. The git row's gap is at least one column, so its spacers are too. Some `segment_order` values:

| Order | Draws |
|---|---|
| `spacer,model,…` | The whole row against the right edge. |
| `model,limit_7d,limit_5h,context,spacer,turns,tokens,cache` | Model, limits and context at the left; turns, costs and cache at the right. |
| `model,tokens,spacer,spacer,limit_7d,limit_5h,spacer,turns,spacer,spacer,cache,context` | Model and costs at the left, cache and context at the right, limits and turns between them. The free columns split 2 : 1 : 2. |
| `model,limit_7d,spacer,limit_5h,context,turns,tokens,cache` | Model and the 7d limit at the left, the rest from the 5h limit on at the right. |

A tag that has nothing to show, such as the costs before the first token count, leaves its spacers meeting. A row too wide for the window wraps between its tags either way, and each wrapped line shares out its own free columns. The lines of the cold cache, the smart zone and the limit forecast always start at the left, because they read as sentences, and wrap between words in a narrow window, a button moving whole to the next line.

Under the prompt, Claude Code does not tell the mod how many rows are left for its lines. With a pane open above the prompt, such as `/statusline:order` in a narrow window, or a prompt of several lines, a row's wrapped line can go missing, and then the whole row. Close the pane, widen the window, or move the row above the prompt, where Claude Code says how many rows the mod has and scrolls a taller drawing.

Spacers replace the `row_git_align` and `row_status_align` options of 0.16.x. Claude Code no longer passes them to the mod once they are gone from the manifest. If you had a row set to `right`, drag a spacer to the top of that row's list.

The `limits` tag of 0.17.0 and earlier is now `limit_7d` and `limit_5h`, and the git row's `path` is now `folders`, `branch` and `worktree`. The pull request's review and comments, once part of `pr`, are now `review` and `comments`. An order saved before keeps the new parts where the old tag stood, with the review and comments after the pull request. Their toggles start on: if you had switched off `segment_limits` or `git_path`, or `git_pr` and want its review and comments off too, drag those parts under hidden again.

`density` replaces the `compact` option of 0.15.0 and earlier, which Claude Code no longer passes to the mod once it is gone from the manifest. If you had `compact` on, set `density` to `compact` in `/config`.

## Options

<img width="2008" height="1050" alt="Statusline prefixed config options" src="https://github.com/user-attachments/assets/41627983-d2ff-4b84-affc-0892ac008550" />

Change these in `/config`, under the plugin. Each title there starts with `Statusline:`.

| Option | Key | Default | What it does |
|---|---|---|---|
| Git row | `row_git` | true | Shows the git row. |
| Git row › position | `row_git_position` | above | Places the git row `above` or `below` the prompt. Below means under Claude Code's hint line. |
| Git row › folders, branch, worktree, pull request, review, comments, ahead and behind, conflict, checks, changes | `git_folders`, `git_branch`, `git_worktree`, `git_pr`, `git_review`, `git_comments`, `git_sync`, `git_conflict`, `git_checks`, `git_changes` | true | One toggle per part of the git row. |
| Git row › order | `git_order` | folders,branch,worktree,pr,review,comments,sync,conflict,checks,changes | The git row's parts, left to right, as a comma list, with `spacer` where a spacer stands. A name left out goes after the one before it in the default order, and the mod ignores an unknown one. See [Spacing and alignment](#spacing-and-alignment). |
| Status row | `row_status` | true | Shows the status row. |
| Status row › position | `row_status_position` | below | Places the status row `above` or `below` the prompt. |
| Status row › model, 7d limit, 5h limit, context, turns, costs, cache | `segment_model`, `segment_limit_7d`, `segment_limit_5h`, `segment_context`, `segment_turns`, `segment_tokens`, `segment_cache` | true | One toggle per tag of the status row. |
| Lines › order | `line_order` | git,prompt,status,fresh,compact,forecast | The order of the lines on each side of the prompt, as a comma list of `git`, `status`, `fresh` for the cold cache, `compact` for the smart zone and `forecast` for the limit forecast, with `spacer` for a blank line and `prompt` between the two sides. A line's side comes from its position option, a spacer's from where it stands against `prompt`. A name left out goes after the one before it in the default order, and the mod ignores an unknown one. |
| Offer a fresh start, Offer a compaction, Limit forecast › position | `fresh_start_position`, `compact_hint_position`, `limit_forecast_position` | below | Places each of these lines `above` or `below` the prompt. |
| Status row › costs › merge | `merge_costs` | false | Draws one `Σ` tag with the cost of the main conversation and its subagents together. Hovering it shows their tokens added up. The bolt tag no longer appears. Before a subagent has run, nothing changes. |
| Status row › order | `segment_order` | model,limit_7d,limit_5h,context,turns,tokens,cache | The status row's tags, left to right, as a comma list, with `spacer` where a spacer stands. A name left out goes after the one before it in the default order, and the mod ignores an unknown one. See [Spacing and alignment](#spacing-and-alignment). |
| Colours › gradients | `gradients` | true | Blends text and bars from one colour to the next, and sweeps the model's name. Set to false, each draws in one colour, as described under [Colours](#colours). |
| Colours | `colors` | | Your colours, as a comma list of `name=#rrggbb`, such as `turns.from=#60a5fa,pr.open=#facc15`. A name left out keeps its default, and the mod ignores an unknown name or a colour that does not read. `/statusline:colors` writes it. |
| Density | `density` | standard | How close the tags sit: `compact`, `standard` or `roomy`, as described under [Spacing and alignment](#spacing-and-alignment). Replaces the `compact` option of 0.15.0 and earlier. |
| Hand off before the cache goes cold | `auto_handoff` | true | Runs `/statusline:handoff` as described under [Handoff](#handoff). |
| Keep the cache warm (pings) | `keep_warm_pings` | 0 | The most pings sent between two of your prompts, 0 for none, as described under [Keeping the cache warm](#keeping-the-cache-warm). The handoff runs after the last one, on a five-minute cache too. |
| Offer a fresh start from the handoff | `fresh_start` | true | Shows the line with the `Start fresh` button once a handoff exists, with the cache cold, or until your next message while the cache is warm. |
| Compact when the smart zone is nearly used | `auto_compact` | false | Runs `/compact` as described under [Status row](#status-row). |
| Offer a compaction when the smart zone is nearly used | `compact_hint` | true | Shows the line with the `Compact` button once the context has used 90% of the smart zone, as described under [Status row](#status-row). |
| Dismissed offers stay hidden (minutes) | `dismiss_minutes` | 0 | How long the cross on the `Start fresh` and `Compact` lines hides its line. 0 hides it for the rest of the session. |
| Smart zone on the context bar | `smart_zone` | true | Set to false, the context bar drops the smart zone. Each cell becomes a full-height block of the context left before auto-compaction. The glyph becomes a moon that fills across the whole window, and `⊙` past the threshold. |
| Smart zone (tokens) | `smart_zone_tokens` | 200000 | The size of the smart zone that the context bar's top half shows. 0 draws the bar as if `smart_zone` were off. |
| Warn when a limit will run out before its reset | `limit_forecast` | true | Shows the line described under [Status row](#status-row) when the 7d or 5h limit would reach 100% before it resets. |
| Turn line › tokens per second | `turn_rate` | true | Shows the tokens per second in the line that closes a turn, as described under [End of turn](#end-of-turn). |

## Needs

- Claude Code 2.1.287 or later, the version that added mods. The mod was built against 2.1.296, and its tests pass on 2.1.304.
- A [Nerd Font](https://www.nerdfonts.com/) in the terminal. The mod uses its glyphs for the subagent bolt, the pull request's draft, review, comment and check marks, the conflict warning, and the `Start fresh` button's icon.
- `git` for the git row, and `gh`, signed in, for the pull request details.

## Where an organization manages Claude Code

Claude Code 2.1.302 passes these events over the plugins you install yourself when it reports that an organization manages it: `prompt.section`, `prompt.context`, `prompt.attachment`, `prompt.compose`, `skill.prompt`, `attribution.text`, `session.compact` and `settings.read`. Only a plugin the organization lists in its managed settings runs hooks on them.

The statusline mod hooks one of them, `session.compact`. When Claude Code reports that condition, `/plugin` shows this on its Errors tab:

```text
statusline @ cc-mods (user)
Its hooks on session.compact do not run here: where an organization manages Claude Code, these events pass over the plugins you install
```

The mod stays active. That hook only hides the `Compact` line while a compaction runs, so without it the line stays on screen during one. I read the rule from the code and have not seen it on a managed machine. I saw the message once on a machine with no managed settings file, and it was gone after a restart. I do not know why it appeared there.

To run the hook, an administrator installs the mod through managed settings under its exact `plugin@marketplace` id, `statusline@cc-mods`. An organization should vet the mod first. [What it reads and sends](#what-it-reads-and-sends) lists everything the mod reads, runs and fetches.

## What it reads and sends

The mod reads the session's transcripts under `~/.claude/projects/` to count tokens and requests. When `$CLAUDE_CONFIG_DIR` is set, it reads `$CLAUDE_CONFIG_DIR/projects/` instead. It also reads the end of every transcript written in the last five hours, to find a limit any of your sessions was refused on. It reads Claude Code's merged settings once, when the session starts, for the `idleCompaction` key. It runs `git` in the project folder.

Over the network, it fetches `https://platform.claude.com/docs/en/about-claude/pricing.md` for the rates. It runs `gh pr view`, which asks GitHub for the branch's pull request. That happens when the branch changes and about once a minute after that, or every 10 seconds while its checks are running or queued. It happens only while the branch is on a remote and is not the default branch. Nothing else leaves the machine.

## License

MIT, see [`LICENSE`](LICENSE). The handoff skill is adapted from Matt Pocock's MIT-licensed `handoff`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).
