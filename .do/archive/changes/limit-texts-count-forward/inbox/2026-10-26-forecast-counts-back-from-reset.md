# Limit texts count back from the reset

**Category:** enhancement
**Status:** ready-for-agent
**Change:** limit-texts-count-forward

The user wants the forecast texts of the 7d and 5h limits reworked: counting backwards is not helpful. In a live session on 2026-10-26 (screenshot in the do-it session that ran `/do:apply do-folder-lifecycle`), hovering the 7d tag showed "7d limit: 89% used, resets in 3d3h. At this pace it runs out 2d15h before it resets." That second sentence comes from `paceWords` in `cockpit/hooks/cockpit.ts:1294-1298`, which states the time left in the window when the limit runs out (`(1 - 1/r) * limit.seconds`), so the reader has to subtract it from the reset countdown to learn when the limit actually runs out. From the same numbers and formula, the 7d runs out in about 11h (89% over the 93h elapsed leaves 11% for about 11.5h), 2d15h before its reset in 3d3h. The run-out warning at `cockpit/hooks/cockpit.ts:1315` already leads with "runs out in <time>" and then adds "<time> before it resets", so it carries the same backward figure second. The user has not said which wording they want instead; to decide: whether both texts lead with the time until the limit runs out, whether the backward figure goes entirely, and whether the under-pace sentence ("resets with ~N% unused") changes with them.

## Triage notes

**What we've established so far:**

- Q50 a (2026-10-26): this note and `2026-10-26-specs-fail-strict-on-long-requirements.md` become one change, since both edit `openspec/specs/cockpit/limit-pace/spec.md` and `openspec/specs/cockpit/explanation-row/spec.md`.
- The two texts are, in `GLOSSARY.md` terms, the limit tag's explanation and the run-out warning; the glossary says to avoid "forecast".
- Q51 b: the over-pace explanation leads with the time until it runs out and keeps the backward figure second, as the run-out warning already does: `At this pace it runs out in 11h29m, 2d15h before it resets.`
- Q52 c: the run-out warning keeps its wording (`cockpit/hooks/cockpit.ts:1315`).
- Q53 b: the under-pace sentence, and every other limit text, the 5h's included, aligns with the run-out warning's format; the user wants one format, not several.

- Q56 a: every limit text, explanation and run-out warning alike, takes the warning's frame `<badge> at N%: ...` (over, under, on pace, no pace, 5h paused), with the reset added as a clock time, in the user's example `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at Thursday 3 PM` (or a date such as `29th 3 PM`).
- Q57 c: while the 7d bounds the 5h target, the 5h text names what runs out, e.g. `5h at 20%: at this pace the 7d runs out in X, Y before the 5h resets`; the user wants it computed and finds it very helpful.

- Q58 a: the reset clock reads `Thu 3 PM` (weekday, 12-hour clock), `3 PM` for a reset today, minutes only off the hour (`3:30 PM`); if hooks do not run in the user's local zone, the reset stays a countdown.
- Q59 a: the reset is named by its clock time in every case; only the run-out keeps its countdowns. Over: `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at Thu 3 PM.` Under: `7d at 10%: at this pace it resets at Thu 3 PM with ~83% unused.` On: `7d at 33%: at this pace it reaches its target as it resets at Thu 3 PM.` No pace: `7d at 30%: it resets at Thu 3 PM.` 5h paused: `5h at 40%: it is paused until the 7d resets at Thu 3 PM.`
- Q60 a: the run-out warning gains the reset clock too, so it reads as the over-pace explanation does (this supersedes Q52 c).
- Q61 a: while the 7d bounds the 5h and the 5h is over pace against its target: `5h at 20%: at this 5h pace the 7d runs out in 1h0m, 4h0m before the 5h resets at 3 PM.` The user did not take Q61 c, so the bounded 5h under and on pace are open (Q62).

