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

const OrderList: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements;
  const cur = (): State => (surface.state?.rev === props.rev ? surface.state : { rev: props.rev, order: props.items });
  const last = () => cur().order.length - 1;

  surface.onPointer((e) => {
    const s = cur();
    if (e.type === "down" && e.y >= 0 && e.y <= last() && !props.fixed.includes(s.order[e.y] ?? "")) {
      surface.setState({ ...s, drag: { from: e.y, to: e.y } });
    } else if (e.type === "move" && s.drag) {
      const to = Math.min(Math.max(e.y, 0), last());
      if (to !== s.drag.to) surface.setState({ ...s, drag: { from: s.drag.from, to } });
    } else if (e.type === "up" && s.drag) {
      const order = move(s.order, s.drag.from, s.drag.to);
      surface.setState({ rev: s.rev, order });
      if (s.drag.from !== s.drag.to) surface.post(order);
    }
  });

  const { order, drag } = cur();
  const shown = drag ? move(order, drag.from, drag.to) : order;
  // A marker is one of two kinds: `hidden` ends the list's shown part (what follows is off: dim, struck through), any other
  // names a line in the draw (the prompt), in colour and bold, so the two never look alike.
  const hiddenAt = shown.indexOf("hidden");
  return Box({
    flexDirection: "column",
    children: shown.map((name, i) => {
      const label = props.labels[name] ?? name;
      if (name === "hidden") return Text({ dimColor: true, children: label });
      if (props.fixed.includes(name)) return Text({ color: "cyan", bold: true, children: label });
      const isOff = hiddenAt !== -1 && i > hiddenAt;
      return Text({ inverse: drag?.to === i, dimColor: isOff, strikethrough: isOff, children: `≡ ${label}` });
    }),
  });
};

export default OrderList;
