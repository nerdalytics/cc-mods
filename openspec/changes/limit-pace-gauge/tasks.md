# Tasks

Tests reach the mod only through `claude-code/testing`, so every test below asserts drawn output: cell colours, badges, and the overlay text, which is in the tree even while `display: "none"`. None calls a function directly.

Checks used below:
- `tsc -p cockpit --noEmit`;
- `claude plugin test cockpit`;
- `claude plugin validate cockpit`.

## 1. Bar lengths

- [ ] 1.1 Add `limit_7d_length` (7), `limit_5h_length` (10) and `context_length` (10) to `cockpit/.claude-plugin/plugin.json`, as `number` with `min: 1`. Each description says the number is the bar's cells, and how the gauge style splits it. Verify `claude plugin validate cockpit` passes.
- [ ] 1.2 In `cockpit.ts`, read the three options in `register` as `Math.max(1, Math.floor(n))`, falling back to the default when the value is not a number. Use them in place of `LIMITS[].segments` and `CONTEXT_CELLS` in `limitParts` and `contextParts`. Remove the 7-cell countdown-fit comment at 1656-1657. Verify tsc passes.
- [ ] 1.3 Add tests:
  - the defaults draw 7, 10 and 10 `▀` cells;
  - `limit_7d_length: 14` draws 14;
  - `context_length: 0` draws 1.

  Verify `claude plugin test cockpit` passes.
- [ ] 1.4 Add the three options to the README's Options table, and update the status-row text that names the lengths. Verify by reading the rendered table rows.

## 2. Explanation line replaces the forecast line

- [ ] 2.1 In `plugin.json`:
  - add `explain_row` (boolean, default true);
  - change the `layout` default to end in `fresh;compact;explain`;
  - in its description, name `explain` instead of `forecast`;
  - make `limit_forecast`'s description say it gates only the warning in the explanation line.

  Verify `claude plugin validate cockpit` passes.
- [ ] 2.2 In `cockpit.ts`, make these changes. Verify tsc passes.
  - `LINES` becomes `["fresh", "compact", "explain"]`, and `LINE_TOGGLES.explain` is `"explain_row"`.
  - `LABELS`: drop `forecast`, add `explain`.
  - Update the order pane's lines text (575) so it no longer says the limit forecast shows only when it applies.
- [ ] 2.3 Replace `forecast` with `explain` in the test layout strings: `withGit` and `withStatus` (`cockpit.test.ts:63-64`) and the literals at 317, 332, 475 and 650. Because the explanation line always draws, update the `PromptHint` assertions that count or index lines. Verify `claude plugin test cockpit` passes.
- [ ] 2.4 Extract `snapshotOf($, ordering)` from `drawRow` (817-834), and keep `drawRow` drawing the same rows. Verify the existing row tests pass unchanged.
- [ ] 2.5 Add `explanations(s)`, returning one sentence per tag with something to say: `context`, `turns`, `tokens` (merged when `merge_costs` is on), `agents`, `cache`, and both limits. Each sentence carries at least today's hover value (spec: explanation-row, "Explanations carry today's hover values"). Limits get the badge, percent used and reset countdown for now; group 3 adds pace. Verify with a test that, at 120,000 tokens left, the context overlay in the explanation line holds `120.0K`.
- [ ] 2.6 Add `explainLine($, ui)` and route `explain` to it in `drawLines`. The line's structure is in design.md, "Explanation line built from a shared snapshot". The base child is the warning when `limit_forecast` is on, from the existing `forecastOf`, showing the limit that runs out sooner. While ordering with no warning, the base child is the dim label. Make sure the blank-line merging never drops the line. Remove `forecastLines`. Verify tsc passes.
- [ ] 2.7 Give each of those tags' keyed Box `hover: { scope: "explain-<tag>" }`. Remove the `hoverOver` children from `limitParts`, `contextParts` and `chipParts`. Pad chips to the value's width only, and keep the grey when the tag has an explanation. Verify tsc passes.
- [ ] 2.8 Rewrite the forecast tests (`cockpit.test.ts` 650-700) against the explanation line. Cover:
  - same wording and same five gate cases;
  - above the prompt when `explain` precedes `prompt`;
  - a saved layout naming `forecast` draws `explain` last;
  - `explain_row: false` draws no line;
  - `limit_forecast: false` leaves a blank line;
  - with both limits running out early, the sooner one shows.

  Verify `claude plugin test cockpit` passes.
- [ ] 2.9 Add tests:
  - each listed tag's Box carries its `scope`;
  - the explanation line holds one `display: "none"` overlay per explanation with the matching scope;
  - no tag draws an absolute overlay of its own any more.

  Update any test that found a hover value inside a tag. Verify `claude plugin test cockpit` passes.
- [ ] 2.10 Test the order pane:
  - dropping `explain` under hidden writes `explain_row` false;
  - dragging it back writes true;
  - while the pane is open, the blank line draws its dim label.

  Verify `claude plugin test cockpit` passes.
- [ ] 2.11 Update the README:
  - line 33 and the status-row table's "On hover" column;
  - the forecast paragraph (59), now the explanation line;
  - "Clicking and hovering" (80-82);
  - "Order and hide" (160-166), for the `explain` line and `explain_row`;
  - "Colours" (176), and line 198;
  - the Options table, for `layout`, `limit_forecast` and `explain_row`.

  Verify that `grep -rn forecast cockpit debug` shows only `limit_forecast` and the warning's wording.

