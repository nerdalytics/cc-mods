# Spec Delta

## Purpose

Shows on the 7d and 5h limit tags whether each limit is on pace to be used up exactly at its reset. The 5h target is bounded by what the 7d limit can still pay for.

## ADDED Requirements

### Requirement: Limit style option
The mod SHALL read a `limit_style` option that sets how both limit tags draw. Its values are `classic`, `lanes`, `gauge` and `notch`. `classic` is the default, and so is any other value. `classic` SHALL draw both tags exactly as before this change: the top half is the time left, the bottom half the usage left.

#### Scenario: Default is today's bar
- **WHEN** `limit_style` is unset
- **THEN** each limit tag draws its badge and its two-lane bar as cockpit 1.1.0 did, with no pace colours, except that its hover text moves to the explanation line

#### Scenario: Unknown value falls back
- **WHEN** `limit_style` is `fancy`
- **THEN** both limit tags draw as `classic`

### Requirement: Pace ratio
For a non-classic style, a limit's pace SHALL be r = percent used / (share of the window passed × target), with the share passed measured at the time of the reading.
- r < 1: a share (1 − r) of the target goes unused.
- r > 1: the limit runs out with a share (1 − 1/r) of the window still to go.
- r within 0.05 of 1: on pace.

#### Scenario: Over pace
- **WHEN** the 7d limit is at 51 % with a third of its window passed
- **THEN** r is about 1.53, and the tag draws over pace

#### Scenario: Under pace
- **WHEN** the 7d limit is at 10 % with 60 % of its window passed
- **THEN** r is about 0.17, and the tag draws under pace with about 83 % unused

### Requirement: No pace without a usable reading
A non-classic style SHALL draw no pace in any of these cases:
- the reading has no reset time;
- this session's last response is more than 10 minutes old;
- less than a tenth of the window has passed.

Without a pace, the tag SHALL draw no pace colours:
- `gauge` keeps its percent used in the badge, leaves every cell empty and draws its pipe dim;
- `lanes` draws both lanes in the neutral dim colour, the top lane to the par left and the bottom lane to the usage left;
- `notch` draws its usage in the neutral dim colour, with no notch.

#### Scenario: Early in a window
- **WHEN** 5 % of the 5h window has passed
- **THEN** the 5h tag draws its usage dim, with no pace colours

#### Scenario: Stale reading
- **WHEN** this session's last response is 11 minutes old
- **THEN** both limit tags draw without pace

### Requirement: Pace colours
A non-classic style SHALL draw under-pace cells in slate. It SHALL draw over-pace cells in a gradient from amber to red, redder with the share of the window that would be left when the limit runs out. All of these colours SHALL be listed in `/cockpit:colors`, and the `colors` option SHALL be able to override them.

#### Scenario: Colours are configurable
- **WHEN** the person sets `pace.under=#112233` in `colors`
- **THEN** the under-pace cells draw in #112233

### Requirement: Lanes style
With `limit_style` `lanes`, a tag SHALL draw two lanes of ▀ cells. The top lane is lit up to the par left. The bottom lane is lit up to the usage left. Bottom cells lit past the par line draw slate. Bottom cells empty before the par line draw amber to red.

#### Scenario: Usage ahead of par
- **WHEN** the 7d tag has 7 cells, is at 51 % used, and par is 33 %
- **THEN** the bottom lane is lit to 3 cells, and the cells between 3 and the par line at 4 draw amber to red

### Requirement: Gauge style
With `limit_style` `gauge`, the badge SHALL read the limit and its percent used, such as `7d 51%`. The bar SHALL be floor(length / 2) cells on each side of a centre pipe. Under pace fills the left side outward from the pipe in slate. Over pace fills the right side outward in amber to red. Each side fills in half-cell steps, to f × 2 × floor(length / 2) halves, rounded, where f is (1 − r) under pace and (1 − 1/r) over pace.

#### Scenario: Gauge width
- **WHEN** the 5h length is 10
- **THEN** the gauge is 5 cells, the pipe, then 5 cells