- Q62 a: while the 7d bounds the 5h, the 5h under and on pace also name the 7d. Under: `5h at 10%: at this 5h pace the 7d still has ~3% left when the 5h resets at 3 PM.` (7d left at the 5h reset = 100 - 7d used - k x (5h used / share passed - 5h used)). On: `5h at 10%: at this 5h pace the 7d runs out as the 5h resets at 3 PM.` Example reading: 5h at 10 % after 2 h, k 0.5, 7d at 90 %: target 30 %, r 0.83, 7d at about 97.5 % when the 5h resets.

- Q63 a: the run-out warning for a 5h the 7d bounds shows the same sentence as that 5h's explanation, whenever the 5h reaches its target before it resets; when both limits qualify, the sooner one still wins.
- Q64 a: one agent brief covers this note and `2026-10-26-specs-fail-strict-on-long-requirements.md`; both are `ready-for-agent`.
- Q66 a (2026-10-26, during `/opsx:propose`): the bounded-5h examples are corrected: over reads `1h0m, 3h0m before the 5h resets`, under uses the 5h at 10 % at half its window for `~5% left`.
- Q67 a: in 1 < r ≤ 1.05 the warning keeps firing while the hover says on pace; the band stays with `2026-10-26-bar-and-text-disagree-on-pace.md`.
- Q68: a run-out whose projected time has passed reads `at this pace it runs out any moment, <time until the reset> before it resets at <clock>.`, and the warning shows it too rather than hiding.
- Q69 a: a reset on today's weekday a week out reads `next Thu 9 AM`.
- Q71 a: OpenSpec forces new names for the split: "Lanes token and time lanes" and "When a limit has no pace".
- Q72 a: minor release, cockpit 1.5.0.
- Q73 a: four tickets in order: unified explanations and reset clock, bounded 5h, run-out warning, release.
- Q65 a: a reading without a reset time reads `7d at 30%.`; resets round to the nearest minute before formatting and before deciding "today"; noon reads `12 PM`, midnight `12 AM`.
- Q70 b: the run-out warning reads each limit as its tag does, refusals folded in and a paused 5h not warning, in every style; this settles `2026-10-25-run-out-warning-ignores-paused-5h.md`.
- Q74 (2026-10-26): a reading at 100 % keeps its paced sentence, `runs out any moment, <time until the reset> before it resets at <clock>.`; the user observed that the API lets work go on at a reported 100 %, so the reading may be rounding rather than a used-up limit.

**Facts found during triage:**
- Fact, settled 2026-10-26 (see the next bullet); the scout's findings were: whether hooks run in the user's local time zone. A scout (2026-10-26) found that local `Date` methods run in hooks (`new Date().toTimeString()` at `cockpit/hooks/cockpit.ts:1491`, `:1502`), but nothing in the repo says whether the zone is the user's or UTC, nor whether `Intl` exists: the types file (Claude Code 2.1.303) says only "no DOM, no Node" and lists no `Intl` (`cockpit/.claude-plugin/types/claude-code/index.d.ts:19-20`, `15451-15587`), and the test kit cannot pin a zone (`TestOptions`, `index.d.ts:16657-16672`; `mock.env` answers `$.env.get` only). Live check for the user: open `/debug:pr-trace` (option `pr_trace`, `debug/hooks/debug.ts:11`) and compare its timestamps, written by those two lines, with the wall clock. If they match, the reset clock can be formatted with `getDay`/`getHours` and no `Intl`; if not, the reset stays a countdown.
- Hooks run in the user's local time zone. The `/debug:pr-trace` pane of a ghe session, pasted by the user, ended at `15:39:23`; `date` on the same machine moments later printed `15:41:15 CET (UTC+0100)`, `14:41:15 UTC`. A UTC hook would have read about 14:39. So local `Date` methods (`getDay`, `getHours`) give the user's clock, and the reset clock needs no `Intl`, whose presence is still unknown.
- Computing Q57 c: while the 7d bounds the 5h, the 5h target is `5h used + (100 - 7d used) / k`, and the 5h reaching it is the 7d reaching 100 %, so the time is `forecastOf`'s formula (`cockpit/hooks/cockpit.ts:1218`) with the target in place of 100. That time is at the 5h's pace, while the 7d's own text uses the 7d's whole-window pace, so the two can disagree (7d at 90 % after 6.5 days reads on pace, while a 5h at 20 % after 1 h with k 0.5 says the 7d runs out in 1h0m); Q61 settles the wording.

