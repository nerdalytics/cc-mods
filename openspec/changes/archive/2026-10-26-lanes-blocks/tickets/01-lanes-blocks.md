# 01: Lanes draws the blocks

**Area:** cockpit

**Blocked by:** None (can start immediately)

**What to build:** With `limit_style` `lanes`, each limit tag draws its token lane on top, lit to the usage left, and its time lane below, lit to the par left. The colour goes on as many token cells as the pace has moved: impacted cells at the token lane's end shade amber to red, spare cells there draw in a new spending-welcome colour, and when more cells are impacted than the token lane holds, the time lane turns a new deep red. Empty cells are never coloured. `classic`, `gauge` and `notch` draw what they draw today. Tests reach the mod only through its drawn output. See the limit-pace delta spec, the design, and the verdict in the prototype note under `.do/prototypes/lanes-tokens-on-top.md`.

The prototype's cell rule, which the user approved in the terminal. It is a snippet from the prototype, not production code: `m.p` is the percent used, `m.pace.par` the par, `m.n` the cells, `usageLeft` and `parLeft` both rounded down. P is the limit's gradient, A an `overPace` colour, D dim and E empty.

```js
const ahead = m.pace ? ((m.p - 100 * m.pace.par) * m.n) / 100 : 0;
const want = ahead > 0 ? Math.ceil(ahead - 1e-9) : Math.floor(-ahead);
const k = Math.min(u, want);
const severe = ahead > 0 && want > u;
const token = (i) => (!m.pace ? D : i < u - k ? P(m, i) : ahead > 0 ? A(lerp(overFrom, overTo, i - (u - k), k)) : spare);
const time = (i) => (!m.pace ? D : severe ? deep : P(m, i));
// cell i: top = i < u ? token(i) : E, bottom = i < m.parLeft ? time(i) : E
```

- [x] A 5h tag of 10 cells at 38 % used, with target 100 % and 19 % of its window passed, lights the token lane to 6 cells with its 5th and 6th amber to red, and the time lane to 8 cells in the limit's gradient.
- [x] A 7d tag of 7 cells at 38 % used with a third of its window passed lights the token lane to 4 cells, its 4th amber: any spend ahead of par impacts a whole cell. At 33 % used with a third passed, both lanes are lit to 4 cells with no pace colour.
- [x] A 7d tag of 7 cells at 10 % used with 60 % of its window passed lights the token lane to 6 cells, its 4th to 6th in the spending-welcome colour, and the time lane to 2 cells.
- [x] A 7d tag of 7 cells at 80 % used with 45 % passed lights the token lane to 1 amber cell and draws the time lane's 3 lit cells deep red. At 95 % used with 80 % passed, the token lane is empty and the time lane's 1 lit cell draws deep red.
- [x] Without a pace, both lanes draw dim, the token lane to the usage left and the time lane to the time left at the moment it draws. Paused, every cell of both lanes is empty.
- [x] `/cockpit:colors` lists the spending-welcome colour `pace.spare` (#60a5fa) and the deep red `pace.severe` (#991b1b) in the "Limit pace" group, with labels that name `lanes`. Setting either in `colors` recolours those cells. `pace.under` keeps colouring the under-pace cells of `gauge` and `notch`, and its label names those two styles.
- [x] `gauge`, `notch` and `classic` draw exactly what they drew before this ticket. The existing tests for them pass unchanged, except the one test loop that runs `lanes` and `notch` through a shared body: its `lanes` case moves out and is rewritten for the new drawing, and its `notch` assertions stay exactly as they are.
- [x] The README's status row and colours section, and the `limit_style` description in the plugin manifest, describe the new `lanes`: tokens on top, the par left below, impacted and spare cells at the token lane's end, and the deep-red time lane.
