# Hover text spills past a short tag's right edge

**Status:** wontfix

Since cockpit's bar lengths became options (limit-pace-gauge ticket 01, commit 4f97e9d), a bar can be shorter than its hover text. The hover overlay is clamped so it never starts left of its tag (`hoverOver` in cockpit/hooks/cockpit.ts), but text wider than the whole tag still paints past the tag's right edge, over the gap and the next tag: a 1-cell 5h tag is 5 columns and its countdown "2h45m " is 6, and a 1-cell context tag is 4 columns and "999.0K " is 7 (review of 97cbb8e..4f97e9d, cockpit/hooks/cockpit.ts:1805). Ticket 03 of the same change moves every hover text into the explanation line and removes these overlays, which ends the spill; if ticket 03 does not land, cut the hover text to the tag's width (badge width plus cells) and pin it with a test.

Closed 2026-10-26 as already implemented, at the user's word that it is gone: the per-tag hover overlays this note describes no longer exist. Commit af7dafa ("Move the tags' hovers into the explanation line") removed them, and every tag's hover text now draws in the full-width explanation line under the status row, so a short tag has nothing to spill past.
