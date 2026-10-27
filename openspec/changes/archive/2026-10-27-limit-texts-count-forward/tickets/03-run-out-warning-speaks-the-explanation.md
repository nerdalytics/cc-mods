# 03: The run-out warning speaks the explanation's sentence

**Area:** cockpit

**Blocked by:** 02

**What to build:** The run-out warning shows exactly the over-pace sentence the hovered explanation shows, for the same reading at the same moment. It takes each limit's reading as its tag does. A refusal that has not reset counts as 100 %, and a 5h paused while the 7d is used up does not warn, in every style (Q70 b). A bounded 5h warns when it reaches its target before it resets, with the sentence that names the 7d. A run-out already due warns too, as `runs out any moment`. When both limits qualify, the one that runs out sooner shows. The other conditions stay as they are today: a fresh reading, a tenth of the window passed, and the limit between 0 % and 100 %. See the explanation-row delta spec ("Run-out warning in the explanation line", "The warning reads the limits as the tags do") and the design's Decisions 2 to 4.

- [x] With no k measured, a 5h at 70 % with 2 hours to its reset and a fresh reading warns ` 5h at 70%: at this pace it runs out in 1h17m, 42m before it resets at <clock>.` after the warning sign.
- [x] For a limit over pace by more than 0.05 in a non-classic style, the warning's text equals the text the hovered explanation reveals.
- [x] With k 0.5, the 7d at 90 % resetting after the 5h window, and the 5h at 20 % with 1 hour passed, the warning reads ` 5h at 20%: at this 5h pace the 7d runs out in 1h0m, 3h0m before the 5h resets at <clock>.`
- [x] When both limits run out before their resets, the warning shows the one that runs out sooner.
- [x] A fresh over-pace reading whose projected run-out has passed warns `… at this pace it runs out any moment, …`.
- [x] With the 7d at 100 % and the 5h over pace with a fresh reading, no warning shows, in `classic` and in `gauge`. With a session refused on the 7d until tomorrow and its last reading at 98 % over pace, the 7d does not warn.
- [x] The tests that pin today's warning wording are rewritten for the new sentences, and the cockpit suite passes.
- [x] Every description of the warning matches the new behaviour: the README's run-out warning paragraph, its `limit_forecast` option row, the `limit_forecast` description in the plugin manifest, and the glossary's "Run-out warning" entry. Each says the warning shows when a limit reaches its target, not 100 %, and that a refused limit and a paused 5h do not warn; the README paragraph shows the new sentence. The README's 5h target paragraph no longer says the warning counts to 100 % "not its target".
