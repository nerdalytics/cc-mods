# The 1.4.0 Upgrading entry does not say `pace.under` stopped recolouring lanes

**Status:** needs-triage

Since cockpit 1.4.0, `pace.under` is labelled "gauge and notch: under pace" (`cockpit/hooks/cockpit.ts:413`) and `lanes` draws its spare cells in `pace.spare` instead (`cockpit/hooks/cockpit.ts:1893`, `:416`). The 1.4.0 entry under Upgrading (`cockpit/README.md:218`) names the two new colours `pace.spare` and `pace.severe` but does not say that a `pace.under` override no longer applies to `lanes`, so a user who set `pace.under` to recolour `lanes` sees it stop working with no note. Ticket 02 of `lanes-blocks` raised it in review as not required by its criterion (handoff `HANDOFF-2026-10-26-0030.md`, Open issues). A fix is one sentence in that entry.
