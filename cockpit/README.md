# Cockpit

Gauges for Claude Code that update while you work. It draws two rows around the prompt. It also ships a handoff skill that runs before the prompt cache goes cold.

<img width="1041" height="45" alt="The git row with the project folder, current folder and branch, above the status row with the model, the 7d and 5h limits, the context, prompts, cost and cache" src="https://github.com/user-attachments/assets/a6a36fa3-bc46-4ebc-b493-13feb520410e" />

## Install

In Claude Code:

```text
/plugin install cockpit --marketplace nerdalytics/cc-mods
```

If the `cc-mods` marketplace is not added yet, the command adds it first. [Options](#options) explains each option, and `/config` changes them.

Then install what the mod needs, listed under [Needs](#needs). That is a Nerd Font in your terminal and `git`. For pull request details, also run `gh auth login`.

### Update and remove

In Claude Code:

```text
/plugin marketplace update cc-mods
/reload-plugins
/plugin uninstall cockpit@cc-mods
```

The first command fetches the marketplace and says which plugins it bumped, and `/reload-plugins` loads them into the running session, so you don't need a new one. The last command removes the mod. [Upgrading](#upgrading) lists what changed in the options between versions.

## What it shows

The mod draws rows of tags around the prompt, and under it a line for each of the cold cache and the smart zone when it applies, then the explanation line, which holds the run-out warning. By default a git row sits above the prompt and a status row under it. Any tag can go in any row, and you can add rows. The `layout` option holds the lines, their side of the prompt and each row's tags, and [`/cockpit:order`](#order-and-hide) writes it by dragging. Gaps set a fixed distance between a row's tags, and spacers push them towards the left and right edges. See [Spacing and alignment](#spacing-and-alignment).

### Status row

By default the status row sits under the prompt, below Claude Code's hint line. Its tags, left to right, are named in `layout` as `model`, `limit_7d`, `limit_5h`, `context`, `turns`, `tokens`, `agents` and `cache`. Hovering any of them but the model shows its explanation in the explanation line, from a row on either side of the prompt:

| Tag | Shows | Its explanation |
|---|---|---|
| Model name | The main loop's model. Its colour shows the family, and Mythos is bold. A gradient sweeps across the name, faster the higher the effort of the last request. It stops when that request carried no effort. With the `gradients` option off the name is one colour and does not sweep, so it no longer shows the effort. | |
| `7d`, `5h` | One tag per limit, drawn in the style the `limit_style` option sets. `classic`, the default, draws two bars: the top half is the time left until the window resets, the bottom half the usage left. The other styles draw the pace, the percent used over the share of the window passed: under pace in slate, over pace in amber turning red. `lanes` draws the par left in the top lane and the usage left in the bottom one, the gap between them in the pace colours. `gauge` reads the limit and its percent used in the badge, such as `7d 51%`, and splits the bar at a centre pipe. Under pace it fills left of the pipe by the share of the allowance that would go unused, over pace right of it by the share of the window still to go when the limit runs out, both in half cells. `notch` draws the usage as one lane, with a notch where the par is. A pace needs what the run-out warning needs: a reset time, a response of this session in the last 10 minutes, and a tenth of the window gone. Without one the tag draws no pace colours, and the gauge leaves its cells empty and its pipe dim. Limits belong to your account, so once the API refuses any of your sessions on one, this session shows it used up too, until it resets. Any other window Claude Code reports shows as its name and a percentage after the 5h tag. | The limit, its percent used and the time until it resets, in every style. |
| `◇` `◆` `○` `◔` `◑` `◕` `●` `⊙` | The context window as two bars. The top half is the smart zone left, the first 200,000 tokens by default, where recall is precise. The bottom half is the context left before auto-compaction, at the threshold Claude Code reports. Past the threshold the bottom fills again in red, one full bar per 25% over. The glyph is a diamond inside the smart zone, a moon that fills up beyond it, and `⊙` past the threshold. The badge turns from green to red as the context fills. With the `smart_zone` option off, the bar shows only the context left, in full-height blocks. | The tokens left, out of the tokens the bar runs to. |
| `⏎` | The prompts you sent, then the model requests the main conversation made for them. | What the tag shows, and once a subagent has run, the subagents that ran and the requests they made. |
| `Σ` | What the main conversation cost. | The cost and its tokens. With `merge_costs` on, the main conversation's and its subagents' together. |
| Bolt | The `agents` tag: what its subagents cost. It appears once a subagent has run, unless `merge_costs` adds it to `Σ`. | The cost and their tokens. |
| `●` `◕` `◑` `◔` `○` | Green while the prompt cache is warm, with the time left before it expires and what the next prompt's cached prefix costs to read. The glyph starts full and loses a quarter of its fill for each quarter of the cache's lifetime that passes. Once the cache is cold, the chip turns red and shows an empty `○`, `cold` and what writing the cache again costs. | While green, the time left, what the next prompt reads it for, and what writing the cache again will cost once it is cold. Once red, what writing it again costs. |

Once a handoff file exists, a line appears under Claude Code's hint line while a fresh start from it costs less than the next message in this session. The mod takes the newest `HANDOFF-*.md` at the project root written since this session started, whichever session wrote it. The fresh start is estimated as the session's first prompt plus the handoff file, at four bytes a token, written to the cache. With the cache cold the next message writes the whole conversation to the cache again, so the line shows that price beside the fresh start's estimate. With the cache warm the next message reads the conversation at a 12.5th to an 80th of the write price, depending on the model and the cache's duration, so the line rarely shows. When it does, as when the mod ran a handoff while you were away, it shows the fresh start's estimate alone, and hides when you send your next message. Without prices for the model the line does not show. Neither line appears once the session has moved past the handoff, which happens when the main conversation makes a request more than five minutes after the handoff file was written. The `Start fresh` button next to it clears the session and starts a new one from the handoff file. It hides while Claude is working and while a subagent is still running, and stays while you type, as a reminder. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets.

Once the context has used 90% of the smart zone, another line appears there, `You're nearly out of the Smart zone.`, with `Smart zone` linking to its [definition](https://www.aihero.dev/ai-coding-dictionary/smart-zone) and a `Compact` button that runs `/compact`. Past the smart zone it reads `You're out of the Smart zone. Same model, just into the dumb zone now.`

The wording moves further in as the context grows, on a log scale where each step is half as far again as the last. It says `just into` up to 1.5 times the smart zone, `well into` from 1.5 times, `deep into` from 2.25 times and `very deep into` from 3.375 times. On the default 200,000-token zone those steps fall at 300K, 450K and 675K tokens. The line follows the `smart_zone_tokens` option.

The line stays while Claude works, while a subagent runs and while you type, because the `Compact` button queues `/compact`, which runs once the session is idle. The line disappears while a compaction runs, whoever started it, and comes back if the compaction ends without compacting, for example when you cancel it with Esc. A cross after the button hides it for the rest of the session, or for the minutes the `dismiss_minutes` option sets. The `compact_hint` option turns it off, and with the `smart_zone` option off it never appears.

With the `auto_compact` option on, the mod runs `/compact` itself, without the button. It waits until the session is idle and the context has used 90% of the smart zone, the point where the line appears. It runs once between two of your prompts. Like the handoff, it does not run while a subagent is at work, with a usage limit used up, or with the 5h limit at 98%, or 90% on Fable and Mythos. The option is off by default, because a compaction replaces the conversation with its summary.

The explanation line comes last under the prompt by default. It always takes a line, blank when it has nothing to show, and grows by a line for each line its text wraps onto. Placing `explain` before `prompt` in `layout` moves it above the prompt, and the `explain_row` option turns it off, so it draws nothing at all and hovering a tag shows nothing.

While you hover a tag, its explanation covers whatever the line shows, the run-out warning included, on the grey. The tag itself stays as it is. A long explanation wraps between words, and its further lines draw over what lies below the line rather than moving it, so the band may cut them off at its edge.

When the 7d or 5h limit would reach 100% before it resets, the explanation line shows the run-out warning, such as `5h at 70%: at this pace it runs out in 1h17m, 43m before it resets.` When both limits would, it warns of the one that runs out first. The pace is the one the window has run at since it began, idle stretches included, so a quiet night counts. The figure is the account's, and every session's responses move it. A session hears it only in its own responses, so the warning shows only for a session that got one in the last 10 minutes. The session you are prompting warns, and an idle one stays quiet. It waits until a tenth of the window has passed, because the pace is noise before that. It does not run on a window at 100%, which the bars already show. Turn the warning off with `limit_forecast`, which leaves the explanation line blank until you hover a tag.

### Git row

By default the git row sits above the prompt. Its parts, left to right by default, each with its name in `layout`:

- `folders`: the project folder. When you `cd` elsewhere, the current folder follows it.
- `branch`: the default branch shows bare, and any other branch after `⎇`. A branch made from a branch other than the default shows that branch first.
- `worktree`: the worktree after `⎇`, unless the branch name already contains it.
- `pr`: the pull request, as `PR` and its number in one colour for its state: yellow when open, white as a draft, purple once merged and grey once closed. A draft has a pencil after it.
- `review`: for an open or draft pull request, a check when the review approved it, a cross when changes were requested, and `⋯` when a review is required.
- `comments`: for an open or draft pull request, an envelope and a count for its comments.
- `sync`: `↑` and `↓` with the commits ahead and behind the branch's copy on its remote. A `?` after them means no remote has the branch, so the mod counts against the default branch: origin's, else the first of `develop`, `main` and `master` that exists.
- `conflict`: a warning sign when a merge or rebase is in progress, files are unmerged, the branch is behind and merging the default branch would conflict, or GitHub reports an open or draft pull request as conflicting.
- `checks`: the checks of an open or draft pull request as GitHub draws them. A dot and a count show the running checks, each check that failed or errored gets a cross, and a check and a count show the passed ones.
- `changes`: `+`, `-` and `~` with the lines added, the lines deleted and the files changed, as `git diff HEAD` counts them: untracked and binary files are left out.

The pull request parts need `gh`. The mod asks it only for a branch that a remote has and that is not the default branch, and only while a row shows `pr`, `review`, `comments`, `conflict` or `checks`. It asks again when the branch changes, about once a minute, and every 10 seconds while checks are running.

Outside a repository the row shows only the folders. Within a row, the git parts take the palette's colours in the order they draw.

### Clicking and hovering

A value on a grey background shows more when you hover over it: the tag's explanation, in the explanation line. The `⏎`, `Σ`, bolt and cache tags always stand on the grey, and the 7d, 5h and context bars explain themselves too. A value on no background has nothing more to show. With `explain_row` off there is no explanation line, so no value stands on the grey. A label on indigo between two half blocks, such as `Compact`, is a button, and so is the cross on slate after it. These are the default colours, and [`/cockpit:colors`](#colours) changes them.

The git row is made of links, and a click opens them the way your terminal opens any link:

- The folders, the branch and the worktree open their folder on disk in your default app.
- The pull request's `PR` and number open the pull request.
- `↓` opens the branch's commit history on its remote's website, at `<remote>/commits/<branch>` as GitHub lays it out. A count with `?` has no link.
- A failed check's cross opens that check.
- The running and passed counts open the pull request's checks.

### End of turn

The line that closes a turn, `✻ Cooked for 7s · done 11:22 PM`, gets the tokens per second the turn generated in its verb: `✻ Cooked at 52 tok/s for 7s · done 11:22 PM`. The count is the output tokens of the main conversation's requests in that turn, divided by the turn's length. The input, the cache reads and writes, and a subagent's tokens are not in it. It uses the status row's units: a plain number under 1000, `K` with one decimal and `M` with two. The `turn_rate` option turns it off.

### Costs

Costs are estimates. The mod prices each request in the session's transcripts with Anthropic's published rates. It fetches the rates from the pricing page at the session's first token count, and again at each later count until a fetch succeeds. Fast mode costs twice the rate on the Opus 5 models and Opus 4.8. A `~` before a cost means some requests had no price, and `$?` means none had.

## Handoff

`/cockpit:handoff` writes `HANDOFF-<YYYY-MM-DD-HHMM>.md` at the project's root. The file summarises the conversation so the next session can start from it. If you pass an argument, it names what the next session will focus on, and the summary covers that.

With the `auto_handoff` option on, the mod runs the handoff itself. It waits until the session is idle and the prompt cache is five minutes from expiring, so the handoff still reads the cache at the cheap rate. Unless `"idleCompaction": false` is in `settings.json`, it runs ten minutes before instead. See [Idle compaction](#idle-compaction).

It does this only on a cache that lives an hour. Claude Code gives the main conversation one on a subscription. The mod also counts a cache written for five minutes as an hour's once a request in the session read at least 80% of the request before it back from the cache after more than five idle minutes, with no other request in between. From then on every five-minute cache in the session counts as an hour's. A cache that really lasts five minutes goes cold at every short pause, and writing it again costs little.

It runs once between two of your prompts, counting only prompts you type: a ping or the handoff itself does not start a new stretch. A handoff that fails to start still counts. The automatic handoff passes no focus argument. It does not run in these cases:

- A subagent is pending or running. One that only waits, on a plan's approval or on work listed on its own, does not stop it.
- A turn is running, or you have not sent a prompt in this session. A reload of the mod keeps the time of your last prompt.
- The cache is already cold.
- `keep_warm_pings` is on and has pings left to send.
- A usage limit is used up.
- The 5h limit has reached 98%, or 90% on Fable and Mythos. The rest is left for your own prompts.

The debug mod's `/debug:handoff-trace` pane shows, with the time, why the handoff ran or did not in the minutes before the cache expires. It needs the debug mod's `handoff_trace` option, on by default, and traces nothing while `auto_handoff` is off.

Claude Code can switch the main conversation to five-minute caches on its own. Setting `"promptCacheTtl": "1h"` in `settings.json` keeps the hour-long cache, at the higher hour-long write rate.

After `/compact` the old cache has no use. The cache countdown and the handoff wait for the next request.

### Idle compaction

Claude Code compacts a conversation of 200K tokens or more on its own once the session has been idle for about 54 minutes, before its one-hour cache expires, so the next message does not reprocess it all. `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes the 200K minimum. It is on by default, and `"idleCompaction": false` in `settings.json` turns it off.

A handoff after that compaction would summarise the compacted conversation, not the whole one. So the mod reads `idleCompaction` when the session starts and sets the lead by it, on an hour's cache:

| `idleCompaction` | The handoff and the pings act | Minutes into the hour |
|---|---|---|
| unset or `true` | 10 minutes before expiry | 50 |
| `false` | 5 minutes before expiry | 55 |

The mod makes this choice without checking the conversation's size. Claude Code leaves a conversation under the 200K minimum alone, and the handoff still runs five minutes earlier. The mod reads the setting when the session starts, so a change takes effect in the next session. A five-minute cache keeps its one-minute lead.

Idle compaction does not replace the pings. It makes the next message cheaper by shrinking the conversation, and it empties the cache, as `/compact` does. A ping keeps the cache and the conversation as they are.

### Keeping the cache warm

Claude Code's documentation says it requests the one-hour cache only on a Claude subscription within the plan's included usage. Past the plan's limit, on an API key or on a cloud provider, the main conversation gets five minutes, and subagents get five minutes everywhere. See [which TTL each request gets](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets). On a five-minute cache the handoff above does not run on its own.

The `keep_warm_pings` option, 0 by default, sends minimal prompts of its own to keep the cache warm. It sends one just before the cache expires, up to the number you set between two of your prompts. With `auto_handoff` on, the handoff runs after the last one, on a five-minute cache too. On a one-hour cache a ping goes out five minutes ahead, or ten with idle compaction on, and on a five-minute cache a minute ahead. A read restarts the cache's timer at the read price. The mod times the cache from the later of when the last request was sent and when its answer arrived. See [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

The pings are turns in your conversation. Each adds a short message and a one-word answer to it, and they show in the transcript. They do not run before your first prompt in the session, nor while a turn runs, a subagent is at work or the 5h window is near its limit, the same cases as the handoff. A reload of the mod keeps the time of your last prompt but starts the ping count again. A `/compact` ends them, because it empties the cache.

**Avoid pings where you can.** A fresh session from the handoff starts with a small context, so each message in it costs less and answers sooner than in a long conversation, which the pings only keep warm. The `Start fresh` button does this. A ping is a cache read, so a count of pings costs as much as writing the cache again once at the write price divided by the read price:

| Model | Read price | 5-minute cache, writes at 1.25 times | 1-hour cache, writes at 2 times |
|---|---|---|---|
| Opus 5.5, Sonnet 5.5 | 0.05 times | 25 pings, about 1h40 | 40 pings, about 33 hours |
| Other models | 0.1 times | 12.5 pings, about 50 minutes | 20 pings, about 17 hours |
| Fable 5.1, Mythos 5.1 | 0.025 times | 50 pings, about 3h20 | 80 pings, about 67 hours |

The prices are the API's multipliers from the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing). The count leaves out the pings' own output tokens and the messages they add. The times assume a ping every 4 minutes on a five-minute cache, and every 50 minutes on a one-hour one with idle compaction on, or every 55 with it off. On a subscription the limit is usage rather than dollars, and the documentation does not say how cache reads count toward it.

## Order and hide

`/cockpit:order` opens a pane with two lists. Press a row, drag it, release to drop it. In a narrow pane a long label wraps under itself, and a press anywhere on it picks it up.

- **Lines.** The rows, such as `▤ row 1: folders, branch, worktree and 7 more`, the lines of the cold-cache fresh start and the smart-zone compaction, and the explanation line, sit around the `━━ your prompt ━━` marker, drawn in bold cyan. A line above the marker draws above your prompt. A line below it draws under your prompt, below the hint line. Lines on one side stack in the order listed, so the offer lines and the explanation line can sit above, under, or between the rows.
- **Tags.** The tags list shows every tag under the marker of the row it draws in, such as `━━ row 1 ━━`. Within a row the tags draw left to right in the order listed. Drag a tag under another row's marker to move it there, so the folders can sit beside the model. With `merge_costs` off the costs are two tags, `main session costs` and `subagent costs`. With it on they are one, `total costs`.
- **New rows.** The lines list keeps a `▤ new row` under its hidden marker. Drag it out to where the row should draw, and the mod reserves an empty row there. Its marker appears in the tags list, and you drop tags under it. While the pane is open an empty row draws as a dim `╌╌ empty row: drop tags under its marker ╌╌` line, so you can see where it sits.
- **Hidden.** Each list has a dim `╌╌ hidden: switched off ╌╌` marker. A tag dropped under it is switched off, and the pane draws it dim and struck through. A row dropped under it is gone, and its tags are switched off. An offer line dropped under it sets its `fresh_start` or `compact_hint` option to false, and the explanation line sets `explain_row` to false. Dragging a tag, an offer or the explanation line back above the marker switches it on again. The markers do not drag.
- **Spacers and gaps.** Under each hidden marker waits a spacer, dim, and in the tags list also `gap-1`, `gap-2` and `gap-3`. Drag one out to add it where you drop it, and another one waits in its place, so you can add as many as you want. Drop one under the marker to take it away. In a row a spacer pushes tags apart and a gap sets a fixed distance between them, as described under [Spacing and alignment](#spacing-and-alignment). Among the lines a spacer is a blank line on its side of the prompt. It has nothing of its own to show, so it draws even while the offer lines beside it are not showing, but blank lines that meet draw as one: with the fresh-start offer gone, the spacers before and after it leave a single blank line.

While the pane is open, the rows draw every tag you have switched on, and a tag with nothing to show yet draws made-up values: the limits, context, turns, costs and cache, a branch, worktree, commits ahead and behind, a conflict warning and changes, and a pull request `#42` with a review, comments and checks. That way you can place each tag before it turns up during work. Every blank line draws while the pane is open too, and an offer line that does not apply draws as a dim line naming it, such as `╌╌ smart zone: compaction: shows when it applies ╌╌`, rather than a made-up offer whose buttons would act. A blank explanation line draws a dim line naming it in the same way. The samples need something to draw on: no row draws before Claude Code's first usage reading, and the git parts draw only inside a repository. Closing the pane brings back what there really is.

A drop writes `layout`. Moving an offer or the explanation line across the hidden marker also writes its toggle. Each option is its own `/config` write, so a tag moved from one row to another is one write. The toggles are in `/config` too. `layout` is not, because its long value cut the other rows' labels short there.

## Colours

`/cockpit:colors` opens a pane with a field for every colour the mod draws, grouped by what it colours, each after a swatch of how it draws now. That lets you pick colours by what they mean, for example a context bar whose three colours you can tell apart.

- Type a colour as six hex digits, such as `#22d3d8`, with or without the `#`, and press Enter to save it. An empty field, or the default typed out, goes back to the default. A colour that does not read writes nothing and says so.
- A gradient has two fields, its light end and its dark end. The badge of a limit and the mark of a chip sit on the dark end.
- Some colours do more than one job, and the field's label says which. The palette colours a row's git parts in turn and the model's name by family. The cold cache's light end also colours the fresh-start line's `$`. The warnings colour sets the compaction line's diamond and link and the run-out warning's sign.
- The empty colour greys the bar cells past their end, the values whose hover shows more, and the explanation a hover reveals, which covers the run-out warning beneath it.
- The limit pace group colours the pace in every `limit_style` but `classic`: under pace, over pace from its light end to its dark end, the gauge's pipe, and the dim colour of a limit drawn without a pace.
- The button at the top turns gradients off and on. With them off each gradient draws in its first colour, the model's name does not sweep, and the pane asks for that first colour only. The context bar keeps its colours as bands rather than a blend, because each one means something: plenty left, half used, nearly full, and past auto-compaction. A dark end you saved stays saved, and comes back when you turn gradients on again.

Each save writes the `colors` option, a comma list of `name=#rrggbb` with only the colours you changed, and the button writes `gradients`. Both are in `/config` too.

## Spacing and alignment

Two things stand between the tags of a row: gaps and spacers. Tags with neither between them touch.

- A gap is a fixed distance: `gap-1` is one column, `gap-2` two, `gap-3` three. Gaps side by side add up. The default layout puts `gap-1` between each pair of tags.
- A spacer takes a share of the columns the row's tags leave free, so the tags before it are pushed left and the tags after it right. Spacers next to each other take a share each, so two side by side push twice as hard as one. With no columns free a spacer has no width, so put a gap beside it to keep a distance: `gap-1,spacer` never gets narrower than one column.

A row starts at the left edge unless it has spacers. Inside a tag the spacing stays as it is: one space in the folders and branch, `spike › cc-mods` and `⎇ develop`, and one column between the parts of one tag, such as a pull request's number and its draft mark. Some rows, as `layout` spells them:

| Row | Draws |
|---|---|
| `model,gap-1,limit_7d,gap-1,limit_5h,…` | The default: every tag one column from the next, the row at the left. |
| `model,limit_7d,gap-2,limit_5h,…` | The model touching the 7d limit, two columns before the 5h limit. |
| `spacer,model,gap-1,limit_7d,…` | The whole row against the right edge. |
| `model,gap-1,limit_7d,gap-1,limit_5h,gap-1,context,spacer,turns,gap-1,tokens,gap-1,cache` | Model, limits and context at the left; turns, costs and cache at the right. |
| `model,gap-1,tokens,spacer,spacer,limit_7d,gap-1,limit_5h,spacer,turns,spacer,spacer,cache,gap-1,context` | Model and costs at the left, cache and context at the right, limits and turns between them. The free columns split 2 : 1 : 2. |

A tag that has nothing to show, such as the costs before the first token count, folds away with the gaps around it, and its spacers meet. Between two tags that draw, the widest of the gaps it stood between stays, so `turns,gap-1,tokens,gap-1,cache` with no costs yet leaves one column between turns and cache. Next to a spacer or the edge of the row, none stays. Gaps after the last tag of a row are dropped. A row too wide for the window wraps between its tags either way, and each wrapped line shares out its own free columns. The lines of the cold cache and the smart zone, and the run-out warning, always start at the left, because they read as sentences, and wrap between words in a narrow window, a button moving whole to the next line.

Under the prompt, Claude Code does not tell the mod how many rows are left for its lines. With a pane open above the prompt, such as `/cockpit:order` in a narrow window, or a prompt of several lines, a row's wrapped line can go missing, and then the whole row. Close the pane, widen the window, or move the row above the prompt, where Claude Code says how many rows the mod has and scrolls a taller drawing.

## Upgrading

The mod no longer reads a removed option, so its value is not carried over to what replaced it.

- **1.0.0** renames the mod from statusline (last released as 0.22.3) to cockpit and starts its versions over, as it does more than draw a status line. Claude Code sees a new plugin, so install `cockpit` and run `/plugin uninstall statusline@cc-mods`, which also deletes the old options. The options start from their defaults: set them again in `/config`, `/cockpit:order` and `/cockpit:colors`. The commands are now `/cockpit:order`, `/cockpit:colors` and `/cockpit:handoff`.
- **statusline 0.22.0** replaces the git row's and the status row's options with `layout`: `row_git`, `row_git_position`, `git_order`, the `git_<name>` toggles, `row_status`, `row_status_position`, `segment_order`, the `segment_<name>` toggles, `line_order`, and the offers' `fresh_start_position`, `compact_hint_position` and `limit_forecast_position`. `layout` starts with the arrangement earlier versions drew by default, the git row above the prompt and the status row and the offers under it. If you had changed any of those, set them again with `/cockpit:order`. The offers' `fresh_start`, `compact_hint` and `limit_forecast` toggles stay.
- **statusline 0.19.0** replaces the `density` option with gaps. An order saved before 0.19.0 has no gaps, so its tags touch until you drag gaps in with `/cockpit:order`. `standard` density was `gap-1` between each pair of tags, `roomy` was `gap-2`.
- **statusline 0.18.0** splits the `limits` tag into `limit_7d` and `limit_5h`, and the git row's `path` into `folders`, `branch` and `worktree`. The pull request's review and comments, once part of `pr`, are now `review` and `comments`. An order saved before keeps the new parts where the old tag stood, with the review and comments after the pull request. Their toggles start on: if you had switched off `segment_limits` or `git_path`, or `git_pr` and want its review and comments off too, drag those parts under hidden again.
- **statusline 0.17.0** replaces the `row_git_align` and `row_status_align` options with spacers. If you had a row set to `right`, drag a spacer to the top of that row's list.

## Options

<img width="2008" height="1050" alt="Cockpit prefixed config options" src="https://github.com/user-attachments/assets/41627983-d2ff-4b84-affc-0892ac008550" />

Change these in `/config`, under the plugin. Each title there starts with `Cockpit:`.

| Option | Key | Default | What it does |
|---|---|---|---|
| Layout | `layout` | folders,gap-1,branch,gap-1,worktree,gap-1,pr,gap-1,review,gap-1,comments,gap-1,sync,gap-1,conflict,gap-1,checks,gap-1,changes;prompt;model,gap-1,limit_7d,gap-1,limit_5h,gap-1,context,gap-1,turns,gap-1,tokens,gap-1,agents,gap-1,cache;fresh;compact;explain | The lines around the prompt, top to bottom, split by `;`. A line is `prompt`, `spacer` for a blank line, `fresh` or `compact` for an offer line, `explain` for the explanation line, or a row. Lines before `prompt` draw above your prompt, lines after it under it. A row is a comma list of tags, left to right, with `spacer` where a spacer stands and `gap-1`, `gap-2` or `gap-3` where a gap does. Any tag can go in any row, and an empty row keeps its place until you drop tags into it. The tags after a `hidden` line are switched off. A tag left out goes after the one before it in the default order, a `prompt` left out after the first row, an offer or the explanation line left out last, and the mod ignores an unknown name. A line of nothing but unknown names stays as an empty row, which draws nothing outside `/cockpit:order`. See [Spacing and alignment](#spacing-and-alignment). The `/config` menu does not list it: `/cockpit:order` writes it, and `/config cockpit@cc-mods.layout=…` sets it by hand. |
| Costs › merge | `merge_costs` | false | Draws one `Σ` tag with the cost of the main conversation and its subagents together. Hovering it shows their tokens added up. The bolt tag no longer appears. Before a subagent has run, nothing changes. |
| Colours › gradients | `gradients` | true | Blends text and bars from one colour to the next, and sweeps the model's name. Set to false, each draws in one colour, as described under [Colours](#colours). |
| Colours | `colors` | | Your colours, as a comma list of `name=#rrggbb`, such as `turns.from=#60a5fa,pr.open=#facc15`. A name left out keeps its default, and the mod ignores an unknown name or a colour that does not read. `/cockpit:colors` writes it. |
| Hand off before the cache goes cold | `auto_handoff` | true | Runs `/cockpit:handoff` as described under [Handoff](#handoff). |
| Keep the cache warm (pings) | `keep_warm_pings` | 0 | The most pings sent between two of your prompts, 0 for none, as described under [Keeping the cache warm](#keeping-the-cache-warm). The handoff runs after the last one, on a five-minute cache too. |
| Offer a fresh start from the handoff | `fresh_start` | true | Shows the line with the `Start fresh` button once a handoff exists and a fresh start costs less than the next message here. |
| Compact when the smart zone is nearly used | `auto_compact` | false | Runs `/compact` as described under [Status row](#status-row). |
| Offer a compaction when the smart zone is nearly used | `compact_hint` | true | Shows the line with the `Compact` button once the context has used 90% of the smart zone, as described under [Status row](#status-row). |
| Dismissed offers stay hidden (minutes) | `dismiss_minutes` | 0 | How long the cross on the `Start fresh` and `Compact` lines hides its line. 0 hides it for the rest of the session. |
| Limit tags › style | `limit_style` | classic | How the 7d and 5h tags draw: `classic`, `lanes`, `gauge` or `notch`, as described under [Status row](#status-row). The mod reads any other value as `classic`. |
| 7d bar › length (cells) | `limit_7d_length` | 7 | The number of cells the 7d limit's bar draws. A longer bar shows the same percentage in finer steps. The gauge style splits the length in half, one half to each side of the pipe, rounded down. A fraction is rounded down, and anything under 1 draws 1 cell. |
| 5h bar › length (cells) | `limit_5h_length` | 10 | The number of cells the 5h limit's bar draws, as `limit_7d_length` does for the 7d bar. |
| Context bar › length (cells) | `context_length` | 10 | The number of cells the context bar draws, as `limit_7d_length` does for the 7d bar. |
| Smart zone on the context bar | `smart_zone` | true | Set to false, the context bar drops the smart zone. Each cell becomes a full-height block of the context left before auto-compaction. The glyph becomes a moon that fills across the whole window, and `⊙` past the threshold. |
| Smart zone (tokens) | `smart_zone_tokens` | 200000 | The size of the smart zone that the context bar's top half shows. 0 draws the bar as if `smart_zone` were off. |
| Warn when a limit will run out before its reset | `limit_forecast` | true | Shows the run-out warning in the explanation line, as described under [Status row](#status-row), when the 7d or 5h limit would reach 100% before it resets. Set to false, the explanation line shows no warning. |
| Explanation line | `explain_row` | true | Draws the explanation line, described under [Status row](#status-row), which holds the run-out warning and the explanation of a hovered tag. Set to false, it draws nothing, and no warning or explanation shows anywhere. Dragging the line under hidden in `/cockpit:order` sets it too. |
| Turn line › tokens per second | `turn_rate` | true | Shows the tokens per second in the line that closes a turn, as described under [End of turn](#end-of-turn). |

## Needs

- Claude Code 2.1.287 or later.
- A [Nerd Font](https://www.nerdfonts.com/) in the terminal. The mod uses its glyphs for the subagent bolt, the pull request's draft, review, comment and check marks, the warning sign of the conflict and the run-out warning, and the icons of the `Start fresh` and `Compact` buttons.
- `git` for the git row, and `gh`, signed in, for the pull request details. Only GitHub knows whether the pull request still merges into its base branch after others push to it, so `conflict` needs `gh` too.

## Where an organization manages Claude Code

Where an organization manages Claude Code, it passes these events over the plugins you install yourself: `prompt.section`, `prompt.context`, `prompt.attachment`, `prompt.compose`, `skill.prompt`, `attribution.text`, `session.compact`, `settings.read`, `session.append` for attachment, hook-context and compaction rows and, as of Claude Code 2.1.308, every `classic.*` event. Only a plugin the organization lists in its managed settings runs hooks on them.

The cockpit mod hooks none of them, so Claude Code has none of its hooks to skip there. It sees a `/clear` and a `/compact` through `command.run`. For a compaction Claude Code starts on its own, it watches the main conversation's spinner, which reads `Compacting conversation` while one runs. That text is matched as Claude Code 2.1.310 draws it: in English, whatever the `language` setting. If a release changes it, the `Compact` line stays on screen during those compactions until the mod is updated.

## What it reads and sends

On disk, the mod reads:

- The session's transcripts under `~/.claude/projects/`, or `$CLAUDE_CONFIG_DIR/projects/` when that is set, to count tokens and requests. It searches them with `find` and `grep`.
- The last 256 KB of every transcript written in the last five hours, with `find`, `tail` and `grep`, to find a limit any of your sessions was refused on.
- The list of files at the project root, for `HANDOFF-*.md`.
- Claude Code's merged settings, once when the session starts, for the `idleCompaction` key.
- The repository, with `git` run in the current folder, and whether a merge or rebase is in progress in its git folder.

Over the network, it fetches `https://platform.claude.com/docs/en/about-claude/pricing.md` for the rates. It runs `gh pr view`, which asks GitHub for the branch's pull request, as described under [Git row](#git-row).

Some features send prompts and commands through Claude Code, which sends them to the model as it does yours: the pings, the automatic handoff, `/compact` from `auto_compact` or the `Compact` button, and `/clear` with a prompt from the `Start fresh` button. Nothing else leaves the machine.

## License

MIT, see [`LICENSE`](LICENSE). The handoff skill is adapted from Matt Pocock's MIT-licensed `handoff`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).
