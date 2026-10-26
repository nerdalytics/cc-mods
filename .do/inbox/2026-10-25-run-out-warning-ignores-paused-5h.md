# The run-out warning can warn about a paused 5h

**Status:** needs-triage
**Change:** `openspec/changes/limit-texts-count-forward/`

Once ticket 08 of limit-pace-gauge lands, the 5h tag draws as paused in the non-classic styles while the 7d is used up (at 100 %, or refused and not yet reset), but the run-out warning in the explanation line still comes from `forecastOf`, which knows nothing of the pause. With the 7d used up and the 5h over pace with a fresh reading, the line can say the 5h runs out before it resets while the 5h tag beside it draws paused, by the ticket 08 implementer's report (2026-10-25, commit 7c009f6). The explanation-row spec of that change says the warning keeps today's wording and today's conditions, so the change leaves it as is. To decide: whether the warning should skip the 5h while the 7d is used up, perhaps in every style since the 5h cannot be spent then, and whether to say instead that the 7d is used up until it resets. Unverified in a live session.

Settled 2026-10-26 at Q70 b, during `/opsx:propose` of `limit-texts-count-forward`: the warning reads each limit as its tag does, so a 5h paused while the 7d is used up does not warn, in every style, and a refused limit counts as used up.
