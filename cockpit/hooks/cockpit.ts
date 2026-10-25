// Much of this ports statusline.zsh, the shell status line it replaces: https://github.com/nerdalytics/claude-statusline
import type { Elements, EngineInterface, Register } from "claude-code";
import type { StatusCache, StatusGit, StatusLimit, StatusPr, StatusSpend, StatusTokens, StatusUsage } from "../types";

type Ui = Elements["terminal"];

// A line or document read from a file or a command is unknown until narrowed; the types below name only the fields read.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: unknown;
};
type TranscriptRow = { type?: string; subtype?: string; agentId?: string; timestamp?: string; requestId?: string; uuid?: string; message?: { model?: string; usage?: Usage } };
type GhCheck = { status?: string; state?: string; conclusion?: string; detailsUrl?: string; targetUrl?: string };
type GhPr = { number?: number; url?: string; state?: string; isDraft?: boolean; mergeable?: string; reviewDecision?: string | null; comments?: unknown[]; statusCheckRollup?: GhCheck[] | null };
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
  // The 7d percent that 1% of the 5h costs, once this session measured it.
  k?: number;
  // When this session's last response came, in ms: the limits' reading is as of then.
  readAt: number;
  now: number;
  phase: number;
};
type Segment = (ui: Ui, s: Snapshot) => Parts;

const SEGMENTS = {
  model: ({ Box, Text }, s) => {
    const { from, to, bold } = modelStyle(s.model);
    return [run(Box, Text, formatModel(s.model), (i, n) => sweep(from, to, i, n, s.phase), bold)];
  },
  limit_7d: (ui, s) => limitSegment(ui, s, "7d"),
  // ponytail: probe, whether Claude Code reports a window beyond 7d and 5h (a Fable one?): drawn after the 5h bar as its
  // name and percentage. Give it a bar of its own, or delete this, once a screenshot says.
  limit_5h: (ui, s) => [
    ...limitSegment(ui, s, "5h"),
    ...limitsOf(s.usage.rateLimits, s.rejected, s.now * 1000)
      .filter((r) => !LIMITS.some((l) => l.kind === r.kind))
      .map((r) => ui.Text({ children: `${r.kind} ${r.percentUsed}%` })),
  ],
  context: ({ Box, Text }, s) => contextParts(Box, Text, s.usage.context, s.compactAt, smartZone),
  turns: ({ Box, Text }, s) => (s.turns !== undefined ? [turnParts(Box, Text, s.turns, s.tokens)] : []),
  // The main conversation's costs, and its subagents' as a tag of their own; merged, both in the first.
  tokens: ({ Box, Text }, s) => (s.tokens ? tokenParts(Box, Text, s.tokens, mergeCosts).slice(0, 1) : []),
  agents: ({ Box, Text }, s) => (s.tokens ? tokenParts(Box, Text, s.tokens, mergeCosts).slice(1) : []),
  cache: ({ Box, Text }, s) => (s.tokens?.cache ? [cacheParts(Box, Text, s.tokens.cache, s.now, s.sent)] : []),
} satisfies Record<string, Segment>;

// A limit tag's window, its reading, the seconds until it resets (none without a reset time) and its pace, none until a
// reading has it. Every pace style's tag and the explanation read the pace here, the gauge and the words its r against
// the target, lanes and notch its par, so they agree.
function limitOf(s: Snapshot, badge: (typeof LIMITS)[number]["badge"]): { limit: (typeof LIMITS)[number]; found: StatusLimit; left?: number; pace?: { r: number; share: number; par: number } } | undefined {
  const limit = LIMITS.find((l) => l.badge === badge);
  const limits = limitsOf(s.usage.rateLimits, s.rejected, s.now * 1000);
  const found = limit && limits.find((r) => r.kind === limit.kind);
  if (!limit || !found) return undefined;
  const left = found.resetsAt ? Math.floor(Date.parse(found.resetsAt) / 1000) - s.now : undefined;
  const target = badge === "5h" ? fiveHourTarget(found, limits.find((r) => r.kind === "seven_day"), s.k) : 100;
  return { limit, found, left, pace: paceOf(limit, found, s.readAt, s.now * 1000, target) };
}

// The 5h's target: what the 7d can still pay for at k 7d percent per 5h percent, up to its whole allowance. Its whole
// allowance until this session has measured k, and when the 7d resets before this 5h window ends, refilling it first.
function fiveHourTarget(five: StatusLimit, seven: StatusLimit | undefined, k: number | undefined): number {
  if (k === undefined || !five.resetsAt || !seven?.resetsAt || Date.parse(seven.resetsAt) <= Date.parse(five.resetsAt)) return 100;
  return Math.min(100, five.percentUsed + (100 - seven.percentUsed) / k);
}

// One limit's tag, none until a reading has it: its badge, then its bar in the limit_style. The gauge's badge also reads
// the percent used, rounded as the run-out warning rounds it. Hovered, the explanation line shows the countdown.
function limitSegment({ Box, Text }: Ui, s: Snapshot, badge: (typeof LIMITS)[number]["badge"]): Parts {
  const reading = limitOf(s, badge);
  if (!reading) return [];
  const { limit, found, left, pace } = reading;
  const timeLeft = left === undefined ? 0 : cells((left * 100) / limit.seconds, barCells[limit.badge]);
  const bar =
    limitStyle === "gauge"
      ? gaugeCells(Text, limit, pace)
      : limitStyle === "lanes"
        ? lanesCells(Text, limit, found, timeLeft, pace)
        : limitStyle === "notch"
          ? notchCells(Text, limit, found, pace)
          : classicCells(Text, limit, found, timeLeft);
  const label = limitStyle === "gauge" ? `${limit.badge} ${Math.round(found.percentUsed)}%` : limit.badge;
  const { to } = stops(`limit.${limit.badge}`);
  const children = [Text({ color: hex(contrast(to)), backgroundColor: hex(to), children: ` ${label} ` }), ...bar];
  return [Box({ key: limit.kind, flexDirection: "row", hover: { scope: explainScope(`limit_${limit.badge}`) }, children })];
}

// The lines around the prompt, in the layout option: rows of tags, and a line of the mod's own for each offer and for
// the explanation line, which its /config toggle switches on. Lines before `prompt` draw above the prompt, the rest under it below the engine's
// hint line. A row holds any tags, the git ones and the status ones alike; the tags after a `hidden` line are off.
// /cockpit:order writes it by dragging. Applied in register.
// A spacer in a row takes a share of the room the tags leave, so what stands before it is pushed left and what stands
// after it right; spacers side by side take a share each. Among the lines a spacer is a blank line. A gap in a row is
// that many columns, fixed; tags with neither between them touch.
const SPACER = "spacer";
type Spacer = typeof SPACER;
const isSpacer = (name: string): name is Spacer => name === SPACER;
const GAPS = ["gap-1", "gap-2", "gap-3"] as const;
type Gap = (typeof GAPS)[number];
const isGap = (name: string): name is Gap => GAPS.some((gap) => gap === name);
type Filler = Spacer | Gap;
const isFiller = (name: string): name is Filler => isSpacer(name) || isGap(name);
const STATUS_ROW = ["model", "limit_7d", "limit_5h", "context", "turns", "tokens", "agents", "cache"] as const;
type StatusTag = (typeof STATUS_ROW)[number];
const GIT_ROW = ["folders", "branch", "worktree", "pr", "review", "comments", "sync", "conflict", "checks", "changes"] as const;
type GitTag = (typeof GIT_ROW)[number];
const TAGS = [...GIT_ROW, ...STATUS_ROW];
type Tag = GitTag | StatusTag;
const isTag = (name: string): name is Tag => TAGS.some((tag) => tag === name);
const isGitTag = (name: Tag): name is GitTag => GIT_ROW.some((tag) => tag === name);
// The hover group a status tag joins, which reveals its explanation in the explanation line, on either side of the prompt.
const explainScope = (tag: StatusTag) => `explain-${tag}`;
// The tags that need the pull request, which gh fetches.
const PR_TAGS: readonly Tag[] = ["pr", "review", "comments", "conflict", "checks"];
const LINES = ["fresh", "compact", "explain"] as const;
type Line = (typeof LINES)[number];
const isLine = (name: string): name is Line => LINES.some((line) => line === name);
const LINE_TOGGLES: Record<Line, string> = { fresh: "fresh_start", compact: "compact_hint", explain: "explain_row" };
type Row = (Tag | Filler)[];
const isRow = (line: unknown): line is Row => Array.isArray(line);
type Layout = { lines: (Row | Line | Spacer | "prompt")[]; hidden: Tag[] };
// Today's two rows: the git row above the prompt, the status row under it, each tag a column from the next.
const DEFAULT_LAYOUT = [GIT_ROW.join(",gap-1,"), "prompt", STATUS_ROW.join(",gap-1,"), ...LINES].join(";");
let layout: Layout = layoutOf(DEFAULT_LAYOUT);
let aboveLines: (Row | Line | Spacer)[] = [];
let belowLines: (Row | Line | Spacer)[] = [];
// Whether a row on either side of the prompt holds the tag, so it is switched on.
const isShown = (tag: Tag) => [...aboveLines, ...belowLines].some((line) => isRow(line) && line.includes(tag));

// The layout option: lines split by ";", tags and lines by ",". Unknown and repeated names are dropped; a tag left out
// goes after the one before it in the default order (the first one first in the first row), a prompt left out after the
// first row, an offer left out last. An empty option is the default.
function layoutOf(option: unknown): Layout {
  const text = typeof option === "string" && option.trim() !== "" ? option : DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const once = (name: string) => !seen.has(name) && Boolean(seen.add(name));
  const lines: Layout["lines"] = [];
  const hidden: Tag[] = [];
  let off = false;
  for (const line of text.split(";")) {
    const names = line.split(",").map((name) => name.trim()).filter(Boolean);
    const [one] = names.length === 1 ? names : [];
    if (one === "hidden") off = true;
    else if (off) hidden.push(...names.filter((name): name is Tag => isTag(name) && once(name)));
    else if (one && isSpacer(one)) lines.push(one);
    else if (one && (one === "prompt" || isLine(one))) {
      if (once(one)) lines.push(one);
    } else lines.push(names.filter((name): name is Tag | Filler => isFiller(name) || (isTag(name) && once(name))));
  }
  const rows = lines.filter(isRow);
  TAGS.forEach((tag, i) => {
    if (seen.has(tag)) return;
    const before = TAGS[i - 1];
    const list: (Tag | Filler)[] = [...rows, hidden].find((l) => before !== undefined && l.includes(before)) ?? rows[0] ?? hidden;
    list.splice(before === undefined ? 0 : list.indexOf(before) + 1, 0, tag);
  });
  if (!seen.has("prompt")) lines.splice(rows[0] ? lines.indexOf(rows[0]) + 1 : 0, 0, "prompt");
  lines.push(...LINES.filter((line) => !seen.has(line)));
  return { lines, hidden };
}

// The layout as the option spells it, the hidden tags after a hidden line.
function layoutText({ lines, hidden }: Layout): string {
  return [...lines.map((line) => (isRow(line) ? line.join(",") : line)), ...(hidden.length > 0 ? ["hidden", hidden.join(",")] : [])].join(";");
}

// The /cockpit:order pane: the lines around a prompt marker, then every row's tags under its marker, each a list to
// drag. What stands after a list's "hidden" marker is switched off; the markers themselves do not drag. The lines keep a
// spacer and a new row after their hidden marker, to drag out, the tags a spacer and each gap: one dropped there is gone.
const ORDER_PANE = "cockpit-order";
const COLORS_PANE = "cockpit-colors";
const NEW_ROW = "row";
const LABELS: Record<string, string> = {
  model: "model",
  limit_7d: "7d limit",
  limit_5h: "5h limit",
  context: "context",
  turns: "turns",
  tokens: "main session costs",
  agents: "subagent costs",
  cache: "cache",
  folders: "folders",
  branch: "branch",
  worktree: "worktree",
  pr: "pull request",
  review: "review",
  comments: "comments",
  sync: "commits ahead and behind",
  conflict: "conflict",
  checks: "checks",
  changes: "changes",
  fresh: "cold cache: fresh start",
  compact: "smart zone: compaction",
  explain: "explanation line",
  prompt: "━━ your prompt ━━",
  hidden: "╌╌ hidden: switched off ╌╌",
  spacer: "↔ spacer",
  "gap-1": "␣ gap: 1 column",
  "gap-2": "␣ gap: 2 columns",
  "gap-3": "␣ gap: 3 columns",
  [NEW_ROW]: "▤ new row: drag it out, then drop tags under its marker",
};
type ListKey = "lines" | "tags";
const isList = (key: string): key is ListKey => key === "lines" || key === "tags";
type List = { items: string[]; labels: Record<string, string>; fixed: string[] };
let lists: Record<ListKey, List> = listsOf(layout, () => true);
// Changes whenever the lists do, so each list's Client drops a drag it kept from before.
let rev = 0;
const listProps = (key: ListKey) => ({ ...lists[key], rev });

