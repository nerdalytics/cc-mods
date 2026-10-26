# 04: Release cockpit 1.5.0

**Area:** cockpit

**Blocked by:** 03

**What to build:** Cockpit 1.5.0 ships the new limit texts. It is a minor release by the user's decision (Q72), as 1.4.0 was (Q38 a), though the repository's versioning rule makes a change to documented behaviour a major one. See the design's "Migration Plan".

- [ ] The README's Upgrading section has a 1.5.0 entry. It says that:
  - the limit explanations and the run-out warning share one frame, count forward and name the reset by its clock time;
  - a bounded 5h names the 7d;
  - the warning no longer warns of a refused limit or a paused 5h;
  - the release is minor by choice.
- [ ] `openspec validate limit-texts-count-forward --strict` passes.
- [ ] `tsc -p cockpit --noEmit`, `claude plugin validate cockpit` and `claude plugin test cockpit` all pass.
- [ ] The plugin's version is 1.5.0, bumped in its own commit `Release cockpit 1.5.0` that changes only the plugin manifest.
