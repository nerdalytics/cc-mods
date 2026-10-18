// Much of this ports statusline.zsh, the shell status line it replaces: https://github.com/nerdalytics/claude-statusline
import type { Elements, EngineInterface, Register } from "claude-code";
import type { StatusCache, StatusGit, StatusLimit, StatusPr, StatusSpend, StatusTokens, StatusUsage } from "../types";

type Ui = Elements["terminal"];
type RGB = [number, number, number];
type Parts = ReturnType<Ui["Text"]>[];
type Snapshot = {
  usage: StatusUsage;
  model: string;
  tokens?: StatusTokens;
  turns?: number;
  compactAt?: number;
  sent?: number;
  git?: StatusGit;
  pr?: StatusPr | null;
  rejected?: Record<string, number>;
  now: number;
  phase: number;
};
type Segment = (ui: Ui, s: Snapshot) => Parts;

const SEGMENTS = {
  model: ({ Box, Text }, s) => {
    const { from, to, bold } = modelStyle(s.model);
    // Bare text, not a chip: compact spacing keeps a column after it, so it doesn't run into the next tag.
    return [Box({ paddingRight: 1 - gap, children: [run(Box, Text, formatModel(s.model), (i, n) => sweep(from, to, i, n, s.phase), bold)] })];
  },
  limits: ({ Box, Text }, s) => {
    const limits = limitsOf(s.usage.rateLimits, s.rejected, s.now * 1000);
    return [
      ...LIMITS.flatMap((limit) => {
        const found = limits.find((r) => r.kind === limit.kind);
        return found ? [limitParts(Box, Text, limit, found, s.now)] : [];
      }),
      // ponytail: probe, whether Claude Code reports a window beyond 7d and 5h (a Fable one?): drawn as its name and
      // percentage. Give it a bar of its own, or delete this, once a screenshot says.
      ...limits.filter((r) => !LIMITS.some((l) => l.kind === r.kind)).map((r) => Text({ children: `${r.kind} ${r.percentUsed}%` })),
    ];
  },
  context: ({ Box, Text }, s) => contextParts(Box, Text, s.usage.context, s.compactAt, smartZone),
  turns: ({ Box, Text }, s) => (s.turns !== undefined ? [turnParts(Box, Text, s.turns, s.tokens)] : []),
  tokens: ({ Box, Text }, s) => (s.tokens ? tokenParts(Box, Text, s.tokens) : []),
  cache: ({ Box, Text }, s) => (s.tokens?.cache ? [cacheParts(Box, Text, s.tokens.cache, s.now, s.sent)] : []),
  git: ({ Box, Text, Link }, s) => (s.git ? gitParts(Box, Text, Link, s.git, s.pr) : []),
} satisfies Record<string, Segment>;

// The two rows' segments, left to right. Each row, and each segment of the status row, is a /config toggle (row_git,
// row_status, segment_<name>), and each row's place a picker (row_git_position, row_status_position): above the prompt,
// or under it below the engine's hint line. Two rows in one place stack git first. Applied in register.
type Layout = (keyof typeof SEGMENTS)[];
const GIT_ROW: Layout = ["git"];
const STATUS_ROW: Layout = ["model", "limits", "context", "turns", "tokens", "cache"];
let aboveRows: Layout[] = [GIT_ROW];
let belowRows: Layout[] = [STATUS_ROW];

const USAGE = { plugin: "statusline", key: "usage" } as const;
const MODEL = { plugin: "statusline", key: "model" } as const;
const TOKENS = { plugin: "statusline", key: "tokens" } as const;
const TURNS = { plugin: "statusline", key: "turns" } as const;
const COMPACT_AT = { plugin: "statusline", key: "compactAt" } as const;
type Offer = "fresh" | "compact";
const DISMISSED = { plugin: "statusline", key: "dismissed" } as const;
const SENT = { plugin: "statusline", key: "sent" } as const;
const GIT = { plugin: "statusline", key: "git" } as const;
const PR = { plugin: "statusline", key: "pr" } as const;
const REJECTED = { plugin: "statusline", key: "rejected" } as const;
const HANDOFF = { plugin: "statusline", key: "handoff" } as const;
const TICK = { plugin: "statusline", key: "tick" } as const;
const LOAD = { plugin: "statusline", key: "load" } as const;
// Anthropic's pricing table as markdown, USD per million tokens.
const PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing.md";
// The tick also paces the animations: $.ui.invalidate caps the band at thirty redraws a second.
const FRAME_MS = 100;
// What no event announces is polled: limits (other sessions spend them too) and git (edits and branch switches from
// anywhere). One poll is about 0.15 s of git work. The PR goes over the network, so on a branch change or once a minute,
// and every 10 s while its checks are running or queued.
const POLL_MS = 2_000;
const PR_POLL_MS = 60_000;
const PR_BUSY_POLL_MS = 10_000;
// Other sessions' transcripts, for a limit one of them was refused on: a few hours of them read, so less often.
const REJECTED_POLL_MS = 10_000;
// Before the cache goes cold the mod runs the plugin's own handoff skill, once per idle stretch, when the person's
// auto_handoff option (plugin.json userConfig, a /config row) is on: while the cache is warm the handoff reads it at
// the hit price, and the document it leaves lets the next session start without it.
const HANDOFF_COMMAND = "statusline:handoff";
// With the keep_warm_pings option on, a minimal prompt of the mod's own reads the cache just before it expires, which
// restarts its TTL at the read price. The lead is how many seconds before expiry the ping goes out, by TTL; the gap
// keeps one ping from going out twice before its turn has started.
const PING_TEXT = "The prompt cache needs a request to stay warm. Reply with the single word ok and use no tools.";
const PING_LEAD_S: Record<number, number> = { 3_600: 300, 300: 60 };
const PING_GAP_MS = 10_000;
// Sweep speed per effort, linear: each step adds a ninth of a cycle a second, so high (3) sweeps once every 3 s.
// "none" is a request sent without effort; a level missing here (a numeric budget) sweeps as high.
const EFFORT_STEPS: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const STEP_CYCLES_PER_SECOND = 1 / 9;

const CONTEXT_CELLS = 10;
// The share of the smart zone the context has used when the line offering a compaction appears.
const COMPACT_HINT_AT = 0.9;
const SMART_ZONE_URL = "https://www.aihero.dev/ai-coding-dictionary/smart-zone";
// How far into the dumb zone the context is, by its size over the smart zone's: the further, the sloppier the model.
const DUMB_ZONE_DEPTHS: [number, string][] = [[1.25, "just into"], [1.5, "well into"], [2, "deep into"], [Infinity, "very deep into"]];
// statusline.zsh's overflow colour: its piecewise blend toward purple never ran, as nothing set the tokens it scaled.
const OVERFLOW_RED: RGB = [239, 68, 68];
// A pull request's number, whole in one colour by state: open yellow, draft white, merged purple, closed grey.
const PR_COLORS: Record<string, RGB> = { open: [250, 204, 21], draft: [240, 240, 245], merged: [168, 85, 247], closed: [130, 135, 152] };
const LIMITS: { kind: string; badge: string; seconds: number; segments: number; from: RGB; to: RGB }[] = [
  { kind: "seven_day", badge: "7d", seconds: 604_800, segments: 7, from: [192, 132, 252], to: [100, 50, 150] },
  { kind: "five_hour", badge: "5h", seconds: 18_000, segments: 10, from: [34, 211, 238], to: [15, 140, 150] },
];
// The four stops of statusline.zsh's _sl_pal: cyan, blue, purple, pink.
const PALETTE: RGB[] = [
  [34, 211, 216],
  [96, 165, 250],
  [168, 85, 247],
  [217, 70, 239],
];
const EMPTY_FG: RGB = [55, 58, 72];
// The colour code, by what a thing does:
// - hoverable: a tag, then the value on the grey above (EMPTY_FG), which a hover lays its own value over;
// - data without a hover: a tag, then the value on no background;
// - plain text: coloured or dim, on no background;
// - a button: a tag, then the label on BUTTON_BG, a background nothing else uses;
// - a link: gradient text on no background, opened by a click.
const BUTTON_BG: RGB = [20, 83, 45];
type ModelStyle = { from: RGB; to: RGB; bold?: true };
// A window one palette step wide that slides from cyan towards pink as the family gets stronger.
// Mythos is Fable's model without Fable's safeguards: Fable's colours, bold.
const MODEL_STYLES: Record<string, ModelStyle> = {
  haiku: { from: PALETTE[0], to: PALETTE[1] },
  // Glyph 1 of 3 in a lerp is the halfway colour.
  sonnet: { from: lerp(PALETTE[0], PALETTE[1], 1, 3), to: lerp(PALETTE[1], PALETTE[2], 1, 3) },
  opus: { from: PALETTE[1], to: PALETTE[2] },
  fable: { from: PALETTE[2], to: PALETTE[3] },
  mythos: { from: PALETTE[2], to: PALETTE[3], bold: true },
};
// GitHub's own icons (octicons) and Font Awesome's, from the Nerd Font: CommitMono draws ✓ and ✗ as √ and X, and has no
// ⚠, ✎ or ✉ (each checked in the font's cmap).
const OCT_CHECK = "\uf42e";
const OCT_X = "\uf467";
const OCT_DOT = "\uf444";
const WARN_MARK = "\uf071";
const DRAFT_MARK = "\uf040";
const COMMENT_MARK = "\uf0e0";
const REVIEW_MARKS: Record<string, string> = { APPROVED: ` ${OCT_CHECK}`, CHANGES_REQUESTED: ` ${OCT_X}`, REVIEW_REQUIRED: " ⋯" };
// The subagent mark and the prompts mark. ⚡ (U+26A1) is East Asian Wide, so terminals give it two cells while
// CommitMono draws it in one, leaving a gap; Nerd Font's bolt (nf-fa-bolt, U+F0E7) is one cell. ↵ (U+21B5) is not in
// CommitMono and came from a fallback font; ⏎ (U+23CE) is.
const AGENT_MARK = "\uf0e7";
const PROMPT_MARK = "⏎";
// The chips' stops, lighter to darker, as the limits' are: prompts blue, the main session's tokens pink, its
// subagents' amber.
const TURNS_CHIP: { from: RGB; to: RGB } = { from: [96, 165, 250], to: [37, 99, 235] };
const TOKENS_CHIP: { from: RGB; to: RGB } = { from: [217, 70, 239], to: [134, 25, 143] };
const AGENTS_CHIP: { from: RGB; to: RGB } = { from: [251, 191, 36], to: [180, 83, 9] };
// The cache chip: green while the next prompt reads the cache, red once it writes it again.
const WARM_CHIP: { from: RGB; to: RGB } = { from: [74, 222, 128], to: [21, 128, 61] };
const COLD_CHIP: { from: RGB; to: RGB } = { from: [248, 113, 113], to: [185, 28, 28] };
const CACHE_MARK = "◷";

