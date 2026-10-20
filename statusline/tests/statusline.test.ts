import type { AgentInfo, AgentStatus, ConfigRow, ConfigValue, On, SessionCompactResult, SessionContextBreakdown, SessionContextUsage, SessionRateLimit, TurnUsage } from "claude-code";
import { describe, type Engine, expect, type FoundElement, type Mounted, mock, test } from "claude-code/testing";

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
  return $.ui.mount({ plugin: "statusline", surface: "terminal", component: "PromptHint", props: { isDraft, isWorking: false, hint: "? for shortcuts" } });
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
  on("state.set", { plugin: "statusline", key: "handoffTrace" }, ($, e, next) => {
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
  if (reloaded) on("state.get", { plugin: "statusline", key: "stretch" }, () => ({ value: { value: { promptAt: Date.now() - 60_000, handoffAt: 0, compactedAt: 0 }, version: 1 } }));
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

describe("statusline", () => {
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
    expect(await ui.find({ type: "Text", text: /1d1h/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /2h5[56]m/ })).toBeDefined();
    // A window the mod has no bar for shows as its name and percentage.
    expect(await ui.find({ type: "Text", text: "seven_day_fable 86%" })).toBeDefined();
    // The context bar against the 900,000-token compaction threshold: 797,100 used is 88%, so 1 of 10 cells of window
    // left underneath; past the 200,000-token smart zone, none on top. 597,100 of the 700,000 between the smart zone
    // and the threshold is 85%: the full moon. Hovered, the 102,900 tokens left.
    let context;
    for (let i = 0; i < 50 && !context; i++) {
      context = await ui.find({ type: "Box", key: "context" });
      if (!context || !JSON.stringify(context).includes("102.9K")) {
        context = undefined;
        await settle();
      }
    }
    if (!context) throw new Error("the context chip did not draw");
    expect(flat(context.children[0])).toBe(" ● ");
    const halves = litCells(context.children.slice(1, -1));
    expect(halves).toBe("U_________");
    expect(flat(context.children.at(-1)).trim()).toBe("102.9K");
    // A row wraps between segments, none of which shrinks, so a narrow terminal never squeezes a glyph out; a gap
    // parts them, so a wrapped line starts flush.
    const rows = (await ui.findAll({ type: "Box" })).filter((b) => b.props.flexWrap === "wrap");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props.columnGap).toBe(1);
    expect(elements(rows[0]?.children ?? []).every((part) => part.props.flexShrink === 0)).toBe(true);
    await ui.unmount();
  });

  test("leaves out what /config turns off, and the gaps with compact spacing on", { options: { segment_limits: false, compact: true } }, async ($, on) => {
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
    const rows = (await ui.findAll({ type: "Box" })).filter((b) => b.props.flexWrap === "wrap");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props.columnGap).toBe(0);
    // The model name has no chip around it: one column still parts it from the next tag.
    expect((await ui.findAll({ type: "Box" })).some((b) => b.props.paddingRight === 1)).toBe(true);
    await ui.unmount();
  });

  test("draws each row where its position option puts it", { options: { row_git_position: "below", row_status_position: "above" } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const above = await $.ui.mount({ plugin: "statusline", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE } });
    expect(await above.find({ type: "Text", text: "O" })).toBeDefined();
    await above.unmount();
    const below = await mountHint($);
    expect(await below.find({ type: "Text", text: "O" })).toBeUndefined();
    await below.unmount();
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
    const halves = litCells(context.children.slice(1, -1));
    expect(halves).toBe("BBBBBUUUU_");
    expect(flat(context.children.at(-1)).trim()).toBe("950.0K");
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
    const cells = elements(context.children.slice(1, -1));
    expect(cells.map((t) => (t.props.backgroundColor !== "#373a48" ? "B" : "_")).join("")).toBe("BBBBBBB___");
    expect(cells.every((t) => t.props.color === t.props.backgroundColor)).toBe(true);
    await ui.unmount();
  });

  // The context bar's limit is the one the session reports, whatever the model's window or the person's settings make it:
  // the compaction threshold when auto-compaction is on, else the raw window, else the window the usage names. Each case
  // names the window, the tokens and the breakdown, and the bar is the arithmetic on them: the tokens left, the share of
  // them underneath (B both halves lit, T the smart zone's top half, U the bottom half), and the glyph for the zone.
  const contextBar = async (ui: Mounted<"terminal", "PromptHint">, left: string) => {
    for (let i = 0; i < 50; i++) {
      const chip = await ui.find({ type: "Box", key: "context" });
      if (chip && flat(chip.children.at(-1)).trim() === left) return { badge: flat(chip.children[0]), lit: litCells(chip.children.slice(1, -1)) };
      await settle();
    }
    throw new Error(`the context bar never said ${left} left`);
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
      expect(await contextBar(ui, left)).toEqual(bar);
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
    expect(await contextBar(ui, "675.0K")).toEqual({ badge: " ◑ ", lit: "UUUUU_____" });
    // Against 900,000: 225,000 left, 75% used, 2 cells left; (675,000 - 150,000) of the 750,000 beyond the smart zone is the fourth moon.
    threshold = 900_000;
    await $.turn.complete({ answer: "", isAborted: false, turnId: "t1", reason: "answer", durationMs: 1_000 });
    expect(await contextBar(ui, "225.0K")).toEqual({ badge: " ◕ ", lit: "UU________" });
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

    // Each limit is a hover scope; its countdown to the reset waits hidden until the pointer is on it.
    // FoundElement.props leaves `hover` out; the drawn children carry it.
    for (const [kind, used] of [["seven_day", "2d12h"], ["five_hour", "2h4"]] as const) {
      const scope = must(await ui.find({ type: "Box", key: kind }), `the ${kind} limit`);
      expect(scope.children.at(-1)).toMatchObject({
        props: { position: "absolute", display: "none" },
        hover: { display: "flex" },
        children: [{ type: "Text", children: [expect.stringContaining(used)] }],
      });
    }
    await ui.unmount();
  });

  for (const [title, options, chips] of [
    ["counts the main session's and its subagents' tokens once per request, priced from the live table", {}, [["turns", " ⏎ ", "7 / 1", "\uf0e7 1 / 2"], ["tokens", " Σ ", "$3.24", "1.31M"], ["agents", " \uf0e7 ", "$0.01", "151.0K"]]],
    ["adds the subagents' cost and tokens to the main session's one chip when merge_costs is on", { merge_costs: true }, [["turns", " ⏎ ", "7 / 1", "\uf0e7 1 / 2"], ["tokens", " Σ ", "$3.25", "1.46M"]]],
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
      // Each chip: a space, its tag, its value's tag right against it, and the hidden hover value laid over the value's tag.
      // A: 1,310,000 tokens at Opus 5.5's rates is $3.24. The agent: 151,000 tokens at the over-100k tier is $0.01.
      // The prompts / the main session's requests: A once though written twice; hovered, one subagent / its two requests.
      for (const [key, tag, value, hover] of chips) {
        const chip = must(await ui.find({ type: "Box", key }), `the ${key} chip`);
        expect(flat(chip.children[0])).toBe(tag);
        // The value's tag is as wide as the longer of value and hover value, so the hover value fits it whole.
        // Both right-aligned, a space short of the tag's right edge.
        const shown = flat(chip.children[1]);
        expect(shown).toBe(`${value} `.padStart(shown.length));
        const overlay = chip.children.at(-1);
        expect(overlay).toMatchObject({ props: { position: "absolute", display: "none" }, hover: { display: "flex" } });
        expect(flat(overlay)).toBe(`${hover} `.padStart(shown.length));
      }
      // Merged, the agents' chip is gone.
      expect(await ui.findAll({ type: "Box", key: "agents" })).toHaveLength(chips.some(([key]) => key === "agents") ? 1 : 0);
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
    expect(flat(cache.children.at(-1)).trim()).toBe("$8.00");
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
    // Cold has no hover, so no grey either.
    expect(JSON.stringify(cache.children[1])).not.toContain("#373a48");
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

  const idle = [subagent("completed")];
  const working = [subagent("running")];
  for (const [title, files, offered, lastAgo, options, agents, prompted, handoffBefore = 0.5] of [
    ["offers a fresh session from this session's handoff file once the cache is cold", ["HANDOFF-2026-10-16-0900.md", "HANDOFF-2026-10-16-1200.md"], true, 120, {}, idle],
    ["offers none from a handoff file older than the session", ["HANDOFF-2026-10-16-0900.md"], false, 120, {}, idle],
    ["offers it while the cache is warm, for a handoff written since the person's last prompt", ["HANDOFF-2026-10-16-1200.md"], true, 10, {}, idle],
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
    // Warm, the line leaves out the next message's price, which is no longer the cache write's.
    expect(await ui.find({ type: "Text", text: lastAgo === 10 ? /^ Handoff written: fresh start ~\$0\.24 $/ : /^ Cache cold: next message \$8\.00, fresh start ~\$0\.24 $/ })).toBeDefined();
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
    ["words 2.25 times the smart zone as very deep into the dumb zone", 450_000, true, {}, idle],
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
    const depth = new Map([[220_000, "just into"], [250_000, "well into"], [450_000, "very deep into"]]).get(tokens);
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

  for (const [title, end] of [
    ["answers a skip", (finish: (r: SessionCompactResult) => void) => finish({ skip: "cancelled" })],
    ["rejects", (_finish: (r: SessionCompactResult) => void, fail: (e: Error) => void) => fail(new Error("cancelled"))],
  ] as const)
  test(`hides the compaction offer while one runs, and draws it again when it ends without compacting: ${title}`, async ($, on) => {
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
    let finish!: (r: SessionCompactResult) => void;
    let fail!: (e: Error) => void;
    on("session.compact", () => new Promise<SessionCompactResult>((resolve, reject) => ((finish = resolve), (fail = reject))));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const ui = await mountHint($);
    const offer = async () => (await ui.findAll({ type: "Button", key: "compact" }))[0];
    for (let i = 0; i < 50 && !(await offer()); i++) {
      await clock.advance(2_000);
      await settle();
    }
    expect(await offer()).toBeDefined();
    const running = $.session.compact({ trigger: "manual", messages: [{ role: "user", text: "hi", toolUses: [] }] }).catch(() => undefined);
    await settle();
    expect(await offer()).toBeUndefined();
    end(finish, fail);
    await running;
    await settle();
    expect(await offer()).toBeDefined();
    await ui.unmount();
  });

  for (const [title, options, minutes, shown] of [
    ["keeps a dismissed compaction line hidden for the rest of the session", {}, 11, false],
    ["brings a dismissed compaction line back after dismiss_minutes", { dismiss_minutes: 10 }, 11, true],
    ["keeps it hidden within dismiss_minutes", { dismiss_minutes: 10 }, 9, false],
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
    await clock.advance(minutes * 60_000);
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
    expect(await handoffRuns($, on)).toEqual(["statusline:handoff"]);
  });

  test("runs the handoff 10 minutes before the cache goes cold while Claude Code's idleCompaction is on", async ($, on) => {
    // 8 minutes left: outside the 5-minute lead, inside the 10-minute one.
    expect(await handoffRuns($, on, { ago: 52 })).toEqual(["statusline:handoff"]);
  });

  test("waits for the last 5 minutes when idleCompaction is false in settings: none yet at 8 minutes left", async ($, on) => {
    expect(await handoffRuns($, on, { ago: 52, settings: { idleCompaction: false } })).toEqual([]);
  });

  test("runs the handoff at 3 minutes left when idleCompaction is false in settings", async ($, on) => {
    expect(await handoffRuns($, on, { settings: { idleCompaction: false } })).toEqual(["statusline:handoff"]);
  });

  test("runs the handoff for a prompt typed before the module loaded again", async ($, on) => {
    expect(await handoffRuns($, on, { reloaded: true })).toEqual(["statusline:handoff"]);
  });

  test("runs no handoff when the person turned auto_handoff off", { options: { auto_handoff: false } }, async ($, on) => {
    expect(await handoffRuns($, on)).toEqual([]);
  });

  test("sends no ping at keep_warm_pings 0, the default: the handoff alone runs", async ($, on) => {
    expect(await handoffRuns($, on, { after: 14 })).toEqual(["statusline:handoff"]);
  });

  test("pings an hour's cache as often as keep_warm_pings allows, then runs the handoff", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { after: 14 })).toEqual(["ping", "ping", "statusline:handoff"]);
  });

  test("pings a five-minute cache a minute before it expires, and runs the handoff after the last ping", { options: { keep_warm_pings: 2 } }, async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m-late", after: 14 })).toEqual(["ping", "ping", "statusline:handoff"]);
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
    expect(await handoffRuns($, on, { ttl: "5m-held" })).toEqual(["statusline:handoff"]);
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
    expect(await handoffRuns($, on, { agents: [subagent("waiting")] })).toEqual(["statusline:handoff"]);
  });

  test("runs the handoff at 90% of the 5h window on Opus", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "five_hour", percentUsed: 90 }] })).toEqual(["statusline:handoff"]);
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

  for (const [options, path] of [
    [{}, "spike › cc-mods⎇ develop ⎇ feat/gitline⎇ spike"],
    [{ compact: true }, "spike›cc-mods⎇develop⎇feat/gitline⎇spike"],
  ] as const)
  test(`draws the repository row from local git: branch ancestry, worktree, sync, conflict and changes${options.compact ? ", the path closed up under compact spacing" : ""}`, { options }, async ($, on) => {
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
      plugin: "statusline",
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
    // Flush: a segment starts at its first glyph, the row's gap parting it from the one before.
    const glyphs = (await ui.findAll({ type: "Text" })).map(glyph);
    expect(glyphs.join("")).toContain(path);
    const gaps = (await ui.findAll({ type: "Box" })).map((b) => b.props.columnGap).filter((g) => g !== undefined);
    expect(gaps).toEqual([1, options.compact ? 0 : 1]);
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
      plugin: "statusline",
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

  test("keeps a space before the default branch under compact spacing: no ⎇ parts it from the folder", { options: { compact: true } }, async ($, on) => {
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
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, ...SITE },
    });

    const glyphs = async () => (await ui.findAll({ type: "Text" })).map(glyph).join("");
    for (let i = 0; i < 50 && !(await glyphs()).includes("trunk"); i++) await settle();
    expect(await glyphs()).toContain("cc-mods trunk");
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
      plugin: "statusline",
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
        plugin: "statusline",
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
  for (const { name, status, calls } of [
    { name: "queued checks", status: "QUEUED", calls: 2 },
    { name: "finished checks", status: "COMPLETED", calls: 1 },
  ]) {
    test(`asks gh again within 10 s for ${name}: ${calls - 1} more asks`, async ($, on) => {
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
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }));
      on("session.model", () => ({ value: "claude-opus-5-5" }));
      on("session.root", () => ({ value: "/r" }));
      on("session.cwd", () => ({ value: "/r" }));
      on("fs.exists", () => ({ value: false }));
      on("process.run", (_$, e) => {
        if (e.argv[0] === "gh") asks++;
        const stdout = out[e.argv.filter((a) => a !== "--no-optional-locks").join(" ")];
        return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
      });

      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" });
      for (let i = 0; i < 50 && asks === 0; i++) await settle();
      for (let i = 0; i < 6; i++) {
        await clock.advance(2_000);
        await settle();
      }
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
    const ui = await $.ui.mount({ plugin: "statusline", surface: "terminal", component: "TurnDuration", props });
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
      plugin: "statusline",
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

  test("shows the folder outside a repository, and nothing of git, with its gaps under compact spacing", { options: { compact: true } }, async ($, on) => {
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
      plugin: "statusline",
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
    expect((await ui.findAll({ type: "Box" })).find((b) => b.props.flexWrap === "wrap")?.props.columnGap).toBe(1);
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
    key: `statusline.${field}`,
    label: field,
    kind: typeof value === "boolean" ? "boolean" : "text",
    value,
    provider: { plugin: "statusline", tier: "user" },
    isLocked: false,
  });
  const ROWS = [
    configRow("row_git", true),
    configRow("row_git_position", "above"),
    configRow("row_status", true),
    configRow("row_status_position", "below"),
    configRow("line_order", "git,status,fresh,compact"),
    configRow("segment_order", "model,limits,context,turns,tokens,cache"),
    ...["model", "limits", "context", "turns", "tokens", "cache"].map((name) => configRow(`segment_${name}`, true)),
    ...["fresh_start", "compact_hint"].flatMap((field) => [configRow(field, true), configRow(`${field}_position`, "below")]),
  ];
  async function dragIn(on: On, $: Engine, options: Record<string, unknown>, list: string, from: number, to: number): Promise<[string, unknown][]> {
    const written: [string, unknown][] = [];
    on("config.list", () => ({ value: ROWS }));
    on("config.set", (_$, e) => {
      written.push([e.key.replace("statusline.", ""), e.value]);
      return { value: e.value };
    });
    const ui = await $.ui.mount({ plugin: "statusline", surface: "terminal", component: "Pane", requestId: "statusline-order", props: { title: "Statusline order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    await ui.pointer({ type: "down", x: 2, y: from, button: "left", in: list });
    await ui.pointer({ type: "move", x: 2, y: to, button: "left", in: list });
    await ui.pointer({ type: "up", x: 2, y: to, button: "left", in: list });
    await ui.unmount();
    return written;
  }
  const PINNED = { row_git: true, row_status: true, row_git_position: "above", row_status_position: "below" };

  test("dragging the git row below the prompt marker saves its side and the line order", { options: PINNED }, async ($, on) => {
    // git, ── prompt ──, status, fresh, compact, ── hidden ──: git dropped on status's row goes below the prompt, after status.
    const written = await dragIn(on, $, PINNED, "rows", 0, 2);
    expect(written).toEqual([["row_git_position", "below"], ["line_order", "status,git,fresh,compact"]]);
  });

  test("dragging a tag into the hidden zone switches it off and keeps the order of the rest", { options: PINNED }, async ($, on) => {
    // model, limits, context, turns, tokens, cache, ── hidden ──: the model tag dropped on the marker's row.
    const written = await dragIn(on, $, PINNED, "segments", 0, 6);
    expect(written).toEqual([["segment_model", false], ["segment_order", "limits,context,turns,tokens,cache,model"]]);
  });

  test("dragging a hidden tag out turns it back on", { options: { ...PINNED, segment_model: false, segment_order: "limits,context,turns,tokens,cache,model" } }, async ($, on) => {
    // limits..cache are shown (rows 0-4), ── hidden ── is row 5, model row 6: model dropped to the top.
    const written = await dragIn(on, $, PINNED, "segments", 6, 0);
    expect(written).toEqual([["segment_model", true], ["segment_order", "model,limits,context,turns,tokens,cache"]]);
  });

  test("dragging a row into the hidden zone switches it off", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "rows", 2, 5)).toEqual([["row_status", false], ["line_order", "git,fresh,compact,status"]]);
  });

  test("dragging the compaction line above the prompt marker saves its side and the line order", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "rows", 4, 0)).toEqual([["compact_hint_position", "above"], ["line_order", "compact,git,status,fresh"]]);
  });

  test("dragging the compaction line into the hidden zone switches off its toggle", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "rows", 4, 5)).toEqual([["compact_hint", false]]);
  });

  test("a drop that changes nothing writes nothing", { options: PINNED }, async ($, on) => {
    expect(await dragIn(on, $, PINNED, "rows", 0, 0)).toEqual([]);
  });

  test("the order pane lists the lines around the prompt marker and the tags, hidden ones after their marker", { options: { ...PINNED, row_status_position: "above", line_order: "status,git,fresh,compact", segment_order: "cache,model,limits,context,turns,tokens", segment_limits: false } }, async ($, on) => {
    const ui = await $.ui.mount({ plugin: "statusline", surface: "terminal", component: "Pane", requestId: "statusline-order", props: { title: "Statusline order", isFocused: true, bodyColumns: 80, placement: "dock", ...SITE } });
    // What the pane hands each list's Client: the items, in the order they are drawn.
    const clientProps = async (key: string) => (await ui.find({ type: "Client", key }))?.props.props;
    expect(await clientProps("rows")).toMatchObject({ items: ["status", "git", "prompt", "fresh", "compact", "hidden"] });
    expect(await clientProps("segments")).toMatchObject({ items: ["cache", "model", "context", "turns", "tokens", "hidden", "limits"] });
    await ui.unmount();
  });
});
