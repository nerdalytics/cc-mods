# Cockpit 1.4.0's lanes colours were never seen in a real terminal

**Status:** wontfix

The 1.4.0 `lanes` colours `pace.spare` `[96, 165, 250]` (#60a5fa) and `pace.severe` `[153, 27, 27]` (#991b1b) (`cockpit/hooks/cockpit.ts:416-417`) were judged only in the throwaway prototype of `lanes-blocks`, never in a live session (handoff `HANDOFF-2026-10-26-0030.md`, Open issues). The same blue is also `palette.2` (`:403`, a row's first git part and Opus) and `turns.from` (`:428`, the prompts chip), so three tags can show one blue with three meanings. To decide after a look in a real terminal: whether `pace.spare` and `pace.severe` stay, and whether the spare blue needs to differ from the other two; `/cockpit:colors` retunes them.

Closed 2026-10-26: the user looked at cockpit 1.4.0's `lanes` colours and approved them, so `pace.spare` and `pace.severe` stay at their defaults, and the spare blue stays shared with `palette.2` and `turns.from`.
