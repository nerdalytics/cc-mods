# 03: Hovers move into the explanation line

**Area:** cockpit

**Blocked by:** 02

**What to build:** Hovering a tag no longer lays its hover value over the tag. It reveals the tag's explanation in the explanation line instead, through the engine's plugin-wide hover scope, so it works from a row on either side of the prompt. The tags are `limit_7d`, `limit_5h`, `context`, `turns`, `tokens`, `agents` and `cache`. The rows and the explanation line read the same state, so an explanation always agrees with its tag. Tests reach the mod only through its drawn output; an explanation is in the drawn tree even while hidden. See the explanation-row spec and its design section "Explanation line built from a shared snapshot".

- [x] Each of the seven tags joins its own hover scope, and the explanation line holds one hidden explanation for each of the seven tags, revealed by that tag's scope.
- [x] No tag draws an overlay of its own any more.
- [x] A revealed explanation covers anything shown in the line beneath it, the run-out warning included.
- [x] An explanation longer than the line wraps between words, its further lines drawing over what lies below the line rather than moving it.
- [x] Each explanation carries at least today's hover value. Context: the tokens left, so 120,000 tokens left shows `120.0K`. Turns: the subagents' count and requests, once a subagent has run; before that, what the tag shows. Tokens: the main session's tokens, or with `merge_costs` on, the main session's and its subagents' together. Agents: the subagents' tokens. Cache: while warm, what the prompt costs once the cache is cold; while cold, what the tag shows.
- [x] Each limit's explanation names its badge, its percent used and the time until it resets.
- [x] A chip pads to its value's width only. While `explain_row` is on, each of the seven tags keeps its value on the grey background, the turns tag before any subagent and a cold cache included; while it is off, no value stands on the grey.
- [x] The README's status-row table, "Clicking and hovering" and "Colours" sections describe hovers revealing explanations in the explanation line.