// The pane's two lists from a layout. The lines: each row as row-N, the prompt marker, the offers switched on and the
// spacers, then the hidden marker, the spacer and the new row to drag out, and the offers switched off. The tags: each
// row's marker and its tags, then the hidden marker, the spacer and gaps to drag out, and the hidden tags. Merged, the
// costs are one tag, the total, and the subagents' tag is left out of the lists; a drop then leaves it out of the
// layout, which puts it back after the costs.
function listsOf(l: Layout, on: (line: Line) => boolean, merged = false): Record<ListKey, List> {
  const listed = <T extends string>(names: T[]) => names.filter((name) => !(merged && name === "agents"));
  const labels: Record<string, string> = { ...LABELS, tokens: merged ? "total costs" : "main session costs" };
  const rows = l.lines.filter(isRow).map(listed);
  const id = (i: number) => `row-${i + 1}`;
  const named = (row: Row) => row.filter(isTag).map((tag) => labels[tag] ?? tag);
  const summary = (row: Row) => {
    const names = named(row);
    return names.length === 0 ? "empty" : names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  };
  return {
    lines: {
      items: [...l.lines.flatMap((line) => (isRow(line) ? [id(l.lines.filter(isRow).indexOf(line))] : isLine(line) && !on(line) ? [] : [line])), "hidden", SPACER, NEW_ROW, ...LINES.filter((line) => !on(line))],
      labels: { ...labels, spacer: "↕ spacer: a blank line", ...Object.fromEntries(rows.map((row, i) => [id(i), `▤ row ${i + 1}: ${summary(row)}`])) },
      fixed: ["prompt", "hidden"],
    },
    tags: {
      items: [...rows.flatMap((row, i) => [id(i), ...row]), "hidden", SPACER, ...GAPS, ...listed(l.hidden)],
      labels: { ...labels, ...Object.fromEntries(rows.map((_, i) => [id(i), `━━ row ${i + 1} ━━`])) },
      fixed: [...rows.map((_, i) => id(i)), "hidden"],
    },
  };
}

// A list's names by zone: before the first marker, between the markers, after the last.
function zonesOf(list: string[], markers: string[]): string[][] {
  let zone: string[] = [];
  const zones = [zone];
  for (const name of list) {
    if (markers.includes(name)) {
      zone = [];
      zones.push(zone);
    } else {
      zone.push(name);
    }
  }
  return zones;
}

// What a drop in a list makes of the layout, and the offers' toggles. In the lines: the rows, offers and spacers above
// the hidden marker in their new order, the new row dragged out an empty row; a row dropped under it is gone and its
// tags hidden, an offer dropped there switched off and placed last. In the tags: each row the tags under its marker, those dragged above
// the first one into the first row; with no row to take them the drop is refused.
function dropped(key: ListKey, list: string[]): { layout: Layout; toggles: Record<string, boolean> } | undefined {
  const rows = layout.lines.filter(isRow);
  if (key === "lines") {
    const [shown = [], off = []] = zonesOf(list, ["hidden"]);
    const rowOf = (name: string) => rows[Number(/^row-(\d+)$/.exec(name)?.[1] ?? 0) - 1];
    const lines = shown.flatMap((name): Layout["lines"] => {
      const row = name === NEW_ROW ? [] : rowOf(name);
      return row ? [row] : name === "prompt" || isSpacer(name) || isLine(name) ? [name] : [];
    });
    const hidden = [...layout.hidden, ...off.flatMap((name) => rowOf(name)?.filter(isTag) ?? [])];
    // An offer switched off keeps a place, last, for when /config switches it on again.
    lines.push(...off.filter(isLine));
    return { layout: { lines, hidden }, toggles: Object.fromEntries(LINES.map((line) => [LINE_TOGGLES[line], shown.includes(line)])) };
  }
  const [lead = [], ...zones] = zonesOf(list, lists.tags.fixed);
  const hidden = zones.pop() ?? [];
  const [first, ...rest] = zones;
  if (!first) return lead.length > 0 ? undefined : { layout: { ...layout, hidden: hidden.filter(isTag) }, toggles: {} };
  const placed = [[...lead, ...first], ...rest].map((zone) => zone.filter((name): name is Tag | Filler => isTag(name) || isFiller(name)));
  let i = 0;
  return { layout: { lines: layout.lines.map((line) => (isRow(line) ? (placed[i++] ?? []) : line)), hidden: hidden.filter(isTag) }, toggles: {} };
}

const USAGE = { plugin: "cockpit", key: "usage" } as const;
const PACE_K = { plugin: "cockpit", key: "paceK" } as const;
const MODEL = { plugin: "cockpit", key: "model" } as const;
const TOKENS = { plugin: "cockpit", key: "tokens" } as const;
const TURNS = { plugin: "cockpit", key: "turns" } as const;
const COMPACT_AT = { plugin: "cockpit", key: "compactAt" } as const;
type Offer = "fresh" | "compact";
const DISMISSED = { plugin: "cockpit", key: "dismissed" } as const;
const SENT = { plugin: "cockpit", key: "sent" } as const;
const READ = { plugin: "cockpit", key: "readAt" } as const;
const GIT = { plugin: "cockpit", key: "git" } as const;
const PR = { plugin: "cockpit", key: "pr" } as const;
const REJECTED = { plugin: "cockpit", key: "rejected" } as const;
const HANDOFF = { plugin: "cockpit", key: "handoff" } as const;
const TICK = { plugin: "cockpit", key: "tick" } as const;
const LOAD = { plugin: "cockpit", key: "load" } as const;
const STRETCH = { plugin: "cockpit", key: "stretch" } as const;
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
const HANDOFF_COMMAND = "cockpit:handoff";
// A handoff stays the session's own until a main-conversation request comes later than its file by more than this: the
// reply that closes the handoff's turn lands a little after the file, and a later one means the work went on without it.
const HANDOFF_GRACE_MS = 5 * 60_000;
// With the keep_warm_pings option on, a minimal prompt of the mod's own reads the cache just before it expires, which
// restarts its TTL at the read price. The lead is how many seconds before expiry the ping goes out, by TTL; the gap
// keeps one ping from going out twice before its turn has started.
const PING_TEXT = "The prompt cache needs a request to stay warm. Reply with the single word ok and use no tools.";
const PING_LEAD_S: Record<number, number> = { 3_600: 300, 300: 60 };
// Claude Code compacts a long idle conversation about 54 minutes into an hour's cache unless idleCompaction is false in
// settings.json. A compaction before the handoff would leave the handoff a summary to summarise, so on an hour's cache
// the mod acts this many seconds before expiry, 50 minutes in, while that setting is not false.
const IDLE_COMPACT_LEAD_S = 600;
const PING_GAP_MS = 10_000;
// Sweep speed per effort, linear: each step adds a ninth of a cycle a second, so high (3) sweeps once every 3 s.
// "none" is a request sent without effort; a level missing here (a numeric budget) sweeps as high.
const HIGH_STEPS = 3;
const EFFORT_STEPS: Record<string, number> = { none: 0, low: 1, medium: 2, high: HIGH_STEPS, xhigh: 4, max: 5 };
const STEP_CYCLES_PER_SECOND = 1 / 9;

