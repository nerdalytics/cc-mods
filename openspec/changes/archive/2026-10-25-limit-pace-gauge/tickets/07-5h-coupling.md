# 07: 5h target bounded by the 7d

**Area:** cockpit

**Blocked by:** 04

**What to build:** The 5h target becomes what the 7d can still pay for. The mod measures the coupling factor k, the 7d percent that 1 % of 5h costs, from the readings it already receives, with no setting. It keeps a base reading per 5h window in session state, typed with the mod's other state keys, and replaces the base when either reset time moves by 60 seconds or more. A sample needs a 5h rise of at least 10 points within one window, both 7d readings sharing one reset time, and a positive k; the latest sample stands. With k known and the 7d resetting after the 5h window ends, the 5h target is min(100, 5h used + (100 − 7d used) / k); otherwise it is 100. k is lost with each new session and each `/clear`. Tests feed a sequence of usage readings and read the 5h gauge or its explanation. See the limit-pace spec and the design section "k in session state".

- [x] Within one 5h window, the 5h going from 10 % to 25 % and the 7d from 40.0 % to 41.5 % measures k = 0.1.
- [x] Within one 5h window, the 5h going from 10 % to 14 % leaves k unchanged.
- [x] A 7d reset time that moves by 60 seconds or more between two readings yields no sample, and one that moves by less counts as unchanged.
- [x] With k 0.5, the 5h at 20 %, the 7d at 90 % and the 7d resetting after the 5h window ends, the 5h gauge draws against a target of 40 %.
- [x] With the 7d resetting 1 hour from now and the 5h window ending in 3 hours, the 5h target is 100 %.
- [x] With no k measured in this session, the 5h target is 100 %.
- [x] The README describes the coupling, k, its measurement per session, and the 10-point minimum.
