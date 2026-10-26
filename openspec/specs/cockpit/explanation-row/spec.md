# cockpit/explanation-row Specification

## Purpose

Gives the cockpit's tags one fixed line for what hovering them explains, and for the limit run-out warning. A hover text never covers or moves the tags themselves.

## Requirements

### Requirement: Explanation line in the layout
The `layout` option and `/cockpit:order` SHALL know a line named `explain` in place of `forecast`. `forecast` SHALL no longer be a known name. The default layout SHALL end in `fresh;compact;explain`. A layout that does not name `explain` SHALL get it last, as any offer left out is placed today. Unknown names SHALL be handled as today: a line made only of unknown names stays as an empty row, which draws nothing outside `/cockpit:order`.

#### Scenario: Default layout
- **WHEN** `layout` is unset
- **THEN** the explanation line draws under the prompt, after the fresh-start and compaction lines

#### Scenario: Saved layout naming forecast
- **WHEN** a saved `layout` is `forecast;<git row>;prompt;<status row>;fresh;compact`
- **THEN** the explanation line draws last, under the prompt, and the line that named `forecast` draws nothing

#### Scenario: Placed above the prompt
- **WHEN** `layout` puts `explain` before `prompt`
- **THEN** the explanation line draws above the prompt

### Requirement: Explanation line toggle
A boolean option `explain_row`, true by default, SHALL switch the explanation line on and off. Dropping the line under hidden in `/cockpit:order` SHALL write `explain_row` false, and dragging it back above hidden SHALL write it true. While `explain_row` is false, no hover text and no run-out warning SHALL draw anywhere.

#### Scenario: Hidden in the order pane
- **WHEN** the person drops the explanation line under hidden in `/cockpit:order`
- **THEN** `explain_row` is written false, and the line no longer draws

### Requirement: The line is always there
While `explain_row` is on, the explanation line SHALL take at least one line, whether anything is shown in it or not. Text longer than the line SHALL wrap between words onto further lines, as the run-out warning does today.

#### Scenario: Nothing to show
- **WHEN** nothing is hovered and no limit runs out before its reset
- **THEN** the explanation line draws as one blank line

#### Scenario: Long text
- **WHEN** an explanation or the run-out warning is wider than the window
- **THEN** it wraps between words onto further lines; a hovered explanation's further lines draw over what lies below the line rather than moving it

### Requirement: Hovering a tag shows its explanation
Hovering any of these tags SHALL reveal that tag's explanation in the explanation line: `limit_7d`, `limit_5h`, `context`, `turns`, `tokens`, `agents` and `cache`. A revealed explanation SHALL cover anything shown in the line beneath it. The tags SHALL no longer lay a hover value over themselves. While `explain_row` is on, a tag with an explanation SHALL keep its value on the grey background. While it is off, no value SHALL stand on the grey.

#### Scenario: Hover the 5h tag
- **WHEN** the pointer rests on the 5h tag
- **THEN** the explanation line shows the 5h explanation, and the 5h bar itself is unchanged

#### Scenario: Hover over the warning
- **WHEN** the run-out warning shows and the pointer rests on the context tag
- **THEN** the context explanation is drawn over the warning, with none of the warning's text visible

#### Scenario: Tag in a row above the prompt
- **WHEN** the context tag sits in a row above the prompt and the explanation line sits under it
- **THEN** hovering the context tag still reveals its explanation in that line

### Requirement: Explanations carry today's hover values
Each of the seven tags SHALL always have an explanation, including the turns tag before any subagent has run and the cache tag while cold. Each tag's explanation SHALL contain at least what its hover showed before this change, and where it had no hover, what the tag shows:
- context: the tokens left;
- turns: the subagents' count and requests, once a subagent has run;
- tokens: the main session's tokens, or with `merge_costs` on, the tokens of the main session and its subagents together;
- agents: the subagents' tokens;
- cache: while warm, what the prompt costs once the cache is cold.

The limit tags' explanations follow the limit-pace capability.

#### Scenario: Context explanation
- **WHEN** the context tag is hovered with 120,000 tokens left
- **THEN** the explanation line includes `120.0K`

### Requirement: Run-out warning in the explanation line
With nothing hovered and `limit_forecast` on, the explanation line SHALL show the run-out warning when a limit reaches 100 % before its reset at the pace so far. The warning SHALL keep today's wording and today's conditions:
- a response from this session in the last 10 minutes;
- at least a tenth of the window passed;
- the limit between 0 % and 100 %.

When both limits qualify, the line SHALL show the one that runs out sooner.

#### Scenario: 5h runs out early
- **WHEN** the 5h is at 70 % with 2 hours to its reset, and this session's last response is fresh
- **THEN** the explanation line reads ` 5h at 70%: at this pace it runs out in 1h17m, 43m before it resets.` after the warning sign

### Requirement: Warning toggle
With `limit_forecast` off, the explanation line SHALL show no run-out warning. Hovers SHALL still reveal their explanations in it.

#### Scenario: Warning off
- **WHEN** `limit_forecast` is false and the 5h runs out early
- **THEN** the explanation line is blank until a tag is hovered

### Requirement: Order pane samples
While `/cockpit:order` is open, the explanation line SHALL draw a dim line naming it whenever it would otherwise be blank, as other lines with nothing to show draw today.

#### Scenario: Order pane open
- **WHEN** the order pane is open and nothing is hovered
- **THEN** the explanation line draws a dim label naming the line
