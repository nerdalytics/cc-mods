# Main specs fail strict validation on long requirements

**Category:** enhancement
**Status:** ready-for-agent
**Change:** limit-texts-count-forward

`openspec validate --specs --strict` fails `cockpit/limit-pace` and `cockpit/explanation-row`, while the same command without `--strict` passes all three specs: the only findings are "Requirement text is very long (>500 characters)" warnings (`MAX_REQUIREMENT_TEXT_LENGTH = 500` in openspec 1.15.0 `dist/core/validation/constants.js:9`), which `--strict` treats as failures. In `limit-pace` they hit requirements[2] "No pace without a usable reading" (562 characters, already 538 before) and requirements[4] "Lanes style" (855 characters, 256 before the `lanes-blocks` sync on 2026-10-26 copied the delta in verbatim); in `explanation-row` requirements[4], which `lanes-blocks` did not touch. The user ruled at Q48 a (2026-10-26) that the split pieces stay in `openspec/specs/cockpit/limit-pace/spec.md` as MODIFIED plus ADDED requirements, each stating one behaviour, rather than moving styles into their own capabilities. The split proposed with that question follows the parts of `lanesCells` (`cockpit/hooks/cockpit.ts:1877`): "Lanes style" keeps the two lanes and the gradient (scenario On par); ADDED "Lanes cells ahead of par" (ahead, ⌈ahead⌉ impacted cells, amber to red; scenarios Usage ahead of par, Ahead of par by two cells, Any spend ahead impacts a whole cell), "Lanes spare cells" (Behind par) and "Lanes overspend on the time lane" (More impacted than the token lane holds, Token lane empty); "No pace without a usable reading" keeps its three conditions and an ADDED "Drawing without a pace" takes the per-style list and the scenario Lanes without a pace. Not yet decided: whether `explanation-row` requirements[4] splits the same way, and the exact requirement texts.

## Triage notes

**What we've established so far:**

- Q50 a (2026-10-26): this note and `2026-10-26-forecast-counts-back-from-reset.md` become one change, since both edit `openspec/specs/cockpit/limit-pace/spec.md` and `openspec/specs/cockpit/explanation-row/spec.md`.
- Q54 a: `explanation-row` "Explanations carry today's hover values" (656 characters) splits into "Every tag has an explanation" and "What each explanation carries".
- Q55 a: `/opsx:propose` drafts the exact requirement texts from the brief, and the user reviews them in the proposal.
- Q64 a: the agent brief for this note and `2026-10-26-forecast-counts-back-from-reset.md` lives in that note, under `## Agent brief`.
