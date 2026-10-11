// Positions the children of ConstraintLayout / RelativeLayout. Needs the views mounted in the page
// (it measures wrap_content sizes), so call relayout(phone) after inserting a rendered screen.

const CL_RULES = [
  ["layout_constraintLeft_toLeftOf", "H", "a", "start"], ["layout_constraintStart_toStartOf", "H", "a", "start"],
  ["layout_constraintLeft_toRightOf", "H", "a", "end"], ["layout_constraintStart_toEndOf", "H", "a", "end"],
  ["layout_constraintRight_toRightOf", "H", "b", "end"], ["layout_constraintEnd_toEndOf", "H", "b", "end"],
  ["layout_constraintRight_toLeftOf", "H", "b", "start"], ["layout_constraintEnd_toStartOf", "H", "b", "start"],
  ["layout_constraintTop_toTopOf", "V", "a", "start"], ["layout_constraintTop_toBottomOf", "V", "a", "end"],
  ["layout_constraintBottom_toBottomOf", "V", "b", "end"], ["layout_constraintBottom_toTopOf", "V", "b", "start"],
];
const RL_RULES = [
  ["layout_toEndOf", "H", "a", "end"], ["layout_toRightOf", "H", "a", "end"],
  ["layout_toStartOf", "H", "b", "start"], ["layout_toLeftOf", "H", "b", "start"],
  ["layout_below", "V", "a", "end"], ["layout_above", "V", "b", "start"],
  ["layout_alignStart", "H", "a", "start"], ["layout_alignLeft", "H", "a", "start"],
  ["layout_alignEnd", "H", "b", "end"], ["layout_alignRight", "H", "b", "end"],
  ["layout_alignTop", "V", "a", "start"], ["layout_alignBottom", "V", "b", "end"], ["layout_alignBaseline", "V", "a", "start"],
];

