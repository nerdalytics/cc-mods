# 02: A bounded 5h names the 7d in its explanation

**Area:** cockpit

**Blocked by:** 01

**What to build:** While the 7d bounds the 5h target below 100 % (k measured, the 7d resetting after the 5h window ends), the 5h's paced explanation names the 7d, measured at the 5h's pace. Over its target, it says when the 7d runs out, which is when the 5h reaches its target, and how long that is before the 5h resets. Under, it says how much of the 7d is left when the 5h resets. On target, it says the 7d runs out as the 5h resets. The run-out time counts to the 5h target, not to 100 %. See the limit-pace delta spec "Bounded 5h names the 7d" and the design's Decision 5.

- [x] With k 0.5, the 7d at 90 % resetting after the 5h window, and the 5h at 20 % with 1 hour passed, read just now, the 5h reads `5h at 20%: at this 5h pace the 7d runs out in 1h0m, 3h0m before the 5h resets at <clock>.`
- [x] With the same k and 7d, and the 5h at 10 % with half its window passed, it reads `5h at 10%: at this 5h pace the 7d still has ~5% left when the 5h resets at <clock>.`
- [x] With the same k and 7d, and the 5h at 20 % with half its window passed, it reads `5h at 20%: at this 5h pace the 7d runs out as the 5h resets at <clock>.`
- [x] With no k measured, or with the 7d resetting before the 5h window ends, the 5h reads the unbounded sentences from ticket 01, and the cockpit suite passes.
