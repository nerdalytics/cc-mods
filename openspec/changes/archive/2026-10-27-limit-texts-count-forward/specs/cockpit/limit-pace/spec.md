# Spec Delta

## MODIFIED Requirements

### Requirement: 5h paused while the 7d is used up
While the 7d is at 100 %, or a session was refused on it and the refusal has not reset, the 5h tag SHALL draw as paused in every non-classic style: all cells empty, with no pace; the gauge keeps its percent used in the badge and draws its pipe dim. Its explanation SHALL say it is paused until the 7d resets, naming that reset by its clock time. In `classic`, the 5h tag and its explanation SHALL draw as they do without a pause.

#### Scenario: 7d used up
- **WHEN** the 7d is at 100 % and resets on Thursday at 3 PM local, a day other than today, the 5h is at 40 %, and `limit_style` is `gauge`
- **THEN** the 5h gauge draws empty, and its explanation reads `5h at 40%: it is paused until the 7d resets at Thu 3 PM.`

#### Scenario: Classic ignores the pause
- **WHEN** the 7d is at 100 % and `limit_style` is `classic`
- **THEN** the 5h tag draws its time and usage left, and its explanation does not say it is paused

### Requirement: Limit explanation text
Each limit tag's explanation SHALL read `<badge> at <N>%:` followed by one sentence, N being its percent used, rounded. The sentence SHALL name the reset by its clock time; only a run-out SHALL be counted as a time from now. In `classic`, and without a pace unless the 5h is paused, the sentence SHALL be `it resets at <clock>.` A reading without a reset time SHALL drop the sentence, so the explanation reads `<badge> at <N>%.`

#### Scenario: Explanation over pace
- **WHEN** the 7d is at 89 % with 93 hours of its window passed, read just now, and resets on Thursday at 3 PM local, a day other than today
- **THEN** the 7d explanation reads `7d at 89%: at this pace it runs out in 11h29m, 2d15h before it resets at Thu 3 PM.`

#### Scenario: No pace
- **WHEN** `limit_style` is `gauge`, the 7d is at 30 % and resets on Thursday at 3 PM local, a day other than today, and this session's last response is 11 minutes old
- **THEN** the 7d explanation reads `7d at 30%: it resets at Thu 3 PM.`

#### Scenario: Classic has no pace
- **WHEN** `limit_style` is `classic`, the 7d is at 51 % with a third of its window passed, and resets on Thursday at 3 PM local, a day other than today
- **THEN** the 7d explanation reads `7d at 51%: it resets at Thu 3 PM.`

#### Scenario: No reset time
- **WHEN** the 7d reading is at 30 % and has no reset time
- **THEN** the 7d explanation reads `7d at 30%.`

## ADDED Requirements

### Requirement: When a limit has no pace
A non-classic style SHALL draw no pace in any of these cases:
- the reading has no reset time;
- this session's last response is more than 10 minutes old;
- less than a tenth of the window has passed.

#### Scenario: Early in a window
- **WHEN** 5 % of the 5h window has passed
- **THEN** the 5h tag draws its usage dim, with no pace colours

#### Scenario: Stale reading
- **WHEN** this session's last response is 11 minutes old
- **THEN** both limit tags draw without pace

### Requirement: Lanes token and time lanes
With `limit_style` `lanes`, a tag SHALL draw two lanes of ▀ cells. The top lane is the token lane, lit up to the usage left. The bottom lane is the time lane, lit up to the par left. With a pace, the tag SHALL count the cells the usage is ahead of par: ahead = (percent used − 100 × par) × length / 100. Lit cells that no other lanes requirement colours SHALL draw in the limit's gradient. Empty cells of either lane SHALL draw empty.

#### Scenario: On par
- **WHEN** the 7d tag has 7 cells, is at 33 %, and a third of its window has passed
- **THEN** both lanes are lit to 4 cells in the limit's gradient, with no pace colour


### Requirement: Drawing without a pace
Without a pace, a limit tag SHALL draw no pace colours:
- `gauge` keeps its percent used in the badge, leaves every cell empty and draws its pipe dim;
- `lanes` draws both lanes in the neutral dim colour, the token lane to the usage left and the time lane to the time left at the moment it draws;
- `notch` draws its usage in the neutral dim colour, with no notch.

