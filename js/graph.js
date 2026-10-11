// The flow chart: every screen as a card with its rendered layout, arrows from each button
// to the screen it opens. Pan by dragging the background, zoom with the wheel, drag cards by their title.

const NODE_SCALE = 0.5;
const NODE_W = SCREEN_W * NODE_SCALE + 16;
const NODE_H = SCREEN_H * NODE_SCALE + 58;
const GAP_X = 190, GAP_Y = 70;
const EDGE_COLORS = ["#8b85ff", "#4fc3f7", "#ffb454", "#4ade80", "#f472b6", "#a3e635", "#fb7185", "#38bdf8", "#facc15", "#c084fc"];
const KIND_LABEL = { activity: "Activity", fragment: "Fragment", dialog: "Dialog" };

class FlowChart {
  constructor(host, model, renderer, opts) {
    this.host = host;
    this.model = model;
    this.r = renderer;
    this.opts = opts;
    this.view = { x: 40, y: 40, z: 0.6 };
    this.nodes = new Map();   // id -> { el, x, y, phone }
    this.posKey = `sm.pos.${opts.projectName}`;
  }

  build() {
    this.host.innerHTML = "";
    this.world = h("div", "world");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("edges");
    this.svg.innerHTML = `<defs>${EDGE_COLORS.map((c, i) => `<marker id="arr${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join("")}<marker id="arrdim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#666"/></marker></defs>`;
    this.dots = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.dots.classList.add("edge-dots");
    this.labels = h("div", "edge-labels");
    this.world.append(this.svg);
    const ids = Object.keys(this.model.screens);
    this.colorOf = {};
    ids.forEach((id, i) => { this.colorOf[id] = i % EDGE_COLORS.length; });
    for (const id of ids) this.world.append(this.makeNode(this.model.screens[id]));
    this.world.append(this.dots, this.labels);
    this.markShared();
    this.host.append(this.world);
    this.autoLayout();
    for (const n of this.nodes.values()) relayout(n.phone);
    this.apply();
    this.drawEdges();
    this.bindPanZoom();
    this.fit();
    // late font loads change text sizes: lay out again once everything has arrived
    document.fonts.ready.then(() => {
      for (const n of this.nodes.values()) relayout(n.phone);
      this.drawEdges();
    });
  }

  makeNode(s) {
    const el = h("div", `node kind-${s.kind}`);
    el.dataset.id = s.id;
    const head = h("div", "node-head");
    const name = s.dialogOf ? s.layout : s.cls;
    head.innerHTML = `<span class="badge badge-${s.kind}">${KIND_LABEL[s.kind]}</span>${s.launcher ? '<span class="badge badge-start" title="Launcher activity: the app opens here">Start</span>' : ""}<b></b><small></small>`;
    head.querySelector("b").textContent = name;
    head.querySelector("small").textContent = s.layout ? `${s.layout}.xml` : "no layout";
    el.append(head);
    const shot = h("div", "node-shot", { width: SCREEN_W * NODE_SCALE + "px", height: SCREEN_H * NODE_SCALE + "px" });
    const scaler = h("div", "shot-scale", { transform: `scale(${NODE_SCALE})` });
    const phone = this.r.screen(s);
    scaler.append(phone);
    shot.append(scaler);
    el.append(shot);
    // buttons that do something get a subtle ring
    const wired = new Set(s.handlers.map((x) => x.id).filter(Boolean));
    for (const v of phone.querySelectorAll("[data-vid]")) {
      if (wired.has(v.dataset.vid) && !v.closest("[data-copy]")) v.classList.add("wired");
    }
    this.nodes.set(s.id, { el, phone, x: 0, y: 0, s });
    return el;
  }

  // Arrows from a bar that's <include>d on several screens (bottom nav) - drawn lighter, can be hidden.
  markShared() {
    const res = this.r.res;
    const uses = {};
    for (const s of Object.values(this.model.screens)) {
      if (!s.layout || s.dialogOf) continue;
      const doc = res.doc("layout", s.layout);
      if (!doc) continue;
      for (const inc of doc.getElementsByTagName("include")) {
        const name = (inc.getAttribute("layout") || "").replace("@layout/", "");
        (uses[name] = uses[name] || new Set()).add(s.id);
      }
    }
    const sharedLayouts = new Set(Object.keys(uses).filter((n) => uses[n].size >= 3));
    for (const e of this.model.edges) e.shared = !!(e.viewId && sharedLayouts.has(this.model.idInfo[e.viewId]?.layout));
    this.sharedCount = this.model.edges.filter((e) => e.shared).length;
  }

  setHideShared(hide) {
    this.hideShared = hide;
    this.drawEdges();
  }

  // ---------------------------------------------------------------- layout