Renderer.prototype.constraints = function (d, a, ctx) {
  const ref = (v) => (v === "parent" ? "parent" : String(v).replace(/^@\+?(android:)?id\//, ""));
  const C = { H: { a: null, b: null, bias: 0.5 }, V: { a: null, b: null, bias: 0.5 } };
  for (const [k, axis, slot, side] of [...CL_RULES, ...RL_RULES]) if (a[k] && !C[axis][slot]) C[axis][slot] = { target: ref(a[k]), side };
  if (a.layout_constraintBaseline_toBaselineOf && !C.V.a) C.V.a = { target: ref(a.layout_constraintBaseline_toBaselineOf), side: "start", baseline: true };
  const yes = (k) => a[k] === "true";
  if (yes("layout_alignParentStart") || yes("layout_alignParentLeft")) C.H.a = { target: "parent", side: "start" };
  if (yes("layout_alignParentEnd") || yes("layout_alignParentRight")) C.H.b = { target: "parent", side: "end" };
  if (yes("layout_alignParentTop")) C.V.a = { target: "parent", side: "start" };
  if (yes("layout_alignParentBottom")) C.V.b = { target: "parent", side: "end" };
  if (yes("layout_centerHorizontal") || yes("layout_centerInParent")) { C.H.a = { target: "parent", side: "start" }; C.H.b = { target: "parent", side: "end" }; C.H.center = true; }
  if (yes("layout_centerVertical") || yes("layout_centerInParent")) { C.V.a = { target: "parent", side: "start" }; C.V.b = { target: "parent", side: "end" }; C.V.center = true; }
  const hb = parseFloat(a.layout_constraintHorizontal_bias), vb = parseFloat(a.layout_constraintVertical_bias);
  if (!isNaN(hb)) C.H.bias = hb;
  if (!isNaN(vb)) C.V.bias = vb;
  C.H.chain = a.layout_constraintHorizontal_chainStyle;
  C.V.chain = a.layout_constraintVertical_chainStyle;
  C.H.weight = parseFloat(a.layout_constraintHorizontal_weight) || 1;
  C.V.weight = parseFloat(a.layout_constraintVertical_weight) || 1;
  C.H.pct = parseFloat(a.layout_constraintWidth_percent);
  C.V.pct = parseFloat(a.layout_constraintHeight_percent);
  C.ratio = a.layout_constraintDimensionRatio || null;
  C.H.editor = this.dp(a._tools?.layout_editor_absoluteX, ctx);
  C.V.editor = this.dp(a._tools?.layout_editor_absoluteY, ctx);
  d._cx = C;
};

function relayout(root) {
  const containers = [...root.querySelectorAll(".v-constraint, .v-relative")];
  if (!containers.length) return;
  for (let pass = 0; pass < 3; pass++) {
    for (const c of containers.slice().reverse()) solveContainer(c);
    for (const c of containers) solveContainer(c);
  }
}

function solveContainer(c) {
  const kids = [...c.children].filter((k) => k._cx || k._guide);
  const cs = getComputedStyle(c);
  const pad = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  const rl = c.classList.contains("v-relative");
  const wrapH = c._h && c._h.mode === "wrap" && !(c.parentType === "frame" && c.style.alignSelf === "stretch");
  const wrapW = c._w && c._w.mode === "wrap" && c.parentType === "abs";
  if (!kids.length) { if (wrapH) c.style.height = pad.t + pad.b + "px"; return; }
  const byId = new Map();
  for (const k of kids) if (k.dataset.vid) byId.set(k.dataset.vid, k);

  let W = c.clientWidth;
  if (wrapW) {
    // as wide as the widest child (measured unconstrained)
    let max = 0;
    for (const k of kids) { if (k._gone || k._guide) continue; k.style.width = k._w.mode === "fixed" ? k._w.px + "px" : ""; k.style.left = "0px"; max = Math.max(max, k.offsetWidth + k._m.l + k._m.r); }
    c.style.width = max + pad.l + pad.r + "px";
    W = c.clientWidth;
  }
  const H0 = c.clientHeight;
  const xs = solveAxis(kids, byId, "H", W, pad.l, pad.r, rl);
  for (const k of kids) {
    const p = xs.get(k);
    if (!p || k._guide) continue;
    k.style.left = p.x + "px";
    k.style.width = p.w + "px";
  }
  let H = wrapH ? 100000 : H0;
  let ys = solveAxis(kids, byId, "V", H, pad.t, pad.b, rl);
  if (wrapH) {
    let bottom = pad.t;
    for (const k of kids) {
      if (k._guide || k._gone) continue;
      const p = ys.get(k);
      // children pinned only to the (unknown) bottom don't define the height
      const C = k._cx.V;
      if (C.b && C.b.target === "parent" && !C.a) { bottom = Math.max(bottom, pad.t + p.w + k._m.t + k._m.b); continue; }
      bottom = Math.max(bottom, p.x + p.w + k._m.b);
    }
    H = bottom + pad.b;
    c.style.height = H + "px";
    ys = solveAxis(kids, byId, "V", H, pad.t, pad.b, rl);
  }
  for (const k of kids) {
    const p = ys.get(k);
    if (!p || k._guide) continue;
    k.style.top = p.x + "px";
    k.style.height = p.w + "px";
  }
}

// One axis. Returns Map(kid -> { x, w }) (x/w meaning top/height for the vertical axis).
function solveAxis(kids, byId, axis, size, padA, padB, rl) {
  const H = axis === "H";
  const pos = new Map();
  const spec = (k) => (H ? k._w : k._h);
  const marg = (k) => (k._gone ? { a: 0, b: 0 } : H ? { a: k._m.l, b: k._m.r } : { a: k._m.t, b: k._m.b });
  const C = new Map(kids.map((k) => [k, { ...(k._cx ? k._cx[axis] : {}) }]));

  // guidelines and RelativeLayout defaults
  for (const k of kids) {
    if (k._guide && !k._guide.barrier) {
      const vertical = k._guide.orientation === "vertical";
      if (vertical === H) {
        const g = k._guide;
        const x = g.begin != null ? g.begin : g.end != null ? size - g.end : (g.percent ?? 0.5) * size;
        pos.set(k, { x, w: 0 });
      } else pos.set(k, { x: 0, w: 0 });
    }
    if (rl && k._cx) {
      const c = C.get(k);
      if (!c.a && !c.b) c.a = { target: "parent", side: "start" };
    }
  }
  const measure = (k) => {
    if (k._gone) return 0;
    if (H) { k.style.width = ""; k.style.left = "0px"; return k.offsetWidth; }
    k.style.height = ""; return k.offsetHeight;
  };
  const anchor = (an) => {
    if (!an) return null;
    if (an.target === "parent") return an.side === "start" ? padA : size - padB;
    const t = byId.get(an.target);
    if (!t) return null;
    const p = pos.get(t);
    if (!p) return undefined;
    return an.side === "start" ? p.x : p.x + p.w;
  };

  // chains: A.b -> B.start and B.a -> A.end
  const next = new Map(), prev = new Map();
  for (const k of kids) {
    const c = C.get(k);
    if (!c.b || c.b.target === "parent" || c.b.side !== "start") continue;
    const t = byId.get(c.b.target);
    const tc = t && C.get(t);
    if (tc && tc.a && tc.a.target === k.dataset.vid && tc.a.side === "end") { next.set(k, t); prev.set(t, k); }
  }
  const chains = [];
  for (const k of kids) {
    if (!next.has(k) || prev.has(k)) continue;
    const members = [k];
    while (next.has(members[members.length - 1]) && members.length < 50) members.push(next.get(members[members.length - 1]));
    chains.push(members);
  }
  const inChain = new Set(chains.flat());

  const sizeOf = (k, a, b) => {
    const s = spec(k), m = marg(k), c = C.get(k);
    if (k._gone) return 0;
    if (s.mode === "fixed") return s.px;
    if (s.mode === "match" && !rl) return size - padA - padB - m.a - m.b;
    if (s.mode === "match" && rl) return (b ?? size - padB) - (a ?? padA) - m.a - m.b;
    if (s.mode === "zero" && !isNaN(c.pct)) return c.pct * (size - padA - padB);
    if (s.mode === "zero" && a != null && b != null) return Math.max(0, b - a - m.a - m.b);
    if (rl && a != null && b != null && !c.center && s.mode === "wrap" && c.a && c.b) return Math.max(0, b - a - m.a - m.b);
    if (!H && k._cx && k._cx.ratio && s.mode === "zero") {
      const r = k._cx.ratio.split(",").pop().split(":").map(Number);
      const w = parseFloat(k.style.width) || k.offsetWidth;
      if (r.length === 2 && r[0] && r[1]) return w * r[1] / r[0];
    }
    return measure(k);
  };

  const place = (k, a, b) => {
    const m = marg(k), c = C.get(k);
    const w = sizeOf(k, a, b);
    let x;
    if (a != null && b != null) x = a + m.a + (b - m.b - a - m.a - w) * (rl && !c.center ? 0 : c.bias ?? 0.5);
    else if (a != null) x = a + m.a;
    else if (b != null) x = b - m.b - w;
    else x = (c.editor ?? 0) + padA;
    pos.set(k, { x, w });
  };

  const placeChain = (members) => {
    const head = members[0], tail = members[members.length - 1];
    const S = anchor(C.get(head).a), E = anchor(C.get(tail).b);
    if (S === undefined || E === undefined) return false;
    const style = C.get(head).chain || "spread";
    const sizes = members.map((k) => (spec(k).mode === "zero" ? null : sizeOf(k, null, null)));
    const margins = members.reduce((n, k) => n + marg(k).a + marg(k).b, 0);
    const start = S ?? padA, end = E ?? start + sizes.reduce((n, s) => n + (s || 0), 0) + margins;
    let free = end - start - margins - sizes.reduce((n, s) => n + (s || 0), 0);
    const flex = members.filter((k, i) => sizes[i] == null);
    if (flex.length) {
      const total = flex.reduce((n, k) => n + (C.get(k).weight || 1), 0);
      members.forEach((k, i) => { if (sizes[i] == null) sizes[i] = Math.max(0, free * (C.get(k).weight || 1) / total); });
      free = 0;
    }
    const n = members.length;
    let gapBefore, gap;
    if (style === "packed") { gapBefore = Math.max(0, free) * (C.get(head).bias ?? 0.5); gap = 0; }
    else if (style === "spread_inside" && n > 1) { gapBefore = 0; gap = free / (n - 1); }
    else { gap = free / (n + 1); gapBefore = gap; }
    let x = start + gapBefore;
    members.forEach((k, i) => {
      const m = marg(k);
      pos.set(k, { x: x + m.a, w: sizes[i] });
      x += m.a + sizes[i] + m.b + gap;
    });
    return true;
  };

  const todo = new Set(kids.filter((k) => !pos.has(k) && !inChain.has(k)));
  const chainTodo = new Set(chains);
  const barriers = kids.filter((k) => k._guide && k._guide.barrier);
  for (let guard = 0; (todo.size || chainTodo.size) && guard < kids.length * 3 + 10; guard++) {
    let progress = false;
    for (const b of barriers) {
      if (!todo.has(b)) continue;
      const dir = b._guide.direction || "";
      const onAxis = H ? /start|end|left|right/.test(dir) : /top|bottom/.test(dir);
      if (!onAxis) { pos.set(b, { x: 0, w: 0 }); todo.delete(b); progress = true; continue; }
      const refs = b._guide.refs.map((id) => byId.get(id)).filter(Boolean);
      if (!refs.every((r) => pos.has(r))) continue;
      const edges = refs.map((r) => (/start|left|top/.test(dir) ? pos.get(r).x : pos.get(r).x + pos.get(r).w));
      pos.set(b, { x: edges.length ? (/start|left|top/.test(dir) ? Math.min(...edges) : Math.max(...edges)) : 0, w: 0 });
      todo.delete(b);
      progress = true;
    }
    for (const k of [...todo]) {
      if (k._guide) continue;
      const c = C.get(k);
      const a = anchor(c.a), b = anchor(c.b);
      if (a === undefined || b === undefined) continue;
      place(k, a, b);
      todo.delete(k);
      progress = true;
    }
    for (const ch of [...chainTodo]) if (placeChain(ch)) { chainTodo.delete(ch); progress = true; }
    if (!progress) {
      // a cycle: drop the unresolved constraints of one view and carry on
      const k = [...todo].find((x) => !x._guide) || [...todo][0];
      if (k) {
        const c = C.get(k);
        if (anchor(c.a) === undefined) c.a = null;
        if (anchor(c.b) === undefined) c.b = null;
        if (k._guide) { pos.set(k, { x: 0, w: 0 }); todo.delete(k); }
      } else {
        const ch = [...chainTodo][0];
        C.get(ch[0]).a = null;
        C.get(ch[ch.length - 1]).b = null;
      }
    }
  }
  for (const k of kids) if (!pos.has(k)) pos.set(k, { x: padA, w: k._gone ? 0 : sizeOf(k, null, null) });
  return pos;
}