#### Scenario: Lanes without a pace
- **WHEN** `limit_style` is `lanes`, the 7d tag has 7 cells, the 7d reading has no reset time and is at 30 % used
- **THEN** the token lane is lit dim to 4 cells and the time lane is empty

### Requirement: Lanes cells ahead of par
With `limit_style` `lanes` and a pace, when ahead > 0, ⌈ahead⌉ cells SHALL be impacted. The last ones of the token lane, at most all of it, SHALL shade amber to red toward the lane's end; a single impacted cell draws amber.

#### Scenario: Usage ahead of par
- **WHEN** the 7d tag has 7 cells, is at 51 % used, and a third of its window has passed
- **THEN** the token lane is lit to 3 cells, its 2nd and 3rd amber to red, as the usage is about 1.2 cells ahead; the time lane is lit to 4 cells

#### Scenario: Ahead of par by two cells
- **WHEN** the 5h tag has 10 cells, is at 38 % used, its target is 100 % and 19 % of its window has passed
- **THEN** the token lane is lit to 6 cells, its 5th and 6th amber to red; the time lane is lit to 8 cells in the limit's gradient

#### Scenario: Any spend ahead impacts a whole cell
- **WHEN** the 7d tag has 7 cells, is at 38 % used, and a third of its window has passed
- **THEN** the token lane is lit to 4 cells, and its 4th draws amber

### Requirement: Lanes spare cells
With `limit_style` `lanes` and a pace, when ahead < 0, ⌊−ahead⌋ cells SHALL be spare. The last ones of the token lane, at most all of it, SHALL draw in the spending-welcome colour.

#### Scenario: Behind par
- **WHEN** the 7d tag has 7 cells, is at 10 % used, and 60 % of its window has passed
- **THEN** the token lane is lit to 6 cells, its 4th to 6th in the spending-welcome colour; the time lane is lit to 2 cells

### Requirement: Lanes overspend on the time lane
With `limit_style` `lanes`, when more cells are impacted than the token lane has lit cells, every lit cell of the time lane SHALL draw deep red.

#### Scenario: More impacted than the token lane holds
- **WHEN** the 7d tag has 7 cells, is at 80 % used, and 45 % of its window has passed
- **THEN** the token lane is lit to 1 cell in amber, and the time lane's 3 lit cells draw deep red

#### Scenario: Token lane empty
- **WHEN** the 7d tag has 7 cells, is at 95 % used, and 80 % of its window has passed
- **THEN** the token lane is empty, and the time lane's 1 lit cell draws deep red

### Requirement: Limit explanation by pace
In a non-classic style with a pace, a limit's sentence SHALL say what the pace leads to:
- over pace, r more than 0.05 above 1: how long from now until the limit reaches its target, then how long that is before the reset;
- under pace, r more than 0.05 below 1: the share of its target still unused at the reset, rounded;
- on pace, r within 0.05 of 1: that it reaches its target as it resets.

#### Scenario: Explanation under pace
- **WHEN** the 7d is at 10 % with 60 % of its window passed and resets on Thursday at 3 PM local, a day other than today
- **THEN** the 7d explanation reads `7d at 10%: at this pace it resets at Thu 3 PM with ~83% unused.`

#### Scenario: Explanation on pace
- **WHEN** the 7d is at 33 % with a third of its window passed and resets on Thursday at 3 PM local, a day other than today
- **THEN** the 7d explanation reads `7d at 33%: at this pace it reaches its target as it resets at Thu 3 PM.`

### Requirement: Run-out already due
An over-pace sentence whose projected run-out time has already passed SHALL read `runs out any moment` in place of the time until it runs out, followed by the time from now until the reset. This SHALL hold for a reading at 100 % as well.

#### Scenario: Run-out time already passed
- **WHEN** the 7d is at 99.99 % and over pace, read 9 minutes ago, with about 105 hours of its window passed, so its run-out fell under a minute after the reading, and it resets on Thursday at 3 PM local, 2 days 15 hours from now
- **THEN** the 7d explanation reads `7d at 100%: at this pace it runs out any moment, 2d15h before it resets at Thu 3 PM.`