## 3. Pace styles

- [ ] 3.1 Add the `pace.under`, `pace.over.from`, `pace.over.to`, `pace.par` and `pace.none` entries to `COLORS` under the group "Limit pace", with the defaults in design.md. Verify that `/cockpit:colors` lists them, with a test that mounts the pane and finds the group heading.
- [ ] 3.2 Add `limit_style` to `plugin.json` (string, default `classic`, with a description of the four values). In `register`, read it, with any unknown value as `classic`. Verify `claude plugin validate cockpit` and tsc pass.
- [ ] 3.3 Add `paceOf(limit, found, readAt, now, target)` with the `FORECAST_FRESH_MS` and `FORECAST_FROM` gates. Window start is `resetsAt − seconds`. It returns `{ r, share }`, where share is (1 − r) under pace and (1 − 1/r) over. Verify through tasks 3.4 and 3.5, whose drawn output depends on it.
- [ ] 3.4 Draw `lanes`, `gauge` and `notch` in `limitParts`, as the spec says, with `pace.none` when there is no pace. `classic` stays on today's code path. Verify with tests:
  - `classic` cell colours match 1.1.0's for one reading;
  - the lanes scenario at 51 % / par 33 % on 7 cells;
  - gauge widths of 5 + pipe + 5 at length 10, and 3 + pipe + 3 at length 7, with the gauge badge `7d 51%`;
  - the notch at cell 5 for par-left 67 % on 7 cells.
- [ ] 3.5 Add the pace words to the limit explanations: on pace, `~N% unused`, or how long before the reset it runs out. Verify with tests on the 7d overlay text:
  - over pace at 51 % with a third gone;
  - `~83% unused` at 10 % with 60 % gone;
  - no pace words when early or stale.
- [ ] 3.6 Make `withSamples` readings count as fresh while ordering, so the pace styles show a pace in `/cockpit:order`. Verify with a test that, with the pane open and `limit_style: gauge`, the 5h gauge has filled cells.
- [ ] 3.7 Update the README: the limit row in the status-row table, a paragraph on the four styles and the pace colours, the Colours section, and `limit_style` in the Options table. Verify by reading the section.

## 4. 5h coupled to the 7d

- [ ] 4.1 Add the `paceK` entry to `PluginState` in `cockpit/types/index.d.ts`, then the `PACE_K` state key and its update where `USAGE` is written (`session.measure` at 670, `poll` at 924, and `refresh`). Follow the design: `base` resets on a change of either reset time, and a sample needs a 5h rise of at least 10 points and a positive k. Verify with tests that feed a sequence of `session.usage` stubs, then read the 5h gauge or its overlay text:
  - 10→25 with 40.0→41.5 gives k = 0.1;
  - 10→14 gives no update;
  - a changed 7d reset gives no sample.
- [ ] 4.2 Compute the 5h target as min(100, p5 + (100 − p7) / k) when k is known and the 7d resets after the 5h window ends, else 100. Pass it to `paceOf` for the 5h. Verify with tests on the 5h gauge's fill, after `session.usage` stubs that measure the given k:
  - k 0.5, 5h 20 %, 7d 90 % gives a target of 40;
  - a 7d that resets first gives 100;
  - no k gives 100.
- [ ] 4.3 Draw the 5h as paused in non-classic styles while the 7d from `limitsOf` is at 100 % or more: all cells `empty`. The 5h explanation then says it is paused until the 7d resets, in `countdown` form. Verify with tests for both cases: a 7d at 100 %, and a 7d refusal on record.
- [ ] 4.4 Document in the README the coupling, k and its per-session measurement, the 10-point minimum, and the paused state. Verify by reading the section.

## 5. Release

- [ ] 5.1 Find the earliest Claude Code version whose plugin types have `hover.scope`, from the bundled `plugin-authoring/types/claude-code.d.ts` of available versions or the changelog. Raise the README's Needs from 2.1.287 if needed, to 2.1.307 when nothing earlier is confirmed. Verify that the Needs line names a version with `scope` in its types.
- [ ] 5.2 Add a 1.2.0 entry to the README's Upgrading section. It names the removed `forecast` layout name and where `explain` lands. It says a saved `forecast` line stays as an empty row, which draws nothing, and that `/cockpit:order` can drop it under hidden. It says the hover texts moved to the explanation line, and that the release is minor by choice. Verify by reading it.
- [ ] 5.3 Delete `cockpit/prototype-pace.mjs`. Verify with `git status`.
- [ ] 5.4 Run the integration checks: `tsc -p cockpit --noEmit`, `claude plugin validate cockpit` and `claude plugin test cockpit`. Then in a live Claude Code session, check each of these and note the result in the change:
  - hovering each tag reveals its text in the explanation line, from a row above and from one below the prompt;
  - a revealed text fully covers the warning;
  - a long text is cut, not wrapped;
  - each style draws.
- [ ] 5.5 Bump `cockpit/.claude-plugin/plugin.json` to 1.2.0 in its own commit, "Release cockpit 1.2.0". Verify with `git log -1 --stat`.

## Workflow follow-up

- Archive the change once reviewed. That creates `openspec/specs/cockpit/{limit-pace,explanation-row,bar-lengths}/spec.md`.
