import type { AgentInfo, AgentStatus, CommandRunResult, ConfigRow, ConfigValue, On, SessionContextBreakdown, SessionContextUsage, SessionRateLimit, TurnUsage } from "claude-code";
import { describe, type Engine, expect, type FoundElement, type Mounted, type MockClock, mock, test as kitTest, type TestRest } from "claude-code/testing";
import type { StatusCredits } from "../types";

// The host has a console too, which the API's globals leave out.
declare const console: { log: (...data: unknown[]) => void };
// The tests run in a random order, so one that counts on another's leftovers fails. The kit has no shuffle and the host
// no environment to pass a seed in: the log names each run's seed.
const seed = Math.floor(Math.random() * 2 ** 32); // a logged seed here replays its order
const queued: [string, TestRest][] = [];
const test = (name: string, ...rest: TestRest) => void queued.push([name, rest]);
// A seeded generator of [0, 1), an LCG, so an order replays.
function shuffled<T>(items: T[]): T[] {
  let s = seed;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

// The test host has setTimeout, but the API's globals leave it out; a test waits on it for the hooks it started.
declare function setTimeout(handler: () => void, ms: number): unknown;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

// A prompt typed at the composer, as the person sends one.
const typeAtComposer = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: "composer" } });
// What the host hands a pane and a band besides the mod's own props.
const SITE = { scroll: { offset: 0, bodyRows: 24 }, view: {} };
// A drawn element, or the tree a Client's module drew, as findAll hands it back: its children are elements and strings.
type Drawn = { props: Record<string, unknown>; children: unknown[] };
const isDrawn = (node: unknown): node is Drawn => typeof node === "object" && node !== null && "props" in node && "children" in node;
const elements = (nodes: readonly unknown[]): Drawn[] => nodes.filter(isDrawn);
// The text a drawn tree spells; a one-glyph Text reads as that glyph.
const flat = (node: unknown): string => (typeof node === "string" ? node : isDrawn(node) ? node.children.map(flat).join("") : "");
// Which halves of each ▀ cell are lit: B both, T the top (the glyph colour), U the bottom (the background), _ neither.
// A dim half is #373a48.
const litCells = (cells: readonly unknown[]): string =>
  elements(cells)
    .map(({ props }) => {
      const top = props.color !== "#373a48";
      const bottom = props.backgroundColor !== "#373a48";
      return top && bottom ? "B" : top ? "T" : bottom ? "U" : "_";
    })
    .join("");
const glyph = (text: FoundElement): unknown => text.children[0] ?? text.text;
// What the explanation line shows in its flow, the hidden explanations laid over it left out.
const shownIn = (line: FoundElement) => elements(line.children).filter((child) => child.props.position !== "absolute").map(flat).join("");
// The seven tags an explanation stands behind, by the scope each joins and the key its Box draws with.
const EXPLAINED = [["limit_7d", "seven_day"], ["limit_5h", "five_hour"], ["context", "context"], ["turns", "turns"], ["tokens", "tokens"], ["agents", "agents"], ["cache", "cache"]] as const;
// A tag's keyed Box as drawn, its hover included, which FoundElement.props leaves out.
const drawnTag = async (ui: { findAll: Mounted["findAll"] }, key: string) => {
  for (const box of await ui.findAll({ type: "Box" })) {
    const tag = elements(box.children).find((child) => child.props.key === key);
    if (tag) return tag;
  }
  throw new Error(`the ${key} tag did not draw`);
};
// The hover group a drawn Box joins.
const scopeOf = (node: object): unknown => {
  const hover: unknown = "hover" in node ? node.hover : undefined;
  return typeof hover === "object" && hover !== null && "scope" in hover ? hover.scope : undefined;
};
// The explanation line's explanations: the Boxes laid over it, after what it shows in its flow.
const explanationsIn = async (ui: { find: Mounted["find"] }) => elements(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line").children).filter((child) => child.props.position === "absolute");
// One tag's explanation as the explanation line holds it, hidden or not.
const explanationOf = async (ui: { find: Mounted["find"] }, tag: string) => flat((await explanationsIn(ui)).find((e) => scopeOf(e) === `explain-${tag}`));
// The rows of tags: the wrapping Boxes with a gap between their tags, not the offer lines, which wrap with none.
const tagRows = async (ui: { findAll: Mounted["findAll"] }) => (await ui.findAll({ type: "Box" })).filter((b) => b.props.flexWrap === "wrap" && b.props.columnGap !== undefined);
// An element with no children of its own (a spacer, a blank line) is drawn with its props alone.
const leaves = (nodes: readonly unknown[]) => nodes.filter((node): node is { props: Record<string, unknown> } => typeof node === "object" && node !== null && "props" in node);
// What a row draws, a spacer run as "<n" for the shares it grows by, any other part as its text, and the columns after
// each as "_n": the gaps, and the column between a tag's parts. A gap at the row's start is a Box of its own.
const rowSpelled = (row: FoundElement | undefined) =>
  leaves(row?.children ?? []).flatMap(({ props, ...part }) => {
    const pad = typeof props.paddingRight === "number" && props.paddingRight > 0 ? [`_${props.paddingRight}`] : [];
    if (typeof props.width === "number") return [`_${props.width}`];
    return [typeof props.flexGrow === "number" ? `<${props.flexGrow}` : flat({ props, ...part }).trim(), ...pad];
  });
// The layout option's rows as by default, and a layout with one row in place of its default. The git row draws above
// the prompt, the status row and the offers under it.
const GIT = "folders,gap-1,branch,gap-1,worktree,gap-1,pr,gap-1,review,gap-1,comments,gap-1,sync,gap-1,conflict,gap-1,checks,gap-1,changes";
const STATUS = "model,gap-1,limit_7d,gap-1,limit_5h,gap-1,credits,gap-1,context,gap-1,turns,gap-1,tokens,gap-1,agents,gap-1,cache";
const withGit = (row: string, hidden = "") => `${row};prompt;${STATUS};fresh;compact;explain${hidden ? `;hidden;${hidden}` : ""}`;
const withStatus = (row: string, hidden = "") => `${GIT};prompt;${row};fresh;compact;explain${hidden ? `;hidden;${hidden}` : ""}`;
// A query the test counts on finding.
function must<T>(found: T | undefined, what: string): T {
  if (found === undefined) throw new Error(`${what} did not draw`);
  return found;
}
// A summary breakdown for a window and what is in it; auto-compaction starts at `threshold`, or is off when none is given.
// The mod reads the threshold, whether it is on, and the raw window; the rest fills the type as its docs define it.
const breakdownOf = (window: number, used: number, threshold?: number) =>
  ({
    categories: [],
    totalTokens: used,
    maxTokens: window,
    rawMaxTokens: window,
    autocompactSource: "model-default",
    percentage: Math.round((used * 100) / window),
    gridRows: [],
    model: "claude-opus-5-5",
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    ...(threshold === undefined ? { isAutoCompactEnabled: false } : { isAutoCompactEnabled: true, autoCompactThreshold: threshold }),
    apiUsage: null,
  }) satisfies SessionContextBreakdown;
const subagent = (status: AgentStatus): AgentInfo => ({ id: "a1", description: "d", type: "Explore", status });

// Numbers from the screenshot this mod replaces: 797.1K tokens in a 1M window,
// 5h resetting in 2h56m, 7d resetting in 1d1h, $635.27, Opus 5.5.
// Anthropic's pricing table as the page serves it, USD per million tokens.
const md = [
  "| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |",
  "| :-- | :-- | :-- | :-- | :-- | :-- |",
  "| Claude Fable 5.1 | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok<sup>1</sup> | $50 / MTok |",
  "| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |",
  "| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |",
  "| Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok | $10 / MTok |",
  "| Claude Sonnet 5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok |",
  "| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |",
  "| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |",
].join("\n");

// The time a test's clock starts at, so every run sees the same time; the time zone stays the machine's. On a whole UTC
// hour, every zone's local clock reads a whole or quarter hour, never the last minute before one, where a reset named by
// the hour would round across it.
const START = Date.parse("2026-10-27T12:00:00Z");
// The clock a test's `on` answers the mod's time from. The kit takes one registration per test, so the first call makes it, at
// `now` (the real time when not given), and every later call returns that same clock. The real time is read only when
// the clock is made, so a later call reads no machine clock.
const clocks = new WeakMap<On, MockClock>();
function clockOn(on: On, now?: number): MockClock {
  let clock = clocks.get(on);
  if (!clock) {
    clock = mock.clock(on, { now: now ?? Date.now() });
    clocks.set(on, clock);
  }
  return clock;
}
// Settling the clock finishes the mod's unawaited work, but its $.state writes draw only at the redraw rate: draw `ui` now.
async function caughtUp(on: On, ui: { redraw: () => Promise<void> }): Promise<void> {
  await clockOn(on).settle();
  await ui.redraw();
}
// The status row draws under the prompt, below the engine's hint line, which a test stands in for: before its first
// call of $, as the kit requires. It registers the test's clock, so a test's own start for it goes here.
// The band above the prompt draws nothing of its own until the mod's git row has something to show.
function stubHint(on: On, now?: number): void {
  clockOn(on, now);
  on("ui.render", { component: "PromptHint" }, ($, e) => $.ui.resolve(e).Text({ children: "? for shortcuts" }));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "" }));
}
function mountHint($: Engine, isDraft = false): Promise<Mounted<"terminal", "PromptHint">> {
  return $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "PromptHint", props: { isDraft, isWorking: false, hint: "? for shortcuts" } });
}
// A session started with these limits. By default the 5h is at 70% with 2 hours to its reset, 3 hours into its 5: at that
// pace it runs out in 1h17m, 42m before it resets.
async function startWithLimits($: Engine, on: On, rateLimits?: SessionRateLimit[]): Promise<void> {
  const now = clockOn(on).now();
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: rateLimits ?? [{ kind: "five_hour", percentUsed: 70, resetsAt: new Date(now + 120 * 60_000).toISOString() }] } }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
}

