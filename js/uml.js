// Screen Map: turns the project's Java/Kotlin classes into a PlantUML class diagram (.puml).
// Classes with their fields and methods, inheritance, interfaces, inner classes,
// "has a" links (a field whose type is another class of the app) and which screen opens which.

const UML_STEREO = { activity: "Activity", fragment: "Fragment", dialog: "Dialog", adapter: "Adapter" };
const UML_VIS = { public: "+", private: "-", protected: "#", internal: "~", package: "~" };

// the text of a body at its own level only: anything inside nested { } is dropped (the braces stay)
function topLevel(s, open, close) {
  let out = "", depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = s[i];
    if (ch === "{") { if (!depth) out += "{"; depth++; continue; }
    if (ch === "}") { depth--; if (!depth) out += "}"; continue; }
    if (!depth) out += ch;
  }
  return out;
}

function stripAnnotations(t) {
  return t.replace(/@[\w.]+(\s*\([^()]*(\([^()]*\)[^()]*)*\))?/g, " ");
}

function simpleType(t) {
  return (t || "").replace(/\s+/g, " ").replace(/\b(?:[a-z]\w*\.)+(?=[A-Z])/g, "").trim();
}

// type names in a type, with their qualifier: "List<PlanData.Lesson>" -> [["List", null], ["Lesson", "PlanData"]]
function typeNames(t) {
  return [...(t || "").matchAll(/\b((?:[A-Z]\w*\.)*)([A-Z]\w*)/g)].map((m) => [m[2], m[1] ? m[1].slice(0, -1).split(".").pop() : null]);
}

function javaMembers(c) {
  const f = c.file;
  const body = topLevel(f.masked, c.open, c.close);
  const fields = [], methods = [];
  for (let chunk of body.split(/[;}]/)) {
    chunk = stripAnnotations(chunk).replace(/\s+/g, " ").trim();
    if (!chunk || /\b(class|interface|enum|record)\s+\w+/.test(chunk) || /^(static\s*)?\{$/.test(chunk)) continue;
    const eq = chunk.indexOf("="), paren = chunk.indexOf("(");
    if (chunk.endsWith("{") && paren >= 0 && (eq < 0 || eq > paren)) {
      const m = chunk.match(/^((?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*)(?:<[^>]*>\s*)?([\w.<>\[\]?, ]+?\s+)?(\w+)\s*\(([^)]*)\)/);
      if (!m) continue;
      const mods = m[1].trim().split(/\s+/);
      const ret = (m[2] || "").trim();
      if (!ret && m[3] !== c.name) continue;
      methods.push({ vis: mods.find((x) => UML_VIS[x]) || "", isStatic: mods.includes("static"), isAbstract: mods.includes("abstract"), name: m[3], params: javaParams(m[4]), ret: ret ? simpleType(ret) : "" });
    } else if (paren < 0 || eq >= 0 && eq < paren) {
      const decl = (eq >= 0 ? chunk.slice(0, eq) : chunk).trim();
      const m = decl.match(/^((?:(?:public|private|protected|static|final|transient|volatile)\s+)*)([\w.<>\[\]?, ]+?)\s+(\w+(?:\s*,\s*\w+)*)$/);
      if (!m || /^(return|throw|new)$/.test(m[2])) continue;
      const mods = m[1].trim().split(/\s+/);
      for (const name of m[3].split(/\s*,\s*/)) {
        fields.push({ vis: mods.find((x) => UML_VIS[x]) || "", isStatic: mods.includes("static"), name, type: simpleType(m[2]) });
      }
    }
  }
  return { fields, methods };
}

function javaParams(p) {
  return stripAnnotations(p).split(",").map((x) => x.replace(/\bfinal\b/g, "").trim()).filter(Boolean)
    .map((x) => { const m = x.match(/^(.+?)\s+(\w+)$/); return m ? `${m[2]}: ${simpleType(m[1])}` : x; });
}

