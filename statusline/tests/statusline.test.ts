import { describe, expect, mock, test } from "claude-code/testing";

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
function stubHint(on: any): void {
  on("ui.render", { component: "PromptHint" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: "? for shortcuts" }));
  on("ui.render", { component: "AbovePrompt" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: "" }));
}
function mountHint($: any): Promise<any> {
  return $.ui.mount({ plugin: "statusline", surface: "terminal", component: "PromptHint", props: { isDraft: false, isWorking: false, hint: "? for shortcuts" } });
}

// A session idle with its cache 3 minutes from cold: the commands the mod runs over 2 polls (none, before the
// person's first prompt is asserted), then a prompt typed at the composer, then 3 polls more.
async function handoffRuns($: any, on: any, { model = "claude-opus-5-5", rateLimits = [] as object[], ttl = "1h", agents = [] as object[] } = {}): Promise<string[]> {
  stubHint(on);
  // An hour-TTL write 57 minutes ago: 3 minutes left, inside the 5-minute lead. A five-minute write 3 minutes ago has 2 left.
  const clock = mock.clock(on);
  const ran: string[] = [];
  const written = { ephemeral_5m_input_tokens: ttl === "5m" ? 1_000_000 : 0, ephemeral_1h_input_tokens: ttl === "1h" ? 1_000_000 : 0 };
  const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation: written };
  const ago = (ttl === "1h" ? 57 : 3) * 60_000;
  const transcript = JSON.stringify({ type: "assistant", requestId: "r1", timestamp: new Date(Date.now() - ago).toISOString(), message: { model: "claude-opus-5-5", usage } });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.usage", () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits } }));
  on("session.model", () => ({ value: model }));
  on("session.id", () => ({ value: "sid-1" }));
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
  on("prompt.submit", (_$, e) => ({ text: e.text }));

  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
  const ui = await mountHint($);
  for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: "cache" })).length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const polls = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await clock.advance(2_000);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  // No prompt of the person's since the mod loaded: nothing runs.
  await polls(2);
  expect(ran).toEqual([]);

  // A prompt typed at the composer: the next poll runs the handoff, and the ones after it do not run it again.
  await $.prompt.submit({ text: "hi", origin: { kind: "composer" } } as any);
  await polls(3);
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
        context: { tokens: 797_100, window: 1_000_000, breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 900_000, rawMaxTokens: 1_000_000 } },
        rateLimits: [
          { kind: "five_hour", percentUsed: 40, resetsAt: new Date(now + 10_560_000).toISOString() },
          { kind: "seven_day", percentUsed: 20, resetsAt: new Date(now + 90_030_000).toISOString() },
          { kind: "seven_day_fable", percentUsed: 86 },
        ],
      },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
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
      context = (await ui.findAll({ type: "Box", key: "context" }))[0];
      if (!context || !JSON.stringify(context).includes("102.9K")) {
        context = undefined;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    const flat = (n: any): string => (typeof n === "string" ? n : (n?.children ?? []).map(flat).join(""));
    expect(flat(context.children[0])).toBe(" ● ");
    const dim = "#373a48";
    const halves = context.children
      .slice(1, -1)
      .map((t: any) => {
        const top = t.props.color !== dim;
        const bottom = t.props.backgroundColor !== dim;
        return top && bottom ? "B" : top ? "T" : bottom ? "U" : "_";
      })
      .join("");
    expect(halves).toBe("U_________");
    expect(flat(context.children.at(-1)).trim()).toBe("102.9K");
    // A row wraps between segments, none of which shrinks, so a narrow terminal never squeezes a glyph out; a gap
    // parts them, so a wrapped line starts flush.
    const rows = (await ui.findAll({ type: "Box" })).filter((b: any) => b.props.flexWrap === "wrap");
    expect(rows).toHaveLength(1);
    expect(rows[0].props.columnGap).toBe(1);
    expect(rows[0].children.every((part: any) => part.props.flexShrink === 0)).toBe(true);
    await ui.unmount();
  });

  test("leaves out what /config turns off, and the gaps with compact spacing on", { options: { segment_limits: false, compact: true } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({
      value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [{ kind: "seven_day", percentUsed: 20, resetsAt: new Date(Date.now() + 90_030_000).toISOString() }] },
    }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    expect(await ui.find({ type: "Text", text: "O" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /1d1h/ })).toBeUndefined();
    const rows = (await ui.findAll({ type: "Box" })).filter((b: any) => b.props.flexWrap === "wrap");
    expect(rows).toHaveLength(1);
    expect(rows[0].props.columnGap).toBe(0);
    // The model name has no chip around it: one column still parts it from the next tag.
    expect((await ui.findAll({ type: "Box" })).some((b: any) => b.props.paddingRight === 1)).toBe(true);
    await ui.unmount();
  });

  test("draws each row where its position option puts it", { options: { row_git_position: "below", row_status_position: "above" } }, async ($, on) => {
    stubHint(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const above = await $.ui.mount({ plugin: "statusline", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any);
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
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    const flat = (n: any): string => (typeof n === "string" ? n : (n?.children ?? []).map(flat).join(""));
    const context = (await ui.findAll({ type: "Box", key: "context" }))[0];
    expect(flat(context.children[0])).toBe(" ◆ ");
    const dim = "#373a48";
    const halves = context.children
      .slice(1, -1)
      .map((t: any) => {
        const top = t.props.color !== dim;
        const bottom = t.props.backgroundColor !== dim;
        return top && bottom ? "B" : top ? "T" : bottom ? "U" : "_";
      })
      .join("");
    expect(halves).toBe("BBBBBUUUU_");
    expect(flat(context.children.at(-1)).trim()).toBe("950.0K");
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);

    // B both halves lit, T top (time) only, U bottom (usage) only, _ neither; 7 cells for 7d, then 10 for 5h.
    // A dim half is #373a48: the glyph colour is the top half, the background the bottom.
    const dim = "#373a48";
    const cells = (await ui.findAll({ type: "Text", text: "▀" }))
      .map((t) => {
        const top = t.props.color !== dim;
        const bottom = t.props.backgroundColor !== dim;
        return top && bottom ? "B" : top ? "T" : bottom ? "U" : "_";
      })
      .join("");
    expect(cells).toBe("BBUUU__BBTTT_____");

    // Each limit is a hover scope; its countdown to the reset waits hidden until the pointer is on it.
    // FoundElement.props leaves `hover` out; the drawn children carry it.
    for (const [kind, used] of [["seven_day", "2d12h"], ["five_hour", "2h4"]]) {
      const scope = (await ui.findAll({ type: "Box", key: kind }))[0];
      expect(scope.children.at(-1)).toMatchObject({
        props: { position: "absolute", display: "none" },
        hover: { display: "flex" },
        children: [{ type: "Text", children: [expect.stringContaining(used)] }],
      });
    }
    await ui.unmount();
  });

  test("counts the main session's and its subagents' tokens once per request, priced from the live table", async ($, on) => {
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);

    // The agents' chip shows once the scan has run.
    for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: "agents" })).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(argv).toEqual(["find", "/home/u/.claude/projects", "-path", "*sid-1*", "-name", "*.jsonl", "-exec", "grep", "-h", "-e", '"usage"', "-e", '"compact_boundary"', "{}", "+"]);
    // Each chip: a space, its tag, its value's tag right against it, and the hidden hover value laid over the value's tag.
    // A: 1,310,000 tokens at Opus 5.5's rates is $3.24. The agent: 151,000 tokens at the over-100k tier is $0.01.
    // The prompts / the main session's requests: A once though written twice; hovered, one subagent / its two requests.
    const flat = (n: any): string => (typeof n === "string" ? n : (n?.children ?? []).map(flat).join(""));
    for (const [key, tag, value, hover] of [
      ["turns", " ⏎ ", "7 / 1", "\uf0e7 1 / 2"],
      ["tokens", " Σ ", "$3.24", "1.31M"],
      ["agents", " \uf0e7 ", "$0.01", "151.0K"],
    ]) {
      const chip = (await ui.findAll({ type: "Box", key }))[0];
      expect(flat(chip.children[0])).toBe(tag);
      // The value's tag is as wide as the longer of value and hover value, so the hover value fits it whole.
      // Both right-aligned, a space short of the tag's right edge.
      const shown = flat(chip.children[1]);
      expect(shown).toBe(`${value} `.padStart(shown.length));
      const overlay = chip.children.at(-1);
      expect(overlay).toMatchObject({ props: { position: "absolute", display: "none" }, hover: { display: "flex" } });
      expect(flat(overlay)).toBe(`${hover} `.padStart(shown.length));
    }
    await ui.unmount();
  });

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

    const flat = (n: any): string => (typeof n === "string" ? n : (n?.children ?? []).map(flat).join(""));
    const chip = async (ui: any) => {
      for (let i = 0; i < 50; i++) {
        const found = (await ui.findAll({ type: "Box", key: "cache" }))[0];
        if (found) return found;
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const mount = () =>
      mountHint($);

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    let ui = await mount();
    let cache = await chip(ui);
    // 50 minutes left of the hour (49 once a second passes).
    expect(flat(cache.children[0])).toBe(" ◷ ");
    expect(flat(cache.children[1])).toMatch(/^ (50|49)m \$0\.20 $/);
    expect(flat(cache.children.at(-1)).trim()).toBe("$8.00");
    // Hoverable, so the value stands on the grey.
    expect(JSON.stringify(cache.children[1])).toContain("#373a48");
    await ui.unmount();

    // Two hours on, the hour is up: the next prompt writes the cache again.
    minutes = 120;
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    ui = await mount();
    for (let i = 0; i < 50 && !flat((await chip(ui)).children[1]).includes("cold"); i++) await new Promise((r) => setTimeout(r, 10));
    cache = await chip(ui);
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    // Usage left is the bars' bottom halves: none once refused, where 40% used would light 6.
    const usageLeft = async () =>
      (await ui.findAll({ type: "Text", text: "▀" })).filter((t) => t.props.backgroundColor !== "#373a48").length;
    let lit = await usageLeft();
    for (let i = 0; i < 50 && lit !== 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      lit = await usageLeft();
    }
    expect(lit).toBe(0);
    await ui.unmount();
  });

  const idle = [{ id: "a0", description: "d", type: "Explore", status: "completed" }];
  const working = [{ id: "a1", description: "d", type: "Explore", status: "running" }];
  for (const [title, files, offered, lastAgo, options, agents] of [
    ["offers a fresh session from this session's handoff file once the cache is cold", ["HANDOFF-2026-10-16-0900.md", "HANDOFF-2026-10-16-1200.md"], true, 120, {}, idle],
    ["offers none from a handoff file older than the session", ["HANDOFF-2026-10-16-0900.md"], false, 120, {}, idle],
    ["offers none while the cache is warm", ["HANDOFF-2026-10-16-1200.md"], false, 10, {}, idle],
    ["offers none when the person turned fresh_start off", ["HANDOFF-2026-10-16-1200.md"], false, 120, { fresh_start: false }, idle],
    ["offers none while a subagent is at work", ["HANDOFF-2026-10-16-1200.md"], false, 120, {}, working],
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
    const file = (name: string, mtimeMs: number) => ({ name, kind: "file", size: 40_000, mtimeMs, isLink: false });
    const ran: string[] = [];
    const sent: string[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", () => ({ value: { startedAt: 5_000, context: { window: 1_000_000 }, rateLimits: [] } }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("session.id", () => ({ value: "sid-1" }));
    on("session.root", () => ({ value: "/work" }));
    on("agent.list", () => ({ value: agents }));
    on("fs.list", () => ({ value: [...files.map((name) => file(name, name.endsWith("0900.md") ? 1_000 : 9_000)), file("README.md", 9_500)] }));
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    let button;
    for (let i = 0; i < (offered ? 50 : 5) && !button; i++) {
      await clock.advance(2_000);
      await new Promise((r) => setTimeout(r, 10));
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
    expect(marks.some((t: any) => t.props.color === "#f87171" && t.props.backgroundColor === undefined)).toBe(true);
    // A chip-like button: an icon tag, then the label on the button background; no brackets.
    expect(JSON.stringify(button)).toContain(" Start fresh ");
    expect(JSON.stringify(button)).toContain("#14532d");
    await ui.press({ key: "resume" });
    expect(ran).toEqual(["clear"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/work/HANDOFF-2026-10-16-1200.md");
    await ui.unmount();
  });

  test("runs the handoff skill once before the cache goes cold, while idle and after a prompt of the person's own", async ($, on) => {
    expect(await handoffRuns($, on)).toEqual(["statusline:handoff"]);
  });

  test("runs no handoff when the person turned auto_handoff off", { options: { auto_handoff: false } }, async ($, on) => {
    expect(await handoffRuns($, on)).toEqual([]);
  });

  test("runs no handoff on a five-minute cache", async ($, on) => {
    expect(await handoffRuns($, on, { ttl: "5m" })).toEqual([]);
  });

  test("runs no handoff at 98% of the 5h window", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "five_hour", percentUsed: 98 }] })).toEqual([]);
  });

  test("runs no handoff with the 7d window used up", async ($, on) => {
    expect(await handoffRuns($, on, { rateLimits: [{ kind: "seven_day", percentUsed: 100 }] })).toEqual([]);
  });

  test("runs no handoff while a subagent is at work", async ($, on) => {
    expect(await handoffRuns($, on, { agents: [{ id: "a1", description: "d", type: "Explore", status: "running" }] })).toEqual([]);
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    for (let i = 0; i < 50 && (await ui.findAll({ type: "Box", key: "tokens" })).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/wt/spike/cc-mods" } as any);
    const ui = await $.ui.mount({
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any);

    let changes;
    for (let i = 0; i < 50 && !changes; i++) {
      changes = await ui.find({ type: "Box", text: "+120 -8 ~2" });
      if (!changes) await new Promise((r) => setTimeout(r, 10));
    }
    expect(changes).toBeDefined();
    for (const text of ["↑2? ↓1?", "\uf071"]) {
      expect(await ui.find({ type: "Box", text })).toBeDefined();
    }
    // The folders link to their places on disk: the project, the shell's folder, and the checkout (here a worktree)
    // for the branch and the worktree.
    const hrefs = (await ui.findAll({ type: "Link" })).map((l: any) => l.props.href);
    expect(hrefs).toEqual(["file:///wt/spike", "file:///wt/spike/cc-mods", "file:///wt/spike", "file:///wt/spike"]);
    // Flush: a segment starts at its first glyph, the row's gap parting it from the one before.
    const glyphs = (await ui.findAll({ type: "Text" })).map((t: any) => t.children?.[0] ?? t.text);
    expect(glyphs.join("")).toContain(path);
    const gaps = (await ui.findAll({ type: "Box" })).map((b: any) => b.props.columnGap).filter((g: any) => g !== undefined);
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" } as any);
    const ui = await $.ui.mount({
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any);

    let branch;
    for (let i = 0; i < 50 && !branch; i++) {
      branch = await ui.find({ type: "Box", text: "⎇ feat" });
      if (!branch) await new Promise((r) => setTimeout(r, 10));
    }
    expect(branch).toBeDefined();
    expect(await ui.find({ type: "Box", text: "⎇ trunk ⎇ feat" })).toBeUndefined();
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
      "gh pr view --json number,url,isDraft,mergeable,reviewDecision,statusCheckRollup,comments": JSON.stringify(pr),
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" } as any);
    const ui = await $.ui.mount({
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any);

    // The number links to the PR's page; the branch, a link to its checkout, holds its own text.
    const href = async (to: string) => (await ui.findAll({ type: "Link" })).some((l: any) => l.props.href === to);
    let number = false;
    for (let i = 0; i < 50 && !number; i++) {
      number = await href("https://github.com/o/r/pull/42");
      if (!number) await new Promise((r) => setTimeout(r, 10));
    }
    expect(number).toBe(true);
    expect(await href("file:///r")).toBe(true);
    // Behind links the remote branch's history; ahead, only local, links nothing. Each failure is a cross of its own,
    // linking its check (a check run's details, a status's target); running and passed are counts on the checks tab.
    expect(await href("https://github.com/o/r/commits/feat")).toBe(true);
    const links = (await ui.findAll({ type: "Link" })).map((l: any) => [l.props.href, l.children.map((t: any) => t.children[0]).join("")]);
    expect(links.filter(([h]: string[]) => h.startsWith("https://github.com/o/r/"))).toEqual([
      ["https://github.com/o/r/pull/42", "#42"],
      ["https://github.com/o/r/commits/feat", "↓1"],
      ["https://github.com/o/r/pull/42/checks", "\uf4441"],
      ["https://github.com/o/r/runs/7", "\uf467"],
      ["https://github.com/o/r/pull/42/checks", "\uf42e2"],
    ]);
    expect(links).toContainEqual(["https://ci.example/build/9", "\uf467"]);
    // Each failed check's cross is red (the review's "changes requested" cross keeps the row's gradient).
    const failures = (await ui.findAll({ type: "Link" })).filter((l: any) => ["https://github.com/o/r/runs/7", "https://ci.example/build/9"].includes(l.props.href));
    expect(failures.map((l: any) => l.children[0].props.color)).toEqual(["#ef4444", "#ef4444"]);
    for (const text of ["\uf040", "\uf467", "\uf0e0 3", "\uf071"]) {
      expect(await ui.find({ type: "Box", text })).toBeDefined();
    }
    // Pulled: nothing behind, so no link for it, rather than an empty one the terminal draws as its address.
    out["git rev-list --left-right --count HEAD...origin/feat"] = "2\t0\n";
    for (let i = 0; i < 5 && (await href("https://github.com/o/r/commits/feat")); i++) {
      await clock.advance(2_000);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await href("https://github.com/o/r/commits/feat")).toBe(false);
    expect((await ui.findAll({ type: "Link" })).every((l: any) => l.children.length > 0)).toBe(true);
    await ui.unmount();
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/r" } as any);
    const ui = await $.ui.mount({
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any);
    const until = async (text: string) => {
      for (let i = 0; i < 50; i++) {
        if (await ui.find({ type: "Box", text })) return true;
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    };
    // The bottom half of a 5h cell is lit while its usage is left: all ten at 0% used, none at 100%. The limits are
    // under the prompt, the branch above it.
    const hint = await mountHint($);
    const usageLeft = async () =>
      (await hint.findAll({ type: "Text", text: "▀" })).filter((t: any) => t.props.backgroundColor !== "#373a48").length;

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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work/cc-mods" } as any);
    const ui = await $.ui.mount({
      plugin: "statusline",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any);

    let folder;
    for (let i = 0; i < 50 && !folder; i++) {
      folder = await ui.find({ type: "Box", text: "cc-mods" });
      if (!folder) await new Promise((r) => setTimeout(r, 10));
    }
    expect(folder).toBeDefined();
    expect(await ui.find({ type: "Text", text: "⎇" })).toBeUndefined();
    expect((await ui.findAll({ type: "Box" })).find((b: any) => b.props.flexWrap === "wrap")?.props.columnGap).toBe(1);
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
      await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
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

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await mountHint($);
    expect(await ui.find({ text: "Haiku 5.5" })).toBeDefined();

    model = "claude-fable-5-1";
    await clock.advance(100);
    expect(await ui.find({ text: "Fable 5.1" })).toBeDefined();
    await ui.unmount();
  });
});