#### Scenario: Odd length
- **WHEN** the 7d length is 7
- **THEN** the gauge is 3 cells, the pipe, then 3 cells

### Requirement: Notch style
With `limit_style` `notch`, a tag SHALL draw one full-height lane of the usage left, with a notch at the par left, rounded to the nearest cell. Lit cells past the notch draw slate. Empty cells before the notch draw amber to red.

#### Scenario: Notch at par
- **WHEN** the 7d tag has 7 cells and its par left is 67 %
- **THEN** the notch sits after the 5th cell

### Requirement: 7d target and par
The 7d target SHALL be 100 %. Its share of the window passed SHALL be computed from calendar time since the window began, nights and idle stretches included. The window begins at its reset time minus 7 days.

#### Scenario: Idle night counts
- **WHEN** no request was made for 8 hours of the 7d window
- **THEN** those 8 hours still count toward the 7d share passed

### Requirement: 5h par
The 5h share of the window passed SHALL be the time since the 5h window began, over 5 hours. The window begins at its reset time minus 5 hours. The mod SHALL NOT align the 5h window to a clock grid.

#### Scenario: Window from reset time
- **WHEN** the 5h limit resets at 01:00 UTC and it is 22:30 UTC
- **THEN** the share passed is 0.5

### Requirement: 5h target bounded by the 7d
Once k is measured and the 7d resets after the 5h window ends, the 5h target SHALL be min(100, 5h used + (100 − 7d used) / k). When the 7d resets before the 5h window ends, the target SHALL be 100. Until k is measured, the target SHALL be 100: the 5h tag draws uncoupled.

#### Scenario: 7d caps the 5h
- **WHEN** k is 0.5, the 5h is at 20 %, the 7d is at 90 %, and the 7d resets after the 5h window ends
- **THEN** the 5h target is 40 %

#### Scenario: 7d resets first
- **WHEN** the 7d resets 1 hour from now and the 5h window ends in 3 hours
- **THEN** the 5h target is 100 %

#### Scenario: No k yet
- **WHEN** no k has been measured in this session
- **THEN** the 5h target is 100 %

### Requirement: Measuring k
The mod SHALL measure k, the 7d percent that 1 % of 5h costs, from the readings it receives, with no setting. A sample is the 7d rise divided by the 5h rise within one 5h window. It SHALL count only when:
- the 5h rose by at least 10 points;
- both 7d readings share one reset time.

A reset time counts as changed only when it moves by 60 seconds or more.

The latest such sample stands until a newer one replaces it.

#### Scenario: Sample taken
- **WHEN** within one 5h window the 5h goes from 10 % to 25 % and the 7d from 40.0 % to 41.5 %
- **THEN** k becomes 0.1

#### Scenario: Rise too small
- **WHEN** within one 5h window the 5h goes from 10 % to 14 %
- **THEN** k is not updated

#### Scenario: 7d reset inside the window
- **WHEN** the 7d reset time changes between the two readings
- **THEN** that pair yields no sample

### Requirement: 5h paused while the 7d is used up
While the 7d is at 100 %, or a session was refused on it and the refusal has not reset, the 5h tag SHALL draw as paused in every non-classic style: all cells empty, with no pace; the gauge keeps its percent used in the badge and draws its pipe dim. Its explanation SHALL say it is paused until the 7d resets, with the time left until then.

#### Scenario: 7d used up
- **WHEN** the 7d is at 100 %, resets in 2 days 4 hours, and `limit_style` is `gauge`
- **THEN** the 5h gauge draws empty, and its explanation reads that the 5h is paused until the 7d resets in 2d4h

### Requirement: Limit explanation text
Each limit tag's explanation SHALL include:
- the limit's badge;
- its percent used;
- the time until it resets;
- in a non-classic style with a pace, one of: on pace, the share that goes unused, or how long before the reset it runs out.

#### Scenario: Explanation over pace
- **WHEN** the 7d tag is hovered at 51 % used with r about 1.53, resetting in 4d16h
- **THEN** the explanation names 7d, 51 % and 4d16h, and says how long before the reset it runs out at this pace