#### Scenario: Reading at 100 %
- **WHEN** the 7d reading is at 100 %, fresh, with 105 hours of its window passed, and the 7d resets on Thursday at 3 PM local, 2 days 15 hours from now
- **THEN** the 7d explanation reads `7d at 100%: at this pace it runs out any moment, 2d15h before it resets at Thu 3 PM.`

### Requirement: Reset clock
A limit text SHALL name a reset by its local clock time, after rounding the reset to the nearest minute:
- the three-letter weekday and a 12-hour clock, such as `Thu 3 PM`;
- only the clock, such as `3 PM`, when the reset falls on the current local day;
- `next Thu 3 PM` when it falls on today's weekday a week from now;
- minutes only off the hour, such as `3:30 PM`.

Noon SHALL read `12 PM` and midnight `12 AM`.

#### Scenario: Reset later today
- **WHEN** a limit resets later on the current local day at 3 PM
- **THEN** its text names the reset `3 PM`, with no weekday

#### Scenario: Off the hour
- **WHEN** a limit resets on Thursday at 3:30 PM local, a day other than today
- **THEN** its text names the reset `Thu 3:30 PM`

#### Scenario: Rounded to the minute
- **WHEN** a limit resets at 14:59:59 local on the current local day
- **THEN** its text names the reset `3 PM`

#### Scenario: Rounded across midnight
- **WHEN** a limit resets at 23:59:40 local on the current local day
- **THEN** its text names the reset with the next day's weekday and `12 AM`

#### Scenario: Noon
- **WHEN** a limit resets at noon local on Thursday, a day other than today
- **THEN** its text names the reset `Thu 12 PM`

#### Scenario: Same weekday next week
- **WHEN** today is Thursday and the 7d resets next Thursday at 9 AM local
- **THEN** its text names the reset `next Thu 9 AM`

### Requirement: Bounded 5h names the 7d
While the 7d bounds the 5h target below 100 %, the 5h's paced sentence SHALL name the 7d, at the 5h's pace:
- over its target: how long until the 7d runs out, which is when the 5h reaches its target, and how long that is before the 5h resets;
- under: the share of the 7d left when the 5h resets, 100 − 7d used − k × (5h used / share passed − 5h used), rounded;
- on: that the 7d runs out as the 5h resets.

#### Scenario: Bounded 5h over its target
- **WHEN** k is 0.5, the 7d is at 90 % and resets after the 5h window ends, and the 5h is at 20 % with 1 hour of its window passed, read just now, resetting later today at 3 PM
- **THEN** the 5h explanation reads `5h at 20%: at this 5h pace the 7d runs out in 1h0m, 3h0m before the 5h resets at 3 PM.`

#### Scenario: Bounded 5h under its target
- **WHEN** k is 0.5, the 7d is at 90 % and resets after the 5h window ends, and the 5h is at 10 % with half of its window passed, resetting later today at 3 PM
- **THEN** the 5h explanation reads `5h at 10%: at this 5h pace the 7d still has ~5% left when the 5h resets at 3 PM.`

#### Scenario: Bounded 5h on its target
- **WHEN** k is 0.5, the 7d is at 90 % and resets after the 5h window ends, and the 5h is at 20 % with half of its window passed, resetting later today at 3 PM
- **THEN** the 5h explanation reads `5h at 20%: at this 5h pace the 7d runs out as the 5h resets at 3 PM.`

## REMOVED Requirements

### Requirement: No pace without a usable reading
**Reason**: Its text is over the 500 characters `openspec validate --strict` allows. OpenSpec does not let a modified requirement drop scenarios, or a name be both removed and added.
**Migration**: Split, unchanged in behaviour, into "When a limit has no pace" (the three cases) and "Drawing without a pace" (what each style draws).

### Requirement: Lanes style
**Reason**: Its text is over the 500 characters `openspec validate --strict` allows. OpenSpec does not let a modified requirement drop scenarios, or a name be both removed and added.
**Migration**: Split, unchanged in behaviour, into "Lanes token and time lanes", "Lanes cells ahead of par", "Lanes spare cells" and "Lanes overspend on the time lane".
