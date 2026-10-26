# 02: Release cockpit 1.4.0

**Area:** cockpit

**Blocked by:** 01

**What to build:** Cockpit 1.4.0 ships the new `lanes`. It is a minor release by the user's decision (Q38 a), though the repository's versioning rule makes a change to documented behaviour a major one. The release writes down, with a test, that `classic` ignores the paused 5h, and it deletes the throwaway prototypes. See the design's "Migration Plan" and the limit-pace delta spec's "5h paused while the 7d is used up".

- [x] With `limit_style` `classic` and the 7d at 100 %, the 5h tag draws its time left and usage left, and its explanation does not say it is paused. A test asserts both through the drawn output.
- [x] The README's Upgrading section has a 1.4.0 entry. It says that `lanes` now draws the tokens on top and the par left below, colours the cells the pace moved instead of the gap, and adds the colours `pace.spare` and `pace.severe`, and that the release is minor by choice.
- [x] The throwaway prototypes `prototype-lanes.mjs` and `prototype-pace.mjs` in the cockpit folder are deleted. Both are untracked, so the deletion is not part of any commit.
- [x] `tsc -p cockpit --noEmit`, `claude plugin validate cockpit` and `claude plugin test cockpit` all pass.
- [x] The plugin's version is 1.4.0, bumped in its own commit `Release cockpit 1.4.0` that changes only the plugin manifest.
