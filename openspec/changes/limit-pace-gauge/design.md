# Design

## Context

See proposal.md for the why, and `.do/prototypes/pace-gauge.md` for the verdict this change implements. Current state, in `cockpit/hooks/cockpit.ts`:

- **Limit tags.** `limitParts` (1658-1682) draws both limit tags. `LIMITS` (327-330) fixes their lengths at 7 and 10 cells, and `CONTEXT_CELLS` (314) the context bar's at 10.
- **Hover overlays.** Each hover value is an absolute `display: "none"` Box, revealed by its tag's keyed Box (`hoverOver`, 1794). `chipParts` (1703-1719) pads a chip's value to the width of its hover value so the overlay fits.
- **Forecast line.** `forecastLines` (1127-1142) is the `forecast` line in `LINES`/`LINE_TOGGLES` (98-101), toggled by `limit_forecast`. `forecastOf` (1115-1123) gates it on `FORECAST_FRESH_MS` (10 min) and `FORECAST_FROM` (a tenth of the window).
- **Layout.** `layoutOf` (114-141) drops unknown names and appends a missing line last.
- **Readings.** `session.measure` (670) and `poll` (924) write `USAGE` to `$.state`, which is session-scoped: "the named values plugins keep in the session" (`cockpit/.claude-plugin/types/claude-code/index.d.ts`). `limitsOf` (1033) turns a refusal still in force into 100 %.
- **Hover scope.** The engine's `hover.scope` names a plugin-wide hover group that "in any site, lights while any is hovered, reveals included" (`index.d.ts:891-898`).

## Goals / Non-Goals

**Goals:**
- Pace computed in one pure function, used by every non-classic style and by the limit explanations.
- One explanation line, built from the same snapshot the rows draw from, revealed by scope from tags in any row on either side of the prompt.
- `classic` draws byte-for-byte what 1.1.0 drew for the bars themselves.

**Non-Goals:**
- Persisting k across sessions or `/clear`.
- A setting for k.
- The Fable weekly limit (`.do/inbox/2026-10-25-fable-weekly-limit.md`).
- Explanations for tags that had no hover before: the model and the git tags.

## Decisions

### Style values are words, not prototype labels
`limit_style` takes `classic | lanes | gauge | notch`, and `/config` shows them. M1/M2/M3 mean nothing outside the prototype. It is a string option, as `layout` and `colors` are. An unknown value reads as `classic`, matching how `layoutOf` and `overridesOf` ignore what they cannot read.

### One `paceOf`, reusing the forecast gates
`paceOf(limit, found, readAt, now, target)` returns `{ r, share }` or `undefined`. The gates are the ones `forecastOf` has: a reset time, a reading fresh within `FORECAST_FRESH_MS`, and at least `FORECAST_FROM` of the window passed. Both read the same constants, so the gauge and the warning never disagree about whether a pace exists. `forecastOf` stays as it is and feeds the warning.
- Alternative: draw a pace from the first reading. Rejected, because the forecast tests (`cockpit.test.ts:669-700`) already encode "early in a window, the pace is noise".

### Window start from the reset time
Both windows begin at `resetsAt − length`. The prototype found the 5h window is not on a clock grid, and how its start is rounded is unknown. Deriving the start from `resetsAt` avoids the question entirely: the share passed is `1 − (resetsAt − now) / length`.

### k in session state
A new state key `PACE_K` (`paceK`, typed in `PluginState` in `cockpit/types/index.d.ts`) holds `{ k?, base? }`. `base` is `{ reset5h, reset7d, p5, p7 }`, the first reading of the current 5h window. The update runs wherever `USAGE` is written:
- When `reset5h` or `reset7d` differs from `base`, replace `base` with the current reading. A 7d reset inside the window thus yields no sample.
- Otherwise, when `p5 − base.p5 ≥ 10`, set `k = (p7 − base.p7) / (p5 − base.p5)` when that is positive.

Why 10 points: `percentUsed` has at most one decimal (`SessionRateLimit`, `index.d.ts`). At a k near 0.1, a 10-point 5h rise moves the 7d about 1.0, so its ±0.05 rounding is about ±5 % of k. A 5-point rise would double that.

Because `$.state` is per session, k is lost at each new session and each `/clear`, and the 5h draws uncoupled until 10 points of 5h are used again. That is accepted for now.
- Alternative: a file under the config dir. Rejected for now, since no one asked for k to outlive a session and it adds file I/O and a format.

