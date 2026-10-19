import type { On } from "claude-code";
import { describe, type Engine, expect, test } from "claude-code/testing";

const PANES = [
  { option: "probe", command: "debug:probe", name: "Probe pane" },
  { option: "pr_trace", command: "debug:pr-trace", name: "PR trace pane" },
  { option: "handoff_trace", command: "debug:handoff-trace", name: "Handoff trace pane" },
] as const;

// The command as the person types it at the composer.
const run = ($: Engine, command: string) => $.command.run({ command, args: "", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 80 } });

// The texts the closing line of a turn draws, which the engine draws as "Cooked for 7s"; the mod puts its marker in front of it.
async function turnLine($: Engine, on: On): Promise<unknown[]> {
  on("ui.render", { component: "TurnDuration" }, ($, e) => $.ui.resolve(e).Text({ children: "Cooked for 7s" }));
  const ui = await $.ui.mount({ plugin: "debug", surface: "terminal", component: "TurnDuration", props: { word: "Cooked", durationMs: 7_000 } });
  const texts = (await ui.findAll({ type: "Text" })).map((text) => text.children[0] ?? text.text);
  await ui.unmount();
  return texts;
}

describe("debug", () => {
  for (const { option, command, name } of PANES) {
    test(`${command} opens its pane`, async ($, on) => {
      const opened: unknown[] = [];
      on("ui.open", (_$, e) => {
        opened.push(e.id);
        return { value: { isPlaced: true } };
      });
      expect((await run($, command)).text).toBe(`${name} opened.`);
      expect(opened).toEqual([command.replace("debug:", "")]);
    });

    test(`${command} says its pane is off when ${option} is switched off`, { options: { [option]: false } }, async ($) => {
      expect((await run($, command)).text).toBe(`${name} is off. Turn on "Debug: ${name}" in /config.`);
    });
  }

  test("marks a render site with a red X and its name", async ($, on) => {
    expect(await turnLine($, on)).toContain("X TurnDuration ");
  });

  test("marks no render site when markers is switched off", { options: { markers: false } }, async ($, on) => {
    expect(await turnLine($, on)).toEqual(["Cooked for 7s"]);
  });
});
