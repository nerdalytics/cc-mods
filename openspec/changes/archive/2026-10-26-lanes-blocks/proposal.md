# Proposal

## Why

The `lanes` limit style fills the empty token cells before the par line amber to red (`cockpit/hooks/cockpit.ts:1879`, required by `openspec/specs/cockpit/limit-pace/spec.md:61`). Both lanes then end at the par line, so the token use shows only as a colour change and the tag reads as one value. The user called it "useless" in the live terminal. The prototype (`.do/prototypes/lanes-tokens-on-top.md`) settled a layout the user found "pretty much telling": the tokens on top, the time below, and the colour on as many token cells as the pace has moved.

## What Changes

- **BREAKING (released as minor, by the user's answer Q29 a)**: `lanes` is redrawn.
  - The top lane is the usage left and the bottom lane is the par left. Today the top lane is the par left and the bottom lane is the usage left. Classic keeps its order.
  - Over pace, the last ⌈ahead⌉ cells of the token lane shade amber to red toward its end, at most the whole lane. `ahead` is how many cells the usage is ahead of par.
  - Under pace, the last ⌊behind⌋ cells of the token lane draw in a new "spending welcome" colour, blue-400 by default.
  - When more cells are impacted than the token lane holds, the time lane's lit cells draw in a new deep red.
  - Empty token cells are never coloured. The shipped gap fill and the slate under-pace cells leave `lanes`.
- Without a pace, `lanes` draws both lanes dim in the new order: the token lane to the usage left, the time lane to the time left now. This writes down the ruling the ledger recorded (`.do/ledger/limit-pace-gauge.md:32`), which the main spec words as "par left".
- The paused 5h's explanation is a non-classic state only: in `classic` the 5h tag and its explanation stay as they are. This writes down the ruling the ledger recorded (`.do/ledger/limit-pace-gauge.md:36`), which the main spec leaves implicit.
- Two new colours in the "Limit pace" group of `/cockpit:colors`, overridable through `colors`: `pace.spare` (`#60a5fa`) and `pace.severe` (`#991b1b`). `gauge` and `notch` keep `pace.under` and are unchanged.
- The README's status row, colours and Upgrading sections, and the `limit_style` description in `plugin.json`, describe the new `lanes`.
- Delete the throwaway prototypes `cockpit/prototype-lanes.mjs` and `cockpit/prototype-pace.mjs`.
- Release as cockpit 1.4.0. The root `README.md:22` makes a release that changes documented behaviour a major one. The user chose 1.4.0 in Q29 a, as they chose minor for 1.2.0, and the Upgrading note records the change.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cockpit/limit-pace`: the "Lanes style", "No pace without a usable reading", "Pace colours" and "5h paused while the 7d is used up" requirements change.

## Impact

- `cockpit/hooks/cockpit.ts`: `lanesCells`, its call in `limitSegment`, and `COLORS` with the two new keys. The labels of `pace.under` and `pace.none` name the styles that use them.
- `cockpit/tests/cockpit.test.ts`: the lanes cases at about lines 586-598, 625-639, 1304-1310, 1325-1327 and 1392-1393 assert today's lane order and colours.
- `cockpit/.claude-plugin/plugin.json`: the `limit_style` description and the version.
- `cockpit/README.md`: the status row (line 42), the colours section (line 188), Upgrading.
- No engine API change: the `▀` cell keeps its top half in `color` and its bottom half in `backgroundColor`, as today.
- Out of scope: `gauge`, `notch` and `classic`. Also out of scope is the gap between the bar, which marks any spend ahead of par, and the explanation, which says "on pace" within 5 % (`openspec/specs/cockpit/limit-pace/spec.md:24`).