// A session idle with its cache 3 minutes from cold: the commands the mod runs over 2 polls (none, before the
// person's first prompt is asserted), then a prompt typed at the composer, then 3 polls more.
async function handoffRuns($: Engine, on: On, { model = "claude-opus-5-5", rateLimits = [], ttl = "1h", agents = [], after = 3, trace = [], settings = {}, ago = 57, reloaded = false }: { model?: string; rateLimits?: SessionRateLimit[]; ttl?: string; agents?: AgentInfo[]; after?: number; trace?: string[]; settings?: Record<string, unknown>; ago?: number; reloaded?: boolean } = {}): Promise<string[]> {
  stubHint(on, START);
  // An hour-TTL write 57 minutes ago: 3 minutes left, inside the 5-minute lead. A five-minute write 3 minutes ago has 2 left;
  // "5m-late", 4.5 minutes ago, has 30 seconds, inside the 1-minute lead of a five-minute cache.
  const clock = clockOn(on);
  const ran: string[] = [];
  // "5m-held": written for five minutes, yet read back whole after ten idle ones, 57 minutes ago: it outlived its label.
  const written = { ephemeral_5m_input_tokens: ttl === "5m" || ttl === "5m-late" ? 1_000_000 : 0, ephemeral_1h_input_tokens: ttl === "1h" ? 1_000_000 : 0 };
  const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: written };
  const row = (id: string, minutesAgo: number, u: object) =>
    JSON.stringify({ type: "assistant", requestId: id, timestamp: new Date(START - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage: u } });
  const transcript =
    ttl === "5m-held"
      ? [
          row("r0", 67, { ...usage, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } }),
          row("r1", 57, { ...usage, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 0 } }),
        ].join("\n")
      : row("r1", ttl === "1h" ? ago : ttl === "5m-late" ? 4.5 : 3, usage);
  // The handoff trace as the mod last wrote it.
  let traced: string[] = [];
  on("state.set", { plugin: "cockpit", key: "handoffTrace" }, ($, e, next) => {
    traced = Array.isArray(e.value) ? e.value.map(String) : [];
    return next(e);
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits } }));
  on("session.model", () => ({ value: model }));
  on("session.id", () => ({ value: "sid-1" }));
  on("settings.read", () => ({ value: settings }));
  on("agent.list", () => ({ value: agents }));
  on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
  on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
  on("process.spawn", async function* () {
    yield { stream: "stdout", text: transcript };
    return { value: { code: 0, signal: null } };
  });
  on("command.run", (_$, e) => {
    ran.push(e.command);
    return { text: "" };
  });
  // A prompt the mod submits itself is a ping.
  on("prompt.submit", (_$, e) => {
    if (e.origin.kind === "plugin") ran.push("ping");
    return { text: e.text };
  });

  // A module loaded again after the person's prompt finds its times in the session's state.
  if (reloaded) on("state.get", { plugin: "cockpit", key: "stretch" }, () => ({ value: { value: { promptAt: START - 60_000, handoffAt: 0, compactedAt: 0 }, version: 1 } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const ui = await mountHint($);
  await caughtUp(on, ui);
  const polls = async (n: number) => {
    for (let i = 0; i < n; i++) await clock.advance(2_000);
  };

  // No prompt of the person's since the mod loaded: nothing runs.
  if (!reloaded) {
    await polls(2);
    expect(ran).toEqual([]);
    // A prompt typed at the composer: the next poll runs the handoff, and the ones after it do not run it again.
    await typeAtComposer($, "hi");
  }
  await polls(after);
  trace.push(...traced);
  await ui.unmount();
  return ran;
}

describe("cockpit", () => {
  test("draws the status row under the prompt", async ($, on) => {
    stubHint(on, START);
    const now = clockOn(on).now();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        // Auto-compaction at 900,000 tokens, as Claude Code's summary breakdown reports it.
        context: { tokens: 797_100, window: 1_000_000, breakdown: breakdownOf(1_000_000, 797_100, 900_000) },
        rateLimits: [
          { kind: "five_hour", percentUsed: 40, resetsAt: new Date(now + 10_560_000).toISOString() },
          { kind: "seven_day", percentUsed: 20, resetsAt: new Date(now + 90_030_000).toISOString() },
          { kind: "seven_day_fable", percentUsed: 86 },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    // 797,100 tokens is past the smart zone, so the line offering a compaction asks which subagents run.
    on("agent.list", () => ({ value: [] }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);

    // The model name is one Text per glyph, so only its first glyph is matchable here.
    expect(await ui.find({ type: "Text", text: "O" })).toBeDefined();
    // Hovered, each limit's reset by its clock time.
    expect(await explanationOf(ui, "limit_7d")).toMatch(new RegExp(`^7d at 20%: it resets at ${CLOCK}\\.$`));
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 40%: it resets at ${CLOCK}\\.$`));
    // A window the mod has no bar for shows as its name and percentage.
    expect(await ui.find({ type: "Text", text: "seven_day_fable 86%" })).toBeDefined();
    // The context bar against the 900,000-token compaction threshold: 797,100 used is 88%, so 1 of 10 cells of window
    // left underneath; past the 200,000-token smart zone, none on top. 597,100 of the 700,000 between the smart zone
    // and the threshold is 85%: the full moon. The threshold comes after the first draw, which measures the whole window.
    expect(await contextBar(on, ui)).toEqual({ badge: " ● ", lit: "U_________" });
    // Hovered, the 102,900 tokens left.
    expect(await explanationOf(ui, "context")).toContain("102.9K");
    // A row wraps between segments, none of which shrinks, so a narrow terminal never squeezes a glyph out; a gap is
    // padding after a tag, so a wrapped line starts flush.
    const rows = await tagRows(ui);
    expect(rows).toHaveLength(1);
    expect(elements(rows[0]?.children ?? []).every((part) => part.props.flexShrink === 0 && part.props.paddingLeft === undefined)).toBe(true);
    await ui.unmount();
  });

  test("leaves out a hidden tag, and draws tags with no gap between them touching", { options: { layout: withStatus("model,limit_5h,context,turns,tokens,cache", "limit_7d") } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [{ kind: "seven_day", percentUsed: 20, resetsAt: new Date(Date.now() + 90_030_000).toISOString() }] },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    expect(await ui.find({ type: "Text", text: "O" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /1d1h/ })).toBeUndefined();
    const rows = await tagRows(ui);
    expect(rows).toHaveLength(1);
    expect(rowSpelled(rows[0]).map((part) => part.slice(0, 1))).toEqual(["O", "◇"]);
    await ui.unmount();
  });

  test("parts the status row's tags by the gaps it names, and a spacer first draws it against the right edge", { options: { layout: withStatus("spacer,model,gap-2,limit_7d,gap-3,limit_5h,context,turns,tokens,cache") } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const rows = await tagRows(ui);
    // No limit reading yet: the limits draw nothing and fold with the gaps around them, the widest staying.
    expect(rowSpelled(rows[0]).slice(0, 3)).toEqual(["<1", "Opus 5.5", "_3"]);
    expect(rowSpelled(rows[0])).not.toContain("_2");
    await ui.unmount();
  });

  test("starts each row at the left edge by default: no spacer", async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const rows = await tagRows(ui);
    // The default order parts each tag from the next by one column.
    expect(rowSpelled(rows[0]).slice(0, 2)).toEqual(["Opus 5.5", "_1"]);
    expect(rowSpelled(rows[0]).some((part) => part.startsWith("<"))).toBe(false);
    await ui.unmount();
  });

  // The spacers share the room the tags leave: a run of two takes two shares, so it pushes twice as hard as one. A tag
  // that draws nothing (the costs and cache, before a token scan) leaves the spacers around it to meet.
  for (const [order, spelled] of [
    // model costs || limits | turns || cache context
    ["model,tokens,spacer,spacer,limit_7d,limit_5h,spacer,turns,spacer,spacer,cache,context", ["Opus 5.5", "<2", "7d", "5h", "<1", "⏎", "<2", "◇"]],
    // model limits context | turns costs cache
    ["model,limit_7d,limit_5h,context,spacer,turns,tokens,cache", ["Opus 5.5", "7d", "5h", "◇", "<1", "⏎"]],
    // model 7d | 5h, the tags left out each after the one before it in the default order: context, turns, costs, cache.
    ["model,limit_7d,spacer,limit_5h", ["Opus 5.5", "7d", "<1", "5h", "◇", "⏎"]],
  ] as const) {
    test(`draws ${order.replaceAll(",spacer", " |").replaceAll(",", " ")} with its spacers as shares of the room`, { options: { layout: withStatus(order) } }, async ($, on) => {
      stubHint(on);
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      const resetsAt = new Date(Date.now() + 90_030_000).toISOString();
      on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [{ kind: "seven_day", percentUsed: 20, resetsAt }, { kind: "five_hour", percentUsed: 10, resetsAt }] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      on("session.turns", () => ({ value: 3 }));
      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
      const ui = await mountHint($);
      // A tag spelled by its first glyphs: a limit by its badge, the context by its icon, the turns by mark and count.
      const short = (part: string) => (part.startsWith("<") || part === "Opus 5.5" ? part : /^(7d|5h)/.exec(part)?.[0] ?? (part.startsWith("◇") ? "◇" : part.split(/\s+/)[0] ?? part));
      const row = (await tagRows(ui))[0];
      expect(rowSpelled(row).map(short)).toEqual(spelled);
      await ui.unmount();
    });
  }

  test("draws each row on its side of the prompt in the layout", { options: { layout: `${STATUS};prompt;${GIT};fresh;compact;explain` } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Text", text: "O" })).toBeDefined();
    await above.unmount();
    const below = await mountHint($);
    expect(await below.find({ type: "Text", text: "O" })).toBeUndefined();
    await below.unmount();
  });

  // Any tag goes in any row: the folder, a git part, beside the model under the prompt.
  test("draws a git part and a status tag in one row", { options: { layout: "prompt;model,gap-1,folders;fresh;compact;explain;hidden;branch,worktree,pr,review,comments,sync,conflict,checks,changes,limit_7d,limit_5h,context,turns,tokens,cache" } }, async ($, on) => {
    stubHint(on, START);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/work" }));
    on("session.cwd", () => ({ value: "/work" }));
    on("process.run", () => ({ value: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository", isStdoutTruncated: false, isStderrTruncated: false } }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["Opus 5.5", "_1", "work"]);
    await ui.unmount();
  });

  test("draws the smart zone left on top of the context bar, sized by the smart_zone_tokens option", { options: { smart_zone_tokens: 100_000 } }, async ($, on) => {
    stubHint(on, START);
    // 50,000 of a 1,000,000 window with no compaction threshold reported: 5% used, 9 cells of window left underneath;
    // half of the 100,000-token smart zone left, 5 cells on top; past half of it, the filled diamond.
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const context = must(await ui.find({ type: "Box", key: "context" }), "the context chip");
    expect(flat(context.children[0])).toBe(" ◆ ");
    expect(litCells(context.children.slice(1))).toBe("BBBBBUUUU_");
    expect(await explanationOf(ui, "context")).toContain("950.0K");
    await ui.unmount();
  });

  test("draws the context bar as full-height blocks of the window left with the smart_zone option off", { options: { smart_zone: false } }, async ($, on) => {
    stubHint(on, START);
    // 300,000 of a 1,000,000 window: 30% used, 7 cells left, each both halves; the moon a quarter full (◔), not a diamond.
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 300_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const context = must(await ui.find({ type: "Box", key: "context" }), "the context chip");
    expect(flat(context.children[0])).toBe(" ◔ ");
    const cells = elements(context.children.slice(1));
    expect(cells.map((t) => (t.props.backgroundColor !== "#373a48" ? "B" : "_")).join("")).toBe("BBBBBBB___");
    expect(cells.every((t) => t.props.color === t.props.backgroundColor)).toBe(true);
    await ui.unmount();
  });

  // The context bar's limit is the one the session reports, whatever the model's window or the person's settings make it:
  // the compaction threshold when auto-compaction is on, else the raw window, else the window the usage names. Each case
  // names the window, the tokens and the breakdown, and the bar is the arithmetic on them: the tokens left, the share of
  // them underneath (B both halves lit, T the smart zone's top half, U the bottom half), and the glyph for the zone.
  // The bar as drawn once the mod caught up: the breakdown comes after the first draw.
  const contextBar = async (on: On, ui: Mounted<"terminal", "PromptHint">) => {
    await caughtUp(on, ui);
    const chip = must(await ui.find({ type: "Box", key: "context" }), "the context chip");
    return { badge: flat(chip.children[0]), lit: litCells(chip.children.slice(1)) };
  };
  const smartZone = { smart_zone_tokens: 150_000 };
  for (const [title, options, context, left, bar] of [
    // 675,000 of the 1,350,000 before compaction is 50%: 5 cells left. Against the 1,500,000 window it would be 825.0K left.
    // Past the smart zone, so nothing on top; (675,000 - 150,000) of the 1,200,000 beyond it is the moon's third quarter step.
    ["measures a 1.5M window against the compaction threshold the breakdown reports", smartZone, { tokens: 675_000, window: 1_500_000, breakdown: breakdownOf(1_500_000, 675_000, 1_350_000) }, "675.0K", { badge: " ◑ ", lit: "UUUUU_____" }],
    // A 200,000 window with auto-compaction off: the raw window is the limit, 100,000 left, half of it used. 50,000 of the
    // 150,000-token smart zone is left, 3 cells on top; past half of it, the filled diamond.
    ["measures a 200k window against the window itself when auto-compaction is off", smartZone, { tokens: 100_000, window: 200_000, breakdown: breakdownOf(200_000, 100_000) }, "100.0K", { badge: " ◆ ", lit: "BBBUU_____" }],
    // No breakdown: the window the usage names is the limit. 750,000 of 1,500,000 is 50%; the default 200,000-token smart zone is spent.
    ["measures a window with no breakdown against the whole window", {}, { tokens: 750_000, window: 1_500_000 }, "750.0K", { badge: " ◑ ", lit: "UUUUU_____" }],
  ] satisfies [string, Record<string, number>, SessionContextUsage, string, { badge: string; lit: string }][])
    test(title, { options }, async ($, on) => {
      stubHint(on, START);
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
      const ui = await mountHint($);
      expect(await contextBar(on, ui)).toEqual(bar);
      expect(await explanationOf(ui, "context")).toContain(left);
      await ui.unmount();
    });

  test("reads the compaction threshold again when a turn ends", { options: smartZone }, async ($, on) => {
    stubHint(on, START);
    // The threshold the session reports changes between turns, as a setting or a different model's window would change it.
    let threshold = 1_350_000;
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 675_000, window: 1_500_000, breakdown: breakdownOf(1_500_000, 675_000, threshold) }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    expect(await contextBar(on, ui)).toEqual({ badge: " ◑ ", lit: "UUUUU_____" });
    expect(await explanationOf(ui, "context")).toContain("675.0K");
    // Against 900,000: 225,000 left, 75% used, 2 cells left; (675,000 - 150,000) of the 750,000 beyond the smart zone is the fourth moon.
    threshold = 900_000;
    await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", durationMs: 1_000 });
    expect(await contextBar(on, ui)).toEqual({ badge: " ◕ ", lit: "UU________" });
    expect(await explanationOf(ui, "context")).toContain("225.0K");
    await ui.unmount();
  });

  test("draws each limit's time left on top, its usage left underneath, and the empty track to 100%", async ($, on) => {
    stubHint(on, START);
    const now = clockOn(on).now();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        context: { window: 1_000_000 },
        // 7d: 36% of the time left, 85% of usage left. 5h: 55% of the time left, 28% of usage left.
        rateLimits: [
          { kind: "seven_day", percentUsed: 15, resetsAt: new Date(now + 217_728_000).toISOString() },
          { kind: "five_hour", percentUsed: 72, resetsAt: new Date(now + 9_900_000).toISOString() },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);

    // B both halves lit, T top (time) only, U bottom (usage) only, _ neither; 7 cells for 7d, then 10 for 5h.
    // A dim half is #373a48: the glyph colour is the top half, the background the bottom.
    const cells = litCells(await ui.findAll({ type: "Text", text: "▀" }));
    expect(cells).toBe("BBUUU__BBTTT_____");
    // Hovered, each limit's reset by its clock time.
    expect(await explanationOf(ui, "limit_7d")).toMatch(new RegExp(`^7d at 15%: it resets at ${CLOCK}\\.$`));
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 72%: it resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // A limit_style the mod does not know draws the two lanes cockpit 1.1.0 drew: the reading above, in the same colours.
  test("draws both limit tags as classic for a limit_style it does not know", { options: { limit_style: "fancy" } }, async ($, on) => {
    stubHint(on, START);
    const now = clockOn(on).now();
    await startWithLimits($, on, [
      { kind: "seven_day", percentUsed: 15, resetsAt: new Date(now + 217_728_000).toISOString() },
      { kind: "five_hour", percentUsed: 72, resetsAt: new Date(now + 9_900_000).toISOString() },
    ]);
    const ui = await mountHint($);
    const cells = elements(await ui.findAll({ type: "Text", text: "▀" }));
    expect(litCells(cells)).toBe("BBUUU__BBTTT_____");
    // The 7d's lanes from #c084fc to #643296, its fifth cell four sevenths of the way, as lerp truncates.
    expect(cells[0]?.props).toMatchObject({ color: "#c084fc", backgroundColor: "#c084fc" });
    expect(cells[4]?.props).toMatchObject({ color: "#373a48", backgroundColor: "#844eb9" });
    expect(flat(elements(must(await ui.find({ type: "Box", key: "seven_day" }), "the 7d tag").children)[0])).toBe(" 7d ");
    await ui.unmount();
  });

  // A 7d reading with `passed` of its window gone at START, and the 5h's alike.
  const reading = (kind: "seven_day" | "five_hour", percentUsed: number, passed: number): SessionRateLimit => {
    const windowMs = kind === "seven_day" ? 604_800_000 : 18_000_000;
    return { kind, percentUsed, resetsAt: new Date(START + (1 - passed) * windowMs).toISOString() };
  };
  // A reset built from local parts, as the person's clock reads it: `days` from START's local day at hour:minute:second.
  const localAt = (days: number, hour: number, minute = 0, second = 0): Date => {
    const start = new Date(START);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, hour, minute, second);
  };
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Any reset clock, for a reset a test cannot pin to the minute: `3 PM`, `Thu 3:30 PM`, `next Thu 9 AM`.
  const CLOCK = "(?:(?:next )?(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?(?:1[0-2]|[1-9])(?::[0-5]\\d)? [AP]M";
  // A 7d reading at `percentUsed` that resets at `resetsAt`.
  const sevenResettingAt = (percentUsed: number, resetsAt: Date): SessionRateLimit => ({ kind: "seven_day", percentUsed, resetsAt: resetsAt.toISOString() });
  // A limit tag as drawn: its badge's text, its bar glyph by glyph (on a gauge █ a full cell, ▐ or ▌ the half on the
  // pipe's side, a space an empty cell, │ the pipe), and each glyph's colour and background.
  const limitTagOf = async (ui: { find: Mounted["find"] }, key: string) => {
    const [badge, ...bar] = elements(must(await ui.find({ type: "Box", key }), `the ${key} tag`).children);
    return { badge: flat(badge), bar: bar.map(flat).join(""), colors: bar.map(({ props }) => props.color), backgrounds: bar.map(({ props }) => props.backgroundColor) };
  };

  test("reads the limit and its percent used, rounded, in the gauge's badge", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 50.6, 1 / 3)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "seven_day")).badge).toBe(" 7d 51% ");
    await ui.unmount();
  });

  test("draws half the length, rounded down, on each side of the gauge's pipe: 5 at the 5h's 10, 3 at the 7d's 7", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    // Too early in either window for a pace, its window not begun, so each side is blank.
    await startWithLimits($, on, [reading("seven_day", 1, -0.5), reading("five_hour", 1, -0.5)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "five_hour")).bar).toBe("     │     ");
    expect((await limitTagOf(ui, "seven_day")).bar).toBe("   │   ");
    await ui.unmount();
  });

  // On a 10-cell 7d gauge each side is 10 halves. 51% with a third gone is r 1.53, over pace: it runs out with 35% of the
  // window to go, 3 halves right of the pipe, from amber towards red. 10% with 60% gone is r 0.17, under pace: 83% of
  // the target unused, 8 halves left of the pipe, in slate.
  for (const [title, used, passed, bar, colors] of [
    ["fills the gauge's right side outward from the pipe over pace, amber turning red", 51, 1 / 3, "     │█▌   ", [[5, "#e5e7eb"], [6, "#fbbf24"], [7, "#f8a12c"]]],
    ["fills the gauge's left side outward from the pipe under pace, in slate", 10, 0.6, " ████│     ", [[1, "#94a3b8"], [4, "#94a3b8"], [5, "#e5e7eb"]]],
  ] as const)
    test(title, { options: { limit_style: "gauge", limit_7d_length: 10 } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [reading("seven_day", used, passed)]);
      const ui = await mountHint($);
      const gauge = await limitTagOf(ui, "seven_day");
      expect(gauge.bar).toBe(bar);
      // The pipe, at 5, in the par colour.
      expect(colors.map(([i]) => [i, gauge.colors[i]])).toEqual(colors);
      await ui.unmount();
    });

  // 51% with a third of the 7d gone is over pace with a usable reading; each of these takes the pace away: no reset time, a
  // reset not ahead of now, and a window not begun, its reset a window and a half ahead, so the share passed is -0.5.
  for (const [title, limit] of [
    ["draws a gauge with no reset time without a pace", { kind: "seven_day", percentUsed: 51 }],
    ["draws a gauge without a pace when its reset is not ahead of now", { kind: "seven_day", percentUsed: 51, resetsAt: new Date(START - 3_600_000).toISOString() }],
    ["draws a gauge without a pace before its window has begun", reading("seven_day", 51, -0.5)],
  ] satisfies [string, SessionRateLimit][])
    test(title, { options: { limit_style: "gauge", limit_7d_length: 10 } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [limit]);
      const ui = await mountHint($);
      const gauge = await limitTagOf(ui, "seven_day");
      expect(gauge.badge).toBe(" 7d 51% ");
      expect(gauge.bar).toBe("     │     ");
      // Every cell grey, the pipe dim: no pace colour anywhere.
      expect(gauge.backgrounds).toEqual(Array(11).fill("#373a48"));
      expect(gauge.colors).toEqual([...Array(5).fill("#373a48"), "#6b7280", ...Array(5).fill("#373a48")]);
      await ui.unmount();
    });

  // The pace needs no response of this session in the last 10 minutes, nor a tenth of the window gone: 51% with 5% of the
  // window gone is over pace.
  test("draws the gauge's pace while less than a tenth of the window has passed", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 51, 0.05)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "seven_day")).bar).not.toBe("     │     ");
    expect(await explanationOf(ui, "limit_7d")).toMatch(/^7d at 51%: at this pace it runs out in /);
    await ui.unmount();
  });

  // The 7d's own gradient over 7 cells, #c084fc to #643296 as lerp truncates it, and the grey of an empty half.
  const LIT_7D = ["#c084fc", "#b277ec", "#a269db", "#925bc9"];
  const GREY = "#373a48";
  // The 5h's own gradient over 10 cells, #22d3ee to #0f8c96 as lerp truncates it, and the lanes' pace colours.
  const LIT_5H = ["#22d3ee", "#20cce5", "#1ec4db", "#1cbcd1", "#1ab4c8", "#18acbe", "#16a5b4", "#149dab"];
  const RED = "#ef4444";
  const SPARE = "#60a5fa";
  const SEVERE = "#991b1b";
  // On a 7-cell 7d tag, 51% with a third gone is par 33%, 1.2 cells ahead: the token lane on top lit to the usage left,
  // 49%, 3 cells, its last 2 impacted, amber to red; the time lane below lit to the par left, 67%, 4 cells. 38% is 0.3
  // cells ahead, which impacts the token lane's last of 4 cells. 33% is a hair behind par, which spares no cell. 10%
  // with 60% gone is 3.5 cells behind par: 3 of the token lane's 6 cells are spare, and the time lane is lit to 2. 80%
  // with 45% gone is 2.45 cells ahead, which impacts 3 cells, more than the token lane's 1: its time lane's 3 cells draw
  // deep red. 95% with 80% gone is 1.05 cells ahead, 2 impacted, while the token lane rounds down to none.
  for (const [title, used, passed, tops, bottoms] of [
    ["lights the lanes' last token cells amber to red, one per cell the usage is ahead of par", 51, 1 / 3, ["#c084fc", "#fbbf24", RED, GREY, GREY, GREY, GREY], [...LIT_7D, GREY, GREY, GREY]],
    ["lights the lanes' last token cell amber for any spend ahead of par", 38, 1 / 3, [...LIT_7D.slice(0, 3), "#fbbf24", GREY, GREY, GREY], [...LIT_7D, GREY, GREY, GREY]],
    ["draws the lanes on par in the limit's gradient with no pace colour", 33, 1 / 3, [...LIT_7D, GREY, GREY, GREY], [...LIT_7D, GREY, GREY, GREY]],
    ["draws the lanes' last token cells in the spending-welcome colour, one per cell the usage is behind par", 10, 0.6, [...LIT_7D.slice(0, 3), SPARE, SPARE, SPARE, GREY], [...LIT_7D.slice(0, 2), GREY, GREY, GREY, GREY, GREY]],
    ["draws the lanes' time lane deep red when more cells are impacted than the token lane holds", 80, 0.45, ["#fbbf24", ...Array(6).fill(GREY)], [SEVERE, SEVERE, SEVERE, GREY, GREY, GREY, GREY]],
    ["draws the lanes' time lane deep red when the token lane is empty and the usage ahead of par", 95, 0.8, Array(7).fill(GREY), [SEVERE, ...Array(6).fill(GREY)]],
  ] as const)
    test(title, { options: { limit_style: "lanes" } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [reading("seven_day", used, passed)]);
      const ui = await mountHint($);
      const lanes = await limitTagOf(ui, "seven_day");
      expect(lanes.badge).toBe(" 7d ");
      expect(lanes.bar).toBe("▀▀▀▀▀▀▀");
      // The glyph colour is the token lane, the background the time lane.
      expect(lanes.colors).toEqual([...tops]);
      expect(lanes.backgrounds).toEqual([...bottoms]);
      await ui.unmount();
    });

  // On a 10-cell 5h tag with its target at 100%, 38% used with 19% gone is 1.9 cells ahead of par: 2 cells impacted at
  // the end of the token lane, lit to the usage left, 62%, 6 cells. The time lane is lit to the par left, 81%, 8 cells.
  test("lights the 5h lanes' tokens on top and the par left below, the impacted token cells amber to red", { options: { limit_style: "lanes" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("five_hour", 38, 0.19)]);
    const ui = await mountHint($);
    const lanes = await limitTagOf(ui, "five_hour");
    expect(lanes.bar).toBe("▀".repeat(10));
    // The glyph colour is the token lane, the background the time lane.
    expect(lanes.colors).toEqual([...LIT_5H.slice(0, 4), "#fbbf24", RED, GREY, GREY, GREY, GREY]);
    expect(lanes.backgrounds).toEqual([...LIT_5H, GREY, GREY]);
    await ui.unmount();
  });

  // A notch tag's one lane is each cell's background; ▏ in the par colour is the notch, on the left edge of the cell
  // after the par left. On 7 cells, 51% with a third gone leaves par 67%, 4.7 cells, so the notch sits after the 5th:
  // the usage left, 3.4 cells, lit to 3, and the 2 empty cells before the notch amber beside it turning red. 10% with
  // 60% gone leaves par 40%, 2.8 cells, so the notch sits after the 3rd, the 3 lit past it slate. On a 1-cell lane the
  // par left of 60% rounds to the whole lane, so the notch sits after it.
  for (const [title, length, used, passed, bar, backgrounds] of [
    ["notches the lane at the par left and draws the empty cells before it amber to red over pace", 7, 51, 1 / 3, "     ▏ ", [...LIT_7D.slice(0, 3), "#faac29", "#fbbf24", GREY, GREY]],
    ["notches the lane at the par left and draws the lit cells past it in slate under pace", 7, 10, 0.6, "   ▏   ", [...LIT_7D.slice(0, 3), "#94a3b8", "#94a3b8", "#94a3b8", GREY]],
    ["notches the lane after its last cell when the par left fills it", 1, 10, 0.4, " ▏", ["#c084fc", GREY]],
  ] as const)
    test(title, { options: { limit_style: "notch", limit_7d_length: length } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [reading("seven_day", used, passed)]);
      const ui = await mountHint($);
      const notch = await limitTagOf(ui, "seven_day");
      expect(notch.badge).toBe(" 7d ");
      expect(notch.bar).toBe(bar);
      expect(notch.backgrounds).toEqual([...backgrounds]);
      expect(notch.colors[bar.indexOf("▏")]).toBe("#e5e7eb");
      await ui.unmount();
    });

  // 51% of the 7d with a third gone is over pace with a usable reading; each of these takes the pace away. The usage
  // left, 49%, lights 3 of 7 cells either way, the lanes' token lane on top; their time lane below is the time left: none
  // without a reset time or with its reset passed, all 7 with the window not begun, its reset a window and a half ahead.
  const DIM = "#6b7280";
  for (const [why, limit, top] of [
    ["with no reset time", { kind: "seven_day", percentUsed: 51 }, 0],
    ["with its reset not ahead of now", { kind: "seven_day", percentUsed: 51, resetsAt: new Date(START - 3_600_000).toISOString() }, 0],
    ["before its window has begun", reading("seven_day", 51, -0.5), 7],
  ] satisfies [string, SessionRateLimit, number][]) {
    test(`draws both lanes dim without a pace ${why}`, { options: { limit_style: "lanes" } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [limit]);
      const ui = await mountHint($);
      const lanes = await limitTagOf(ui, "seven_day");
      expect(lanes.colors).toEqual([DIM, DIM, DIM, GREY, GREY, GREY, GREY]);
      expect(lanes.backgrounds).toEqual([...Array(top).fill(DIM), ...Array(7 - top).fill(GREY)]);
      await ui.unmount();
    });
    test(`draws the notch style's usage dim with no notch without a pace ${why}`, { options: { limit_style: "notch" } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [limit]);
      const ui = await mountHint($);
      const notch = await limitTagOf(ui, "seven_day");
      expect(notch.bar).toBe("       ");
      expect(notch.backgrounds).toEqual([DIM, DIM, DIM, GREY, GREY, GREY, GREY]);
      await ui.unmount();
    });
  }

  // 30% of the 7d with no reset time has no pace and no time left: the usage left, 70%, lights the token lane dim to 4
  // of 7 cells, and the time lane is empty.
  test("draws the lanes' token lane dim and the time lane empty at 30% with no reset time", { options: { limit_style: "lanes" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [{ kind: "seven_day", percentUsed: 30 }]);
    const ui = await mountHint($);
    const lanes = await limitTagOf(ui, "seven_day");
    expect(lanes.colors).toEqual([DIM, DIM, DIM, DIM, GREY, GREY, GREY]);
    expect(lanes.backgrounds).toEqual(Array(7).fill(GREY));
    await ui.unmount();
  });

  // The 7d, 5h and context bars, each with a value to show while hovered.
  const mountBars = async ($: Engine, on: On) => {
    stubHint(on, START);
    const resetsAt = new Date(START + 9_900_000).toISOString();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [{ kind: "seven_day", percentUsed: 20, resetsAt }, { kind: "five_hour", percentUsed: 10, resetsAt }] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    return mountHint($);
  };
  // The cells each bar draws, as the ▀ glyphs in its tag, by the limit_7d_length, limit_5h_length and context_length options.
  for (const [title, options, lengths] of [
    ["draws the 7d, 5h and context bars 7, 10 and 10 cells long with no length set, as cockpit 1.1.0 did", {}, { "7d": 7, "5h": 10, context: 10 }],
    ["draws a 14-cell 7d bar at limit_7d_length 14", { limit_7d_length: 14 }, { "7d": 14, "5h": 10, context: 10 }],
    ["draws a 1-cell context bar at context_length 0, the shortest a bar gets", { context_length: 0 }, { "7d": 7, "5h": 10, context: 1 }],
    ["draws a 12-cell 5h bar at limit_5h_length 12.7, a fraction rounded down", { limit_5h_length: 12.7 }, { "7d": 7, "5h": 12, context: 10 }],
  ] satisfies [string, Record<string, number>, { "7d": number; "5h": number; context: number }][])
    test(title, { options }, async ($, on) => {
      const ui = await mountBars($, on);
      const length = async (key: string) => elements(must(await ui.find({ type: "Box", key }), `the ${key} tag`).children).filter((cell) => flat(cell) === "▀").length;
      expect({ "7d": await length("seven_day"), "5h": await length("five_hour"), context: await length("context") }).toEqual(lengths);
      await ui.unmount();
    });
  // A hovered value no longer lays over its tag, so a bar shorter than the value has nothing to spill over the tag before it.
  for (const [title, options, key] of [
    ["lays no countdown over a 1-cell 5h bar", { limit_5h_length: 1 }, "five_hour"],
    ["lays no tokens left over the context bar at context_length 0", { context_length: 0 }, "context"],
  ] satisfies [string, Record<string, number>, string][])
    test(title, { options }, async ($, on) => {
      const ui = await mountBars($, on);
      expect(elements(must(await ui.find({ type: "Box", key }), `the ${key} tag`).children).filter((part) => part.props.position === "absolute")).toEqual([]);
      await ui.unmount();
    });

  // The marks of the turns, costs and subagents' costs chips, in the order the row draws them.
  const SPLIT = [["turns", " ⏎ ", "7 / 1", "\uf0e7 1 / 2"], ["tokens", " Σ ", "$3.24", "1.31M"], ["agents", " \uf0e7 ", "$0.01", "151.0K"]] as const;
  for (const [title, options, chips, marks] of [
    ["counts the main session's and its subagents' tokens once per request, priced from the live table", {}, SPLIT, ["⏎", "Σ", "\uf0e7"]],
    ["adds the subagents' cost and tokens to the main session's one chip when merge_costs is on", { merge_costs: true }, [["turns", " ⏎ ", "7 / 1", "\uf0e7 1 / 2"], ["tokens", " Σ ", "$3.25", "1.46M"]], ["⏎", "Σ"]],
    ["draws the subagents' costs as a tag of their own, where the layout puts it", { layout: `prompt;agents,spacer,turns,gap-1,tokens;fresh;compact;explain;hidden;${GIT.replaceAll(",gap-1", "")},model,limit_7d,limit_5h,context,cache` }, SPLIT, ["\uf0e7", "⏎", "Σ"]],
  ] as const) {
    test(title, { options }, async ($, on) => {
      stubHint(on, START);
      const usage = (inp: number, out: number, read: number, w5: number) => ({
        input_tokens: inp,
        output_tokens: out,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: w5,
        cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: 0 },
      });
      // Request A is two content blocks, so two lines; the agent's prompt is over Haiku 5.5's 100,000-token tier.
      const a = { type: "assistant", requestId: "A", message: { model: "claude-opus-5-5", usage: usage(10_000, 100_000, 1_000_000, 200_000) } };
      const agent = { type: "assistant", requestId: "B", agentId: "a1", message: { model: "claude-haiku-5-5", usage: usage(0, 1_000, 150_000, 0) } };
      // Claude Code's own <synthetic> message carries a usage of nothing: not a request, not unpriced.
      const synthetic = { type: "assistant", requestId: "S", message: { model: "<synthetic>", usage: usage(0, 0, 0, 0) } };
      // The agent's second request: one output token, so the totals below stay as they were.
      const agent2 = { type: "assistant", requestId: "C", agentId: "a1", message: { model: "claude-haiku-5-5", usage: usage(0, 1, 0, 0) } };
      const transcript = [a, a, { type: "user", message: { content: "usage" } }, synthetic, agent, agent2].map((r) => JSON.stringify(r)).join("\n");
      let argv: readonly string[] = [];

      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      on("session.id", () => ({ value: "sid-1" }));
      on("session.turns", () => ({ value: 7 }));
      on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
      on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
      on("process.spawn", async function* (_$, e) {
        argv = e.argv;
        // Split mid-line, as a pipe hands text over.
        yield { stream: "stdout", text: transcript.slice(0, 50) };
        yield { stream: "stdout", text: transcript.slice(50) };
        return { value: { code: 0, signal: null } };
      });

      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
      const ui = await mountHint($);

      await caughtUp(on, ui);
      expect(argv).toEqual(["find", "/home/u/.claude/projects", "-path", "*sid-1*", "-name", "*.jsonl", "-exec", "grep", "-h", "-e", '"usage"', "-e", '"compact_boundary"', "{}", "+"]);
      // Each chip: a space, its tag, and its value's tag right against it.
      // A: 1,310,000 tokens at Opus 5.5's rates is $3.24. The agent: 151,000 tokens at the over-100k tier is $0.01.
      // The prompts / the main session's requests: A once though written twice; hovered, one subagent / its two requests.
      for (const [key, tag, value, hover] of chips) {
        const chip = must(await ui.find({ type: "Box", key }), `the ${key} chip`);
        expect(flat(chip.children[0])).toBe(tag);
        // Padded to the value alone, a space each side.
        expect(flat(chip.children[1])).toBe(` ${value} `);
        // Hovered, the explanation line shows what the tag's own hover showed.
        expect(await explanationOf(ui, key)).toContain(hover);
      }
      // Merged, the agents' chip is gone.
      expect(await ui.findAll({ type: "Box", key: "agents" })).toHaveLength(chips.some(([key]) => key === "agents") ? 1 : 0);
      const drawn = rowSpelled((await tagRows(ui))[0]).map((part) => part.trim().charAt(0));
      expect(drawn.filter((mark) => ["⏎", "Σ", "\uf0e7"].includes(mark))).toEqual(marks);
      await ui.unmount();
    });
  }

  test("times the main conversation's cache from its last request: warm with what a read costs, cold with a rewrite", async ($, on) => {
    stubHint(on, START);
    // An hour-TTL write, then a read: the cache lives an hour from the read. 1,000,000 cached tokens on Opus 5.5:
    // $0.20 read, $8.00 written for an hour. A subagent's later request with a 5m write changes nothing here.
    const row = (minutesAgo: number, usage: object, extra: object = {}) =>
      JSON.stringify({ type: "assistant", requestId: `r${minutesAgo}`, timestamp: new Date(START - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage }, ...extra });
    let minutes = 10;
    const transcript = () =>
      [
        row(minutes + 5, { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } }),
        row(minutes, { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }),
        row(1, { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 } }, { agentId: "a1" }),
      ].join("\n");
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      yield { stream: "stdout", text: transcript() };
      return { value: { code: 0, signal: null } };
    });

    // The chip once this session's token scan is drawn.
    const chip = async (ui: Mounted<"terminal", "PromptHint">) => {
      await caughtUp(on, ui);
      return must(await ui.find({ type: "Box", key: "cache" }), "the cache chip");
    };
    const mount = () =>
      mountHint($);

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    let ui = await mount();
    let cache = await chip(ui);
    // 50 minutes left of the hour (49 once a second passes).
    expect(flat(cache.children[0])).toBe(" ● ");
    expect(flat(cache.children[1])).toMatch(/^ (50|49)m \$0\.20 $/);
    // Hovered, the explanation line shows what writing it again costs once cold.
    expect(await explanationOf(ui, "cache")).toContain("$8.00");
    // Hoverable, so the value stands on the grey.
    expect(JSON.stringify(cache.children[1])).toContain("#373a48");
    await ui.unmount();

    // 20 minutes left: a third of the hour, so the moon is half gone.
    minutes = 40;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    ui = await mount();
    expect(flat((await chip(ui)).children[0])).toBe(" ◑ ");
    await ui.unmount();

    // A request that has just ended has the whole hour left, which reads 59m from the first frame, never 1h0m.
    minutes = 0;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    ui = await mount();
    expect(flat((await chip(ui)).children[1])).toBe(" 59m $0.20 ");
    await ui.unmount();

    // Two hours on, the hour is up: the next prompt writes the cache again.
    minutes = 120;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    ui = await mount();
    cache = await chip(ui);
    expect(flat(cache.children[0])).toBe(" ○ ");
    expect(flat(cache.children[1])).toBe(" cold $8.00 ");
    // Cold, it still has an explanation, so the value stands on the grey too.
    expect(JSON.stringify(cache.children[1])).toContain("#373a48");
    await ui.unmount();
  });

  test("shows a limit another session was refused on as used up, until it resets", async ($, on) => {
    stubHint(on, START);
    // This session last heard 40% of the 5h window used; another session's transcript has its refusal, resetting in an hour.
    const now = clockOn(on).now();
    const refusal = JSON.stringify({
      type: "assistant",
      error: "rate_limit",
      apiError: "usage_limit_reached",
      quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor((now + 3_600_000) / 1000) },
    });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [{ kind: "five_hour", percentUsed: 40, resetsAt: new Date(now + 10_800_000).toISOString() }] },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("process.run", (_$, e) => ({
      value: { exitCode: e.argv[0] === "sh" ? 0 : 1, stdout: e.argv[0] === "sh" ? `${refusal}\n` : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
    }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    // Usage left is the bars' bottom halves: none once refused, where 40% used would light 6.
    const lit = (await ui.findAll({ type: "Text", text: "▀" })).filter((t) => t.props.backgroundColor !== "#373a48").length;
    expect(lit).toBe(0);
    await ui.unmount();
  });

  test("draws the explanation line under the prompt by default, after the fresh-start and compaction lines", async ($, on) => {
    stubHint(on);
    const below = await mountHint($);
    const drawn = await below.drawn();
    expect(leaves(isDrawn(drawn) ? drawn.children : []).at(-1)?.props.key).toBe("explain");
    await below.unmount();
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Box", key: "explain" })).toBeUndefined();
    await above.unmount();
    // The default layout as the order pane lists it: a stale default naming forecast would add an empty row-3.
    const pane = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    expect((await pane.find({ type: "Client", key: "lines" }))?.props.props).toMatchObject({ items: ["row-1", "prompt", "row-2", "fresh", "compact", "explain", "hidden", "spacer", "row"] });
    await pane.unmount();
  });

  // forecast is no longer a line's name: a saved layout's line of it is an empty row, and the explanation line goes last.
  test("draws the explanation line last under the prompt for a saved layout that names forecast", { options: { layout: `forecast;${GIT};prompt;${STATUS};fresh;compact` } }, async ($, on) => {
    stubHint(on);
    on("session.root", () => ({ value: "/work" }));
    on("session.cwd", () => ({ value: "/work" }));
    // Outside a repository the git row holds the folder alone.
    on("process.run", () => ({ value: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository", isStdoutTruncated: false, isStderrTruncated: false } }));
    await startWithLimits($, on);
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    // A line spelled: a row as "row", anything else as its text.
    const lines = async () => {
      const drawn = await above.drawn();
      return leaves(isDrawn(drawn) ? drawn.children : []).map((line) => (line.props.flexWrap === "wrap" ? "row" : flat(line)));
    };
    for (let i = 0; i < 50 && !(await lines()).includes("row"); i++) await settle();
    // The line that named forecast is an empty row, which draws nothing: above the prompt only the git row draws.
    expect(await lines()).toEqual(["row"]);
    await above.unmount();
    const below = await mountHint($);
    const drawn = await below.drawn();
    const last = leaves(isDrawn(drawn) ? drawn.children : []).at(-1);
    expect(last?.props.key).toBe("explain");
    expect(flat(last)).toMatch(/at this pace/);
    await below.unmount();
  });

  for (const [title, options, line] of [
    ["draws the explanation line blank with nothing to show", {}, ""],
    ["draws no explanation line and no run-out warning anywhere with explain_row off", { explain_row: false }, undefined],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on);
    // With explain_row on nothing is shown: no limit at all. Off, a 5h that runs out early has no place to warn.
    await startWithLimits($, on, line === undefined ? undefined : []);
    const below = await mountHint($);
    const explain = await below.find({ type: "Box", key: "explain" });
    expect(explain?.text).toBe(line);
    expect(await below.find({ type: "Text", text: /at this pace/ })).toBeUndefined();
    await below.unmount();
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Text", text: /at this pace/ })).toBeUndefined();
    await above.unmount();
  });

  test("wraps a run-out warning wider than the window between words, the explanation line growing for it", async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on);
    const ui = await mountHint($);
    const explain = must(await ui.find({ type: "Box", key: "explain" }), "the explanation line");
    expect(explain.props.height).toBeUndefined();
    // The kit lays nothing out, so the wrap is read off the props: a sentence Box that wraps, and text that is not cut.
    // Outermost first: the hint's own column goes, then the explanation line, leaving what the warning sits in.
    const [, ...holding] = (await ui.findAll({ type: "Box", text: /at this pace/ })).filter((b) => b.props.key !== "explain");
    expect(holding.some((b) => b.props.flexWrap === "wrap")).toBe(true);
    expect(holding.every((b) => b.props.overflow === undefined && b.props.height === undefined)).toBe(true);
    expect((await ui.find({ type: "Text", text: /at this pace/ }))?.props.wrap).toBeUndefined();
    await ui.unmount();
  });

  test("draws the explanation line above the prompt when the layout puts it there", { options: { layout: `explain;${GIT};prompt;${STATUS};fresh;compact` } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on);
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Text", text: /at this pace/ })).toBeDefined();
    await above.unmount();
    const below = await mountHint($);
    expect(await below.find({ type: "Text", text: /at this pace/ })).toBeUndefined();
    await below.unmount();
  });

  // The 5h window is 300 minutes long. 70% used with 2h left is 3h in: at that pace 100% comes 1h17m from now, 42m before the reset.
  // The 5h at 2% with its window begun a second ago has its run-out 49 seconds from now, a run-out under a minute reads any moment.
  // None of these depends on when this session last responded: the warning reads the clock alone.
  for (const [title, used, resetsInSec, options, shown] of [
    ["warns when a limit runs out before it resets at the pace so far", 70, 7_200, {}, new RegExp(`^\\uf071 5h at 70%: at this pace it runs out in 1h17m, 42m before it resets at ${CLOCK}\\.$`)],
    ["stays quiet while the pace reaches the reset with room to spare", 40, 7_200, {}, undefined],
    ["warns early in a window, where the pace is noise, with its run-out under a minute from now", 2, 17_999, {}, new RegExp(`^\\uf071 5h at 2%: at this pace it runs out any moment, 4h59m before it resets at ${CLOCK}\\.$`)],
    ["stays quiet when the person turned limit_forecast off", 70, 7_200, { limit_forecast: false }, undefined],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on, START);
    const now = clockOn(on).now();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        context: { window: 1_000_000 },
        rateLimits: [
          { kind: "five_hour", percentUsed: used, resetsAt: new Date(now + resetsInSec * 1_000).toISOString() },
          // 7d is 85% gone at 20% used: on track, so it never gets a line of its own.
          { kind: "seven_day", percentUsed: 20, resetsAt: new Date(now + 90_030_000).toISOString() },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const explain = must(await ui.find({ type: "Box", key: "explain" }), "the explanation line");
    // The warning sign, then the sentence; blank when the warning does not apply.
    expect(shownIn(explain)).toMatch(shown ?? /^$/);
    await ui.unmount();
  });

  // Both limits run out before their resets; the line warns of the one that runs out first. The 7d at 99% with a day
  // left is 6 days in: 1h27m to go. The 5h at 70% with 2h left runs out in 1h17m, at 65% in 1h36m.
  for (const [five, shown, hidden] of [
    [70, /^\uf071 5h at 70%: at this pace it runs out in 1h17m, /, /7d at/],
    [65, /^\uf071 7d at 99%: at this pace it runs out in 1h27m, /, /5h at/],
  ] as const)
  test(`warns of the limit that runs out sooner, with the 5h at ${five}% and the 7d at 99%`, async ($, on) => {
    stubHint(on, START);
    const now = clockOn(on).now();
    await startWithLimits($, on, [
      { kind: "five_hour", percentUsed: five, resetsAt: new Date(now + 120 * 60_000).toISOString() },
      { kind: "seven_day", percentUsed: 99, resetsAt: new Date(now + 86_400_000).toISOString() },
    ]);
    const ui = await mountHint($);
    const explain = must(await ui.find({ type: "Box", key: "explain" }), "the explanation line");
    expect(shownIn(explain)).toMatch(shown);
    expect(shownIn(explain)).not.toMatch(hidden);
    await ui.unmount();
  });

  // A session that draws all seven explained tags, under the prompt by default: the 5h at 70% with 2 hours to its reset,
  // so the run-out warning shows, the 7d at 20%, 120,000 of 200,000 tokens of context left, 7 prompts, and the main
  // session's one request writing 1,000,000 tokens to an hour's cache `cachedAgo` minutes ago. With `agents`, a
  // subagent's one request read 150,000 tokens and wrote 1,000. Opus 5.5 writes the cache for $8.00, reads it for $0.20.
  async function explained($: Engine, on: On, { cachedAgo = 10, agents = true } = {}): Promise<Mounted<"terminal", "PromptHint">> {
    stubHint(on, START);
    const now = clockOn(on).now();
    const at = new Date(now - cachedAgo * 60_000).toISOString();
    const usage = (out: number, read: number, w1: number) => ({ input_tokens: 0, output_tokens: out, cache_read_input_tokens: read, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: w1 } });
    const main = { type: "assistant", requestId: "A", timestamp: at, message: { model: "claude-opus-5-5", usage: usage(10, 0, 1_000_000) } };
    const agent = { type: "assistant", requestId: "B", agentId: "a1", timestamp: at, message: { model: "claude-haiku-5-5", usage: usage(1_000, 150_000, 0) } };
    const transcript = [main, ...(agents ? [agent] : [])].map((r) => JSON.stringify(r)).join("\n");
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        context: { tokens: 80_000, window: 200_000 },
        rateLimits: [
          { kind: "five_hour", percentUsed: 70, resetsAt: new Date(now + 120 * 60_000).toISOString() },
          { kind: "seven_day", percentUsed: 20, resetsAt: new Date(now + 90_030_000).toISOString() },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("session.turns", () => ({ value: 7 }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      yield { stream: "stdout", text: transcript };
      return { value: { code: 0, signal: null } };
    });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    return ui;
  }

  for (const [style, said] of [["classic", ""], ["gauge", ", the gauge's too"]] as const)
    test(`joins each of the seven tags to a hover scope of its own, which reveals its explanation in the explanation line${said}`, { options: { limit_style: style } }, async ($, on) => {
      const ui = await explained($, on);
      for (const [tag, key] of EXPLAINED) expect(await drawnTag(ui, key)).toMatchObject({ hover: { scope: `explain-${tag}` } });
      // Each explanation hidden until its tag's scope is hovered, then laid over the line from its top left corner.
      expect(await explanationsIn(ui)).toMatchObject(EXPLAINED.map(([tag]) => ({ props: { position: "absolute", top: 0, left: 0, width: "100%", display: "none" }, hover: { scope: `explain-${tag}`, display: "flex" } })));
      await ui.unmount();
    });

  test("draws no overlay of its own in any of the seven tags", async ($, on) => {
    const ui = await explained($, on);
    for (const [, key] of EXPLAINED) expect(JSON.stringify(await drawnTag(ui, key))).not.toContain('"position":"absolute"');
    await ui.unmount();
  });

  // A Box placed absolute paints over those before it, so each explanation comes after the warning, on a background of its own.
  test("lays each explanation on the grey after the run-out warning, so a revealed one covers the warning's text", async ($, on) => {
    const ui = await explained($, on);
    const [warning, ...rest] = elements(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line").children);
    expect(flat(warning)).toMatch(/at this pace/);
    // At least as tall as the line, so a short explanation covers every row a wrapped warning takes too.
    expect(rest).toMatchObject(EXPLAINED.map(() => ({ props: { position: "absolute", backgroundColor: "#373a48", minHeight: "100%" } })));
    await ui.unmount();
  });

  // The kit lays nothing out, so the wrap is read off the props: placed absolute, an explanation takes no room in the
  // line, and with no fixed height and nothing cut off, the lines it wraps onto paint over what lies below the line.
  test("wraps a long explanation between words, its further lines laid over what lies below the line rather than moving it", async ($, on) => {
    const ui = await explained($, on);
    const explanations = await explanationsIn(ui);
    expect(explanations).toHaveLength(EXPLAINED.length);
    for (const explanation of explanations) {
      expect(explanation.props).toMatchObject({ position: "absolute", width: "100%" });
      expect([explanation.props.height, explanation.props.overflow]).toEqual([undefined, undefined]);
      // A Text wraps between words unless its wrap says otherwise.
      for (const text of elements(explanation.children)) expect([undefined, "wrap"]).toContain(text.props.wrap);
    }
    await ui.unmount();
  });

  test("explains the context tag with the tokens left", async ($, on) => {
    const ui = await explained($, on);
    expect(await explanationOf(ui, "context")).toContain("120.0K");
    await ui.unmount();
  });

  // 7 prompts and the main session's 1 request; once a subagent has run, its count and its 1 request, as the hover had them.
  for (const [title, agents, shown] of [
    ["explains the turns tag before any subagent has run with what it shows", false, "7 / 1"],
    ["explains the turns tag with the subagents' count and requests once one has run", true, " 1 / 1"],
  ] as const)
    test(title, async ($, on) => {
      const ui = await explained($, on, { agents });
      expect(await explanationOf(ui, "turns")).toContain(shown);
      await ui.unmount();
    });

  // The main session's 1,000,010 tokens; the subagent's 151,000; merged, both together.
  for (const [title, options, tag, shown] of [
    ["explains the costs tag with the main session's tokens", {}, "tokens", "1.00M"],
    ["explains the costs tag with the main session's and its subagents' tokens together when merge_costs is on", { merge_costs: true }, "tokens", "1.15M"],
    ["explains the subagents' costs tag with their tokens", {}, "agents", "151.0K"],
  ] as const)
    test(title, { options }, async ($, on) => {
      const ui = await explained($, on);
      expect(await explanationOf(ui, tag)).toContain(shown);
      await ui.unmount();
    });

  // Written 10 minutes ago the hour's cache is warm, and the explanation adds what the hover showed: the $8.00 it costs
  // once cold. Written two hours ago it is cold, and the explanation says what the tag shows.
  for (const [title, cachedAgo, shown] of [
    ["explains the warm cache tag with what the prompt costs once the cache is cold", 10, /\$0\.20.*\$8\.00/],
    ["explains the cold cache tag with what it shows", 120, /cold.*\$8\.00/],
  ] as const)
    test(title, async ($, on) => {
      const ui = await explained($, on, { cachedAgo });
      expect(await explanationOf(ui, "cache")).toMatch(shown);
      await ui.unmount();
    });

  // The 5h at 70% resets in 2 hours, the 7d at 20% in 1d1h. Classic says the reset alone; the gauge's 5h is over pace, 1h17m
  // from running out, and its 7d under it with ~76% unused.
  for (const [style, said, five, seven] of [
    ["classic", "", `it resets at ${CLOCK}`, `it resets at ${CLOCK}`],
    ["gauge", " on the gauge too", `at this pace it runs out in 1h1[67]m, 4[234]m before it resets at ${CLOCK}`, `at this pace it resets at ${CLOCK} with ~7[67]% unused`],
  ] as const)
    test(`explains each limit tag with its badge, its percent used and its reset by the clock${said}`, { options: { limit_style: style } }, async ($, on) => {
      const ui = await explained($, on);
      expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 70%: ${five}\\.$`));
      expect(await explanationOf(ui, "limit_7d")).toMatch(new RegExp(`^7d at 20%: ${seven}\\.$`));
      await ui.unmount();
    });

  test("rounds a limit's percent used in its explanation, as the gauge's badge and the run-out warning round it", async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [{ kind: "seven_day", percentUsed: 50.6, resetsAt: new Date(clockOn(on).now() + 90_030_000).toISOString() }]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_7d")).toMatch(/ 51%/);
    await ui.unmount();
  });

  // 89% of the 7d, its reset 3 days out at 3 PM local: 63 to 87 hours away, so over half the window has passed and 89% is
  // over pace. How long it runs out in, and how long before the reset, depend on the time of day, so the sentence's shape is
  // pinned and not its numbers.
  test("explains an over-pace limit with how long from now it runs out and how long before its reset that is", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    const resetsAt = localAt(3, 15);
    await startWithLimits($, on, [sevenResettingAt(89, resetsAt)]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_7d")).toMatch(new RegExp(`^7d at 89%: at this pace it runs out in \\d+h\\d+m, \\d+d\\d+h before it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM\\.$`));
    await ui.unmount();
  });

  // A reset 3 days out at 3 PM local, on the 7d: 48% to 63% of its window has passed. Under pace at 10%, over it at 100%.
  const SEVEN_DAYS = 604_800_000;
  const explainedAt = async ($: Engine, on: On, limit: SessionRateLimit) => {
    stubHint(on, START);
    await startWithLimits($, on, [limit]);
    const ui = await mountHint($);
    const text = await explanationOf(ui, "limit_7d");
    await ui.unmount();
    return text;
  };

  test("explains an under-pace limit with the share of its target unused when it resets at the clock", { options: { limit_style: "gauge" } }, async ($, on) => {
    const resetsAt = localAt(3, 15);
    expect(await explainedAt($, on, sevenResettingAt(10, resetsAt))).toMatch(new RegExp(`^7d at 10%: at this pace it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM with ~(7[89]|8\\d)% unused\\.$`));
  });

  // A third of the window passed, its reset 5 days out at 3 PM local: used set to the share passed, so r is within 0.05 of 1.
  test("explains a limit on pace as reaching its target as it resets at the clock", { options: { limit_style: "gauge" } }, async ($, on) => {
    const resetsAt = localAt(5, 15);
    const share = 1 - (resetsAt.getTime() - START) / SEVEN_DAYS;
    const used = Math.round(share * 100);
    expect(await explainedAt($, on, sevenResettingAt(used, resetsAt))).toBe(`7d at ${used}%: at this pace it reaches its target as it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM.`);
  });

  // Over pace with its run-out already due or under a minute from now: a reading at 100% has run out, and one at 99.99%
  // with about half its window passed runs out under a minute from now, which reads as any moment.
  for (const [title, used] of [
    ["a reading at 100%", 100],
    ["a reading at 99.99% whose run-out falls under a minute from now", 99.99],
  ] as const)
    test(`explains ${title} as running out any moment, the time to its reset before it`, { options: { limit_style: "gauge" } }, async ($, on) => {
      const resetsAt = localAt(3, 15);
      expect(await explainedAt($, on, sevenResettingAt(used, resetsAt))).toMatch(new RegExp(`^7d at 100%: at this pace it runs out any moment, \\d+d\\d+h before it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM\\.$`));
    });

  // The spec's stale reading: the 7d at 10% with 60% of its window passed, r 0.17, so 83% of the target goes unused. The mod
  // reads no response age, so the pace stands on the clock alone, whatever the last response's age.
  test("explains a stale reading with its pace, under pace", { options: { limit_style: "gauge" } }, async ($, on) => {
    expect(await explainedAt($, on, reading("seven_day", 10, 0.6))).toMatch(new RegExp(`^7d at 10%: at this pace it resets at ${CLOCK} with ~83% unused\\.$`));
  });

  // A window not begun: its reset more than a window, 7 days, out, so the share passed is below 0 whatever the time of day.
  test("explains a reading too early in its window with its reset by the clock and no pace", { options: { limit_style: "gauge" } }, async ($, on) => {
    const resetsAt = localAt(8, 15);
    expect(await explainedAt($, on, sevenResettingAt(30, resetsAt))).toMatch(new RegExp(`^7d at 30%: it resets at ${CLOCK}\\.$`));
  });

  test("explains a classic reading with its reset by the clock whatever its pace", { options: { limit_style: "classic" } }, async ($, on) => {
    const resetsAt = localAt(3, 15);
    expect(await explainedAt($, on, sevenResettingAt(89, resetsAt))).toBe(`7d at 89%: it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM.`);
  });

  test("explains a reading without a reset time with its percent used alone", { options: { limit_style: "gauge" } }, async ($, on) => {
    expect(await explainedAt($, on, { kind: "seven_day", percentUsed: 30 })).toBe("7d at 30%.");
  });

  test("explains a reading whose reset has already passed as one without a reset time", { options: { limit_style: "gauge" } }, async ($, on) => {
    expect(await explainedAt($, on, sevenResettingAt(30, new Date(START - 3_600_000)))).toBe("7d at 30%.");
  });

  // The reset clock, on a limit with no pace so that only the clock varies. A reset later today is chosen from START's
  // local hour: the next full hour, or past midnight in the last hour of the day, which names tomorrow.
  const HOURS = ["12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM"];
  const nextHour = new Date(START).getHours() + 1;
  const later: [Date, string] = nextHour < 24 ? [localAt(0, nextHour), HOURS[nextHour] ?? ""] : [localAt(1, 0), `${WEEKDAYS[localAt(1, 0).getDay()]} 12 AM`];
  const midnight = localAt(3, 0);
  for (const [title, resetsAt, clock] of [
    ["later today as the clock alone", ...later],
    ["on another day with its weekday", localAt(2, 15), `${WEEKDAYS[localAt(2, 15).getDay()]} 3 PM`],
    ["off the hour with its minutes", localAt(2, 15, 30), `${WEEKDAYS[localAt(2, 15).getDay()]} 3:30 PM`],
    ["at noon as 12 PM", localAt(2, 12), `${WEEKDAYS[localAt(2, 12).getDay()]} 12 PM`],
    ["at midnight as 12 AM", midnight, `${WEEKDAYS[midnight.getDay()]} 12 AM`],
    ["at 14:59:59 rounded up to 3 PM", localAt(2, 14, 59, 59), `${WEEKDAYS[localAt(2, 15).getDay()]} 3 PM`],
    ["at 23:59:40 rounded to the next day's 12 AM", localAt(2, 23, 59, 40), `${WEEKDAYS[localAt(3, 0).getDay()]} 12 AM`],
    ["on today's weekday a week out with next", localAt(7, 9), `next ${WEEKDAYS[localAt(7, 9).getDay()]} 9 AM`],
  ] as const)
    test(`names a reset ${title}`, { options: { limit_style: "classic" } }, async ($, on) => {
      expect(await explainedAt($, on, sevenResettingAt(30, resetsAt))).toBe(`7d at 30%: it resets at ${clock}.`);
    });

  test("names a reset at 23:59:40 today as the next day's 12 AM, not today's", { options: { limit_style: "classic" } }, async ($, on) => {
    const tomorrow = localAt(1, 0);
    const resetsAt = localAt(0, 23, 59, 40);
    expect(await explainedAt($, on, sevenResettingAt(30, resetsAt))).toBe(`7d at 30%: it resets at ${WEEKDAYS[tomorrow.getDay()]} 12 AM.`);
  });

  // The 7d at 100% pauses the 5h: its sentence names the 7d's reset, or none when the 7d has no reset time.
  const FIVE_AT_40: SessionRateLimit = { kind: "five_hour", percentUsed: 40, resetsAt: new Date(START + 3 * 3_600_000).toISOString() };
  test("explains the 5h paused until the 7d resets at its clock time", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    const resetsAt = localAt(2, 15);
    await startWithLimits($, on, [sevenResettingAt(100, resetsAt), FIVE_AT_40]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toBe(`5h at 40%: it is paused until the 7d resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM.`);
    await ui.unmount();
  });

  test("explains the 5h paused without a clock when the 7d has no reset time", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [{ kind: "seven_day", percentUsed: 100 }, FIVE_AT_40]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toBe("5h at 40%: it is paused until the 7d resets.");
    await ui.unmount();
  });


  // One reading, the 7d at 10% resetting 40% of a window after START, drawn with the clock at two times: at 60% of the
  // window passed r is 0.17, 83% unused, and at 61% passed, 1h41m later, r is 0.16, 84% unused. The percent used stays
  // at the reading's 10%, so only the clock moves the pace.
  for (const [advancedBy, unused] of [
    [0, 83],
    [0.01 * SEVEN_DAYS, 84],
  ] as const)
    test(`draws the same 7d reading at the clock's time as ${unused}% unused`, { options: { limit_style: "gauge" } }, async ($, on) => {
      const resetsAt = new Date(START + 0.4 * SEVEN_DAYS);
      stubHint(on, START);
      // Moved before the session starts: once it has, each 100 ms frame of the tick would run on the way.
      await clockOn(on).advance(advancedBy);
      await startWithLimits($, on, [sevenResettingAt(10, resetsAt)]);
      const ui = await mountHint($);
      expect(await explanationOf(ui, "limit_7d")).toMatch(new RegExp(`^7d at 10%: at this pace it resets at ${CLOCK} with ~${unused}% unused\\.$`));
      await ui.unmount();
    });

  // With half the 7d gone, 52% is r 1.04, within 0.05 of 1, and 53% is r 1.06, just past it.
  for (const [title, used, shown, hidden] of [
    ["explains a limit within 0.05 of its pace as reaching its target as it resets", 52, /reaches its target as it resets/, /runs out|unused/],
    ["explains a limit just over 0.05 past its pace as running out, not on pace", 53, /runs out/, /on pace/],
  ] as const)
    test(title, { options: { limit_style: "gauge" } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [reading("seven_day", used, 0.5)]);
      const ui = await mountHint($);
      const explanation = await explanationOf(ui, "limit_7d");
      expect(explanation).toMatch(shown);
      expect(explanation).not.toMatch(hidden);
      await ui.unmount();
    });

  // 51% with 5% of the 7d gone is over pace: a tenth of the window no longer waits for the pace to show.
  test("explains a limit with its pace while less than a tenth of its window has passed", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 51, 0.05)]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_7d")).toMatch(/^7d at 51%: at this pace it runs out in \d+[hdm]/);
    await ui.unmount();
  });

  // Over pace with a usable reading: classic draws no pace, so its words say none; lanes is a pace style and says it.
  for (const [style, shown] of [
    ["classic", new RegExp(`^7d at 51%: it resets at ${CLOCK}\\.$`)],
    ["lanes", new RegExp(`^7d at 51%: at this pace it runs out in \\d+d\\d+h, 2d10h before it resets at ${CLOCK}\\.$`)],
  ] as const)
    test(`explains an over-pace limit ${style === "classic" ? "with no pace words" : "with its pace"} at limit_style ${style}`, { options: { limit_style: style } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [reading("seven_day", 51, 1 / 3)]);
      const ui = await mountHint($);
      expect(await explanationOf(ui, "limit_7d")).toMatch(shown);
      await ui.unmount();
    });

  // The 5h's coupling to the 7d. Each reading is 5h used, its reset, 7d used and its reset, the resets in ms from the
  // test's start. The first starts the session, each later one comes in a response, and the last is a second old.
  type Reading = [five: number, fiveResetsIn: number, seven: number, sevenResetsIn: number];
  const HOUR = 3_600_000;
  const DAYS_3 = 72 * HOUR;
  const fedReadings = async ($: Engine, on: On, readings: Reading[]) => {
    const start = clockOn(on).now();
    const limitsOf = ([five, fiveIn, seven, sevenIn]: Reading): SessionRateLimit[] => [
      { kind: "five_hour", percentUsed: five, resetsAt: new Date(start + fiveIn).toISOString() },
      { kind: "seven_day", percentUsed: seven, resetsAt: new Date(start + sevenIn).toISOString() },
    ];
    const [first, ...rest] = readings.map(limitsOf);
    // One array the session's usage answers from, so a poll between two responses reads the latest of them again.
    const limits = [...(first ?? [])];
    // Core echoes what moved.
    on("session.measure", (_$, e) => ({ changed: e.changed }));
    await startWithLimits($, on, limits);
    for (const next of rest) {
      limits.splice(0, limits.length, ...next);
      await $.session.measure({ context: { window: 1_000_000 }, rateLimits: next, changed: ["rateLimits"] });
    }
  };

  // 10% to 25% of the 5h while the 7d goes 40.0% to 41.5%: k 0.1. A later 5h window at 5% with the 7d at 96% has 4% of
  // the 7d left, 40 points of 5h at k 0.1: a target of 45%. At 60% of that window, r is 5 / 27, under pace: 5% reaches
  // 8.3% by the reset, which costs the 7d 0.3 of its 4%, ~4% left.
  test("measures k from a 15-point 5h rise within one window and bounds a later window's 5h target by it", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, HOUR, 40, DAYS_3],
      [25, HOUR, 41.5, DAYS_3],
      [5, 2 * HOUR, 96, DAYS_3],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toContain("the 7d still has ~4% left when the 5h resets");
    await ui.unmount();
  });

  // 10% to 10.4% of the 5h while the 7d goes 40% to 41%: k 1 / 0.4, 2.5, a rise of under a point counts. The 5h's target is
  // 10.4 + 59 / 2.5 = 34%. At 60% of its window, r is 10.4 / 20.4, under pace, and 7d has 59 - 2.5 * 6.93 = ~42% left.
  test("measures k from a 0.4-point 5h rise and bounds the 5h target by it", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 2 * HOUR, 40, DAYS_3],
      [10.4, 2 * HOUR, 41, DAYS_3],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: at this 5h pace the 7d still has ~42% left when the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // k 0.1 from the first two readings. The third reading's 5h is back at the window's first 10% while the 7d reads 96%: a
  // rise of 0 that takes no sample, so k stays 0.1 and the 5h's target is 10 + 4 / 0.1 = 50%. At 60% of the window 10% is
  // under pace, and the 7d has 4 - 0.1 * 6.67 = ~3% left. A sample would divide by the zero rise.
  test("leaves k unchanged by a 5h rise of 0", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 2 * HOUR, 40, DAYS_3],
      [25, 2 * HOUR, 41.5, DAYS_3],
      [10, 2 * HOUR, 96, DAYS_3],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: at this 5h pace the 7d still has ~3% left when the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // k 0.1 from the first two readings. The third has the 5h 15 points above the window's first 10%, and the 7d 2 points below
  // its first 40%: a sample of -2 / 15 would make k negative, and the 5h's target below its use. No sample is taken, so k
  // stays 0.1, the target stays 100%, and at 60% of the window 25% is ~58% unused.
  test("leaves k unchanged by a 7d drop during a 5h rise", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 2 * HOUR, 40, DAYS_3],
      [25, 2 * HOUR, 41.5, DAYS_3],
      [25, 2 * HOUR, 38, DAYS_3],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toContain("~58% unused");
    await ui.unmount();
  });

  // 10% to 25% of the 5h while the 7d goes 80% to 92%. With its reset moved 60 seconds the pair gives no k: the 5h's
  // target stays 100%, and at 60% of its window 25% is ~58% unused. Taken as a sample, k 0.8 would make it 35%, over pace.
  test("takes no sample of k across a 7d reset that moved by 60 seconds", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 2 * HOUR, 80, DAYS_3],
      [25, 2 * HOUR, 92, DAYS_3 + 60_000],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toContain("~58% unused");
    await ui.unmount();
  });

  // The same pair with the 7d's reset moved 59 seconds is one 7d window: k is 12 / 15, 0.8, which leaves the 5h 8% of the
  // 7d's worth, 10 points: a target of 35%, which 25% at 60% of its window is over.
  test("takes a sample of k across a 7d reset that moved by under 60 seconds", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 2 * HOUR, 80, DAYS_3],
      [25, 2 * HOUR, 92, DAYS_3 + 59_000],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(/the 7d runs out in \d+h\d+m, 4[78]m before the 5h resets/);
    await ui.unmount();
  });

  // 10% to 20% of the 5h while the 7d goes 40% to 45%: k 0.5. A later 5h window at 20% with the 7d at 90%, which resets
  // days after it: 20 + 10 / 0.5, a target of 40%. At 60% of the window r is 20 / 24, under pace with ~17% unused: 2 of
  // the 10 halves left of the pipe. Against 100% it would be 7.
  test("draws the 5h gauge against the target the 7d can still pay for", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, HOUR, 40, DAYS_3],
      [20, HOUR, 45, DAYS_3],
      [20, 2 * HOUR, 90, DAYS_3],
    ]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "five_hour")).bar).toBe("    █│     ");
    await ui.unmount();
  });

  // The two readings of a 5h window that measure k 0.5, as above; a later window's reading follows them.
  const K_HALF: Reading[] = [
    [10, HOUR, 40, DAYS_3],
    [20, HOUR, 45, DAYS_3],
  ];
  const SLATE = "#94a3b8";
  const AMBER = "#fbbf24";

  // The par left is what the target leaves by now: at a target of 40% with 60% of the window gone, 76%, 7 of the 10
  // cells of the time lane; the usage, 20%, is 0.4 cells behind the par, 24%, which spares none. Against 100% the par
  // left would be 40%, 4 cells, and the usage 4 cells behind par would draw 4 spare cells.
  test("draws the 5h lanes' time lane at the par left of the target the 7d can still pay for", { options: { limit_style: "lanes" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [20, 2 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    const lanes = await limitTagOf(ui, "five_hour");
    expect(lanes.backgrounds.filter((c) => c !== GREY)).toHaveLength(7);
    expect(lanes.colors).not.toContain(SPARE);
    await ui.unmount();
  });

  // The same reading's par left, 76%, rounds to 8 of the 10 cells: the notch sits on the 9th's left edge. Against 100%
  // it would sit on the 5th's.
  test("notches the 5h lane at the par left of the target the 7d can still pay for", { options: { limit_style: "notch" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [20, 2 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "five_hour")).bar.indexOf("▏")).toBe(8);
    await ui.unmount();
  });

  // A later 5h window at 37% halfway through, the 7d at 90%: a target of 57%, which 37% is over, r 1.3. Its par left,
  // 71.5%, is 7 cells (notch, rounded); the usage left, 63%, is 6, so the 7th cell is spent ahead of pace, amber.
  // Against 100% it would be under pace: a par left of 50%, 5 cells, the 6th cell slate.
  for (const [style, notched] of [["notch", 7]] as const)
    test(`draws the 5h ${style} over pace, amber, against the target the 7d can still pay for`, { options: { limit_style: style } }, async ($, on) => {
      stubHint(on, START);
      await fedReadings($, on, [...K_HALF, [37, 2.5 * HOUR, 90, DAYS_3]]);
      const ui = await mountHint($);
      const tag = await limitTagOf(ui, "five_hour");
      expect(tag.backgrounds[6]).toBe(AMBER);
      expect(tag.backgrounds).not.toContain(SLATE);
      expect(tag.bar.indexOf("▏")).toBe(notched);
      await ui.unmount();
    });

  // The same reading on lanes: the par left, 71.5%, lights 7 cells of the time lane. The par is 28.5%, so the usage is
  // 0.85 cells ahead, which impacts the last of the token lane's 6 cells, amber. Against 100% it would be 1.3 cells
  // behind, and that cell spare.
  test("draws the 5h lanes over pace, amber, against the target the 7d can still pay for", { options: { limit_style: "lanes" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [37, 2.5 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    const lanes = await limitTagOf(ui, "five_hour");
    expect(lanes.colors.filter((c) => c !== GREY)).toHaveLength(6);
    expect(lanes.colors[5]).toBe(AMBER);
    expect(lanes.backgrounds.filter((c) => c !== GREY)).toHaveLength(7);
    expect(lanes.colors).not.toContain(SPARE);
    await ui.unmount();
  });

  // 10% to 24% of the 5h while the 7d goes 80% to 89%: k 9 / 14. The 7d resets in 1 hour, before the 5h window ends in
  // 3, so the 5h's target stays 100%: at 40% of its window 24% is ~40% unused. Bounded, it would be 41%, over pace.
  test("keeps the 5h target at 100% when the 7d resets before the 5h window ends", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [
      [10, 3 * HOUR, 80, HOUR],
      [24, 3 * HOUR, 89, HOUR],
    ]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toContain("~40% unused");
    await ui.unmount();
  });

  // A session's first reading measures no k: with the 7d at 90%, the 5h's target is still 100%, and at 60% of its window
  // 20% is ~67% unused.
  test("keeps the 5h target at 100% until this session has measured k", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [[20, 2 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toContain("~67% unused");
    await ui.unmount();
  });

  // k 0.5 and the 7d at 90%, resetting days after the 5h window: the 5h's target is 40% at 20%, 30% at 10%. The sentence
  // names the 7d at the 5h's pace. The clock decides a minute of a time counted from now, so `1h0m` may read `59m`.
  // 20% with 1 hour of the 5h's 5 gone reaches 40% 1 hour from now, 3 before it resets.
  test("explains the bounded 5h over its target with when the 7d runs out and how long before the 5h resets that is", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [20, 4 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 20%: at this 5h pace the 7d runs out in (?:1h0m|59m), (?:3h0m|2h59m) before the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // The same reading warns: the bounded 5h reaches its 40% target in 1 hour, 3 before it resets, and the warning names the 7d.
  test("warns of a bounded 5h that reaches its target before it resets with the sentence that names the 7d", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [20, 4 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    const explain = must(await ui.find({ type: "Box", key: "explain" }), "the explanation line");
    expect(shownIn(explain)).toMatch(new RegExp(`^\\uf071 5h at 20%: at this 5h pace the 7d runs out in (?:1h0m|59m), (?:3h0m|2h59m) before the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // 10% with half the window gone is 20% at the reset, 10 points of 5h that cost the 7d 5: 5% of it is left.
  test("explains the bounded 5h under its target with the share of the 7d left when it resets", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [10, 2.5 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: at this 5h pace the 7d still has ~5% left when the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // 20% with half the window gone reaches 40% as it resets: r is 1.
  test("explains the bounded 5h on its target as the 7d running out as the 5h resets", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [20, 2.5 * HOUR, 90, DAYS_3]]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 20%: at this 5h pace the 7d runs out as the 5h resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // While the 7d is used up the 5h cannot be spent. 10% of the 5h with 60% of its window gone would fill 8 halves left of
  // the pipe; paused it draws as a gauge without a pace. The 7d resets in 52.5 hours.
  const SEVEN_USED_UP = { kind: "seven_day", percentUsed: 100, resetsAt: new Date(START + 52.5 * HOUR).toISOString() } satisfies SessionRateLimit;
  test("draws the 5h gauge paused, empty with its pipe dim, while the 7d is at 100%", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [SEVEN_USED_UP, reading("five_hour", 10, 0.6)]);
    const ui = await mountHint($);
    const gauge = await limitTagOf(ui, "five_hour");
    expect(gauge.badge).toBe(" 5h 10% ");
    expect(gauge.bar).toBe("     │     ");
    expect(gauge.colors).toEqual([...Array(5).fill(GREY), DIM, ...Array(5).fill(GREY)]);
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: it is paused until the 7d resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // With k measured and the 7d at 100%, the 5h's target is its own percent used: at 0% its pace would be 0 / 0. Paused,
  // it draws none, so no NaN reaches the gauge or the words. The 7d resets in 3 days.
  test("draws the 5h at 0% paused with no NaN once k is measured and the 7d is at 100%", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await fedReadings($, on, [...K_HALF, [0, 2 * HOUR, 100, DAYS_3]]);
    const ui = await mountHint($);
    const gauge = await limitTagOf(ui, "five_hour");
    expect(gauge.badge).toBe(" 5h 0% ");
    expect(gauge.colors).toEqual([...Array(5).fill(GREY), DIM, ...Array(5).fill(GREY)]);
    const explanation = await explanationOf(ui, "limit_5h");
    expect(explanation).not.toContain("NaN");
    expect(explanation).toMatch(new RegExp(`^5h at 0%: it is paused until the 7d resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // Paused, neither lane of `lanes` nor the usage of `notch` draws, dim or lit, and the notch is gone.
  for (const [style, bar] of [["lanes", "▀".repeat(10)], ["notch", " ".repeat(10)]] as const)
    test(`draws the 5h ${style} paused with every cell empty while the 7d is at 100%`, { options: { limit_style: style } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [SEVEN_USED_UP, reading("five_hour", 10, 0.6)]);
      const ui = await mountHint($);
      const tag = await limitTagOf(ui, "five_hour");
      expect(tag.bar).toBe(bar);
      expect([...tag.colors, ...tag.backgrounds]).toEqual(Array(20).fill(GREY));
      await ui.unmount();
    });

  // Classic draws no pace, so a used-up 7d leaves its 5h bars as they were: 10% used lights 9 of 10 bottom halves, and
  // 45% of the window still to go 4 top halves. Its explanation says nothing of a pause.
  test("leaves the classic 5h bars and explanation as they were while the 7d is at 100%", async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [SEVEN_USED_UP, reading("five_hour", 10, 0.55)]);
    const ui = await mountHint($);
    expect(litCells(elements(must(await ui.find({ type: "Box", key: "five_hour" }), "the 5h tag").children).slice(1))).toBe("BBBBUUUUU_");
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: it resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // The 5h names its own reset, tomorrow at 3 PM, and not the used-up 7d's, in 3 days at 9 AM.
  test("names the classic 5h's own reset, not the 7d's, while the 7d is at 100%", async ($, on) => {
    stubHint(on, START);
    const fiveResetsAt = localAt(1, 15);
    await startWithLimits($, on, [sevenResettingAt(100, localAt(3, 9)), { kind: "five_hour", percentUsed: 10, resetsAt: fiveResetsAt.toISOString() }]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_5h")).toBe(`5h at 10%: it resets at ${WEEKDAYS[fiveResetsAt.getDay()]} 3 PM.`);
    await ui.unmount();
  });

  // This session last heard the 7d at 80%, but another session's transcript has its refusal on the 7d, resetting in 52.5
  // hours: the 7d is used up all the same.
  test("draws the 5h gauge paused while a refusal on the 7d is in force below 100%", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    const refusal = JSON.stringify({
      type: "assistant",
      error: "rate_limit",
      apiError: "usage_limit_reached",
      quotaLimits: { status: "rejected", rateLimitType: "seven_day", resetsAt: Math.floor((clockOn(on).now() + 52.5 * HOUR) / 1000) },
    });
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("process.run", (_$, e) => ({
      value: { exitCode: e.argv[0] === "sh" ? 0 : 1, stdout: e.argv[0] === "sh" ? `${refusal}\n` : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
    }));
    await startWithLimits($, on, [{ ...SEVEN_USED_UP, percentUsed: 80 }, reading("five_hour", 10, 0.6)]);
    const ui = await mountHint($);
    await caughtUp(on, ui);
    expect((await limitTagOf(ui, "five_hour")).bar).toBe("     │     ");
    expect(await explanationOf(ui, "limit_5h")).toMatch(new RegExp(`^5h at 10%: it is paused until the 7d resets at ${CLOCK}\\.$`));
    await ui.unmount();
  });

  // The run-out warning reads the limits as the tags do and speaks the explanation's sentence. The warning is what the
  // explanation line shows in its flow, after its sign.
  const warnedOf = async ($: Engine, on: On, limits: SessionRateLimit[]) => {
    stubHint(on, START);
    await startWithLimits($, on, limits);
    const ui = await mountHint($);
    const warning = shownIn(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line"));
    await ui.unmount();
    return warning;
  };

  // The 7d at 89% with its reset 3 days out at 3 PM local is over pace by more than 0.05 whatever the time of day, so the
  // warning shows for it, and the hover on the 7d tag reveals what it says. Both are read from one drawing of the line.
  for (const style of ["gauge", "lanes", "notch"])
    test(`says in the warning what the hovered 7d explanation says, at limit_style ${style}`, { options: { limit_style: style } }, async ($, on) => {
      stubHint(on, START);
      await startWithLimits($, on, [sevenResettingAt(89, localAt(3, 15))]);
      const ui = await mountHint($);
      const [warning, ...overlays] = elements(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line").children);
      const hovered = flat(overlays.find((e) => scopeOf(e) === "explain-limit_7d"));
      expect(flat(warning)).toBe(`\uf071 ${hovered}`);
      expect(hovered).toMatch(/^7d at 89%: at this pace it runs out in /);
      await ui.unmount();
    });

  // The 7d at 99.99% with about half its window passed: its run-out falls under a minute from now, so it warns as any moment.
  test("warns of a limit whose run-out falls under a minute from now as running out any moment", async ($, on) => {
    const resetsAt = localAt(3, 15);
    expect(await warnedOf($, on, [sevenResettingAt(99.99, resetsAt)])).toMatch(new RegExp(`^\\uf071 7d at 100%: at this pace it runs out any moment, \\d+d\\d+h before it resets at ${WEEKDAYS[resetsAt.getDay()]} 3 PM\\.$`));
  });

  // The 7d at 100% pauses the 5h, which is at 70% with 2 hours to its reset, over pace: it does not
  // warn, in a style that draws the pause and in classic, which does not.
  for (const style of ["classic", "gauge"])
    test(`does not warn of a 5h paused while the 7d is at 100%, at limit_style ${style}`, { options: { limit_style: style } }, async ($, on) => {
      const fiveAt70 = { kind: "five_hour", percentUsed: 70, resetsAt: new Date(START + 2 * HOUR).toISOString() } satisfies SessionRateLimit;
      expect(await warnedOf($, on, [SEVEN_USED_UP, fiveAt70])).toBe("");
    });

  // Half the 7d gone and 51.4% used is r 1.03: over pace, though the hover reads it as on pace, reaching its target as it
  // resets. The warning still shows, with the sentence for a limit that runs out.
  test("warns of a limit just over its pace with the sentence that says it runs out, where the hover says on pace", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 51.4, 0.5)]);
    const ui = await mountHint($);
    const [warning, ...overlays] = elements(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line").children);
    expect(flat(overlays.find((e) => scopeOf(e) === "explain-limit_7d"))).toMatch(/reaches its target as it resets/);
    expect(flat(warning)).toMatch(/^\uf071 7d at 51%: at this pace it runs out in /);
    await ui.unmount();
  });

  // A session refused on the 7d until tomorrow counts as at 100%, though its last reading was 98% and over pace.
  test("does not warn of a 7d another session was refused on, whose last reading is over pace", async ($, on) => {
    stubHint(on, START);
    const refusal = JSON.stringify({
      type: "assistant",
      error: "rate_limit",
      apiError: "usage_limit_reached",
      quotaLimits: { status: "rejected", rateLimitType: "seven_day", resetsAt: Math.floor((clockOn(on).now() + 24 * HOUR) / 1000) },
    });
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("process.run", (_$, e) => ({
      value: { exitCode: e.argv[0] === "sh" ? 0 : 1, stdout: e.argv[0] === "sh" ? `${refusal}\n` : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
    }));
    await startWithLimits($, on, [sevenResettingAt(98, localAt(3, 15))]);
    const ui = await mountHint($);
    // Until the refusal is read the 98% warns, so wait for it: the 7d's explanation then reads it at 100%.
    await caughtUp(on, ui);
    expect(await explanationOf(ui, "limit_7d")).toMatch(/^7d at 100%/);
    expect(shownIn(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line"))).toBe("");
    await ui.unmount();
  });

  // A value on the grey says hovering shows more. Every chip has an explanation, so its value stands on the grey while
  // the explanation line can show it, the turns before any subagent and a cold cache included, and never without it.
  const valueBackgrounds = async (ui: { find: Mounted["find"] }, key: string) =>
    elements(elements(must(await ui.find({ type: "Box", key }), `the ${key} chip`).children)[1]?.children ?? []).map((glyph) => glyph.props.backgroundColor);
  for (const [title, options, agents, cachedAgo, keys, grey] of [
    ["keeps each chip's value on the grey while explain_row is on, the turns before any subagent and a cold cache included", {}, false, 120, ["turns", "tokens", "cache"], "#373a48"],
    ["keeps each chip's value on the grey while explain_row is on, the subagents' costs and a warm cache included", {}, true, 10, ["turns", "tokens", "agents", "cache"], "#373a48"],
    ["stands no chip's value on the grey with explain_row off", { explain_row: false }, true, 10, ["turns", "tokens", "agents", "cache"], undefined],
  ] as const)
    test(title, { options }, async ($, on) => {
      const ui = await explained($, on, { agents, cachedAgo });
      for (const key of keys) expect(new Set(await valueBackgrounds(ui, key))).toEqual(new Set([grey]));
      await ui.unmount();
    });

  test("still reveals each tag's explanation in the explanation line with limit_forecast off, which shows no warning", { options: { limit_forecast: false } }, async ($, on) => {
    const ui = await explained($, on);
    expect(shownIn(must(await ui.find({ type: "Box", key: "explain" }), "the explanation line"))).toBe("");
    expect((await explanationsIn(ui)).map(scopeOf)).toEqual(EXPLAINED.map(([tag]) => `explain-${tag}`));
    await ui.unmount();
  });

  // The scope is the plugin's across sites, so a tag above the prompt reveals its explanation in the line under it.
  test("reveals the explanation of a tag in a row above the prompt in the explanation line under it", { options: { layout: `${STATUS};prompt;${GIT};fresh;compact;explain` } }, async ($, on) => {
    const below = await explained($, on);
    expect(await below.find({ type: "Box", key: "context" })).toBeUndefined();
    expect((await explanationsIn(below)).map(scopeOf)).toContain("explain-context");
    await below.unmount();
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await drawnTag(above, "context")).toMatchObject({ hover: { scope: "explain-context" } });
    await above.unmount();
  });

  const idle = [subagent("completed")];
  const working = [subagent("running")];
  for (const [title, files, offered, lastAgo, options, agents, prompted, handoffBefore = 0.5, ahead = 0] of [
    ["offers a fresh session from this session's handoff file once the cache is cold", ["HANDOFF-2026-10-16-0900.md", "HANDOFF-2026-10-16-1200.md"], true, 120, {}, idle],
    ["offers none from a handoff file older than the session", ["HANDOFF-2026-10-16-0900.md"], false, 120, {}, idle],
    // Warm, the next prompt reads the 1,000,000 tokens for $0.20, less than the fresh start's $0.24.
    ["offers none while the cache is warm and reading it costs less than a fresh start", ["HANDOFF-2026-10-16-1200.md"], false, 10, {}, idle],
    ["offers none once the person has prompted since a handoff, with the cache warm", ["HANDOFF-2026-10-16-1200.md"], false, 10, {}, idle, true],
    ["offers none when the person turned fresh_start off", ["HANDOFF-2026-10-16-1200.md"], false, 120, { fresh_start: false }, idle],
    ["offers none while a subagent is at work", ["HANDOFF-2026-10-16-1200.md"], false, 120, {}, working],
    // The handoff's file is written before the reply that closes its turn: half a minute is that reply, four minutes still is.
    ["offers a handoff only its own closing reply follows, up to five minutes after the file", ["HANDOFF-2026-10-16-1200.md"], true, 120, {}, idle, false, 4],
    ["offers none from a handoff that later requests have moved past, once the cache is cold", ["HANDOFF-2026-10-16-1200.md"], false, 120, {}, idle, false, 60],
    ["offers none from a handoff that later requests have moved past, with the cache warm", ["HANDOFF-2026-10-16-1200.md"], false, 10, {}, idle, false, 60],
    // The cache is cold by the engine's clock, two hours past START, by which it is still warm.
    ["offers one once the engine's clock has the cache cold", ["HANDOFF-2026-10-16-1200.md"], true, 10, {}, idle, false, 0.5, 120],
  ] as const)
  test(title, { options }, async ($, on) => {
    // The engine's clock runs `ahead` minutes past START, which times the transcript and the files.
    const clock = clockOn(on, START + ahead * 60_000);
    stubHint(on);
    // The session's first request had a 20,000-token prompt; its last, two hours ago, wrote 1,000,000 for an hour: cold,
    // and $8.00 to write again on Opus 5.5. The 0900 file is from before this session started, the 1200 one (40,000
    // bytes, about 10,000 tokens) after: fresh from it is 30,000 tokens at the same rate, $0.24.
    const written = (tokens: number) => ({ input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: tokens } });
    const row = (id: string, minutesAgo: number, tokens: number) =>
      JSON.stringify({ type: "assistant", requestId: id, timestamp: new Date(START - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage: written(tokens) } });
    const transcript = [row("r1", 150, 20_000), row("r2", lastAgo, 1_000_000)].join("\n");
    const file = (name: string, mtimeMs: number) => ({ name, kind: "file" as const, size: 40_000, mtimeMs, isLink: false });
    // The 0900 file is older than the session; the others were written `handoffBefore` minutes before its last request.
    const handoffAt = START - (lastAgo + handoffBefore) * 60_000;
    const ran: string[] = [];
    const sent: string[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 5_000, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("session.root", () => ({ value: "/work" }));
    on("agent.list", () => ({ value: agents }));
    on("fs.list", () => ({ value: [...files.map((name) => file(name, name.endsWith("0900.md") ? 1_000 : handoffAt)), file("README.md", 9_500)] }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      yield { stream: "stdout", text: transcript };
      return { value: { code: 0, signal: null } };
    });
    on("command.run", (_$, e) => {
      ran.push(e.command);
      return { text: "" };
    });
    on("prompt.submit", (_$, e) => {
      sent.push(e.text);
      return { text: e.text };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    if (prompted) await typeAtComposer($, "go on");
    const ui = await mountHint($);
    // The handoff file is looked for at a poll, every 2 s.
    await clock.advance(2_000);
    await caughtUp(on, ui);
    const button = (await ui.findAll({ type: "Button", key: "resume" }))[0];
    if (!offered) {
      expect(button).toBeUndefined();
      return ui.unmount();
    }
    expect(button).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^ Cache cold: next message \$8\.00, fresh start ~\$0\.24 $/ })).toBeDefined();
    // Its own line, led by a red $ where the engine's line has its mode glyph.
    // (The cost chips draw their own $ glyphs, on the chips' grey; this one stands bare.)
    const marks = await ui.findAll({ type: "Text", text: "$" });
    expect(marks.some((t) => t.props.color === "#f87171" && t.props.backgroundColor === undefined)).toBe(true);
    // The button's face is one Text, half-block bars at both ends, so a pointer over it inverts all of it.
    expect((await ui.find({ type: "Text", text: /^▌ .* Start fresh ▐$/ }))?.props).toMatchObject({ color: "#c7d2fe", backgroundColor: "#4f46e5" });
    // The cross after it is the secondary look.
    expect((await ui.find({ type: "Text", text: "▌ ✕ ▐" }))?.props).toMatchObject({ color: "#cbd5e1", backgroundColor: "#334155" });
    await ui.press({ key: "resume" });
    expect(ran).toEqual(["clear"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/work/HANDOFF-2026-10-16-1200.md");
    await ui.unmount();
    // A draft in the prompt keeps the line, and its cross hides it.
    const drafting = await mountHint($, true);
    expect((await drafting.findAll({ type: "Button", key: "resume" }))[0]).toBeDefined();
    await drafting.press({ key: "dismiss" });
    expect((await drafting.findAll({ type: "Button", key: "resume" }))[0]).toBeUndefined();
    await drafting.unmount();
  });

  for (const [title, tokens, offered, options, agents] of [
    ["offers a compaction once 90% of the smart zone is used", 190_000, true, {}, idle],
    ["offers one past the smart zone too", 250_000, true, {}, idle],
    ["words just past the smart zone as just into the dumb zone", 220_000, true, {}, idle],
    ["words twice the smart zone as well into the dumb zone", 400_000, true, {}, idle],
    ["words 2.5 times the smart zone as deep into the dumb zone", 500_000, true, {}, idle],
    ["words 3.5 times the smart zone as very deep into the dumb zone", 700_000, true, {}, idle],
    ["offers none below 90% of the smart zone", 170_000, false, {}, idle],
    ["sizes the offer by the smart_zone_tokens option", 95_000, true, { smart_zone_tokens: 100_000 }, idle],
    ["offers none when the person turned compact_hint off", 190_000, false, { compact_hint: false }, idle],
    ["offers none with the smart zone off", 190_000, false, { smart_zone: false }, idle],
    ["offers one while a subagent is at work: the command queues until the session is idle", 190_000, true, {}, working],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on, START);
    const ran: string[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("agent.list", () => ({ value: agents }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      return { value: { code: 0, signal: null } };
    });
    on("command.run", (_$, e) => {
      ran.push(e.command);
      return { text: "" };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    const button = (await ui.findAll({ type: "Button", key: "compact" }))[0];
    if (!offered) {
      expect(button).toBeUndefined();
      return ui.unmount();
    }
    expect(button).toBeDefined();
    expect((await ui.findAll({ type: "Link" })).some((l) => l.props.href === "https://www.aihero.dev/ai-coding-dictionary/smart-zone")).toBe(true);
    expect(await ui.find({ type: "Text", text: tokens >= 200_000 ? /^ You're out of the $/ : /^ You're nearly out of the $/ })).toBeDefined();
    expect((await ui.find({ type: "Text", text: /^▌ .* Compact ▐$/ }))?.props).toMatchObject({ color: "#c7d2fe", backgroundColor: "#4f46e5" });
    const depth = new Map([[220_000, "just into"], [250_000, "just into"], [400_000, "well into"], [500_000, "deep into"], [700_000, "very deep into"]]).get(tokens);
    if (depth) expect(await ui.find({ type: "Text", text: `. Same model, ${depth} the dumb zone now. ` })).toBeDefined();
    await ui.press({ key: "compact" });
    expect(ran).toEqual(["compact"]);
    await ui.unmount();
    // A draft in the prompt keeps the line, and its cross hides it.
    const drafting = await mountHint($, true);
    expect((await drafting.findAll({ type: "Button", key: "compact" }))[0]).toBeDefined();
    await drafting.press({ key: "dismiss" });
    expect((await drafting.findAll({ type: "Button", key: "compact" }))[0]).toBeUndefined();
    await drafting.unmount();
  });

  // A compaction runs as a /compact, the person's or the mod's own, or as Claude Code's own, said by the main spinner.
  // Each start returns how it ends without compacting.
  const COMPACT = { command: "compact", args: "", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 80 } } as const;
  const SPINNER = { word: "Sauteing", message: "Compacting conversation", suffix: "\u2026", mode: "requesting" } as const;
  // A session nearly out of its smart zone, its compaction offer drawn; `offer` finds the offer's button.
  const offered = async ($: Engine, on: On) => {
    stubHint(on, START);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 190_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("agent.list", () => ({ value: idle }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      return { value: { code: 0, signal: null } };
    });
    on("ui.render", { component: "Spinner" }, ($, e) => $.ui.resolve(e).Text({ children: e.props.message ?? e.props.word }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const offer = async () => (await ui.findAll({ type: "Button", key: "compact" }))[0];
    await caughtUp(on, ui);
    expect(await offer()).toBeDefined();
    return { ui, offer };
  };
  // The /compact beneath the mod, held until the test ends it.
  type Held = { finish: (r: CommandRunResult) => void; fail: (e: Error) => void };
  for (const [title, start] of [
    ["a /compact that ends", ($: Engine, held: () => Held) => {
      const running = $.command.run(COMPACT);
      return () => (held().finish({ text: "" }), running);
    }],
    ["a /compact that rejects", ($: Engine, held: () => Held) => {
      const running = $.command.run(COMPACT).catch(() => undefined);
      return () => (held().fail(new Error("cancelled")), running);
    }],
    ["Claude Code's own, through the main spinner", async ($: Engine) => {
      const spinner = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Spinner", requestId: "main", props: SPINNER });
      return () => spinner.redraw({ ...SPINNER, message: null });
    }],
  ] as const)
  test(`hides the compaction offer while one runs, and draws it again when it ends without compacting: ${title}`, async ($, on) => {
    let held: Held | undefined;
    on("command.run", () => new Promise<CommandRunResult>((finish, fail) => (held = { finish, fail })));
    const { ui, offer } = await offered($, on);
    const end = await start($, () => must(held, "the held /compact"));
    await caughtUp(on, ui);
    expect(await offer()).toBeUndefined();
    await end();
    await caughtUp(on, ui);
    expect(await offer()).toBeDefined();
    await ui.unmount();
  });

  // The spinner says other things while a /compact runs (`Running PreCompact hooks…`): it clears only what it set.
  test("keeps the compaction offer hidden through a /compact while the spinner says something else", async ($, on) => {
    let held: Held | undefined;
    on("command.run", () => new Promise<CommandRunResult>((finish, fail) => (held = { finish, fail })));
    const { ui, offer } = await offered($, on);
    const running = $.command.run(COMPACT);
    const spinner = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Spinner", requestId: "main", props: { ...SPINNER, message: "Running PreCompact hooks\u2026" } });
    await caughtUp(on, ui);
    expect(await offer()).toBeUndefined();
    must(held, "the held /compact").finish({ text: "" });
    await running;
    await caughtUp(on, ui);
    expect(await offer()).toBeDefined();
    await spinner.unmount();
    await ui.unmount();
  });

  test("keeps the compaction offer while a subagent's spinner says it compacts", async ($, on) => {
    const { ui, offer } = await offered($, on);
    const spinner = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Spinner", requestId: "agent-1", props: SPINNER });
    await caughtUp(on, ui);
    expect(await offer()).toBeDefined();
    await spinner.unmount();
    await ui.unmount();
  });

  // Half a minute, not ten: the clock fires every 100 ms frame on its way, and ten minutes of frames ran 3 to 4 s
  // of a test's 5.
  for (const [title, options, seconds, shown] of [
    ["keeps a dismissed compaction line hidden for the rest of the session", {}, 33, false],
    ["brings a dismissed compaction line back after dismiss_minutes", { dismiss_minutes: 0.5 }, 33, true],
    ["keeps it hidden within dismiss_minutes", { dismiss_minutes: 0.5 }, 27, false],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on, START);
    const clock = clockOn(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 190_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("agent.list", () => ({ value: idle }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      return { value: { code: 0, signal: null } };
    });
    on("prompt.submit", (_$, e) => ({ text: e.text }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    expect((await ui.findAll({ type: "Button", key: "compact" }))[0]).toBeDefined();
    await ui.press({ key: "dismiss" });
    expect((await ui.findAll({ type: "Button", key: "compact" }))[0]).toBeUndefined();
    // A prompt of the person's does not bring it back.
    await typeAtComposer($, "go on");
    await clock.advance(seconds * 1_000);
    await ui.unmount();
    const again = await mountHint($);
    expect(((await again.findAll({ type: "Button", key: "compact" }))[0] !== undefined)).toBe(shown);
    await again.unmount();
  });

  for (const [title, tokens, runs, options, agents] of [
    ["compacts once while idle when 90% of the smart zone is used", 190_000, ["compact"], { auto_compact: true }, idle],
    ["compacts nothing below 90% of the smart zone", 170_000, [], { auto_compact: true }, idle],
    ["compacts nothing with auto_compact off", 190_000, [], {}, idle],
    ["compacts nothing with the smart zone off", 190_000, [], { auto_compact: true, smart_zone: false }, idle],
    ["compacts nothing while a subagent is at work", 190_000, [], { auto_compact: true }, working],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on, START);
    const clock = clockOn(on);
    const ran: string[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("agent.list", () => ({ value: agents }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      return { value: { code: 0, signal: null } };
    });
    on("command.run", (_$, e) => {
      ran.push(e.command);
      return { text: "" };
    });
    on("prompt.submit", (_$, e) => ({ text: e.text }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const polls = async (n: number) => {
      for (let i = 0; i < n; i++) await clock.advance(2_000);
    };
    // No prompt of the person's since the mod loaded: nothing runs.
    await polls(2);
    expect(ran).toEqual([]);
    // A prompt typed at the composer: one compaction, and the polls after it do not run another.
    await typeAtComposer($, "hi");
    await polls(3);
    expect(ran).toEqual(runs);
    await ui.unmount();
  });

  test("runs the handoff skill once before the cache goes cold, while idle and after a prompt of the person's own", async ($, on) => {
    expect(await handoffRuns($, on)).toEqual(["cockpit:handoff"]);
  });

  test("runs the handoff 10 minutes before the cache goes cold while Claude Code's idleCompaction is on", async ($, on) => {
    // 8 minutes left: outside the 5-minute lead, inside the 10-minute one.
    expect(await handoffRuns($, on, { ago: 52 })).toEqual(["cockpit:handoff"]);
  });

  test("waits for the last 5 minutes when idleCompaction is false in settings: none yet at 8 minutes left", async ($, on) => {
    expect(await handoffRuns($, on, { ago: 52, settings: { idleCompaction: false } })).toEqual([]);
  });

  test("runs the handoff at 3 minutes left when idleCompaction is false in settings", async ($, on) => {
    expect(await handoffRuns($, on, { settings: { idleCompaction: false } })).toEqual(["cockpit:handoff"]);
  });

  // The cache clock is the engine's: 7 minutes past START, which times the transcript, a write 52 minutes before START has 1 left.
  test("times the cache by the engine's clock: the handoff runs once that clock leaves less than the lead", async ($, on) => {
    clockOn(on, START + 7 * 60_000);
    expect(await handoffRuns($, on, { ago: 52, settings: { idleCompaction: false } })).toEqual(["cockpit:handoff"]);
  });

  test("runs the handoff for a prompt typed before the module loaded again", async ($, on) => {
    expect(await handoffRuns($, on, { reloaded: true })).toEqual(["cockpit:handoff"]);
  });

  test("runs no handoff when the person turned auto_handoff off", { options: { auto_handoff: false } }, async ($, on) => {
    expect(await handoffRuns($, on)).toEqual([]);
  });

  test("sends no ping at keep_warm_pings 0, the default: the handoff alone runs", async ($, on) => {
    expect(await handoffRuns($, on, { after: 14 })).toEqual(["cockpit:handoff"]);
  });

  test("pings an hour's cache as often as keep_warm_pings allows, then runs the handoff", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { after: 14 })).toEqual(["ping", "ping", "cockpit:handoff"]);
  });

  test("pings a five-minute cache a minute before it expires, and runs the handoff after the last ping", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m-late", after: 14 })).toEqual(["ping", "ping", "cockpit:handoff"]);
  });

  test("pings a five-minute cache no earlier than a minute before it expires", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m", after: 14 })).toEqual([]);
  });

  test("sends no ping and no handoff after it while a subagent is at work", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { after: 14, agents: [subagent("running")] })).toEqual([]);
  });

  test("sends no ping at 98% of the 5h window", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { after: 14, rateLimits: [{ kind: "five_hour", percentUsed: 98 }] })).toEqual([]);
  });

  test("runs no handoff on a five-minute cache", async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m" })).toEqual([]);
  });

  test("runs the handoff on a five-minute-labelled cache that was read back after ten idle minutes", async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m-held" })).toEqual(["cockpit:handoff"]);
  });

  test("runs no handoff at 98% of the 5h window", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "five_hour", percentUsed: 98 }] })).toEqual([]);
  });

  test("runs no handoff with the 7d window used up", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "seven_day", percentUsed: 100 }] })).toEqual([]);
  });

  // The engine's clock runs 2 minutes past START, which times the transcript: a 5h refused until a minute past START has
  // reset by it, and the write 57 minutes before START has a minute left.
  test("runs the handoff once the engine's clock passes the reset of a refused window", async ($, on) => {
    clockOn(on, START + 2 * 60_000);
    on("state.get", { plugin: "cockpit", key: "rejected" }, () => ({ value: { value: { five_hour: START + 60_000 }, version: 1 } }));
    expect(await handoffRuns($, on)).toEqual(["cockpit:handoff"]);
  });

  test("runs no handoff while a subagent is at work", async ($, on) => {
    expect(await handoffRuns($, on, { agents: [subagent("running")] })).toEqual([]);
  });

  test("traces the gate that holds the handoff while its window is open, once, and the start when none does", async ($, on) => {
    const blocked: string[] = [];
    expect(await handoffRuns($, on, { agents: [subagent("running")], trace: blocked })).toEqual([]);
    expect(blocked.map((l) => l.slice(9))).toEqual(["cache window open, no handoff: no prompt of yours in this session", "cache window open, no handoff: a subagent is at work: Explore running"]);
  });

  test("traces the start of a handoff", async ($, on) => {
    const started: string[] = [];
    await handoffRuns($, on, { trace: started });
    // The polls after it find the handoff already run, and say so.
    const lines = started.map((l) => l.slice(9));
    expect(lines[0]).toBe("cache window open, no handoff: no prompt of yours in this session");
    expect(lines[1]).toMatch(/^\d+ s of cache left, handoff started$/);
    expect(lines[2]).toBe("cache window open, no handoff: a handoff already ran since your last prompt");
  });

  // The engine's clock runs 2 minutes past START, which times the transcript, and moves only by the polls' 2 s, so each
  // line is stamped with one of the poll times by it, as HH:MM:SS local.
  test("stamps the handoff trace with the engine's clock", async ($, on) => {
    const start = START + 2 * 60_000;
    clockOn(on, start);
    const lines: string[] = [];
    await handoffRuns($, on, { trace: lines });
    const pad = (n: number) => String(n).padStart(2, "0");
    const polls = Array.from({ length: 10 }, (_, k) => new Date(start + 2_000 * (k + 1))).map((at) => `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(polls).toContain(line.slice(0, 8));
  });

  test("runs the handoff while a subagent only waits, held on a plan's approval or on work listed on its own", async ($, on) => {
    expect(await handoffRuns($, on, { agents: [subagent("waiting")] })).toEqual(["cockpit:handoff"]);
  });

  test("runs the handoff at 90% of the 5h window on Opus", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "five_hour", percentUsed: 90 }] })).toEqual(["cockpit:handoff"]);
  });

  test("runs no handoff at 90% of the 5h window on Fable", async ($, on) => {
    expect(await handoffRuns($, on, { model: "claude-fable-5-1", rateLimits: [{ kind: "five_hour", percentUsed: 90 }] })).toEqual([]);
  });

  test("times no cache across a compaction: the summary shares no prefix with what was cached", async ($, on) => {
    stubHint(on, START);
    const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } };
    const ago = (minutes: number) => new Date(START - minutes * 60_000).toISOString();
    const transcript = [
      JSON.stringify({ type: "assistant", requestId: "r1", timestamp: ago(10), message: { model: "claude-opus-5-5", usage } }),
      JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: ago(5) }),
    ].join("\n");
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      yield { stream: "stdout", text: transcript };
      return { value: { code: 0, signal: null } };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    await caughtUp(on, ui);
    expect(await ui.findAll({ type: "Box", key: "tokens" })).toHaveLength(1);
    expect(await ui.findAll({ type: "Box", key: "cache" })).toHaveLength(0);
    await ui.unmount();
  });

  // The folders, branch and worktree are parts of their own, parted by the default order's gaps, or touching without.
  for (const [options, spelled] of [
    [{}, ["spike › cc-mods", "_1", "⎇ develop ⎇ feat/gitline", "_1", "⎇ spike", "_1"]],
    [{ layout: withGit("folders,branch,worktree,pr,review,comments,sync,conflict,checks,changes") }, ["spike › cc-mods", "⎇ develop ⎇ feat/gitline", "⎇ spike"]],
  ] as const)
  test(`draws the repository row from local git: branch ancestry, worktree, sync, conflict and changes${"layout" in options ? ", with no gaps" : ""}`, { options }, async ($, on) => {
    stubHint(on, START);
    // A branch made off develop in a linked worktree, on no remote, one behind origin/main with a merge that conflicts.
    const out: Record<string, { stdout: string; exitCode?: number }> = {
      "rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
        { stdout: "/r/.git\n/r/.git/worktrees/spike\n/wt/spike\nfeat/gitline\n", exitCode: 128 },
      "symbolic-ref refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/main\n" },
      "config init.defaultBranch": { stdout: "trunk\n" },
      "for-each-ref --count=1 --format=%(refname:short) refs/remotes/*/feat/gitline": { stdout: "" },
      "diff --numstat HEAD": { stdout: "100\t5\ta.ts\n20\t3\tb.ts\n-\t-\tlogo.png\n" },
      "ls-files --unmerged": { stdout: "" },
      "rev-parse --verify origin/main": { stdout: "abc\n" },
      "rev-list --left-right --count HEAD...origin/main": { stdout: "2\t1\n" },
      "merge-tree --write-tree HEAD origin/main": { stdout: "", exitCode: 1 },
      "reflog show feat/gitline --format=%gs": { stdout: "commit: wip\nbranch: Created from refs/heads/develop\n" },
    };
    const ran: string[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/wt/spike" }));
    on("session.cwd", () => ({ value: "/wt/spike/cc-mods" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const [bin, ...args] = e.argv;
      if (bin !== "git") return { value: { exitCode: 1, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
      const key = args.filter((a) => a !== "--no-optional-locks").join(" ");
      ran.push(key);
      const hit = out[key] ?? { stdout: "", exitCode: 1 };
      return { value: { exitCode: hit.exitCode ?? 0, stdout: hit.stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/wt/spike/cc-mods" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    await caughtUp(on, ui);
    expect(await ui.find({ type: "Box", text: "+120 -8 ~2" })).toBeDefined();
    for (const text of ["↑2? ↓1?", "\uf071"]) {
      expect(await ui.find({ type: "Box", text })).toBeDefined();
    }
    // The folders link to their places on disk: the project, the shell's folder, and the checkout (here a worktree)
    // for the branch and the worktree.
    const hrefs = (await ui.findAll({ type: "Link" })).map((l) => l.props.href);
    expect(hrefs).toEqual(["file:///wt/spike", "file:///wt/spike/cc-mods", "file:///wt/spike", "file:///wt/spike"]);
    // Flush: a segment starts at its first glyph, a gap after the one before parting them.
    expect(rowSpelled((await tagRows(ui))[0]).slice(0, spelled.length)).toEqual(spelled);
    // Nothing unknown was asked of git.
    expect(ran.filter((k) => !(k in out))).toEqual([]);
    await ui.unmount();
  });

  test("without a remote, takes init.defaultBranch as the default branch", async ($, on) => {
    stubHint(on, START);
    // A repository with no remote at all, a branch made off trunk.
    const out: Record<string, string> = {
      "rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
        "/r/.git\n/r/.git\n/r\nfeat\n",
      "config init.defaultBranch": "trunk\n",
      "reflog show feat --format=%gs": "branch: Created from refs/heads/trunk\n",
    };
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r" }));
    on("session.cwd", () => ({ value: "/r" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const stdout = out[e.argv.slice(1).filter((a) => a !== "--no-optional-locks").join(" ")];
      return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    await caughtUp(on, ui);
    expect(await ui.find({ type: "Box", text: "⎇ feat" })).toBeDefined();
    expect(await ui.find({ type: "Box", text: "⎇ trunk ⎇ feat" })).toBeUndefined();
    await ui.unmount();
  });

  test("parts the default branch from the folder by the default order's gap, where no ⎇ does", async ($, on) => {
    stubHint(on, START);
    const out: Record<string, string> = {
      "rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
        "/r/cc-mods/.git\n/r/cc-mods/.git\n/r/cc-mods\ntrunk\n",
      "config init.defaultBranch": "trunk\n",
    };
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r/cc-mods" }));
    on("session.cwd", () => ({ value: "/r/cc-mods" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const stdout = out[e.argv.slice(1).filter((a) => a !== "--no-optional-locks").join(" ")];
      return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r/cc-mods" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    await caughtUp(on, ui);
    const rows = await tagRows(ui);
    // The gaps after trunk, before parts with nothing to show, are dropped at the row's end.
    expect(rowSpelled(rows[0])).toEqual(["cc-mods", "_1", "trunk"]);
    await ui.unmount();
  });

  // While the order pane shows, a part with nothing to show draws a made-up value, so it can be placed.
  test("draws every git part while the order pane shows, and only what there is once it closes", async ($, on) => {
    stubHint(on, START);
    const clock = clockOn(on);
    const out: Record<string, string> = {
      "rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
        "/r/cc-mods/.git\n/r/cc-mods/.git\n/r/cc-mods\ntrunk\n",
      "config init.defaultBranch": "trunk\n",
    };
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r/cc-mods" }));
    on("session.cwd", () => ({ value: "/r/cc-mods" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const stdout = out[e.argv.slice(1).filter((a) => a !== "--no-optional-locks").join(" ")];
      return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });
    // The engine's record of the mod's open panes.
    let isOpen = false;
    on("ui.panes", () => ({ value: isOpen ? [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] : [] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r/cc-mods" });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    const glyphs = async () => (await ui.findAll({ type: "Text" })).map(glyph).join("");
    await caughtUp(on, ui);
    expect(await glyphs()).not.toContain("PR #");

    isOpen = true;
    await clock.advance(100);
    await caughtUp(on, ui);
    // The real folder and branch, and made-up values for the rest.
    const spelled = rowSpelled((await tagRows(ui))[0]);
    for (const text of ["cc-mods", "trunk", "⎇ spike", "PR #42", "↑2? ↓1?", "+12 -3 ~2"]) expect(spelled).toContain(text);

    isOpen = false;
    await clock.advance(100);
    await caughtUp(on, ui);
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["cc-mods", "_1", "trunk"]);
    await ui.unmount();
  });

  test("draws every status tag while the order pane shows, and an offer that does not hold as a dim line naming it", async ($, on) => {
    stubHint(on);
    const clock = clockOn(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    let isOpen = false;
    on("ui.panes", () => ({ value: isOpen ? [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] : [] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !(await ui.find({ type: "Text", text: "O" })); i++) await settle();
    const chips = async () => {
      const keys = await Promise.all(["seven_day", "five_hour", "context", "turns", "tokens", "agents", "cache"].map(async (key) => ((await ui.find({ type: "Box", key })) ? [key] : [])));
      return keys.flat();
    };
    expect(await chips()).toEqual([]);

    isOpen = true;
    await clock.advance(100);
    for (let i = 0; i < 50 && (await chips()).length < 7; i++) await settle();
    expect(await chips()).toEqual(["seven_day", "five_hour", "context", "turns", "tokens", "agents", "cache"]);
    expect(await ui.find({ type: "Text", text: /smart zone: compaction: shows when it applies/ })).toBeDefined();
    // The blank explanation line names itself, dim, inside its own line.
    expect((await ui.find({ type: "Box", key: "explain" }))?.text).toMatch(/explanation line/);
    expect((await ui.find({ type: "Text", text: /explanation line/ }))?.props.dimColor).toBe(true);

    isOpen = false;
    await clock.advance(100);
    for (let i = 0; i < 50 && (await chips()).length > 0; i++) await settle();
    expect(await chips()).toEqual([]);
    expect(await ui.find({ type: "Text", text: /shows when it applies/ })).toBeUndefined();
    expect((await ui.find({ type: "Box", key: "explain" }))?.text).toBe("");
    await ui.unmount();
  });

  // No response has come in this session: the samples' resets are set from now, so the pace shows with no reading at all.
  test("draws the 5h sample's pace on a gauge while the order pane shows", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on);
    clockOn(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("ui.panes", () => ({ value: [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !(await ui.find({ type: "Box", key: "five_hour" })); i++) await settle();
    // The sample is 20% used halfway through the window: r 0.4, 60% of the target unused, 6 of 10 halves.
    expect((await limitTagOf(ui, "five_hour")).bar).toBe("  ███│     ");
    await ui.unmount();
  });

  // A /clear fires no session.start; the mod's hook on the command starts the readings and the tick over.
  test("draws the status row in a session a /clear started", async ($, on) => {
    stubHint(on);
    clockOn(on);
    on("command.run", () => ({ text: "" }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("ui.panes", () => ({ value: [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] }));
    await $.command.run({ command: "clear", args: "", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 80 } });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !(await ui.find({ type: "Box", key: "context" })); i++) await settle();
    expect(await ui.find({ type: "Box", key: "context" })).toBeDefined();
    await ui.unmount();
  });

  test("draws the branch's pull request from gh: number, draft, review, comments, conflict and checks", async ($, on) => {
    stubHint(on, START);
    const clock = clockOn(on);
    // Checks: one passed, one failed, one running, one commit status passed.
    const pr = {
      number: 42,
      url: "https://github.com/o/r/pull/42",
      isDraft: true,
      mergeable: "CONFLICTING",
      reviewDecision: "CHANGES_REQUESTED",
      comments: [{}, {}, {}],
      statusCheckRollup: [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/runs/7" },
        { __typename: "StatusContext", state: "ERROR", targetUrl: "https://ci.example/build/9" },
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
        { __typename: "StatusContext", state: "SUCCESS" },
      ],
    };
    const out: Record<string, string> = {
      "git rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
        "/r/.git\n/r/.git\n/r\nfeat\norigin/feat\n",
      "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "git rev-list --left-right --count HEAD...origin/feat": "2\t1\n",
      "git remote get-url origin": "git@github.com:o/r.git\n",
      "gh pr view --json number,url,isDraft,mergeable,reviewDecision,statusCheckRollup,comments,state": JSON.stringify(pr),
    };
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r" }));
    on("session.cwd", () => ({ value: "/r" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const stdout = out[e.argv.filter((a) => a !== "--no-optional-locks").join(" ")];
      return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    // The number links to the PR's page; the branch, a link to its checkout, holds its own text.
    const href = async (to: string) => (await ui.findAll({ type: "Link" })).some((l) => l.props.href === to);
    await caughtUp(on, ui);
    expect(await href("https://github.com/o/r/pull/42")).toBe(true);
    expect(await href("file:///r")).toBe(true);
    // Behind links the remote branch's history; ahead, only local, links nothing. Each failure is a cross of its own,
    // linking its check (a check run's details, a status's target); running and passed are counts on the checks tab.
    expect(await href("https://github.com/o/r/commits/feat")).toBe(true);
    const links = (await ui.findAll({ type: "Link" })).map((l) => [l.props.href, elements(l.children).map((t) => t.children[0]).join("")]);
    expect(links.filter(([href]) => typeof href === "string" && href.startsWith("https://github.com/o/r/"))).toEqual([
      ["https://github.com/o/r/pull/42", "PR #42"],
      ["https://github.com/o/r/commits/feat", "↓1"],
      ["https://github.com/o/r/pull/42/checks", "\uf4441"],
      ["https://github.com/o/r/runs/7", "\uf467"],
      ["https://github.com/o/r/pull/42/checks", "\uf42e2"],
    ]);
    expect(links).toContainEqual(["https://ci.example/build/9", "\uf467"]);
    // Each failed check's cross is red (the review's "changes requested" cross keeps the row's gradient).
    const failures = (await ui.findAll({ type: "Link" })).filter((l) => ["https://github.com/o/r/runs/7", "https://ci.example/build/9"].includes(String(l.props.href)));
    expect(failures.map((l) => elements(l.children)[0]?.props.color)).toEqual(["#ef4444", "#ef4444"]);
    for (const text of ["\uf040", "\uf467", "\uf0e0 3", "\uf071"]) {
      expect(await ui.find({ type: "Box", text })).toBeDefined();
    }
    // Pulled: nothing behind, so no link for it, rather than an empty one the terminal draws as its address.
    out["git rev-list --left-right --count HEAD...origin/feat"] = "2\t0\n";
    await clock.advance(2_000);
    await caughtUp(on, ui);
    expect(await href("https://github.com/o/r/commits/feat")).toBe(false);
    expect((await ui.findAll({ type: "Link" })).every((l) => l.children.length > 0)).toBe(true);
    await ui.unmount();
  });

  // A pull request's number is one colour by state; only an open or a draft one has its glyphs after it: the draft mark,
  // the review's cross, the comments, the conflict and the checks.
  const prStates = [
    { name: "an open", colour: "#facc15", state: "OPEN", draft: false, shown: ["\uf467", "\uf0e0", "\uf071"], hidden: ["\uf040"], checks: true },
    { name: "a draft", colour: "#f0f0f5", state: "OPEN", draft: true, shown: ["\uf040", "\uf467", "\uf0e0", "\uf071"], hidden: [], checks: true },
    { name: "a merged", colour: "#a855f7", state: "MERGED", draft: false, shown: [], hidden: ["\uf040", "\uf467", "\uf0e0", "\uf071"], checks: false },
    { name: "a closed", colour: "#828798", state: "CLOSED", draft: false, shown: [], hidden: ["\uf040", "\uf467", "\uf0e0", "\uf071"], checks: false },
  ];
  for (const { name, colour, state, draft, shown, hidden, checks } of prStates) {
    test(`draws ${name} pull request's number whole in ${colour}, with${checks ? "" : "out"} its glyphs`, async ($, on) => {
      stubHint(on, START);
      clockOn(on);
      const pr = {
        number: 7,
        url: "https://github.com/o/r/pull/7",
        state,
        isDraft: draft,
        mergeable: "CONFLICTING",
        reviewDecision: "CHANGES_REQUESTED",
        comments: [{}, {}],
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
      };
      const out: Record<string, string> = {
        "git rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
          "/r/.git\n/r/.git\n/r\nfeat\norigin/feat\n",
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "git rev-list --left-right --count HEAD...origin/feat": "0\t0\n",
        "git remote get-url origin": "git@github.com:o/r.git\n",
        "gh pr view --json number,url,isDraft,mergeable,reviewDecision,statusCheckRollup,comments,state": JSON.stringify(pr),
      };
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      on("session.root", () => ({ value: "/r" }));
      on("session.cwd", () => ({ value: "/r" }));
      on("fs.exists", () => ({ value: false }));
      on("process.run", (_$, e) => {
        const stdout = out[e.argv.filter((a) => a !== "--no-optional-locks").join(" ")];
        return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
      });

      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
      const ui = await $.ui.mount({
        plugin: "cockpit",
        surface: "terminal",
        component: "AbovePrompt",
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
      });

      const link = async () => (await ui.findAll({ type: "Link" })).find((l) => l.props.href === "https://github.com/o/r/pull/7");
      await caughtUp(on, ui);
      const colours = elements((await link())?.children ?? []).map((t) => t.props.color);
      expect(colours.length).toBe("PR #7".length);
      expect(new Set(colours)).toEqual(new Set([colour]));
      const glyphs = (await ui.findAll({ type: "Text" })).map(glyph).join("");
      for (const mark of shown) expect(glyphs).toContain(mark);
      for (const mark of hidden) expect(glyphs).not.toContain(mark);
      const tab = (await ui.findAll({ type: "Link" })).some((l) => l.props.href === "https://github.com/o/r/pull/7/checks");
      expect(tab).toBe(checks);
      await ui.unmount();
    });
  }

  // gh goes over the network: once a minute, but every 10 s while a check is running or queued.
  // Nor at all while no shown part draws what it answers.
  for (const { name, status, calls, options = {} } of [
    { name: "queued checks", status: "QUEUED", calls: 2 },
    { name: "finished checks", status: "COMPLETED", calls: 1 },
    { name: "the pull request's parts hidden", status: "QUEUED", calls: 0, options: { layout: withGit("folders,gap-1,branch,gap-1,worktree,gap-1,sync,gap-1,changes", "pr,review,comments,conflict,checks") } },
    { name: "the git row gone", status: "QUEUED", calls: 0, options: { layout: `prompt;${STATUS};fresh;compact;explain;hidden;${GIT.replaceAll(",gap-1", "")}` } },
    { name: "the pull request in the status row", status: "QUEUED", calls: 2, options: { layout: `folders;prompt;${STATUS},pr,checks;fresh;compact;explain` } },
  ] as { name: string; status: string; calls: number; options?: Record<string, string> }[]) {
    test(`asks gh ${calls} times in 12 s for ${name}`, { options }, async ($, on) => {
      stubHint(on, START);
      const clock = clockOn(on);
      const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: false, statusCheckRollup: [{ __typename: "CheckRun", status, conclusion: "" }] };
      const out: Record<string, string> = {
        "git rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}":
          "/r/.git\n/r/.git\n/r\nfeat\norigin/feat\n",
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "git rev-list --left-right --count HEAD...origin/feat": "0\t0\n",
        "git remote get-url origin": "git@github.com:o/r.git\n",
        "gh pr view --json number,url,isDraft,mergeable,reviewDecision,statusCheckRollup,comments,state": JSON.stringify(pr),
      };
      let asks = 0;
      let scans = 0;
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      on("session.root", () => ({ value: "/r" }));
      on("session.cwd", () => ({ value: "/r" }));
      on("fs.exists", () => ({ value: false }));
      on("process.run", (_$, e) => {
        if (e.argv[0] === "gh") asks++;
        else scans++;
        const stdout = out[e.argv.filter((a) => a !== "--no-optional-locks").join(" ")];
        return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
      });

      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
      await clock.settle();
      for (let i = 0; i < 6; i++) await clock.advance(2_000);
      // git ran, so no ask means one skipped.
      expect(scans).toBeGreaterThan(0);
      expect(asks).toBe(calls);
    });
  }

  // The line that closes a turn gets the tokens the turn generated per second in its verb: its output tokens over the
  // seconds, in the status row's units (plain under 1000, K to a tenth, M to a hundredth).
  // `later` moves the engine's clock that many ms between the turn's end and the line's draw.
  const turnLine = async ($: Engine, on: On, props: { word: string; durationMs: number }, turn?: { durationMs: number; usage: TurnUsage }, later = 0) => {
    stubHint(on, START);
    on("ui.render", { component: "TurnDuration" }, ($, e) => $.ui.resolve(e).Text({ children: `${e.props.word} for 7s` }));
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    if (turn) await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", ...turn });
    await clockOn(on).advance(later);
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "TurnDuration", props });
    await caughtUp(on, ui);
    const drawn = (await ui.findAll({ type: "Text" })).map(glyph).join("");
    await ui.unmount();
    return drawn;
  };
  const used = (output: number, others = 0) => ({ input_tokens: others, output_tokens: output, cache_read_input_tokens: others, cache_creation_input_tokens: others, model: "claude-opus-5-5" });
  const RATES: [number, string][] = [[7_000, "1.0K"], [700, "100"], [14_500 * 1_000, "2.07M"], [7_000_000, "1.00M"], [6_999, "999"]];
  for (const [tokens, rate] of RATES) {
    test(`draws ${rate} tok/s in the closing line for ${tokens} output tokens over 7 s`, async ($, on) => {
      const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(tokens) });
      expect(drawn).toBe(`Cooked at ${rate} tok/s for 7s`);
    });
  }

  test("counts only the output tokens: the input, the cache read and the cache write are not tokens generated", async ($, on) => {
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(350, 1_000_000) });
    expect(drawn).toBe("Cooked at 50 tok/s for 7s");
  });

  test("draws no rate when the person turned turn_rate off", { options: { turn_rate: false } }, async ($, on) => {
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(7_000) });
    expect(drawn).toBe("Cooked for 7s");
  });

  test("gives a closing line of another length none: it is an older turn's", async ($, on) => {
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 30_000 }, { durationMs: 7_000, usage: used(7_000) });
    expect(drawn).toBe("Cooked for 7s");
  });

  test("gives a closing line drawn 5 s after its turn ended by the engine's clock none: it is an older turn's", async ($, on) => {
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(7_000) }, 5_000);
    expect(drawn).toBe("Cooked for 7s");
  });

  test("polls git and the limits every 2 s, so a branch switch and spent usage show without a turn ending", async ($, on) => {
    stubHint(on, START);
    const clock = clockOn(on);
    let branch = "feat-a";
    let used = 0;
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [{ kind: "five_hour", percentUsed: used }] },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r" }));
    on("session.cwd", () => ({ value: "/r" }));
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_$, e) => {
      const rev = e.argv.includes("--show-toplevel");
      return {
        value: {
          exitCode: rev ? 0 : 1,
          stdout: rev ? `/r/.git\n/r/.git\n/r\n${branch}\n` : "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });
    // The bottom half of a 5h cell is lit while its usage is left: all ten at 0% used, none at 100%. The limits are
    // under the prompt, the branch above it.
    const hint = await mountHint($);
    const usageLeft = async () =>
      (await hint.findAll({ type: "Text", text: "▀" })).filter((t) => t.props.backgroundColor !== "#373a48").length;
    const bothCaughtUp = async () => {
      await caughtUp(on, ui);
      await hint.redraw();
    };

    await bothCaughtUp();
    expect(await ui.find({ type: "Box", text: "⎇ feat-a" })).toBeDefined();
    expect(await usageLeft()).toBe(10);

    branch = "feat-b";
    used = 100;
    await clock.advance(1_900);
    await bothCaughtUp();
    expect(await ui.find({ type: "Box", text: "⎇ feat-b" })).toBeUndefined();
    await clock.advance(100);
    await bothCaughtUp();
    expect(await ui.find({ type: "Box", text: "⎇ feat-b" })).toBeDefined();
    expect(await usageLeft()).toBe(0);
    await hint.unmount();
    await ui.unmount();
  });

  test("shows the folder outside a repository, and nothing of git", async ($, on) => {
    stubHint(on, START);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/work/cc-mods" }));
    on("session.cwd", () => ({ value: "/work/cc-mods" }));
    on("process.run", () => ({
      value: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository", isStdoutTruncated: false, isStderrTruncated: false },
    }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work/cc-mods" });
    const ui = await $.ui.mount({
      plugin: "cockpit",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    await caughtUp(on, ui);
    expect(await ui.find({ type: "Box", text: "cc-mods" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "⎇" })).toBeUndefined();
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["cc-mods"]);
    await ui.unmount();
  });

  test("colours the model by family, Mythos bold", async ($, on) => {
    stubHint(on);
    // A held clock draws no frames, so the sweep stays at its start: a name's first glyph shows its window's first colour.
    clockOn(on);
    let model = "";
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: model }));

    const cases = [
      ["claude-haiku-5-5", "Haiku 5.5", "#22d3d8", undefined],
      ["claude-sonnet-5-5", "Sonnet 5.5", "#41bce9", undefined],
      ["claude-opus-5-5", "Opus 5.5", "#60a5fa", undefined],
      ["claude-fable-5-1", "Fable 5.1", "#a855f7", undefined],
      ["claude-mythos-5", "Mythos 5", "#a855f7", true],
    ] as const;
    for (const [id, name, first, bold] of cases) {
      model = id;
      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
      const ui = await mountHint($);
      expect(await ui.find({ text: name })).toBeDefined();
      const glyph = await ui.find({ type: "Text", text: name[0] });
      expect(glyph?.props.color).toBe(first);
      expect(glyph?.props.bold).toBe(bold);
      await ui.unmount();
    }
  });

  test("shows a model switch within a frame, before any turn ends", async ($, on) => {
    stubHint(on);
    const clock = clockOn(on);
    let model = "claude-haiku-5-5";
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: model }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    expect(await ui.find({ text: "Haiku 5.5" })).toBeDefined();

    model = "claude-fable-5-1";
    await clock.advance(100);
    expect(await ui.find({ text: "Fable 5.1" })).toBeDefined();
    await ui.unmount();
  });

  // A copy of the module loaded later writes the load key its own way; this copy's tick reads it the next frame and stops.
  // The test stands in for that copy, answering the key once it has loaded. Each frame reads the model once.
  test("stops the tick once a copy of the module loaded later holds the load key", async ($, on) => {
    const clock = clockOn(on);
    let reloaded = false;
    let reads = 0;
    on("state.get", { plugin: "cockpit", key: "load" }, ($, e, next) => (reloaded ? { value: { value: -1, version: 2 } } : next(e)));
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => {
      reads++;
      return { value: "claude-opus-5-5" };
    });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const started = reads;
    await clock.advance(300);
    expect(reads - started).toBe(3);
    reloaded = true;
    await clock.advance(100);
    const stopped = reads;
    await clock.advance(500);
    expect(reads).toBe(stopped);
  });

  // Nothing the row reads changes between the frames: only the tick draws it again, and the model's sweep moves on with each.
  // The model is written once: written again each frame, the same, it would draw the row again too.
  test("draws the status row again every tick", async ($, on) => {
    stubHint(on);
    const clock = clockOn(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    let modelWritten = false;
    on("state.set", { plugin: "cockpit", key: "model" }, ($, e, next) => {
      if (modelWritten) return { value: { isSet: true, version: 1 } };
      modelWritten = true;
      return next(e);
    });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const firstGlyph = async () => (await ui.find({ type: "Text", text: "O" }))?.props.color;
    const colors = [await firstGlyph()];
    for (let i = 0; i < 2; i++) {
      await clock.advance(100);
      colors.push(await firstGlyph());
    }
    expect(new Set(colors).size).toBe(3);
    await ui.unmount();
  });

  // The order pane: a drag in a Client of the pane posts the new order; the mod writes the /config options it changed.
  const configRow = (field: string, value: ConfigValue): ConfigRow => ({
    key: `cockpit.${field}`,
    label: field,
    kind: typeof value === "boolean" ? "boolean" : "text",
    value,
    provider: { plugin: "cockpit", tier: "user" },
    isLocked: false,
  });
  // The layout row is hidden, so the list leaves it out.
  const ROWS = ["fresh_start", "compact_hint", "explain_row"].map((field) => configRow(field, true));

  test("hides the layout row in /config, and no other", async ($, on) => {
    // The engine beneath answers each row as it is.
    on("config.describe", (_$, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }));
    const describe = (field: string, plugin = "cockpit@cc-mods") => $.config.describe({ key: `${plugin}.${field}`, label: field, isHidden: false, provider: { plugin, tier: "user" } });
    expect(await describe("layout")).toMatchObject({ isHidden: true });
    expect(await describe("merge_costs")).toMatchObject({ isHidden: false });
    expect(await describe("layout", "otherplugin")).toMatchObject({ isHidden: false });
  });
  async function dragIn(on: On, $: Engine, options: Record<string, unknown>, list: string, from: number, to: number): Promise<[string, unknown][]> {
    clockOn(on);
    const written: [string, unknown][] = [];
    on("config.list", () => ({ value: ROWS }));
    on("config.set", (_$, e) => {
      written.push([e.key.replace("cockpit.", ""), e.value]);
      return { value: e.value };
    });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    await ui.pointer({ type: "down", x: 2, y: from, button: "left", in: list });
    await ui.pointer({ type: "move", x: 2, y: to, button: "left", in: list });
    await ui.pointer({ type: "up", x: 2, y: to, button: "left", in: list });
    await ui.unmount();
    return written;
  }
  // The rows pinned with no gaps, so each tag takes one row of its list. The lines: row-1 (git), ── prompt ──, row-2
  // (status), fresh, compact, explain, ── hidden ── (6), spacer, new row. The tags: ── row 1 ── (0), folders .. changes
  // (1-10), ── row 2 ── (11), model .. cache (12-20), ── hidden ── (21), spacer, gap-1, gap-2, gap-3 (22-25).
  const GIT_TAGS = "folders,branch,worktree,pr,review,comments,sync,conflict,checks,changes";
  const STATUS_TAGS = "model,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache";
  const pinned = (git = GIT_TAGS, status = STATUS_TAGS, hidden = "") => `${git};prompt;${status};fresh;compact;explain${hidden ? `;hidden;${hidden}` : ""}`;
  const PINNED = { layout: pinned() };

  test("dragging a row below the prompt marker moves it under the prompt", { options: PINNED }, async ($, on) => {
    // row 1 dropped on row 2's line goes below the prompt, after row 2.
    expect(await dragIn(on, $, PINNED, "lines", 0, 2)).toEqual([["layout", `prompt;${STATUS_TAGS};${GIT_TAGS};fresh;compact;explain`]]);
  });

  test("dragging a tag into the hidden zone switches it off and keeps the order of the rest", { options: PINNED }, async ($, on) => {
    // The model tag dropped on the hidden marker's line.
    expect(await dragIn(on, $, PINNED, "tags", 12, 21)).toEqual([["layout", pinned(GIT_TAGS, "limit_7d,limit_5h,credits,context,turns,tokens,agents,cache", "model")]]);
  });

  test("dragging a hidden tag out turns it back on", { options: { layout: pinned(GIT_TAGS, "limit_7d,limit_5h,credits,context,turns,tokens,agents,cache", "model") } }, async ($, on) => {
    // 7d .. cache 12-19, ── hidden ── 20, the spacer and gaps 21-24, model 25: dropped on the 7d limit's line.
    expect(await dragIn(on, $, PINNED, "tags", 25, 12)).toEqual([["layout", pinned()]]);
  });

  test("dragging a tag under another row's marker moves it into that row", { options: PINNED }, async ($, on) => {
    // The folders dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 1, 12)).toEqual([["layout", pinned("branch,worktree,pr,review,comments,sync,conflict,checks,changes", `model,folders,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache`)]]);
  });

  test("dragging the new row out of hidden reserves an empty row", { options: PINNED }, async ($, on) => {
    // The new row (8) dropped on the prompt marker's line, under row 1.
    expect(await dragIn(on, $, PINNED, "lines", 8, 1)).toEqual([["layout", `${GIT_TAGS};;prompt;${STATUS_TAGS};fresh;compact;explain`]]);
  });

  test("a tag dropped under an empty row's marker fills it", { options: { layout: `${GIT_TAGS};;prompt;${STATUS_TAGS};fresh;compact;explain` } }, async ($, on) => {
    // ── row 2 ── (11) has nothing under it, ── row 3 ── is 12, the model 13: dropped on row 3's marker, under row 2.
    expect(await dragIn(on, $, PINNED, "tags", 13, 12)).toEqual([["layout", `${GIT_TAGS};model;prompt;limit_7d,limit_5h,credits,context,turns,tokens,agents,cache;fresh;compact;explain`]]);
  });

  test("dragging a row into the hidden zone takes it away and hides its tags", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "lines", 2, 6)).toEqual([["layout", `${GIT_TAGS};prompt;fresh;compact;explain;hidden;${STATUS_TAGS}`]]);
  });

  test("dragging the explanation line above the prompt marker puts it above the prompt", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "lines", 5, 0)).toEqual([["layout", `explain;${GIT_TAGS};prompt;${STATUS_TAGS};fresh;compact`]]);
  });

  // Spacers: one waits under each list's hidden marker; dragged out it stays where it is dropped and another waits in
  // its place, and dropped under the marker it is gone.
  test("dragging the spare spacer out of hidden adds a spacer to the row", { options: PINNED }, async ($, on) => {
    // The spacer (22) dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 22, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,spacer,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache")]]);
  });

  test("dragging a gap out of hidden adds it to the row", { options: PINNED }, async ($, on) => {
    // gap-2 (24) dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 24, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,gap-2,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache")]]);
  });

  const SPACED = { layout: pinned(GIT_TAGS, "model,spacer,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache") };
  test("a second spacer is there to drag out once one is", { options: SPACED }, async ($, on) => {
    // model, spacer, 7d .. cache (14-21), ── hidden ── 22, the spare spacer 23: dropped beside the first.
    expect(await dragIn(on, $, SPACED, "tags", 23, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,spacer,spacer,limit_7d,limit_5h,credits,context,turns,tokens,agents,cache")]]);
  });

  test("dragging a spacer into hidden takes it away", { options: SPACED }, async ($, on) => {
    expect(await dragIn(on, $, SPACED, "tags", 13, 22)).toEqual([["layout", pinned()]]);
  });

  test("a spacer among the lines keeps its side of the prompt", { options: PINNED }, async ($, on) => {
    // The spacer (7) dropped on the prompt marker's line, above it, under row 1.
    expect(await dragIn(on, $, PINNED, "lines", 7, 1)).toEqual([["layout", `${GIT_TAGS};spacer;prompt;${STATUS_TAGS};fresh;compact;explain`]]);
  });

  test("dragging a git part into the hidden zone switches it off", { options: PINNED }, async ($, on) => {
    // The review dropped on the hidden marker's line.
    expect(await dragIn(on, $, PINNED, "tags", 5, 21)).toEqual([["layout", pinned("folders,branch,worktree,pr,comments,sync,conflict,checks,changes", STATUS_TAGS, "review")]]);
  });

  // An offer dropped under hidden keeps its place last in the layout, so only its toggle is written.
  test("dragging the explanation line into the hidden zone writes explain_row false", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "lines", 5, 6)).toEqual([["explain_row", false]]);
  });

  // Switched off, the explanation line is listed after hidden (8): dropped on the hidden marker's line, it is above it.
  test("dragging the explanation line back out of the hidden zone writes explain_row true", { options: { ...PINNED, explain_row: false } }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "lines", 8, 5)).toEqual([["explain_row", true]]);
  });

  test("a drop that changes nothing writes nothing", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "lines", 0, 0)).toEqual([]);
  });

  // A refused write answers each drop with the list as saved, so the list drops the order dragged into it, the second
  // time as the first: the engine's clock does not move between them.
  test("draws the saved order again after each of two refused drops", { options: PINNED }, async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: ROWS }));
    on("config.set", () => ({ deny: "managed by your organization" }));
    on("ui.toast", () => ({ value: undefined }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    const tags = async () => (await ui.findAll({ type: "Text", in: "tags" })).map((t) => flat(t));
    const saved = await tags();
    for (let i = 0; i < 2; i++) {
      // The model dropped on the hidden marker's line.
      await ui.pointer({ type: "down", x: 2, y: 12, button: "left", in: "tags" });
      await ui.pointer({ type: "move", x: 2, y: 21, button: "left", in: "tags" });
      await ui.pointer({ type: "up", x: 2, y: 21, button: "left", in: "tags" });
      expect(await tags()).toEqual(saved);
    }
    await ui.unmount();
  });

  // An accepted drop draws both lists again: a new row dragged out in the lines puts its marker in the tags, the second
  // time as the first, though a press gave the tags list an order of its own each time and the engine's clock does not move.
  test("draws the other list again after each of two accepted drops", { options: PINNED }, async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: ROWS }));
    on("config.set", (_$, e) => ({ value: e.value }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    const drag = async (list: string, from: number, to: number) => {
      await ui.pointer({ type: "down", x: 2, y: from, button: "left", in: list });
      await ui.pointer({ type: "move", x: 2, y: to, button: "left", in: list });
      await ui.pointer({ type: "up", x: 2, y: to, button: "left", in: list });
    };
    // The new row (8) dropped on the prompt marker's line (1), under row 1; then, a line further down each, again.
    for (const [from, to, marker] of [[8, 1, "━━ row 3 ━━"], [9, 2, "━━ row 4 ━━"]] as const) {
      await drag("tags", 1, 1);
      await drag("lines", from, to);
      await caughtUp(on, ui);
      expect((await ui.findAll({ type: "Text", in: "tags" })).map((t) => flat(t))).toContain(marker);
    }
    await ui.unmount();
  });

  test("the order pane lists the lines around the prompt marker and each row's tags under its marker, hidden ones after theirs", { options: { layout: "cache,model,limit_5h,context,turns,tokens;changes,spacer,folders,branch,worktree,pr,review,comments,sync,checks;prompt;fresh;compact;explain;hidden;limit_7d,conflict", compact_hint: false } }, async ($, on) => {
    clockOn(on);
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    // What the pane hands each list's Client: the items, in the order they are drawn.
    const clientProps = async (key: string) => (await ui.find({ type: "Client", key }))?.props.props;
    expect(await clientProps("lines")).toMatchObject({ items: ["row-1", "row-2", "prompt", "fresh", "explain", "hidden", "spacer", "row", "compact"], fixed: ["prompt", "hidden"], labels: { "row-1": "▤ row 1: cache, model, 5h limit and 5 more" } });
    expect(await clientProps("tags")).toMatchObject({
      items: ["row-1", "cache", "model", "limit_5h", "credits", "context", "turns", "tokens", "agents", "row-2", "changes", "spacer", "folders", "branch", "worktree", "pr", "review", "comments", "sync", "checks", "hidden", "spacer", "gap-1", "gap-2", "gap-3", "limit_7d", "conflict"],
      fixed: ["row-1", "row-2", "hidden"],
      labels: { "row-2": "━━ row 2 ━━", credits: "usage credits" },
    });
    // Each list as wide as the pane, so its labels wrap inside it.
    expect((await ui.findAll({ type: "Client" })).map((c) => c.props.width)).toEqual(["100%", "100%"]);
    await ui.unmount();
  });

  test("the order pane's text says the explanation line holds the run-out warning", async ($, on) => {
    clockOn(on);
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    expect(await ui.find({ type: "Text", text: /The explanation line .*run-out warning/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /forecast/ })).toBeUndefined();
    await ui.unmount();
  });

  // The costs as the row draws them: unmerged, the main session's and the subagents' tag; merged, one tag for the total.
  for (const [merged, items, labels] of [
    [false, ["tokens", "agents"], { tokens: "main session costs", agents: "subagent costs" }],
    [true, ["tokens"], { tokens: "total costs" }],
  ] as const) {
    test(`the order pane lists ${items.length} cost tags with merge_costs ${merged}`, { options: { ...PINNED, merge_costs: merged } }, async ($, on) => {
      clockOn(on);
      const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
      const tags = (await ui.find({ type: "Client", key: "tags" }))?.props.props;
      expect(tags).toMatchObject({ labels });
      const listed: unknown[] = typeof tags === "object" && tags !== null && "items" in tags && Array.isArray(tags.items) ? tags.items : [];
      expect(listed.filter((name) => name === "tokens" || name === "agents")).toEqual(items);
      await ui.unmount();
    });
  }

  // Merged, the subagents' tag is not in the list, so a drop leaves it out of the layout, which puts it back after the costs.
  test("a drop with the costs merged writes the layout without the subagents' tag", { options: { ...PINNED, merge_costs: true } }, async ($, on) => {
    // model .. cache without agents (12-18), ── hidden ── 19: the model dropped there.
    expect(await dragIn(on, $, PINNED, "tags", 12, 20)).toEqual([["layout", pinned(GIT_TAGS, "limit_7d,limit_5h,credits,context,turns,tokens,cache", "model")]]);
  });

  // A tag left out goes after the one before it in the default order, the first one first in the first row; a prompt
  // left out goes after the first row, an offer left out last.
  for (const [layout, lines, tags] of [
    ["branch,model;prompt;fresh", ["row-1", "prompt", "fresh", "compact", "explain"], ["row-1", ...GIT_TAGS.split(","), ...STATUS_TAGS.split(",")]],
    ["model;cache", ["row-1", "prompt", "row-2", "fresh", "compact", "explain"], ["row-1", ...GIT_TAGS.split(","), ...STATUS_TAGS.split(",").slice(0, -1), "row-2", "cache"]],
  ] as const) {
    test(`the order pane fills in what the layout ${layout} leaves out`, { options: { layout } }, async ($, on) => {
      clockOn(on);
      const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
      const clientProps = async (key: string) => (await ui.find({ type: "Client", key }))?.props.props;
      expect(await clientProps("lines")).toMatchObject({ items: [...lines, "hidden", "spacer", "row"] });
      expect(await clientProps("tags")).toMatchObject({ items: [...tags, "hidden", "spacer", "gap-1", "gap-2", "gap-3"] });
      await ui.unmount();
    });
  }

  // The spacers around a blank explanation line do not meet: it takes its line as a row does.
  test("draws a blank explanation line as a line of its own between two spacers", { options: { layout: `${GIT};prompt;${STATUS};fresh;compact;spacer;explain;spacer` } }, async ($, on) => {
    stubHint(on);
    const below = await mountHint($);
    const drawn = await below.drawn();
    const lines = leaves(isDrawn(drawn) ? drawn.children : []);
    expect(lines.slice(-3).map((line) => (line.props.key === "explain" ? "explain" : line.props.height === 1 ? "_" : flat(line)))).toEqual(["_", "explain", "_"]);
    // At least one line, as wide as the window, and free to grow: no fixed height, nothing cut off.
    expect(lines.at(-2)?.props).toMatchObject({ width: "100%", minHeight: 1 });
    expect(lines.at(-2)?.props.height).toBeUndefined();
    expect(lines.at(-2)?.props.overflow).toBeUndefined();
    await below.unmount();
  });

  // A row of nothing but a gap draws nothing.
  test("draws a spacer among the lines as a blank line on its side of the prompt, spacers that meet as one", { options: { layout: `spacer;${GIT};gap-1;spacer;prompt;spacer;spacer;${STATUS};fresh;compact;explain` } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/work" }));
    on("session.cwd", () => ({ value: "/work" }));
    // Outside a repository the git row holds the folder alone.
    on("process.run", () => ({ value: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository", isStdoutTruncated: false, isStderrTruncated: false } }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    const below = await mountHint($);
    // A line spelled: a blank one as "_", a row as "row", the explanation line as "explain".
    const lines = async (ui: { drawn: () => Promise<unknown> }) => {
      const drawn = await ui.drawn();
      return leaves(isDrawn(drawn) ? drawn.children : []).map((line) => (line.props.key === "explain" ? "explain" : line.props.height === 1 ? "_" : line.props.flexWrap === "wrap" ? "row" : flat(line)));
    };
    for (let i = 0; i < 50 && !(await lines(above)).includes("row"); i++) await settle();
    expect(await lines(above)).toEqual(["_", "row", "_"]);
    // Under the engine's hint line, the two spacers as one blank line.
    expect((await lines(below)).slice(-4)).not.toEqual(["_", "_", "row", "explain"]);
    expect((await lines(below)).slice(-3)).toEqual(["_", "row", "explain"]);
    await above.unmount();
    await below.unmount();
  });

  // A part with nothing to show (no worktree here) folds with the gaps beside it against a spacer.
  for (const [order, spelled] of [
    ["changes,spacer,folders,spacer,branch", ["+3 -1 ~1", "<1", "r", "<1", "main"]],
    ["folders,gap-1,branch,gap-1,worktree,spacer,changes", ["r", "_1", "main", "<1", "+3 -1 ~1"]],
  ] as const)
  test(`draws the git row's parts in the layout's ${order} with its spacers and gaps, a hidden part left out`, { options: { layout: withGit(order, "sync") } }, async ($, on) => {
    stubHint(on, START);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/r" }));
    on("session.cwd", () => ({ value: "/r" }));
    on("fs.exists", () => ({ value: false }));
    const out: Record<string, string> = {
      "rev-parse --path-format=absolute --git-common-dir --absolute-git-dir --show-toplevel --abbrev-ref HEAD --abbrev-ref @{upstream}": "/r/.git\n/r/.git\n/r\nmain\norigin/main\n",
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "rev-list --left-right --count HEAD...origin/main": "2\t0\n",
      "diff --numstat HEAD": "3\t1\ta.ts\n",
    };
    on("process.run", (_$, e) => {
      const stdout = out[e.argv.slice(1).filter((a) => a !== "--no-optional-locks").join(" ")];
      return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    await caughtUp(on, ui);
    // The commits ahead (↑2) are hidden.
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(spelled);
    await ui.unmount();
  });

  test("wraps a label in a narrow order pane, and a press on its second line picks it", { options: PINNED }, async ($, on) => {
    clockOn(on);
    const written: [string, unknown][] = [];
    on("config.list", () => ({ value: ROWS }));
    on("config.set", (_$, e) => {
      written.push([e.key.replace("cockpit.", ""), e.value]);
      return { value: e.value };
    });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 16, placement: "dock", ...SITE } });
    await ui.resize({ columns: 16, rows: 30, in: "tags" });
    const lines = (await ui.findAll({ type: "Text", in: "tags" })).map((t) => flat(t));
    // "commits ahead and behind" in 14 columns after its handle: two lines, each cut at the edge, never wrapped again.
    expect(lines.slice(7, 9)).toEqual(["≡ commits ahead", "  and behind"]);
    expect((await ui.findAll({ type: "Text", in: "tags" })).every((t) => t.props.wrap === "truncate-end")).toBe(true);
    // Its second line pressed and dropped on the hidden marker's first line (row 1's marker 0, folders to comments a
    // line each, 1-6, ahead and behind 7-8, conflict to changes 9-11, row 2's marker 12, model to cache 13-22 with the
    // main session's costs on two lines, the hidden marker from 23): ahead and behind is switched off.
    await ui.pointer({ type: "down", x: 3, y: 8, button: "left", in: "tags" });
    await ui.pointer({ type: "move", x: 3, y: 23, button: "left", in: "tags" });
    await ui.pointer({ type: "up", x: 3, y: 23, button: "left", in: "tags" });
    await ui.unmount();
    expect(written).toEqual([["layout", pinned("folders,branch,worktree,pr,review,comments,conflict,checks,changes", STATUS_TAGS, "sync")]]);
  });

  // The colours: the colors option's overrides, and with the gradients option off one colour per gradient.
  async function barsOf($: Engine, on: On, tokens: number) {
    stubHint(on, START);
    const now = clockOn(on).now();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [{ kind: "five_hour", percentUsed: 40, resetsAt: new Date(now + 10_560_000).toISOString() }] },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("agent.list", () => ({ value: [] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const limit = must(await ui.find({ type: "Box", key: "five_hour" }), "the 5h bar");
    const context = must(await ui.find({ type: "Box", key: "context" }), "the context bar");
    // A cell's bottom half, its background: the usage left, or the context window left.
    const colours = (cells: readonly unknown[]) => elements(cells).map(({ props }) => props.backgroundColor);
    await ui.unmount();
    return { badge: elements(limit.children)[0]?.props, cells: colours(limit.children.slice(1)), context: elements(context.children)[0]?.props, contextCells: colours(context.children.slice(1)) };
  }

  test("draws the colors option's colours, a gradient from one to the other", { options: { colors: "limit.5h.from=#112233, limit.5h.to=#FFFFFF,context.low=0000ff,pr.nope=#123456,turns.from=red" } }, async ($, on) => {
    const { badge, cells, context } = await barsOf($, on, 1_000);
    expect(badge).toMatchObject({ backgroundColor: "#ffffff", color: "#000000" });
    // 40% used of 10 cells: the first 6 lit, from the light end towards the dark.
    expect(cells[0]).toBe("#112233");
    expect(cells[1]).not.toBe("#112233");
    // 0% used, the badge on the context bar's first colour.
    expect(context).toMatchObject({ backgroundColor: "#0000ff" });
  });

  test("with gradients off draws each gradient in its first colour and the context bar in bands", { options: { gradients: false, colors: "limit.5h.from=#112233,limit.5h.to=#ffffff" } }, async ($, on) => {
    const { badge, cells, contextCells } = await barsOf($, on, 1_000);
    expect(badge).toMatchObject({ backgroundColor: "#112233" });
    expect(cells.slice(0, 6)).toEqual(Array(6).fill("#112233"));
    // Cell by cell from 90% down to 0%: red to 75%, yellow to 25%, green below, the default context colours.
    expect(contextCells).toEqual(["#ef4444", "#ef4444", "#facc15", "#facc15", "#facc15", "#facc15", "#facc15", "#22c55e", "#22c55e", "#22c55e"]);
  });

  async function colorsPane($: Engine, on: On, options: Record<string, unknown>, act: (ui: Mounted<"terminal", "Pane">) => Promise<void>) {
    clockOn(on);
    const written: [string, unknown][] = [];
    const toasts: string[] = [];
    // Another plugin's colors row comes first: the write still goes to the mod's own.
    const other: ConfigRow = { ...configRow("colors", ""), key: "otherplugin.colors", provider: { plugin: "otherplugin", tier: "user" } };
    on("config.list", () => ({ value: [other, configRow("colors", typeof options.colors === "string" ? options.colors : ""), configRow("gradients", options.gradients !== false)] }));
    on("config.set", (_$, e) => {
      written.push([e.key.replace("cockpit.", ""), e.value]);
      return { value: e.value };
    });
    on("ui.toast", (_$, e) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    await act(ui);
    await ui.unmount();
    return { written, toasts };
  }

  test("a colour typed in the colours pane joins the colors option", { options: { colors: "pr.open=#000000" } }, async ($, on) => {
    const { written } = await colorsPane($, on, { colors: "pr.open=#000000" }, async (ui) => {
      await ui.input({ key: "turns.to", text: " #ABCDEF " });
    });
    expect(written).toEqual([["colors", "pr.open=#000000,turns.to=#abcdef"]]);
  });

  test("keeps a colour's swatch and field whole in a narrow pane, its label wrapping between them", async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 24, placement: "dock", ...SITE } });
    const boxes = await ui.findAll({ type: "Box" });
    // A field is a leaf with no children of its own, so the children are read by their props alone.
    const hasProps = (node: unknown): node is FoundElement => typeof node === "object" && node !== null && "props" in node;
    const holding = (pick: (b: FoundElement) => boolean) => boxes.find((b) => b.props.flexShrink === 0 && b.children.filter(hasProps).some(pick));
    must(holding((c) => c.props.key === "pr.open"), "the pr.open field, unshrinking");
    must(holding((c) => flat(c) === "██"), "a swatch, unshrinking");
    must(holding((c) => c.props.key === "gradients"), "the gradients button, unshrinking");
    // The label is text of its own, not the field's: it wraps where the field cannot.
    expect((await ui.find({ type: "Input", key: "pr.open" }))?.props.label).toBeUndefined();
    expect(await ui.find({ type: "Text", text: "a failed check's cross" })).toBeDefined();
    await ui.unmount();
  });

  test("lists the seven pace colours under Limit pace in the colours pane, with their defaults", async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    const drawn = await ui.drawn();
    // The pane's lines in order: a heading by its text, a field by its Input's key and value.
    const lines = (isDrawn(drawn) ? drawn.children : []).flatMap((node): string[] => {
      const props = /"type":"Input","props":(\{[^}]*\})/.exec(JSON.stringify(node))?.[1];
      const input: unknown = props === undefined ? undefined : JSON.parse(props);
      if (typeof input === "object" && input !== null && "key" in input && "value" in input) return [`${input.key}=${input.value}`];
      return isDrawn(node) && node.props.bold === true ? [flat(node)] : [];
    });
    const at = lines.indexOf("Limit pace");
    expect(lines.slice(at, at + 8)).toEqual(["Limit pace", "pace.under=#94a3b8", "pace.over.from=#fbbf24", "pace.over.to=#ef4444", "pace.spare=#60a5fa", "pace.severe=#991b1b", "pace.par=#e5e7eb", "pace.none=#6b7280"]);
    await ui.unmount();
  });

  test("names the styles each pace colour serves in the colours pane: under pace gauge and notch, spare and deep red lanes", async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    expect(await ui.find({ type: "Text", text: "gauge and notch: under pace" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "lanes: token cells spare under pace, where spending is welcome" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "lanes: the time lane, when more cells are over pace than the token lane holds" })).toBeDefined();
    await ui.unmount();
  });

  test("draws under-pace cells in the colors option's pace.under", { options: { limit_style: "gauge", limit_7d_length: 10, colors: "pace.under=#112233" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 10, 0.6)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "seven_day")).colors.slice(1, 5)).toEqual(Array(4).fill("#112233"));
    await ui.unmount();
  });

  // 10% of the 7d with 60% gone spares the token lane's 4th to 6th cells.
  test("draws the lanes' spare cells in the colors option's pace.spare", { options: { limit_style: "lanes", colors: "pace.spare=#112233" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 10, 0.6)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "seven_day")).colors.slice(3, 6)).toEqual(Array(3).fill("#112233"));
    await ui.unmount();
  });

  // 80% of the 7d with 45% gone impacts more cells than the token lane holds, so the time lane's 3 lit cells draw deep red.
  test("draws the lanes' deep-red time lane in the colors option's pace.severe", { options: { limit_style: "lanes", colors: "pace.severe=#112233" } }, async ($, on) => {
    stubHint(on, START);
    await startWithLimits($, on, [reading("seven_day", 80, 0.45)]);
    const ui = await mountHint($);
    expect((await limitTagOf(ui, "seven_day")).backgrounds.slice(0, 3)).toEqual(Array(3).fill("#112233"));
    await ui.unmount();
  });

  test("names the run-out warning's sign among what the warnings colour sets", async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    expect(await ui.find({ type: "Text", text: "the compaction line's diamond and link, the run-out warning's sign" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /forecast/ })).toBeUndefined();
    await ui.unmount();
  });

  test("writes to an installed copy's rows, named for its marketplace", async ($, on) => {
    clockOn(on);
    const written: string[] = [];
    const installed = (field: string, value: ConfigValue): ConfigRow => ({ ...configRow(field, value), key: `cockpit@cc-mods.${field}`, provider: { plugin: "cockpit@cc-mods", tier: "user" } });
    const other: ConfigRow = { ...configRow("gradients", true), key: "otherplugin.gradients", provider: { plugin: "otherplugin", tier: "user" } };
    on("config.list", () => ({ value: [other, installed("colors", ""), installed("gradients", true)] }));
    on("config.set", (_$, e) => {
      written.push(e.key);
      return { value: e.value };
    });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    await ui.press({ key: "gradients" });
    await ui.input({ key: "turns.from", text: "#123456" });
    await ui.unmount();
    expect(written).toEqual(["cockpit@cc-mods.gradients", "cockpit@cc-mods.colors"]);
  });

  test("an empty field drops the colour from the colors option", { options: { colors: "pr.open=#000000,turns.to=#abcdef" } }, async ($, on) => {
    const { written } = await colorsPane($, on, { colors: "pr.open=#000000,turns.to=#abcdef" }, async (ui) => {
      await ui.input({ key: "turns.to", text: "" });
    });
    expect(written).toEqual([["colors", "pr.open=#000000"]]);
  });

  test("the default typed out drops the colour from the colors option", { options: { colors: "pr.open=#000000" } }, async ($, on) => {
    const { written } = await colorsPane($, on, { colors: "pr.open=#000000" }, async (ui) => {
      await ui.input({ key: "pr.open", text: "#facc15" });
    });
    expect(written).toEqual([["colors", ""]]);
  });

  test("a colour that does not read writes nothing and says why", async ($, on) => {
    const { written, toasts } = await colorsPane($, on, {}, async (ui) => {
      await ui.input({ key: "turns.from", text: "blue" });
    });
    expect(written).toEqual([]);
    expect(toasts).toEqual(["Cockpit colours: blue is not a colour. Type six hex digits, as #22d3d8."]);
  });

  test("with gradients off the colours pane asks for a gradient's first colour only, and its button turns them on", { options: { gradients: false } }, async ($, on) => {
    const { written } = await colorsPane($, on, { gradients: false }, async (ui) => {
      expect(await ui.find({ type: "Input", key: "turns.from" })).toBeDefined();
      expect(await ui.find({ type: "Input", key: "turns.to" })).toBeUndefined();
      expect(await ui.find({ type: "Input", key: "context.mid" })).toBeDefined();
      // The mod's own button face, as Compact and Start fresh have, not the engine's [ label ].
      expect((await ui.find({ type: "Button", key: "gradients" }))?.props.plain).toBe(true);
      expect((await ui.find({ type: "Text", text: /^▌ ◑ Turn gradients on ▐$/ }))?.props).toMatchObject({ color: "#c7d2fe", backgroundColor: "#4f46e5" });
      await ui.press({ key: "gradients" });
    });
    expect(written).toEqual([["gradients", true]]);
  });

  // The usage lookup. A test's engine answers the session's credential as a handle, as the engine does (the secret
  // never reaches the mod), and the requests to Anthropic's host are recorded with the handle each carried. The usage
  // and profile answers are what a test sets; a function answer returns the status and body text, or throws as a
  // refused request does.
  const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
  const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
  type Answer = { status: number; text: string } | { deny: string };
  type Auth = { handle: string; kind: "bearer" | "api-key" } | null;
  const extraUsage = (extra: Record<string, unknown> = {}) => JSON.stringify({ extra_usage: { is_enabled: true, used_credits: 1011, monthly_limit: 1500, decimal_places: 2, currency: "EUR", spend_limit_reached: false, disabled_reason: null, ...extra } });
  const lookupWorld = (on: On, { auth = { handle: "handle-1", kind: "bearer" }, usage = () => ({ status: 200, text: extraUsage() }), profile = () => ({ status: 200, text: JSON.stringify({ organization: { subscription_created_at: "2024-07-17T23:34:49Z" } }) }) }: { auth?: Auth; usage?: () => Answer; profile?: () => Answer } = {}) => {
    const asked: { url: string; auth?: string; beta?: string }[] = [];
    // The mod times its lookups by the engine's clock, which a test moves.
    const clock = clockOn(on);
    on("session.authorize", () => ({ value: auth }));
    on("http.fetch", (_$, e) => {
      if (!e.url.startsWith("https://api.anthropic.com/")) return { value: { status: 200, ok: true, headers: {}, text: md } };
      asked.push({ url: e.url, auth: e.init?.auth, beta: e.init?.headers?.["anthropic-beta"] });
      const answer = e.url === USAGE_URL ? usage() : profile();
      if ("deny" in answer) return { deny: answer.deny };
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: answer.text } };
    });
    return { asked, clock };
  };
  // A turn of the main conversation ends, and the lookup it starts unawaited runs out on the settled clock.
  const endTurn = async ($: Engine, on: On) => {
    await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", durationMs: 1_000 });
    await clockOn(on).settle();
  };
  const sevenUsedUp = (): SessionRateLimit[] => [sevenResettingAt(100, localAt(1, 16))];

  test("sends the engine's credential with the beta header to both endpoints, and reads a 200 from both as the normal path", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    const { asked } = lookupWorld(on);
    await startWithLimits($, on, sevenUsedUp());
    await endTurn($, on);
    expect(asked).toEqual([
      { url: USAGE_URL, auth: "handle-1", beta: "oauth-2025-04-20" },
      { url: PROFILE_URL, auth: "handle-1", beta: "oauth-2025-04-20" },
    ]);
  });

  // The 7d is at 100% in each: without the option, a first-party login of the bearer kind, no request goes out.
  for (const [what, options, auth] of [
    ["usage_lookup is unset", {}, { handle: "handle-1", kind: "bearer" }],
    ["usage_lookup is false", { usage_lookup: false }, { handle: "handle-1", kind: "bearer" }],
    ["the session holds no first-party login", { usage_lookup: true }, null],
    ["the credential is an api key", { usage_lookup: true }, { handle: "handle-1", kind: "api-key" }],
  ] as const)
    test(`makes no request to api.anthropic.com and draws no credits tag when ${what}`, { options }, async ($, on) => {
      stubHint(on, START);
      on("turn.complete", (_$, e) => ({ text: e.answer }));
      const { asked } = lookupWorld(on, { auth });
      // Credits an earlier session with the option on left in the state are not drawn with it off.
      if (options.usage_lookup !== true) on("state.get", { plugin: "cockpit", key: "credits" }, () => ({ value: { value: { at: 0, enabled: true, spent: 1011, cap: 1500, decimals: 2, currency: "EUR", capReached: false, reason: null }, version: 1 } }));
      await startWithLimits($, on, sevenUsedUp());
      await endTurn($, on);
      expect(asked).toEqual([]);
      const ui = await mountHint($);
      expect(await ui.find({ type: "Box", key: "credits" })).toBeUndefined();
      await ui.unmount();
    });

  // The credits the mod last kept as the session's state, parsed from the usage response's extra_usage.
  const creditsKept = (on: On) => {
    const kept: unknown[] = [];
    on("state.set", { plugin: "cockpit", key: "credits" }, ($, e, next) => {
      kept.push(e.value);
      return next(e);
    });
    return kept;
  };
  const fiveUsedUp = (): SessionRateLimit[] => [{ kind: "five_hour", percentUsed: 100, resetsAt: localAt(0, 23, 59).toISOString() }, sevenResettingAt(60, localAt(3, 16))];

  for (const [what, limits] of [["7d", sevenUsedUp], ["5h", fiveUsedUp]] as const)
    test(`calls the usage endpoint once at the end of a turn with the ${what} at 100%, and keeps extra_usage's fields`, { options: { usage_lookup: true } }, async ($, on) => {
      stubHint(on, START);
      on("turn.complete", (_$, e) => ({ text: e.answer }));
      const kept = creditsKept(on);
      const { asked, clock } = lookupWorld(on, { usage: () => ({ status: 200, text: extraUsage({ spend_limit_reached: true, disabled_reason: "out_of_credits" }) }) });
      await startWithLimits($, on, limits());
      await endTurn($, on);
      expect(asked.filter((r) => r.url === USAGE_URL)).toHaveLength(1);
      expect(kept).toEqual([{ at: clock.now(), enabled: true, spent: 1011, cap: 1500, decimals: 2, currency: "EUR", capReached: true, reason: "out_of_credits" }]);
    });

  test("calls no endpoint at the end of a turn with neither the 5h nor the 7d at 100%", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    const { asked } = lookupWorld(on);
    await startWithLimits($, on, [sevenResettingAt(80, localAt(2, 16)), { kind: "five_hour", percentUsed: 40, resetsAt: localAt(0, 23, 59).toISOString() }]);
    await endTurn($, on);
    expect(asked).toEqual([]);
  });

  // A 7d refused until an hour past the engine's clock has not reset by it. START lies in the past, so by the machine's
  // clock that refusal has long reset.
  test("counts a refused window as used up until the engine's clock reaches its reset", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    on("state.get", { plugin: "cockpit", key: "rejected" }, () => ({ value: { value: { seven_day: clockOn(on).now() + 3_600_000 }, version: 1 } }));
    const { asked } = lookupWorld(on);
    await startWithLimits($, on, [sevenResettingAt(60, localAt(3, 16))]);
    await endTurn($, on);
    expect(asked[0]?.url).toBe(USAGE_URL);
  });

  // A lookup that fails, each way it can: an error and a refusal (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC refuses a
  // request that carries the credential), an error status, a body that is no JSON. The 7d is used up in each, the row
  // draws without an error or a toast, and the credits tag stays hidden.
  const FAILURES: [string, () => Answer][] = [
    ["errors", () => ({ deny: "socket hang up" })],
    ["is refused while CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set", () => ({ deny: "refused: CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set" })],
    ["answers 401", () => ({ status: 401, text: "{}" })],
    ["returns a body the mod cannot read", () => ({ status: 200, text: "<html>" })],
  ];
  for (const [what, usage] of FAILURES)
    test(`leaves the credits tag hidden and the row without an error when the usage lookup ${what}`, { options: { usage_lookup: true } }, async ($, on) => {
      stubHint(on, START);
      on("turn.complete", (_$, e) => ({ text: e.answer }));
      const toasts: string[] = [];
      on("ui.toast", (_$, e) => {
        toasts.push(e.text);
        return { value: undefined };
      });
      const kept = creditsKept(on);
      const { asked } = lookupWorld(on, { usage });
      await startWithLimits($, on, sevenUsedUp());
      await endTurn($, on);
      expect(asked.map((r) => r.url)).toEqual([USAGE_URL]);
      expect(kept).toEqual([]);
      expect(toasts).toEqual([]);
      const ui = await mountHint($);
      expect(await ui.find({ type: "Text", text: "O" })).toBeDefined();
      expect(await creditsTag(ui)).toBeUndefined();
      await ui.unmount();
    });

  // No text of the mod outside /config suggests switching the option on: with it off, the 7d at 100% and a refusal seen,
  // every tag and explanation reads as it did before the option.
  test("never mentions the usage_lookup option outside /config", async ($, on) => {
    stubHint(on, START);
    on("state.get", { plugin: "cockpit", key: "rejected" }, () => ({ value: { value: { seven_day: clockOn(on).now() + 3_600_000 }, version: 1 } }));
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    const texts = [...(await ui.findAll({ type: "Text" })).map(flat), ...(await explanationsIn(ui)).map(flat)].join(" ");
    expect(texts).toContain("7d at 100%");
    expect(texts).not.toMatch(/lookup|credits/i);
    await ui.unmount();
  });

  // The tags the order pane lists for a row, in the layout the options give: the mod's own default, or a saved one.
  const orderedTags = async ($: Engine, on: On, row: string) => {
    clockOn(on, START);
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    const props = (await ui.find({ type: "Client", key: "tags" }))?.props.props;
    await ui.unmount();
    const items: unknown[] = typeof props === "object" && props !== null && "items" in props && Array.isArray(props.items) ? props.items : [];
    const at = items.indexOf(row);
    return items.slice(at + 1, items.indexOf(`row-${Number(row.slice(4)) + 1}`));
  };

  test("places the credits tag after limit_5h in the default layout, a gap on each side", async ($, on) => {
    expect((await orderedTags($, on, "row-2")).slice(4, 9)).toEqual(["limit_5h", "gap-1", "credits", "gap-1", "context"]);
  });

  test("places the credits tag after limit_5h in a saved layout that does not name it", { options: { layout: "folders;prompt;model,limit_7d,limit_5h,context;fresh;compact;explain" } }, async ($, on) => {
    expect((await orderedTags($, on, "row-2")).slice(0, 5)).toEqual(["model", "limit_7d", "limit_5h", "credits", "context"]);
  });

  test("draws a sample credits tag while the order pane shows and no credits state exists", async ($, on) => {
    stubHint(on);
    clockOn(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("ui.panes", () => ({ value: [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !(await creditsTag(ui)); i++) await settle();
    expect(await creditsTag(ui)).toEqual({ badge: " € ", bar: "BBBB___" });
    expect(await explanationOf(ui, "credits")).toBe("€ at 67%: €10.11 of €15.00 spent.");
    await ui.unmount();
  });

  // The badge and the spent cells as drawn, colour by colour.
  const creditsColors = async (ui: { find: Mounted["find"] }) => {
    const [badge, ...bar] = elements(must(await ui.find({ type: "Box", key: "credits" }), "the credits tag").children);
    return { badge: badge?.props, spent: bar.slice(0, 4).map(({ props }) => props.backgroundColor) };
  };

  test("draws the credits badge and spent cells in the muted rose credits.spent, the label black on it", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    holding(on, creditsOf());
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    const { badge, spent } = await creditsColors(ui);
    expect(badge).toMatchObject({ backgroundColor: "#b87a8c", color: "#000000" });
    expect(spent).toEqual(Array(4).fill("#b87a8c"));
    await ui.unmount();
  });

  test("draws the credits tag in the colors option's credits.spent, the label white on a dark one", { options: { usage_lookup: true, colors: "credits.spent=#112233" } }, async ($, on) => {
    stubHint(on, START);
    holding(on, creditsOf());
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    const { badge, spent } = await creditsColors(ui);
    expect(badge).toMatchObject({ backgroundColor: "#112233", color: "#ffffff" });
    expect(spent).toEqual(Array(4).fill("#112233"));
    await ui.unmount();
  });

  test("lists credits.spent in a group of its own in the colours pane, with its default", async ($, on) => {
    clockOn(on);
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    const drawn = await ui.drawn();
    // The pane's lines in order: a heading by its text, a field by its Input's key and value.
    const lines = (isDrawn(drawn) ? drawn.children : []).flatMap((node): string[] => {
      const props = /"type":"Input","props":(\{[^}]*\})/.exec(JSON.stringify(node))?.[1];
      const input: unknown = props === undefined ? undefined : JSON.parse(props);
      if (typeof input === "object" && input !== null && "key" in input && "value" in input) return [`${input.key}=${input.value}`];
      return isDrawn(node) && node.props.bold === true ? [flat(node)] : [];
    });
    const at = lines.indexOf("credits.spent=#b87a8c");
    expect(lines.slice(at - 1, at + 2)).toEqual(["Usage credits bar and badge", "credits.spent=#b87a8c", expect.stringMatching(/^Context bar and badge$/)]);
    await ui.unmount();
  });

  // The invoices fall on the 17th for a start of 2024-07-17T23:34:49Z, which is the 18th in Warsaw: the day is the UTC one.
  test("keeps the UTC day of the subscription's start as the billing day", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    const days: unknown[] = [];
    on("state.set", { plugin: "cockpit", key: "billing" }, ($, e, next) => {
      days.push(e.value);
      return next(e);
    });
    lookupWorld(on);
    await startWithLimits($, on, sevenUsedUp());
    await endTurn($, on);
    expect(days).toEqual([17]);
  });

  // Pacing, by the engine's clock: one lookup a minute at most; after a failure a wait of a minute, doubling with each
  // failure in a row to an hour; a success ends the wait.
  const MINUTE = 60_000;
  // Turns end `gaps` apart (ms), the first at once; each answers the way `answers` has it, the last one repeating.
  const turnsAt = async ($: Engine, on: On, gaps: number[], answers: ("ok" | "fail")[], { profileFails = false } = {}) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    let turn = 0;
    const { asked, clock } = lookupWorld(on, { usage: () => (answers[Math.min(turn, answers.length - 1)] === "ok" ? { status: 200, text: extraUsage() } : { status: 500, text: "" }), ...(profileFails ? { profile: () => ({ status: 500, text: "" }) } : {}) });
    await startWithLimits($, on, sevenUsedUp());
    const calls: number[] = [];
    for (const gap of gaps) {
      await clock.advance(gap);
      const before = asked.filter((r) => r.url === USAGE_URL).length;
      await endTurn($, on);
      if (asked.filter((r) => r.url === USAGE_URL).length > before) calls.push(turn);
      turn++;
    }
    return { asked, calls };
  };

  test("makes at most one usage lookup a minute, and calls the profile endpoint once", { options: { usage_lookup: true } }, async ($, on) => {
    // Turns at 0, 30 and 60 s: the second is within the minute, the third is not.
    const { asked, calls } = await turnsAt($, on, [0, 30_000, 30_000], ["ok"]);
    expect(calls).toEqual([0, 2]);
    expect(asked.map((r) => r.url)).toEqual([USAGE_URL, PROFILE_URL, USAGE_URL]);
  });

  test("waits a minute after a failed usage lookup, and makes none within it", { options: { usage_lookup: true } }, async ($, on) => {
    // Turns at 0 s (fails), 59.9 s and 60 s.
    const { calls } = await turnsAt($, on, [0, MINUTE - 100, 100], ["fail"]);
    expect(calls).toEqual([0, 2]);
  });

  test("doubles the wait after each failure in a row: 1, 2 and 4 minutes", { options: { usage_lookup: true } }, async ($, on) => {
    // Failures at 0, 1 and 3 minutes; the turns just short of each wait end make no call, those at it do.
    const gaps = [0, MINUTE - 100, 100, 2 * MINUTE - 100, 100, 4 * MINUTE - 100, 100];
    expect((await turnsAt($, on, gaps, ["fail"])).calls).toEqual([0, 2, 4, 6]);
  });

  test("ends the wait at a success: the next failure waits a minute again", { options: { usage_lookup: true } }, async ($, on) => {
    // Fail at 0, fail at 1 min (a 2 min wait), succeed at 3 min, fail at 4 min (a 1 min wait again, not 4), then call at 5 min.
    const gaps = [0, MINUTE, 2 * MINUTE, MINUTE, MINUTE - 100, 100];
    expect((await turnsAt($, on, gaps, ["fail", "fail", "ok", "fail", "fail", "fail"])).calls).toEqual([0, 1, 2, 3, 5]);
  });

  test("ends the wait at a usage success even when the profile call then fails: the next wait is a minute", { options: { usage_lookup: true } }, async ($, on) => {
    // Fail at 0, then a usage success at 1 min whose profile call fails: a 1 min wait, not the 2 min of a second failure in a row.
    const { calls } = await turnsAt($, on, [0, MINUTE, MINUTE], ["fail", "ok", "ok"], { profileFails: true });
    expect(calls).toEqual([0, 1, 2]);
  });

  // The pacing is the session's state, so a reload of the module keeps it.
  const PACE = { plugin: "cockpit", key: "lookupPace" } as const;
  test("keeps the lookup pacing in the session's state", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    const paced: unknown[] = [];
    on("state.set", PACE, ($, e, next) => {
      paced.push(e.value);
      return next(e);
    });
    const { asked, clock } = lookupWorld(on, { usage: () => ({ status: 500, text: "" }) });
    await startWithLimits($, on, sevenUsedUp());
    await endTurn($, on);
    expect(paced.at(-1)).toEqual({ notBefore: clock.now() + MINUTE, failures: 1 });
  });

  test("makes no lookup within the wait a reloaded module finds in the session's state", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    const notBefore = clockOn(on).now() + 30_000;
    on("state.get", PACE, () => ({ value: { value: { notBefore, failures: 0 }, version: 1 } }));
    const { asked, clock } = lookupWorld(on);
    await startWithLimits($, on, sevenUsedUp());
    await endTurn($, on);
    expect(asked).toEqual([]);
    await clock.advance(30_000);
    await endTurn($, on);
    expect(asked[0]?.url).toBe(USAGE_URL);
  });

  // A session whose state already holds a lookup's credits, and the billing day; its limits are what the test starts with.
  const creditsOf = (extra: Partial<StatusCredits> = {}): StatusCredits => ({ at: START, enabled: true, spent: 1011, cap: 1500, decimals: 2, currency: "EUR", capReached: false, reason: null, ...extra });
  const holding = (on: On, credits: StatusCredits, billing?: number, rejected?: Record<string, number>) => {
    clockOn(on);
    on("state.get", { plugin: "cockpit", key: "credits" }, () => ({ value: { value: credits, version: 1 } }));
    if (billing !== undefined) on("state.get", { plugin: "cockpit", key: "billing" }, () => ({ value: { value: billing, version: 1 } }));
    if (rejected) on("state.get", { plugin: "cockpit", key: "rejected" }, () => ({ value: { value: rejected, version: 1 } }));
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The date a reset reads as: `Nov 17 4 PM` for 4 PM local on that day.
  const dateAt = (at: Date) => `${MONTHS[at.getMonth()]} ${at.getDate()} 4 PM`;
  const creditsTag = async (ui: { find: Mounted["find"] }) => {
    const tag = await ui.find({ type: "Box", key: "credits" });
    if (!tag) return undefined;
    const [badge, ...bar] = elements(tag.children);
    return { badge: flat(badge), bar: litCells(bar) };
  };

  // The tag's text and bar. The billing day is 5 days out, so the reset is the date 5 days from today at the 7d's 4 PM.
  test("draws the credits tag: € on its badge, the share spent as cells, and its explanation with the reset", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    const billing = localAt(5, 16);
    holding(on, creditsOf(), billing.getDate());
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    // 1011 of 1500 is 67%: 4 of the 7d's 7 cells.
    expect(await creditsTag(ui)).toEqual({ badge: " € ", bar: "BBBB___" });
    expect(await explanationOf(ui, "credits")).toBe(`€ at 67%: €10.11 of €15.00 spent, it resets on ${dateAt(billing)}.`);
    await ui.unmount();
  });

  test("draws the credits bar in the 7d bar's length", { options: { usage_lookup: true, limit_7d_length: 10 } }, async ($, on) => {
    stubHint(on, START);
    holding(on, creditsOf());
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    // 67% of 10 cells, floored.
    expect((await creditsTag(ui))?.bar).toBe("BBBBBB____");
    await ui.unmount();
  });

  test("explains the credits without a reset when the 7d has no reset time", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    holding(on, creditsOf(), 17);
    await startWithLimits($, on, [{ kind: "seven_day", percentUsed: 100 }]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "credits")).toBe("€ at 67%: €10.11 of €15.00 spent.");
    await ui.unmount();
  });

  test("shows a currency the mod has no symbol for by its code", { options: { usage_lookup: true } }, async ($, on) => {
    stubHint(on, START);
    holding(on, creditsOf({ currency: "CHF" }));
    await startWithLimits($, on, sevenUsedUp());
    const ui = await mountHint($);
    expect((await creditsTag(ui))?.badge).toBe(" CHF ");
    expect(await explanationOf(ui, "credits")).toBe("CHF at 67%: CHF 10.11 of CHF 15.00 spent.");
    await ui.unmount();
  });

  // The tag draws only with extra usage enabled and a window at 100%: the 7d, the 5h alone, or one a refusal still holds.
  for (const [what, credits, limits, rejected, drawn] of [
    ["enabled and the 7d at 100%", creditsOf(), sevenUsedUp(), undefined, true],
    ["enabled and the 5h alone at 100%", creditsOf(), fiveUsedUp(), undefined, true],
    ["enabled and a refusal on the 7d that has not reset, the 7d reading 60%", creditsOf(), [sevenResettingAt(60, localAt(3, 16))], { seven_day: START + 3_600_000 }, true],
    ["enabled and the 7d at 80% and the 5h at 40%", creditsOf(), [sevenResettingAt(80, localAt(2, 16)), { kind: "five_hour", percentUsed: 40, resetsAt: localAt(0, 23, 59).toISOString() }], undefined, false],
    ["not enabled and the 7d at 100%", creditsOf({ enabled: false }), sevenUsedUp(), undefined, false],
  ] as const)
    test(`${drawn ? "draws" : "draws no"} credits tag with extra usage ${what}`, { options: { usage_lookup: true } }, async ($, on) => {
      stubHint(on, START);
      holding(on, credits, 17, rejected);
      await startWithLimits($, on, [...limits]);
      const ui = await mountHint($);
      expect(await creditsTag(ui)).toEqual(drawn ? { badge: " € ", bar: "BBBB___" } : undefined);
      await ui.unmount();
    });

  console.log(`cockpit tests in random order, seed ${seed}`);
  for (const [name, rest] of shuffled(queued)) kitTest(name, ...rest);
});
