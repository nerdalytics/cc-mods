# cc-mods

Mods for Claude Code, published as a plugin marketplace. The terms below are the ones a mod's specs, tickets and README share.

## Language

### Cockpit

**Cockpit**:
The mod that draws live gauges around the prompt. As a ticket Area, `cockpit` is the whole mod: its hooks module, options, README and tests.

**Tag**:
One named gauge or chip in a row, such as `limit_7d`, `context` or `branch`.
_Avoid_: segment, widget

**Row**:
A line of tags, left to right, as a comma list in the layout.

**Line**:
One entry of the layout: the prompt, a spacer, an offer line, the explanation line, or a row.

**Offer line**:
A line that shows only while its offer applies, with a button that acts, such as `fresh` or `compact`.

**Layout**:
The order of the lines around the prompt and the tags in each row, with the hidden tags, as the `layout` option spells it.

**Order pane**:
The pane `/cockpit:order` opens, where the person drags lines and tags into the layout.

**Cell**:
One character of a tag's bar.
_Avoid_: segment

**Limit tag**:
The `limit_7d` or `limit_5h` tag, each showing one rate-limit window.

**Window**:
The span of time a rate limit counts usage over, 7 days or 5 hours, ending at its reset.

**Reset**:
The moment a window ends and its usage starts over at 0 %.

**Style**:
How both limit tags draw their bars: `classic`, `lanes`, `gauge` or `notch`.

**Pace**:
How fast a limit is being used against its target, as the ratio of percent used to par. Under 1 leaves part of the target unused at the reset. Over 1 runs out before it.

**Par**:
The percent used a limit would show now if it were on pace to reach its target exactly at its reset.

**Target**:
The percent of a limit that can be used by its reset. It is 100 % for the 7d. For the 5h, it is what the 7d can still pay for, at most 100 %.

**Coupling factor**:
The 7d percent that 1 % of 5h usage costs, written k, measured from readings in one 5h window.

**Explanation line**:
The line that shows the hovered tag's explanation, or the run-out warning when nothing is hovered.
_Avoid_: forecast line, hover line

**Explanation**:
The sentence a tag reveals in the explanation line while it is hovered.
_Avoid_: hover value, tooltip

**Run-out warning**:
The text in the explanation line saying a limit reaches its target before its reset at the pace so far, in the words its explanation uses. A refused limit and a paused 5h do not get one.
_Avoid_: forecast