function kotlinMembers(c) {
  const f = c.file;
  const fields = [], methods = [];
  // properties in the primary constructor: class X(val a: Int, private var b: String)
  const ctor = (c.header || "").match(/^[^(]*\(([\s\S]*)\)/);
  if (ctor) {
    for (const m of ctor[1].matchAll(/(?:(private|protected|internal|public)\s+)?(?:override\s+)?(val|var)\s+(\w+)\s*:\s*([\w.<>?, ]+)/g)) {
      fields.push({ vis: m[1] || "public", name: m[3], type: simpleType(m[4]) });
    }
  }
  if (c.close <= c.open) return { fields, methods };
  const body = topLevel(f.masked, c.open, c.close);
  for (let line of body.split(/\n|;/)) {
    line = stripAnnotations(line).replace(/\s+/g, " ").trim();
    if (!line || /\b(class|object|interface)\s+\w+/.test(line) || /^companion object/.test(line)) continue;
    let m = line.match(/^((?:\w+\s+)*?)fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w.<>?, ]+?))?\s*(?:[{=]|$)/);
    if (m) {
      const mods = m[1].trim().split(/\s+/);
      const params = m[3].split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const p = x.match(/(\w+)\s*:\s*([^=]+)/); return p ? `${p[1]}: ${simpleType(p[2])}` : x; });
      methods.push({ vis: mods.find((x) => UML_VIS[x]) || "public", isAbstract: mods.includes("abstract"), name: m[2], params, ret: simpleType(m[4] || "") });
      continue;
    }
    m = line.match(/^((?:\w+\s+)*?)(val|var)\s+(\w+)\s*(?::\s*([\w.<>?, ]+?))?\s*(?:=\s*(.*)|by\s+(.*))?$/);
    if (m) {
      const mods = m[1].trim().split(/\s+/);
      let type = m[4] || "";
      if (!type && m[5]) { const t = m[5].match(/^([A-Z]\w*)\s*\(/); if (t) type = t[1]; }
      fields.push({ vis: mods.find((x) => UML_VIS[x]) || "public", name: m[3], type: simpleType(type) });
    }
  }
  return { fields, methods };
}