// A limit is the account's, but a session hears its figure only in its own responses, so the run-out warning needs one
// from this session this recent: the session being prompted is the one that warns, an idle one's figure is stale.
const FORECAST_FRESH_MS = 10 * 60_000;
// Early in a window the pace is noise: no run-out warning until this share of it has gone.
const FORECAST_FROM = 0.1;
// The 5h rise, in points, a sample of k needs. A percent used has one decimal, so at k near 0.1 a 10-point rise moves
// the 7d about 1.0 and its rounding of ±0.05 is about ±5% of k; a 5-point rise would double that.
const K_MIN_RISE = 10;
// A reset time counts as moved, a new window, only by this much: nothing shows that a window's resetsAt reads the same
// in every reading, and two real windows of one limit are at least 5 hours apart.
const RESET_MOVED_MS = 60_000;
// The share of the smart zone the context has used when the line offering a compaction appears.
const COMPACT_HINT_AT = 0.9;
const SMART_ZONE_URL = "https://www.aihero.dev/ai-coding-dictionary/smart-zone";
// How far into the dumb zone the context is, by its size over the smart zone's: the further, the sloppier the model.
// A log scale, each step half as far again as the last, so the words move on by a share of the context, not by a fixed
// count of tokens: on a 200K zone, just into up to 300K, well into up to 450K, deep into up to 675K.
const DUMB_ZONE_DEPTHS: [number, string][] = [[1.5, "just into"], [2.25, "well into"], [3.375, "deep into"]];
const LIMITS: { kind: string; badge: "7d" | "5h"; seconds: number }[] = [
  { kind: "seven_day", badge: "7d", seconds: 604_800 },
  { kind: "five_hour", badge: "5h", seconds: 18_000 },
];
// How both limit tags draw, the limit_style option.
const LIMIT_STYLES = ["classic", "lanes", "gauge", "notch"] as const;
type LimitStyle = (typeof LIMIT_STYLES)[number];
// The cells each bar draws when its length option is unset, as cockpit 1.1.0 drew them.
const BAR_CELLS = { "7d": 7, "5h": 10, context: 10 };
// Every colour the mod draws, by its name in the colors option: the /cockpit:colors pane's rows, under the group the
// first of them names, a gradient's ends as light and dark before their label. A gradient runs from its .from colour to
// its .to; with the gradients option off a run is its .from colour alone, and .to is not asked for. The colour code, by
// what a thing does:
// - hoverable: a tag, then the value on the grey (empty); hovered, its explanation shows on the grey in the explanation line;
// - data without a hover: a tag, then the value on no background, as every chip is with the explanation line off;
// - plain text: coloured or dim, on no background;
// - a button: icon and label on one fill, between two half-block bars, in a colour no chip uses;
// - a link: gradient text on no background, opened by a click.
const COLORS = {
  // The four stops of statusline.zsh's _sl_pal. A row's git parts each take a gradient one stop wide, starting at blue
  // and stepping on per part; the model's name a window one step wide that slides towards pink as the family gets stronger.
  "palette.1": { group: "Palette: the git parts in turn, and the model's name by family", label: "cyan: Haiku", rgb: [34, 211, 216] },
  "palette.2": { group: "", label: "blue: a row's first git part, Opus", rgb: [96, 165, 250] },
  "palette.3": { group: "", label: "purple: Fable and Mythos", rgb: [168, 85, 247] },
  "palette.4": { group: "", label: "pink", rgb: [217, 70, 239] },
  "limit.7d.from": { group: "7d limit bar and badge", label: "", rgb: [192, 132, 252] },
  "limit.7d.to": { group: "", label: "the badge", rgb: [100, 50, 150] },
  "limit.5h.from": { group: "5h limit bar and badge", label: "", rgb: [34, 211, 238] },
  "limit.5h.to": { group: "", label: "the badge", rgb: [15, 140, 150] },
  // A limit's pace, in every style but classic: slate for an allowance that goes unused, amber to red for one that runs out early.
  "pace.under": { group: "Limit pace", label: "under pace", rgb: [148, 163, 184] },
  "pace.over.from": { group: "", label: "over pace", rgb: [251, 191, 36] },
  "pace.over.to": { group: "", label: "over pace, much of the window left at run-out", rgb: [239, 68, 68] },
  "pace.par": { group: "", label: "the gauge's pipe and the notch", rgb: [229, 231, 235] },
  "pace.none": { group: "", label: "a limit drawn without a pace: the gauge's pipe, the lanes and the notch's usage", rgb: [107, 114, 128] },
  // statusline.zsh's _sl_gyr_ramp: green to yellow at 50%, then to red. Three meanings, so with gradients off each stays,
  // as a band of its own.
  "context.low": { group: "Context bar and badge", label: "plenty left", rgb: [34, 197, 94] },
  "context.mid": { group: "", label: "half used", rgb: [250, 204, 21] },
  "context.high": { group: "", label: "nearly full", rgb: [239, 68, 68] },
  // statusline.zsh's overflow colour: its piecewise blend toward purple never ran, as nothing set the tokens it scaled.
  "context.over": { group: "", label: "past auto-compaction", rgb: [239, 68, 68] },
  // The chips' stops, lighter to darker, as the limits' are: the mark sits on the darker.
  "turns.from": { group: "Prompts chip", label: "", rgb: [96, 165, 250] },
  "turns.to": { group: "", label: "the mark", rgb: [37, 99, 235] },
  "costs.from": { group: "Costs chip", label: "", rgb: [217, 70, 239] },
  "costs.to": { group: "", label: "the mark", rgb: [134, 25, 143] },
  "agents.from": { group: "Subagents' costs chip", label: "", rgb: [251, 191, 36] },
  "agents.to": { group: "", label: "the mark", rgb: [180, 83, 9] },
  // The cache chip: green while the next prompt reads the cache, red once it writes it again.
  "cache.warm.from": { group: "Cache chip, warm", label: "", rgb: [74, 222, 128] },
  "cache.warm.to": { group: "", label: "the mark", rgb: [21, 128, 61] },
  "cache.cold.from": { group: "Cache chip, cold", label: "the fresh-start line's $", rgb: [248, 113, 113] },
  "cache.cold.to": { group: "", label: "the mark", rgb: [185, 28, 28] },
  notice: { group: "Warnings", label: "the compaction line's diamond and link, the run-out warning's sign", rgb: [251, 191, 36] },
  // A pull request's number, whole in one colour by state; a failed check's cross stands out from the row's gradient.
  "pr.open": { group: "Pull request", label: "open", rgb: [250, 204, 21] },
  "pr.draft": { group: "", label: "draft", rgb: [240, 240, 245] },
  "pr.merged": { group: "", label: "merged", rgb: [168, 85, 247] },
  "pr.closed": { group: "", label: "closed", rgb: [130, 135, 152] },
  "pr.failed": { group: "", label: "a failed check's cross", rgb: [239, 68, 68] },
  empty: { group: "Empty", label: "bar cells past their end, the grey behind a value that hovers and behind its explanation", rgb: [55, 58, 72] },
  // main: the action an offer makes; secondary: the cross that hides it.
  "button.main.fill": { group: "Buttons: Start fresh and Compact", label: "fill", rgb: [79, 70, 229] },
  "button.main.label": { group: "", label: "label", rgb: [199, 210, 254] },
  "button.secondary.fill": { group: "Buttons: the cross that hides an offer", label: "fill", rgb: [51, 65, 85] },
  "button.secondary.label": { group: "", label: "label", rgb: [203, 213, 225] },
} satisfies Record<string, { group: string; label: string; rgb: RGB }>;
type ColorName = keyof typeof COLORS;
// The names of the gradients: the colours with a .from.
type Gradient = ColorName extends infer N ? (N extends `${infer G}.from` ? G : never) : never;
const isColor = (name: string): name is ColorName => Object.hasOwn(COLORS, name);
// The colors option's overrides, by name, and the gradients option; set as the module registers.
let overrides = new Map<ColorName, RGB>();
let gradients = true;
// A colour as drawn: the person's, else the default; with gradients off a .to is its .from.
function color(name: ColorName): RGB {
  const from = gradients ? undefined : name.replace(/\.to$/, ".from");
  if (from !== undefined && from !== name && isColor(from)) return color(from);
  return overrides.get(name) ?? COLORS[name].rgb;
}
const stops = (name: Gradient) => ({ from: color(`${name}.from`), to: color(`${name}.to`) });
const PALETTE = ["palette.1", "palette.2", "palette.3", "palette.4"] as const;
// The stop at a position that wraps around the four.
const stop = (i: number): RGB => color(PALETTE[i % PALETTE.length] ?? PALETTE[0]);
type ButtonLook = { fill: RGB; label: RGB };
const buttonLook = (kind: "main" | "secondary"): ButtonLook => ({ fill: color(`button.${kind}.fill`), label: color(`button.${kind}.label`) });
type ModelStyle = { from: RGB; to: RGB; bold?: true };
// Mythos is Fable's model without Fable's safeguards: Fable's colours, bold. Without gradients a family is its first stop.
function modelStyles(): Record<string, ModelStyle> {
  const step = (from: RGB, to: RGB, bold?: true): ModelStyle => ({ from, to: gradients ? to : from, bold });
  return {
    haiku: step(stop(0), stop(1)),
    // Glyph 1 of 3 in a lerp is the halfway colour.
    sonnet: step(lerp(stop(0), stop(1), 1, 3), lerp(stop(1), stop(2), 1, 3)),
    opus: step(stop(1), stop(2)),
    fable: step(stop(2), stop(3)),
    mythos: step(stop(2), stop(3), true),
  };
}

// The colors option, a comma list of name=#rrggbb: an unknown name or a colour that does not read is left out.
function overridesOf(option: unknown): Map<ColorName, RGB> {
  const found = new Map<ColorName, RGB>();
  for (const entry of typeof option === "string" ? option.split(",") : []) {
    const [name = "", value = ""] = entry.split("=").map((part) => part.trim());
    const rgb = rgbOf(value);
    if (isColor(name) && rgb) found.set(name, rgb);
  }
  return found;
}

// Six hex digits, with a # or without, in either case.
function rgbOf(text: string): RGB | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!m?.[1]) return undefined;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
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
// The moon's phases, empty to full: the context icon's fill, and the cache chip's time left (empty once cold).
const MOON = [..."○◔◑◕●"];

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
// Whether Claude Code compacts an idle session: its idleCompaction setting, on unless set to false. Read at the session's start.
let idleCompaction = true;
// The most pings per idle stretch, the keep_warm_pings option; 0 sends none.
let keepWarm = 0;
// The pings sent in the stretch since the person's prompt at pingFor, and when the last went out.
let pings = 0;
let pingFor = 0;
let pingAt = -Infinity;
// The cells each bar draws, from the limit_7d_length, limit_5h_length and context_length options.
let barCells = BAR_CELLS;
// The limit_style option; a value it does not know reads as classic.
let limitStyle: LimitStyle = "classic";
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
// A reload starts the module over, so the three times above are also kept in the session's state and read back at its start:
// without them a reload leaves no prompt of the person's behind it, and the handoff waits for one.
const remember = ($: EngineInterface) => void $.state.set(STRETCH, { promptAt, handoffAt, compactedAt });
// The main conversation is being compacted, by whoever started it; the offer to compact is not drawn meanwhile.
// Each sign of it is kept apart, so the spinner saying something else does not end a /compact still running.
let compacting = false;
const compactingBy = { command: false, spinner: false };
function setCompacting($: EngineInterface, by: keyof typeof compactingBy, value: boolean) {
  if (compactingBy[by] === value) return;
  compactingBy[by] = value;
  compacting = compactingBy.command || compactingBy.spinner;
  $.ui.invalidate("ui.render");
}
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
// The merge_costs option: one cost chip for the main conversation and its subagents together.
let mergeCosts = false;
// The limit_forecast option: the run-out warning in the explanation line, when a limit runs out before its reset at the
// pace so far.
let limitForecast = false;
// The explain_row option: the explanation line, where hovering a tag shows its explanation.
let explainRow = false;
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
  turnRate = options.turn_rate === true;
  mergeCosts = options.merge_costs === true;
  limitForecast = options.limit_forecast === true;
  explainRow = options.explain_row === true;
  // Each line on its side of the prompt, an offer only while its toggle is on.
  layout = layoutOf(options.layout);
  const shown = (line: Line) => options[LINE_TOGGLES[line]] === true;
  aboveLines = [];
  belowLines = [];
  let side = aboveLines;
  for (const line of layout.lines) {
    if (line === "prompt") side = belowLines;
    else if (isRow(line) || !isLine(line) || shown(line)) side.push(line);
  }
  lists = listsOf(layout, shown, mergeCosts);
  rev = Date.now();
  smartZone = options.smart_zone !== true ? 0 : typeof options.smart_zone_tokens === "number" ? options.smart_zone_tokens : 200_000;
  barCells = {
    "7d": lengthOf(options.limit_7d_length, BAR_CELLS["7d"]),
    "5h": lengthOf(options.limit_5h_length, BAR_CELLS["5h"]),
    context: lengthOf(options.context_length, BAR_CELLS.context),
  };
  limitStyle = LIMIT_STYLES.find((style) => style === options.limit_style) ?? "classic";
  overrides = overridesOf(options.colors);
  gradients = options.gradients !== false;
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await startSession($);
    return result;
  });

  // A /clear fires no session.start, and the new session starts with empty state: without this the tick reads no
  // LOAD, takes it for a newer copy's and stops, and nothing is read again until the first response. Not on
  // classic.SessionStart: where an organization manages Claude Code, the built-in sec-default plugin sends classic.*
  // past the plugins a person installs. A failure here, after `next`, leaves the /clear's own result standing.
  on("command.run", { command: "clear" }, async ($, e, next) => {
    const result = await next(e);
    await startSession($);
    return result;
  });

  // The layout is one long text: shown in /config, it cut every row's label there short. /cockpit:order edits it,
  // and a hidden row still takes a /config key=value with its key.
  on("config.describe", ($, e, next) => (/^cockpit(@|$)/.test(e.provider.plugin) && e.key.endsWith(".layout") ? next({ ...e, isHidden: true }) : next(e)));

  on("command.run", { command: "cockpit:order" }, async ($) => {
    await $.ui.open({ id: ORDER_PANE, title: "Cockpit order" });
    return { text: "Cockpit order pane opened." };
  });

  on("ui.render", { component: "Pane", requestId: ORDER_PANE }, ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    const ui = $.ui.resolve(e);
    // As wide as the pane, so a label wraps inside it rather than past its edge.
    const list = (key: ListKey) => ui.Client({ key, module: "./order-list.ts", width: "100%", props: listProps(key) });
    const spacers = "Drag the spacer out of hidden to add one, and drop one under hidden to take it away.";
    const gaps = "A gap is that many columns, fixed: tags with neither a gap nor a spacer between them touch. Gaps drag out of hidden as the spacer does.";
    return pane(ui, "Cockpit order", "Press a row, drag it, release to drop it. Anything dropped under hidden is switched off.", [
      ...section(ui, "Lines around the prompt", `A line above the prompt marker draws above your prompt. A line below it draws under your prompt. A row draws the tags under its marker in the list below. Drag the new row out of hidden to reserve one, then drop tags under its marker. A row dropped under hidden is gone, and its tags are switched off. The cold cache and smart zone lines show only while they apply. The explanation line always takes a line, and shows the run-out warning when a limit runs out before its reset. A spacer is a blank line. ${spacers}`),
      list("lines"),
      ...section(ui, "Tags", `Each row draws the tags under its marker, left to right. A spacer takes a share of the room the tags leave, pushing what stands before it left and what stands after it right. One spacer first draws the row against the right edge. Spacers side by side take a share each, so they push harder. ${gaps} ${spacers}`),
      list("tags"),
    ]);
  });

  // Each drop writes the /config options it changed, switches first: one write per option, since a write loads the module
  // again. The layout is one option, so a tag moved between rows is one write. The list is the same names moved, a
  // spacer as many times as before, the markers in their order.
  on("ui.message", { requestId: ORDER_PANE }, async ($, e, next) => {
    const key = e.element;
    const data = e.data;
    if (!isList(key) || !Array.isArray(data) || !data.every((name) => typeof name === "string")) return next(e);
    const { items, fixed } = lists[key];
    const sameNames = [...data].sort().join(",") === [...items].sort().join(",");
    if (!sameNames || !fixed.every((name, i) => i === 0 || data.indexOf(fixed[i - 1] ?? "") < data.indexOf(name))) return next(e);
    const drop = dropped(key, data);
    if (!drop) return { props: { ...listProps(key), rev: Date.now() } };
    const saved: Record<string, string | boolean> = { ...drop.toggles, layout: layoutText(drop.layout) };
    const changed = Object.entries(saved).filter(([field, value]) => value !== options[field]);
    changed.sort(([, a], [, b]) => Number(typeof b === "boolean") - Number(typeof a === "boolean"));
    for (const [field, value] of changed) {
      const deny = await setOption($, field, value);
      if (deny) {
        $.ui.toast(`Cockpit order: ${deny}`);
        return { props: { ...listProps(key), rev: Date.now() } };
      }
    }
    // A drop in one list can change the other (a new row's marker), so the pane draws both again.
    const now = { ...options, ...saved };
    layout = drop.layout;
    lists = listsOf(layout, (line) => now[LINE_TOGGLES[line]] === true, mergeCosts);
    rev = Date.now();
    $.ui.invalidate("ui.render");
    return { props: listProps(key) };
  });

  on("command.run", { command: "cockpit:colors" }, async ($) => {
    await $.ui.open({ id: COLORS_PANE, title: "Cockpit colours", focus: true });
    return { text: "Cockpit colours pane opened." };
  });

  // The /cockpit:colors pane: a swatch and a field per colour, under the group it colours, and a button that turns the
  // gradients off and on. Without gradients only a gradient's first colour is asked for; the other keeps what was saved.
  on("ui.render", { component: "Pane", requestId: COLORS_PANE }, ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    const ui = $.ui.resolve(e);
    const { Box, Text, Input } = ui;
    const fields = Object.entries(COLORS).flatMap(([name, { group, label, rgb }]) => {
      if (!isColor(name) || (!gradients && name.endsWith(".to"))) return [];
      const end = name.endsWith(".from") ? (gradients ? "light end" : "colour") : name.endsWith(".to") ? "dark end" : "";
      // In a narrow pane the label wraps under itself; the swatch and the field keep their width, so the colour stays whole.
      const field = Box({
        flexDirection: "row",
        columnGap: 1,
        children: [
          Box({ flexShrink: 0, children: [Text({ color: hex(color(name)), children: "██" })] }),
          Box({ flexGrow: 1, flexShrink: 1, children: [Text({ children: [end, label].filter(Boolean).join(", ") })] }),
          Box({ flexShrink: 0, children: [Input({ key: name, value: hex(color(name)), placeholder: hex(rgb), submitLabel: "save", onSubmit: (value) => saveColor($, options.colors, name, value) })] }),
        ],
      });
      return group ? [...section(ui, group), field] : [field];
    });
    const toggle = async () => {
      const deny = await setOption($, "gradients", !gradients);
      if (deny) $.ui.toast(`Cockpit colours: ${deny}`);
    };
    return pane(ui, "Cockpit colours", "Type a colour as six hex digits, #22d3d8, and press Enter to save it. An empty field goes back to the default.", [
      Box({ height: 1 }),
      sentence(ui, [
        Text({ dimColor: true, children: gradients ? "Gradients are on. " : "Gradients are off: one colour per gradient. " }),
        button(ui, "gradients", "main", "◑", gradients ? "Turn gradients off" : "Turn gradients on", toggle),
      ]),
      ...fields,
    ]);
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
    // ponytail: only the main conversation's response stamps the reading; whether a subagent's updates the limits is unchecked.
    if (!e.agentId && response.usage) void $.state.set(READ, Date.now());
    tokensStale = true;
    return response;
  });

  on("session.measure", async ($, e, next) => {
    await setUsage($, e);
    return next(e);
  });

  // The offer to compact leaves while a compaction runs and returns if it ends without one. Not on session.compact:
  // where an organization manages Claude Code, the built-in sec-default plugin sends it past the plugins a person
  // installs. A /compact, the person's or the mod's own button, settles its command.run once the compaction ends or is
  // cancelled, and the signal aborts when the interrupt cuts the dispatch. Claude Code's own auto and idle compaction
  // run no command; the main conversation's spinner says them, as a subagent's does not.
  on("command.run", { command: "compact" }, async ($, e, next) => {
    setCompacting($, "command", true);
    next.signal.addEventListener("abort", () => setCompacting($, "command", false), { once: true });
    try {
      return await next(e);
    } finally {
      setCompacting($, "command", false);
    }
  });
  // shortcut: matches Claude Code's own spinner text, which 2.1.310 draws in English whatever the language setting; if a
  // release translates or rewords it, auto and idle compaction show the offer again, and this needs the new text.
  on("ui.render", { component: "Spinner", requestId: "main" }, ($, e, next) => {
    setCompacting($, "spinner", e.props.message?.startsWith("Compacting conversation") === true);
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    if (e.origin.kind === "composer") {
      promptAt = Date.now();
      remember($);
    }
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


  // Under the prompt the engine's hint line draws, then the lines placed below it, in line_order. Among them are the
  // mod's own, one for each offer that holds: a fresh start once the cache is cold, a compaction once the smart zone is
  // nearly spent; and the explanation line, with the run-out warning when a limit runs out before it resets and the
  // explanation of a hovered tag. A draft in the prompt keeps them, as a reminder not to keep going. The fresh start waits while Claude works; the compaction does
  // not, for the command queues and runs once the session is idle. The offers have a button that hides them, for the
  // rest of the session or the dismiss_minutes option.
  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    const drawn = await next(e);
    const ui = $.ui.resolve(e);
    const rows = await drawLines($, ui, belowLines, e.props.isWorking);
    return rows.length === 0 ? drawn : ui.Box({ flexDirection: "column", children: [drawn, ...rows] });
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.surface !== "terminal" || e.props.hasSurvey) return next(e);
    const ui = $.ui.resolve(e);
    const rows = await drawLines($, ui, aboveLines, e.props.isWorking);
    if (rows.length === 0) return next(e);
    return ui.Box({ flexDirection: "column", paddingX: 1, children: rows });
  });
};

