# Prototype: what the `lanes` limit style colours

**Question:** what should the `lanes` style colour so its token lane still reads as a length, and the pace reads at a glance?

**Code:** `cockpit/prototype-lanes.mjs`, a throwaway terminal script, not tracked. Run it with `node cockpit/prototype-lanes.mjs [n7=7] [n5=10] [k=0.1]`; ← → switch variants. `swatches` draws the under-pace rows once per candidate colour; `letters` prints the cells as letters. Delete it once the winner is folded into `cockpit/hooks/cockpit.ts`.

## Why

In cockpit 1.2.0 and 1.3.0, `lanes` fills the empty token cells before the par line amber to red (`cockpit/hooks/cockpit.ts:1879`, required by `openspec/specs/cockpit/limit-pace/spec.md:61`). Both lanes then end at the par line, and the token use shows only as a colour change. The user's screenshot of a 14-cell 7d tag showed two purple token cells and five amber ones under a seven-cell time lane. The user: "this view is useless. yellow only shows the difference."

## Rounds

1. **Where the colour goes, lane order as today (time on top).**
   - now: as shipped, the gap fills the token lane.
   - x: the gap moves to the time lane.
   - y: the whole token lane in one pace colour.
   - z: no colour, classic with the 5h's target-aware time lane.

   The user sketched their own layout instead: tokens on top, time below, the colour on the token cells themselves.
2. **The user's layout.**
   - a: tokens on top, time below at the par left; over pace every token cell after the first shades amber to red.
   - a5: as a, the 5h's time lane at the raw time left.

   The user: a and a5 do not say what the colours mean. The count of coloured cells has to be computed from the pace.
3. **blocks: the user's rule.** "40% spent with the first hour consumes 2 blocks. The whole next hour I shall do nothing to compensate. If I spent another token the next hour is impacted." The user: "variant blocks shows the pacing pretty well", and after the severe colour was added, "over use is now clearly readable".

## Verdict

- **Lanes** (Q31 a). The top lane is the usage left, the bottom lane the par left, as the context bar puts its valuable lane, the smart zone, on top (`cockpit/README.md:43`). Today's `lanes` and `classic` put time on top.
- **The 5h's time lane** (Q33 a) is the par left, the time left scaled by the 5h's target (`cockpit/hooks/cockpit.ts:88-91`). At a target of 100 it is the time left.
- **Blocks the pace moved.** ahead = (percent used − 100 × par) × cells / 100.
  - Over pace, ahead > 0: ⌈ahead⌉ blocks are impacted. A block is impacted as soon as any of it is spent ahead of par.
  - Under pace, ahead < 0: ⌊−ahead⌋ blocks are spare. A block is spare only when all of it lies unspent.
  - Otherwise the lanes draw in the limit's gradient, with no pace colour.
- **Where** (Q34 a). The blocks are the last cells of the token lane, at most its length, so the token lane stays a true length.
  - Impacted blocks shade amber to red toward the lane's end, from `pace.over.from` to `pace.over.to`.
  - Spare blocks draw in a new colour, blue-400 `#60a5fa` (Q35 b, Q36), meaning spending is welcome. Green-400 `#4ade80` was rejected as ugly; of eight swatches blue-400 was "the only not looking too ugly for 7d and 5h".
- **Severe** (Q34). When more blocks are impacted than the token lane has cells, the time lane's lit cells draw deep red, `#991b1b`, a new colour. This also covers a token lane that rounds down to no cells.
- **No pace.** Both lanes dim, as today, in the new lane order.
- **Colour keys.** The two new colours join the "Limit pace" group in `/cockpit:colors` (proposed names `pace.spare` and `pace.severe`). `gauge` and `notch` keep slate `pace.under`.
- **Ship** (Q29 a). A new OpenSpec change that rewrites the "Lanes style" requirement, released as cockpit 1.4.0.

## Not verified

- The bar marks any spend ahead of par, while the explanation line still says "on pace" within 5% (`openspec/specs/cockpit/limit-pace/spec.md:24`). The two can disagree near par.
- k is a placeholder (0.1) in the prototype, so the 5h's par in its rows is not a measured one.
- The colours were judged only in the user's terminal, on the prototype's made-up readings, not in Claude Code.