  autoLayout() {
    const ids = [...this.nodes.keys()];
    const out = new Map(ids.map((id) => [id, []])), inc = new Map(ids.map((id) => [id, []]));
    for (const e of this.model.edges) { out.get(e.from)?.push(e.to); inc.get(e.to)?.push(e.from); }
    const rank = new Map();
    const order = [];
    const bfs = (roots) => {
      const q = roots.filter((r) => !rank.has(r));
      q.forEach((r) => { rank.set(r, 0); order.push(r); });
      while (q.length) {
        const id = q.shift();
        for (const t of out.get(id) || []) if (!rank.has(t)) { rank.set(t, rank.get(id) + 1); order.push(t); q.push(t); }
      }
    };
    // hosted fragments sit right after their host
    bfs(this.model.launchers);
    bfs(ids.filter((id) => !rank.has(id) && !(inc.get(id) || []).length && !this.model.screens[id].dialogOf));
    while (ids.some((id) => !rank.has(id))) bfs([ids.find((id) => !rank.has(id))]);
    // unreachable nodes go after the rest, not on top of the launcher
    const maxRank = Math.max(...rank.values());
    const reached = new Set();
    const mark = (id) => { if (reached.has(id)) return; reached.add(id); (out.get(id) || []).forEach(mark); };
    this.model.launchers.forEach(mark);
    if (this.model.launchers.length) for (const id of ids) if (!reached.has(id) && !(inc.get(id) || []).length) rank.set(id, rank.get(id) + maxRank + 1);

    const cols = [];
    for (const id of order) { const r = rank.get(id); (cols[r] = cols[r] || []).push(id); }
    const filled = cols.filter(Boolean);
    // a few barycenter sweeps to cut crossings
    const idx = new Map();
    const reindex = () => filled.forEach((col) => col.forEach((id, i) => idx.set(id, i)));
    reindex();
    for (let it = 0; it < 6; it++) {
      for (let c = 1; c < filled.length; c++) {
        const bc = (id) => { const ns = (inc.get(id) || []).filter((n) => idx.has(n) && filled[c - 1].includes(n)); return ns.length ? ns.reduce((a, n) => a + idx.get(n), 0) / ns.length : idx.get(id); };
        filled[c].sort((a, b) => bc(a) - bc(b));
        reindex();
      }
    }
    const tallest = Math.max(...filled.map((c) => c.length));
    const saved = JSON.parse(localStorage.getItem(this.posKey) || "{}");
    filled.forEach((col, c) => {
      const offset = (tallest - col.length) * (NODE_H + GAP_Y) / 2;
      col.forEach((id, i) => {
        const n = this.nodes.get(id);
        const p = saved[id];
        n.x = p ? p[0] : c * (NODE_W + GAP_X);
        n.y = p ? p[1] : offset + i * (NODE_H + GAP_Y);
        this.moveNode(n);
      });
    });
  }

  resetLayout() {
    localStorage.removeItem(this.posKey);
    this.autoLayout();
    this.drawEdges();
    this.fit();
  }

  savePositions() {
    const out = {};
    for (const [id, n] of this.nodes) out[id] = [Math.round(n.x), Math.round(n.y)];
    localStorage.setItem(this.posKey, JSON.stringify(out));
  }

  moveNode(n) {
    n.el.style.left = n.x + "px";
    n.el.style.top = n.y + "px";
  }

  // ---------------------------------------------------------------- edges

  // world coordinates of the view with this id inside a node (null if not drawn)
  viewPoint(n, id) {
    if (!id) return null;
    const cands = [...n.phone.querySelectorAll(`[data-vid="${CSS.escape(id)}"]`)].filter((v) => !v.closest("[data-copy]"));
    const v = cands.find((x) => x.getBoundingClientRect().width > 0);
    if (!v) return null;
    const wr = this.world.getBoundingClientRect(), r = v.getBoundingClientRect();
    const z = this.view.z;
    const shot = n.el.querySelector(".node-shot").getBoundingClientRect();
    // clipped by the phone screen (scrolled off the bottom) -> pin to the bottom edge
    const cy = Math.min((r.top + r.bottom) / 2, shot.bottom - 4);
    return { x: ((r.left + r.right) / 2 - wr.left) / z, y: (cy - wr.top) / z, w: r.width / z, h: r.height / z };
  }