let tick: { cancel: () => void } | undefined;
// Advanced per frame rather than derived from the clock, so a speed change carries on from where the sweep is.
let phase = 0;
// The main loop's effort as its last model request carried it; unknown until the first request.
let effort: string | number | undefined;
// Fetched once per session; undefined until a fetch parses, so a failed one is retried at the next scan.
let prices: Record<string, Price> | undefined;
// Frames since the session started; a poll runs every POLL_MS of them, so the engine's clock paces it.
let frames = 0;
// A model request ended since the last token scan; the scan waits for the next poll, by when the transcript has it.
let tokensStale = false;
// The person's options, set as the module registers.
let autoHandoff = false;
let freshStart = false;
let compactHint = false;
let autoCompact = false;
// The most pings per idle stretch, the keep_warm_pings option; 0 sends none.
let keepWarm = 0;
// The pings sent in the stretch since the person's prompt at pingFor, and when the last went out.
let pings = 0;
let pingFor = 0;
let pingAt = -Infinity;
// The columns between a row's tags: none with the compact option on.
let gap = 1;
// The smart zone's size in tokens, statusline.zsh's SMART_CONTEXT_LIMIT, from the smart_zone_tokens option; 0 with the
// smart_zone option off.
let smartZone = 200_000;
// A main-conversation turn is in flight (from its first request to its end), so no handoff starts inside one.
let busy = false;
// When the person last sent a prompt, and when the mod last started a handoff: one handoff per stretch between prompts.
let promptAt = 0;
let handoffAt = 0;
// When the mod last started a compaction: one per stretch between prompts too.
let compactedAt = 0;
// How long a dismissed offer stays hidden, in ms; 0 for the rest of the session.
let dismissFor = 0;
// The branch the shown PR belongs to and when it was fetched.
let prFor: string | undefined;
let prAt = 0;
// Whether the shown PR had checks running or queued, which a push or a finished run changes within seconds.
let prBusy = false;
// The turn_rate option. The last main turn's output tokens, its length and when its end was heard, for the
// line that closes it; and the rate each such line got, by instance, so a redraw after a later turn keeps its own.
let turnRate = false;
let lastTurn: { tokens: number; durationMs: number; at: number } | undefined;
const turnRates = new Map<string, string>();

export const register: Register = (on, options) => {
  // The person's options, from /config; a change there loads the module again with the new ones.
  autoHandoff = options.auto_handoff === true;
  freshStart = options.fresh_start === true;
  compactHint = options.compact_hint === true;
  autoCompact = options.auto_compact === true;
  keepWarm = typeof options.keep_warm_pings === "number" ? Math.max(0, Math.floor(options.keep_warm_pings)) : 0;
  dismissFor = typeof options.dismiss_minutes === "number" ? Math.max(0, options.dismiss_minutes) * 60_000 : 0;
  gap = options.compact === true ? 0 : 1;
  turnRate = options.turn_rate === true;
  const rows: [unknown, Layout][] = [
    [options.row_git_position, options.row_git === true ? GIT_ROW : []],
    [options.row_status_position, options.row_status === true ? STATUS_ROW.filter((name) => options[`segment_${name}`] === true) : []],
  ];
  aboveRows = rows.filter(([at]) => at === "above").map(([, row]) => row);
  belowRows = rows.filter(([at]) => at !== "above").map(([, row]) => row);
  smartZone = options.smart_zone !== true ? 0 : typeof options.smart_zone_tokens === "number" ? options.smart_zone_tokens : 200_000;
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    tick?.cancel();
    phase = 0;
    frames = 0;
    prFor = undefined;
    // A copy of this module loaded before a /reload-plugins kept its tick running in the same session, and wrote its
    // own (older) state shapes over this one's. The latest load stands in the state: an older copy's tick stops itself.
    const load = Date.now() + Math.random();
    await $.state.set(LOAD, load);
    const own = (tick = $.clock.every(FRAME_MS, () => {
      void $.state.get(LOAD).then(({ value }) => value !== load && own.cancel());
      const steps = EFFORT_STEPS[String(effort)] ?? EFFORT_STEPS.high;
      phase = (phase + (FRAME_MS / 1000) * steps * STEP_CYCLES_PER_SECOND) % 1;
      void $.state.set(TICK, Date.now());
      // Read every frame, so a /model switch shows within a frame instead of when the next turn ends.
      void $.session.model().then((model) => $.state.set(MODEL, model));
      void readTurns($);
      if (++frames % (POLL_MS / FRAME_MS) === 0) poll($);
      if (frames % (REJECTED_POLL_MS / FRAME_MS) === 0) refreshRejected($);
    }));
    await refresh($);
    refreshTokens($);
    refreshGit($);
    refreshRejected($);
    return result;
  });

  on("turn.step", async function* ($, e, next) {
    const { value: before = 0 } = await $.state.get(SENT);
    if (!e.agentId) {
      busy = true;
      effort = e.effort ?? "none";
      // The main conversation's request goes out now: its cache lives a TTL from here.
      void $.state.set(SENT, Date.now());
    }
    const response = yield* next(e);
    // No response (a limit refused the request, or it failed): the cache was not touched.
    if (!e.agentId && !response.usage) void $.state.set(SENT, before);
    tokensStale = true;
    return response;
  });

  on("session.measure", async ($, e, next) => {
    await $.state.set(USAGE, { context: e.context, rateLimits: e.rateLimits });
    return next(e);
  });

  on("prompt.submit", async (_$, e, next) => {
    if (e.origin.kind === "composer") promptAt = Date.now();
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) busy = false;
    if (turnRate && !e.agentId && e.usage && e.durationMs > 0) {
      lastTurn = { tokens: e.usage.output_tokens, durationMs: e.durationMs, at: Date.now() };
      // The closing line may have drawn before this event: draw it again, now its tokens are known.
      $.ui.invalidate("ui.render");
    }
    if (!e.agentId) await refresh($);
    // A subagent's turn ends too, so its tokens and its edits show while the main turn still runs.
    refreshTokens($);
    refreshGit($);
    return result;
  });

  // The line that closes a turn (✻ Cooked for 7s · done 11:22 PM) gets the tokens the turn generated per second in its
  // verb: ✻ Cooked at 52 tok/s for 7s · done 11:22 PM, in the units of the rest of the row. The engine draws the line
  // as a Box of width 100%, so nothing beside it sits against its text, and it builds the rest of it from the verb and
  // the duration alone: the verb is the one place the engine's own text takes ours. The line takes the last turn's count
  // once, and only a line of about that length drawn within seconds of the turn's end, so a redraw of an older line
  // never takes a later turn's.
  on("ui.render", { component: "TurnDuration" }, async ($, e, next) => {
    if (!turnRate) return next(e);
    let rate = turnRates.get(e.requestId);
    if (rate === undefined && lastTurn && Date.now() - lastTurn.at < 5_000 && Math.abs(lastTurn.durationMs - e.props.durationMs) < 1_000) {
      rate = formatTokens(Math.floor((lastTurn.tokens * 1_000) / lastTurn.durationMs));
      turnRates.set(e.requestId, rate);
      lastTurn = undefined;
    }
    return rate === undefined ? next(e) : next({ ...e, props: { ...e.props, word: `${e.props.word} at ${rate} tok/s` } });
  });


  // Under the prompt the hint line draws, then the status row, then a line of the mod's own for each offer that holds:
  // a fresh start once the cache is cold, a compaction once the smart zone is nearly spent. A draft in the prompt keeps them, as a reminder
  // not to keep going. The fresh start waits while Claude works; the compaction does not, for the command queues and runs
  // once the session is idle. Each has a button that hides it, for the rest of the session or the dismiss_minutes option.
  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    const drawn = await next(e);
    const rows = await drawRows($, e, belowRows);
    const ui = $.ui.resolve(e) as Ui;
    const offers = [e.props.isWorking ? undefined : await freshStartLine($, ui), await compactLine($, ui)].filter((line) => line !== undefined);
    return rows.length + offers.length === 0 ? drawn : ui.Box({ flexDirection: "column", children: [drawn, ...rows, ...offers] });
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const rows = await drawRows($, e, aboveRows);
    if (rows.length === 0) return next(e);
    return ($.ui.resolve(e) as Ui).Box({ flexDirection: "column", paddingX: 1, children: rows });
  });
};

