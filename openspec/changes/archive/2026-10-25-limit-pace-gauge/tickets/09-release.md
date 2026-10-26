# 09: Release cockpit 1.2.0

**Area:** cockpit

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08

**What to build:** Cockpit 1.2.0 ships the change as a minor release, by the user's decision, though the root README's versioning rule would make it major. The README's Needs line must name a Claude Code version whose plugin types carry the hover scope, and its Upgrading section tells people what changed for them. See the design's "Migration Plan" and "Open Questions".

- [x] The README's Needs line names the earliest Claude Code version whose bundled plugin types carry the hover `scope`, from the types of the versions installed on this machine or the changelog; 2.1.303, whose bundled types carry it, when nothing earlier is confirmed. The ticket's report names the source.
- [x] The README's Upgrading section has a 1.2.0 entry. It names the removed `forecast` layout name and that `explain` goes last, that a saved `forecast` line stays as an empty row that `/cockpit:order` can drop under hidden, that the hover texts moved to the explanation line, and that the release is minor by choice.
- [x] `tsc -p cockpit --noEmit`, `claude plugin validate cockpit` and `claude plugin test cockpit` all pass.
- [x] The plugin's version is 1.2.0, bumped in its own commit `Release cockpit 1.2.0` that changes only the plugin manifest.
