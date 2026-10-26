# The lanes bar and the explanation disagree near par

**Status:** needs-triage

Since cockpit 1.4.0, `lanes` marks any spend ahead of par as at least one impacted cell (`Math.ceil` in `lanesCells`, `cockpit/hooks/cockpit.ts:1883`), while the explanation says "It is on pace to reach its target as it resets." whenever r is within 0.05 of 1 (`paceWords`, `cockpit/hooks/cockpit.ts:1295`; spec "Pace ratio" in `openspec/specs/cockpit/limit-pace/spec.md`). At r = 1.03 the bar shows an amber cell and the text says on pace. The `lanes-blocks` proposal left this out of scope (`openspec/changes/archive/2026-10-26-lanes-blocks/proposal.md:37`). To decide: whether the bar honours the 0.05 band, the text drops it for `lanes`, or the two stay apart on purpose.
