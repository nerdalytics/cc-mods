**From:** limit-texts-count-forward, ticket 01, review round 4

At cockpit/tests/cockpit.test.ts:1286 (commit 105e94f), and again at line 1294, the clock tests `return` early when the reset is under 60 s away, so the run reports a pass with no assertion made. The reviewer's fix: use `test.skipIf` or a skip so the log shows the test as skipped. Rated low, standards.
