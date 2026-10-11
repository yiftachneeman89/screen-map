// Screen Map: wires up loading a project, the flow chart, the layout gallery and the screen viewer.

const $ = (id) => document.getElementById(id);
let app = null;  // { name, res, model, renderer, chart }

function show(section) {
  for (const id of ["landing", "loading", "flowView", "galleryView"]) $(id).hidden = id !== section;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------------------------------------------------------------- loading

async function load(items) {
  show("loading");
  $("loadError").hidden = true;
  closeViewer();
  try {
    $("loadingText").textContent = "Reading files…";
    const raw = await readProject(items);
    if (!raw.texts.some((f) => /\/res\/layout/.test("/" + f.path)) && !raw.texts.some((f) => f.path.endsWith("AndroidManifest.xml"))) {
      throw new Error("No Android layouts or manifest found. Pick the project folder (the one that contains app/).");
    }
    $("loadingText").textContent = "Loading images and fonts…";
    const res = await loadResources(raw);
    $("loadingText").textContent = "Reading the code…";
    await new Promise((r) => setTimeout(r, 20));
    const model = new Analyzer(raw, res).run();
    if (!Object.keys(model.screens).length) throw new Error("Couldn't find any activities or fragments in this project.");
    const renderer = new Renderer(res, model);
    app = { name: raw.name, res, model, renderer };
    saveSummary(raw.name, model);
    $("projectName").textContent = raw.name;
    $("tabs").hidden = false;
    $("topActions").hidden = false;
    $("umlBar").hidden = false;
    document.title = `${raw.name} · Screen Map`;
    $("loadingText").textContent = "Drawing screens…";
    // text is measured for ConstraintLayout/RelativeLayout, so the fonts must be there first
    await Promise.all(["400", "500", "700"].map((w) => document.fonts.load(`${w} 16px Roboto`).catch(() => {})));
    await document.fonts.ready;
    showFlow();
  } catch (err) {
    console.error(err);
    show("landing");
    $("loadError").textContent = err.message || String(err);
    $("loadError").hidden = false;
  }
}

// what Review Deck shows on the Screen Map card
function saveSummary(name, model) {
  try {
    const list = Object.values(model.screens);
    const count = (k) => list.filter((s) => s.kind === k && !s.dialogOf).length;
    const start = list.find((s) => s.launcher);
    localStorage.setItem("sm.summary", JSON.stringify({
      project: name, screens: list.length, activities: count("activity"), fragments: count("fragment"),
      dialogs: list.filter((s) => s.kind === "dialog" || s.dialogOf).length,
      links: new Set(model.edges.map((e) => `${e.from}>${e.to}`)).size,
      buttons: list.reduce((n, s) => n + s.handlers.length, 0),
      start: start ? friendlyName(start) : null, at: Date.now(),
    }));
  } catch {}
}

function showFlow() {
  setTab("flow");
  show("flowView");
  if (!app.chart) {
    app.chart = new FlowChart($("canvas"), app.model, app.renderer, {
      projectName: app.name,
      onSelect: (id, vid) => openScreen(id, vid),
      onZoom: (z) => { $("zoomPct").textContent = Math.round(z * 100) + "%"; },
      onMoved: (moved) => { $("resetBtn").hidden = !moved; },
    });
    app.chart.build();
    $("sharedToggle").hidden = !app.chart.sharedCount;
    $("sharedCheck").checked = false;
  }
}

function showGallery() {
  setTab("gallery");
  show("galleryView");
  if (!app.galleryBuilt) { buildGallery(); app.galleryBuilt = true; }
}

function setTab(view) {
  for (const b of document.querySelectorAll(".tab-btn")) b.classList.toggle("active", b.dataset.view === view);
}

// ---------------------------------------------------------------- describing what a button does

const NAV_VERB = { activity: "Opens", fragment: "Switches to", dialog: "Opens the pop-up" };

function screenName(id) {
  const s = app.model.screens[id];
  return s ? friendlyName(s) : id;
}

// a screen name you can click to open that screen
function screenLink(id) {
  return app.model.screens[id] ? `<a class="go" data-go="${esc(id)}">${esc(screenName(id))}</a>` : `<b>${esc(id)}</b>`;
}

function dialogScreen(layout) {
  return Object.keys(app.model.screens).find((k) => app.model.screens[k].layout === layout && app.model.screens[k].dialogOf);
}

// one effect -> HTML phrase, e.g. "opens <a>Home</a>"
function phrase(e) {
  const s = app.model.screens[e.to];
  switch (e.type) {
    case "nav": return `${NAV_VERB[s?.kind] || "Opens"} ${screenLink(e.to)}`;
    case "back": return { finish: "closes this screen", finishAffinity: "closes all of the app's screens", onBackPressed: "goes back to the previous screen", popBackStack: "goes back to the previous screen", navigateUp: "goes back to the previous screen", dismiss: "closes the pop-up", dismissAllowingStateLoss: "closes the pop-up" }[e.how] || "goes back";
    case "toast": return e.text ? `shows the message <q>${esc(e.text)}</q>` : e.error ? "shows the error it got" : "shows a short message";
    case "alert": return e.title ? `shows a pop-up titled <q>${esc(e.title)}</q>` : "shows a pop-up";
    case "dialog": {
      const d = dialogScreen(e.layout);
      return d ? `opens the ${screenLink(d)} pop-up` : `opens the <q>${esc(e.layout)}</q> pop-up`;
    }
    case "api":
    case "visibility": return esc(e.text);
    case "call": return `runs <code>${esc(e.name)}</code>`;
    default: return "";
  }
}

// ---- conditions: code -> plain English ("email.isEmpty() || password.isEmpty()" -> "email or password is empty")

function words(name) {
  return name.replace(/^m(?=[A-Z])/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim();
}

// a code value -> a noun ("binding.emailEt.getText().toString()" -> "email"); null if it's too complex
function noun(x) {
  x = x.trim();
  if (/^("[^"]*"|'[^']*'|-?\d[\d.]*[fFlL]?)$/.test(x)) return x.startsWith("'") ? `"${x.slice(1, -1)}"` : x;
  let m = x.match(/^R\.id\.(\w+)$/);
  if (m) return `“${idLabel(m[1])}”`;
  x = x.replace(/^this\./, "").replace(/(\.(getText|toString|trim|getValue|text|value)(\(\))?)+$/, "");
  x = x.replace(/\.get([A-Z]\w*)\(\)$/, ".$1").replace(/^get([A-Z]\w*)\(\)$/, "$1");
  m = x.match(/^(.+)\.(length|size)(\(\))?$/);
  if (m) { const n = noun(m[1]); return n && `the ${m[2] === "size" ? "number of" : "length of"} ${n}`; }
  if (!/^[\w.]+$/.test(x)) return null;
  const last = x.split(".").pop().replace(/(Et|Edit|EditText|Tv|Txt|Input|Field)$/, "");
  return /^[A-Z_]+$/.test(last) ? last.toLowerCase().replace(/_/g, " ") : words(last);
}

// split "a && (b || c)" at top-level operators
function splitTop(expr, op) {
  const parts = [];
  let depth = 0, last = 0, q = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (!depth && expr.startsWith(op, i)) { parts.push(expr.slice(last, i)); last = i + op.length; i += op.length - 1; }
  }
  parts.push(expr.slice(last));
  return parts.map((p) => p.trim());
}

function unwrap(x) {
  x = x.trim();
  while (x.startsWith("(") && matchClose(x, 0) === x.length - 1) x = x.slice(1, -1).trim();
  return x;
}

// expression -> English, `neg` = say the opposite. null when it can't be put into words.
function plainExpr(expr, neg = false) {
  expr = unwrap(expr);
  let m = expr.match(/^not \((.*)\)$/) || expr.match(/^not (.*)$/);
  if (m) return plainExpr(m[1], !neg);
  for (const [op, word, opp] of [["||", "or", "and"], ["&&", "and", "or"]]) {
    let parts = splitTop(expr, op);
    if (parts.length < 2) continue;
    // "x != null && x.equals(..)" - the null check is just a safety net
    if (op === "&&") parts = parts.filter((p) => !(/^([\w.]+)\s*!=\s*null$/.test(p) && parts.some((o) => o !== p && o.startsWith(p.match(/^([\w.]+)/)[1] + "."))));
    const said = parts.map((p) => plainExpr(p, neg));
    if (said.some((x) => x == null)) return null;
    if (said.length === 1) return said[0];
    // "email is empty or password is empty" -> "email or password is empty"
    const tail = said.map((s) => s.match(/^(\S+) (is .*)$/));
    if (tail.every((t) => t && t[2] === tail[0][2])) return `${tail.map((t) => t[1]).join(` ${neg ? opp : word} `)} ${tail[0][2]}`;
    return said.join(` ${neg ? opp : word} `);
  }
  if (/^!/.test(expr)) return plainExpr(expr.slice(1), !neg);
  return plainAtom(expr, neg);
}

const CMP = { "==": ["is", "is not"], "!=": ["is not", "is"], ">": ["is more than", "is at most"], "<": ["is less than", "is at least"], ">=": ["is at least", "is less than"], "<=": ["is at most", "is more than"] };

function idLabel(id) {
  const info = app.model.idInfo[id];
  return (info && (info.text || info.desc)) || humanizeId(id);
}

function plainAtom(a, neg) {
  let m;
  // radioGroup.getCheckedRadioButtonId() == R.id.yes  ->  “Yes” is picked
  if ((m = a.match(/getCheckedRadioButtonId\(\)\s*(==|!=)\s*R\.id\.(\w+)$/))) return `“${idLabel(m[2])}” ${(m[1] === "==") !== neg ? "is picked" : "isn't picked"}`;
  if ((m = a.match(/^(?:binding\.)?(\w+)\.(isChecked|isSelected)(\(\))?$/))) {
    const id = Object.keys(app.model.idInfo).find((k) => norm(k) === norm(m[1]) || norm(k) === norm(snakeCase(m[1])));
    const n = id ? `“${idLabel(id)}”` : noun(m[1]);
    return `${n} ${neg ? "isn't ticked" : "is ticked"}`;
  }
  if ((m = a.match(/(?:^|\.)(?:getCurrentUser\(\)|currentUser)\s*(==|!=)\s*null$/))) return (m[1] === "!=") !== neg ? "someone is already signed in" : "nobody is signed in";
  if (/^savedInstanceState\s*==\s*null$/.test(a)) return neg ? "the screen is being restored" : "the screen is opening for the first time";
  if (/^savedInstanceState\s*!=\s*null$/.test(a)) return plainAtom("savedInstanceState == null", !neg);
  if ((m = a.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/))) {
    const [, l, op, r] = m;
    const left = noun(l);
    if (!left) return null;
    if (r === "null" && (op === "==" || op === "!=")) return (op === "==") !== neg ? `${left} is missing` : `${left} is set`;
    if (/^(true|false)$/.test(r) && (op === "==" || op === "!=")) return plainAtom(l, (r === "false") !== (op === "!=") !== neg);
    const right = noun(r);
    return right && `${left} ${CMP[op][neg ? 1 : 0]} ${right}`;
  }
  if ((m = a.match(/^([\w.]+)\.(isSuccessful|isComplete)(\(\))?$/))) return neg ? "it failed" : "it worked";
  if ((m = a.match(/^(?:TextUtils\.)?isEmpty\((.+)\)$/))) a = `${m[1]}.isEmpty()`;
  if ((m = a.match(/^(.+)\.(isEmpty|isBlank|isNullOrEmpty|isNullOrBlank|isNotEmpty|isNotBlank)(\(\))?$/))) {
    const n = noun(m[1]);
    const empty = /Not/.test(m[2]) ? neg : !neg;
    return n && `${n} ${empty ? "is empty" : "is not empty"}`;
  }
  if ((m = a.match(/^(.+)\.(equals|equalsIgnoreCase|contains|startsWith|endsWith)\((.+)\)$/))) {
    const l = noun(m[1]), r = noun(m[3]);
    const verb = { equals: ["is", "is not"], equalsIgnoreCase: ["is", "is not"], contains: ["contains", "doesn't contain"], startsWith: ["starts with", "doesn't start with"], endsWith: ["ends with", "doesn't end with"] }[m[2]];
    return l && r && `${l} ${verb[neg ? 1 : 0]} ${r}`;
  }
  // isBeginner(), user.isPremium, hasLessons()
  if ((m = a.match(/^(?:([\w.]+)\.)?(is|has|can|should)([A-Z]\w*)(\(\))?$/))) {
    const subj = m[1] ? noun(m[1]) + " " : "";
    const what = words(m[3]);
    const verb = { is: ["is", "is not"], has: ["has", "doesn't have"], can: ["can", "can't"], should: ["should", "shouldn't"] }[m[2]];
    if (!subj) return m[2] === "is" ? `${neg ? "not " : ""}${what}` : `${neg ? "it " + verb[1] : "it " + verb[0]} ${what}`;
    return `${subj}${verb[neg ? 1 : 0]} ${what}`;
  }
  // allFieldsFilled(x) -> "all fields filled"
  if ((m = a.match(/^(?:[\w.]+\.)?(\w+)\(.*\)$/))) return `${neg ? "not " : ""}${words(m[1])}`;
  if (/^[\w.]+$/.test(a)) return `${neg ? "not " : ""}${noun(a)}`;
  return null;
}

// one condition label as HTML: "if email is empty", or the code itself when it can't be said in words
function condHtml(c) {
  if (!/^if /.test(c) || /^if it('s| )/.test(c)) return esc(c);
  const said = plainExpr(c.slice(3));
  return said ? `if ${esc(said)}` : `if <code>${esc(c.slice(3))}</code>`;
}

// ["if a", "if b"] -> "if a and b" (plain text, for tooltips)
function condText(cond) {
  const list = (cond || []).filter((c, i, a) => a.indexOf(c) === i).map((c) => condHtml(c).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  return list.map((c, i) => (i && /^if /.test(c) && /^if /.test(list[i - 1]) ? c.slice(3) : c)).join(" and ");
}

function upperFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function lowerFirst(s) { return s && s[0] !== "<" ? s[0].toLowerCase() + s.slice(1) : s; }

function joinPhrases(list) {
  const parts = [...new Set(list.map(lowerFirst))];
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + ", then " + parts[parts.length - 1];
}

// effects -> a tree of steps: [{ html }, { cond, steps: [...] }] in the order the code runs
function stepTree(effects) {
  const root = { steps: [] };
  for (const e of effects) {
    let node = root;
    for (const c of [...new Set(e.cond || [])]) {
      let child = node.steps[node.steps.length - 1];
      if (!child || child.cond !== c) {
        child = { cond: c, steps: [] };
        node.steps.push(child);
      }
      node = child;
    }
    const last = node.steps[node.steps.length - 1];
    if (last && last.html != null) last.html.push(phrase(e));
    else node.steps.push({ html: [phrase(e)] });
  }
  return root.steps;
}

// "if x" right after "if not x" (or the other way round) reads better as "Otherwise"
function isOpposite(a, b) {
  if (!/^if /.test(a) || !/^if /.test(b)) return false;
  return negate(a.slice(3)) === b.slice(3) || negate(b.slice(3)) === a.slice(3);
}

function stepsEl(steps) {
  const ul = h("ul", "steps");
  steps.forEach((st, i) => {
    const li = h("li");
    if (st.html) {
      const text = upperFirst(joinPhrases(st.html));
      li.innerHTML = /[.!?](<\/q>)?$/.test(text) ? text : text + ".";
    } else {
      const prev = steps[i - 1];
      const label = prev && prev.cond && isOpposite(prev.cond, st.cond) ? "Otherwise" : upperFirst(condHtml(st.cond));
      li.className = "step-if";
      li.innerHTML = `<span class="cond">${label}:</span>`;
      if (/<code>/.test(label)) li.querySelector(".cond").title = "Screen Map couldn't put this condition into words, so it shows the code";
      li.append(stepsEl(st.steps));
    }
    ul.append(li);
  });
  return ul;
}

// a button's effects as readable steps
function describeEl(effects, event) {
  const meaningful = effects.filter((e) => e.type !== "call");
  // calls already explained by what they do, or that are just the condition being checked, aren't worth repeating
  const condCode = effects.flatMap((e) => e.cond || []).join(" ");
  const calls = effects.filter((e) => e.type === "call" && !meaningful.some((m) => m.via && e.name.startsWith(m.via + "(")) && !condCode.includes(e.name.split("(")[0] + "("));
  const wrap = h("div", "b-desc");
  if (!meaningful.length) {
    const p = h("p");
    const what = event === "toggle" ? "Turns this option on or off." : event === "type" ? "Reacts as you type." : "Only changes things on this screen.";
    p.innerHTML = `${what} <span class="muted">No screen change, message or saving found${calls.length ? "" : " in the code"}.</span>`;
    wrap.append(p);
  } else {
    wrap.append(stepsEl(stepTree(meaningful)));
  }
  if (calls.length) {
    const p = h("p", "b-calls");
    p.innerHTML = `Also runs ${calls.map((c) => `<code>${esc(c.name)}</code>`).join(" ")}`;
    wrap.append(p);
  }
  return wrap;
}

// plain-text version (used by the dev harness)
function describe(effects) { return describeEl(effects).textContent.replace(/\s+/g, " ").trim(); }

function codeBlock(item) {
  if (!item.code) return null;
  const d = h("details", "code");
  const file = item.file ? item.file.split("/").pop() : "";
  d.innerHTML = `<summary>Show code <span>${esc(file)}${item.line ? ":" + item.line : ""}</span></summary><pre></pre>`;
  d.querySelector("pre").textContent = item.code;
  return d;
}

// ---------------------------------------------------------------- the screen viewer (opens over the chart)

const viewHistory = [];

function closeViewer() {
  $("viewer").hidden = true;
  viewHistory.length = 0;
  if (app) app.selected = null;
}

// a phone, scaled to fill the viewer's height
function bigPhone(phone, fullHeight) {
  const avail = window.innerWidth < 900 ? Math.min(window.innerWidth - 64, 380) / SCREEN_W : (window.innerHeight - 120) / SCREEN_H;
  const scale = Math.max(0.45, Math.min(1, avail));
  const shot = h("div", "v-shot", { width: SCREEN_W * scale + "px" });
  if (fullHeight) shot.style.height = SCREEN_H * scale + "px";
  const scaler = h("div", "shot-scale", { transform: `scale(${scale})` });
  scaler.append(phone);
  shot.append(scaler);
  return { shot, scale };
}

function viewerShell(title, tags, sub) {
  $("viewer").hidden = false;
  const body = $("viewerBody");
  body.innerHTML = "";
  $("viewerBack").hidden = viewHistory.length < 2;
  if (viewHistory.length >= 2) $("viewerBack").querySelector("span").textContent = screenName(viewHistory[viewHistory.length - 2]);
  const left = h("div", "v-left");
  const right = h("div", "v-right");
  body.append(left, right);
  const head = h("div", "v-head");
  head.innerHTML = `<div class="v-tags">${tags}</div><h2></h2><p class="v-sub"></p>`;
  head.querySelector("h2").textContent = title;
  head.querySelector(".v-sub").textContent = sub;
  right.append(head);
  $("viewerCard").scrollTop = 0;
  right.scrollTop = 0;
  return { left, right };
}

function openScreen(id, vid, fromLink) {
  const s = app.model.screens[id];
  if (!s) return;
  if (!fromLink) viewHistory.length = 0;
  if (viewHistory[viewHistory.length - 1] !== id) viewHistory.push(id);
  app.selected = id;

  const sub = [s.dialogOf ? `${s.layout}.xml` : s.cls, s.layout && !s.dialogOf ? `${s.layout}.xml` : "", s.host ? `inside ${screenName(s.host.host)}` : ""].filter(Boolean).join(" · ");
  const tags = `<span class="kind kind-${s.kind}">${KIND_LABEL[s.kind]}</span>${s.launcher ? '<span class="kind kind-start">App starts here</span>' : ""}`;
  const { left, right } = viewerShell(friendlyName(s), tags, sub);

  const phone = app.renderer.screen(s, { interactive: true });
  const { shot } = bigPhone(phone, true);
  left.append(shot);
  relayout(phone);

  // where you can come from / go to
  const incoming = [...new Set(app.model.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from))];
  const outgoing = [...new Set(app.model.edges.filter((e) => e.from === id && e.to !== id).map((e) => e.to))];
  const links = h("div", "v-links");
  const linkRow = (label, ids, empty) => {
    const row = h("div", "v-link-row");
    row.innerHTML = `<span class="v-link-label">${label}</span>`;
    for (const t of ids) {
      const b = h("button", "chip-link");
      b.textContent = screenName(t);
      b.onclick = () => { openScreen(t, null, true); app.chart?.focusNode(t); };
      row.append(b);
    }
    if (!ids.length) row.insertAdjacentHTML("beforeend", `<span class="muted">${empty}</span>`);
    links.append(row);
  };
  linkRow("Comes from", incoming, s.launcher ? "Nothing - the app opens here" : "Nothing in the code opens this screen");
  linkRow("Leads to", outgoing, "No other screens");
  right.append(links);

  // every button and what it does, numbered to match badges on the phone
  const sec = h("section", "v-section");
  sec.innerHTML = `<h3>Buttons</h3>`;
  const cards = new Map();
  const byId = new Map();
  for (const hd of s.handlers) {
    const key = hd.id || hd.label;
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(hd);
  }
  const onPhone = new Set([...phone.querySelectorAll("[data-vid]")].filter((v) => !v.closest("[data-copy]")).map((v) => v.dataset.vid));
  let num = 0;
  const numbers = new Map();
  for (const list of byId.values()) {
    const first = list[0];
    const card = h("div", "b-card");
    const top = h("div", "b-top");
    const n = first.id && onPhone.has(first.id) ? ++num : null;
    if (n) numbers.set(first.id, n);
    const events = [...new Set(list.map((x) => x.event))].filter((ev) => ev && !/^(click|tap)$/i.test(ev));
    top.innerHTML = `${n ? `<span class="b-num">${n}</span>` : `<span class="b-num off" title="Not drawn on this screen">·</span>`}<span class="b-name"></span>${events.length ? `<span class="b-event">${esc(events.join(", "))}</span>` : ""}`;
    top.querySelector(".b-name").textContent = first.label;
    card.append(top);
    for (const hd of list) card.append(describeEl(hd.effects, hd.event));
    for (const hd of list) { const code = codeBlock(hd); if (code) card.append(code); }
    if (first.id) {
      card.onmouseenter = () => markView(phone, first.id, true);
      card.onmouseleave = () => { if (!card.classList.contains("active")) markView(phone, first.id, false); };
      cards.set(first.id, card);
    }
    sec.append(card);
  }
  if (!s.handlers.length) sec.insertAdjacentHTML("beforeend", `<p class="muted">No buttons with code on this screen.</p>`);
  right.append(sec);

  // tapping a button on the phone jumps to its explanation
  const wiredIds = new Set(s.handlers.map((x) => x.id).filter(Boolean));
  for (const v of phone.querySelectorAll("[data-vid]")) {
    if (wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]")) {
      v.classList.add("wired");
      v.onclick = (ev) => { ev.stopPropagation(); selectCard(cards, phone, v.dataset.vid); };
    }
  }
  placeBadges(shot, phone, numbers, cards);

  // things that happen without a tap
  if (s.auto.length) {
    const sec3 = h("section", "v-section");
    sec3.innerHTML = `<h3>Happens on its own</h3>`;
    for (const a of s.auto) {
      const card = h("div", "b-card auto");
      card.innerHTML = `<div class="b-top"><span class="b-num auto">⚡</span><span class="b-name"></span></div>`;
      card.querySelector(".b-name").textContent = a.trigger;
      card.append(describeEl(a.effects));
      const code = codeBlock(a);
      if (code) card.append(code);
      sec3.append(card);
    }
    right.append(sec3);
  }

  // button-looking views with no code behind them
  const loose = [...phone.querySelectorAll(".v-button, .v-imagebutton, .v-fab, .v-efab, .v-chip, .bn-item, [data-tag=ImageButton]")]
    .filter((v) => v.dataset.vid && !wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]") && getComputedStyle(v).display !== "none");
  if (loose.length) {
    const sec2 = h("section", "v-section");
    sec2.innerHTML = `<h3>Buttons with no code found</h3>`;
    const list = h("div", "unwired");
    for (const v of [...new Map(loose.map((x) => [x.dataset.vid, x])).values()]) {
      const c = h("span", "fx");
      c.textContent = app.model.idInfo[v.dataset.vid]?.text || humanizeId(v.dataset.vid, s.cls);
      c.title = "#" + v.dataset.vid;
      list.append(c);
    }
    sec2.append(list);
    sec2.insertAdjacentHTML("beforeend", `<p class="muted">These look like buttons, but Screen Map couldn't find what they do.</p>`);
    right.append(sec2);
  }

  if (vid && cards.has(vid)) setTimeout(() => selectCard(cards, phone, vid), 30);
}

// small numbered circles on the phone, matching the numbers in the button list.
// They follow their buttons as images load and the layout settles.
function placeBadges(shot, phone, numbers, cards) {
  const badges = [];
  for (const [vid, n] of numbers) {
    const v = [...phone.querySelectorAll(`[data-vid="${CSS.escape(vid)}"]`)].find((x) => !x.closest("[data-copy]"));
    if (!v) continue;
    const b = h("button", "p-badge");
    b.textContent = n;
    b.dataset.vid = vid;
    b.title = "See what this button does";
    b.onclick = (ev) => { ev.stopPropagation(); selectCard(cards, phone, vid); };
    shot.append(b);
    badges.push([b, v]);
  }
  const place = () => {
    const base = shot.getBoundingClientRect();
    const k = shot.offsetWidth / (base.width || 1);  // undo the pop-up's opening zoom animation
    for (const [b, v] of badges) {
      const r = v.getBoundingClientRect();
      b.hidden = !r.width || !r.height;
      b.style.left = Math.max(2, Math.min(shot.offsetWidth - 22, (r.left - base.left) * k - 8)) + "px";
      b.style.top = Math.max(2, Math.min(shot.offsetHeight - 22, (r.top - base.top) * k - 8)) + "px";
    }
  };
  place();
  phone.addEventListener("load", place, true);
  const ro = new ResizeObserver(place);
  ro.observe(phone);
  for (const el of phone.querySelectorAll("img, [data-vid]")) ro.observe(el);
  document.fonts.ready.then(place);
  $("viewerCard").addEventListener("animationend", place, { once: true });
  setTimeout(place, 400);
}

function markView(phone, vid, on) {
  for (const v of phone.querySelectorAll(`[data-vid="${CSS.escape(vid)}"]`)) if (!v.closest("[data-copy]")) v.classList.toggle("active", on);
}

function selectCard(cards, phone, vid) {
  for (const c of cards.values()) c.classList.remove("active");
  phone.querySelectorAll(".wired.active").forEach((v) => v.classList.remove("active"));
  for (const b of document.querySelectorAll(".p-badge")) b.classList.toggle("active", b.dataset.vid === vid);
  const card = cards.get(vid);
  if (!card) return;
  card.classList.add("active");
  markView(phone, vid, true);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------------------------------------------------------------- gallery of every layout

function buildGallery() {
  const g = $("gallery");
  g.innerHTML = "";
  const { model, res, renderer } = app;
  const usage = {};
  const note = (layout, text) => { (usage[layout] = usage[layout] || []).push(text); };
  for (const s of Object.values(model.screens)) {
    if (s.layout) note(s.layout, s.dialogOf ? `pop-up in ${screenName(s.dialogOf)}` : `${friendlyName(s)} screen`);
    for (const it of s.itemLayouts || []) note(it, `list row in ${friendlyName(s)}`);
  }
  for (const name of Object.keys(res.files.layout)) {
    const doc = res.doc("layout", name);
    if (!doc) continue;
    for (const inc of doc.getElementsByTagName("include")) note((inc.getAttribute("layout") || "").replace("@layout/", ""), `part of ${name}`);
  }
  const groups = { Screens: [], "List rows, pop-ups and parts": [], "Not used by any code": [] };
  for (const name of Object.keys(res.files.layout).sort()) {
    const u = usage[name] || [];
    const isScreen = u.some((t) => / screen$/.test(t));
    groups[isScreen ? "Screens" : u.length ? "List rows, pop-ups and parts" : "Not used by any code"].push(name);
  }
  for (const [title, names] of Object.entries(groups)) {
    if (!names.length) continue;
    const gh = h("div", "g-group");
    gh.textContent = `${title} · ${names.length}`;
    g.append(gh);
    for (const name of names) {
      const card = h("div", "g-card");
      const head = h("div", "g-head");
      head.innerHTML = `<b></b><small></small>`;
      head.querySelector("b").textContent = `${name}.xml`;
      head.querySelector("small").textContent = [...new Set(usage[name] || ["not used"])].join(" · ");
      const shot = h("div", "g-shot");
      const screen = Object.values(model.screens).find((s) => s.layout === name && !s.host);
      const phone = screen ? renderer.screen(screen) : renderer.standalone(name);
      const scaler = h("div", "shot-scale", { transform: `scale(${NODE_SCALE})` });
      scaler.append(phone);
      shot.append(scaler);
      card.append(shot, head);
      g.append(card);
      relayout(phone);
      const ph = phone.getBoundingClientRect().height || SCREEN_H * NODE_SCALE;
      shot.style.height = Math.min(ph, SCREEN_H * NODE_SCALE) + "px";
      shot.style.width = SCREEN_W * NODE_SCALE + "px";
      card.onclick = () => (screen ? openScreen(screen.id) : openLayout(name, usage[name]));
    }
  }
}

function openLayout(name, usage) {
  viewHistory.length = 0;
  const { left, right } = viewerShell(`${name}.xml`, `<span class="kind kind-fragment">Layout</span>`, [...new Set(usage || ["Not used by any code or layout"])].join(" · "));
  const phone = app.renderer.standalone(name, null, { interactive: true });
  const { shot } = bigPhone(phone, false);
  left.append(shot);
  relayout(phone);
  shot.style.height = phone.getBoundingClientRect().height + "px";
  const file = app.res.files.layout[name];
  if (file) {
    const d = h("details", "code");
    d.innerHTML = `<summary>Show XML <span>${esc(file.path)}</span></summary><pre></pre>`;
    d.querySelector("pre").textContent = file.text;
    right.append(d);
  }
}

// ---------------------------------------------------------------- events

for (const b of document.querySelectorAll(".tab-btn")) b.onclick = () => (b.dataset.view === "flow" ? showFlow() : showGallery());
$("viewerClose").onclick = closeViewer;
$("umlBtn").onclick = () => downloadUmlPdf($("umlBtn"));
$("umlSrc").onclick = downloadUmlSource;
$("viewerBody").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (!go) return;
  openScreen(go.dataset.go, null, true);
  app.chart?.focusNode(go.dataset.go);
});
$("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
$("viewerBack").onclick = () => { viewHistory.pop(); const id = viewHistory.pop(); if (id) { openScreen(id, null, true); app.chart?.focusNode(id); } };
$("zoomIn").onclick = () => app.chart.zoomBy(1.25);
$("zoomOut").onclick = () => app.chart.zoomBy(0.8);
$("fitBtn").onclick = () => app.chart.fit();
$("resetBtn").onclick = () => app.chart.resetLayout();
$("sharedCheck").onchange = (e) => app.chart.setHideShared(!e.target.checked);
$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !app) return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = Object.values(app.model.screens).find((s) => screenName(s.id).toLowerCase().includes(q) || s.cls.toLowerCase().includes(q) || (s.layout || "").includes(q));
  if (!hit) return;
  showFlow();
  app.chart.focusNode(hit.id);
  openScreen(hit.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && app) closeViewer(); });
window.addEventListener("resize", () => { if (app?.chart && !$("flowView").hidden) app.chart.apply(); });

// the project comes from Review Deck's sign-in, shared by all three tools
if (!document.querySelector('script[src$="dev.js"]')) DeckStore.require().then((saved) => load(saved.items));