// Writes one of the mod's /config options, never another plugin's of the same name; a write loads the module again. Why
// it was not written, when it was not.
async function setOption($: EngineInterface, field: string, value: string | boolean): Promise<string | undefined> {
  // An installed copy is named for its marketplace too (cockpit@cc-mods, settings.json's pluginConfigs key). The list
  // leaves the hidden layout row out, so the key is any row of the mod's, its field swapped for this one.
  const own = (await $.config.list()).find((row) => /^cockpit(@|$)/.test(row.provider.plugin))?.key;
  return own ? (await $.config.set({ key: `${own.slice(0, own.lastIndexOf("."))}.${field}`, value })).deny : `no /config row ${field}`;
}

// Saves a colour typed in the colours pane into the colors option, as name=#rrggbb; an empty field, or the default typed
// out, drops the name, so the default stands. A colour that does not read writes nothing.
async function saveColor($: EngineInterface, option: unknown, name: ColorName, text: string): Promise<void> {
  const typed = text.trim();
  const rgb = rgbOf(typed);
  if (typed && !rgb) {
    $.ui.toast(`Cockpit colours: ${typed} is not a colour. Type six hex digits, as #22d3d8.`);
    return;
  }
  const saved = overridesOf(option);
  if (rgb && hex(rgb) !== hex(COLORS[name].rgb)) saved.set(name, rgb);
  else saved.delete(name);
  const value = [...saved].map(([key, c]) => `${key}=${hex(c)}`).join(",");
  if (value === (typeof option === "string" ? option : "")) return;
  const deny = await setOption($, "colors", value);
  if (deny) $.ui.toast(`Cockpit colours: ${deny}`);
}

// The named lines, in order, each as the elements it draws now (none for an offer that does not hold); a spacer is a
// blank line, and blank lines that meet, around an offer that does not hold or an empty row, draw as one. The
// explanation line always draws, so the blank lines around it never meet. While the order pane shows, every blank line
// draws, each row every tag, and an offer that does not hold, a row with no tags yet, or a blank explanation line, a
// dim line naming it in its place: a made-up offer would carry buttons that act.
async function drawLines($: EngineInterface, ui: Ui, names: (Row | Line | Spacer)[], isWorking: boolean) {
  // The panes not reading leaves the lines as they are.
  const ordering = (await $.ui.panes().catch(() => [])).some((pane) => pane.id === ORDER_PANE && pane.isShown);
  const drawn: ReturnType<Ui["Box"]>[] = [];
  let blank = false;
  for (const name of names) {
    if (name === SPACER && blank && !ordering) continue;
    const found =
      isRow(name) ? [await drawRow($, ui, name, ordering)]
      : name === SPACER ? [ui.Box({ height: 1 })]
      : name === "fresh" ? [isWorking ? undefined : await freshStartLine($, ui)]
      : name === "compact" ? [await compactLine($, ui)]
      : [await explainLine($, ui, ordering)];
    const empty = isRow(name) ? (name.some(isTag) ? undefined : "empty row: drop tags under its marker") : name === SPACER ? undefined : `${LABELS[name]}: shows when it applies`;
    if (ordering && empty && !found.some((line) => line !== undefined)) found.push(namingLine(ui, empty));
    for (const line of found) {
      if (line === undefined) continue;
      drawn.push(line);
      blank = name === SPACER;
    }
  }
  return drawn;
}

// The dim line the order pane draws in place of a line with nothing to show.
function namingLine(ui: Ui, text: string) {
  return ui.Box({ children: [ui.Text({ dimColor: true, children: `╌╌ ${text} ╌╌` })] });
}

// A row from the state, none until the first usage reading.
async function drawRow($: EngineInterface, ui: Ui, row: Row, ordering: boolean): Promise<ReturnType<Ui["Box"]> | undefined> {
  const s = await snapshotOf($, ordering);
  if (!s) return undefined;
  // A git tag draws nothing until the first git scan.
  const gitTag = s.git && gitParts(ui, s.git, s.pr);
  return rowOf(ui, row.map((name) => (isFiller(name) ? name : isGitTag(name) ? (gitTag ? gitTag(name) : []) : SEGMENTS[name](ui, s))));
}

// What the rows and the explanation line draw, read once by each, so an explanation always agrees with its tag; none
// until the first usage reading. Read every frame (the tick), so it moves live. While the order pane shows, the samples.
async function snapshotOf($: EngineInterface, ordering: boolean): Promise<Snapshot | undefined> {
  await $.state.get(TICK);
  const { value: usage } = await $.state.get(USAGE);
  if (!usage) return undefined;
  const { value: model = "" } = await $.state.get(MODEL);
  const { value: tokens } = await $.state.get(TOKENS);
  const { value: turns } = await $.state.get(TURNS);
  const { value: compactAt } = await $.state.get(COMPACT_AT);
  const { value: sent } = await $.state.get(SENT);
  const { value: git } = await $.state.get(GIT);
  const { value: pr } = await $.state.get(PR);
  const { value: rejected } = await $.state.get(REJECTED);
  const { value: readAt = 0 } = await $.state.get(READ);
  const { value: { k } = {} } = await $.state.get(PACE_K);
  const live: Snapshot = { usage, model, tokens, turns, compactAt, sent, git, pr, rejected, k, readAt, now: Math.floor(Date.now() / 1000), phase };
  return ordering ? withSamples(live) : live;
}