// The rows from the state, none until the first usage reading; read every frame (the tick), so they move live.
async function drawRows($: EngineInterface, e: any, layout: Layout[]): Promise<ReturnType<Ui["Box"]>[]> {
  await $.state.get(TICK);
  const { value: usage } = await $.state.get(USAGE);
  if (!usage) return [];
  const { value: model = "" } = await $.state.get(MODEL);
  const { value: tokens } = await $.state.get(TOKENS);
  const { value: turns } = await $.state.get(TURNS);
  const { value: compactAt } = await $.state.get(COMPACT_AT);
  const { value: sent } = await $.state.get(SENT);
  const { value: git } = await $.state.get(GIT);
  const { value: pr } = await $.state.get(PR);
  const { value: rejected } = await $.state.get(REJECTED);
  const ui = $.ui.resolve(e) as Ui;
  const s: Snapshot = { usage, model, tokens, turns, compactAt, sent, git, pr, rejected, now: Math.floor(Date.now() / 1000), phase };
  return (
    layout
      // The git row is bare text, no chips to tell its tags apart: compact spacing leaves its gaps.
      .map((names) => ({ parts: names.flatMap((name) => SEGMENTS[name](ui, s)), columnGap: names === GIT_ROW ? 1 : gap }))
      .filter(({ parts }) => parts.length > 0)
      // Too narrow for a row, it wraps between segments, as statusline.zsh's wrap_at did, rather than squeeze their glyphs.
      // The gap, not a leading space, parts segments, so a wrapped line starts flush.
      // ponytail: no shrink steps; a single segment wider than the line still gets squeezed.
      .map(({ parts, columnGap }) => ui.Box({ flexDirection: "row", flexWrap: "wrap", columnGap, children: parts.map((part) => ui.Box({ flexShrink: 0, children: [part] })) }))
  );
}

function poll($: EngineInterface): void {
  void maybeKeepWarm($);
  void maybeHandoff($);
  void maybeCompact($);
  void $.session.usage().then((u) => $.state.set(USAGE, { context: u.context, rateLimits: u.rateLimits }));
  serial("handoff", () => findHandoff($));
  refreshGit($);
  if (tokensStale) {
    tokensStale = false;
    refreshTokens($);
  }
}

// The seconds the warm cache has left, and the lead before expiry at which the mod acts on it; undefined when none is warm.
async function cacheClock($: EngineInterface): Promise<{ ttl: number; left: number; lead: number } | undefined> {
  const { value: tokens } = await $.state.get(TOKENS);
  const cache = tokens?.cache;
  if (!cache) return undefined;
  const { value: sent } = await $.state.get(SENT);
  const left = cacheLeft(cache, sent, Math.floor(Date.now() / 1000));
  return left > 0 ? { ttl: cache.ttl, left, lead: PING_LEAD_S[cache.ttl] ?? 300 } : undefined;
}

// With keep_warm_pings on, sends a minimal prompt of the mod's own just before the cache expires, up to that many
// between two of the person's prompts; the handoff follows the last. The pings are the mod's own prompts, so they do
// not start a new stretch. None before the person's first prompt, as with the handoff; a usage limit nearly reached, a
// subagent at work or a turn running leaves them out.
async function maybeKeepWarm($: EngineInterface): Promise<void> {
  if (keepWarm <= 0 || promptAt === 0 || busy || (await agentsAtWork($)) || (await limitsNear($))) return;
  if (pingFor !== promptAt) {
    pingFor = promptAt;
    pings = 0;
  }
  if (pings >= keepWarm) return;
  const cache = await cacheClock($);
  if (!cache || cache.left > cache.lead) return;
  const now = await $.clock.now();
  if (now - pingAt < PING_GAP_MS) return;
  pingAt = now;
  pings++;
  try {
    await $.prompt.submit({ text: PING_TEXT });
  } catch (err) {
    // No more pings this stretch: the handoff, which has a try of its own, goes next.
    pings = keepWarm;
    $.ui.toast(`statusline: the ping that keeps the cache warm did not start: ${err instanceof Error ? err.message : err}`);
  }
}

// Runs the handoff skill when the session is idle, the cache still warm and within its lead of going cold. Only on an
// hour's TTL: a five-minute cache goes cold at every short pause, and rewriting it costs little. With keep_warm_pings
// on it runs on either TTL, after the last ping. The handoff's own request refreshes the cache, so it waits for the
// person's next prompt before it may run again.
async function maybeHandoff($: EngineInterface): Promise<void> {
  if (!autoHandoff || busy || handoffAt >= promptAt || (await agentsAtWork($))) return;
  if (await limitsNear($)) return;
  const cache = await cacheClock($);
  if (!cache || cache.left > cache.lead || (cache.ttl !== 3_600 && keepWarm <= 0)) return;
  // With pings on, the handoff waits for the last of them.
  if (keepWarm > 0 && (pingFor !== promptAt || pings < keepWarm || (await $.clock.now()) - pingAt < PING_GAP_MS)) return;
  handoffAt = Date.now();
  try {
    await $.command.run({ command: HANDOFF_COMMAND });
  } catch (err) {
    $.ui.toast(`statusline: the handoff before the cache goes cold did not start: ${err instanceof Error ? err.message : err}`);
  }
}

// Runs /compact when the session is idle and the context has used COMPACT_HINT_AT of the smart zone, the point where
// the line offering it appears. Its own request counts, so it waits for the person's next prompt before it may run again.
async function maybeCompact($: EngineInterface): Promise<void> {
  if (!autoCompact || smartZone <= 0 || busy || compactedAt >= promptAt || (await agentsAtWork($))) return;
  const { value: usage } = await $.state.get(USAGE);
  if (usage?.context.tokens === undefined || usage.context.tokens < smartZone * COMPACT_HINT_AT || (await limitsNear($))) return;
  compactedAt = Date.now();
  await compactSession($);
}

// A limit reached refuses the request of a handoff or a compaction, and one nearly reached is better left to the
// person's own prompts: Fable and Mythos stop at 90% of the 5h window, the others at 98%.
async function limitsNear($: EngineInterface): Promise<boolean> {
  const { value: usage } = await $.state.get(USAGE);
  const { value: rejected } = await $.state.get(REJECTED);
  const { value: model = "" } = await $.state.get(MODEL);
  const cap = /fable|mythos/i.test(model) ? 90 : 98;
  return limitsOf(usage?.rateLimits ?? [], rejected, Date.now()).some((r) => r.percentUsed >= 100 || (r.kind === "five_hour" && r.percentUsed >= cap));
}

// A subagent still at work keeps the session alive: its answer comes back to the main conversation, which writes the
// cache again then anyway, and /clear would cut it off. So no handoff and no fresh start while one runs.
async function agentsAtWork($: EngineInterface): Promise<boolean> {
  return (await $.agent.list()).some((a) => a.status === "pending" || a.status === "running" || a.status === "waiting");
}

// Limits are the account's, but a session hears its figures only in its own responses: a window another session was
// refused on shows used up here too, until it resets.
function limitsOf(limits: StatusLimit[], rejected: Record<string, number> | undefined, nowMs: number): StatusLimit[] {
  const byKind = new Map(limits.map((l) => [l.kind, l]));
  for (const [kind, at] of Object.entries(rejected ?? {})) {
    if (at > nowMs) byKind.set(kind, { kind, percentUsed: 100, resetsAt: new Date(at).toISOString() });
  }
  return [...byKind.values()];
}

