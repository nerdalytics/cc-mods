# Spec Delta

## MODIFIED Requirements

### Requirement: Run-out warning in the explanation line
With nothing hovered and `limit_forecast` on, in any style, the explanation line SHALL show the run-out warning when a limit reaches its target before its reset at the pace so far, even if that moment has passed, with:
- a response from this session in the last 10 minutes;
- at least a tenth of the window passed;
- the limit between 0 % and 100 %.

It SHALL read as the limit's over-pace sentence in limit-pace, for the same reading and moment. Of two such limits, the sooner SHALL show.

#### Scenario: 5h runs out early
- **WHEN** no k is measured, the 5h is at 70 % with 2 hours to its reset at 3 PM later today, and this session's last response is fresh
- **THEN** the explanation line reads ` 5h at 70%: at this pace it runs out in 1h17m, 42m before it resets at 3 PM.` after the warning sign

#### Scenario: Warning equals the explanation
- **WHEN** the 7d is over pace by more than 0.05 and the run-out warning shows for it, and the pointer then rests on the 7d tag in a non-classic style
- **THEN** the revealed explanation reads the same text as the warning

#### Scenario: Bounded 5h warns of the 7d
- **WHEN** k is 0.5, the 7d is at 90 % and resets after the 5h window ends, and the 5h is at 20 % with 1 hour of its window passed, read just now, resetting later today at 3 PM
- **THEN** the explanation line reads ` 5h at 20%: at this 5h pace the 7d runs out in 1h0m, 3h0m before the 5h resets at 3 PM.` after the warning sign

#### Scenario: Run-out time already passed
- **WHEN** the 7d is at 99.99 %, read 9 minutes ago, with about 105 hours of its window passed, so its run-out fell under a minute after the reading, and it resets on Thursday at 3 PM local, 2 days 15 hours from now
- **THEN** the explanation line reads ` 7d at 100%: at this pace it runs out any moment, 2d15h before it resets at Thu 3 PM.` after the warning sign

#### Scenario: Sooner limit wins
- **WHEN** no k is measured, the 7d at 99 % with a day to its reset runs out in 1h27m, and the 5h at 70 % with 2 hours to its reset runs out in 1h17m
- **THEN** the explanation line warns of the 5h

## ADDED Requirements

### Requirement: The warning reads the limits as the tags do
In every style, the run-out warning SHALL take each limit's reading as its tag does: a limit a session was refused on, and that has not reset, counts as at 100 %. The 5h SHALL NOT warn while it is paused because the 7d is used up.

#### Scenario: Paused 5h does not warn
- **WHEN** the 7d is at 100 %, and the 5h is at 70 % with 2 hours to its reset and a fresh reading
- **THEN** the explanation line shows no run-out warning

#### Scenario: Refused limit does not warn
- **WHEN** a session was refused on the 7d until tomorrow, the last 7d reading is at 98 % and over pace, and the 5h is under pace
- **THEN** the explanation line shows no run-out warning

### Requirement: Every tag has an explanation
Each of the seven tags SHALL always have an explanation, including the turns tag before any subagent has run and the cache tag while cold. The limit tags' explanations follow the limit-pace capability.

#### Scenario: Turns before any subagent
- **WHEN** no subagent has run and the turns tag is hovered
- **THEN** the explanation line shows the prompts sent

#### Scenario: Cache while cold
- **WHEN** the cache is cold and the cache tag is hovered
- **THEN** the explanation line shows what writing the cache again costs

### Requirement: What each explanation carries
Each tag's explanation SHALL contain at least what its hover showed before the explanation line took over the hovers, and where it had no hover, what the tag shows:
- context: the tokens left;
- turns: the subagents' count and requests, once a subagent has run;
- tokens: the main session's tokens, or with `merge_costs` on, the tokens of the main session and its subagents together;
- agents: the subagents' tokens;
- cache: while warm, what the prompt costs once the cache is cold.

#### Scenario: Context explanation
- **WHEN** the context tag is hovered with 120,000 tokens left
- **THEN** the explanation line includes `120.0K`

## REMOVED Requirements

### Requirement: Explanations carry today's hover values
**Reason**: Its text is over the 500 characters `openspec validate --strict` allows. It is split into "Every tag has an explanation" and "What each explanation carries", which together say what it said.
**Migration**: None. The behaviour is unchanged.