// While the order pane shows, a tag with nothing to show draws made-up values, so each one can be placed before it
// turns up during work: the limits, context, turns, costs and cache; a branch, worktree, commits ahead and behind, conflict and
// changes; a pull request with its review, comments and checks. The readings count as read now, so the limits show a pace.
function withSamples(s: Snapshot): Snapshot {
  const kinds = s.usage.rateLimits.map((r) => r.kind);
  const limit = (kind: string, percentUsed: number, seconds: number) => ({ kind, percentUsed, resetsAt: new Date((s.now + seconds) * 1000).toISOString() });
  const rateLimits = [...s.usage.rateLimits, ...[limit("seven_day", 40, 259_200), limit("five_hour", 20, 9_000)].filter((r) => !kinds.includes(r.kind))];
  const spend = (tokens: number, usd: number, requests: number) => ({ tokens, usd, requests, unpriced: 0 });
  const sampleAgents = { ...spend(300_000, 0.9, 8), count: 2 };
  // Unmerged, the subagents' tag shows made-up costs too until a subagent has run.
  const tokens = s.tokens ? { ...s.tokens, agents: s.tokens.agents.count > 0 || mergeCosts ? s.tokens.agents : sampleAgents } : { main: spend(1_200_000, 4.2, 30), agents: sampleAgents };
  const g = s.git;
  const moved = g && (g.ahead > 0 || g.behind > 0);
  const edited = g && (g.added > 0 || g.deleted > 0 || g.changed > 0);
  const pr: StatusPr = s.pr ?? { number: 42, url: "", failedUrls: [], state: "open", conflicting: false, review: "", comments: 0, checks: { pending: 0, failure: 0, success: 0 } };
  const checked = pr.checks.pending + pr.checks.failure + pr.checks.success > 0;
  return {
    ...s,
    readAt: s.now * 1000,
    usage: { context: { ...s.usage.context, tokens: s.usage.context.tokens ?? Math.round(s.usage.context.window * 0.3) }, rateLimits },
    turns: s.turns ?? 6,
    tokens: { ...tokens, cache: tokens.cache ?? { at: s.now * 1000, ttl: 3_600, read: 0.12, write: 1.5, prompt: 80_000, base: 20_000 } },
    git: g && {
      ...g,
      branch: g.branch || "feature",
      worktree: g.worktree || "spike",
      conflict: true,
      ...(moved ? {} : { ahead: 2, behind: 1 }),
      ...(edited ? {} : { added: 12, deleted: 3, changed: 2 }),
    },
    pr: {
      ...pr,
      review: pr.review || "APPROVED",
      comments: pr.comments || 3,
      ...(checked ? {} : { failedUrls: [""], checks: { pending: 1, failure: 1, success: 4 } }),
    },
  };
}

// A row of tags, each a list of parts, with spacers and gaps; nothing when no tag has a part. A run of spacers is one
// Box that grows by as many shares as it has spacers, down to no column. A gap is padding on the right of what stands
// before it, or a Box of its own at the row's start, so a wrapped line starts flush. A tag's parts stand a column
// apart; tags with neither between them touch. The gaps after the last tag are dropped: they part nothing, and would
// wrap a tag that fits.
// A tag with nothing to show folds with the gaps around it: between two drawn tags the widest of the gaps it split
// stays, so one column of each side's gap-1 is one column; against a spacer or the row's edge none stays.
// Too narrow for a row, it wraps between parts, as statusline.zsh's wrap_at did, rather than squeeze their glyphs.
// ponytail: no shrink steps; a single part wider than the line still gets squeezed.
function rowOf(ui: Ui, tags: (Parts | Filler)[]) {
  const items: { part?: Parts[number]; shares: number; pad: number }[] = [];
  let lead = 0;
  // The gap columns since the last tag or spacer drawn, split where a tag with nothing to show stood.
  let runs = [0];
  const place = (next: "tag" | "spacer") => {
    const last = items.at(-1);
    const columns = runs.length === 1 ? runs[0] ?? 0 : last?.part && next === "tag" ? Math.max(...runs) : 0;
    if (last) last.pad += columns;
    else lead += columns;
    runs = [0];
  };
  for (const tag of tags) {
    if (typeof tag === "string") {
      if (isSpacer(tag)) {
        place("spacer");
        const last = items.at(-1);
        if (last && !last.part) last.shares++;
        else items.push({ shares: 1, pad: 0 });
      } else {
        runs[runs.length - 1] = (runs.at(-1) ?? 0) + GAPS.indexOf(tag) + 1;
      }
    } else if (tag.length > 0) {
      place("tag");
      tag.forEach((part, i) => items.push({ part, shares: 0, pad: i < tag.length - 1 ? 1 : 0 }));
    } else {
      runs.push(0);
    }
  }
  if (!items.some((item) => item.part)) return undefined;
  const children = items.map(({ part, shares, pad }) =>
    part ? ui.Box({ flexShrink: 0, paddingRight: pad, children: [part] }) : ui.Box({ flexGrow: shares, paddingRight: pad }),
  );
  if (lead > 0) children.unshift(ui.Box({ flexShrink: 0, width: lead }));
  return ui.Box({ flexDirection: "row", flexWrap: "wrap", columnGap: 0, children });
}

function poll($: EngineInterface): void {
  void maybeKeepWarm($);
  void maybeHandoff($);
  void maybeCompact($);
  void $.session.usage().then((u) => setUsage($, u));
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
  const lead = cache.ttl === 3_600 && idleCompaction ? IDLE_COMPACT_LEAD_S : (PING_LEAD_S[cache.ttl] ?? 300);
  return left > 0 ? { ttl: cache.ttl, left, lead } : undefined;
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
    $.ui.toast(`cockpit: the ping that keeps the cache warm did not start: ${err instanceof Error ? err.message : err}`);
  }
}

// Runs the handoff skill when the session is idle, the cache still warm and within its lead of going cold. Only on an
// hour's TTL: a five-minute cache goes cold at every short pause, and rewriting it costs little. With keep_warm_pings
// on it runs on either TTL, after the last ping. The handoff's own request refreshes the cache, so it waits for the
// person's next prompt before it may run again. While that window is open, a gate that holds is written to the
// handoff trace, the one place to see why no handoff followed.
async function maybeHandoff($: EngineInterface): Promise<void> {
  if (!autoHandoff) return;
  const cache = await cacheClock($);
  if (!cache || cache.left > cache.lead || (cache.ttl !== 3_600 && keepWarm <= 0)) return;
  const no = (why: string) => traceHandoff($, `cache window open, no handoff: ${why}`);
  if (busy) return no("a turn is running");
  if (promptAt === 0) return no("no prompt of yours in this session");
  if (handoffAt >= promptAt) return no("a handoff already ran since your last prompt");
  const working = await agentsWorking($);
  if (working.length > 0) return no(`a subagent is at work: ${working.map((a) => `${a.type} ${a.status}`).join(", ")}`);
  if (await limitsNear($)) return no("a usage limit is nearly reached");
  // With pings on, the handoff waits for the last of them.
  if (keepWarm > 0 && (pingFor !== promptAt || pings < keepWarm || (await $.clock.now()) - pingAt < PING_GAP_MS)) return no("the keep-warm pings are not done");
  handoffAt = Date.now();
  remember($);
  traceHandoff($, `${Math.round(cache.left)} s of cache left, handoff started`);
  try {
    await $.command.run({ command: HANDOFF_COMMAND });
  } catch (err) {
    $.ui.toast(`cockpit: the handoff before the cache goes cold did not start: ${err instanceof Error ? err.message : err}`);
  }
}