// The refusals are in the sessions' transcripts, each with the window it hit and when that resets. A refused session
// adds little after its refusal, so only each transcript's last 256 KB is read: 0.1 s of CPU, where all of them took 1.3 s.
// ponytail: transcripts written in the last 5 h only; a 7d refusal older than that shows once a response reports it.
function refreshRejected($: EngineInterface): void {
  serial("rejected", async () => {
    const tails = `find "$1" -name '*.jsonl' -mmin -300 -exec sh -c 'for f; do tail -c 262144 "$f"; echo; done' sh {} + | grep -F '"apiError":"usage_limit_reached"'`;
    const { stdout } = await $.process.run(["sh", "-c", tails, "sh", `${await configDir($)}/projects`], { timeoutMs: 10_000 });
    const rejected: Record<string, number> = {};
    for (const line of stdout.split("\n")) {
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const hit = row?.apiError === "usage_limit_reached" ? (row.quotaLimits ?? row.apiErrorParams?.rate_limit_info) : undefined;
      if (typeof hit?.rateLimitType !== "string" || typeof hit.resetsAt !== "number") continue;
      rejected[hit.rateLimitType] = Math.max(rejected[hit.rateLimitType] ?? 0, hit.resetsAt * 1000);
    }
    await $.state.set(REJECTED, rejected);
  });
}

// The newest handoff file at the project's root written since this session started (a /clear starts another).
async function findHandoff($: EngineInterface): Promise<void> {
  const [root, { startedAt }] = await Promise.all([$.session.root(), $.session.usage()]);
  const newest = (await $.fs.list(root))
    .filter((f) => f.kind === "file" && /^HANDOFF-.*\.md$/.test(f.name) && f.mtimeMs >= startedAt)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  await $.state.set(HANDOFF, newest ? { path: `${root}/${newest.name}`, bytes: newest.size, at: newest.mtimeMs } : null);
}

// Once this session wrote a handoff, the line that weighs the two ways on: the next prompt here, which writes the whole
// conversation to the cache again, against a fresh session from the handoff file, a button. While the cache is warm it
// shows only until the person's next prompt, which a handoff written while they were away has not met yet.
async function freshStartLine($: EngineInterface, { Box, Text, Button }: Ui) {
  if (!freshStart || (await dismissed($, "fresh"))) return undefined;
  const { value: tokens } = await $.state.get(TOKENS);
  const { value: handoff } = await $.state.get(HANDOFF);
  const { value: sent } = await $.state.get(SENT);
  const c = tokens?.cache;
  if (!c || !handoff) return undefined;
  const cold = cacheLeft(c, sent, Math.floor(Date.now() / 1000)) <= 0;
  if ((!cold && handoff.at < promptAt) || (await agentsAtWork($))) return undefined;
  // ponytail: priced at this conversation's write rate, the handoff at 4 bytes a token; the new session's system
  // prompt is likely read from a cache other sessions keep warm, so this is an upper bound.
  const fresh = c.write === undefined || c.prompt === 0 ? undefined : (c.write * (c.base + handoff.bytes / 4)) / c.prompt;
  // A line of its own under the engine's, a red $ in the column of its mode glyph. The prices are the context; the
  // button names the action alone.
  return Box({
    flexDirection: "row",
    children: [
      Text({ color: hex(COLD_CHIP.from), children: "$" }),
      Text({ dimColor: true, children: cold ? ` Cache cold: next message ${usd(c.write)}, fresh start ~${usd(fresh)} ` : ` Handoff written: fresh start ~${usd(fresh)} ` }),
      // A button as the chips are drawn: the icon on the action's colour, the label on BUTTON_BG.
      Button({
        key: "resume",
        plain: true,
        onPress: () => void resumeFrom($, handoff.path),
        children: [
          Text({ color: hex(contrast(WARM_CHIP.to)), backgroundColor: hex(WARM_CHIP.to), children: " \uf15c " }),
          Text({ color: hex(WARM_CHIP.from), backgroundColor: hex(BUTTON_BG), children: " Start fresh " }),
        ],
      }),
      dismissButton($, "fresh", Button, Text),
    ],
  });
}

// From the context having used COMPACT_HINT_AT of the smart zone on, the line that offers to compact: recall is precise
// only inside the zone, and a compaction swaps the conversation for its summary. Not drawn with no smart zone.
async function compactLine($: EngineInterface, { Box, Text, Button, Link }: Ui) {
  const { value: usage } = await $.state.get(USAGE);
  const used = usage?.context.tokens;
  if (!compactHint || (await dismissed($, "compact")) || smartZone <= 0 || used === undefined || used < smartZone * COMPACT_HINT_AT) return undefined;
  return Box({
    flexDirection: "row",
    children: [
      Text({ color: hex(AGENTS_CHIP.from), children: "\u25c6" }),
      Text({ dimColor: true, children: used >= smartZone ? " You're out of the " : " You're nearly out of the " }),
      Link({ href: SMART_ZONE_URL, children: Text({ color: hex(AGENTS_CHIP.from), underline: true, children: "Smart zone" }) }),
      Text({ dimColor: true, children: used >= smartZone ? `. Same model, ${DUMB_ZONE_DEPTHS.find(([upTo]) => used / smartZone < upTo)![1]} the dumb zone now. ` : ". " }),
      Button({
        key: "compact",
        plain: true,
        onPress: () => void compactSession($),
        children: [
          Text({ color: hex(contrast(WARM_CHIP.to)), backgroundColor: hex(WARM_CHIP.to), children: " \uf066 " }),
          Text({ color: hex(WARM_CHIP.from), backgroundColor: hex(BUTTON_BG), children: " Compact " }),
        ],
      }),
      dismissButton($, "compact", Button, Text),
    ],
  });
}

// Whether the person dismissed this offer, and the dismissal still holds: for the rest of the session, or dismissFor ms.
async function dismissed($: EngineInterface, offer: Offer): Promise<boolean> {
  const { value } = await $.state.get(DISMISSED);
  const at = value?.[offer];
  return at !== undefined && (dismissFor === 0 || (await $.clock.now()) - at < dismissFor);
}

// A dim cross after an offer's button: hides the offer. The state is the session's, so a reload keeps it hidden.
function dismissButton($: EngineInterface, offer: Offer, Button: Ui["Button"], Text: Ui["Text"]) {
  return Button({
    key: "dismiss",
    plain: true,
    onPress: async () => {
      const { value } = await $.state.get(DISMISSED);
      await $.state.set(DISMISSED, { ...value, [offer]: await $.clock.now() });
      $.ui.invalidate("ui.render");
    },
    children: Text({ dimColor: true, children: " \u2715 " }),
  });
}

async function compactSession($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: "compact" });
  } catch (err) {
    $.ui.toast(`statusline: compacting failed: ${err instanceof Error ? err.message : err}`);
  }
}

