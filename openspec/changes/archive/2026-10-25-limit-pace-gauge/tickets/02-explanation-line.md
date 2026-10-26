# 02: Explanation line replaces the forecast line

**Area:** cockpit

**Blocked by:** None (can start immediately)

**What to build:** The `forecast` line becomes the `explain` line, the explanation line. It holds the run-out warning for now; ticket 03 moves the hover texts into it. `forecast` is no longer a known layout name and has no alias. A saved layout that names it keeps that line as an empty row, which draws nothing outside the order pane, as unknown names are handled today. A new boolean option `explain_row`, true by default, switches the line; `limit_forecast` now gates only the warning inside it. Tests reach the mod only through its drawn output. See the explanation-row spec.

- [x] The default layout ends in `fresh;compact;explain`, and the explanation line draws under the prompt. A layout that puts `explain` before `prompt` draws it above the prompt.
- [x] A saved layout `forecast;<git row>;prompt;<status row>;fresh;compact` draws the explanation line last, under the prompt.
- [x] While `explain_row` is on, the line takes at least one line whether or not it shows anything, including when blank lines around it would otherwise merge, and a warning wider than the window wraps between words.
- [x] With nothing to show, the line is blank. With `explain_row` false, it draws no line at all.
- [x] With `limit_forecast` on, the line shows the run-out warning with today's wording and today's five gate cases. A 5h at 70 % with 2 hours to its reset and a fresh response reads ` 5h at 70%: at this pace it runs out in 1h17m, 43m before it resets.` after the warning sign. When both limits qualify, the one that runs out sooner shows. With `limit_forecast` false, the line is blank.
- [x] In `/cockpit:order`, dropping the line under hidden writes `explain_row` false, and dragging it back writes it true. While the pane is open, a blank explanation line draws a dim label naming it.
- [x] The `layout` and `limit_forecast` descriptions in `/config` name `explain` and say the warning is gated, `explain_row` has a description, and `claude plugin validate cockpit` passes.
- [x] The README describes the explanation line, `explain_row` and the changed `limit_forecast` wherever it described the forecast line, and no README text describing current behaviour, `/config` description, order-pane text or `/cockpit:colors` label names a `forecast` line or the "limit forecast" any more; they say "run-out warning". The README's Upgrading entries may name the removed `forecast`.
