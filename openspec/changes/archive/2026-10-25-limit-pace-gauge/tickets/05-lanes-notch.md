# 05: Lanes and notch styles

**Area:** cockpit

**Blocked by:** 04

**What to build:** The two remaining non-classic values of `limit_style`, drawn from the shared pace that ticket 04 built. `lanes` keeps today's two lanes, the top lane lit to the par left, the bottom lane to the usage left, with the gap coloured. `notch` draws one full-height lane of the usage left with a notch at the par left. Tests reach the mod only through its drawn output. See the limit-pace spec.

- [x] With `lanes`, a 7d tag of 7 cells at 51 % used with par 33 % lights the bottom lane to 3 cells, and the cells between 3 and the par line at 4 draw amber to red. Bottom cells lit past the par line draw slate.
- [x] With `notch`, a 7d tag of 7 cells whose par left is 67 % draws the notch after the 5th cell. Lit cells past the notch draw slate, and empty cells before it draw amber to red.
- [x] Without a pace, `lanes` draws both lanes in the neutral dim colour, the top lane to the par left and the bottom lane to the usage left, and `notch` draws its usage in the neutral dim colour with no notch. Neither draws pace colours.
- [x] The README's description of the styles shows `lanes` and `notch`.
