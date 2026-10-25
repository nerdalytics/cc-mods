# Prototype: the limit tags' pace gauge

**Question:** how should cockpit show whether the 5h and 7d limits are on pace to be used up exactly at their reset, without a separate forecast line?

**Code:** `cockpit/prototype-pace.mjs`, a throwaway terminal script, not tracked. Run it with `node cockpit/prototype-pace.mjs [k=0.1]`; ← → switch variants. Delete it once the winner is folded into `cockpit/hooks/cockpit.ts`.

## Rounds

1. **Separate `pace_5h` and `pace_7d` tags, each limit on its own.**
   - A: fill out from a centre pipe.
   - B: a spirit-level dot.
   - C: both limits as two lanes of one tag.

   The user then pointed out two things. The 5h and 7d limits are coupled. And the existing limit tags become redundant next to a separate gauge.
2. **Merged into the existing `limit_7d` and `limit_5h` tags, with the 5h target bounded by the 7d.**
   - M1: today's two lanes, the top lane par, the gap coloured.
   - M2: the percent used in the badge, the bar only the pace.
   - M3: one usage lane with a par notch.

## Verdict

- **Styles.** All of M1, M2 and M3 stay, chosen by one option for both limit tags. Today's look stays the default, so the release is a minor one under Compatible Versioning (root `README.md`, line 22).
- **Pace.** r = percent used / share of the window passed. Below 1, (1 - r) of the allowance goes unused. Above 1, the limit runs out with (1 - 1/r) of the window still to go. Under pace draws slate, over pace amber turning red.
- **7d par.** Spread over calendar time, nights included, as the forecast line did (user's answer Q4 a).
- **5h window.** It starts with the first request after the previous window ended, not on a clock grid (user's account). One idle case in the user's transcripts fits: the last request was at 18:46:08 UTC and the next at 20:01:07 UTC. The notice said "resets 3am (Europe/Warsaw)", which puts the window's start at 20:00 UTC. Whether that start is rounded to the hour or to 10 minutes is unknown. The 5h window is therefore never compared with calendar time. Within a window, its par is the time since the window began.
- **5h target** (user's answer Q8 a). It is what the 7d can still pay for, at most the whole window. Each limit keeps its own reset time; the two are not in sync. The user's two accounts reset Tuesday 4:00 PM and Thursday 3:00 PM (claude.ai usage screenshots).
  - The 7d resets after the 5h window ends: target = min(100, 5h used + (100 - 7d used) / k).
  - The 7d resets before the 5h window ends: no 7d cap; the target is 100.
  - The 7d is used up: the 5h tag draws as paused until the 7d resets, as claude.ai shows "Paused until your week resets".
- **k** (the 7d % that 1 % of 5h costs) is measured from the readings cockpit already receives, with no user setting. It is the 7d rise divided by the 5h rise within one 5h window. `percentUsed` has at most one decimal (`SessionRateLimit` in the API types). Until a value exists, the 5h tag is drawn uncoupled.
- **Lengths.** Number options for the 5h, 7d and context bars accept any whole number from 1 up. Defaults are today's: 10, 7 and 10. The option descriptions explain what a length does. M2 splits its length in half per side, rounded down, plus the pipe.
- **Explanations.** Hover texts move from the tags into an explanation row that takes over the forecast line's slot in `layout` and `/cockpit:order`. Each tag joins a hover `scope` that reveals its text in that row. The API types say a scope lights "in any site". With nothing hovered, the row shows the run-out warning when one applies, otherwise a blank line. Hover cannot move siblings, so the row always keeps its line.

## Not verified

- How the 5h window's start is rounded: the transcripts show one idle case only.
- Whether a long explanation is cut off or wraps in its row.
- How the k measurement behaves across a 7d reset that falls inside a 5h window: the 7d rise there is not comparable with the 5h rise.
- Whether Claude Code reports the separate Fable weekly limit at all: see `.do/inbox/2026-10-25-fable-weekly-limit.md`.
