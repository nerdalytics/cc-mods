# A reported 100 % is not always used up

**From:** session 2026-10-26, while working on `/opsx:propose` of `limit-texts-count-forward`

The user observed (2026-10-26, Q74) that the API lets work go on while a limit reads 100 %, so the reading can be rounding rather than a used-up limit; this is the user's observation, not checked against a live session or a document. The cockpit treats a 7d reading at 100 % as used up in two places that `limit-texts-count-forward` keeps: `limitOf` draws the 5h as paused whenever the 7d is at 100 % or above (`cockpit/hooks/cockpit.ts:81`, spec "5h paused while the 7d is used up"), and the run-out warning shows only for a limit below 100 % (`forecastOf`, `cockpit/hooks/cockpit.ts:1214`, kept by that change's explanation-row delta). To decide: whether a reported 100 % without a refusal should still pause the 5h, and whether the warning should show `runs out any moment` at 100 % as the explanation now does.
