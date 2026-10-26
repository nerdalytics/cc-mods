# 01: Limit explanations count forward and name the reset clock

**Area:** cockpit

**Blocked by:** None (can start immediately)

**What to build:** Hovering the 7d or 5h tag shows one sentence in the frame `<badge> at <N>%: ...`. It counts forward to the run-out and names the reset by its local clock time. This covers over pace, under pace, on pace, no pace (and every reading in `classic`), the 5h paused while the 7d is used up, a reading without a reset time, and a run-out already due (`runs out any moment`). The over-pace run-out time is counted from now, with the same formula the run-out warning uses today. The reset clock is formatted with local `Date` methods and no `Intl`. This ticket does not touch the run-out warning or the bounded 5h. See the limit-pace delta spec ("Limit explanation text", "Limit explanation by pace", "Run-out already due", "Reset clock", "5h paused while the 7d is used up") and the design, Decisions 1, 2 and 6.

Tests reach the mod only through its drawn output. They cannot pin `Date.now()` or the time zone, so each reset is built from local `Date` parts. See the design's "Risks / Trade-offs".

- [ ] A 7d at 89 % with 93 hours passed, read just now, resetting on another local day at 3 PM, reads `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at <Ddd> 3 PM.`
- [ ] Under pace (7d at 10 %, 60 % passed) reads `7d at 10%: at this pace it resets at <Ddd> 3 PM with ~83% unused.` On pace (7d at 33 %, a third passed) reads `7d at 33%: at this pace it reaches its target as it resets at <Ddd> 3 PM.`
- [ ] With no pace (a stale reading, too early in the window, or any reading in `classic`), the explanation reads `<badge> at <N>%: it resets at <clock>.` A reading without a reset time reads `<badge> at <N>%.`
- [ ] With the 7d at 100 % in a non-classic style, the 5h reads `5h at <N>%: it is paused until the 7d resets at <clock>.` In `classic` the 5h does not mention the pause.
- [ ] An over-pace limit whose projected run-out has passed while its reading is still fresh, a fresh reading at 100 % included, reads `at this pace it runs out any moment, <time until the reset> before it resets at <clock>.`
- [ ] The reset clock reads `3 PM` later today, `Ddd 3 PM` on another day, `next Ddd 9 AM` on today's weekday a week out, and `3:30 PM` off the hour. A reset at 14:59:59 reads `3 PM`, and one at 23:59:40 reads as the next day's `12 AM`. Noon reads `12 PM`.
- [ ] The tests that pin today's explanation wording (`7d limit: … used, resets in …`, `runs out … before it resets`, `paused until the 7d resets in …`) are rewritten for the new sentences, and the cockpit suite passes.
- [ ] The README's status-row explanation column for `7d`, `5h` describes the new frame and the reset clock, with an example sentence.
