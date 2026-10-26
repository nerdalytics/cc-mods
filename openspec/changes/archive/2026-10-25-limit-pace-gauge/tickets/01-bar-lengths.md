# 01: Bar lengths

**Area:** cockpit

**Blocked by:** None (can start immediately)

**What to build:** The person can set how many cells the 7d, 5h and context bars draw, through three number options in `/config`: `limit_7d_length` (default 7), `limit_5h_length` (default 10) and `context_length` (default 10). Each description says the number is the bar's cells, that a longer bar shows finer steps of the same percentage, and that the gauge style splits it in half to each side of the pipe, rounded down. Tests reach the mod only through its drawn output. See the bar-lengths spec.

- [x] With none of the three options set, the 7d, 5h and context bars draw 7, 10 and 10 cells, as in cockpit 1.1.0.
- [x] `limit_7d_length: 14` draws a 14-cell 7d bar.
- [x] `context_length: 0` draws a 1-cell context bar.
- [x] A value that is not a number falls back to the option's default, and a fraction is rounded down.
- [x] Each option's `/config` description says what the length does, as above, and `claude plugin validate cockpit` passes.
- [x] The README's Options table lists the three options, and the status-row text no longer gives the lengths as fixed.
