# Design

## Context

See proposal.md for the why, `.do/prototypes/lanes-tokens-on-top.md` for the verdict, and the delta spec for the requirements. Current state, in `cockpit/hooks/cockpit.ts`:

- **The lanes.** `lanesCells` (1870-1883) draws a `▀` per cell. The top half is the `color`, lit to the par left (`pace.par`) or, without a pace, to the time left `limitSegment` passes in. The bottom half is the `backgroundColor`, lit to the usage left, with `pace.under` past the par line and `overPace` in the empty cells before it.
- **The call.** `limitSegment` (95-115) passes `drawn`, which is the reading at 100 % while the 5h is paused, and a time left of 0 while paused. So a paused `lanes` tag draws every cell empty.
- **Cells.** `cells` (2112) rounds down and clamps to 0..n. `overPace(j, n)` (1929) lerps `pace.over.from` to `pace.over.to` over n steps.
- **Colours.** `COLORS` (399-) lists every key `/cockpit:colors` shows, in its groups. `pace.under` (411) and `pace.none` (415) carry labels naming the styles that use them.
- **The pace.** `paceOf` (1224-1230) returns `{ r, share, par }`, where `par` = share × target / 100. `limitOf` (74-84) feeds the 5h's target from `fiveHourTarget`.

## Goals / Non-Goals

**Goals:**
- `lanes` draws what the prototype's `blocks` variant draws, cell for cell, in the real colours.
- The only shared code that changes is `COLORS`, which gains two keys. `classic`, `gauge` and `notch` draw what they draw today.

**Non-Goals:**
- Making the explanation's 5 % on-pace band agree with the bar.
- A colour change for `gauge` or `notch`.

## Decisions

### Swap the halves, keep the cell
The token lane moves to the `color` (top half), the time lane to the `backgroundColor` (bottom half). The `▀` glyph stays, so the tag keeps its width and the engine API is untouched. Alternative: keep the order and change only the colour. Rejected: the user asked for the tokens on top (Q31 a), matching the context bar's valuable lane on top.

### Count blocks from the unrounded pace
`ahead = (found.percentUsed − 100 × pace.par) × n / 100`, in cells, from the reading itself, not from the difference of the two rounded lanes. Over pace the count is `Math.ceil(ahead − ε)`, under pace `Math.floor(−ahead)`, with ε = 1e-9, so an `ahead` that floating point puts a hair above a whole number, such as 2.0000000000000004, still counts as that whole number. Alternative: the difference of the rounded lanes, `parLeft − usageLeft`. Rejected: rounding both lanes down can make it 0 while usage is ahead, or 1 more than the block count. The prototype's "like your screenshot" row has 2.45 cells ahead and lanes 2 apart.

### One severe flag for the time lane
`severe = ahead > 0 && ⌈ahead⌉ > usageLeft`. It colours every lit time cell `pace.severe`. This also covers a token lane rounded down to 0 cells, where the token lane alone could show no warning.

### Impacted cells keep `overPace`'s gradient
The k impacted cells at the token lane's end draw `overPace(i − (usageLeft − k), k)`, so the first is `pace.over.from` and the last `pace.over.to`. `lerp` with k = 1 returns the start colour, so a single impacted cell is amber.

### New colour keys in the "Limit pace" group
`pace.spare` `[96, 165, 250]` and `pace.severe` `[153, 27, 27]` go after `pace.over.to`, labelled for `lanes`. `pace.under`'s label becomes gauge's and notch's under pace. Overrides go through the existing `colors` parsing, so no parsing change is needed.

### No pace, paused
- **Without a pace**, both lanes draw `pace.none`, the token lane to the usage left and the time lane to the time left `limitSegment` passes. The lanes are swapped, but the rule is the one the ledger recorded (`.do/ledger/limit-pace-gauge.md:32`).
- **Paused**, `drawn` at 100 % and a time left of 0 still leave both lanes empty.
- **Classic** is not touched. Its paused explanation is already gated on `limitStyle === "classic"` (1260). The spec only writes that down.

## Risks / Trade-offs

- [The bar marks any spend ahead of par as an impacted block, while the explanation says "on pace" within 5 % of r] → Recorded as out of scope in the proposal. A follow-up can align them if the user finds it confusing.
- [Users of 1.2.0/1.3.0 `lanes` see the lanes swap order without a major version] → The user chose 1.4.0 (Q29 a). The README's Upgrading section names the change.
- [blue-400 `#60a5fa` is close to the prompts chip's `turns.from` (`[96, 165, 250]`, the same value)] → They are in different tags. The user picked it out of eight swatches. It can be overridden with `pace.spare`.

## Migration Plan

Release as cockpit 1.4.0. There is no stored state to migrate. Rolling back means reinstalling 1.3.0.