// interfaces aren't in the analyzer's class list - find them here
function findInterfaces(files) {
  const out = {};
  for (const f of files) {
    for (const m of f.masked.matchAll(/\b(?:fun\s+)?interface\s+(\w+)(?:\s*<[^>{]*>)?([^{;]*)\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(f.masked, open);
      const ext = (m[2].match(/(?:extends|:)\s*([\w.,<> ]+)/) || [])[1];
      out[m[1]] = { name: m[1], file: f, open, close, header: m[2], interface: true, parents: ext ? ext.split(",").map((x) => x.trim().split(/[<\s]/)[0].split(".").pop()).filter(Boolean) : [] };
    }
  }
  return out;
}

// names this class implements (Java "implements A, B"; Kotlin ": Base(), A, B")
function implementsOf(c, ifaces) {
  const h = (c.header || "").replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, "");
  const list = c.file.kotlin ? (h.match(/:\s*([^{]*)/) || [])[1] : (h.match(/\bimplements\s+([^{]*)/) || [])[1];
  if (!list) return [];
  return list.split(",").map((x) => x.trim().split(/[<\s]/)[0].split(".").pop()).filter((n) => n && ifaces[n] && n !== c.superName);
}

// every class in the code, each with a unique diagram id. The analyzer keeps one class per name,
// so a nested class sharing a name with another (PlanData.Lesson vs the Lesson screen) is added here.
function collectClasses(model, ifaces) {
  const list = Object.values(model.classes).map((c) => ({ ...c }));
  const seen = new Set(list.map((c) => c.file.path + ":" + c.start));
  for (const f of model.files || []) {
    for (const m of f.masked.matchAll(/\b(class|object)\s+(\w+)(?:\s*<[^>{]*>)?([^{;]*?)\{/g)) {
      if (seen.has(f.path + ":" + m.index) || !model.classes[m[2]]) continue;
      if (f.kotlin && /\n\s*(class|fun|val|var|object|@)\b/.test(m[3])) continue;
      const open = m.index + m[0].length - 1;
      const ext = m[3].match(/\bextends\s+([\w.]+)/) || (f.kotlin && m[3].replace(/\([^()]*(\([^()]*\)[^()]*)*\)/, "").match(/:\s*([\w.]+)/));
      list.push({ name: m[2], file: f, start: m.index, open, close: matchClose(f.masked, open), header: m[3], superName: ext ? ext[1].split(".").pop() : null, kind: "other", inner: [] });
    }
  }
  const all = [...list, ...Object.values(ifaces)];
  for (const c of all) {
    const outer = all.filter((o) => o !== c && o.file === c.file && o.open < c.start && o.close > c.open).sort((a, b) => b.open - a.open)[0];
    c.outerRef = outer || null;
  }
  const count = {};
  for (const c of all) count[c.name] = (count[c.name] || 0) + 1;
  for (const c of all) {
    c.label = count[c.name] > 1 && c.outerRef ? `${c.outerRef.name}.${c.name}` : c.name;
    c.uid = c.label.replace(/\W/g, "_");
  }
  return all;
}

// a type name used inside class c -> the class it means (nested siblings first, then the app-wide one)
function resolveType(name, c, all, qualifier) {
  if (qualifier) return all.find((x) => x.name === name && x.outerRef?.name === qualifier) || null;
  for (let scope = c; scope; scope = scope.outerRef) {
    const hit = all.find((x) => x.name === name && x.outerRef === scope);
    if (hit) return hit;
  }
  return all.find((x) => x.name === name && x.label === name) || all.find((x) => x.name === name) || null;
}

function packageOf(file) {
  const m = file.masked.match(/^\s*package\s+([\w.]+)/m);
  return m ? m[1] : "";
}

function memberText(vis, text, isStatic, isAbstract) {
  return { vis: UML_VIS[vis] || "", text, isStatic: !!isStatic, isAbstract: !!isAbstract };
}

// the diagram as plain data, shared by the PlantUML and PDF outputs
function umlModel(model) {
  const ifaces = findInterfaces(model.files || [...new Set(Object.values(model.classes).map((c) => c.file))]);
  const all = collectClasses(model, ifaces);
  const classes = [], rels = [];
  const external = new Set();
  for (const c of all) {
    const { fields, methods } = c.file.kotlin ? kotlinMembers(c) : javaMembers(c);
    const before = c.file.masked.slice(Math.max(0, c.start - 40), c.start);
    const isAbstract = !c.interface && /\babstract\s+$/.test(before);
    const isObject = /^object\b/.test(c.file.masked.slice(c.start, c.start + 7));
    const defaultVis = c.file.kotlin || c.interface ? "public" : "package";
    classes.push({
      uid: c.uid, label: c.label, pkg: packageOf(c.file),
      kw: c.interface ? "interface" : isAbstract ? "abstract class" : "class",
      stereo: UML_STEREO[c.kind] || (isObject ? "object" : c.interface ? "interface" : ""),
      fields: fields.map((fl) => memberText(fl.vis || defaultVis, `${fl.name}${fl.type ? ": " + fl.type : ""}`, fl.isStatic)),
      methods: methods.map((m) => memberText(m.vis || defaultVis, `${m.name}(${m.params.join(", ")})${m.ret && m.ret !== "Unit" && m.ret !== "void" ? ": " + m.ret : ""}`, m.isStatic, m.isAbstract)),
    });

    const parents = c.interface ? c.parents : [c.superName].filter(Boolean);
    for (const p of parents) {
      const hit = resolveType(p, c, all);
      if (!hit) external.add(p);
      rels.push({ type: "extends", from: c.uid, to: hit ? hit.uid : p });
    }
    if (!c.interface) for (const i of implementsOf(c, ifaces)) rels.push({ type: "implements", from: c.uid, to: ifaces[i].uid });
    if (c.outerRef) rels.push({ type: "inner", from: c.outerRef.uid, to: c.uid });
    const has = new Map();
    for (const fl of fields) {
      for (const [t, q] of typeNames(fl.type)) {
        const hit = resolveType(t, c, all, q);
        if (!hit || hit === c || hit === c.outerRef || hit.outerRef === c || (q && hit.name !== t)) continue;
        if (!has.has(hit.uid)) has.set(hit.uid, new Set());
        has.get(hit.uid).add(fl.name);
      }
    }
    for (const [uid, names] of has) rels.push({ type: "has", from: c.uid, to: uid, label: [...names].join(", ") });
  }

  // which screen opens which (dialogs made from a layout aren't classes, so they're left out)
  const uidOf = (name) => (all.find((x) => x.name === name && x.label === name) || {}).uid;
  const opens = new Map();  // "a>b" -> opened by a tap at least once?
  for (const e of model.edges) {
    const a = uidOf(e.from), b = uidOf(e.to);
    if (!a || !b || a === b) continue;
    opens.set(`${a}>${b}`, opens.get(`${a}>${b}`) || !e.auto);
  }
  for (const [key, tapped] of opens) {
    const [from, to] = key.split(">");
    rels.push({ type: "opens", from, to, label: tapped ? "opens" : "opens on its own" });
  }
  classes.sort((a, b) => a.pkg.localeCompare(b.pkg) || a.label.localeCompare(b.label));
  return { classes, rels, external: [...external].sort() };
}

function byPackage(classes) {
  const map = new Map();
  for (const c of classes) {
    if (!map.has(c.pkg)) map.set(c.pkg, []);
    map.get(c.pkg).push(c);
  }
  return map;
}

// ---------------------------------------------------------------- PlantUML (.puml)

function buildUml(model, projectName) {
  const d = umlModel(model);
  const lines = [
    "@startuml",
    `title ${projectName} - class diagram`,
    `' Made by Screen Map from the project's Java/Kotlin code.`,
    `' Open it with PlantUML: the PlantUML plugin in Android Studio or VS Code, or plantuml.com.`,
    "skinparam classAttributeIconSize 0",
    "skinparam shadowing false",
    "hide empty members",
    "",
  ];
  const member = (m) => `  ${m.vis}${m.isStatic ? "{static} " : ""}${m.isAbstract ? "{abstract} " : ""}${m.text}`;
  for (const [pkg, list] of byPackage(d.classes)) {
    if (pkg) lines.push(`package ${pkg} {`);
    for (const c of list) {
      const stereo = c.stereo && c.stereo !== "interface" ? ` <<${c.stereo}>>` : "";
      lines.push(`${c.kw} "${c.label}" as ${c.uid}${stereo} {`, ...c.fields.map(member), ...c.methods.map(member), "}");
    }
    if (pkg) lines.push("}");
    lines.push("");
  }
  if (d.external.length) {
    lines.push("' Android / library classes the app builds on");
    for (const e of d.external) lines.push(`class ${e} <<library>> #EEEEEE`);
    lines.push("");
  }
  const arrow = {
    extends: (r) => `${r.to} <|-- ${r.from}`,
    implements: (r) => `${r.to} <|.. ${r.from}`,
    inner: (r) => `${r.from} +-- ${r.to}`,
    has: (r) => `${r.from} --> ${r.to} : ${r.label}`,
    opens: (r) => `${r.from} ..> ${r.to} : ${r.label}`,
  };
  lines.push("' inheritance, interfaces, inner classes and fields");
  lines.push(...new Set(d.rels.filter((r) => r.type !== "opens").map((r) => arrow[r.type](r))));
  const opens = d.rels.filter((r) => r.type === "opens");
  if (opens.length) lines.push("", "' navigation: which screen opens which", ...opens.map((r) => arrow.opens(r)));
  lines.push("@enduml", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------- PDF (drawn with Graphviz, in the browser)

const GRAPHVIZ_URL = "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm-graphviz@1.29.2/dist/index.js";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm";
const SVG2PDF_URL = "https://cdn.jsdelivr.net/npm/svg2pdf.js@2.8.1/+esm";

function dotEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STEREO_COLOR = { Activity: "#E9E7FF", Fragment: "#E1F3FB", Dialog: "#FFF0DC", Adapter: "#E6F6EA", interface: "#F2F2F2", object: "#F2F2F2" };

function dotHeader(title, rankdir) {
  return [
    "digraph UML {",
    `  graph [rankdir=${rankdir}, fontname="Helvetica", nodesep=0.35, ranksep=0.6, labelloc=t, fontsize=22, label=<${title}<br/> >, pad=0.4, newrank=true];`,
    `  node [shape=plain, fontname="Helvetica", fontsize=10];`,
    `  edge [fontname="Helvetica", fontsize=9, color="#555555", fontcolor="#444444"];`,
  ];
}

// page 1: classes with their members, inheritance, interfaces, inner classes and fields
function buildClassDot(d, projectName) {
  const out = dotHeader(`<b>${dotEsc(projectName)}</b> - class diagram`, "BT");
  const memberRow = (m) => {
    let t = dotEsc(`${m.vis} ${m.text}`);
    if (m.isAbstract) t = `<i>${t}</i>`;
    if (m.isStatic) t = `<u>${t}</u>`;
    return `<tr><td align="left">${t}</td></tr>`;
  };
  const section = (rows) => `<tr><td align="left"><table border="0" cellborder="0" cellspacing="0" cellpadding="1">${rows.length ? rows.map(memberRow).join("") : "<tr><td> </td></tr>"}</table></td></tr>`;
  const node = (c) => {
    const name = c.kw === "abstract class" ? `<i><b>${dotEsc(c.label)}</b></i>` : `<b>${dotEsc(c.label)}</b>`;
    const head = `${c.stereo ? `<font point-size="8">${dotEsc(`<<${c.stereo}>>`)}</font><br/>` : ""}${name}`;
    return `    ${c.uid} [label=<<table border="1" cellborder="1" cellspacing="0" cellpadding="4" color="#444444" bgcolor="#FFFFFF">` +
      `<tr><td bgcolor="${STEREO_COLOR[c.stereo] || "#FFFFFF"}">${head}</td></tr>${section(c.fields)}${section(c.methods)}</table>>];`;
  };
  let n = 0;
  for (const [pkg, list] of byPackage(d.classes)) {
    if (pkg) out.push(`  subgraph cluster_${n++} {`, `    label=<${dotEsc(pkg)}>; labeljust=l; fontsize=11; style=rounded; color="#BBBBBB"; fontcolor="#666666";`);
    for (const c of list) out.push(node(c));
    if (pkg) out.push("  }");
  }
  for (const e of d.external) {
    out.push(`  ${e} [label=<<table border="1" cellborder="0" cellspacing="0" cellpadding="5" color="#999999" bgcolor="#EEEEEE"><tr><td><font point-size="8">&lt;&lt;library&gt;&gt;</font><br/>${dotEsc(e)}</td></tr></table>>];`);
  }

  // many classes under one parent would sit in one very long row: stagger them over a few rows
  const rels = d.rels.filter((r) => r.type !== "opens");
  const kids = new Map();
  for (const r of rels) if (r.type === "extends" || r.type === "implements") {
    if (!kids.has(r.to)) kids.set(r.to, []);
    kids.get(r.to).push(r.from);
  }
  const minlen = new Map();
  for (const list of kids.values()) {
    const rows = Math.min(4, Math.ceil(list.length / 5));
    list.forEach((k, i) => minlen.set(k, 1 + (i % rows)));
  }
  const seen = new Set();
  for (const r of rels) {
    const key = `${r.type}:${r.from}:${r.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ml = minlen.get(r.from) || 1;
    if (r.type === "extends") out.push(`  ${r.from} -> ${r.to} [arrowhead=empty, arrowsize=1.2, minlen=${ml}];`);
    if (r.type === "implements") out.push(`  ${r.from} -> ${r.to} [arrowhead=empty, arrowsize=1.2, style=dashed, minlen=${ml}];`);
    if (r.type === "inner") out.push(`  ${r.to} -> ${r.from} [arrowhead=odot, color="#888888"];`);
    if (r.type === "has") out.push(`  ${r.from} -> ${r.to} [arrowhead=vee, label=<${dotEsc(r.label)}>];`);
  }
  // classes with no links at all: stack them in columns rather than one row
  const linked = new Set(rels.flatMap((r) => [r.from, r.to]));
  const loose = d.classes.filter((c) => !linked.has(c.uid)).map((c) => c.uid);
  const cols = Math.max(1, Math.ceil(loose.length / 3));
  for (let i = cols; i < loose.length; i++) out.push(`  ${loose[i - cols]} -> ${loose[i]} [style=invis];`);
  out.push("}");
  return out.join("\n");
}

// page 2: which screen opens which
function buildNavDot(d, projectName) {
  const out = dotHeader(`<b>${dotEsc(projectName)}</b> - which screen opens which`, "TB");
  const opens = d.rels.filter((r) => r.type === "opens");
  const used = new Set(opens.flatMap((r) => [r.from, r.to]));
  for (const c of d.classes) {
    if (!used.has(c.uid)) continue;
    out.push(`  ${c.uid} [label=<<table border="1" cellborder="0" cellspacing="0" cellpadding="6" color="#444444" bgcolor="${STEREO_COLOR[c.stereo] || "#FFFFFF"}"><tr><td><font point-size="8">${dotEsc(`<<${c.stereo || "class"}>>`)}</font><br/><b>${dotEsc(c.label)}</b></td></tr></table>>];`);
  }
  for (const r of opens) out.push(`  ${r.from} -> ${r.to} [arrowhead=vee${r.label === "opens" ? "" : ", style=dashed"}, color="#6C63FF"];`);
  out.push(`  key [label=<<table border="0" cellspacing="2"><tr><td align="left">solid: opened by a tap</td></tr><tr><td align="left">dashed: opens on its own</td></tr></table>>, fontcolor="#6C63FF"];`);
  out.push("}");
  return out.join("\n");
}

// draws each page as SVG with Graphviz, then puts the pages in a PDF - all in this page, nothing is sent anywhere
async function buildUmlPdf(model, projectName) {
  const [{ Graphviz }, { jsPDF }, { svg2pdf }] = await Promise.all([import(GRAPHVIZ_URL), import(JSPDF_URL), import(SVG2PDF_URL)]);
  const graphviz = await Graphviz.load();
  const d = umlModel(model);
  const pages = [buildClassDot(d, projectName)];
  if (d.rels.some((r) => r.type === "opens")) pages.push(buildNavDot(d, projectName));
  let doc = null;
  for (const dot of pages) {
    const svg = new DOMParser().parseFromString(graphviz.dot(dot), "image/svg+xml").documentElement;
    const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));  // points
    const orientation = w > h ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [w, h], compress: true });
    else doc.addPage([w, h], orientation);
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-99999px;top:0";
    holder.append(svg);
    document.body.append(holder);
    try { await svg2pdf(svg, doc, { x: 0, y: 0, width: w, height: h }); } finally { holder.remove(); }
  }
  doc.setProperties({ title: `${projectName} - UML`, creator: "Screen Map" });
  return doc.output("blob");
}

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function umlFileName(ext) { return `${(app.name || "project").replace(/[^\w.-]+/g, "_")}-uml.${ext}`; }

async function downloadUmlPdf(btn) {
  if (!app || btn.disabled) return;
  const label = btn.querySelector("span"), old = label.textContent;
  btn.disabled = true;
  label.textContent = "Drawing diagram…";
  try {
    saveBlob(await buildUmlPdf(app.model, app.name), umlFileName("pdf"));
  } catch (err) {
    console.error(err);
    alert("Couldn't make the PDF. The drawing tools load from the internet, so check your connection. You can still download the .puml file.");
  } finally {
    btn.disabled = false;
    label.textContent = old;
  }
}

function downloadUmlSource() {
  if (!app) return;
  saveBlob(new Blob([buildUml(app.model, app.name)], { type: "text/plain" }), umlFileName("puml"));
}
