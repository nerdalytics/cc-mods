**From:** limit-texts-count-forward, ticket 01, review round 4

At cockpit/tests/cockpit.test.ts:1357 (commit 105e94f), the lanes over-pace test pins `2d10h` for the time before the reset but leaves the run-out as `\d+d\d+h`. The input `reading("seven_day", 51, 1 / 3)` is deterministic, so the reviewer computes the run-out as 2d5h and suggests pinning it, for example `2d[45]h`. Rated low, standards.