  drawEdges() {
    for (const p of this.svg.querySelectorAll("g.edge")) p.remove();
    this.dots.innerHTML = "";
    this.labels.innerHTML = "";
    const incoming = new Map();
    for (const e of this.model.edges) {
      if (!incoming.has(e.to)) incoming.set(e.to, []);
      incoming.get(e.to).push(e);
    }
    const slots = new Map();
    for (const [to, list] of incoming) {
      list.sort((a, b) => (this.nodes.get(a.from)?.y ?? 0) - (this.nodes.get(b.from)?.y ?? 0));
      list.forEach((e, i) => slots.set(e, { i, n: list.length }));
    }
    this.model.edges.forEach((e, ei) => {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) return;
      const btn = this.viewPoint(a, e.viewId);
      const goesLeft = b.x + NODE_W < a.x + 1;
      // start on the button's edge (facing the target) so the dot doesn't hide its text
      const start = btn ? { x: goesLeft ? btn.x - btn.w / 2 : btn.x + btn.w / 2, y: btn.y } : { x: a.x + NODE_W / 2, y: a.y + 22 };
      const slot = slots.get(e);
      const ty = b.y + 40 + (slot.n > 1 ? (slot.i / (slot.n - 1)) * Math.min(NODE_H - 80, slot.n * 22) : 0);
      let d;
      const right = b.x > a.x + NODE_W - 1, left = b.x + NODE_W < a.x + 1;
      if (right) {
        const ex = a.x + NODE_W, tx = b.x - 2, dx = Math.max(60, (tx - ex) / 2);
        d = `M${start.x} ${start.y} L${ex} ${start.y} C${ex + dx} ${start.y} ${tx - dx} ${ty} ${tx} ${ty}`;
      } else if (left) {
        const ex = a.x, tx = b.x + NODE_W + 2, dx = Math.max(60, (ex - tx) / 2);
        d = `M${start.x} ${start.y} L${ex} ${start.y} C${ex - dx} ${start.y} ${tx + dx} ${ty} ${tx} ${ty}`;
      } else {
        const ex = a.x + NODE_W, tx = b.x + NODE_W + 2, bulge = 70 + (slot.i % 4) * 16;
        d = `M${start.x} ${start.y} L${ex} ${start.y} C${ex + bulge} ${start.y} ${tx + bulge} ${ty} ${tx} ${ty}`;
      }
      const ci = this.colorOf[e.from];
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("edge");
      if (e.auto) g.classList.add("auto");
      if (e.shared) g.classList.add("shared");
      if (e.shared && this.hideShared) g.classList.add("off");
      g.dataset.from = e.from;
      g.dataset.to = e.to;
      g.dataset.idx = ei;
      if (e.viewId) g.dataset.vid = e.viewId;
      g.innerHTML = `<path class="hit" d="${d}"/><path class="line" d="${d}" stroke="${EDGE_COLORS[ci]}" marker-end="url(#arr${ci})"/>`;
      if (btn) {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        Object.entries({ cx: start.x, cy: start.y, r: 4, fill: EDGE_COLORS[ci] }).forEach(([k, v]) => dot.setAttribute(k, v));
        dot.dataset.idx = ei;
        if (e.shared) dot.classList.add("shared");
        if (e.shared && this.hideShared) dot.classList.add("off");
        this.dots.append(dot);
      }
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = this.edgeText(e);
      g.append(title);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); this.opts.onSelect(e.from, e.viewId); });
      g.addEventListener("mouseenter", () => this.highlight({ edge: ei }));
      g.addEventListener("mouseleave", () => this.highlight(null));
      this.svg.append(g);
      // label (shown when highlighted)
      const path = g.querySelector(".line");
      const len = path.getTotalLength();
      const mid = path.getPointAtLength(btn ? Math.min(len * 0.55, len - 40) : len * 0.5);
      const lab = h("div", "edge-label", { left: mid.x + "px", top: mid.y + "px", borderColor: EDGE_COLORS[ci] });
      lab.textContent = e.auto ? e.label : `${e.label}${e.cond && e.cond.length ? " *" : ""}`;
      lab.dataset.idx = ei;
      this.labels.append(lab);
    });
  }

  edgeText(e) {
    const from = this.model.screens[e.from], to = this.model.screens[e.to];
    const name = (s) => (s.dialogOf ? s.layout : s.cls);
    const what = e.auto ? e.label : `“${e.label}”`;
    const cond = e.cond && e.cond.length ? `\nOnly ${condText(e.cond)}` : "";
    return `${name(from)}: ${what} → ${name(to)}${cond}`;
  }

  // focus = { node } | { edge } | { node, vid } | null
  highlight(focus) {
    const edges = [...this.svg.querySelectorAll("g.edge")];
    const labels = [...this.labels.children];
    const dots = [...this.dots.children];
    this.world.classList.toggle("focusing", !!focus);
    for (const n of this.nodes.values()) n.el.classList.remove("hl", "dim-node");
    if (!focus) {
      edges.forEach((g) => g.classList.remove("hl", "dim"));
      dots.forEach((d) => d.classList.remove("dim"));
      labels.forEach((l) => l.classList.remove("show"));
      return;
    }
    const on = (g) => {
      if (focus.edge != null) return +g.dataset.idx === focus.edge;
      if (focus.vid) return g.dataset.from === focus.node && g.dataset.vid === focus.vid;
      return g.dataset.from === focus.node || g.dataset.to === focus.node;
    };
    const lit = new Set();
    edges.forEach((g) => {
      const yes = on(g);
      g.classList.toggle("hl", yes);
      g.classList.toggle("dim", !yes);
      if (yes) { lit.add(+g.dataset.idx); this.svg.append(g); this.nodes.get(g.dataset.to)?.el.classList.add("hl"); this.nodes.get(g.dataset.from)?.el.classList.add("hl"); }
    });
    if (focus.node) this.nodes.get(focus.node)?.el.classList.add("hl");
    for (const n of this.nodes.values()) if (!n.el.classList.contains("hl")) n.el.classList.add("dim-node");
    labels.forEach((l) => l.classList.toggle("show", lit.has(+l.dataset.idx)));
    dots.forEach((d) => d.classList.toggle("dim", !lit.has(+d.dataset.idx)));
  }

  // ---------------------------------------------------------------- pan, zoom, drag

  apply() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.host.style.setProperty("--z", z);
    this.opts.onZoom?.(z);
  }

  fit() {
    const ns = [...this.nodes.values()];
    if (!ns.length) return;
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + NODE_W)), maxY = Math.max(...ns.map((n) => n.y + NODE_H));
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const z = Math.min(1, Math.max(0.12, Math.min((W - 80) / (maxX - minX + 40), (H - 80) / (maxY - minY + 40))));
    this.view = { z, x: (W - (maxX - minX) * z) / 2 - minX * z, y: (H - (maxY - minY) * z) / 2 - minY * z };
    this.apply();
  }

  zoomBy(f, cx = this.host.clientWidth / 2, cy = this.host.clientHeight / 2) {
    const z = Math.min(2.5, Math.max(0.1, this.view.z * f));
    const k = z / this.view.z;
    this.view.x = cx - (cx - this.view.x) * k;
    this.view.y = cy - (cy - this.view.y) * k;
    this.view.z = z;
    this.apply();
  }

  focusNode(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const z = Math.max(this.view.z, 0.8);
    this.view = { z, x: W / 2 - (n.x + NODE_W / 2) * z, y: H / 2 - (n.y + NODE_H / 2) * z };
    this.world.classList.add("animating");
    this.apply();
    setTimeout(() => this.world.classList.remove("animating"), 400);
  }

  bindPanZoom() {
    const host = this.host;
    host.onwheel = (e) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > 0 && !e.shiftKey) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else { this.view.x -= e.deltaX || e.deltaY; this.apply(); }
    };
    let drag = null;
    host.onpointerdown = (e) => {
      if (e.button !== 0) return;
      const nodeEl = e.target.closest(".node");
      if (nodeEl) {
        const n = this.nodes.get(nodeEl.dataset.id);
        drag = { kind: "node", n, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false, target: e.target };
      } else drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: this.view.x, oy: this.view.y, moved: false };
      host.setPointerCapture(e.pointerId);
    };
    host.onpointermove = (e) => {
      if (!drag) {
        // hovering a wired button inside a card lights up its arrows
        const v = e.target.closest?.(".node .wired");
        const nodeEl = e.target.closest?.(".node");
        const key = v ? `${nodeEl.dataset.id}|${v.dataset.vid}` : nodeEl ? nodeEl.dataset.id : null;
        if (key !== this._hover && !e.target.closest?.("g.edge")) {
          this._hover = key;
          this.highlight(v ? { node: nodeEl.dataset.id, vid: v.dataset.vid } : nodeEl ? { node: nodeEl.dataset.id } : null);
        }
        return;
      }
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === "pan") { this.view.x = drag.ox + dx; this.view.y = drag.oy + dy; this.apply(); host.classList.add("panning"); }
      else {
        drag.n.x = drag.ox + dx / this.view.z;
        drag.n.y = drag.oy + dy / this.view.z;
        this.moveNode(drag.n);
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => this.drawEdges());
      }
    };
    host.onpointerup = (e) => {
      host.classList.remove("panning");
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === "node" && d.moved) { this.savePositions(); this.drawEdges(); return; }
      if (!d.moved) {
        if (d.kind === "node") {
          const v = d.target.closest(".wired");
          this.opts.onSelect(d.n.s.id, v ? v.dataset.vid : null);
        } else this.opts.onSelect(null);
      }
    };
    host.onpointerleave = () => { if (!drag) { this._hover = null; this.highlight(null); } };
  }
}