// Runs /compact when the session is idle and the context has used COMPACT_HINT_AT of the smart zone, the point where
// the line offering it appears. Its own request counts, so it waits for the person's next prompt before it may run again.
async function maybeCompact($: EngineInterface): Promise<void> {
  if (!autoCompact || smartZone <= 0 || busy || compactedAt >= promptAt || (await agentsAtWork($))) return;
  const { value: usage } = await $.state.get(USAGE);
  if (usage?.context.tokens === undefined || usage.context.tokens < smartZone * COMPACT_HINT_AT || (await limitsNear($))) return;
  compactedAt = Date.now();
  remember($);
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
// cache again then anyway, and /clear would cut it off. So no handoff and no fresh start while one runs. Only a loop
// that has started or is about to counts: a `waiting` one is held on background work it owns, which is listed on its
// own, or on a plan's approval, which may never come, and would hold the handoff all night.
async function agentsAtWork($: EngineInterface): Promise<boolean> {
  return (await agentsWorking($)).length > 0;
}

async function agentsWorking($: EngineInterface) {
  return (await $.agent.list()).filter((a) => a.status === "pending" || a.status === "running");
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
      const row = parseJson(line);
      const hit = isRecord(row) && row.apiError === "usage_limit_reached" ? (row.quotaLimits ?? (isRecord(row.apiErrorParams) ? row.apiErrorParams.rate_limit_info : undefined)) : undefined;
      if (!isRecord(hit) || typeof hit.rateLimitType !== "string" || typeof hit.resetsAt !== "number") continue;
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
// shows only until the person's next prompt, which a handoff written while they were away has not met yet. A handoff
// that later requests have moved past is not offered, cold or warm: a fresh session from it would lose what came after.
async function freshStartLine($: EngineInterface, ui: Ui) {
  if (!freshStart || (await dismissed($, "fresh"))) return undefined;
  const { value: tokens } = await $.state.get(TOKENS);
  const { value: handoff } = await $.state.get(HANDOFF);
  const { value: sent } = await $.state.get(SENT);
  const c = tokens?.cache;
  if (!c || !handoff || Math.max(c.at, sent ?? 0) > handoff.at + HANDOFF_GRACE_MS) return undefined;
  const cold = cacheLeft(c, sent, Math.floor(Date.now() / 1000)) <= 0;
  if ((!cold && handoff.at < promptAt) || (await agentsAtWork($))) return undefined;
  // ponytail: priced at this conversation's write rate, the handoff at 4 bytes a token; the new session's system
  // prompt is likely read from a cache other sessions keep warm, so this is an upper bound.
  const fresh = c.write === undefined || c.prompt === 0 ? undefined : (c.write * (c.base + handoff.bytes / 4)) / c.prompt;
  // Offered only while it costs less than the next prompt here: once cold, the whole conversation written again; while
  // warm, read, at a 12.5th (5m, 0.1x) to an 80th (1h, Fable 5.1's 0.025x) of the write price, so a warm cache rarely loses. Unpriced, it cannot be weighed.
  const next = cold ? c.write : c.read;
  if (fresh === undefined || next === undefined || fresh >= next) return undefined;
  // A line of its own under the engine's, a red $ in the column of its mode glyph. The prices are the context; the
  // button names the action alone.
  return notice(ui, "$", color("cache.cold.from"), [
    ui.Text({ dimColor: true, children: cold ? ` Cache cold: next message ${usd(c.write)}, fresh start ~${usd(fresh)} ` : ` Handoff written: fresh start ~${usd(fresh)} ` }),
    button(ui, "resume", "main", "\uf15c", "Start fresh", () => void resumeFrom($, handoff.path)),
    dismissButton($, ui, "fresh"),
  ]);
}

// From the context having used COMPACT_HINT_AT of the smart zone on, the line that offers to compact: recall is precise
// only inside the zone, and a compaction swaps the conversation for its summary. Not drawn with no smart zone.
async function compactLine($: EngineInterface, ui: Ui) {
  const { Text, Link } = ui;
  const { value: usage } = await $.state.get(USAGE);
  const used = usage?.context.tokens;
  if (!compactHint || compacting || (await dismissed($, "compact")) || smartZone <= 0 || used === undefined || used < smartZone * COMPACT_HINT_AT) return undefined;
  return notice(ui, "\u25c6", color("notice"), [
    Text({ dimColor: true, children: used >= smartZone ? " You're out of the " : " You're nearly out of the " }),
    Link({ href: SMART_ZONE_URL, children: Text({ color: hex(color("notice")), underline: true, children: "Smart zone" }) }),
    Text({ dimColor: true, children: used >= smartZone ? `. Same model, ${DUMB_ZONE_DEPTHS.find(([upTo]) => used / smartZone < upTo)?.[1] ?? "very deep into"} the dumb zone now. ` : ". " }),
    button(ui, "compact", "main", "\uf066", "Compact", () => void compactSession($)),
    dismissButton($, ui, "compact"),
  ]);
}

// At the pace the window has run at since it began, as of the response that reported it: seconds from now until it
// reaches 100%, and until it resets. Nothing while it is on track, out already, early in its window, or its reading old.
function forecastOf(limit: (typeof LIMITS)[number], found: StatusLimit, readAt: number, now: number): { hitIn: number; left: number } | undefined {
  if (!found.resetsAt || found.percentUsed <= 0 || found.percentUsed >= 100) return undefined;
  const pace = paceOf(limit, found, readAt, now, 100);
  if (!pace) return undefined;
  const elapsed = pace.share * limit.seconds;
  const hitIn = (elapsed * (100 - found.percentUsed)) / found.percentUsed - (now - readAt) / 1000;
  const left = (Date.parse(found.resetsAt) - now) / 1000;
  return hitIn > 0 && hitIn < left ? { hitIn, left } : undefined;
}

// A limit's pace as of the response that reported it: r is the percent used over the share of the window passed times
// the target, 1 when the use reaches the target just as the window resets. `par` is that product as a share of the
// allowance, what the target would have used by now; at a target of 100% it is the share passed. Both windows begin at
// their reset time minus their length, the share counting nights and idle hours alike. None on the run-out warning's
// terms: no reset time, a stale reading, or too early in the window.
function paceOf(limit: (typeof LIMITS)[number], found: StatusLimit, readAt: number, now: number, target: number): { r: number; share: number; par: number } | undefined {
  if (!found.resetsAt || now - readAt > FORECAST_FRESH_MS) return undefined;
  const share = 1 - (Date.parse(found.resetsAt) - readAt) / 1000 / limit.seconds;
  if (!(share >= FORECAST_FROM)) return undefined;
  // target / 100 first: at 100 that is exactly 1, so the par is exactly the share and the lanes and notch draw as before.
  return { r: found.percentUsed / (share * target), share, par: share * (target / 100) };
}

// The explanation line: unlike the offers it takes a line whether or not it has something to show, and grows for text
// that wraps. With nothing to show it is blank, or while the order pane shows, a dim line naming it. Over it, hidden
// until its tag's hover scope is hovered, each shown tag's explanation.
async function explainLine($: EngineInterface, ui: Ui, ordering: boolean) {
  const shown = (await runOutWarning($, ui)) ?? (ordering ? namingLine(ui, `${LABELS.explain}: the run-out warning shows here`) : undefined);
  const s = await snapshotOf($, ordering);
  const texts = s ? explanations(s) : {};
  // Laid over the line after what it shows, on the grey, so a revealed explanation hides the warning beneath it: at
  // least as tall as the line, so every row of a wrapped warning, while a longer explanation runs on over what lies below.
  const grey = hex(color("empty"));
  const overlays = STATUS_ROW.flatMap((tag) => {
    const text = texts[tag];
    if (text === undefined || !isShown(tag)) return [];
    return [ui.Box({ position: "absolute", top: 0, left: 0, width: "100%", minHeight: "100%", display: "none", backgroundColor: grey, hover: { scope: explainScope(tag), display: "flex" }, children: [ui.Text({ backgroundColor: grey, children: text })] })];
  });
  return ui.Box({ key: "explain", flexDirection: "column", width: "100%", minHeight: 1, children: [...(shown ? [shown] : []), ...overlays] });
}

// Each status tag's explanation, for a tag the snapshot draws.
function explanations(s: Snapshot): Partial<Record<StatusTag, string>> {
  const out: Partial<Record<StatusTag, string>> = {};
  const t = s.tokens;
  const { context } = s.usage;
  for (const [tag, badge] of [["limit_7d", "7d"], ["limit_5h", "5h"]] as const) {
    const reading = limitOf(s, badge);
    if (!reading) continue;
    const { limit, found, left = 0 } = reading;
    const pace = limitStyle === "classic" ? undefined : reading.pace;
    // Rounded as the gauge's badge and the run-out warning round it.
    out[tag] = `${badge} limit: ${Math.round(found.percentUsed)}% used${left > 0 ? `, resets in ${countdown(left)}` : ""}.${pace ? ` ${paceWords(limit, pace.r)}` : ""}`;
  }
  if (context.tokens !== undefined && context.window > 0) {
    const usable = usableOf(context, s.compactAt);
    out.context = `Context: ${formatTokens(usable - context.tokens)} tokens left of ${formatTokens(usable)}.`;
  }
  if (s.turns !== undefined) {
    const { value, agents } = turnsOf(s.turns, t);
    out.turns = `Prompts sent${t ? " / the main session's requests for them" : ""}: ${value}.${agents ? ` Subagents run / their requests: ${agents}.` : ""}`;
  }
  if (t) {
    const { all, spend } = costsOf(t, mergeCosts);
    out.tokens = `${all ? "Main session and subagents" : "Main session"}: ${dollars(spend)} for ${formatTokens(spend.tokens)} tokens.`;
    if (t.agents.count > 0 && !all) out.agents = `Subagents: ${dollars(t.agents)} for ${formatTokens(t.agents.tokens)} tokens.`;
  }
  const c = t?.cache;
  if (c) {
    const left = cacheLeft(c, s.sent, s.now);
    out.cache =
      left > 0
        ? `Cache warm for ${warmFor(c, left)}: the next prompt reads it for ${usd(c.read)}. Once cold, writing it again costs ${usd(c.write)}.`
        : `Cache cold: the next prompt writes it again for ${usd(c.write)}.`;
  }
  return out;
}

// What a limit's pace r means: within 0.05 of 1 on pace; under it 1 - r of the target goes unused; over it the limit
// runs out with 1 - 1/r of the window to go, the run-out warning's time before the reset.
function paceWords(limit: (typeof LIMITS)[number], r: number): string {
  if (Math.abs(r - 1) <= 0.05) return "It is on pace to reach its target as it resets.";
  if (r < 1) return `At this pace it resets with ~${Math.round((1 - r) * 100)}% unused.`;
  return `At this pace it runs out ${countdown((1 - 1 / r) * limit.seconds)} before it resets.`;
}

// The run-out warning, for the limit that runs out soonest before it resets: the pace is the whole window's so far,
// idle nights included, so it is the one to plan by, not a burst's. Shown only while the session's reading is fresh.
async function runOutWarning($: EngineInterface, ui: Ui) {
  if (!limitForecast) return undefined;
  const { value: usage } = await $.state.get(USAGE);
  const { value: readAt = 0 } = await $.state.get(READ);
  const now = Date.now();
  const [first] = LIMITS.flatMap((limit) => {
    const found = usage?.rateLimits.find((r) => r.kind === limit.kind);
    const hit = found ? forecastOf(limit, found, readAt, now) : undefined;
    return found && hit ? [{ limit, found, hit }] : [];
  }).sort((a, b) => a.hit.hitIn - b.hit.hitIn);
  if (!first) return undefined;
  const { limit, found, hit } = first;
  return notice(ui, WARN_MARK, color("notice"), [
    ui.Text({ dimColor: true, children: ` ${limit.badge} at ${Math.round(found.percentUsed)}%: at this pace it runs out in ${countdown(hit.hitIn)}, ${countdown(hit.left - hit.hitIn)} before it resets.` }),
  ]);
}

// Whether the person dismissed this offer, and the dismissal still holds: for the rest of the session, or dismissFor ms.
async function dismissed($: EngineInterface, offer: Offer): Promise<boolean> {
  const { value } = await $.state.get(DISMISSED);
  const at = value?.[offer];
  return at !== undefined && (dismissFor === 0 || (await $.clock.now()) - at < dismissFor);
}

// The mod's drawing pieces, so each thing looks the same wherever it is drawn: panes, their sections, sentences that
// wrap, the offer and warning lines, and buttons.

// A pane: its title, bold, what it is for, dim, then what it holds, one under another.
function pane({ Box, Text }: Ui, title: string, about: string, children: Parts) {
  return Box({ flexDirection: "column", children: [Text({ bold: true, children: title }), Text({ dimColor: true, children: about }), ...children] });
}

// A section of a pane: a blank line, its heading, bold, and what it is for, dim, when it says.
function section({ Box, Text }: Ui, heading: string, about?: string): Parts {
  return [Box({ height: 1 }), Text({ bold: true, children: heading }), ...(about ? [Text({ dimColor: true, children: about })] : [])];
}

// Text and buttons on one line; too narrow for all of it, the text wraps and a button goes whole to the next line.
function sentence({ Box }: Ui, children: Parts) {
  return Box({ flexDirection: "row", flexWrap: "wrap", children });
}

// An offer or a warning: its mark in its colour, then the sentence.
function notice(ui: Ui, mark: string, rgb: RGB, children: Parts) {
  return sentence(ui, [ui.Text({ color: hex(rgb), children: mark }), ...children]);
}

// A button in the mod's own face, which it keeps whole: one Text, so a pointer over it inverts all of it, bars included.
// The half blocks are its first and last characters, the label's colour against the fill.
function button({ Box, Button, Text }: Ui, key: string, kind: "main" | "secondary", icon: string, label: string | undefined, onPress: () => void) {
  const look = buttonLook(kind);
  const face = Text({ color: hex(look.label), backgroundColor: hex(look.fill), children: `▌ ${icon}${label ? ` ${label}` : ""} ▐` });
  return Box({ flexShrink: 0, children: [Button({ key, plain: true, onPress, children: face })] });
}

// The secondary button after an offer's: hides the offer. The state is the session's, so a reload keeps it hidden.
function dismissButton($: EngineInterface, ui: Ui, offer: Offer) {
  return button(ui, "dismiss", "secondary", "\u2715", undefined, async () => {
    const { value } = await $.state.get(DISMISSED);
    await $.state.set(DISMISSED, { ...value, [offer]: await $.clock.now() });
    $.ui.invalidate("ui.render");
  });
}

async function compactSession($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: "compact" });
  } catch (err) {
    $.ui.toast(`cockpit: compacting failed: ${err instanceof Error ? err.message : err}`);
  }
}

