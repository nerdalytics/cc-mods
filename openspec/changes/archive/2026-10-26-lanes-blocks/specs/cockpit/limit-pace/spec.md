# Spec Delta

## MODIFIED Requirements

### Requirement: Lanes style
With `limit_style` `lanes`, a tag SHALL draw two lanes of ▀ cells. The top lane is the token lane, lit up to the usage left. The bottom lane is the time lane, lit up to the par left. With a pace, the tag SHALL count the cells the usage is ahead of par: ahead = (percent used − 100 × par) × length / 100.
- Over pace (ahead > 0), ⌈ahead⌉ cells are impacted. The last ones of the token lane, at most all of it, SHALL shade amber to red toward the lane's end; a single impacted cell draws amber.
- Under pace (ahead < 0), ⌊−ahead⌋ cells are spare. The last ones of the token lane, at most all of it, SHALL draw in the spending-welcome colour.
- When more cells are impacted than the token lane has lit cells, every lit cell of the time lane SHALL draw deep red.
- All other lit cells draw in the limit's gradient. Empty cells of either lane SHALL draw empty.

#### Scenario: Usage ahead of par
- **WHEN** the 7d tag has 7 cells, is at 51 % used, and a third of its window has passed
- **THEN** the token lane is lit to 3 cells, its 2nd and 3rd amber to red, as the usage is about 1.2 cells ahead; the time lane is lit to 4 cells

#### Scenario: Ahead of par by two cells
- **WHEN** the 5h tag has 10 cells, is at 38 % used, its target is 100 % and 19 % of its window has passed
- **THEN** the token lane is lit to 6 cells, its 5th and 6th amber to red; the time lane is lit to 8 cells in the limit's gradient

#### Scenario: Any spend ahead impacts a whole cell
- **WHEN** the 7d tag has 7 cells, is at 38 % used, and a third of its window has passed
- **THEN** the token lane is lit to 4 cells, and its 4th draws amber

#### Scenario: Behind par
- **WHEN** the 7d tag has 7 cells, is at 10 % used, and 60 % of its window has passed
- **THEN** the token lane is lit to 6 cells, its 4th to 6th in the spending-welcome colour; the time lane is lit to 2 cells

#### Scenario: On par
- **WHEN** the 7d tag has 7 cells, is at 33 %, and a third of its window has passed
- **THEN** both lanes are lit to 4 cells in the limit's gradient, with no pace colour

#### Scenario: More impacted than the token lane holds
- **WHEN** the 7d tag has 7 cells, is at 80 % used, and 45 % of its window has passed
- **THEN** the token lane is lit to 1 cell in amber, and the time lane's 3 lit cells draw deep red

#### Scenario: Token lane empty
- **WHEN** the 7d tag has 7 cells, is at 95 % used, and 80 % of its window has passed
- **THEN** the token lane is empty, and the time lane's 1 lit cell draws deep red

### Requirement: No pace without a usable reading
A non-classic style SHALL draw no pace in any of these cases:
- the reading has no reset time;
- this session's last response is more than 10 minutes old;
- less than a tenth of the window has passed.

Without a pace, the tag SHALL draw no pace colours:
- `gauge` keeps its percent used in the badge, leaves every cell empty and draws its pipe dim;
- `lanes` draws both lanes in the neutral dim colour, the token lane to the usage left and the time lane to the time left at the moment it draws;
- `notch` draws its usage in the neutral dim colour, with no notch.

#### Scenario: Early in a window
- **WHEN** 5 % of the 5h window has passed
- **THEN** the 5h tag draws its usage dim, with no pace colours

#### Scenario: Stale reading
- **WHEN** this session's last response is 11 minutes old
- **THEN** both limit tags draw without pace

#### Scenario: Lanes without a pace
- **WHEN** `limit_style` is `lanes`, the 7d tag has 7 cells, the 7d reading has no reset time and is at 30 % used
- **THEN** the token lane is lit dim to 4 cells and the time lane is empty

### Requirement: Pace colours
`gauge` and `notch` SHALL draw under-pace cells in slate. Every non-classic style SHALL draw over-pace cells in a gradient from amber to red. `lanes` SHALL draw its spare cells in the spending-welcome colour, blue-400 (#60a5fa) by default, and its time lane in deep red (#991b1b) by default when the impacted cells outrun its token lane. All of these colours SHALL be listed in `/cockpit:colors`, and the `colors` option SHALL be able to override them.

#### Scenario: Colours are configurable
- **WHEN** the person sets `pace.under=#112233` in `colors`
- **THEN** the under-pace cells of `gauge` and `notch` draw in #112233

#### Scenario: Spending-welcome colour is configurable
- **WHEN** the person sets `pace.spare=#112233` in `colors` and `limit_style` is `lanes`
- **THEN** the spare cells of the token lane draw in #112233

#### Scenario: Deep red is configurable
- **WHEN** the person sets `pace.severe=#112233` in `colors`, `limit_style` is `lanes`, and more cells are impacted than the token lane has lit
- **THEN** the time lane's lit cells draw in #112233

### Requirement: 5h paused while the 7d is used up
While the 7d is at 100 %, or a session was refused on it and the refusal has not reset, the 5h tag SHALL draw as paused in every non-classic style: all cells empty, with no pace; the gauge keeps its percent used in the badge and draws its pipe dim. Its explanation SHALL say it is paused until the 7d resets, with the time left until then. In `classic`, the 5h tag and its explanation SHALL draw as they do without a pause.

#### Scenario: 7d used up
- **WHEN** the 7d is at 100 %, resets in 2 days 4 hours, and `limit_style` is `gauge`
- **THEN** the 5h gauge draws empty, and its explanation reads that the 5h is paused until the 7d resets in 2d4h

#### Scenario: Classic ignores the pause
- **WHEN** the 7d is at 100 % and `limit_style` is `classic`
- **THEN** the 5h tag draws its time and usage left, and its explanation does not say it is paused