## Agent brief

**Summary:** Give every 7d and 5h limit text one format that counts forward and names the reset by its clock time, and split the over-long requirements of `cockpit/limit-pace` and `cockpit/explanation-row` so the specs pass strict validation. This brief also covers `2026-10-26-specs-fail-strict-on-long-requirements.md`.

**Current behavior:**
A limit tag's explanation reads `7d limit: 89% used, resets in 3d3h.` followed by one pace sentence from `paceWords`: on pace `It is on pace to reach its target as it resets.`, under pace `At this pace it resets with ~83% unused.`, over pace `At this pace it runs out 2d15h before it resets.`. A 5h paused while the 7d is used up adds `It is paused until the 7d resets in 2d4h.`. The run-out warning (`runOutWarning`) reads `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets.` and, through `forecastOf`, always counts a limit to 100 %, also a 5h whose target the 7d bounds. The over-pace explanation counts from the reading, while the warning counts from now. `openspec validate --specs --strict` fails on three requirements that are over 500 characters: in `cockpit/limit-pace`, "No pace without a usable reading" and "Lanes style"; in `cockpit/explanation-row`, "Explanations carry today's hover values".

**Desired behavior:**
Every limit text, explanation and run-out warning alike, takes the frame `<badge> at <N>%: ...`, where N is the percent used, rounded as today. The reset is named by its local clock time: the weekday and a 12-hour clock (`Thu 3 PM`), only the clock when the reset falls on the current local day (`3 PM`), and minutes only when the reset is not on the hour (`3:30 PM`). Countdowns remain only for the run-out. The cases:
- Over pace: `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at Thu 3 PM.`
- Under pace: `7d at 10%: at this pace it resets at Thu 3 PM with ~83% unused.`
- On pace (r within 0.05 of 1): `7d at 33%: at this pace it reaches its target as it resets at Thu 3 PM.`
- No pace (no usable reading, or the `classic` style): `7d at 30%: it resets at Thu 3 PM.`
- 5h paused while the 7d is used up (not in `classic`): `5h at 40%: it is paused until the 7d resets at Thu 3 PM.`

While the 7d bounds the 5h (the 5h target below 100 %, as "5h target bounded by the 7d" defines it), the 5h's paced sentences name the 7d, at the 5h's pace:
- Over its target: `5h at 20%: at this 5h pace the 7d runs out in 1h0m, 4h0m before the 5h resets at 3 PM.` The time is when the 5h reaches its target, which is when the 7d reaches 100 %.
- Under: `5h at 10%: at this 5h pace the 7d still has ~3% left when the 5h resets at 3 PM.` The 7d left at the 5h reset is 100 − 7d used − k × (5h used / share passed − 5h used).
- On: `5h at 10%: at this 5h pace the 7d runs out as the 5h resets at 3 PM.`

The run-out warning shows exactly the over-pace sentence of the limit it warns about. For a bounded 5h it warns when the 5h reaches its target before it resets. Otherwise its conditions stay as today: a fresh reading, at least a tenth of the window passed, a limit between 0 % and 100 %, and the sooner limit when both qualify. A hovered explanation and the warning show the same times for the same reading at the same moment, both counted from now.

