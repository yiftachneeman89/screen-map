// The flow chart: a plain top-to-bottom chart of boxes, one per screen, with one labelled arrow
// for each "screen A opens screen B". Click a box to see the real screen. Pan by dragging the
// background, zoom with the wheel, drag boxes to move them.

const NODE_W = 230, NODE_H = 112;
const THUMB_SCALE = 0.125;                 // the little picture of the screen inside a box
const GAP_X = 60, GAP_Y = 150;
const KIND_LABEL = { activity: "Activity", fragment: "Fragment", dialog: "Dialog" };
const NODE_SCALE = 0.5;                    // gallery cards

// "AITeacherMenuActivity" -> "AI Teacher Menu", "dialog_forgot_password" -> "Forgot password"
function friendlyName(s) {
  if (!s) return "";
  if (s.dialogOf) {
    const t = s.layout.replace(/^(dialog|dlg|layout|alert)_/, "").replace(/_(dialog|dlg|file|layout)$/g, "").replace(/_/g, " ");
    return t[0].toUpperCase() + t.slice(1);
  }
  const base = s.cls.replace(/(DialogFragment|Activity|Fragment|Dialog)$/, "") || s.cls;
  return base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

class FlowChart {
  constructor(host, model, renderer, opts) {
    this.host = host;
    this.model = model;
    this.r = renderer;
    this.opts = opts;
    this.view = { x: 40, y: 40, z: 1 };
    this.nodes = new Map();   // id -> { el, x, y, phone, s }
    this.posKey = `sm.pos2.${opts.projectName}`;
    this.hideShared = true;
  }

  build() {
    this.host.innerHTML = "";
    this.world = h("div", "world");
    this.frames = h("div", "frames");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("edges");
    const marker = (id, color) => `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker>`;
    this.svg.innerHTML = `<defs>${marker("arr", "#8a8a83")}${marker("arrhl", "#c8231b")}</defs>`;
    this.labels = h("div", "edge-labels");
    this.world.append(this.frames, this.svg);
    this.findGroups();
    for (const s of Object.values(this.model.screens)) this.world.append(this.makeNode(s));
    this.world.append(this.labels);
    this.host.append(this.world);
    this.autoLayout();
    for (const n of this.nodes.values()) relayout(n.phone);
    this.drawEdges();
    this.bindPanZoom();
    this.home();
    document.fonts.ready.then(() => { for (const n of this.nodes.values()) relayout(n.phone); this.drawEdges(); });
  }

  makeNode(s) {
    const el = h("div", `node kind-${s.kind}`);
    el.dataset.id = s.id;
    el.style.width = NODE_W + "px";
    el.style.height = NODE_H + "px";
    const thumb = h("div", "node-thumb", { width: SCREEN_W * THUMB_SCALE + "px", height: SCREEN_H * THUMB_SCALE + "px" });
    const scaler = h("div", "shot-scale", { transform: `scale(${THUMB_SCALE})` });
    const phone = this.r.screen(s);
    scaler.append(phone);
    thumb.append(scaler);
    const text = h("div", "node-text");
    const buttons = new Set(s.handlers.map((x) => x.id || x.label)).size;
    text.innerHTML = `<b></b><small><span class="kind kind-${s.kind}">${KIND_LABEL[s.kind]}</span>${buttons ? ` · ${buttons} button${buttons > 1 ? "s" : ""}` : ""}</small><span class="node-open">View screen</span>`;
    text.querySelector("b").textContent = friendlyName(s);
    el.append(thumb, text);
    if (s.launcher) el.insertAdjacentHTML("afterbegin", `<span class="start-tag" title="The app opens here">Start</span>`);
    el.title = `${s.dialogOf ? s.layout : s.cls} - click to see the screen`;
    this.nodes.set(s.id, { el, phone, x: 0, y: 0, s });
    return el;
  }

  // A bar <include>d on 3+ screens (a bottom nav) links all of them to each other. Those arrows are
  // hidden by default; the screens are kept side by side in a labelled frame instead.
  findGroups() {
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
    const shared = Object.keys(uses).filter((n) => uses[n].size >= 3);
    this.groups = [];
    this.groupOf = new Map();
    for (const name of shared) {
      const members = new Set(uses[name]);
      for (const e of this.model.edges) {
        if (e.viewId && this.model.idInfo[e.viewId]?.layout === name) { e.shared = true; members.add(e.to); }
      }
      const g = { name, members: [...members].filter((id) => !this.groupOf.has(id)) };
      if (g.members.length < 2) continue;
      g.members.forEach((id) => this.groupOf.set(id, g));
      this.groups.push(g);
    }
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
    for (const e of this.model.edges) {
      if (e.from === e.to) continue;
      out.get(e.from)?.push(e.to);
      inc.get(e.to)?.push(e.from);
    }
    // rows by distance from the start screen; a nav-bar group shares one row
    const rank = new Map();
    const order = [];
    const setRank = (id, r, q) => {
      const group = this.groupOf.get(id);
      for (const m of group ? group.members : [id]) if (!rank.has(m)) { rank.set(m, r); order.push(m); q.push(m); }
    };
    const bfs = (roots) => {
      const q = [];
      roots.forEach((r) => setRank(r, 0, q));
      while (q.length) {
        const id = q.shift();
        for (const t of out.get(id) || []) if (!rank.has(t)) setRank(t, rank.get(id) + 1, q);
      }
    };
    bfs(this.model.launchers);
    const reached = new Set(rank.keys());
    // screens nothing leads to start their own trees, below the main one
    const base = rank.size ? Math.max(...rank.values()) + 1 : 0;
    const orphans = ids.filter((id) => !rank.has(id) && !(inc.get(id) || []).length);
    const r0 = rank.size;
    bfs(orphans);
    while (ids.some((id) => !rank.has(id))) bfs([ids.find((id) => !rank.has(id))]);
    if (r0) for (const id of ids) if (!reached.has(id)) rank.set(id, rank.get(id) + base);

    const rows = [];
    for (const id of order) { const r = rank.get(id); (rows[r] = rows[r] || []).push(id); }
    const filled = rows.filter(Boolean);
    // sweeps to cut crossings: sort each row by where its neighbours sit
    const pos = new Map();
    const reindex = () => filled.forEach((row) => row.forEach((id, i) => pos.set(id, i - (row.length - 1) / 2)));
    reindex();
    const rowOf = new Map();
    filled.forEach((row, r) => row.forEach((id) => rowOf.set(id, r)));
    const sweep = (r, up) => {
      const row = filled[r];
      const key = new Map();
      for (const id of row) {
        const ns = [...(inc.get(id) || []), ...(out.get(id) || [])].filter((n) => (up ? rowOf.get(n) > r : rowOf.get(n) < r));
        key.set(id, ns.length ? ns.reduce((a, n) => a + pos.get(n), 0) / ns.length : pos.get(id));
      }
      // keep a group's members next to each other
      for (const g of this.groups) {
        const inRow = row.filter((id) => g.members.includes(id));
        if (inRow.length < 2) continue;
        const avg = inRow.reduce((a, id) => a + key.get(id), 0) / inRow.length;
        inRow.sort((a, b) => key.get(a) - key.get(b)).forEach((id, i) => key.set(id, avg + i * 1e-4));
      }
      row.sort((a, b) => key.get(a) - key.get(b));
      reindex();
    };
    for (let it = 0; it < 8; it++) {
      for (let r = 1; r < filled.length; r++) sweep(r, false);
      for (let r = filled.length - 2; r >= 0; r--) sweep(r, true);
    }

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.posKey) || "{}"); } catch {}
    this.moved = Object.keys(saved).length > 0;
    filled.forEach((row, r) => {
      row.forEach((id, i) => {
        const n = this.nodes.get(id);
        const p = saved[id];
        n.x = p ? p[0] : (i - (row.length - 1) / 2) * (NODE_W + GAP_X);
        n.y = p ? p[1] : r * (NODE_H + GAP_Y);
        this.moveNode(n);
      });
    });
    this.opts.onMoved?.(this.moved);
  }

  resetLayout() {
    try { localStorage.removeItem(this.posKey); } catch {}
    this.autoLayout();
    this.drawEdges();
    this.fit();
  }

  savePositions() {
    const out = {};
    for (const [id, n] of this.nodes) out[id] = [Math.round(n.x), Math.round(n.y)];
    try { localStorage.setItem(this.posKey, JSON.stringify(out)); } catch {}
    this.moved = true;
    this.opts.onMoved?.(true);
  }

  moveNode(n) {
    n.el.style.left = n.x + "px";
    n.el.style.top = n.y + "px";
  }

  // ---------------------------------------------------------------- arrows

  // one arrow per (from, to), listing every button that makes that jump
  links() {
    const map = new Map();
    for (const e of this.model.edges) {
      if (e.from === e.to || !this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      if (e.shared && this.hideShared) continue;
      const key = `${e.from}>${e.to}>${e.auto ? 1 : 0}`;
      if (!map.has(key)) map.set(key, { from: e.from, to: e.to, auto: !!e.auto, edges: [] });
      map.get(key).edges.push(e);
    }
    const labelOf = (l) => {
      const names = [...new Set(l.edges.map((e) => (l.auto ? autoLabel(e.label) : e.label)))];
      return names.length > 2 ? `${names.slice(0, 2).join(" · ")} +${names.length - 2}` : names.join(" · ");
    };
    for (const l of map.values()) {
      l.shared = l.edges.every((e) => e.shared);
      l.label = labelOf(l);
      l.vid = l.edges.find((e) => e.viewId)?.viewId || null;
    }
    // A -> B and B -> A (like Next / Back) become one two-way arrow
    for (const [key, l] of map) {
      if (l.auto || l.gone) continue;
      const back = map.get(`${l.to}>${l.from}>0`);
      if (!back || back.gone || back === l || back.shared !== l.shared) continue;
      const a = this.nodes.get(l.from), b = this.nodes.get(l.to);
      const [fwd, rev] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [l, back] : [back, l];
      fwd.bi = true;
      fwd.back = rev.edges;
      fwd.label = fwd.label === rev.label ? fwd.label : `${fwd.label} / ${rev.label}`;
      rev.gone = true;
    }
    return [...map.values()].filter((l) => !l.gone);
  }

  drawEdges() {
    for (const g of this.svg.querySelectorAll("g.edge")) g.remove();
    this.labels.innerHTML = "";
    this.drawFrames();
    const links = this.links();
    const box = (id) => this.nodes.get(id);
    const sameRow = (a, b) => Math.abs(a.y - b.y) < NODE_H;
    const between = (a, b) => [...this.nodes.values()].some((n) => n !== a && n !== b && sameRow(n, a) && n.x > Math.min(a.x, b.x) && n.x < Math.max(a.x, b.x));

    // which side of each box every arrow uses
    for (const l of links) {
      const a = box(l.from), b = box(l.to);
      if (b.y >= a.y + NODE_H + 30) { l.kind = "down"; l.sa = "bottom"; l.sb = "top"; }
      else if (b.y + NODE_H + 30 <= a.y) { l.kind = "up"; l.sa = "top"; l.sb = "bottom"; }
      // side by side only when the label fits in the gap, otherwise curve below the row
      else if (!between(a, b) && Math.abs(b.x - a.x) - NODE_W > l.label.length * 7.6 + 40) { l.kind = "side"; l.sa = b.x > a.x ? "right" : "left"; l.sb = b.x > a.x ? "left" : "right"; }
      else { l.kind = "loop"; l.sa = "bottom"; l.sb = "bottom"; }
    }
    // spread the arrows along each side, ordered by where the other end is
    const ports = new Map();
    const addPort = (id, side, l, end, other) => {
      const k = id + side;
      if (!ports.has(k)) ports.set(k, []);
      ports.get(k).push({ l, end, other });
    };
    for (const l of links) {
      const a = box(l.from), b = box(l.to);
      addPort(l.from, l.sa, l, "a", b);
      addPort(l.to, l.sb, l, "b", a);
    }
    for (const [k, list] of ports) {
      const horiz = /top|bottom/.test(k.slice(-6));
      list.sort((p, q) => (horiz ? p.other.x - q.other.x : p.other.y - q.other.y) || (p.end < q.end ? -1 : 1));
      list.forEach((p, i) => { p.l["f" + p.end] = (i + 1) / (list.length + 1); });
    }
    const point = (n, side, f) => {
      if (side === "top") return { x: n.x + NODE_W * f, y: n.y - 1 };
      if (side === "bottom") return { x: n.x + NODE_W * f, y: n.y + NODE_H + 1 };
      if (side === "left") return { x: n.x - 1, y: n.y + NODE_H * f };
      return { x: n.x + NODE_W + 1, y: n.y + NODE_H * f };
    };

    const placed = [...this.nodes.values()].map((n) => ({ x: n.x - 6, y: n.y - 6, w: NODE_W + 12, h: NODE_H + 12 }));
    let loopN = 0;
    links.forEach((l, li) => {
      const a = box(l.from), b = box(l.to);
      const s = point(a, l.sa, l.fa), t = point(b, l.sb, l.fb);
      let d;
      if (l.kind === "down" || l.kind === "up") {
        const dir = l.kind === "down" ? 1 : -1;
        const c = Math.max(50, Math.abs(t.y - s.y) * 0.45);
        d = `M${s.x} ${s.y} C${s.x} ${s.y + c * dir} ${t.x} ${t.y - c * dir} ${t.x} ${t.y - 4 * dir}`;
      } else if (l.kind === "side") {
        const dir = l.sa === "right" ? 1 : -1;
        const c = Math.max(30, Math.abs(t.x - s.x) * 0.45);
        d = `M${s.x} ${s.y} C${s.x + c * dir} ${s.y} ${t.x - c * dir} ${t.y} ${t.x - 4 * dir} ${t.y}`;
      } else {
        const dip = 55 + (loopN++ % 3) * 18;
        d = `M${s.x} ${s.y} C${s.x} ${s.y + dip} ${t.x} ${t.y + dip} ${t.x} ${t.y + 4}`;
      }
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", `edge${l.auto ? " auto" : ""}${l.shared ? " shared" : ""}`);
      g.dataset.from = l.from;
      g.dataset.to = l.to;
      g.dataset.idx = li;
      if (l.bi) {
        // pull the start back so the second arrowhead isn't buried in the box
        if (l.kind === "down" || l.kind === "up") d = d.replace(/^M(\S+) (\S+)/, (m, x, y) => `M${x} ${+y + (l.kind === "down" ? 4 : -4)}`);
        else if (l.kind === "side") d = d.replace(/^M(\S+)/, (m, x) => `M${+x + (l.sa === "right" ? 4 : -4)}`);
        else d = d.replace(/^M(\S+) (\S+)/, (m, x, y) => `M${x} ${+y + 4}`);
      }
      g.innerHTML = `<path class="hit" d="${d}"/><path class="line" d="${d}" marker-end="url(#arr)"${l.bi ? ' marker-start="url(#arr)"' : ""}/>`;
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = this.linkText(l);
      g.append(title);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); this.opts.onSelect(l.from, l.vid); });
      g.addEventListener("mouseenter", () => this.highlight({ link: li }));
      g.addEventListener("mouseleave", () => this.highlight(null));
      this.svg.append(g);

      // the label sits close to where the arrow leaves, nudged along it until it is clear
      const lab = h("div", `edge-label${l.auto ? " auto" : ""}${l.shared ? " shared" : ""}`);
      lab.textContent = l.label;
      lab.dataset.idx = li;
      lab.title = this.linkText(l);
      lab.onclick = (ev) => { ev.stopPropagation(); this.opts.onSelect(l.from, l.vid); };
      lab.onmouseenter = () => this.highlight({ link: li });
      lab.onmouseleave = () => this.highlight(null);
      this.labels.append(lab);
      const w = lab.offsetWidth, hh = lab.offsetHeight;
      const path = g.querySelector(".line");
      const len = path.getTotalLength();
      // try the middle first, then step outwards both ways
      let best = null;
      for (let k = 0; k < 2 * len / 10; k++) {
        const at = len / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10;
        if (at < 14 || at > len - 14) continue;
        const p = path.getPointAtLength(at);
        const r = { x: p.x - w / 2 - 4, y: p.y - hh / 2 - 3, w: w + 8, h: hh + 6 };
        if (!placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) { best = r; break; }
      }
      if (!best) { const p = path.getPointAtLength(len / 2); best = { x: p.x - w / 2 - 4, y: p.y - hh / 2 - 3, w: w + 8, h: hh + 6 }; }
      placed.push(best);
      lab.style.left = best.x + 4 + "px";
      lab.style.top = best.y + 3 + "px";
    });
    this.linkList = links;
  }

  drawFrames() {
    this.frames.innerHTML = "";
    for (const g of this.groups) {
      const ns = g.members.map((id) => this.nodes.get(id)).filter(Boolean);
      if (ns.length < 2) continue;
      const x0 = Math.min(...ns.map((n) => n.x)) - 22, y0 = Math.min(...ns.map((n) => n.y)) - 44;
      const x1 = Math.max(...ns.map((n) => n.x + NODE_W)) + 22, y1 = Math.max(...ns.map((n) => n.y + NODE_H)) + 22;
      const f = h("div", "group-frame", { left: x0 + "px", top: y0 + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
      const nav = /nav|bar|menu|tab|bottom/i.test(g.name);
      f.innerHTML = `<span>${nav ? "Bottom bar" : "Shared bar"} · these screens can all open each other</span>`;
      f.title = `${g.name}.xml is on each of these screens`;
      this.frames.append(f);
    }
  }

  linkText(l) {
    const name = (id) => friendlyName(this.model.screens[id]);
    const lines = (edges) => [...new Set(edges.map((e) => {
      const what = l.auto ? autoLabel(e.label) : `“${e.label}”`;
      return e.cond && e.cond.length ? `${what}, only ${condText(e.cond)}` : what;
    }))].join("\n");
    const out = `${name(l.from)} → ${name(l.to)}\n${lines(l.edges)}`;
    return l.bi ? `${out}\n\n${name(l.to)} → ${name(l.from)}\n${lines(l.back)}` : out;
  }

  // focus = { node } | { link } | null
  highlight(focus) {
    const edges = [...this.svg.querySelectorAll("g.edge")];
    const labels = [...this.labels.children];
    for (const n of this.nodes.values()) n.el.classList.remove("hl", "dim-node");
    if (!focus) {
      edges.forEach((g) => { g.classList.remove("hl", "dim"); setArrows(g, "arr"); });
      labels.forEach((l) => l.classList.remove("hl", "dim"));
      return;
    }
    const lit = new Set();
    edges.forEach((g) => {
      const yes = focus.link != null ? +g.dataset.idx === focus.link : g.dataset.from === focus.node || g.dataset.to === focus.node;
      g.classList.toggle("hl", yes);
      g.classList.toggle("dim", !yes);
      setArrows(g, yes ? "arrhl" : "arr");
      if (yes) {
        lit.add(+g.dataset.idx);
        this.svg.append(g);
        this.nodes.get(g.dataset.to)?.el.classList.add("hl");
        this.nodes.get(g.dataset.from)?.el.classList.add("hl");
      }
    });
    if (focus.node) this.nodes.get(focus.node)?.el.classList.add("hl");
    for (const n of this.nodes.values()) if (!n.el.classList.contains("hl")) n.el.classList.add("dim-node");
    labels.forEach((l) => { const yes = lit.has(+l.dataset.idx); l.classList.toggle("hl", yes); l.classList.toggle("dim", !yes); });
  }

  // ---------------------------------------------------------------- pan, zoom, drag

  apply() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.opts.onZoom?.(z);
  }

  bounds() {
    const ns = [...this.nodes.values()];
    return {
      minX: Math.min(...ns.map((n) => n.x)) - 30, minY: Math.min(...ns.map((n) => n.y)) - 60,
      maxX: Math.max(...ns.map((n) => n.x + NODE_W)) + 30, maxY: Math.max(...ns.map((n) => n.y + NODE_H)) + 90,
    };
  }

  fit() {
    if (!this.nodes.size) return;
    const { minX, minY, maxX, maxY } = this.bounds();
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const z = Math.min(1.1, Math.max(0.1, Math.min((W - 40) / (maxX - minX), (H - 40) / (maxY - minY))));
    this.view = { z, x: (W - (maxX - minX) * z) / 2 - minX * z, y: (H - (maxY - minY) * z) / 2 - minY * z };
    this.apply();
  }

  // first view: everything if it is still readable, otherwise the top of the chart at a readable size
  home() {
    this.fit();
    if (this.view.z >= 0.72) return;
    const { minY } = this.bounds();
    const start = this.nodes.get(this.model.launchers[0]) || [...this.nodes.values()][0];
    const z = 0.72, W = this.host.clientWidth;
    this.view = { z, x: W / 2 - (start.x + NODE_W / 2) * z, y: 30 - minY * z };
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
    const z = Math.max(this.view.z, 0.9);
    this.view = { z, x: W / 2 - (n.x + NODE_W / 2) * z, y: H / 2 - (n.y + NODE_H / 2) * z };
    this.world.classList.add("animating");
    this.apply();
    setTimeout(() => this.world.classList.remove("animating"), 400);
    n.el.classList.add("flash");
    setTimeout(() => n.el.classList.remove("flash"), 1200);
  }

  bindPanZoom() {
    const host = this.host;
    host.onwheel = (e) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      if (e.ctrlKey || (Math.abs(e.deltaY) > 0 && !e.shiftKey)) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else { this.view.x -= e.deltaX || e.deltaY; this.apply(); }
    };
    let drag = null;
    host.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest(".edge-label")) return;
      const nodeEl = e.target.closest(".node");
      if (nodeEl) {
        const n = this.nodes.get(nodeEl.dataset.id);
        drag = { kind: "node", n, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
      } else drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: this.view.x, oy: this.view.y, moved: false };
      host.setPointerCapture(e.pointerId);
    };
    host.onpointermove = (e) => {
      if (!drag) {
        if (e.target.closest?.("g.edge, .edge-label")) return;
        const nodeEl = e.target.closest?.(".node");
        const key = nodeEl ? nodeEl.dataset.id : null;
        if (key !== this._hover) { this._hover = key; this.highlight(key ? { node: key } : null); }
        return;
      }
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === "pan") { this.view.x = drag.ox + dx; this.view.y = drag.oy + dy; this.apply(); host.classList.add("panning"); }
      else {
        drag.n.x = drag.ox + dx / this.view.z;
        drag.n.y = drag.oy + dy / this.view.z;
        this.moveNode(drag.n);
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => { this.drawEdges(); if (this._hover) this.highlight({ node: this._hover }); });
      }
    };
    host.onpointerup = () => {
      host.classList.remove("panning");
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === "node" && d.moved) { this.savePositions(); return; }
      if (!d.moved && d.kind === "node") this.opts.onSelect(d.n.s.id);
    };
    host.onpointerleave = () => { if (!drag) { this._hover = null; this.highlight(null); } };
  }
}

function setArrows(g, id) {
  const line = g.querySelector(".line");
  line.setAttribute("marker-end", `url(#${id})`);
  if (line.hasAttribute("marker-start")) line.setAttribute("marker-start", `url(#${id})`);
}

// "When it opens" for the automatic jumps
function autoLabel(label) {
  return String(label || "Automatically").replace(/\s+if\b.*$/, "");
}
