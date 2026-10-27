# Proposal

## Why

The 7d and 5h limit texts count backwards from the reset. In a live session on 2026-10-26 the 7d explanation read "At this pace it runs out 2d15h before it resets." To learn when the limit actually runs out, the reader had to subtract that from "resets in 3d3h", which gives about 11h. The explanations and the run-out warning also use different frames, so the same limit reads two ways. Separately, `openspec validate --specs --strict` fails `cockpit/limit-pace` and `cockpit/explanation-row`, because three of their requirements are over 500 characters. Both problems edit the same two spec files, and the user ruled (Q50 a) that one change fixes both. The decisions come from the triage of `.do/inbox/2026-10-26-forecast-counts-back-from-reset.md` (Q51 to Q64) and `.do/inbox/2026-10-26-specs-fail-strict-on-long-requirements.md` (Q48, Q54, Q55).

## What Changes

- Every limit text, the explanations and the run-out warning alike, takes one frame: `<badge> at <N>%: ...`. It counts forward to the run-out and names the reset by its local clock time, such as `Thu 3 PM`. Example: `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at Thu 3 PM.`
- The cases with their own sentences are over pace, under pace, on pace, no pace (also every reading in `classic`), the 5h paused while the 7d is used up, and a reading without a reset time.
- While the 7d bounds the 5h target below 100 %, the 5h's paced sentences name the 7d, measured at the 5h's pace: when the 7d runs out, how much of the 7d is left when the 5h resets, or that the 7d runs out as the 5h resets.
- The run-out warning shows the over-pace sentence of the limit it warns about. It counts a bounded 5h to its target rather than to 100 %. **BREAKING** for anyone who reads the text: the explanation and warning sentences change wording. No option, layout name or colour changes.
- The over-long requirements are split so that each states one behaviour:
  - In `cockpit/limit-pace`, "Lanes style" becomes four requirements, and "No pace without a usable reading" becomes two.
  - In `cockpit/explanation-row`, "Explanations carry today's hover values" becomes "Every tag has an explanation" and "What each explanation carries".
  - Splitting these does not change the behaviour they describe.

- The run-out warning takes each limit's reading as the tags do (Q70 b). A refused limit counts as used up, and a 5h paused while the 7d is used up does not warn, in every style. This settles `.do/inbox/2026-10-25-run-out-warning-ignores-paused-5h.md`.
- A run-out whose projected time has already passed reads `runs out any moment`, and the warning shows it (Q68).

Decided in the question round after the first draft:
- Q65: a reading without a reset time reads `7d at 30%.` Resets round to the nearest minute before they are formatted, and before deciding whether a reset is today. Noon reads `12 PM` and midnight `12 AM`.
- Q66: the brief's bounded-5h examples are corrected. A 5h at 20 % after 1 h, with k 0.5 and the 7d at 90 %, runs the 7d out in 1h0m, which is 3h0m before the 5h resets. `~5% left` replaces `~3%`, and it uses the 5h at half its window.
- Q67: just over pace (1 < r ≤ 1.05), the warning still fires while the hover says on pace.
- Q69: a reset on today's weekday a week out reads `next Thu 9 AM`.
- Q71: OpenSpec does not let a modified requirement drop scenarios, so the split requirements take new names. "Lanes style" becomes "Lanes token and time lanes", and "No pace without a usable reading" becomes "When a limit has no pace".
- Q72: the release is minor, cockpit 1.5.0.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cockpit/limit-pace`: changes to the limit explanation text, the reset clock, the bounded 5h naming the 7d, and the paused 5h's wording. "Lanes style" and "No pace without a usable reading" are split without changing what they describe.
- `cockpit/explanation-row`: the run-out warning's wording now follows limit-pace. It counts a bounded 5h to its target, and it reads the limits as the tags do. "Explanations carry today's hover values" is split in two.

## Impact

- `cockpit/hooks/cockpit.ts`:
  - `explanations`, `paceWords`, `runOutWarning`, `forecastOf` and `limitOf` change; `limitOf` now also has to expose the 5h target.
  - A new formatter gives the reset clock.
  - `paceOf`, `countdown`, the bars and the colours are unchanged.
- `cockpit/tests/cockpit.test.ts`: the tests that pin today's wording are rewritten for the new sentences.
- `cockpit/README.md`: the status row's limit explanation, the run-out warning paragraph, the 5h target paragraph (which says the warning counts to 100 %, "not its target"), and a new Upgrading entry.
- `cockpit/.claude-plugin/plugin.json`: a version bump.
- At archive, `openspec/specs/cockpit/limit-pace/spec.md` and `openspec/specs/cockpit/explanation-row/spec.md` then pass `openspec validate --specs --strict`.
- Out of scope:
  - the bar and the text disagreeing near par (`.do/inbox/2026-10-26-bar-and-text-disagree-on-pace.md`);
  - the explanations of other tags;
  - bar drawing, colours, and the pace, par and k computations;
  - any time zone other than the hooks', and any `Intl` formatting.