Implied cases that no triage question asked about. They are listed so that `/opsx:propose` can confirm them: a reading without a reset time drops the reset clause (`7d at 30%.`); a reset is rounded to the nearest minute before formatting, so a reset at 14:59:59 local reads `3 PM`; noon and midnight read `12 PM` and `12 AM`.

Time zone: hooks run in the user's local zone (settled 2026-10-26 by comparing a live `/debug:pr-trace` pane with the system clock; see the triage notes). Format the reset clock with local `Date` methods; do not rely on `Intl`, which no type or doc in the repo promises.

Specs: each over-long requirement splits so that every requirement states one behaviour, all within the same capability files:
- In `cockpit/limit-pace`, "Lanes style" keeps the two lanes and the gradient (scenario On par). Three requirements are added: "Lanes cells ahead of par" (ahead, ⌈ahead⌉ impacted cells, amber to red, with scenarios Usage ahead of par, Ahead of par by two cells and Any spend ahead impacts a whole cell), "Lanes spare cells" (Behind par) and "Lanes overspend on the time lane" (More impacted than the token lane holds, Token lane empty).
- "No pace without a usable reading" keeps its three conditions, and an added "Drawing without a pace" takes the per-style list and the scenario Lanes without a pace.
- In `cockpit/explanation-row`, "Explanations carry today's hover values" splits into "Every tag has an explanation" and "What each explanation carries".
- "Limit explanation text" and "Run-out warning in the explanation line" are rewritten for the format above.

`/opsx:propose` drafts the exact requirement texts, and the user reviews them in the proposal.

**Key interfaces:**
- `paceWords()`: today it returns the pace sentence alone. It (or what replaces it) has to produce the whole unified sentence for every case above, including the bounded-5h cases, from the limit, the reading, the pace and the 7d reading with k.
- `explanations()`: the limit tags' entries become the unified sentence. The other tags' explanations are unchanged.
- `runOutWarning()` and `forecastOf()`: the warning reuses the over-pace sentence. `forecastOf` (or its replacement) counts a bounded 5h to its target rather than to 100 %.
- `paceOf()`: unchanged in meaning. It supplies r, the share passed and the par.
- `countdown()`: unchanged. It is still used for the run-out countdowns. A new formatter gives the reset clock from the ISO `resetsAt`.

**Acceptance criteria:**
- [ ] Each of the five 7d cases above renders exactly the example sentence, for a reading with those numbers and a reset on another local day at 3 PM.
- [ ] A reset later on the current local day renders `3 PM`, without a weekday; a reset at 3:30 PM renders `3:30 PM`; a reset at 14:59:59 local renders `3 PM`.
- [ ] A bounded 5h renders the over, under and on sentences above with the 7d named. The 5h at 10 % after 2 h, with k 0.5 and the 7d at 90 %, renders `~3% left`.
- [ ] For an over-pace reading, the run-out warning text equals the hovered explanation's text.
- [ ] For a bounded 5h that reaches its target before its reset, the warning shows the 7d sentence. When the 7d also qualifies, the warning shows whichever runs out sooner.
- [ ] A reading without a reset time renders `<badge> at N%.` with no reset clause.
- [ ] In `classic`, the limit explanations use the no-pace sentence, and a paused 5h is not mentioned.
- [ ] `openspec validate --specs --strict` passes for all three cockpit specs.
- [ ] The cockpit test suite passes. The scenarios that pin today's wording (for example the run-out warning's ` 5h at 70%: at this pace it runs out in 1h17m, 43m before it resets.`) are updated to the new sentences.

**Out of scope:**
- Whether the warning should skip a paused 5h (`2026-10-25-run-out-warning-ignores-paused-5h.md`).
- The bar marking any spend ahead of par while the text says on pace within 0.05 (`2026-10-26-bar-and-text-disagree-on-pace.md`).
- Explanations of tags other than the two limit tags.
- Bar drawing, colours, and the pace, par and k computations.
- Any time zone other than the one the hooks run in, and any `Intl`-based locale formatting.
