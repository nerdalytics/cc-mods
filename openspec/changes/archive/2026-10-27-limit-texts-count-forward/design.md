# Design

## Context

See proposal.md, "Why". The current state in `cockpit/hooks/cockpit.ts`:

- `explanations` builds each limit's explanation from `limitOf` (the snapshot's reading with refusals folded in by `limitsOf`, the pace, and `paused`). It then appends `paceWords(limit, r)`. Over pace, that function words the time before the reset as `(1 − 1/r) × window`, which is counted from the reading.
- `runOutWarning` reads the raw `USAGE` rate limits, with no refusals folded in, and its own `Date.now()` in milliseconds. It asks `forecastOf`, which always counts to 100 %: `hitIn = elapsed × (100 − used) / used − (now − readAt)`, and `left = reset − now`. The snapshot floors `now` to seconds.
- `fiveHourTarget` gives the bounded 5h target. `limitOf` computes it but does not return it.
- In tests, `Date.now()` cannot be pinned. `mock.clock` answers only `$.clock.now()` (`MockClock`, `cockpit/.claude-plugin/types/claude-code/index.d.ts:16214`), and the kit cannot pin the time zone. Hooks run in the user's local zone (settled during triage, see the inbox note).

## Goals / Non-Goals

**Goals:**
- One function words every limit sentence, so the explanation and the warning cannot drift apart.
- Both count from the same `now` and the same reading.

**Non-Goals:**
- Changing `paceOf`, the par, k, the bars or the colours.

## Decisions

1. **One sentence builder.** A function, say `limitWords`, takes the limit, its reading, its pace with its target, the 7d reading, k, the paused seconds and `now`. It returns the whole `<badge> at <N>%: …` text for every case in the limit-pace delta. `explanations` calls it for each limit tag. `runOutWarning` calls it for the limit it warns of, in its over-pace form. `paceWords` goes. *Alternative:* keep two builders and test that they match. Rejected, because nothing would stop the next edit from changing only one of them.

2. **Count from now, in one place.** The run-out time is `elapsed × (target − used) / used − (now − readAt)`, and the time before the reset is `left − hitIn`. This is `forecastOf`'s formula with the target in place of 100, so for a 7d, or an unbounded 5h, the warning's numbers stay as they are today. `forecastOf` takes the target. It is the one source of `hitIn`, for both the warning's condition and the sentence. A `hitIn` of 0 or less, possible only within the 10 fresh minutes, reads `runs out any moment`, and the time before the reset becomes `left` (Q68). The warning shows it too, so its `hitIn > 0` condition goes and only `hitIn < left` stays.

3. **Shared `now`.** `explainLine` reads one live snapshot, `snapshotOf($, false)`, and passes it to `runOutWarning`. The warning then uses its `now`, `readAt` and `k`. The explanations keep using the snapshot with samples while the order pane shows. The warning never sees the samples, as today.

4. **The warning reads the limits through `limitOf` (Q70 b).** For each limit it takes the reading, pace, target and pause that `limitOf` gives the tag. This holds in every style, since `limitOf` computes the pace and the pause regardless of style, and only the explanation drops them in `classic`.
   - A refusal that has not reset counts as 100 %, so that limit does not warn.
   - A paused 5h has no pace, so it does not warn.
   - Because the warning and the explanation start from the same reading, they cannot disagree.

   This settles `.do/inbox/2026-10-25-run-out-warning-ignores-paused-5h.md`. *Alternatives:* (a) keep the raw readings; rejected, because with the 7d at 100 % and k measured the bound leaves the 5h already at its target, and since Q68 the warning would then read `the 7d runs out any moment` about a 7d that has already run out. (c) skip the 5h while the raw 7d is at 100 %; rejected, because a refused limit would still disagree with its tag.

5. **Bounded means target < 100.** `limitOf` returns the target it already computes. The sentence builder picks the 7d-naming sentences whenever the 5h target is below 100. The 7d left at the 5h reset is `100 − 7d used − k × (5h used / share − 5h used)`, rounded with `Math.round`, as `~N% unused` is.

6. **Reset clock from local `Date` methods.** A new formatter takes the reset in milliseconds and `now`:
   - Round the reset to the nearest minute first, then decide "today" from `getFullYear`, `getMonth` and `getDate` against `now`.
   - The weekday is a fixed `["Sun", …]` table indexed by `getDay`.
   - `next ` is prefixed when the reset's weekday equals today's but the reset is not today.
   - Hours run 12-hour, with `12` for 0 and 12. Minutes are added only when non-zero, zero-padded.

   It uses no `Intl` (out of scope). `countdown` is unchanged and still words the run-out times.

7. **Spec split shape, forced by the tool.** OpenSpec 1.15 rejects a MODIFIED requirement that drops scenarios. It also rejects a name that is both REMOVED and ADDED (both checked with `openspec validate --strict` on this change). So "Lanes style" and "No pace without a usable reading" are REMOVED, and their pieces are ADDED under new names. "Lanes token and time lanes" and "When a limit has no pace" replace the two names Q48 a kept. The behaviour is unchanged. A copy of `openspec/` archived in the scratchpad passed `openspec validate --specs --strict` for all three cockpit specs.

## Risks / Trade-offs

- [Tests cannot pin `Date.now()` or the zone] → Tests build each reset from local `Date` parts, such as the next Thursday at 15:00 local, and set the reading's percent and share around that. A "later today" case has to handle the hour before local midnight, by choosing a reset that is still today or by asserting the next-day form.
- [Windows near the day edge] → A 5h reset "later today at 3 PM" works only when now falls between 10 AM and 3 PM. Tests choose the reset from now, not from a fixed hour.
- [Just over pace, 1 < r ≤ 1.05, the warning fires while the hover says on pace] → This is today's behaviour, and the delta's "Warning equals the explanation" scenario is scoped to r more than 0.05 over. Closing that gap belongs to `.do/inbox/2026-10-26-bar-and-text-disagree-on-pace.md`.
- [Longer sentences wrap more often in narrow windows] → The explanation line already wraps between words.
- [The bounded 5h's text can disagree with the 7d's own text] → It is measured at the 5h's pace, while the 7d's text uses the 7d's whole-window pace. The user accepted this (Q57 c, Q61).

## Migration Plan

- The wording changes and no options change.
- The release is a minor bump to cockpit 1.5.0, following the 1.4.0 precedent (Q38 a), if the user confirms.
- The README gets a 1.5.0 Upgrading entry, plus rewrites of the status row's limit explanation and the run-out warning paragraph. The 5h target paragraph's "not its target" sentence is dropped.
- Rollback is reverting the release commits.
