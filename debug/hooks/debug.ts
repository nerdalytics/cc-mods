// Marks every render site a mod can draw in: a red X and the site's name in front of what the site draws, and a Pane
// opened at the session's start to show its own. For finding where a mod should hook in; uninstall it once found.
import type { Elements, EngineInterface, Register } from "claude-code";

async function mark($: EngineInterface, e: any, next: (e: any) => Promise<any>) {
  const drawn = await next(e);
  const { Box, Text } = $.ui.resolve(e) as Elements["terminal"];
  return Box({ flexDirection: "row", children: [Text({ color: "#ff0000", bold: true, children: `X ${e.component} ` }), drawn] });
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.ui.open({ id: "markers", title: "markers" });
    return result;
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
