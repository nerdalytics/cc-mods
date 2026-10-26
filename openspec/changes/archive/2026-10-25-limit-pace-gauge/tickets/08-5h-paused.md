# 08: 5h paused while the 7d is used up

**Area:** cockpit

**Blocked by:** 05, 06

**What to build:** While the 7d is used up, the 5h cannot be spent, so in every non-classic style the 5h tag draws as paused: all cells empty, with no pace. The 7d counts as used up when it is at 100 %, or when a session was refused on it and the refusal has not reset. The 5h explanation then says it is paused until the 7d resets, with the time left in the countdown form the tags already use. `classic` bars are unchanged. Tests reach the mod only through its drawn output. See the limit-pace spec, "5h paused while the 7d is used up".

- [x] With the 7d at 100 %, resetting in 2 days 4 hours, and `limit_style` `gauge`, the 5h gauge draws all cells empty, keeps its percent used in the badge and draws its pipe dim, and its explanation reads that the 5h is paused until the 7d resets in 2d4h.
- [x] With a refusal on the 7d still in force while its reading is below 100 %, the 5h draws paused in the same way.
- [x] With `lanes` and with `notch`, a used-up 7d draws the 5h with all cells empty.
- [x] With `classic`, a used-up 7d leaves the 5h bar as cockpit 1.1.0 drew it.
- [x] The README describes the paused 5h.
