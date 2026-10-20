import type { ClientModule } from "claude-code";

// A list whose rows the pointer drags: press a row, move, release. The order posts once, on release.
// The `fixed` names are markers: they stay where they are, dim, and a press on one starts no drag.
// `rev` changes whenever the mod answers a drop, so the list shows what was saved, or the old order when the write was refused.
type Props = { items: string[]; labels: Record<string, string>; fixed: string[]; rev: number };
type State = { rev: number; order: string[]; drag?: { from: number; to: number } };

const move = (list: string[], from: number, to: number) => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

// A label's lines at a width, broken between words, a word longer than the width cut; the whole label before the
// first layout (width 0). The list wraps its own rows so it knows which item a row of the region belongs to.
const wrap = (text: string, width: number): string[] => {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if ([...joined].length <= width) line = joined;
    else {
      if (line) lines.push(line);
      const chars = [...word];
      while (chars.length > width) lines.push(chars.splice(0, width).join(""));
      line = chars.join("");
    }
  }
  return [...lines, line];
};

const OrderList: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements;
  const cur = (): State => (surface.state?.rev === props.rev ? surface.state : { rev: props.rev, order: props.items });
  const last = () => cur().order.length - 1;
  // An item's lines: a draggable one behind its handle, its later lines indented under its label.
  const linesOf = (name: string) => {
    const label = props.labels[name] ?? name;
    if (props.fixed.includes(name)) return wrap(label, surface.columns);
    return wrap(label, surface.columns - 2).map((line, i) => `${i === 0 ? "≡" : " "} ${line}`);
  };
  const drawn = (s: State) => (s.drag ? move(s.order, s.drag.from, s.drag.to) : s.order);
  // The item a row of the region draws, as the list stands drawn now; past the last row, one past the last item.
  const itemAt = (y: number) => {
    let top = 0;
    const items = drawn(cur());
    const i = items.findIndex((name) => y < (top += linesOf(name).length));
    return i === -1 ? items.length : i;
  };

  surface.onPointer((e) => {
    const s = cur();
    const at = itemAt(Math.max(e.y, 0));
    if (e.type === "down" && e.y >= 0 && at <= last() && !props.fixed.includes(s.order[at] ?? "")) {
      surface.setState({ ...s, drag: { from: at, to: at } });
    } else if (e.type === "move" && s.drag) {
      const to = Math.min(at, last());
      if (to !== s.drag.to) surface.setState({ ...s, drag: { from: s.drag.from, to } });
    } else if (e.type === "up" && s.drag) {
      const order = move(s.order, s.drag.from, s.drag.to);
      surface.setState({ rev: s.rev, order });
      if (s.drag.from !== s.drag.to) surface.post(order);
    }
  });

  const { drag } = cur();
  const shown = drawn(cur());
  // A marker is one of two kinds: `hidden` ends the list's shown part (what follows is off: dim, struck through), any other
  // names a line in the draw (the prompt), in colour and bold, so the two never look alike. The spacer under hidden is
  // there to drag out, not switched off: dim, not struck through. Each line is cut at the edge, never wrapped again.
  const hiddenAt = shown.indexOf("hidden");
  return Box({
    flexDirection: "column",
    children: shown.flatMap((name, i) => {
      const isOff = hiddenAt !== -1 && i > hiddenAt;
      const look =
        name === "hidden" ? { dimColor: true }
        : props.fixed.includes(name) ? { color: "cyan", bold: true }
        : { inverse: drag?.to === i, dimColor: isOff, strikethrough: isOff && name !== "spacer" };
      return linesOf(name).map((line) => Text({ ...look, wrap: "truncate-end", children: line }));
    }),
  });
};

export default OrderList;