// The cold cache's button: rather than write the whole conversation to the cache again, a fresh session that starts
// from the handoff file.
async function resumeFrom($: EngineInterface, path: string): Promise<void> {
  try {
    await $.command.run({ command: "clear" });
    await $.prompt.submit({ text: `Continue from the handoff in ${path}: read it, then pick up the work where it leaves off.`, asUser: true });
  } catch (err) {
    $.ui.toast(`cockpit: starting from the handoff failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function configDir($: EngineInterface): Promise<string> {
  return (await $.env.get("CLAUDE_CONFIG_DIR")) ?? `${await $.env.get("HOME")}/.claude`;
}

// A session's start, or a /clear's: the times the person's prompt stretched (none in a cleared session), the tick, and
// the first readings.
async function startSession($: EngineInterface): Promise<void> {
  const { value: stretch } = await $.state.get(STRETCH);
  ({ promptAt, handoffAt, compactedAt } = stretch ?? { promptAt: 0, handoffAt: 0, compactedAt: 0 });
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
    const steps = EFFORT_STEPS[String(effort)] ?? HIGH_STEPS;
    phase = (phase + (FRAME_MS / 1000) * steps * STEP_CYCLES_PER_SECOND) % 1;
    void $.state.set(TICK, Date.now());
    // Read every frame, so a /model switch shows within a frame instead of when the next turn ends.
    void $.session.model().then((model) => $.state.set(MODEL, model));
    void readTurns($);
    if (++frames % (POLL_MS / FRAME_MS) === 0) poll($);
    if (frames % (REJECTED_POLL_MS / FRAME_MS) === 0) refreshRejected($);
  }));
  try {
    idleCompaction = (await $.settings.read()).idleCompaction !== false;
  } catch {
    // The settings did not read: Claude Code's own default, on, stands.
  }
  await refresh($);
  refreshTokens($);
  refreshGit($);
  refreshRejected($);
}

async function refresh($: EngineInterface): Promise<void> {
  await setUsage($, await $.session.usage());
  await $.state.set(MODEL, await $.session.model());
  await readTurns($);
  await readCompactAt($);
}

// Every usage reading is written here, so each one also measures k.
async function setUsage($: EngineInterface, { context, rateLimits }: StatusUsage): Promise<void> {
  await $.state.set(USAGE, { context, rateLimits });
  await measureK($, rateLimits);
}

// k, the 7d percent that 1% of the 5h costs, from the 7d's rise over the 5h's since the first reading of this 5h
// window, the base. A new 5h window, or a 7d reset inside it, starts a new base and takes no sample. The latest sample
// stands. The reading is the one reported, not limitsOf's: a refusal's made-up reset time would start a new base.
async function measureK($: EngineInterface, rateLimits: StatusLimit[]): Promise<void> {
  const five = rateLimits.find((r) => r.kind === "five_hour");
  const seven = rateLimits.find((r) => r.kind === "seven_day");
  if (!five?.resetsAt || !seven?.resetsAt) return;
  const reading = { reset5h: Date.parse(five.resetsAt), reset7d: Date.parse(seven.resetsAt), p5: five.percentUsed, p7: seven.percentUsed };
  const { value: { k, base } = {} } = await $.state.get(PACE_K);
  const moved = (a: number, b: number) => Math.abs(a - b) >= RESET_MOVED_MS;
  if (!base || moved(reading.reset5h, base.reset5h) || moved(reading.reset7d, base.reset7d)) {
    await $.state.set(PACE_K, { k, base: reading });
    return;
  }
  const sample = (reading.p7 - base.p7) / (reading.p5 - base.p5);
  if (reading.p5 - base.p5 >= K_MIN_RISE && sample > 0) await $.state.set(PACE_K, { k: sample, base });
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
const PR_TRACE = { plugin: "cockpit", key: "prTrace" } as const;
const traceLog: string[] = [];
function trace($: EngineInterface, msg: string): void {
  traceLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  void $.state.set(PR_TRACE, traceLog.slice(-200));
}

// The handoff's gates while its window is open, read by the debug mod's /debug:handoff-trace pane. A line that repeats the
// last one is dropped, as the poll asks every 2 s.
const HANDOFF_TRACE = { plugin: "cockpit", key: "handoffTrace" } as const;
let lastHandoffTrace = "";
function traceHandoff($: EngineInterface, msg: string): void {
  if (msg === lastHandoffTrace) return;
  lastHandoffTrace = msg;
  void $.state.get(HANDOFF_TRACE).then(({ value = [] }) => $.state.set(HANDOFF_TRACE, [...value, `${new Date().toTimeString().slice(0, 8)} ${msg}`].slice(-200)));
}

// One run of a job at a time, in the background; a request during one runs it again once it ends.
function serial(name: string, job: () => Promise<void>, onSkip?: () => void, onError?: (err: unknown) => void): void {
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
    } catch (err) {
      // ponytail: a failed run keeps the last figures; only a job that passes onError reports why.
      onError?.(err);
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
    // so the git parts draw first. Nor is it asked while no shown part draws what it answers.
    const named = git.branch !== "" && git.branch !== "HEAD" && git.branch !== git.defaultBranch;
    const branch = named && !git.vsDefault && PR_TAGS.some(isShown) ? `${git.top}:${git.branch}` : "";
    const now = await $.clock.now();
    if (branch === prFor && now - prAt < (prBusy ? PR_BUSY_POLL_MS : PR_POLL_MS)) return;
    prFor = branch;
    prAt = now;
    const pr = branch ? await fetchPr($) : null;
    prBusy = (pr?.checks.pending ?? 0) > 0;
    trace($, `fetch branch=${branch || "-"} pr=${pr ? `#${pr.number} pending=${pr.checks.pending} ok=${pr.checks.success} fail=${pr.checks.failure}` : "null"}`);
    await $.state.set(PR, pr);
  }, () => trace($, "git job still running; poll folded into again"), (err) => trace($, `git job failed: ${err instanceof Error ? err.message : String(err)}`));
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
    const [label, ...rates] = line.split("|").slice(1, -1).map((c) => c.trim());
    if (label === undefined || rates.length < 5 || !line.includes("$")) continue;
    const key = label
      .replace(/\(.*/, "")
      .replace(/[*`]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[ .]/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!key.startsWith("claude-")) continue;
    const [i = 0, w5 = 0, w1 = 0, r = 0, o = 0] = rates.slice(0, 5).map((c) => Number((/\$([\d.,]+)/.exec(c)?.[1] ?? "").replace(/,/g, "")));
    if (!(i > 0 && o > 0)) continue;
    const over = /over ([\d,]+) tokens/.exec(label)?.[1];
    const known = out[key];
    if (over && known && !known.over) known.over = { above: Number(over.replace(/,/g, "")), rate: { i, w5, w1, r, o } };
    else if (!known) out[key] = { i, w5, w1, r, o };
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
    const parsed = parseJson(line);
    if (!isRecord(parsed)) return;
    const row: TranscriptRow = parsed;
    if (row.subtype === "compact_boundary" && !row.agentId) compactedAt = Math.max(compactedAt, Date.parse(row.timestamp ?? ""));
    const u = row.message?.usage;
    if (row.type !== "assistant" || !isRecord(u)) return;
    const model = String(row.message?.model ?? "");
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
      if (!last || at >= last.at) last = { at, prompt, model, speed: u.speed };
      if (!first || at < first.at) first = { at, prompt };
      if ((counts.w5 > 0 || counts.w1 > 0) && at >= ttlAt) {
        ttlAt = at;
        ttl = counts.w5 > 0 ? 300 : 3_600;
      }
    }
    spend.requests++;
    spend.tokens += counts.inp + counts.out + counts.read + counts.w5 + counts.w1;
    const usd = requestCost(model, u.speed, counts);
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
    ttl === 300 &&
    mains.some((m, i) => {
      const before = mains[i - 1];
      return before !== undefined && m.at - before.at > 300_000 && m.read >= 0.8 * before.prompt && !stamps.some((t) => t > before.at && t < m.at);
    });
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

  const [commonDir = "", gitDir = "", top = "", branch = "", upstream = ""] = (
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
  const [remote = ""] = track.split("/");
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
    const pr: GhPr | null = JSON.parse(stdout);
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
    const failed = (pr.statusCheckRollup ?? []).filter((c) => ["FAILURE", "ERROR"].includes(c.conclusion || c.state || ""));
    return {
      number: pr.number,
      url,
      failedUrls: failed.map((c) => c.detailsUrl || c.targetUrl || ""),
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
  if (from) return from[1] ?? "";
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
  const price = key === undefined ? undefined : prices?.[key];
  if (!price) return undefined;
  const prompt = c.inp + c.read + c.w5 + c.w1;
  const rate = price.over && prompt > price.over.above ? price.over.rate : price;
  const fast = speed === "fast" && (model.startsWith("claude-opus-5") || model.startsWith("claude-opus-4-8")) ? 2 : 1;
  return (fast * (c.inp * rate.i + c.out * rate.o + c.w5 * rate.w5 + c.w1 * rate.w1 + c.read * rate.r)) / 1_000_000;
}

// Two bars stacked in one row, depleting right to left as statusline.zsh's bars did: every cell is ▀,
// its glyph colour the top half (the window's time left), its background the bottom half (its usage left).
// A half past its bar's end is dim, so both bars show where 100% is.
function classicCells(Text: Ui["Text"], limit: (typeof LIMITS)[number], found: StatusLimit, timeLeft: number) {
  const n = barCells[limit.badge];
  const usageLeft = cells(100 - found.percentUsed, n);
  const { from, to } = stops(`limit.${limit.badge}`);
  const empty = color("empty");
  const parts = [];
  for (let i = 0; i < n; i++) {
    const lit = lerp(from, to, i, n);
    parts.push(
      Text({
        color: hex(i < timeLeft ? lit : empty),
        backgroundColor: hex(i < usageLeft ? lit : empty),
        children: "▀",
      }),
    );
  }
  return parts;
}

// Classic's two lanes with the top one the par left, what the target leaves of the allowance at the reading: the share
// of the window still to go at a target of 100%. Bottom cells lit past the par line are allowance the pace leaves
// unused, in slate; empty ones before it are spent ahead of pace, amber beside the line turning red away from it.
// Without a pace both lanes are dim, the top one classic's time left.
function lanesCells(Text: Ui["Text"], limit: (typeof LIMITS)[number], found: StatusLimit, timeLeft: number, pace: { par: number } | undefined) {
  const n = barCells[limit.badge];
  const par = pace ? cells(100 * (1 - pace.par), n) : timeLeft;
  const usageLeft = cells(100 - found.percentUsed, n);
  const { from, to } = stops(`limit.${limit.badge}`);
  const empty = color("empty");
  const parts = [];
  for (let i = 0; i < n; i++) {
    const lit = pace ? lerp(from, to, i, n) : color("pace.none");
    const bottom = i < usageLeft ? (pace && i >= par ? color("pace.under") : lit) : pace && i < par ? overPace(par - 1 - i, n) : empty;
    parts.push(Text({ color: hex(i < par ? lit : empty), backgroundColor: hex(bottom), children: "▀" }));
  }
  return parts;
}

// One full-height lane of the usage left, with a notch on the left edge of the cell after the par left, what the target
// leaves of the allowance at the reading, both rounded to the nearest cell; a par left that fills the lane puts the notch after its last cell. Lit cells past the notch are
// allowance the pace leaves unused, in slate; empty ones before it are spent ahead of pace, amber beside the notch
// turning red away from it. Without a pace the usage is dim and there is no notch.
function notchCells(Text: Ui["Text"], limit: (typeof LIMITS)[number], found: StatusLimit, pace: { par: number } | undefined) {
  const n = barCells[limit.badge];
  const usageLeft = Math.round(((100 - found.percentUsed) * n) / 100);
  const notch = pace ? Math.min(n, Math.round((1 - pace.par) * n)) : undefined;
  const { from, to } = stops(`limit.${limit.badge}`);
  const empty = color("empty");
  const mark = (rgb: RGB) => Text({ color: hex(color("pace.par")), backgroundColor: hex(rgb), children: "▏" });
  const parts = [];
  for (let i = 0; i < n; i++) {
    const lit = notch === undefined ? color("pace.none") : i < notch ? lerp(from, to, i, n) : color("pace.under");
    const fill = i < usageLeft ? lit : notch !== undefined && i < notch ? overPace(notch - 1 - i, n) : empty;
    parts.push(i === notch ? mark(fill) : Text({ color: hex(fill), backgroundColor: hex(fill), children: " " }));
  }
  if (notch === n) parts.push(mark(empty));
  return parts;
}

// The gauge: the pace, half the length, rounded down, on each side of a centre pipe. Under pace the left side fills
// outward from the pipe by the share of the target that goes unused, 1 - r; over pace the right side by the share of
// the window still to go when the limit runs out, 1 - 1/r, from amber at the pipe to red at the far end, so a worse
// pace reads redder. Each side fills in half cells. Without a pace every cell is blank and the pipe dim.
function gaugeCells(Text: Ui["Text"], limit: (typeof LIMITS)[number], pace: { r: number } | undefined) {
  const side = Math.floor(barCells[limit.badge] / 2);
  const under = pace !== undefined && pace.r < 1;
  const halves = pace === undefined ? 0 : Math.round((under ? 1 - pace.r : 1 - 1 / pace.r) * 2 * side);
  const empty = hex(color("empty"));
  // The j-th cell out from the pipe, `filled` halves out: whole, its half on the pipe's side, or blank.
  const cell = (filled: number, j: number, rgb: RGB, half: string) => {
    const glyph = filled >= 2 * j + 2 ? "█" : filled === 2 * j + 1 ? half : " ";
    return Text({ color: glyph === " " ? empty : hex(rgb), backgroundColor: empty, children: glyph });
  };
  const out = [...Array(side).keys()];
  return [
    ...[...out].reverse().map((j) => cell(under ? halves : 0, j, color("pace.under"), "▐")),
    Text({ color: hex(color(pace ? "pace.par" : "pace.none")), backgroundColor: empty, children: "│" }),
    ...out.map((j) => cell(under ? 0 : halves, j, overPace(j, side), "▌")),
  ];
}

// The over-pace colour j cells out from the par line, of n: amber beside it, turning red away from it.
function overPace(j: number, n: number): RGB {
  const { from, to } = stops("pace.over");
  return lerp(from, to, j, n);
}

// Σ what the main session cost and AGENT_MARK what its subagents did, each a chip; hovered, the explanation line shows
// the tokens behind it. Merged, the Σ chip holds both and the subagents' chip is left out.
function tokenParts(Box: Ui["Box"], Text: Ui["Text"], t: StatusTokens, merged: boolean) {
  const { agents } = t;
  const { all, spend } = costsOf(t, merged);
  const parts = [chipParts(Box, Text, { key: "tokens", mark: "Σ", value: dollars(spend), ...stops("costs") })];
  if (agents.count && !all) {
    parts.push(chipParts(Box, Text, { key: "agents", mark: AGENT_MARK, value: dollars(agents), ...stops("agents") }));
  }
  return parts;
}

// The Σ chip's spend: the main session's, or merged once a subagent has run (`all`), its subagents' added to it.
function costsOf(t: StatusTokens, merged: boolean): { all: boolean; spend: StatusSpend } {
  const { main, agents } = t;
  const all = merged && agents.count > 0;
  return { all, spend: all ? { ...main, tokens: main.tokens + agents.tokens, usd: main.usd + agents.usd, unpriced: main.unpriced + agents.unpriced } : main };
}

type Chip = { key: "turns" | "tokens" | "agents" | "cache"; mark: string; value: string; from: RGB; to: RGB };

// Two tags side by side, as a limit's badge sits against its bar: the mark on the darker stop in its contrast colour,
// then the value, a space each side, in a gradient from the lighter stop to the darker.
function chipParts(Box: Ui["Box"], Text: Ui["Text"], c: Chip) {
  const children = [
    Text({ color: hex(contrast(c.to)), backgroundColor: hex(c.to), children: ` ${c.mark} ` }),
    // The grey says hovering shows more: every chip has an explanation, which only the explanation line can show.
    run(Box, Text, ` ${c.value} `, (i, n) => lerp(c.from, c.to, i, n), undefined, explainRow ? color("empty") : undefined),
  ];
  return Box({ key: c.key, flexDirection: "row", hover: { scope: explainScope(c.key) }, children });
}

// statusline.zsh's REPO row: each segment a gradient one palette stop wide, starting at blue and stepping on per segment
// drawn. By default the PR's parts sit where zsh put them: number, draft, review and comments after the worktree,
// checks after the conflict; the layout moves them, into any row.
// Links: the folders open the folder on disk (the project's, the shell's), the branch and the worktree the checkout's,
// the PR its page; a click opens them as the terminal opens a link, in the default app.
function gitParts({ Box, Text, Link }: Ui, g: StatusGit, pr: StatusPr | null | undefined): (tag: GitTag) => Parts {
  const mark = g.vsDefault ? "?" : "";
  const c = pr?.checks;
  // A merged or closed pull request keeps only its number: its review, comments, conflict and checks no longer matter.
  const live = pr?.state === "open" || pr?.state === "draft";
  const folder = (path: string) => (path ? `file://${encodeURI(path)}` : undefined);
  const name = (path: string) => path.split("/").pop() || "~";
  const segments: Record<GitTag, (string | Piece[])[]> = {
    // The project root (where the session started, unless /cd moved it), then the shell's folder when it is elsewhere.
    folders: [[{ text: name(g.root), href: folder(g.root) }, ...(g.cwd === g.root ? [] : [{ text: " › " }, { text: name(g.cwd), href: folder(g.cwd) }])]],
    branch: [
      [
        {
          text: !g.branch
            ? ""
            : g.branch === g.defaultBranch
              ? g.branch
              : g.basedOff && g.basedOff !== g.defaultBranch && g.basedOff !== g.branch
                ? `⎇ ${g.basedOff} ⎇ ${g.branch}`
                : `⎇ ${g.branch}`,
          href: folder(g.top),
        },
      ],
    ],
    // Hidden when the branch already names it.
    worktree: [[{ text: g.worktree && !g.branch.includes(g.worktree) ? `⎇ ${g.worktree}` : "", href: folder(g.top) }]],
    // The number, and the draft mark beside it while the PR is one.
    pr: [[{ text: pr ? `PR #${pr.number}` : "", href: pr?.url || undefined, color: pr ? color(`pr.${pr.state}`) : undefined }], pr?.state === "draft" ? ` ${DRAFT_MARK}` : ""],
    review: [live ? (REVIEW_MARKS[pr?.review ?? ""] ?? "") : ""],
    comments: [pr && live && pr.comments > 0 ? ` ${COMMENT_MARK} ${pr.comments}` : ""],
    // Behind links the remote branch's history, newest first, where the commits not pulled yet sit on top. Ahead
    // links nothing: those commits exist only here.
    sync: [
      [
        { text: g.ahead > 0 ? `↑${g.ahead}${mark}` : "" },
        { text: g.ahead > 0 && g.behind > 0 ? " " : "" },
        { text: g.behind > 0 ? `↓${g.behind}${mark}` : "", href: g.web ? `${g.web}/commits/${encodeURI(g.base)}` : undefined },
      ],
    ],
    conflict: [g.conflict || (live && pr?.conflicting) ? ` ${WARN_MARK}` : ""],
    // Running and passed as counts, linking the PR's checks tab; each failure a cross of its own, linking its check.
    checks: [
      (() => {
        if (!c || !pr || !live) return [];
        const tab = pr.url ? `${pr.url}/checks` : undefined;
        const groups: Piece[][] = [
          c.pending > 0 ? [{ text: `${OCT_DOT}${c.pending}`, href: tab }] : [],
          pr.failedUrls.map((url) => ({ text: OCT_X, href: url || tab, color: color("pr.failed") })),
          c.success > 0 ? [{ text: `${OCT_CHECK}${c.success}`, href: tab }] : [],
        ].filter((g) => g.length > 0);
        return groups.flatMap((g, k): Piece[] => (k > 0 ? [{ text: " " }, ...g] : g));
      })(),
    ],
    changes: [(g.added > 0 ? ` +${g.added}` : "") + (g.deleted > 0 ? ` -${g.deleted}` : "") + (g.changed > 0 ? ` ~${g.changed}` : "")],
  };
  // Asked tag by tag in the row's order, so the palette steps on per part the row draws.
  let drawn = 0;
  return (tag) =>
    segments[tag]
      .map((t): Piece[] => (typeof t === "string" ? [{ text: t.trimStart() }] : t))
      .filter((pieces) => pieces.some((p) => p.text !== ""))
      .map((pieces) => {
        const i = drawn++;
        return linkRun(Box, Text, Link, pieces, (j, n) => (gradients ? lerp(stop(i + 1), stop(i + 2), j, n) : stop(i + 1)));
      });
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

// PROMPT_MARK the prompts sent / the model requests the main session made for them; hovered, the explanation line adds
// the same for its subagents.
function turnParts(Box: Ui["Box"], Text: Ui["Text"], turns: number, t: StatusTokens | undefined) {
  return chipParts(Box, Text, { key: "turns", mark: PROMPT_MARK, value: turnsOf(turns, t).value, ...stops("turns") });
}

// The turns tag's value, and once a subagent has run, AGENT_MARK how many ran / the requests they made. The requests
// come with the token scan, so until it has run the prompts stand alone.
function turnsOf(turns: number, t: StatusTokens | undefined): { value: string; agents?: string } {
  return { value: t ? `${turns} / ${t.main.requests}` : String(turns), agents: t?.agents.count ? `${AGENT_MARK} ${t.agents.count} / ${t.agents.requests}` : undefined };
}

// Warm: the time left before the cache expires and what the next prompt's cached prefix costs read; hovered, the
// explanation line adds what it costs once cold. Cold: the cost of writing it again. Each request that hits the cache
// restarts its TTL.
// The mark is a moon with a quarter of its fill gone for each quarter of the TTL that has passed, and empty once cold.
function cacheParts(Box: Ui["Box"], Text: Ui["Text"], c: StatusCache, now: number, sent: number | undefined) {
  const left = cacheLeft(c, sent, now);
  const mark = MOON[left > 0 ? Math.min(Math.ceil((left * 4) / c.ttl), 4) : 0] ?? "●";
  return left > 0
    ? chipParts(Box, Text, { key: "cache", mark, value: `${warmFor(c, left)} ${usd(c.read)}`, ...stops("cache.warm") })
    : chipParts(Box, Text, { key: "cache", mark, value: `cold ${usd(c.write)}`, ...stops("cache.cold") });
}

// The time a warm cache has left, `left` seconds. The first second after a request has the whole TTL left, which reads
// 1h0m (5m on a short cache) before the next second reads 59m (4m): one second short of the TTL reads the same from the start.
function warmFor(c: StatusCache, left: number): string {
  return countdown(Math.min(left, c.ttl - 1));
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

// A bar's length option in whole cells, at least 1; anything but a number is the default.
function lengthOf(option: unknown, fallback: number): number {
  return typeof option === "number" ? Math.max(1, Math.floor(option)) : fallback;
}

// The whole cells a percentage covers, floored so a bar only reads full at 100%.
function cells(pct: number, n: number): number {
  return Math.min(Math.max(Math.floor((pct * n) / 100), 0), n);
}

// The context window drawn as the limits draw theirs, its meaning as statusline.zsh's: the top half is the smart zone
// left (the first `smart` tokens, where recall is precise), the bottom half the window left before auto-compaction;
// past it the bottom refills red, a full bar per 25% over. With no smart zone (`smart` 0) each cell is one full-height
// block of the window left, the glyph a moon filling across the whole window. Cells run red to green across the bar (zsh's _sl_gyr_ramp),
// and the badge is zsh's recall-zone glyph on the colour of the percentage used. Hovered, the explanation line shows the
// tokens left (zsh's ↻).
function contextParts(Box: Ui["Box"], Text: Ui["Text"], context: StatusUsage["context"], limit: number | undefined, smart: number) {
  if (context.tokens === undefined || context.window <= 0) return [];
  const n = barCells.context;
  const usable = usableOf(context, limit);
  const current = context.tokens;
  const remaining = usable - current;
  const pct = Math.min(Math.floor((current * 100) / usable), 150);
  const overflow = remaining < 0;
  const bottom = overflow ? Math.min(Math.floor(((pct - 100) * n) / 25), n) : cells(100 - pct, n);
  const top = smart > 0 ? cells(((smart - Math.min(current, smart)) * 100) / smart, n) : 0;
  const badgeBg = overflow ? color("context.over") : ramp(Math.min(pct, 100));
  const badge = ` ${contextIcon(current, usable, remaining, smart)} `;
  const empty = color("empty");
  const parts = [Text({ color: hex(contrast(badgeBg)), backgroundColor: hex(badgeBg), children: badge })];
  for (let i = 0; i < n; i++) {
    const lit = ramp(Math.trunc(((n - 1 - i) * 100) / n));
    const under = i < bottom ? (overflow ? color("context.over") : lit) : empty;
    parts.push(Text({ color: hex(smart <= 0 ? under : i < top ? lit : empty), backgroundColor: hex(under), children: "▀" }));
  }
  return [Box({ key: "context", flexDirection: "row", hover: { scope: explainScope("context") }, children: parts })];
}

// The tokens the context runs to: the auto-compaction limit the session reports, else the whole window.
function usableOf(context: StatusUsage["context"], limit: number | undefined): number {
  return limit && limit > 0 ? limit : context.window;
}

// Ported from statusline.zsh's sl_calc_context_icon: the glyph says the recall zone, not the fill. Up to `smart`
// tokens a diamond (◇ then ◆ past half), above it a moon filling from `smart` to the usable limit (○ ◔ ◑ ◕ ●),
// past the limit ⊙.
function contextIcon(current: number, usable: number, remaining: number, smart: number): string {
  if (remaining < 0) return "⊙";
  if (current <= smart) return current * 2 < smart ? "◇" : "◆";
  const span = usable - smart;
  if (span <= 0) return "●";
  return MOON[Math.min(Math.floor(((current - smart) * 5) / span), 4)] ?? "●";
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
  const mix = (from: number, to: number) => from + Math.trunc(((to - from) * pct) / 100);
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
}

// A gradient sliding along the text: each glyph's place, shifted by the phase, folded into a there-and-back sweep so the loop has no seam.
function sweep(a: RGB, b: RGB, i: number, n: number, phase: number): RGB {
  const t = (i / n + phase) % 1;
  return lerp(a, b, Math.round((t < 0.5 ? t * 2 : 2 - t * 2) * 100), 101);
}

// Mirrors _sl_gyr_ramp: low to mid at 50%, then to high, on a whole percentage. Without gradients the nearest of the three.
function ramp(pct: number): RGB {
  const [low, mid, high] = [color("context.low"), color("context.mid"), color("context.high")];
  if (!gradients) return pct < 25 ? low : pct < 75 ? mid : high;
  return pct <= 50 ? lerp(low, mid, pct * 2, 101) : lerp(mid, high, (pct - 50) * 2, 101);
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
  const [, family = "", major = "", minor] = m;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

// Matches the family anywhere in the name, so an ID, a display name or an alias all find it;
// an unknown family sweeps cyan to purple.
function modelStyle(model: string): ModelStyle {
  const style = Object.entries(modelStyles()).find(([family]) => model.toLowerCase().includes(family))?.[1];
  return style ?? { from: stop(0), to: gradients ? stop(2) : stop(0) };
}
