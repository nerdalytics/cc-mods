# Proposal

## Why

Today the 7d and 5h tags show how much of each limit is used and how much time is left. They don't show whether the limit is on pace to be used up exactly at its reset. A separate forecast line warns only once a limit will run out early. The 5h and 7d limits are also coupled: a busy 5h window spends the 7d. So the 5h tag can't judge its pace on its own. The prototype (`.do/prototypes/pace-gauge.md`) settled how to fold the pace into the limit tags. It also settled how to bound the 5h target by what the 7d can still pay for.

## What Changes

- New `limit_style` option for both limit tags:
  - `classic`, the default, is today's two-lane bar, unchanged.
  - `lanes` (prototype M1) is today's two lanes. The top lane is par, and the gap between par and usage is coloured.
  - `gauge` (prototype M2) puts the percent used in the badge. The bar shows only the pace, either side of a centre pipe.
  - `notch` (prototype M3) is one usage lane with a par notch.
- The pace is r = percent used / (share of the window passed × target). Under pace (r < 1) draws slate. Over pace (r > 1) draws amber, turning red.
- The 7d target is 100 %. Its par is spread over calendar time, nights included.
- The 5h target is what the 7d can still pay for, at most 100 %. The 5h par is the time since its window began.
- k is the 7d percent that 1 % of 5h costs. It is measured from readings the mod already receives, with no setting. Until k is measured, the 5h tag draws uncoupled.
- While the 7d is used up, the 5h tag draws as paused until the 7d resets.
- New number options for the length of the 7d, 5h and context bars. Each takes any whole number from 1 up. The defaults are 7, 10 and 10, today's lengths.
- **BREAKING (released as minor, by the user's decision)**:
  - Hover texts leave the tags: limits, context, prompts, costs, subagents and cache. Each tag joins a hover `scope`, and hovering it reveals its text in a new explanation row.
  - With nothing hovered, the row shows the run-out warning when one applies. Otherwise it is a blank line, which stays in place.
- **BREAKING (released as minor, by the user's decision)**:
  - The `forecast` line is removed from `layout` and `/cockpit:order`, and the new `explain` line replaces it. `forecast` has no alias. A saved `layout` that names `forecast` keeps that line as an empty row, which draws nothing outside `/cockpit:order`, and `explain` goes last.
  - A new `explain_row` toggle (default true) switches the row. Dropping the row under hidden in `/cockpit:order` writes `explain_row`. `limit_forecast` now gates only the warning inside the row.
- Delete `cockpit/prototype-pace.mjs`.
- Release as cockpit 1.2.0. Root `README.md:22` would make the two breaking items a major release. The user chose minor anyway, and the README's Upgrading note records the change.

## Capabilities

### New Capabilities
- `cockpit/limit-pace`: how the 7d and 5h tags measure and draw pace. Covers the styles, the pace ratio, each limit's target and par, the 5h coupling via k, and the paused state.
- `cockpit/explanation-row`: the line that shows the hovered tag's explanation, or the run-out warning, in a fixed slot of `layout`.
- `cockpit/bar-lengths`: the options that set the length of the 7d, 5h and context bars.

### Modified Capabilities
- None. `openspec/specs/` holds no specs yet.

## Impact

- `cockpit/hooks/cockpit.ts`:
  - The limit drawing (`LIMITS`, `limitParts`) and the forecast code (`forecastOf`, `forecastLines`).
  - `LINES`, `LINE_TOGGLES` and `LABELS`, plus the layout default.
  - `chipParts` and `contextParts`, whose hovers move out.
  - `CONTEXT_CELLS`, `COLORS` and `withSamples`.
- `cockpit/.claude-plugin/plugin.json`:
  - New options `limit_style`, `limit_7d_length`, `limit_5h_length`, `context_length` and `explain_row`.
  - Updated `layout` and `limit_forecast` descriptions, and the version bump.
- `cockpit/README.md`: the status row, hovering, forecast, order pane, colours, options, Upgrading and Needs.
- `cockpit/types/index.d.ts`: the new `paceK` state key.
- `cockpit/tests/cockpit.test.ts`: the forecast cases and the hover assertions.
- Engine API: `hover.scope` on `Box` (`cockpit/.claude-plugin/types/claude-code/index.d.ts:898`). The bundled types, written by Claude Code 2.1.303, carry it. The README's minimum is 2.1.287, and support at that version is unconfirmed.
- Out of scope: the separate Fable weekly limit (`.do/inbox/2026-10-25-fable-weekly-limit.md`).