// The cold cache's button: rather than write the whole conversation to the cache again, a fresh session that starts
// from the handoff file.
async function resumeFrom($: EngineInterface, path: string): Promise<void> {
  try {
    await $.command.run({ command: "clear" });
    await $.prompt.submit({ text: `Continue from the handoff in ${path}: read it, then pick up the work where it leaves off.`, asUser: true });
  } catch (err) {
    $.ui.toast(`statusline: starting from the handoff failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function configDir($: EngineInterface): Promise<string> {
  return (await $.env.get("CLAUDE_CONFIG_DIR")) ?? `${await $.env.get("HOME")}/.claude`;
}

async function refresh($: EngineInterface): Promise<void> {
  const u = await $.session.usage();
  await $.state.set(USAGE, { context: u.context, rateLimits: u.rateLimits });
  await $.state.set(MODEL, await $.session.model());
  await readTurns($);
  await readCompactAt($);
}

// The token count the context runs to before auto-compaction, as Claude Code settles it: its auto-compaction threshold
// when that is on, else the window it measures against (the model's, or a compaction window set by the environment, the
// settings or the account). The summary breakdown is estimated locally and sends no request; read at the session's start
// and each turn's end. Left unset (a host without the breakdown), the bar runs to the model's whole window.
async function readCompactAt($: EngineInterface): Promise<void> {
  try {
    const breakdown = (await $.session.usage({ breakdown: "summary" })).context.breakdown;
    if (!breakdown) return;
    const at = breakdown.isAutoCompactEnabled && breakdown.autoCompactThreshold ? breakdown.autoCompactThreshold : breakdown.rawMaxTokens;
    await $.state.set(COMPACT_AT, at);
  } catch {
    // ponytail: nothing reports why the limit is missing; the whole window stands in.
  }
}

// The prompts sent this session; a refusal (a host without the count) leaves the tag out.
async function readTurns($: EngineInterface): Promise<void> {
  try {
    await $.state.set(TURNS, await $.session.turns());
  } catch {
    // ponytail: nothing reports why the count is missing.
  }
}

// USD per million tokens: input, 5m and 1h cache writes, cache reads, output; `over` is a dearer tier
// for prompts above `above` tokens (Haiku 5.5's, at 100,000).
type Rate = { i: number; w5: number; w1: number; r: number; o: number };
type Price = Rate & { over?: { above: number; rate: Rate } };

// The background jobs running now, by name; `again` asks one to run once more when it ends.
const running = new Map<string, { again: boolean }>();

// TEMPORARY: the PR fetches, read by the debug mod's /pr-trace pane; remove with the calls to trace.
const PR_TRACE = { plugin: "statusline", key: "prTrace" } as const;
const traceLog: string[] = [];
function trace($: EngineInterface, msg: string): void {
  traceLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  void $.state.set(PR_TRACE, traceLog.slice(-200));
}

// One run of a job at a time, in the background; a request during one runs it again once it ends.
function serial(name: string, job: () => Promise<void>, onSkip?: () => void): void {
  const current = running.get(name);
  if (current) {
    current.again = true;
    onSkip?.();
    return;
  }
  const state = { again: false };
  running.set(name, state);
  void (async () => {
    try {
      do {
        state.again = false;
        await job();
      } while (state.again);
    } catch {
      // ponytail: a failed run keeps the last figures; nothing reports why.
    } finally {
      running.delete(name);
    }
  })();
}

function refreshTokens($: EngineInterface): void {
  serial("tokens", async () => {
    prices ??= await fetchPrices($);
    await $.state.set(TOKENS, await scanTokens($));
  });
}

function refreshGit($: EngineInterface): void {
  serial("git", async () => {
    const git = await scanGit($);
    await $.state.set(GIT, git);
    // statusline.zsh asked gh only for a branch on a remote that is not the default; gh goes over the network,
    // so the git parts draw first.
    const named = git.branch !== "" && git.branch !== "HEAD" && git.branch !== git.defaultBranch;
    const branch = named && !git.vsDefault ? `${git.top}:${git.branch}` : "";
    const now = await $.clock.now();
    if (branch === prFor && now - prAt < (prBusy ? PR_BUSY_POLL_MS : PR_POLL_MS)) return;
    prFor = branch;
    prAt = now;
    const pr = branch ? await fetchPr($) : null;
    prBusy = (pr?.checks.pending ?? 0) > 0;
    trace($, `fetch branch=${branch || "-"} pr=${pr ? `#${pr.number} pending=${pr.checks.pending} ok=${pr.checks.success} fail=${pr.checks.failure}` : "null"}`);
    await $.state.set(PR, pr);
  }, () => trace($, "git job still running; poll folded into again"));
}

async function fetchPrices($: EngineInterface): Promise<Record<string, Price> | undefined> {
  try {
    const res = await $.http.fetch(PRICING_URL);
    if (!res.ok) return undefined;
    const parsed = parsePrices(res.text);
    // Fewer than 6 model rows means the page's layout moved: price nothing rather than half.
    return Object.keys(parsed).length >= 6 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The model table: | Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |.
// A model's first row wins, as the page lists the price in effect first; "(for prompts over N tokens)" adds its tier.
function parsePrices(md: string): Record<string, Price> {
  const out: Record<string, Price> = {};
  for (const line of md.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 6 || !line.includes("$")) continue;
    const key = cells[0]
      .split("(")[0]
      .replace(/[*`]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[ .]/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!key.startsWith("claude-")) continue;
    const [i, w5, w1, r, o] = cells.slice(1, 6).map((c) => Number((/\$([\d.,]+)/.exec(c)?.[1] ?? "").replace(/,/g, "")));
    if (!(i > 0 && o > 0)) continue;
    const over = /over ([\d,]+) tokens/.exec(cells[0]);
    if (over && out[key] && !out[key].over) out[key].over = { above: Number(over[1].replace(/,/g, "")), rate: { i, w5, w1, r, o } };
    else if (!(key in out)) out[key] = { i, w5, w1, r, o };
  }
  return out;
}

// The session's transcript and its subagents/ transcripts, one count per request.
// $.fs.read refuses a file over 4 MiB and a long session's transcript is more, so grep streams the usage lines.
async function scanTokens($: EngineInterface): Promise<StatusTokens> {
  const dir = await configDir($);
  const sid = await $.session.id();
  const main: StatusSpend = { tokens: 0, usd: 0, requests: 0, unpriced: 0 };
  const agents: StatusSpend = { tokens: 0, usd: 0, requests: 0, unpriced: 0 };
  const agentIds = new Set<string>();
  const seen = new Set<string>();
  // The main conversation's latest request, and the TTL its latest cache write asked for: a read alone lives as long
  // as the write before it. ponytail: one TTL per request, 5m if any of it was written for 5m (the part that expires
  // first); the next prefix is the last request's, without the answer it got.
  let last: { at: number; prompt: number; model: string; speed: unknown } | undefined;
  let first: { at: number; prompt: number } | undefined;
  let ttl = 3_600;
  let ttlAt = -Infinity;
  // Every request's time, and the main ones' prompt and cache read: the label above is what a write was billed as, not
  // how long it lived, so a read after a long idle stretch settles the lifetime.
  const stamps: number[] = [];
  const mains: { at: number; prompt: number; read: number }[] = [];
  // A compaction swaps the conversation for its summary: the cached prefix before it is never read again.
  let compactedAt = -Infinity;
  const add = (line: string) => {
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (row?.subtype === "compact_boundary" && !row.agentId) compactedAt = Math.max(compactedAt, Date.parse(row.timestamp ?? ""));
    const u = row?.message?.usage;
    if (row?.type !== "assistant" || typeof u !== "object" || u === null) return;
    // One line per content block, all of a request's sharing its requestId: count the first.
    const rid = row.requestId ?? row.uuid;
    if (!rid || seen.has(rid)) return;
    seen.add(rid);
    const counts = {
      inp: u.input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      w5: u.cache_creation?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0,
      w1: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    };
    // Claude Code's own <synthetic> messages carry a usage of nothing: no request was made.
    if (counts.inp + counts.out + counts.read + counts.w5 + counts.w1 === 0) return;
    const spend = row.agentId ? agents : main;
    if (row.agentId) agentIds.add(row.agentId);
    const at = Date.parse(row.timestamp ?? "");
    if (Number.isFinite(at)) stamps.push(at);
    if (!row.agentId && Number.isFinite(at)) {
      const prompt = counts.inp + counts.read + counts.w5 + counts.w1;
      mains.push({ at, prompt, read: counts.read });
      if (!last || at >= last.at) last = { at, prompt, model: String(row.message.model ?? ""), speed: u.speed };
      if (!first || at < first.at) first = { at, prompt };
      if ((counts.w5 > 0 || counts.w1 > 0) && at >= ttlAt) {
        ttlAt = at;
        ttl = counts.w5 > 0 ? 300 : 3_600;
      }
    }
    spend.requests++;
    spend.tokens += counts.inp + counts.out + counts.read + counts.w5 + counts.w1;
    const usd = requestCost(String(row.message.model ?? ""), u.speed, counts);
    if (usd === undefined) spend.unpriced++;
    else spend.usd += usd;
  };
  let rest = "";
  const argv = ["find", `${dir}/projects`, "-path", `*${sid}*`, "-name", "*.jsonl", "-exec", "grep", "-h", "-e", '"usage"', "-e", '"compact_boundary"', "{}", "+"];
  for await (const { stream, text } of $.process.spawn({ argv })) {
    if (stream !== "stdout") continue;
    const lines = (rest + text).split("\n");
    rest = lines.pop() ?? "";
    lines.forEach(add);
  }
  add(rest);
  // A five-minute label whose cache a request read back whole after more than five minutes with no request of any kind
  // in between lived longer than the label: Claude Code's 5m writes on a subscription were read at 45 and 59 minutes.
  // ponytail: an hour is assumed, the longest the API offers; the read shows only that it outlived five minutes.
  mains.sort((a, b) => a.at - b.at);
  const outlived =
    ttl === 300 && mains.some((m, i) => i > 0 && m.at - mains[i - 1].at > 300_000 && m.read >= 0.8 * mains[i - 1].prompt && !stamps.some((t) => t > mains[i - 1].at && t < m.at));
  return { main, agents: { ...agents, count: agentIds.size }, cache: last && last.at > compactedAt ? cacheOf(last, ttl, outlived ? 3_600 : ttl, first?.prompt ?? 0) : undefined };
}

// What the next prompt's cached prefix costs: read while the cache is warm, written again at the label's rate once cold.
// `ttl` is the label of the latest write, which prices it; `lives` how long the cache stays warm.
function cacheOf(last: { at: number; prompt: number; model: string; speed: unknown }, ttl: number, lives: number, base: number): StatusCache {
  const none = { inp: 0, out: 0, read: 0, w5: 0, w1: 0 };
  return {
    at: last.at,
    ttl: lives,
    read: requestCost(last.model, last.speed, { ...none, read: last.prompt }),
    write: requestCost(last.model, last.speed, ttl === 300 ? { ...none, w5: last.prompt } : { ...none, w1: last.prompt }),
    prompt: last.prompt,
    base,
  };
}

