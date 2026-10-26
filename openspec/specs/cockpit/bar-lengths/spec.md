# cockpit/bar-lengths Specification

## Purpose

Lets the person set how many cells the 7d, 5h and context bars take, so a bar can trade room in the row for resolution.

## Requirements

### Requirement: Bar length options
The mod SHALL read three number options:
- `limit_7d_length`, default 7;
- `limit_5h_length`, default 10;
- `context_length`, default 10.

Each SHALL accept any whole number from 1 up. A value that is not a number SHALL fall back to its default, a fraction SHALL be rounded down, and a value below 1 SHALL count as 1.

#### Scenario: Defaults
- **WHEN** none of the three options is set
- **THEN** the 7d bar is 7 cells, the 5h bar 10 cells and the context bar 10 cells, as in cockpit 1.1.0

#### Scenario: Longer 7d bar
- **WHEN** `limit_7d_length` is 14
- **THEN** the 7d bar draws 14 cells in every style, the gauge's being 7 cells, the pipe and 7 cells

#### Scenario: Out of range
- **WHEN** `context_length` is 0
- **THEN** the context bar draws 1 cell

### Requirement: Length descriptions
Each length option's `/config` description SHALL say what a length does: the number of cells the bar draws. A longer bar shows finer steps of the same percentage. In the gauge style, the length is split in half to each side of the pipe, rounded down.

#### Scenario: Description present
- **WHEN** the person opens `/config` for cockpit
- **THEN** each of the three length rows explains that the number is the bar's cells, and how the gauge style splits it
