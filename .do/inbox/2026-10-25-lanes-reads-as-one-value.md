# The lanes style can read as one value

**Status:** needs-triage

**Change:** `openspec/changes/lanes-blocks/` (prototype verdict in `.do/prototypes/lanes-tokens-on-top.md`)

In the user's live check of cockpit 1.2.0 (session de976edb, 2026-10-25, a beacon session on Fable 5.1), the `lanes` tags looked to the user as if they showed only one value, with the second one only in the hover text. By the code and README (`cockpit/README.md:42`) both lanes are still drawn: each cell is a `▀`, its top half the par left (at a target of 100 the time left, as `classic`'s top half is) and its bottom half the usage left, and only the cells where the two differ change colour, amber to red when usage is ahead of par, slate when behind. The 5h reading in the screenshot, 69 % used with 2h20m to its reset, puts the par left at about 47 % and the usage left at 31 %, which on 10 cells is a top lane of 4 cells and a bottom lane of 3 (if k was not measured), so the two lanes differ in one cell and the bar reads as a single run. To decide: whether `lanes` needs a stronger split between its halves (a different colour for the top lane, or a visible gap), or whether `gauge` or `notch` already answers the wish to see time and usage apart. Not checked against the screenshot pixel by pixel.
