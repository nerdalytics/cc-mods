// Marks every render site a mod can draw in: a red X and the site's name in front of what the site draws, and a Pane
// opened at the session's start to show its own. For finding where a mod should hook in; uninstall it once found.
import type { Elements, EngineInterface, Register } from "claude-code";

const PROBE = "probe";
const PR_TRACE_PANE = "pr-trace";
// The commands are the plugin's own files under commands/, which Claude Code lists under the plugin's name.
const PROBE_COMMAND = "debug:probe";
const PR_TRACE_COMMAND = "debug:pr-trace";
const HANDOFF_TRACE_PANE = "handoff-trace";
const HANDOFF_TRACE_COMMAND = "debug:handoff-trace";
// The statusline mod's PR fetch log; its owner writes it, any plugin may read it.
const PR_TRACE = { plugin: "statusline", key: "prTrace" } as const;
// Why the statusline mod's handoff did or did not run while its window was open.
const HANDOFF_TRACE = { plugin: "statusline", key: "handoffTrace" } as const;
const COLS = 32;
const ROWS = 6;
const PX = 64;
const PY = 32;

// Raster: a colour ramp of full blocks, each cell a [code point, foreground, background] u32 triplet.
const cells = (() => {
  const words = new Uint32Array(COLS * ROWS * 3);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = (y * COLS + x) * 3;
      words[i] = 0x2588;
      words[i + 1] = (Math.round((x / (COLS - 1)) * 255) << 16) | (0x80 << 8) | Math.round((y / (ROWS - 1)) * 255);
      words[i + 2] = 0x01000000;
    }
  return new Uint8Array(words.buffer).toBase64();
})();

// Image: a 64x32 RGBA gradient.
const rgba = (() => {
  const px = new Uint8Array(PX * PY * 4);
  for (let y = 0; y < PY; y++)
    for (let x = 0; x < PX; x++) px.set([Math.round((x / (PX - 1)) * 255), Math.round((y / (PY - 1)) * 255), 160, 255], (y * PX + x) * 4);
  return px.toBase64();
})();

async function mark($: EngineInterface, e: any, next: (e: any) => Promise<any>) {
  const drawn = await next(e);
  const { Box, Text } = $.ui.resolve(e) as Elements["terminal"];
  return Box({ flexDirection: "row", children: [Text({ color: "#ff0000", bold: true, children: `X ${e.component} ` }), drawn] });
}

// The newest lines of a statusline trace that fit the pane, or what to say while it has none.
function traceLines($: EngineInterface, e: any, value: unknown, empty: string) {
  const { Box, Text } = $.ui.resolve(e) as Elements["terminal"];
  const lines = (value as string[] | undefined) ?? [];
  const room = Math.max(1, (e.viewport?.rows ?? 24) - 4);
  return Box({ flexDirection: "column", children: lines.length ? lines.slice(-room).map((line) => Text({ children: line })) : [Text({ dimColor: true, children: empty })] });
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.ui.open({ id: "markers", title: "markers" });
    return result;
  });
  on("command.run", { command: PROBE_COMMAND }, async ($) => {
    const opened = await $.ui.open({ id: PROBE, title: "probe" });
    return { text: opened.isPlaced ? "Probe pane opened." : `Probe pane not placed: ${opened.reason}` };
  });
  on("command.run", { command: PR_TRACE_COMMAND }, async ($) => {
    const opened = await $.ui.open({ id: PR_TRACE_PANE, title: "PR trace" });
    return { text: opened.isPlaced ? "PR trace pane opened." : `PR trace pane not placed: ${opened.reason}` };
  });
  on("command.run", { command: HANDOFF_TRACE_COMMAND }, async ($) => {
    const opened = await $.ui.open({ id: HANDOFF_TRACE_PANE, title: "Handoff trace" });
    return { text: opened.isPlaced ? "Handoff trace pane opened." : `Handoff trace pane not placed: ${opened.reason}` };
  });
  on("ui.render", { component: "Pane", requestId: PR_TRACE_PANE }, async ($, e) => traceLines($, e, (await $.state.get(PR_TRACE)).value, "No PR fetch yet."));
  on("ui.render", { component: "Pane", requestId: HANDOFF_TRACE_PANE }, async ($, e) => traceLines($, e, (await $.state.get(HANDOFF_TRACE)).value, "No handoff window yet."));
  on("ui.render", { component: "Pane", requestId: PROBE }, async ($, e) => {
    const { Box, Text, Raster, Image } = $.ui.resolve(e) as Elements["terminal"];
    return Box({
      flexDirection: "column",
      children: [
        Text({ bold: true, children: "Text" }),
        Text({ color: "#ff8800", children: "orange" }),
        Text({ dimColor: true, children: "dim" }),
        Text({ bold: true, children: "Raster" }),
        Raster({ key: "ramp", columns: COLS, rows: ROWS, cells }),
        Text({ bold: true, children: "Image" }),
        Image({ key: "img", source: { rgba, width: PX, height: PY }, columns: 32, rows: 8, alt: "[image not drawn: alt text]" }),
      ],
    });
  });
  on("ui.render", { component: "AskUserQuestion" }, mark);
  on("ui.render", { component: "UserMessage" }, mark);
  on("ui.render", { component: "AssistantMessage" }, mark);
  on("ui.render", { component: "ToolUse" }, mark);
  on("ui.render", { component: "ToolResult" }, mark);
  on("ui.render", { component: "ToolGroup" }, mark);
  on("ui.render", { component: "ToolProgress" }, mark);
  on("ui.render", { component: "CommandOutput" }, mark);
  on("ui.render", { component: "Spinner" }, mark);
  on("ui.render", { component: "TurnDuration" }, mark);
  on("ui.render", { component: "InfoNotice" }, mark);
  on("ui.render", { component: "SessionMode" }, mark);
  on("ui.render", { component: "PromptHint" }, mark);
  on("ui.render", { component: "AbovePrompt" }, mark);
  on("ui.render", { component: "Pane" }, mark);
};