// Ported from statusline.zsh's sl_input_git; its PR checks (gh, over the network) stay out.
// Outside a repository only the folders show: zsh hid them there too, though they need no git.
async function scanGit($: EngineInterface): Promise<StatusGit> {
  const [root, cwd] = await Promise.all([$.session.root(), $.session.cwd()]);
  const exec = (args: string[]) => $.process.run(["git", "--no-optional-locks", ...args], { cwd });
  // Output whatever the exit: rev-parse prints what it resolved before a missing upstream fails it.
  const git = async (...args: string[]) => (await exec(args)).stdout.trim();
  const ok = async (...args: string[]) => (await exec(args)).exitCode === 0;

  const [commonDir, gitDir, top, branch = "", upstream = ""] = (
    await git("rev-parse", "--path-format=absolute", "--git-common-dir", "--absolute-git-dir", "--show-toplevel", "--abbrev-ref", "HEAD", "--abbrev-ref", "@{upstream}")
  ).split("\n");
  if (!gitDir) {
    return { root, cwd, top: "", web: "", base: "", branch: "", defaultBranch: "", basedOff: "", worktree: "", ahead: 0, behind: 0, vsDefault: false, added: 0, deleted: 0, changed: 0, conflict: false };
  }
  const named = branch !== "" && branch !== "HEAD";
  const [symref, initDefault, track, numstat, unmerged, midway] = await Promise.all([
    git("symbolic-ref", "refs/remotes/origin/HEAD"),
    git("config", "init.defaultBranch"),
    // A branch need not live on origin (a fork's), so any remote's copy tracks it.
    upstream || (named ? git("for-each-ref", "--count=1", "--format=%(refname:short)", `refs/remotes/*/${branch}`) : ""),
    git("diff", "--numstat", "HEAD"),
    git("ls-files", "--unmerged"),
    Promise.all(["MERGE_HEAD", "rebase-merge", "rebase-apply"].map((f) => $.fs.exists(`${gitDir}/${f}`))),
  ]);
  // ponytail: with no origin to name it, the branch new repositories start on stands in for the default; a repository
  // whose main branch differs shows that branch as an ordinary one.
  const defaultBranch = symref.replace(/^refs\/remotes\/origin\//, "") || initDefault;
  let main: Promise<string> | undefined;
  const mainRef = () =>
    (main ??= (async () => {
      for (const b of [defaultBranch, "develop", "main", "master"]) {
        if (b && (await ok("rev-parse", "--verify", `origin/${b}`))) return `origin/${b}`;
      }
      return "";
    })());

  // No remote knows the branch: count against the default branch, which says nothing about what is pushed.
  const against = track || (await mainRef());
  const remote = track.split("/")[0];
  const web = track ? webUrl(await git("remote", "get-url", remote)) : "";
  const [ahead = 0, behind = 0] = against
    ? (await git("rev-list", "--left-right", "--count", `HEAD...${against}`)).split(/\s+/).map(Number)
    : [];

  let added = 0;
  let deleted = 0;
  let changed = 0;
  for (const line of numstat.split("\n")) {
    const [a, d] = line.split("\t");
    // A binary file's counts are "-".
    if (!a || a === "-" || d === "-") continue;
    added += Number(a);
    deleted += Number(d);
    if (Number(a) > 0 || Number(d) > 0) changed++;
  }

  // A merge or rebase midway, or unmerged paths; failing that, behind and an in-memory merge with the default branch fails.
  let conflict = midway.some(Boolean) || unmerged !== "";
  if (!conflict && behind > 0) {
    const target = await mainRef();
    if (target) conflict = !(await ok("merge-tree", "--write-tree", "HEAD", target));
  }

  return {
    root,
    cwd,
    top,
    web,
    base: web ? track.slice(remote.length + 1) : "",
    branch,
    defaultBranch,
    basedOff: named && branch !== defaultBranch ? await basedOff(git, branch) : "",
    // A linked worktree keeps its own git dir apart from the repository's.
    worktree: commonDir !== gitDir ? (top.split("/").pop() ?? "") : "",
    ahead,
    behind,
    vsDefault: !track,
    added,
    deleted,
    changed,
    conflict,
  };
}

// Ported from statusline.zsh's sl_input_pr: the branch's pull request, null when it has none or gh fails.
async function fetchPr($: EngineInterface): Promise<StatusPr | null> {
  try {
    const fields = "number,url,isDraft,mergeable,reviewDecision,statusCheckRollup,comments,state";
    const { exitCode, stdout, stderr } = await $.process.run(["gh", "pr", "view", "--json", fields], { timeoutMs: 15_000 });
    if (exitCode !== 0) {
      trace($, `gh exit ${exitCode}: ${stderr.trim().slice(0, 120)}`);
      return null;
    }
    const pr = JSON.parse(stdout);
    if (typeof pr?.number !== "number") return null;
    const checks = { pending: 0, failure: 0, success: 0 };
    for (const c of pr.statusCheckRollup ?? []) {
      // A check run has a status and a conclusion; a commit status only a state, which zsh counted as pending.
      const result = c.conclusion || c.state;
      if (c.status ? c.status !== "COMPLETED" : c.state === "PENDING" || c.state === "EXPECTED") checks.pending++;
      else if (result === "SUCCESS") checks.success++;
      else if (result === "FAILURE" || result === "ERROR") checks.failure++;
    }
    const url = typeof pr.url === "string" ? pr.url : "";
    // A check run links its details, a commit status its target.
    const failed = (pr.statusCheckRollup ?? []).filter((c: any) => ["FAILURE", "ERROR"].includes(c.conclusion || c.state));
    return {
      number: pr.number,
      url,
      failedUrls: failed.map((c: any) => String(c.detailsUrl || c.targetUrl || "")),
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft === true ? "draft" : "open",
      conflicting: pr.mergeable === "CONFLICTING",
      review: pr.reviewDecision ?? "",
      comments: pr.comments?.length ?? 0,
      checks,
    };
  } catch (err) {
    trace($, `fetchPr threw: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// The branch the reflog says this one was made from: its creation entry, or for `checkout -b` (created
// from HEAD) the first checkout onto it, under its old name when it was renamed.
async function basedOff(git: (...args: string[]) => Promise<string>, branch: string): Promise<string> {
  const log = (await git("reflog", "show", branch, "--format=%gs")).split("\n");
  const created = log.at(-1) ?? "";
  const from = /Created from refs\/heads\/(.*)/.exec(created);
  if (from) return from[1];
  if (!created.includes("Created from HEAD")) return /checkout: moving from (.*) to /.exec(created)?.[1] ?? "";
  const name = log.map((l) => /renamed refs\/heads\/(.*) to /i.exec(l)?.[1]).find(Boolean) ?? branch;
  const moves = (await git("reflog", "--format=%gs"))
    .split("\n")
    .map((l) => /^checkout: moving from (.*) to (.*)$/.exec(l))
    .filter((m) => m?.[2] === name);
  return moves.at(-1)?.[1] ?? "";
}

// The longest model-id prefix the table has; fast mode on Opus 5.5, 5 and 4.8 is published at twice the rate.
function requestCost(
  model: string,
  speed: unknown,
  c: { inp: number; out: number; read: number; w5: number; w1: number },
): number | undefined {
  const key = Object.keys(prices ?? {})
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!prices || key === undefined) return undefined;
  const price = prices[key];
  const prompt = c.inp + c.read + c.w5 + c.w1;
  const rate = price.over && prompt > price.over.above ? price.over.rate : price;
  const fast = speed === "fast" && (model.startsWith("claude-opus-5") || model.startsWith("claude-opus-4-8")) ? 2 : 1;
  return (fast * (c.inp * rate.i + c.out * rate.o + c.w5 * rate.w5 + c.w1 * rate.w1 + c.read * rate.r)) / 1_000_000;
}

// Two bars stacked in one row, depleting right to left as statusline.zsh's bars did: every cell is ▀,
// its glyph colour the top half (the window's time left), its background the bottom half (its usage left).
// A half past its bar's end is dim, so both bars show where 100% is.
// The countdown to the reset shows only while the limit is hovered, laid over the bar: a keyed Box is the
// hover scope, and the countdown an absolute Box drawn last, so it paints over the bar without moving anything.
// Right-aligned, a space short of the bar's end as the chips' values keep one, on the bar's dim grey; the longest
// countdown (23h59m) and its space are 7 cells, the 7-cell bar's width.
function limitParts(Box: Ui["Box"], Text: Ui["Text"], limit: (typeof LIMITS)[number], found: StatusLimit, now: number) {
  const left = found.resetsAt ? Math.floor(Date.parse(found.resetsAt) / 1000) - now : undefined;
  const timeLeft = left === undefined ? 0 : cells((left * 100) / limit.seconds, limit.segments);
  const usageLeft = cells(100 - found.percentUsed, limit.segments);
  const parts = [Text({ color: hex(contrast(limit.to)), backgroundColor: hex(limit.to), children: ` ${limit.badge} ` })];
  for (let i = 0; i < limit.segments; i++) {
    const lit = lerp(limit.from, limit.to, i, limit.segments);
    parts.push(
      Text({
        color: hex(i < timeLeft ? lit : EMPTY_FG),
        backgroundColor: hex(i < usageLeft ? lit : EMPTY_FG),
        children: "▀",
      }),
    );
  }
  if (left !== undefined && left > 0) {
    const shown = `${countdown(left)} `.padStart(limit.segments);
    parts.push(
      hoverOver(Box, ` ${limit.badge} `.length + limit.segments - [...shown].length, Text({ color: hex(limit.from), backgroundColor: hex(EMPTY_FG), bold: true, children: shown })),
    );
  }
  return Box({ key: limit.kind, flexDirection: "row", children: parts });
}

// Σ what the main session cost and AGENT_MARK what its subagents did, each a chip; hovered, the tokens behind it.
function tokenParts(Box: Ui["Box"], Text: Ui["Text"], t: StatusTokens) {
  const parts = [chipParts(Box, Text, { key: "tokens", mark: "Σ", value: dollars(t.main), hover: formatTokens(t.main.tokens), ...TOKENS_CHIP })];
  if (t.agents.count) {
    parts.push(chipParts(Box, Text, { key: "agents", mark: AGENT_MARK, value: dollars(t.agents), hover: formatTokens(t.agents.tokens), ...AGENTS_CHIP }));
  }
  return parts;
}

type Chip = { key: string; mark: string; value: string; hover?: string; hoverStops?: { from: RGB; to: RGB }; from: RGB; to: RGB };

// Two tags side by side, as a limit's badge sits against its bar: the mark on the darker stop in its contrast colour,
// then the value padded on the grey behind the limits' bars, in a gradient from the lighter stop to the darker. The
// value's tag is as wide as the longer of the value and the hover value, so the hover value, laid over it unbolded,
// fits whole; both are right-aligned, a space short of the right edge, as the limits' countdowns are. The hover value takes its own stops when it has them.
function chipParts(Box: Ui["Box"], Text: Ui["Text"], c: Chip) {
  const tag = ` ${c.mark} `;
  const width = Math.max([...c.value].length, c.hover ? [...c.hover].length : 0);
  const pad = (text: string) => ` ${" ".repeat(width - [...text].length)}${text} `;
  const gradient = (stops: { from: RGB; to: RGB }) => (i: number, n: number) => lerp(stops.from, stops.to, i, n);
  const children = [
    Text({ color: hex(contrast(c.to)), backgroundColor: hex(c.to), children: tag }),
    // The grey says a hover has more; a chip without one stands on no background.
    run(Box, Text, pad(c.value), gradient(c), undefined, c.hover ? EMPTY_FG : undefined),
  ];
  if (c.hover) {
    children.push(
      hoverOver(Box, [...tag].length, run(Box, Text, pad(c.hover), gradient(c.hoverStops ?? c), undefined, EMPTY_FG)),
    );
  }
  return Box({ key: c.key, flexDirection: "row", children });
}

// statusline.zsh's REPO row: each segment a gradient one palette stop wide, starting at blue and stepping on per segment.
// The PR's parts sit where zsh put them: number, draft, review and comments after the worktree, checks after the conflict.
// Links: the folders open the folder on disk (the project's, the shell's), the branch and the worktree the checkout's,
// the PR its page; a click opens them as the terminal opens a link, in the default app.
function gitParts(Box: Ui["Box"], Text: Ui["Text"], Link: Ui["Link"], g: StatusGit, pr: StatusPr | null | undefined) {
  const mark = g.vsDefault ? "?" : "";
  const c = pr?.checks;
  // A merged or closed pull request keeps only its number: its review, comments, conflict and checks no longer matter.
  const live = pr?.state === "open" || pr?.state === "draft";
  const folder = (path: string) => (path ? `file://${encodeURI(path)}` : undefined);
  const name = (path: string) => path.split("/").pop() || "~";
  const sp = gap ? " " : "";
  const segments = ([
    // The project root (where the session started, unless /cd moved it), then the shell's folder when it is elsewhere.
    [{ text: name(g.root), href: folder(g.root) }, ...(g.cwd === g.root ? [] : [{ text: `${sp}›${sp}` }, { text: name(g.cwd), href: folder(g.cwd) }])],
    [
      // A bare branch name would run into the folder under compact spacing; a ⎇ before it parts them already.
      { text: !gap && g.branch && g.branch === g.defaultBranch ? " " : "" },
      {
        text: !g.branch
          ? ""
          : g.branch === g.defaultBranch
            ? g.branch
            : g.basedOff && g.basedOff !== g.defaultBranch && g.basedOff !== g.branch
              ? `⎇${sp}${g.basedOff}${sp}⎇${sp}${g.branch}`
              : `⎇${sp}${g.branch}`,
        href: folder(g.top),
      },
    ],
    // Hidden when the branch already names it.
    [{ text: g.worktree && !g.branch.includes(g.worktree) ? `⎇${sp}${g.worktree}` : "", href: folder(g.top) }],
    [{ text: pr ? `PR #${pr.number}` : "", href: pr?.url || undefined, color: pr ? PR_COLORS[pr.state] : undefined }],
    pr?.state === "draft" ? ` ${DRAFT_MARK}` : "",
    live ? (REVIEW_MARKS[pr?.review ?? ""] ?? "") : "",
    pr && live && pr.comments > 0 ? ` ${COMMENT_MARK} ${pr.comments}` : "",
    // Behind links the remote branch's history, newest first, where the commits not pulled yet sit on top. Ahead
    // links nothing: those commits exist only here.
    [
      { text: g.ahead > 0 ? `↑${g.ahead}${mark}` : "" },
      { text: g.ahead > 0 && g.behind > 0 ? " " : "" },
      { text: g.behind > 0 ? `↓${g.behind}${mark}` : "", href: g.web ? `${g.web}/commits/${encodeURI(g.base)}` : undefined },
    ],
    g.conflict || (live && pr?.conflicting) ? ` ${WARN_MARK}` : "",
    // Running and passed as counts, linking the PR's checks tab; each failure a cross of its own, linking its check.
    (() => {
      if (!c || !pr || !live) return [];
      const tab = pr.url ? `${pr.url}/checks` : undefined;
      const groups: Piece[][] = [
        c.pending > 0 ? [{ text: `${OCT_DOT}${c.pending}`, href: tab }] : [],
        // Red, so a failure stands out from the row's gradient.
        pr.failedUrls.map((url) => ({ text: OCT_X, href: url || tab, color: OVERFLOW_RED })),
        c.success > 0 ? [{ text: `${OCT_CHECK}${c.success}`, href: tab }] : [],
      ].filter((g) => g.length > 0);
      return groups.flatMap((g, k): Piece[] => (k > 0 ? [{ text: " " }, ...g] : g));
    })(),
    (g.added > 0 ? ` +${g.added}` : "") + (g.deleted > 0 ? ` -${g.deleted}` : "") + (g.changed > 0 ? ` ~${g.changed}` : ""),
  ] as (string | Piece[])[]).map((t): Piece[] => (typeof t === "string" ? [{ text: t.trimStart() }] : t));
  const shown = segments.map((pieces, k) => ({ pieces, path: k < 3 })).filter(({ pieces }) => pieces.some((p) => p.text !== ""));
  const parts = shown.map(({ pieces }, i) => linkRun(Box, Text, Link, pieces, (j, n) => lerp(PALETTE[(i + 1) % PALETTE.length], PALETTE[(i + 2) % PALETTE.length], j, n)));
  // The folders, branch and worktree are one path: compact spacing closes it up; the row's gap parts what follows.
  return [Box({ flexDirection: "row", columnGap: gap, children: parts.filter((_, i) => shown[i].path) }), ...parts.filter((_, i) => !shown[i].path)];
}

// A value laid over its chip while hovered, `left` columns in: absolute, so it paints over the chip without moving anything.
function hoverOver(Box: Ui["Box"], left: number, child: ReturnType<Ui["Box"] | Ui["Text"]>) {
  return Box({ position: "absolute", top: 0, left, display: "none", hover: { display: "flex" }, children: [child] });
}

type Piece = { text: string; href?: string; color?: RGB };

// A remote's web address: git@host:o/r.git, ssh://git@host/o/r.git and https://host/o/r.git all give https://host/o/r;
// a local path gives "".
function webUrl(remote: string): string {
  const m = remote.trim().match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/);
  return m ? `https://${m[1]}/${m[2]}` : "";
}

// run's gradient across pieces, a piece with an href drawn as a link: one Text per glyph either way.
function linkRun(Box: Ui["Box"], Text: Ui["Text"], Link: Ui["Link"], pieces: Piece[], colorAt: (i: number, n: number) => RGB) {
  const n = [...pieces.map((p) => p.text).join("")].length;
  let at = 0;
  return Box({
    flexDirection: "row",
    // An empty piece draws nothing: a Link with no text the terminal draws as its address.
    children: pieces.filter((p) => p.text !== "").map((p) => {
      const glyphs = [...p.text].map((ch) => Text({ color: hex(p.color ?? colorAt(at, n)), children: (at++, ch) }));
      return p.href ? Link({ href: p.href, children: glyphs }) : Box({ flexDirection: "row", children: glyphs });
    }),
  });
}

// PROMPT_MARK the prompts sent / the model requests the main session made for them; hovered, the same for its subagents:
// AGENT_MARK how many ran / the requests they made. The requests come with the token scan, so until it has run the prompts show alone.
function turnParts(Box: Ui["Box"], Text: Ui["Text"], turns: number, t: StatusTokens | undefined) {
  const value = t ? `${turns} / ${t.main.requests}` : String(turns);
  const hover = t?.agents.count ? `${AGENT_MARK} ${t.agents.count} / ${t.agents.requests}` : undefined;
  return chipParts(Box, Text, { key: "turns", mark: PROMPT_MARK, value, hover, ...TURNS_CHIP });
}

// Warm: the time left before the cache expires and what the next prompt's cached prefix costs read; hovered, in the
// cold colours, what it costs once cold. Cold: the cost of writing it again. Each request that hits the cache restarts its TTL.
function cacheParts(Box: Ui["Box"], Text: Ui["Text"], c: StatusCache, now: number, sent: number | undefined) {
  const left = cacheLeft(c, sent, now);
  return left > 0
    ? chipParts(Box, Text, { key: "cache", mark: CACHE_MARK, value: `${countdown(left)} ${usd(c.read)}`, hover: usd(c.write), hoverStops: COLD_CHIP, ...WARM_CHIP })
    : chipParts(Box, Text, { key: "cache", mark: CACHE_MARK, value: `cold ${usd(c.write)}`, ...COLD_CHIP });
}

// Seconds the cache has left. The TTL runs from the last request sent or answered, whichever is later; a send is known
// before its answer is.
function cacheLeft(c: StatusCache, sent: number | undefined, now: number): number {
  return Math.floor(Math.max(c.at, sent ?? 0) / 1000) + c.ttl - now;
}

function usd(n: number | undefined): string {
  return n === undefined ? "$?" : `$${n.toFixed(2)}`;
}

function dollars(s: StatusSpend): string {
  if (s.unpriced > 0 && s.usd === 0) return "$?";
  return `${s.unpriced > 0 ? "~" : ""}$${s.usd.toFixed(2)}`;
}

// The whole cells a percentage covers, floored so a bar only reads full at 100%.
function cells(pct: number, n: number): number {
  return Math.min(Math.max(Math.floor((pct * n) / 100), 0), n);
}

// The context window drawn as the limits draw theirs, its meaning as statusline.zsh's: the top half is the smart zone
// left (the first `smart` tokens, where recall is precise), the bottom half the window left before auto-compaction;
// past it the bottom refills red, a full bar per 25% over. With no smart zone (`smart` 0) each cell is one full-height
// block of the window left, the glyph a moon filling across the whole window. Cells run red to green across the bar (zsh's _sl_gyr_ramp),
// and the badge is zsh's recall-zone glyph on the colour of the percentage used. Hovered, the tokens left (zsh's ↻).
function contextParts(Box: Ui["Box"], Text: Ui["Text"], context: StatusUsage["context"], limit: number | undefined, smart: number) {
  if (context.tokens === undefined || context.window <= 0) return [];
  const usable = limit && limit > 0 ? limit : context.window;
  const current = context.tokens;
  const remaining = usable - current;
  const pct = Math.min(Math.floor((current * 100) / usable), 150);
  const overflow = remaining < 0;
  const bottom = overflow ? Math.min(Math.floor(((pct - 100) * CONTEXT_CELLS) / 25), CONTEXT_CELLS) : cells(100 - pct, CONTEXT_CELLS);
  const top = smart > 0 ? cells(((smart - Math.min(current, smart)) * 100) / smart, CONTEXT_CELLS) : 0;
  const badgeBg = overflow ? OVERFLOW_RED : ramp(Math.min(pct, 100));
  const badge = ` ${contextIcon(current, usable, remaining, smart)} `;
  const parts = [Text({ color: hex(contrast(badgeBg)), backgroundColor: hex(badgeBg), children: badge })];
  for (let i = 0; i < CONTEXT_CELLS; i++) {
    const lit = ramp(Math.trunc(((CONTEXT_CELLS - 1 - i) * 100) / CONTEXT_CELLS));
    const under = i < bottom ? (overflow ? OVERFLOW_RED : lit) : EMPTY_FG;
    parts.push(Text({ color: hex(smart <= 0 ? under : i < top ? lit : EMPTY_FG), backgroundColor: hex(under), children: "▀" }));
  }
  const shown = `${formatTokens(remaining)} `.padStart(CONTEXT_CELLS);
  parts.push(
    hoverOver(Box, [...badge].length + CONTEXT_CELLS - [...shown].length, Text({ color: hex(badgeBg), backgroundColor: hex(EMPTY_FG), bold: true, children: shown })),
  );
  return [Box({ key: "context", flexDirection: "row", children: parts })];
}

// Ported from statusline.zsh's sl_calc_context_icon: the glyph says the recall zone, not the fill. Up to `smart`
// tokens a diamond (◇ then ◆ past half), above it a moon filling from `smart` to the usable limit (○ ◔ ◑ ◕ ●),
// past the limit ⊙.
function contextIcon(current: number, usable: number, remaining: number, smart: number): string {
  if (remaining < 0) return "⊙";
  if (current <= smart) return current * 2 < smart ? "◇" : "◆";
  const span = usable - smart;
  if (span <= 0) return "●";
  return "○◔◑◕●"[Math.min(Math.floor(((current - smart) * 5) / span), 4)];
}

// One Text per character, so a gradient can colour each glyph (zsh's _sl_apply_fg).
function run(
  Box: Ui["Box"],
  Text: Ui["Text"],
  text: string,
  colorAt: (i: number, n: number) => RGB,
  bold?: boolean,
  background?: RGB,
) {
  const chars = [...text];
  const backgroundColor = background && hex(background);
  return Box({
    flexDirection: "row",
    children: chars.map((ch, i) => Text({ color: hex(colorAt(i, chars.length)), backgroundColor, bold, children: ch })),
  });
}

// Mirrors _sl_interp_rgb: integer-truncated linear interpolation between two stops.
function lerp(a: RGB, b: RGB, i: number, n: number): RGB {
  if (n <= 1) return a;
  const pct = Math.trunc((i * 100) / (n - 1));
  return a.map((v, k) => v + Math.trunc(((b[k] - v) * pct) / 100)) as RGB;
}

// A gradient sliding along the text: each glyph's place, shifted by the phase, folded into a there-and-back sweep so the loop has no seam.
function sweep(a: RGB, b: RGB, i: number, n: number, phase: number): RGB {
  const t = (i / n + phase) % 1;
  return lerp(a, b, Math.round((t < 0.5 ? t * 2 : 2 - t * 2) * 100), 101);
}

// Mirrors _sl_gyr_ramp: green to yellow at 50%, then to red.
function ramp(pct: number): RGB {
  if (pct <= 50) {
    const r = pct * 2;
    return [34 + Math.trunc((216 * r) / 100), 197 + Math.trunc((7 * r) / 100), 94 + Math.trunc((-73 * r) / 100)];
  }
  const r = (pct - 50) * 2;
  return [250 + Math.trunc((-11 * r) / 100), 204 + Math.trunc((-136 * r) / 100), 21 + Math.trunc((47 * r) / 100)];
}

// Mirrors calc_badge_fg in _sl_color_bar_badge: black text on light badges, white on dark.
function contrast(bg: RGB): RGB {
  const lum = Math.trunc((299 * bg[0] + 587 * bg[1] + 114 * bg[2]) / 1000);
  return lum > 128 ? [0, 0, 0] : [255, 255, 255];
}

function hex(c: RGB): string {
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function countdown(left: number): string {
  const days = Math.floor(left / 86_400);
  const hrs = Math.floor((left % 86_400) / 3_600);
  const mins = Math.floor((left % 3_600) / 60);
  if (days > 0) return `${days}d${hrs}h`;
  if (hrs > 0) return `${hrs}h${mins}m`;
  return `${mins}m`;
}

function formatTokens(n: number): string {
  const sign = n < 0 ? "-" : "";
  const t = Math.abs(n);
  if (t >= 1_000_000) {
    const scaled = Math.floor(t / 10_000);
    return `${sign}${Math.floor(scaled / 100)}.${String(scaled % 100).padStart(2, "0")}M`;
  }
  if (t >= 1_000) {
    const scaled = Math.floor(t / 100);
    return `${sign}${Math.floor(scaled / 10)}.${scaled % 10}K`;
  }
  return `${sign}${t}`;
}

// The minor version is optional (claude-fable-5) and at most two digits, so a date suffix
// (claude-opus-4-20250514) is not read as one.
function formatModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

// Matches the family anywhere in the name, so an ID, a display name or an alias all find it;
// an unknown family sweeps cyan to purple.
function modelStyle(model: string): ModelStyle {
  const family = Object.keys(MODEL_STYLES).find((f) => model.toLowerCase().includes(f));
  return family ? MODEL_STYLES[family] : { from: PALETTE[0], to: PALETTE[2] };
}
