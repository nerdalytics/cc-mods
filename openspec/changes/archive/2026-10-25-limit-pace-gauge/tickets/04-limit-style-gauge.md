# 04: Limit style option with the gauge style

**Area:** cockpit

**Blocked by:** 01

**What to build:** A string option `limit_style` sets how both limit tags draw: `classic` (the default, today's two-lane bar), `lanes`, `gauge` or `notch`; this ticket builds `gauge` and the shared pace that every non-classic style uses, and ticket 05 builds `lanes` and `notch`. A limit's pace is r = percent used / (share of the window passed × target), the share measured at the reading's time, with the window beginning at its reset time minus its length. The target is 100 % for both limits until ticket 07 bounds the 5h. Pace exists only under the same three conditions as the run-out warning: a reset time, a response from this session in the last 10 minutes, and at least a tenth of the window passed. Tests reach the mod only through its drawn output. See the limit-pace spec.

- [x] `limit_style` is in `/config` with a description of its four values, and `claude plugin validate cockpit` passes. Unset or `fancy` draws both tags as `classic`, whose cell colours match cockpit 1.1.0's for the same reading.
- [x] Five colours under a "Limit pace" group appear in `/cockpit:colors` with `gradients` on, with the defaults in design.md, and `pace.under=#112233` in `colors` draws under-pace cells in #112233.
- [x] With `gauge`, the badge reads the limit and its percent used, such as `7d 51%`.
- [x] With `gauge`, the bar is floor(length / 2) cells, a centre pipe, then floor(length / 2) cells: 5, pipe, 5 at length 10, and 3, pipe, 3 at length 7.
- [x] With `gauge`, under pace fills the left side outward from the pipe in slate and over pace fills the right side outward in amber to red, each in half-cell steps to f × 2 × floor(length / 2) halves, rounded, where f is (1 − r) under pace and (1 − 1/r) over pace. 51 % with a third of the window gone draws over pace; 10 % with 60 % gone draws under pace.
- [x] Without a pace (no reset time, a response more than 10 minutes old, or less than a tenth of the window passed), the gauge keeps its percent used in the badge, leaves every cell empty and draws its pipe dim, with no pace colours.
- [x] While `/cockpit:order` is open with no real 5h reading, the sample readings count as fresh, so with `gauge` the 5h gauge has filled cells.
- [x] The README describes the four styles and the pace colours in the status-row table and Colours section, and lists `limit_style` in the Options table.
