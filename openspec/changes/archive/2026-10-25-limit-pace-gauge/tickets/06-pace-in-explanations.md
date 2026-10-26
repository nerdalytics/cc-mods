# 06: Pace words in the limit explanations

**Area:** cockpit

**Blocked by:** 03, 04

**What to build:** In a non-classic style with a pace, each limit's explanation adds what the pace means: on pace, the share of the target that goes unused, or how long before the reset the limit runs out. Tests reach the mod only through its drawn output; read the explanation's text in the drawn tree. See the limit-pace spec, "Limit explanation text".

- [x] At 51 % used with a third of the 7d window gone, the 7d explanation names 7d, 51 % and the time to the reset, and says how long before the reset it runs out at this pace.
- [x] At 10 % used with 60 % of the 7d window gone, the 7d explanation includes `~83% unused`.
- [x] With r within 0.05 of 1, the explanation says the limit is on pace.
- [x] Early in the window or with a stale reading, the explanation carries no pace words.
- [x] With `limit_style` `classic`, the explanation carries no pace words.