### Explanation line built from a shared snapshot
- **Snapshot.** Pull `drawRow`'s state reads (817-834) into `snapshotOf($, ordering)`. `drawRow` and the new `explainLine` both call it.
- **Text.** `explanations(s)` returns `Partial<Record<StatusTag, string>>`, one sentence per tag that has something to say.
- **Tags.** Each tag's keyed Box gains `hover: { scope: "explain-<tag>" }`, and its own `hoverOver` child is removed.
- **The line.**
  - A Box of height 1, width 100 %, `overflow: "hidden"`.
  - Its base child is the run-out warning (`limit_forecast` on), else the dim order-pane label while ordering, else nothing.
  - Then one absolute Box per explanation, at top 0 and left 0, width 100 %, `display: "none"`, `hover: { scope, display: "flex" }`.
  - Each overlay has `backgroundColor` set to the `empty` grey, so it covers the warning beneath it. Its Text uses `wrap: "truncate-end"`.
- Alternative: padding the text with spaces to `bodyColumns` instead of a background. Rejected, because the types do not say whether a space cell paints over a glyph beneath it. The grey also matches the README's rule that a value on grey reveals more (`README.md:82`).

### Chips size to their value
Once the hover value no longer lays over the chip, `chipParts` pads to the value's width only. The grey background stays whenever the tag has an explanation.

### `explain` replaces `forecast` in `LINES`
- `LINES` becomes `["fresh", "compact", "explain"]`, and `LINE_TOGGLES.explain` is `"explain_row"`.
- `LABELS.explain` is "explanation line", and the order pane's text at 575 is updated.
- `forecast` has no alias (the user's decision). `layoutOf` stays as it is. It turns a line of only unknown names into an empty row (121-130: such a line falls to the last `else`, which pushes `[]`), so a saved `;forecast` becomes an empty row and `explain` is appended last. The empty row draws nothing: `rowOf` returns `undefined` for a row with no parts (912), and `drawLines` (790-814) skips it without ending a run of blank lines, so the blank lines around it still draw as one. `/cockpit:order` lists it as `▤ row N: empty`, where the person can drop it under hidden.
- The `drawLines` blank-line merging must not treat the explanation line as a spacer. It always draws its one line.

### Lengths as module options
- `register` reads `limit_7d_length`, `limit_5h_length` and `context_length` as `Math.max(1, Math.floor(n))`, falling back to the defaults. These replace `LIMITS[].segments` and `CONTEXT_CELLS`.
- `LIMITS` keeps `kind`, `badge` and `seconds`, and the length is looked up by badge.
- `gauge` draws `floor(n / 2)` cells, the pipe, then `floor(n / 2)` cells.

### Paused 5h
The 7d counts as used up when the 7d returned by `limitsOf` is at 100 % or more, which includes a refusal still in force. The 5h then draws as paused in non-classic styles, with all cells `empty`, and its explanation says so. `classic` bars are unchanged.

### Colours
New `COLORS` entries under one group, "Limit pace", with defaults from the prototype:
- `pace.under` slate [148,163,184];
- `pace.over.from` amber [251,191,36] and `pace.over.to` red [239,68,68];
- `pace.par` [229,231,235], for the pipe and the notch;
- `pace.none` [107,114,128], for usage drawn without a pace.

The `/cockpit:colors` pane lists them automatically from `COLORS`.

### Order-pane samples
While ordering, `withSamples` already invents limit readings. Pace styles also need a fresh read time. In ordering mode, the snapshot treats the reading as fresh so the samples show a pace.

## Risks / Trade-offs

- [k unknown for the first 10 points of each session's 5h] → The 5h draws uncoupled (target 100). That is no worse than today, and the README says so.
- [A long explanation's cut, and the overlay covering the warning, are verified only against the types, not a live terminal] → A manual check in Claude Code is part of the tasks. If the grey band looks wrong, the fallback is the space padding.
- [A 7d reset inside a 5h window] → That pair is discarded. A reset that lands between `base` and a later reading resets `base`, so no mixed sample is taken. This was not tested against real data (prototype "Not verified").
- [`hover.scope` minimum version] → Local types show it in 2.1.307 and 2.1.310. The README's Needs says 2.1.287. If the earliest version with scope cannot be confirmed, Needs is raised to 2.1.307.
- [Saved layouts with `forecast` lose its position] → The user chose no alias. The README's Upgrading section names it.
- [Released as minor despite changed hover behaviour and a dropped layout name] → This contradicts root `README.md:22`, by the user's explicit decision. The Upgrading note records it.

## Migration Plan

- Ship as cockpit 1.2.0, the version bump in its own commit as past releases did (`git log`: "Release cockpit 1.1.0").
- A layout naming `forecast` re-derives on load, with no write needed.
- Rollback: reinstall 1.1.0. It ignores the new options and re-appends `forecast`, but its `layoutOf` turns `explain` into an empty row. That row is invisible outside `/cockpit:order`, and the person removes it there by dropping it under hidden.

## Open Questions

- The earliest Claude Code version with `hover.scope`. This decides only the Needs line.
