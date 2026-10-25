import type { AgentInfo, AgentStatus, CommandRunResult, ConfigRow, ConfigValue, On, SessionContextBreakdown, SessionContextUsage, SessionRateLimit, TurnUsage } from "claude-code";
import { describe, type Engine, expect, type FoundElement, type Mounted, mock, test as kitTest, type TestRest } from "claude-code/testing";

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
const STATUS = "model,gap-1,limit_7d,gap-1,limit_5h,gap-1,context,gap-1,turns,gap-1,tokens,gap-1,agents,gap-1,cache";
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

// The status row draws under the prompt, below the engine's hint line, which a test stands in for: before its first
// call of $, as the kit requires.
// The band above the prompt draws nothing of its own until the mod's git row has something to show.
function stubHint(on: On): void {
  on("ui.render", { component: "PromptHint" }, ($, e) => $.ui.resolve(e).Text({ children: "? for shortcuts" }));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "" }));
}
function mountHint($: Engine, isDraft = false): Promise<Mounted<"terminal", "PromptHint">> {
  return $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "PromptHint", props: { isDraft, isWorking: false, hint: "? for shortcuts" } });
}
// A session started with these limits, its last response a second old, or `readAgoMs` old. By default the 5h is at 70%
// with 2 hours to its reset, 3 hours into its 5: at that pace it runs out in 1h17m, 43m before it resets.
async function startWithLimits($: Engine, on: On, rateLimits?: SessionRateLimit[], readAgoMs = 1_000): Promise<void> {
  const now = Date.now();
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: rateLimits ?? [{ kind: "five_hour", percentUsed: 70, resetsAt: new Date(now + 120 * 60_000).toISOString() }] } }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("state.get", { plugin: "cockpit", key: "readAt" }, () => ({ value: { value: now - readAgoMs, version: 1 } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
}

// A session idle with its cache 3 minutes from cold: the commands the mod runs over 2 polls (none, before the
// person's first prompt is asserted), then a prompt typed at the composer, then 3 polls more.
async function handoffRuns($: Engine, on: On, { model = "claude-opus-5-5", rateLimits = [], ttl = "1h", agents = [], after = 3, trace = [], settings = {}, ago = 57, reloaded = false }: { model?: string; rateLimits?: SessionRateLimit[]; ttl?: string; agents?: AgentInfo[]; after?: number; trace?: string[]; settings?: Record<string, unknown>; ago?: number; reloaded?: boolean } = {}): Promise<string[]> {
  stubHint(on);
  // An hour-TTL write 57 minutes ago: 3 minutes left, inside the 5-minute lead. A five-minute write 3 minutes ago has 2 left;
  // "5m-late", 4.5 minutes ago, has 30 seconds, inside the 1-minute lead of a five-minute cache.
  const clock = mock.clock(on);
  const ran: string[] = [];
  // "5m-held": written for five minutes, yet read back whole after ten idle ones, 57 minutes ago: it outlived its label.
  const written = { ephemeral_5m_input_tokens: ttl === "5m" || ttl === "5m-late" ? 1_000_000 : 0, ephemeral_1h_input_tokens: ttl === "1h" ? 1_000_000 : 0 };
  const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: written };
  const row = (id: string, minutesAgo: number, u: object) =>
    JSON.stringify({ type: "assistant", requestId: id, timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage: u } });
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
  if (reloaded) on("state.get", { plugin: "cockpit", key: "stretch" }, () => ({ value: { value: { promptAt: Date.now() - 60_000, handoffAt: 0, compactedAt: 0 }, version: 1 } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const ui = await mountHint($);
  for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: "cache" })).length === 0; i++) {
    await settle();
  }
  const polls = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await clock.advance(2_000);
      await settle();
    }
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
    stubHint(on);
    const now = Date.now();
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
    // Hovered, each limit's countdown to its reset.
    expect(await explanationOf(ui, "limit_7d")).toMatch(/1d1h/);
    expect(await explanationOf(ui, "limit_5h")).toMatch(/2h5[56]m/);
    // A window the mod has no bar for shows as its name and percentage.
    expect(await ui.find({ type: "Text", text: "seven_day_fable 86%" })).toBeDefined();
    // The context bar against the 900,000-token compaction threshold: 797,100 used is 88%, so 1 of 10 cells of window
    // left underneath; past the 200,000-token smart zone, none on top. 597,100 of the 700,000 between the smart zone
    // and the threshold is 85%: the full moon. The threshold comes after the first draw, which measures the whole window.
    const bar = async () => {
      const context = must(await ui.find({ type: "Box", key: "context" }), "the context chip");
      return { badge: flat(context.children[0]), halves: litCells(context.children.slice(1)) };
    };
    for (let i = 0; i < 50 && (await bar()).halves !== "U_________"; i++) await settle();
    expect(await bar()).toEqual({ badge: " ● ", halves: "U_________" });
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
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.root", () => ({ value: "/work" }));
    on("session.cwd", () => ({ value: "/work" }));
    on("process.run", () => ({ value: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository", isStdoutTruncated: false, isStderrTruncated: false } }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !rowSpelled((await tagRows(ui))[0]).includes("work"); i++) await settle();
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["Opus 5.5", "_1", "work"]);
    await ui.unmount();
  });

  test("draws the smart zone left on top of the context bar, sized by the smart_zone_tokens option", { options: { smart_zone_tokens: 100_000 } }, async ($, on) => {
    stubHint(on);
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
    stubHint(on);
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
  // The bar as drawn once it reaches `bar`, or as last drawn: the breakdown comes after the first draw.
  const contextBar = async (ui: Mounted<"terminal", "PromptHint">, bar: { badge: string; lit: string }) => {
    let drawn;
    for (let i = 0; i < 50; i++) {
      const chip = must(await ui.find({ type: "Box", key: "context" }), "the context chip");
      drawn = { badge: flat(chip.children[0]), lit: litCells(chip.children.slice(1)) };
      if (drawn.badge === bar.badge && drawn.lit === bar.lit) break;
      await settle();
    }
    return drawn;
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
      stubHint(on);
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
      const ui = await mountHint($);
      expect(await contextBar(ui, bar)).toEqual(bar);
      expect(await explanationOf(ui, "context")).toContain(left);
      await ui.unmount();
    });

  test("reads the compaction threshold again when a turn ends", { options: smartZone }, async ($, on) => {
    stubHint(on);
    // The threshold the session reports changes between turns, as a setting or a different model's window would change it.
    let threshold = 1_350_000;
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 675_000, window: 1_500_000, breakdown: breakdownOf(1_500_000, 675_000, threshold) }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    expect(await contextBar(ui, { badge: " ◑ ", lit: "UUUUU_____" })).toEqual({ badge: " ◑ ", lit: "UUUUU_____" });
    expect(await explanationOf(ui, "context")).toContain("675.0K");
    // Against 900,000: 225,000 left, 75% used, 2 cells left; (675,000 - 150,000) of the 750,000 beyond the smart zone is the fourth moon.
    threshold = 900_000;
    await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", durationMs: 1_000 });
    expect(await contextBar(ui, { badge: " ◕ ", lit: "UU________" })).toEqual({ badge: " ◕ ", lit: "UU________" });
    expect(await explanationOf(ui, "context")).toContain("225.0K");
    await ui.unmount();
  });

  test("draws each limit's time left on top, its usage left underneath, and the empty track to 100%", async ($, on) => {
    stubHint(on);
    const now = Date.now();
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
    // Hovered, each limit's countdown to its reset.
    expect(await explanationOf(ui, "limit_7d")).toContain("2d12h");
    expect(await explanationOf(ui, "limit_5h")).toContain("2h4");
    await ui.unmount();
  });

  // A limit_style the mod does not know draws the two lanes cockpit 1.1.0 drew: the reading above, in the same colours.
  test("draws both limit tags as classic for a limit_style it does not know", { options: { limit_style: "fancy" } }, async ($, on) => {
    stubHint(on);
    const now = Date.now();
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

  // A 7d reading with `passed` of its window gone, and the 5h's alike.
  const reading = (kind: "seven_day" | "five_hour", percentUsed: number, passed: number): SessionRateLimit => {
    const windowMs = kind === "seven_day" ? 604_800_000 : 18_000_000;
    return { kind, percentUsed, resetsAt: new Date(Date.now() + (1 - passed) * windowMs).toISOString() };
  };
  // A gauge tag as drawn: its badge's text, its bar glyph by glyph (█ a full cell, ▐ or ▌ the half on the pipe's side, a
  // space an empty cell, │ the pipe), and each glyph's colour and background.
  const gaugeOf = async (ui: { find: Mounted["find"] }, key: string) => {
    const [badge, ...bar] = elements(must(await ui.find({ type: "Box", key }), `the ${key} gauge`).children);
    return { badge: flat(badge), bar: bar.map(flat).join(""), colors: bar.map(({ props }) => props.color), backgrounds: bar.map(({ props }) => props.backgroundColor) };
  };

  test("reads the limit and its percent used, rounded, in the gauge's badge", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on);
    await startWithLimits($, on, [reading("seven_day", 50.6, 1 / 3)]);
    const ui = await mountHint($);
    expect((await gaugeOf(ui, "seven_day")).badge).toBe(" 7d 51% ");
    await ui.unmount();
  });

  test("draws half the length, rounded down, on each side of the gauge's pipe: 5 at the 5h's 10, 3 at the 7d's 7", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on);
    // Too early in either window for a pace, so each side is blank.
    await startWithLimits($, on, [reading("seven_day", 1, 0), reading("five_hour", 1, 0)]);
    const ui = await mountHint($);
    expect((await gaugeOf(ui, "five_hour")).bar).toBe("     │     ");
    expect((await gaugeOf(ui, "seven_day")).bar).toBe("   │   ");
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
      stubHint(on);
      await startWithLimits($, on, [reading("seven_day", used, passed)]);
      const ui = await mountHint($);
      const gauge = await gaugeOf(ui, "seven_day");
      expect(gauge.bar).toBe(bar);
      // The pipe, at 5, in the par colour.
      expect(colors.map(([i]) => [i, gauge.colors[i]])).toEqual(colors);
      await ui.unmount();
    });

  // 51% with a third of the 7d gone is over pace with a usable reading; each of these takes the pace away.
  for (const [title, limit, readAgoMs] of [
    ["draws a gauge with no reset time without a pace", { kind: "seven_day", percentUsed: 51 }, 1_000],
    ["draws a gauge without a pace when this session's last response is 11 minutes old", reading("seven_day", 51, 1 / 3), 11 * 60_000],
    ["draws a gauge without a pace while less than a tenth of the window has passed", reading("seven_day", 51, 0.05), 1_000],
  ] satisfies [string, SessionRateLimit, number][])
    test(title, { options: { limit_style: "gauge", limit_7d_length: 10 } }, async ($, on) => {
      stubHint(on);
      await startWithLimits($, on, [limit], readAgoMs);
      const ui = await mountHint($);
      const gauge = await gaugeOf(ui, "seven_day");
      expect(gauge.badge).toBe(" 7d 51% ");
      expect(gauge.bar).toBe("     │     ");
      // Every cell grey, the pipe dim: no pace colour anywhere.
      expect(gauge.backgrounds).toEqual(Array(11).fill("#373a48"));
      expect(gauge.colors).toEqual([...Array(5).fill("#373a48"), "#6b7280", ...Array(5).fill("#373a48")]);
      await ui.unmount();
    });

  // The 7d, 5h and context bars, each with a value to show while hovered.
  const mountBars = async ($: Engine, on: On) => {
    stubHint(on);
    const resetsAt = new Date(Date.now() + 9_900_000).toISOString();
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
      stubHint(on);
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

      // The scan has run once the last chip is there: the agents' chip, or the merged one that holds them.
      for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: chips.at(-1)?.[0] })).length === 0; i++) {
        await settle();
      }
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
    stubHint(on);
    // An hour-TTL write, then a read: the cache lives an hour from the read. 1,000,000 cached tokens on Opus 5.5:
    // $0.20 read, $8.00 written for an hour. A subagent's later request with a 5m write changes nothing here.
    const row = (minutesAgo: number, usage: object, extra: object = {}) =>
      JSON.stringify({ type: "assistant", requestId: `r${minutesAgo}`, timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage }, ...extra });
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

    const chip = async (ui: Mounted<"terminal", "PromptHint">) => {
      for (let i = 0; i < 50; i++) {
        const found = await ui.find({ type: "Box", key: "cache" });
        if (found) return found;
        await settle();
      }
      throw new Error("the cache chip did not draw");
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
    for (let i = 0; i < 50 && !flat((await chip(ui)).children[1]).match(/^ (20|19)m/); i++) await settle();
    expect(flat((await chip(ui)).children[0])).toBe(" ◑ ");
    await ui.unmount();

    // A request that has just ended has the whole hour left, which reads 59m from the first frame, never 1h0m.
    minutes = 0;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    ui = await mount();
    for (let i = 0; i < 50 && /^ (20|19)m/.test(flat((await chip(ui)).children[1])); i++) await settle();
    expect(flat((await chip(ui)).children[1])).toBe(" 59m $0.20 ");
    await ui.unmount();

    // Two hours on, the hour is up: the next prompt writes the cache again.
    minutes = 120;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    ui = await mount();
    for (let i = 0; i < 50 && !flat((await chip(ui)).children[1]).includes("cold"); i++) await settle();
    cache = await chip(ui);
    expect(flat(cache.children[0])).toBe(" ○ ");
    expect(flat(cache.children[1])).toBe(" cold $8.00 ");
    // Cold, it still has an explanation, so the value stands on the grey too.
    expect(JSON.stringify(cache.children[1])).toContain("#373a48");
    await ui.unmount();
  });

  test("shows a limit another session was refused on as used up, until it resets", async ($, on) => {
    stubHint(on);
    // This session last heard 40% of the 5h window used; another session's transcript has its refusal, resetting in an hour.
    const now = Date.now();
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
    // Usage left is the bars' bottom halves: none once refused, where 40% used would light 6.
    const usageLeft = async () =>
      (await ui.findAll({ type: "Text", text: "▀" })).filter((t) => t.props.backgroundColor !== "#373a48").length;
    let lit = await usageLeft();
    for (let i = 0; i < 50 && lit !== 0; i++) {
      await settle();
      lit = await usageLeft();
    }
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
    stubHint(on);
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
    stubHint(on);
    await startWithLimits($, on);
    const above = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Text", text: /at this pace/ })).toBeDefined();
    await above.unmount();
    const below = await mountHint($);
    expect(await below.find({ type: "Text", text: /at this pace/ })).toBeUndefined();
    await below.unmount();
  });

  // The 5h window is 300 minutes long. 70% used with 2h left is 3h in: at that pace 100% comes 1h17m from now, 43m before the reset.
  // The reading's time is the last response of this session, which the test stands in for with its age in minutes.
  for (const [title, used, resetsInMin, readAgoMin, options, shown] of [
    ["warns when a limit runs out before it resets at the pace so far", 70, 120, 0, {}, true],
    ["stays quiet while the pace reaches the reset with room to spare", 40, 120, 0, {}, false],
    ["stays quiet early in a window, where the pace is noise", 70, 290, 0, {}, false],
    ["stays quiet when this session's last response is over 10 minutes old", 70, 120, 11, {}, false],
    ["stays quiet when the person turned limit_forecast off", 70, 120, 0, { limit_forecast: false }, false],
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on);
    const now = Date.now();
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        context: { window: 1_000_000 },
        rateLimits: [
          { kind: "five_hour", percentUsed: used, resetsAt: new Date(now + resetsInMin * 60_000).toISOString() },
          // 7d is 85% gone at 20% used: on track, so it never gets a line of its own.
          { kind: "seven_day", percentUsed: 20, resetsAt: new Date(now + 90_030_000).toISOString() },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("state.get", { plugin: "cockpit", key: "readAt" }, () => ({ value: { value: now - readAgoMin * 60_000 - 1_000, version: 1 } }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const explain = must(await ui.find({ type: "Box", key: "explain" }), "the explanation line");
    // The warning sign, then the sentence; blank when the warning does not apply.
    expect(shownIn(explain)).toMatch(shown ? /^\uf071 5h at 70%: at this pace it runs out in 1h17m, 4[23]m before it resets\.$/ : /^$/);
    await ui.unmount();
  });

  // Both limits run out before their resets; the line warns of the one that runs out first. The 7d at 99% with a day
  // left is 6 days in: 1h27m to go. The 5h at 70% with 2h left runs out in 1h17m, at 65% in 1h36m.
  for (const [five, shown, hidden] of [
    [70, /^\uf071 5h at 70%: at this pace it runs out in 1h17m, /, /7d at/],
    [65, /^\uf071 7d at 99%: at this pace it runs out in 1h27m, /, /5h at/],
  ] as const)
  test(`warns of the limit that runs out sooner, with the 5h at ${five}% and the 7d at 99%`, async ($, on) => {
    stubHint(on);
    const now = Date.now();
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
    stubHint(on);
    const now = Date.now();
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
    on("state.get", { plugin: "cockpit", key: "readAt" }, () => ({ value: { value: now - 1_000, version: 1 } }));
    on("env.get", ($, e) => ({ value: e.name === "HOME" ? "/home/u" : undefined }));
    on("http.fetch", () => ({ value: { status: 200, ok: true, headers: {}, text: md } }));
    on("process.spawn", async function* () {
      yield { stream: "stdout", text: transcript };
      return { value: { code: 0, signal: null } };
    });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    // The token scan has run once the cache tag draws here, or with it above the prompt, once its explanation does.
    const scanned = async () => (await ui.find({ type: "Box", key: "cache" })) !== undefined || (await ui.find({ type: "Text", text: /^Cache / })) !== undefined;
    for (let i = 0; i < 50 && !(await scanned()); i++) await settle();
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
    expect(rest).toMatchObject(EXPLAINED.map(() => ({ props: { position: "absolute", backgroundColor: "#373a48" } })));
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

  // The 5h at 70% resets in 2 hours (1h59m once a second passes), the 7d at 20% in 1d1h.
  for (const [style, said] of [["classic", ""], ["gauge", " on the gauge too"]] as const)
    test(`explains each limit tag with its badge, its percent used and the time until it resets${said}`, { options: { limit_style: style } }, async ($, on) => {
      const ui = await explained($, on);
      expect(await explanationOf(ui, "limit_5h")).toMatch(/5h.* 70%.* (1h59m|2h0m)/);
      expect(await explanationOf(ui, "limit_7d")).toMatch(/7d.* 20%.* 1d1h/);
      await ui.unmount();
    });

  test("rounds a limit's percent used in its explanation, as the gauge's badge and the run-out warning round it", async ($, on) => {
    stubHint(on);
    await startWithLimits($, on, [{ kind: "seven_day", percentUsed: 50.6, resetsAt: new Date(Date.now() + 90_030_000).toISOString() }]);
    const ui = await mountHint($);
    expect(await explanationOf(ui, "limit_7d")).toMatch(/ 51%/);
    await ui.unmount();
  });

  // A value on the grey says hovering shows more. Every chip has an explanation, so its value stands on the grey while
  // the explanation line can show it, the turns before any subagent and a cold cache included, and never without it.
  const valueBackgrounds = async (ui: { find: Mounted["find"] }, key: string) =>
    elements(elements(must(await ui.find({ type: "Box", key }), `the ${key} chip`).children)[1]?.children ?? []).map((glyph) => glyph.props.backgroundColor);
  for (const [title, options, agents, cachedAgo, keys, grey] of [
    ["keeps each chip's value on the grey while explain_row is on, the turns before any subagent and a cold cache included", {}, false, 120, ["turns", "tokens", "cache"], "#373a48"],
    ["stands no chip's value on the grey with explain_row off", { explain_row: false }, true, 10, ["turns", "tokens", "agents", "cache"], undefined],
  ] as const)
    test(title, { options }, async ($, on) => {
      const ui = await explained($, on, { agents, cachedAgo });
      for (const key of keys) expect(new Set(await valueBackgrounds(ui, key))).toEqual(new Set([grey]));
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
  for (const [title, files, offered, lastAgo, options, agents, prompted, handoffBefore = 0.5] of [
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
  ] as const)
  test(title, { options }, async ($, on) => {
    stubHint(on);
    // The session's first request had a 20,000-token prompt; its last, two hours ago, wrote 1,000,000 for an hour: cold,
    // and $8.00 to write again on Opus 5.5. The 0900 file is from before this session started, the 1200 one (40,000
    // bytes, about 10,000 tokens) after: fresh from it is 30,000 tokens at the same rate, $0.24.
    const clock = mock.clock(on);
    const written = (tokens: number) => ({ input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: tokens } });
    const row = (id: string, minutesAgo: number, tokens: number) =>
      JSON.stringify({ type: "assistant", requestId: id, timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(), message: { model: "claude-opus-5-5", usage: written(tokens) } });
    const transcript = [row("r1", 150, 20_000), row("r2", lastAgo, 1_000_000)].join("\n");
    const file = (name: string, mtimeMs: number) => ({ name, kind: "file" as const, size: 40_000, mtimeMs, isLink: false });
    // The 0900 file is older than the session; the others were written `handoffBefore` minutes before its last request.
    const handoffAt = Date.now() - (lastAgo + handoffBefore) * 60_000;
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
    let button;
    for (let i = 0; i < (offered ? 50 : 5) && !button; i++) {
      await clock.advance(2_000);
      await settle();
      button = (await ui.findAll({ type: "Button", key: "resume" }))[0];
    }
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
    stubHint(on);
    const clock = mock.clock(on);
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
    let button;
    for (let i = 0; i < (offered ? 50 : 5) && !button; i++) {
      await clock.advance(2_000);
      await settle();
      button = (await ui.findAll({ type: "Button", key: "compact" }))[0];
    }
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
    stubHint(on);
    const clock = mock.clock(on);
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
    for (let i = 0; i < 50 && !(await offer()); i++) {
      await clock.advance(2_000);
      await settle();
    }
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
    await settle();
    expect(await offer()).toBeUndefined();
    await end();
    await settle();
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
    await settle();
    expect(await offer()).toBeUndefined();
    must(held, "the held /compact").finish({ text: "" });
    await running;
    await settle();
    expect(await offer()).toBeDefined();
    await spinner.unmount();
    await ui.unmount();
  });

  test("keeps the compaction offer while a subagent's spinner says it compacts", async ($, on) => {
    const { ui, offer } = await offered($, on);
    const spinner = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Spinner", requestId: "agent-1", props: SPINNER });
    await settle();
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
    stubHint(on);
    const clock = mock.clock(on);
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
    let button;
    for (let i = 0; i < 50 && !button; i++) {
      await clock.advance(2_000);
      await settle();
      button = (await ui.findAll({ type: "Button", key: "compact" }))[0];
    }
    expect(button).toBeDefined();
    await ui.press({ key: "dismiss" });
    expect((await ui.findAll({ type: "Button", key: "compact" }))[0]).toBeUndefined();
    // A prompt of the person's does not bring it back.
    await typeAtComposer($, "go on");
    await clock.advance(seconds * 1_000);
    await settle();
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
    stubHint(on);
    const clock = mock.clock(on);
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
      for (let i = 0; i < n; i++) {
        await clock.advance(2_000);
        await settle();
      }
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
    stubHint(on);
    const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } };
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
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
    for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: "tokens" })).length === 0; i++) await settle();
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
    stubHint(on);
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

    let changes;
    for (let i = 0; i < 50 && !changes; i++) {
      changes = await ui.find({ type: "Box", text: "+120 -8 ~2" });
      if (!changes) await settle();
    }
    expect(changes).toBeDefined();
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
    stubHint(on);
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

    let branch;
    for (let i = 0; i < 50 && !branch; i++) {
      branch = await ui.find({ type: "Box", text: "⎇ feat" });
      if (!branch) await settle();
    }
    expect(branch).toBeDefined();
    expect(await ui.find({ type: "Box", text: "⎇ trunk ⎇ feat" })).toBeUndefined();
    await ui.unmount();
  });

  test("parts the default branch from the folder by the default order's gap, where no ⎇ does", async ($, on) => {
    stubHint(on);
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

    const glyphs = async () => (await ui.findAll({ type: "Text" })).map(glyph).join("");
    for (let i = 0; i < 50 && !(await glyphs()).includes("trunk"); i++) await settle();
    const rows = await tagRows(ui);
    // The gaps after trunk, before parts with nothing to show, are dropped at the row's end.
    expect(rowSpelled(rows[0])).toEqual(["cc-mods", "_1", "trunk"]);
    await ui.unmount();
  });

  // While the order pane shows, a part with nothing to show draws a made-up value, so it can be placed.
  test("draws every git part while the order pane shows, and only what there is once it closes", async ($, on) => {
    stubHint(on);
    const clock = mock.clock(on);
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
    for (let i = 0; i < 50 && !(await glyphs()).includes("trunk"); i++) await settle();
    expect(await glyphs()).not.toContain("PR #");

    isOpen = true;
    await clock.advance(100);
    for (let i = 0; i < 50 && !(await glyphs()).includes("PR #42"); i++) await settle();
    // The real folder and branch, and made-up values for the rest.
    const spelled = rowSpelled((await tagRows(ui))[0]);
    for (const text of ["cc-mods", "trunk", "⎇ spike", "PR #42", "↑2? ↓1?", "+12 -3 ~2"]) expect(spelled).toContain(text);

    isOpen = false;
    await clock.advance(100);
    for (let i = 0; i < 50 && (await glyphs()).includes("PR #42"); i++) await settle();
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["cc-mods", "_1", "trunk"]);
    await ui.unmount();
  });

  test("draws every status tag while the order pane shows, and an offer that does not hold as a dim line naming it", async ($, on) => {
    stubHint(on);
    const clock = mock.clock(on);
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

  // No response has come in this session, so a real reading would be stale; the samples count as fresh.
  test("draws the 5h sample's pace on a gauge while the order pane shows", { options: { limit_style: "gauge" } }, async ($, on) => {
    stubHint(on);
    mock.clock(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("ui.panes", () => ({ value: [{ id: "cockpit-order", title: "Cockpit order", isShown: true, isFocused: false, isPlaced: true, plugin: "cockpit" }] }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    for (let i = 0; i < 50 && !(await ui.find({ type: "Box", key: "five_hour" })); i++) await settle();
    // The sample is 20% used halfway through the window: r 0.4, 60% of the target unused, 6 of 10 halves.
    expect((await gaugeOf(ui, "five_hour")).bar).toBe("  ███│     ");
    await ui.unmount();
  });

  // A /clear fires no session.start; the mod's hook on the command starts the readings and the tick over.
  test("draws the status row in a session a /clear started", async ($, on) => {
    stubHint(on);
    mock.clock(on);
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
    stubHint(on);
    const clock = mock.clock(on);
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
    let number = false;
    for (let i = 0; i < 50 && !number; i++) {
      number = await href("https://github.com/o/r/pull/42");
      if (!number) await settle();
    }
    expect(number).toBe(true);
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
    for (let i = 0; i < 5 && (await href("https://github.com/o/r/commits/feat")); i++) {
      await clock.advance(2_000);
      await settle();
    }
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
      stubHint(on);
      mock.clock(on);
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
      for (let i = 0; i < 50 && !(await link()); i++) await settle();
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
      stubHint(on);
      const clock = mock.clock(on);
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
      for (let i = 0; i < 50 && asks === 0; i++) await settle();
      for (let i = 0; i < 6; i++) {
        await clock.advance(2_000);
        await settle();
      }
      // git ran, so no ask means one skipped.
      expect(scans).toBeGreaterThan(0);
      expect(asks).toBe(calls);
    });
  }

  // The line that closes a turn gets the tokens the turn generated per second in its verb: its output tokens over the
  // seconds, in the status row's units (plain under 1000, K to a tenth, M to a hundredth).
  const turnLine = async ($: Engine, on: On, props: { word: string; durationMs: number }, turn?: { durationMs: number; usage: TurnUsage }) => {
    stubHint(on);
    on("ui.render", { component: "TurnDuration" }, ($, e) => $.ui.resolve(e).Text({ children: `${e.props.word} for 7s` }));
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    if (turn) await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", ...turn });
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "TurnDuration", props });
    const text = async () => (await ui.findAll({ type: "Text" })).map(glyph).join("");
    for (let i = 0; i < 50 && !(await text()).includes("tok/s"); i++) await settle();
    const drawn = await text();
    await ui.unmount();
    return drawn;
  };
  const used = (output: number, others = 0) => ({ input_tokens: others, output_tokens: output, cache_read_input_tokens: others, cache_creation_input_tokens: others, model: "claude-opus-5-5" });
  const RATES: [number, string][] = [[7_000, "1.0K"], [700, "100"], [14_500 * 1_000, "2.07M"], [7_000_000, "1.00M"], [6_999, "999"]];
  for (const [tokens, rate] of RATES) {
    test(`draws ${rate} tok/s in the closing line for ${tokens} output tokens over 7 s`, async ($, on) => {
      mock.clock(on);
      const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(tokens) });
      expect(drawn).toBe(`Cooked at ${rate} tok/s for 7s`);
    });
  }

  test("counts only the output tokens: the input, the cache read and the cache write are not tokens generated", async ($, on) => {
    mock.clock(on);
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(350, 1_000_000) });
    expect(drawn).toBe("Cooked at 50 tok/s for 7s");
  });

  test("draws no rate when the person turned turn_rate off", { options: { turn_rate: false } }, async ($, on) => {
    mock.clock(on);
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 7_000 }, { durationMs: 7_000, usage: used(7_000) });
    expect(drawn).toBe("Cooked for 7s");
  });

  test("gives a closing line of another length none: it is an older turn's", async ($, on) => {
    mock.clock(on);
    const drawn = await turnLine($, on, { word: "Cooked", durationMs: 30_000 }, { durationMs: 7_000, usage: used(7_000) });
    expect(drawn).toBe("Cooked for 7s");
  });

  test("polls git and the limits every 2 s, so a branch switch and spent usage show without a turn ending", async ($, on) => {
    stubHint(on);
    const clock = mock.clock(on);
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
    const until = async (text: string) => {
      for (let i = 0; i < 50; i++) {
        if (await ui.find({ type: "Box", text })) return true;
        await settle();
      }
      return false;
    };
    // The bottom half of a 5h cell is lit while its usage is left: all ten at 0% used, none at 100%. The limits are
    // under the prompt, the branch above it.
    const hint = await mountHint($);
    const usageLeft = async () =>
      (await hint.findAll({ type: "Text", text: "▀" })).filter((t) => t.props.backgroundColor !== "#373a48").length;

    expect(await until("⎇ feat-a")).toBe(true);
    expect(await usageLeft()).toBe(10);

    branch = "feat-b";
    used = 100;
    await clock.advance(1_900);
    expect(await ui.find({ type: "Box", text: "⎇ feat-b" })).toBeUndefined();
    await clock.advance(100);
    expect(await until("⎇ feat-b")).toBe(true);
    expect(await usageLeft()).toBe(0);
    await hint.unmount();
    await ui.unmount();
  });

  test("shows the folder outside a repository, and nothing of git", async ($, on) => {
    stubHint(on);
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

    let folder;
    for (let i = 0; i < 50 && !folder; i++) {
      folder = await ui.find({ type: "Box", text: "cc-mods" });
      if (!folder) await settle();
    }
    expect(folder).toBeDefined();
    expect(await ui.find({ type: "Text", text: "⎇" })).toBeUndefined();
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(["cc-mods"]);
    await ui.unmount();
  });

  test("colours the model by family, Mythos bold", async ($, on) => {
    stubHint(on);
    // A held clock draws no frames, so the sweep stays at its start: a name's first glyph shows its window's first colour.
    mock.clock(on);
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
    const clock = mock.clock(on);
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
  // (1-10), ── row 2 ── (11), model .. cache (12-19), ── hidden ── (20), spacer, gap-1, gap-2, gap-3 (21-24).
  const GIT_TAGS = "folders,branch,worktree,pr,review,comments,sync,conflict,checks,changes";
  const STATUS_TAGS = "model,limit_7d,limit_5h,context,turns,tokens,agents,cache";
  const pinned = (git = GIT_TAGS, status = STATUS_TAGS, hidden = "") => `${git};prompt;${status};fresh;compact;explain${hidden ? `;hidden;${hidden}` : ""}`;
  const PINNED = { layout: pinned() };

  test("dragging a row below the prompt marker moves it under the prompt", { options: PINNED }, async ($, on) => {
    // row 1 dropped on row 2's line goes below the prompt, after row 2.
    expect(await dragIn(on, $, PINNED, "lines", 0, 2)).toEqual([["layout", `prompt;${STATUS_TAGS};${GIT_TAGS};fresh;compact;explain`]]);
  });

  test("dragging a tag into the hidden zone switches it off and keeps the order of the rest", { options: PINNED }, async ($, on) => {
    // The model tag dropped on the hidden marker's line.
    expect(await dragIn(on, $, PINNED, "tags", 12, 20)).toEqual([["layout", pinned(GIT_TAGS, "limit_7d,limit_5h,context,turns,tokens,agents,cache", "model")]]);
  });

  test("dragging a hidden tag out turns it back on", { options: { layout: pinned(GIT_TAGS, "limit_7d,limit_5h,context,turns,tokens,agents,cache", "model") } }, async ($, on) => {
    // 7d .. cache 12-18, ── hidden ── 19, the spacer and gaps 20-23, model 24: dropped on the 7d limit's line.
    expect(await dragIn(on, $, PINNED, "tags", 24, 12)).toEqual([["layout", pinned()]]);
  });

  test("dragging a tag under another row's marker moves it into that row", { options: PINNED }, async ($, on) => {
    // The folders dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 1, 12)).toEqual([["layout", pinned("branch,worktree,pr,review,comments,sync,conflict,checks,changes", `model,folders,limit_7d,limit_5h,context,turns,tokens,agents,cache`)]]);
  });

  test("dragging the new row out of hidden reserves an empty row", { options: PINNED }, async ($, on) => {
    // The new row (8) dropped on the prompt marker's line, under row 1.
    expect(await dragIn(on, $, PINNED, "lines", 8, 1)).toEqual([["layout", `${GIT_TAGS};;prompt;${STATUS_TAGS};fresh;compact;explain`]]);
  });

  test("a tag dropped under an empty row's marker fills it", { options: { layout: `${GIT_TAGS};;prompt;${STATUS_TAGS};fresh;compact;explain` } }, async ($, on) => {
    // ── row 2 ── (11) has nothing under it, ── row 3 ── is 12, the model 13: dropped on row 3's marker, under row 2.
    expect(await dragIn(on, $, PINNED, "tags", 13, 12)).toEqual([["layout", `${GIT_TAGS};model;prompt;limit_7d,limit_5h,context,turns,tokens,agents,cache;fresh;compact;explain`]]);
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
    // The spacer (21) dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 21, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,spacer,limit_7d,limit_5h,context,turns,tokens,agents,cache")]]);
  });

  test("dragging a gap out of hidden adds it to the row", { options: PINNED }, async ($, on) => {
    // gap-2 (23) dropped on the 7d limit's line, after the model.
    expect(await dragIn(on, $, PINNED, "tags", 23, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,gap-2,limit_7d,limit_5h,context,turns,tokens,agents,cache")]]);
  });

  const SPACED = { layout: pinned(GIT_TAGS, "model,spacer,limit_7d,limit_5h,context,turns,tokens,agents,cache") };
  test("a second spacer is there to drag out once one is", { options: SPACED }, async ($, on) => {
    // model, spacer, 7d .. cache (12-20), ── hidden ── 21, the spare spacer 22: dropped beside the first.
    expect(await dragIn(on, $, SPACED, "tags", 22, 13)).toEqual([["layout", pinned(GIT_TAGS, "model,spacer,spacer,limit_7d,limit_5h,context,turns,tokens,agents,cache")]]);
  });

  test("dragging a spacer into hidden takes it away", { options: SPACED }, async ($, on) => {
    expect(await dragIn(on, $, SPACED, "tags", 13, 21)).toEqual([["layout", pinned()]]);
  });

  test("a spacer among the lines keeps its side of the prompt", { options: PINNED }, async ($, on) => {
    // The spacer (7) dropped on the prompt marker's line, above it, under row 1.
    expect(await dragIn(on, $, PINNED, "lines", 7, 1)).toEqual([["layout", `${GIT_TAGS};spacer;prompt;${STATUS_TAGS};fresh;compact;explain`]]);
  });

  test("dragging a git part into the hidden zone switches it off", { options: PINNED }, async ($, on) => {
    // The review dropped on the hidden marker's line.
    expect(await dragIn(on, $, PINNED, "tags", 5, 20)).toEqual([["layout", pinned("folders,branch,worktree,pr,comments,sync,conflict,checks,changes", STATUS_TAGS, "review")]]);
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

  test("the order pane lists the lines around the prompt marker and each row's tags under its marker, hidden ones after theirs", { options: { layout: "cache,model,limit_5h,context,turns,tokens;changes,spacer,folders,branch,worktree,pr,review,comments,sync,checks;prompt;fresh;compact;explain;hidden;limit_7d,conflict", compact_hint: false } }, async ($, on) => {
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-order", props: { title: "Cockpit order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    // What the pane hands each list's Client: the items, in the order they are drawn.
    const clientProps = async (key: string) => (await ui.find({ type: "Client", key }))?.props.props;
    expect(await clientProps("lines")).toMatchObject({ items: ["row-1", "row-2", "prompt", "fresh", "explain", "hidden", "spacer", "row", "compact"], fixed: ["prompt", "hidden"], labels: { "row-1": "▤ row 1: cache, model, 5h limit and 4 more" } });
    expect(await clientProps("tags")).toMatchObject({
      items: ["row-1", "cache", "model", "limit_5h", "context", "turns", "tokens", "agents", "row-2", "changes", "spacer", "folders", "branch", "worktree", "pr", "review", "comments", "sync", "checks", "hidden", "spacer", "gap-1", "gap-2", "gap-3", "limit_7d", "conflict"],
      fixed: ["row-1", "row-2", "hidden"],
      labels: { "row-2": "━━ row 2 ━━" },
    });
    // Each list as wide as the pane, so its labels wrap inside it.
    expect((await ui.findAll({ type: "Client" })).map((c) => c.props.width)).toEqual(["100%", "100%"]);
    await ui.unmount();
  });

  test("the order pane's text says the explanation line holds the run-out warning", async ($, on) => {
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
    expect(await dragIn(on, $, PINNED, "tags", 12, 19)).toEqual([["layout", pinned(GIT_TAGS, "limit_7d,limit_5h,context,turns,tokens,cache", "model")]]);
  });

  // A tag left out goes after the one before it in the default order, the first one first in the first row; a prompt
  // left out goes after the first row, an offer left out last.
  for (const [layout, lines, tags] of [
    ["branch,model;prompt;fresh", ["row-1", "prompt", "fresh", "compact", "explain"], ["row-1", ...GIT_TAGS.split(","), ...STATUS_TAGS.split(",")]],
    ["model;cache", ["row-1", "prompt", "row-2", "fresh", "compact", "explain"], ["row-1", ...GIT_TAGS.split(","), ...STATUS_TAGS.split(",").slice(0, -1), "row-2", "cache"]],
  ] as const) {
    test(`the order pane fills in what the layout ${layout} leaves out`, { options: { layout } }, async ($, on) => {
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
    stubHint(on);
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
    for (let i = 0; i < 50 && !(await ui.find({ type: "Box", text: "+3 -1 ~1" })); i++) await settle();
    // The commits ahead (↑2) are hidden.
    expect(rowSpelled((await tagRows(ui))[0])).toEqual(spelled);
    await ui.unmount();
  });

  test("wraps a label in a narrow order pane, and a press on its second line picks it", { options: PINNED }, async ($, on) => {
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
    // line each, 1-6, ahead and behind 7-8, conflict to changes 9-11, row 2's marker 12, model to cache 13-21 with the
    // main session's costs on two lines, the hidden marker from 22): ahead and behind is switched off.
    await ui.pointer({ type: "down", x: 3, y: 8, button: "left", in: "tags" });
    await ui.pointer({ type: "move", x: 3, y: 22, button: "left", in: "tags" });
    await ui.pointer({ type: "up", x: 3, y: 22, button: "left", in: "tags" });
    await ui.unmount();
    expect(written).toEqual([["layout", pinned("folders,branch,worktree,pr,review,comments,conflict,checks,changes", STATUS_TAGS, "sync")]]);
  });

  // The colours: the colors option's overrides, and with the gradients option off one colour per gradient.
  async function barsOf($: Engine, on: On, tokens: number) {
    stubHint(on);
    const now = Date.now();
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

  test("lists the five pace colours under Limit pace in the colours pane, with their defaults", async ($, on) => {
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
    expect(lines.slice(at, at + 6)).toEqual(["Limit pace", "pace.under=#94a3b8", "pace.over.from=#fbbf24", "pace.over.to=#ef4444", "pace.par=#e5e7eb", "pace.none=#6b7280"]);
    await ui.unmount();
  });

  test("draws under-pace cells in the colors option's pace.under", { options: { limit_style: "gauge", limit_7d_length: 10, colors: "pace.under=#112233" } }, async ($, on) => {
    stubHint(on);
    await startWithLimits($, on, [reading("seven_day", 10, 0.6)]);
    const ui = await mountHint($);
    expect((await gaugeOf(ui, "seven_day")).colors.slice(1, 5)).toEqual(Array(4).fill("#112233"));
    await ui.unmount();
  });

  test("names the run-out warning's sign among what the warnings colour sets", async ($, on) => {
    on("config.list", () => ({ value: [] }));
    const ui = await $.ui.mount({ plugin: "cockpit", surface: "terminal", component: "Pane", requestId: "cockpit-colors", props: { title: "Cockpit colours", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    expect(await ui.find({ type: "Text", text: "the compaction line's diamond and link, the run-out warning's sign" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /forecast/ })).toBeUndefined();
    await ui.unmount();
  });

  test("writes to an installed copy's rows, named for its marketplace", async ($, on) => {
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

  console.log(`cockpit tests in random order, seed ${seed}`);
  for (const [name, rest] of shuffled(queued)) kitTest(name, ...rest);
});
