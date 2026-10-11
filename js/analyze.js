// Reads the Java/Kotlin sources and works out the app's screens, which layout each one shows,
// what every button does, and where it navigates to.

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "synchronized", "return", "new", "else", "when", "try", "do", "throw", "super", "this", "assert"]);
const ACTIVITY_BASES = /^(Activity|AppCompatActivity|FragmentActivity|ComponentActivity|ListActivity|PreferenceActivity|TabActivity|AccountAuthenticatorActivity|NativeActivity)$/;
const DIALOG_FRAGMENT_BASES = /^(DialogFragment|AppCompatDialogFragment|BottomSheetDialogFragment)$/;
const FRAGMENT_BASES = /^(Fragment|ListFragment|PreferenceFragmentCompat|PreferenceFragment|NavHostFragment)$/;
const DIALOG_BASES = /^(Dialog|AlertDialog|AppCompatDialog|BottomSheetDialog|ProgressDialog)$/;
const ADAPTER_BASES = /Adapter$/;
const LISTENER_METHODS = "setOnClickListener|setOnLongClickListener|setOnItemClickListener|setOnItemSelectedListener|setOnNavigationItemSelectedListener|setOnCheckedChangeListener|setNavigationOnClickListener|setOnMenuItemClickListener|setOnEditorActionListener";
const ROW_RECEIVERS = /^(view|v|itemView|convertView|conView|row|rowView|holder\.itemView|binding\.root|root)$/;
const ID_SUFFIX = /_(btn|button|bt|tv|txt|text|iv|img|image|ib|ibtn|ll|cl|fl|rl|cv|card|et|edit|cb|rb|rg|sw|switch|sb|pb|lv|rv|gv|sp|fab|chip|tab|layout|view|icon|ic)$/;

// Comments -> spaces, string contents -> spaces (same length, so indexes line up with the source).
function maskCode(src, keepStrings = false) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const j = src.indexOf("\n", i), end = j < 0 ? n : j;
      out += " ".repeat(end - i); i = end; continue;
    }
    if (c === "/" && c2 === "*") {
      let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2;
      out += src.slice(i, j).replace(/[^\n]/g, " "); i = j; continue;
    }
    if (src.startsWith('"""', i)) {
      let j = src.indexOf('"""', i + 3); j = j < 0 ? n : j + 3;
      out += keepStrings ? src.slice(i, j) : '"' + src.slice(i + 1, j - 1).replace(/[^\n]/g, " ") + '"'; i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += keepStrings ? src.slice(i, j) : c + " ".repeat(Math.max(0, j - i - 2)) + (j - i >= 2 ? src[j - 1] : "");
      i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

const PAIRS = { "{": "}", "(": ")", "[": "]" };

// Index of the bracket closing the one at `open` (in masked code).
function matchClose(s, open) {
  const o = s[open], c = PAIRS[o];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) depth++;
    else if (s[i] === c && --depth === 0) return i;
  }
  return s.length - 1;
}

function matchOpen(s, close) {
  const c = s[close], o = { "}": "{", ")": "(", "]": "[" }[c];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i] === c) depth++;
    else if (s[i] === o && --depth === 0) return i;
  }
  return 0;
}

function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }

function lineAt(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

function snakeCase(camel) {
  return camel.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
}

// "a != null" -> "a == null", "!ok" -> "ok", anything else -> "not (...)"
function negate(c) {
  c = c.trim();
  if (/&&|\|\|/.test(c)) return `not (${c})`;
  if (/^!\(.*\)$/.test(c)) return c.slice(2, -1);
  if (/^![\w.]+(\(\))?$/.test(c)) return c.slice(1);
  let m = c.match(/^(.+?)\s*!=\s*(.+)$/);
  if (m) return `${m[1]} == ${m[2]}`;
  m = c.match(/^(.+?)\s*==\s*(.+)$/);
  if (m) return `${m[1]} != ${m[2]}`;
  return `not ${c}`;
}

function norm(id) { return id.replace(/_/g, "").toLowerCase(); }

// "profile_homescreen_btn" in class HomeScreen -> "Profile"
function humanizeId(id, cls) {
  let s = id.replace(ID_SUFFIX, "");
  const owner = (cls || "").toLowerCase();
  if (owner) s = s.split("_").filter((t) => t && t !== owner && !owner.startsWith(t) || t.length < 3).join("_") || s;
  s = s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : id;
}

class SourceFile {
  constructor(path, text) {
    this.path = path;
    this.text = text;
    this.masked = maskCode(text);
    this.comments = maskCode(text, true);  // comments masked, strings kept
    this.kotlin = path.endsWith(".kt");
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.lineStarts.push(i + 1);
  }
  line(idx) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }
}

class Analyzer {
  constructor(project, res) {
    this.res = res;
    this.files = project.texts.filter((f) => /\.(java|kt)$/.test(f.path)).map((f) => new SourceFile(f.path, f.text));
    this.manifests = project.texts.filter((f) => f.path.endsWith("AndroidManifest.xml"))
      .sort((a, b) => (a.path.includes("/src/main/") ? 0 : 1) - (b.path.includes("/src/main/") ? 0 : 1));
    this.classes = {};
    this.layoutIds = {};   // layout name -> Set of ids defined in it (incl. includes)
    this.idInfo = {};      // id -> { tag, text, desc, layout }
  }

  run() {
    this.indexLayouts();
    this.findClasses();
    this.readManifest();
    for (const c of Object.values(this.classes)) this.findMethods(c);
    for (const c of Object.values(this.classes)) c.kind = this.kindOf(c.name);
    for (const c of Object.values(this.classes)) this.findLayouts(c);
    this.findNavGraphs();
    this.findHosts();
    this.callCounts();
    return this.build();
  }

  // ---------------------------------------------------------------- layouts (ids and their labels)

  indexLayouts() {
    for (const name of Object.keys(this.res.files.layout)) {
      const doc = this.res.doc("layout", name);
      const ids = new Set();
      if (doc) {
        for (const el of doc.getElementsByTagName("*")) {
          const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
          if (!id) continue;
          ids.add(id);
          if (!this.idInfo[id]) {
            const text = this.res.string(el.getAttribute("android:text") || el.getAttribute("tools:text") || el.getAttribute("app:title"));
            const desc = this.res.string(el.getAttribute("android:contentDescription") || el.getAttribute("android:hint"));
            this.idInfo[id] = { tag: el.tagName.split(".").pop(), text: text && !/^@/.test(text) ? text : null, desc, layout: name };
          }
        }
      }
      this.layoutIds[name] = ids;
    }
    for (const name of Object.keys(this.res.files.menu)) {
      const doc = this.res.doc("menu", name);
      if (!doc) continue;
      for (const el of doc.getElementsByTagName("item")) {
        const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
        if (id && !this.idInfo[id]) this.idInfo[id] = { tag: "MenuItem", text: this.res.string(el.getAttribute("android:title")), layout: null, menu: name };
      }
    }
  }

  label(id, cls) {
    const info = this.idInfo[id];
    return (info && (info.text || info.desc)) || humanizeId(id, cls);
  }

  // ---------------------------------------------------------------- classes and methods

  findClasses() {
    const re = /\b(class|object|interface)\s+(\w+)(?:\s*<[^>{]*>)?([^{;]*?)\{/g;
    for (const f of this.files) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(f.masked))) {
        const [, kw, name, header] = m;
        if (kw === "interface") continue;
        if (/\n\s*(class|fun|val|var|object|@)\b/.test(header) && f.kotlin) continue;  // body-less Kotlin class
        const open = m.index + m[0].length - 1;
        const close = matchClose(f.masked, open);
        let superName = null;
        const ext = header.match(/\bextends\s+([\w.]+)/) || (f.kotlin && header.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/, "").match(/:\s*([\w.]+)/));
        if (ext) superName = ext[1].split(".").pop();
        if (!this.classes[name]) {
          this.classes[name] = { name, file: f, start: m.index, open, close, superName, methods: [], header, inner: [] };
        }
      }
    }
    // Kotlin classes without a body: class NavHostActivity : AppCompatActivity(R.layout.x)
    const bare = /\bclass\s+(\w+)(?:\s*<[^>{]*>)?\s*(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?\s*:\s*([\w.]+)\s*(\([^()\n]*\))?[ \t]*(?=\n|$)/g;
    for (const f of this.files.filter((x) => x.kotlin)) {
      for (const m of f.masked.matchAll(bare)) {
        if (this.classes[m[1]]) continue;
        const end = m.index + m[0].length;
        this.classes[m[1]] = { name: m[1], file: f, start: m.index, open: end, close: end, superName: m[2].split(".").pop(), methods: [], header: f.masked.slice(m.index, end), inner: [] };
      }
    }
    // inner classes (adapters inside activities) know their outer class
    for (const c of Object.values(this.classes)) {
      const outer = Object.values(this.classes).filter((o) => o !== c && o.file === c.file && o.open < c.start && o.close > c.close)
        .sort((a, b) => (b.open - a.open))[0];
      if (outer) { c.outer = outer.name; outer.inner.push(c.name); }
    }
  }

  readManifest() {
    this.launchers = [];
    this.manifestActivities = {};
    this.appTheme = null;
    this.appLabel = null;
    for (const mf of this.manifests) {
      const doc = parseXml(mf.text);
      if (!doc) continue;
      const app = doc.getElementsByTagName("application")[0];
      if (app) {
        this.appTheme = this.appTheme || app.getAttribute("android:theme");
        this.appLabel = this.appLabel || this.res.string(app.getAttribute("android:label"));
      }
      for (const a of [...doc.getElementsByTagName("activity"), ...doc.getElementsByTagName("activity-alias")]) {
        const full = a.getAttribute("android:name") || "";
        const name = full.split(".").pop();
        if (!name) continue;
        const launcher = [...a.getElementsByTagName("category")].some((c) => c.getAttribute("android:name") === "android.intent.category.LAUNCHER");
        if (launcher && !this.launchers.includes(name)) this.launchers.push(name);
        if (!this.manifestActivities[name]) {
          this.manifestActivities[name] = { theme: a.getAttribute("android:theme"), label: this.res.string(a.getAttribute("android:label")) };
        }
      }
    }
  }

  kindOf(name, seen = new Set()) {
    if (this.manifestActivities[name]) return "activity";
    const c = this.classes[name];
    if (!c || !c.superName || seen.has(name)) return "other";
    seen.add(name);
    const s = c.superName;
    if (ACTIVITY_BASES.test(s)) return "activity";
    if (DIALOG_FRAGMENT_BASES.test(s)) return "dialog";
    if (FRAGMENT_BASES.test(s)) return "fragment";
    if (DIALOG_BASES.test(s)) return "dialog";
    if (ADAPTER_BASES.test(s)) return "adapter";
    if (this.classes[s]) return this.kindOf(s, seen);
    return "other";
  }

  // Every method body (including ones inside anonymous classes), with its class.
  findMethods(c) {
    const f = c.file, s = f.masked;
    const add = (name, params, nameIdx, open) => {
      if (open < c.open || open > c.close) return;
      // only methods whose innermost class is this one
      if (c.inner.some((n) => { const ic = this.classes[n]; return open > ic.open && open < ic.close; })) return;
      const close = matchClose(s, open);
      c.methods.push({ name, params, start: nameIdx, open, close, cls: c.name });
    };
    if (f.kotlin) {
      const re = /\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/g;
      let m;
      re.lastIndex = c.open;
      while ((m = re.exec(s)) && m.index < c.close) {
        const p = m.index + m[0].length - 1, pc = matchClose(s, p);
        let j = skipWs(s, pc + 1);
        if (s[j] === ":") { while (j < s.length && !/[{=\n]/.test(s[j])) j++; j = skipWs(s, j); }
        const params = s.slice(p + 1, pc).split(",").map((x) => x.split(":")[0].trim().split(/\s+/).pop()).filter(Boolean);
        if (s[j] === "{") add(m[1], params, m.index, j);
      }
    } else {
      const re = /([\w>\]])\s+(\w+)\s*\(/g;
      let m;
      re.lastIndex = c.open;
      while ((m = re.exec(s)) && m.index < c.close) {
        const name = m[2];
        if (KEYWORDS.has(name)) continue;
        const before = s.slice(Math.max(0, m.index - 30), m.index + 1).match(/(\w+)\s*$/);
        if (before && /^(new|return|else|throw|case|yield)$/.test(before[1])) continue;
        const p = m.index + m[0].length - 1, pc = matchClose(s, p);
        let j = skipWs(s, pc + 1);
        if (s.startsWith("throws", j)) { while (j < s.length && s[j] !== "{" && s[j] !== ";") j++; }
        if (s[j] !== "{") continue;
        const params = s.slice(p + 1, pc).split(",").map((x) => x.trim().split(/\s+/).pop()).filter(Boolean);
        add(name, params, m.index + m[0].indexOf(name), j);
      }
    }
  }

  methodAt(c, idx) {
    return c.methods.filter((m) => idx > m.open && idx < m.close).sort((a, b) => b.open - a.open)[0];
  }

  findMethod(clsName, name, seen = new Set()) {
    const c = this.classes[clsName];
    if (!c || seen.has(clsName)) return null;
    seen.add(clsName);
    const own = c.methods.filter((m) => m.name === name)
      .sort((a, b) => this.depthOf(c, a) - this.depthOf(c, b))[0];
    if (own) return own;
    return (c.superName && this.findMethod(c.superName, name, seen)) || (c.outer && this.findMethod(c.outer, name, seen)) || null;
  }

  // how many methods enclose this one (0 = a class member)
  depthOf(c, m) { return c.methods.filter((o) => o !== m && o.open < m.open && o.close > m.close).length; }

  // ---------------------------------------------------------------- which layout each class shows

  findLayouts(c) {
    const s = c.file.masked.slice(c.open, c.close);
    const header = c.header || "";
    const own = s.match(/setContentView\s*\(\s*(?:this\s*,\s*)?(?:[\w.]*\.)?R\.layout\.(\w+)/)
      || s.match(/(\w+)Binding\s*\.\s*inflate\s*\(/) && { 1: snakeCase(s.match(/(\w+)Binding\s*\.\s*inflate\s*\(/)[1]) }
      || header.match(/\(\s*R\.layout\.(\w+)\s*\)/)
      || s.match(/super\s*\(\s*R\.layout\.(\w+)/);
    c.layout = own && this.res.files.layout[own[1]] ? own[1] : null;
    if (!c.layout && (c.kind === "fragment" || c.kind === "dialog")) {
      const onCreateView = c.methods.find((m) => m.name === "onCreateView" || m.name === "onCreateDialog");
      const span = onCreateView ? c.file.masked.slice(onCreateView.open, onCreateView.close) : s;
      const inf = span.match(/R\.layout\.(\w+)/) || (span.match(/(\w+)Binding\s*\.\s*inflate/) && { 1: snakeCase(span.match(/(\w+)Binding\s*\.\s*inflate/)[1]) });
      if (inf && this.res.files.layout[inf[1]]) c.layout = inf[1];
    }
    // list rows: layouts inflated by adapters (getView / onCreateViewHolder) or adapter classes
    c.itemLayouts = [];
    for (const m of c.methods) {
      if (!/^(getView|onCreateViewHolder|newView|getChildView|getGroupView|getDropDownView)$/.test(m.name) && c.kind !== "adapter") continue;
      const body = c.file.masked.slice(m.open, m.close);
      for (const x of body.matchAll(/R\.layout\.(\w+)|(\w+)Binding\s*\.\s*inflate/g)) {
        const name = x[1] || snakeCase(x[2]);
        if (this.res.files.layout[name] && !c.itemLayouts.includes(name)) c.itemLayouts.push(name);
      }
    }
    if (c.kind === "adapter" && !c.itemLayouts.length) {
      const ctor = s.match(/super\s*\([^;]*R\.layout\.(\w+)/);
      if (ctor && this.res.files.layout[ctor[1]]) c.itemLayouts.push(ctor[1]);
    }
  }

  // ---------------------------------------------------------------- navigation graphs

  findNavGraphs() {
    this.navDest = {};    // destination or action id -> class name
    this.navStart = {};   // graph name -> start class
    for (const name of Object.keys(this.res.files.navigation)) {
      const doc = this.res.doc("navigation", name);
      if (!doc) continue;
      const destClass = {};
      for (const el of doc.getElementsByTagName("*")) {
        const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
        const cls = (el.getAttribute("android:name") || "").split(".").pop();
        if (id && cls && el.tagName !== "action") { destClass[id] = cls; this.navDest[id] = cls; }
      }
      for (const a of doc.getElementsByTagName("action")) {
        const id = (a.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
        const dest = (a.getAttribute("app:destination") || "").replace(/^@\+?id\//, "");
        if (id && destClass[dest]) this.navDest[id] = destClass[dest];
        else if (id && dest && this.navDest[dest]) this.navDest[id] = this.navDest[dest];
      }
      const start = (doc.documentElement.getAttribute("app:startDestination") || "").replace(/^@\+?id\//, "");
      if (destClass[start]) this.navStart[name] = destClass[start];
    }
  }

  // ---------------------------------------------------------------- fragment hosts

  findHosts() {
    this.hostOf = {};       // fragment -> { host, container }
    const screens = (k) => Object.values(this.classes).filter((c) => k.includes(c.kind));
    const setHost = (frag, host, container) => {
      if (!this.hostOf[frag] && frag !== host) this.hostOf[frag] = { host, container };
    };
    // fragments declared in a layout (<fragment android:name>, FragmentContainerView, NavHostFragment)
    for (const c of screens(["activity", "fragment"])) {
      if (!c.layout) continue;
      for (const el of this.layoutElements(c.layout)) {
        const tag = el.tagName.split(".").pop();
        if (tag !== "fragment" && tag !== "FragmentContainerView") continue;
        const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
        const cls = (el.getAttribute("android:name") || el.getAttribute("class") || "").split(".").pop();
        if (cls === "NavHostFragment") {
          const graph = (el.getAttribute("app:navGraph") || "").replace("@navigation/", "");
          const doc = this.res.doc("navigation", graph);
          if (doc) for (const d of doc.getElementsByTagName("fragment")) setHost((d.getAttribute("android:name") || "").split(".").pop(), c.name, id);
        } else if (this.classes[cls]) setHost(cls, c.name, id);
      }
    }
    // fragment transactions: .replace(R.id.container, new XFragment())
    const passes = 3;  // fragments that open fragments inherit their host
    for (let p = 0; p < passes; p++) {
      for (const c of screens(["activity", "fragment", "dialog"])) {
        const s = c.file.masked.slice(c.open, c.close);
        for (const m of s.matchAll(/\.\s*(?:replace|add)\s*\(\s*(?:android\.)?R\.id\.(\w+)\s*,\s*(?:new\s+)?(\w+)/g)) {
          let target = m[2];
          if (!this.classes[target] || this.classes[target].kind !== "fragment") {
            // .replace(R.id.c, fragment) - look for the fragment class created in the same method
            const meth = this.methodAt(c, c.open + m.index);
            const body = meth ? c.file.masked.slice(meth.open, meth.close) : "";
            const made = [...body.matchAll(/\bnew\s+(\w+)\s*\(|\b(\w+)\s*\.\s*newInstance\s*\(/g)].map((x) => x[1] || x[2]).filter((n) => this.classes[n]?.kind === "fragment");
            for (const t of made) setHost(t, c.kind === "activity" ? c.name : (this.hostOf[c.name]?.host || c.name), m[1]);
            continue;
          }
          const host = c.kind === "activity" || /getChildFragmentManager|childFragmentManager/.test(s) ? c.name : this.hostOf[c.name]?.host;
          if (host) setHost(target, host, m[1]);
        }
      }
    }
  }

  layoutElements(name, seen = new Set()) {
    const doc = this.res.doc("layout", name);
    if (!doc || seen.has(name)) return [];
    seen.add(name);
    const out = [];
    for (const el of doc.getElementsByTagName("*")) {
      out.push(el);
      if (el.tagName === "include") out.push(...this.layoutElements((el.getAttribute("layout") || "").replace("@layout/", ""), seen));
    }
    return out;
  }

  // ids visible on a screen: its layout, its includes, plus the host's layout for fragments
  screenIds(c) {
    const ids = new Set();
    const add = (layout) => { for (const el of this.layoutElements(layout)) { const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, ""); if (id) ids.add(id); } };
    if (c.layout) add(c.layout);
    const host = this.hostOf[c.name];
    if (host && this.classes[host.host]?.layout) add(this.classes[host.host].layout);
    for (const l of c.itemLayouts || []) add(l);
    return ids;
  }

  callCounts() {
    const counts = {};
    for (const f of this.files) for (const m of f.masked.matchAll(/(\w+)\s*\(/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    this.calls = counts;  // a method name seen only once (its own declaration) is never called by the app
  }

  // ---------------------------------------------------------------- what a piece of code does

  // Effects (navigation, messages, API calls...) of code in [start, end) of class c, following
  // calls into the app's own methods. `exclude` = spans that belong to someone else (click handlers).
  effects(c, start, end, opts = {}) {
    const { depth = 0, exclude = [], visited = new Set(), argLiteral = null } = opts;
    const f = c.file, s = f.masked, k = f.comments;
    const out = [];
    const skip = (i) => exclude.some(([a, b]) => i >= a && i < b);
    const cond = this.conditions(c, start, end);
    const condAt = (i) => cond.filter((x) => i >= x.from && i < x.to).sort((a, b) => a.from - b.from).map((x) => x.text);
    const push = (i, e) => { if (!skip(i)) out.push({ ...e, at: i, cond: condAt(i) }); };
    const span = s.slice(start, end);
    const screenNames = Object.values(this.classes).filter((x) => ["activity", "fragment", "dialog"].includes(x.kind)).map((x) => x.name);

    // navigation by class reference: X.class, X::class, new X(), X.newInstance()
    for (const name of screenNames) {
      if (name === c.name) continue;
      const re = new RegExp(`(\\bnew\\s+)?\\b${name}\\b(\\s*(?:\\.\\s*class|::\\s*class|\\.\\s*newInstance\\s*\\(|\\(\\s*))`, "g");
      for (const m of span.matchAll(re)) {
        const at = start + m.index;
        const before = s.slice(Math.max(0, at - 12), at);
        if (/[.:]\s*$/.test(before) || /\b(fun|class|object)\s+$/.test(before)) continue;
        if (/\(\s*$/.test(m[2]) && !m[1] && !f.kotlin) continue;  // Java call that isn't a constructor
        push(at, { type: "nav", to: name });
      }
    }
    // navigation component
    for (const m of span.matchAll(/\bnavigate\s*\(\s*(?:R\.id\.(\w+)|(\w+)Directions\s*\.\s*(\w+)\s*\()/g)) {
      const id = m[1] || snakeCase(m[3]);
      const to = this.navDest[id];
      if (to) push(start + m.index, { type: "nav", to });
    }
    for (const m of span.matchAll(/\b(finish|finishAffinity|onBackPressed|popBackStack|navigateUp|dismiss|dismissAllowingStateLoss)\s*\(\s*\)/g)) {
      push(start + m.index, { type: "back", how: m[1] });
    }
    // dialogs built from a layout, or AlertDialog builders
    for (const m of span.matchAll(/R\.layout\.(\w+)/g)) {
      const name = m[1];
      if (name === c.layout || (c.itemLayouts || []).includes(name) || !this.res.files.layout[name]) continue;
      const near = s.slice(start + m.index - 200, start + m.index + 200);
      if (/Dialog|setView|setContentView|BottomSheet|PopupWindow/.test(near) || /^(dialog|popup|sheet|bottom_sheet)/.test(name)) push(start + m.index, { type: "dialog", layout: name });
    }
    for (const m of span.matchAll(/\b(AlertDialog\s*\.\s*Builder|MaterialAlertDialogBuilder)\b/g)) {
      const at = start + m.index;
      const title = k.slice(at, Math.min(end, at + 600)).match(/setTitle\s*\(\s*("(?:[^"\\]|\\.)*"|R\.string\.\w+)/);
      push(at, { type: "alert", title: title ? this.literal(title[1]) : null });
    }
    // messages
    for (const m of span.matchAll(/\b(Toast\s*\.\s*makeText|Snackbar\s*\.\s*make)\s*\(/g)) {
      const at = start + m.index, open = at + m[0].length - 1;
      const arg = this.splitArgs(f, open)[1] || "";
      const known = /^\s*("|R\.string|getString)/.test(arg);
      push(at, { type: "toast", text: known ? this.literal(arg) : "", error: !known && /[Ee]xception|getMessage|error/i.test(arg) });
    }
    // known APIs
    const api = (re, text) => { for (const m of span.matchAll(re)) push(start + m.index, { type: "api", text: typeof text === "function" ? text(m, start + m.index) : text }); };
    api(/\bsignInWithEmailAndPassword\b/g, "Signs in with email and password (Firebase)");
    api(/\bcreateUserWithEmailAndPassword\b/g, "Creates an account (Firebase)");
    api(/\bsendPasswordResetEmail\b/g, "Sends a password-reset email");
    api(/\bsignInWithCredential\b|\bGoogleSignIn\b/g, "Signs in with Google");
    api(/\.\s*signOut\s*\(/g, "Signs the user out");
    api(/\.\s*collection\s*\(/g, (m, at) => {
      const name = k.slice(at, at + 80).match(/collection\s*\(\s*"([^"]*)"/);
      const rest = s.slice(at, Math.min(end, at + 400));
      const verb = /\.\s*(set|update|add)\s*\(/.test(rest) ? "Saves to" : /\.\s*delete\s*\(/.test(rest) ? "Deletes from" : "Reads from";
      return `${verb} Firestore${name ? ` “${name[1]}”` : ""}`;
    });
    api(/\bgetSharedPreferences\b|\bPreferenceManager\s*\.\s*getDefaultSharedPreferences\b/g, (m, at) => /\.\s*edit\s*\(/.test(s.slice(at, Math.min(end, at + 300))) ? "Saves settings on the device" : "Reads saved settings");
    api(/\bgenerativelanguage\b|\bgenerateContent\b|\bGenerativeModel\b/g, "Asks the Gemini AI");
    api(/\bnewCall\s*\(|\bHttpURLConnection\b|\.\s*enqueue\s*\(/g, "Makes a network request");
    api(/\bMediaPlayer\s*\.\s*create\b|\bnew\s+MediaPlayer\b|\bSoundPool\b/g, "Plays a sound");
    api(/\bIntent\s*\.\s*ACTION_VIEW\b/g, (m, at) => {
      const url = k.slice(Math.max(start, at - 300), Math.min(end, at + 300)).match(/Uri\s*\.\s*parse\s*\(\s*"([^"]*)"/);
      return url ? `Opens ${url[1]}` : "Opens a link";
    });
    api(/\bIntent\s*\.\s*ACTION_SEND\b/g, "Opens the share sheet");
    api(/\bIntent\s*\.\s*ACTION_(DIAL|CALL)\b/g, "Opens the phone dialer");
    api(/\bACTION_IMAGE_CAPTURE\b/g, "Opens the camera");
    api(/\bACTION_(GET_CONTENT|PICK|OPEN_DOCUMENT)\b|\bPickVisualMedia\b/g, "Lets the user pick a file or photo");
    api(/\brequestPermissions\b|\bRequestPermission\b/g, "Asks for a permission");
    for (const m of span.matchAll(/([\w.]+?)\s*\.\s*setVisibility\s*\(\s*(?:View\s*\.\s*)?(VISIBLE|GONE|INVISIBLE)\s*\)|([\w.]+?)\s*\.\s*(?:visibility|isVisible)\s*=\s*(?:View\s*\.\s*)?(VISIBLE|GONE|INVISIBLE|true|false)\b/g)) {
      const who = (m[1] || m[3]).split(".").pop();
      const show = /VISIBLE|true/.test(m[2] || m[4]) && !/INVISIBLE/.test(m[2] || m[4]);
      push(start + m.index, { type: "visibility", text: `${show ? "Shows" : "Hides"} ${this.varLabel(c, who)}` });
    }

    // the app's own methods called from here (followed a few levels deep)
    if (depth < 4) {
      for (const call of this.callsIn(c, start, end)) {
        if (skip(call.at)) continue;
        const key = `${call.cls}.${call.method.name}:${call.arg ?? ""}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const owner = this.classes[call.cls];
        let [a, b] = [call.method.open, call.method.close];
        const branch = call.arg != null ? this.branch(owner, call.method, call.arg) : null;
        if (branch) [a, b] = branch;
        const inner = this.effects(owner, a, b, { depth: depth + 1, visited, exclude: this.listenerSpans(owner).map((x) => x.span) });
        const here = condAt(call.at);
        if (depth === 0 && !/^on[A-Z]/.test(call.method.name) && (inner.length || !/^(get|is|has|set|init|setup|find|bind|show|update|load|highlight)/.test(call.method.name))) {
          out.push({ type: "call", name: call.method.name + "(" + (call.arg ?? "") + ")", at: call.at, cond: here, cls: call.cls });
        }
        for (const e of inner) out.push({ ...e, at: call.at + (e.at - a) / 1e6, cond: [...here, ...e.cond], via: e.via || call.method.name });
      }
    }
    return out.sort((x, y) => x.at - y.at);
  }

  // `if (...) { }` / `else { }` / callbacks inside [start, end) -> [{from, to, text}]
  conditions(c, start, end) {
    const f = c.file, s = f.masked, out = [];
    const re = /\b(if|else)\b/g;
    re.lastIndex = start;
    let m;
    const ifs = [];
    while ((m = re.exec(s)) && m.index < end) {
      let j = skipWs(s, m.index + m[0].length), text;
      if (m[1] === "if") {
        if (s[j] !== "(") continue;
        const pc = matchClose(s, j);
        text = "if " + f.text.slice(j + 1, pc).replace(/\s+/g, " ").trim();
        j = skipWs(s, pc + 1);
      } else {
        if (s.startsWith("if", j)) continue;
        // the `if` this else belongs to is the one whose block ends right before it
        const own = ifs.filter((x) => x.to < m.index && !s.slice(x.to + 1, m.index).trim()).pop();
        text = own ? `if ${negate(own.text.slice(3))}` : "otherwise";
      }
      const to = s[j] === "{" ? matchClose(s, j) : (s.indexOf(";", j) >= 0 ? s.indexOf(";", j) : end);
      out.push({ from: j, to, text });
      if (m[1] === "if") ifs.push({ to, text });
    }
    // async callbacks: effects inside them happen "after" something
    const cb = /\.\s*(addOn(Success|Complete|Failure)Listener|enqueue|observe|setPositiveButton|setNegativeButton|setNeutralButton|postDelayed)\s*\(/g;
    cb.lastIndex = start;
    while ((m = cb.exec(s)) && m.index < end) {
      const open = m.index + m[0].length - 1;
      let close = matchClose(s, open);
      const trail = skipWs(s, close + 1);
      if (f.kotlin && s[trail] === "{") close = matchClose(s, trail);  // .setPositiveButton("OK") { ... }
      // success callbacks just mean "then" - only failures and dialog buttons are worth saying
      if (/^(addOnSuccessListener|addOnCompleteListener|enqueue|observe)$/.test(m[1])) continue;
      let text = { addOnFailureListener: "if it fails", postDelayed: "after a delay" }[m[1]];
      if (!text) {
        const btn = this.splitArgs(f, open)[0];
        text = `when the dialog's ${btn ? `“${this.literal(btn)}”` : "button"} is tapped`;
      }
      out.push({ from: open, to: close, text });
    }
    for (const meth of c.methods) {
      if (meth.open < start || meth.close > end) continue;
      const t = { onFailure: "if it fails", onError: "if it fails", onCancelled: "if it's cancelled", onFinish: "when the timer ends" }[meth.name];
      if (t) out.push({ from: meth.open, to: meth.close, text: t });
    }
    // dedupe callbacks found twice (listener call + its method)
    return out.filter((x, i) => !out.some((y, j) => j < i && y.text === x.text && Math.abs(y.from - x.from) < 200 && y.to >= x.to - 5));
  }

  // calls to the app's own methods in [start, end) -> [{at, cls, method, arg}]
  callsIn(c, start, end) {
    const f = c.file, s = f.masked, out = [];
    const re = /(\(\s*\(\s*(\w+)\s*\)\s*[\w.]+\s*\(\s*\)\s*\)|\(\s*[\w.]+(?:\s*\(\s*\))?\s+as\??\s+(\w+)\s*\)|\b(\w+))?\s*(\??\.)?\s*\b(\w+)\s*\(/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(s)) && m.index < end) {
      const name = m[6];
      const at = m.index + m[0].length - name.length - 1;
      if (KEYWORDS.has(name)) continue;
      const prev = s.slice(Math.max(0, m.index - 6), m.index + (m[1] ? 0 : m[0].indexOf(name)));
      if (/\bnew\s+$/.test(prev) || /\bfun\s+$/.test(prev)) continue;
      let cls = null;
      const castCls = m[2] || m[3];
      const recv = m[4];
      // "void foo(" / "new Foo(" / "String foo(" are declarations or constructors, not calls
      if (recv && !m[5] && !/^(return|throw|else|case|yield|await|do)$/.test(recv)) continue;
      const parenAt = s.indexOf("(", at + name.length);
      const after = skipWs(s, matchClose(s, parenAt) + 1);
      if (!f.kotlin && s[after] === "{" && !castCls) continue;
      if (castCls) cls = castCls;
      else if (m[5] && recv) {
        if (recv === "this") cls = c.name;
        else if (this.classes[recv]) cls = recv;
        else if (/^(getActivity|requireActivity|activity|getParentFragment|requireParentFragment)$/.test(recv)) cls = this.hostOf[c.name]?.host;
        else cls = this.varType(c, recv);
      } else if (!m[5]) cls = c.name;
      if (!cls) continue;
      const method = this.findMethod(cls, name);
      if (!method) continue;
      if (this.classes[method.cls].file === f && method.open <= at && method.close >= at) continue;  // recursion into itself
      const open = s.indexOf("(", at + name.length);
      const args = this.splitArgs(f, open);
      const arg = args.length === 1 && /^-?\d+$/.test(args[0].trim()) ? args[0].trim() : null;
      out.push({ at, cls: method.cls, method, arg });
      re.lastIndex = Math.max(re.lastIndex, at + name.length);
    }
    return out;
  }

  // declared type of a variable/field, if it's one of the app's classes
  varType(c, v) {
    const s = c.file.masked;
    const m = s.match(new RegExp(`\\b(\\w+)\\s+${v}\\s*[=;,)]`)) || s.match(new RegExp(`\\b${v}\\s*:\\s*(\\w+)`))
      || s.match(new RegExp(`\\b${v}\\s*=\\s*\\(\\s*(\\w+)\\s*\\)`)) || s.match(new RegExp(`\\b${v}\\s*=\\s*[^;\\n]*\\bas\\??\\s+(\\w+)`));
    return m && this.classes[m[1]] ? m[1] : null;
  }

  // Part of `method` that runs when its (single) parameter equals `arg`: if (p == 3) {...} / case 3: / 3 ->
  branch(c, method, arg) {
    const p = method.params[0];
    if (!p || method.params.length !== 1) return null;
    const s = c.file.masked, body = s.slice(method.open, method.close);
    let m = body.match(new RegExp(`\\bif\\s*\\(\\s*${p}\\s*==\\s*${arg}\\s*\\)\\s*\\{`));
    if (m) { const o = method.open + m.index + m[0].length - 1; return [o, matchClose(s, o)]; }
    m = body.match(new RegExp(`\\bcase\\s+${arg}\\s*:`));
    if (m) {
      const from = method.open + m.index + m[0].length;
      const next = s.slice(from, method.close).search(/\bcase\b|\bdefault\b/);
      return [from, next < 0 ? method.close : from + next];
    }
    m = body.match(new RegExp(`(?:^|\\n)\\s*${arg}\\s*->\\s*`));
    if (m) {
      const from = method.open + m.index + m[0].length;
      if (s[from] === "{") return [from, matchClose(s, from)];
      const nl = s.indexOf("\n", from);
      return [from, nl < 0 ? method.close : nl];
    }
    return null;
  }

  // Splits the arguments of the call whose "(" is at `open` -> raw source strings.
  splitArgs(f, open) {
    const s = f.masked, close = matchClose(s, open), out = [];
    let depth = 0, from = open + 1;
    for (let i = open + 1; i < close; i++) {
      if ("({[".includes(s[i])) depth++;
      else if (")}]".includes(s[i])) depth--;
      else if (s[i] === "," && depth === 0) { out.push(f.text.slice(from, i)); from = i + 1; }
    }
    const last = f.text.slice(from, close);
    if (last.trim() || out.length) out.push(last);
    return out.map((x) => x.trim());
  }

  // "\"Saved\"" -> Saved, R.string.x -> its text, other expressions as written
  literal(expr) {
    expr = expr.trim();
    const str = expr.match(/^"((?:[^"\\]|\\.)*)"/);
    if (str) return cleanString(str[1]) + (expr.length > str[0].length ? "…" : "");
    const r = expr.match(/R\.string\.(\w+)/);
    if (r) return this.res.string(`@string/${r[1]}`) || r[1];
    return expr.replace(/\s+/g, " ").slice(0, 60);
  }

  varLabel(c, v) {
    const id = this.viewVars(c)[v];
    return id ? this.label(id, c.name) : v;
  }

  // ---------------------------------------------------------------- click handlers

  // variable -> view id, from findViewById assignments
  viewVars(c) {
    if (c._vars) return c._vars;
    const vars = {};
    const scan = (cls) => {
      const s = cls.file.masked.slice(cls.open, cls.close);
      for (const m of s.matchAll(/(\w+)\s*(?::\s*[\w.<>?]+\s*)?(?:=|by\s+lazy\s*\{)\s*(?:\(\s*[\w.<>]+\s*\)\s*)?(?:[\w().?!]+?\.)?findViewById\s*(?:<[^>]*>)?\s*\(\s*(?:android\.)?R\.id\.(\w+)\s*\)/g)) {
        if (!vars[m[1]]) vars[m[1]] = m[2];
      }
      // arrays of views: tiles = new View[]{ findViewById(R.id.a), ... } / int[] ids = {R.id.a, ...}
      for (const m of s.matchAll(/(\w+)\s*=\s*(?:new\s+[\w.]+\s*\[\s*\]\s*)?\{([^{}]*R\.id\.[^{}]*)\}/g)) {
        vars[m[1] + "[]"] = [...m[2].matchAll(/R\.id\.(\w+)/g)].map((x) => x[1]);
      }
    };
    scan(c);
    if (c.outer && this.classes[c.outer]) scan(this.classes[c.outer]);
    c._vars = vars;
    return vars;
  }

  // receiver expression -> view ids it refers to
  receiverIds(c, recv, layoutIds) {
    recv = recv.replace(/\s+/g, "").replace(/[!?]/g, "");
    const direct = [...recv.matchAll(/R\.id\.(\w+)/g)].map((m) => m[1]);
    if (direct.length) return direct;
    const vars = this.viewVars(c);
    const arr = recv.match(/^(?:this\.)?(\w+)\[[^\]]+\]$/);
    if (arr) {
      if (Array.isArray(vars[arr[1] + "[]"])) return vars[arr[1] + "[]"];
      // tiles[i] = view.findViewById(ids[i]) / tiles[i] filled in a loop from another array
      const fill = c.file.masked.slice(c.open, c.close).match(new RegExp(`${arr[1]}\\s*\\[[^\\]]+\\]\\s*=\\s*[^;]*findViewById\\s*\\(\\s*(\\w+)\\s*\\[`));
      if (fill && Array.isArray(vars[fill[1] + "[]"])) return vars[fill[1] + "[]"];
      return [];
    }
    const last = recv.split(".").pop();
    const plain = recv.replace(/^this\./, "");
    if (vars[plain] && !Array.isArray(vars[plain])) return [vars[plain]];
    // view binding (binding.saveButton) / Kotlin synthetics (save_button): match an id by name
    const n = norm(last);
    const hit = [...layoutIds].find((id) => norm(id) === n);
    return hit ? [hit] : [];
  }

  // every setOn...Listener in class c -> [{ recv, method, span:[a,b], body:[a,b], at }]
  listenerSpans(c) {
    if (c._listeners) return c._listeners;
    const f = c.file, s = f.masked, out = [];
    const re = new RegExp(`\\.\\s*(${LISTENER_METHODS})\\s*([({])`, "g");
    re.lastIndex = c.open;
    let m;
    while ((m = re.exec(s)) && m.index < c.close) {
      const dot = m.index;
      const recv = this.receiverBefore(f, dot);
      const open = m.index + m[0].length - 1;
      const close = matchClose(s, open);
      const body = this.listenerBody(c, open, close);
      out.push({ recv, method: m[1], span: [open, close + 1], body, at: dot });
    }
    c._listeners = out;
    return out;
  }

  receiverBefore(f, dot) {
    const s = f.masked;
    let j = dot - 1;
    while (j >= 0 && /\s/.test(s[j])) j--;
    const end = j + 1;
    for (;;) {
      if (j < 0) break;
      if (s[j] === ")" || s[j] === "]") { j = matchOpen(s, j) - 1; while (j >= 0 && /\s/.test(s[j])) j--; continue; }
      if (s[j] === "!" || s[j] === "?") { j--; continue; }
      if (/\w/.test(s[j])) {
        while (j >= 0 && /\w/.test(s[j])) j--;
        let k = j;
        while (k >= 0 && /\s/.test(s[k])) k--;
        if (s[k] === "." || (s[k] === "?" && s[k + 1] === ".")) { j = k - 1; while (j >= 0 && /[\s?]/.test(s[j])) j--; continue; }
        break;
      }
      break;
    }
    return f.text.slice(j + 1, end).trim();
  }

  // the code that runs, inside a listener argument at [open, close]
  listenerBody(c, open, close) {
    const f = c.file, s = f.masked;
    if (s[open] === "{") return [open + 1, close];            // Kotlin trailing lambda
    const arg = s.slice(open + 1, close);
    const t = arg.trim(), lead = open + 1 + arg.indexOf(t);
    if (/^new\b/.test(t) || /^object\s*:/.test(t)) {             // anonymous class
      const meth = c.methods.find((x) => x.open > lead && x.close <= close);
      return meth ? [meth.open + 1, meth.close] : [lead, close];
    }
    if (t.startsWith("{")) return [lead + 1, matchClose(s, lead)];
    const arrow = t.match(/^\(?[\w\s,:]*\)?\s*->\s*/);
    if (arrow) {
      const b = lead + arrow[0].length;
      return s[b] === "{" ? [b + 1, matchClose(s, b)] : [b, close];
    }
    const ref = t.match(/^(?:this)?::(\w+)$/) || t.match(/^this::(\w+)$/);
    if (ref) { const meth = this.findMethod(c.name, ref[1]); if (meth) return [meth.open + 1, meth.close, meth.cls]; }
    if (t === "this") {
      const meth = ["onClick", "onItemClick", "onNavigationItemSelected", "onMenuItemClick", "onCheckedChanged", "onLongClick"].map((n) => this.findMethod(c.name, n)).find(Boolean);
      if (meth) return [meth.open + 1, meth.close, meth.cls];
    }
    if (/^\w+$/.test(t)) {                                        // listener stored in a variable
      const def = s.slice(c.open, c.close).match(new RegExp(`\\b${t}\\s*=\\s*(new\\b|object\\s*:|View\\.OnClickListener\\s*\\{|\\{)`));
      if (def) {
        const from = c.open + def.index + def[0].length;
        const meth = c.methods.find((x) => x.open > from - 1 && x.open < from + 200);
        if (meth) return [meth.open + 1, meth.close];
      }
    }
    return [lead, close];
  }

  // Bodies that branch on the view / menu item id -> { id: [a, b] }
  splitById(c, a, b) {
    const s = c.file.masked, body = s.slice(a, b), out = {};
    for (const m of body.matchAll(/\bcase\s+(?:android\.)?R\.id\.(\w+)\s*:/g)) {
      const from = a + m.index + m[0].length;
      const next = s.slice(from, b).search(/\bcase\b|\bdefault\b/);
      out[m[1]] = [from, next < 0 ? b : from + next];
    }
    for (const m of body.matchAll(/\bif\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\{/g)) {
      const ids = [...m[1].matchAll(/==\s*(?:android\.)?R\.id\.(\w+)|R\.id\.(\w+)\s*==/g)].map((x) => x[1] || x[2]);
      if (!ids.length) continue;
      const o = a + m.index + m[0].length - 1;
      for (const id of ids) out[id] = [o + 1, matchClose(s, o)];
    }
    for (const m of body.matchAll(/(?:^|\n)\s*((?:R\.id\.\w+\s*,\s*)*R\.id\.\w+)\s*->\s*/g)) {
      const from = a + m.index + m[0].length;
      const to = s[from] === "{" ? matchClose(s, from) : (s.indexOf("\n", from) < 0 ? b : s.indexOf("\n", from));
      for (const x of m[1].matchAll(/R\.id\.(\w+)/g)) out[x[1]] = [from, to];
    }
    return out;
  }

  handlers(c) {
    const ids = this.screenIds(c);
    const out = [];
    const listeners = this.listenerSpans(c);
    const exclude = listeners.map((l) => l.span);
    for (const l of listeners) {
      const [a, b, owner] = l.body;
      const ownerCls = owner ? this.classes[owner] : c;
      const event = { setOnClickListener: "tap", setOnLongClickListener: "long press", setOnItemClickListener: "row tap", setOnCheckedChangeListener: "toggle", setNavigationOnClickListener: "tap", setOnEditorActionListener: "keyboard action" }[l.method] || "select";
      let targets = this.receiverIds(c, l.recv, ids);
      let label = null;
      if (l.method === "setNavigationOnClickListener") label = "Toolbar back arrow";
      if (!targets.length && ROW_RECEIVERS.test(l.recv.replace(/\s/g, ""))) label = "List row";
      const split = this.splitById(ownerCls, a, b);
      const make = (id, x, y, lbl) => ({
        id, label: lbl || (l.method === "setNavigationOnClickListener" ? "Toolbar back arrow" : id ? this.label(id, c.name) : label || l.recv), event,
        file: ownerCls.file.path, line: ownerCls.file.line(x), code: this.snippet(ownerCls.file, x, y),
        effects: this.effects(ownerCls, x, y, { exclude: exclude.filter(([p, q]) => p > x && q < y) }),
      });
      if (Object.keys(split).length) {
        for (const [id, [x, y]] of Object.entries(split)) out.push(make(id, x, y));
      } else if (targets.length) {
        for (const id of targets) out.push(make(id, a, b));
      } else {
        out.push(make(null, a, b, label || `${l.recv || "view"} (${event})`));
      }
    }
    // android:onClick="method" in the layout (calls the activity's method)
    const layouts = [c.layout, this.hostOf[c.name] && this.classes[this.hostOf[c.name].host]?.layout].filter(Boolean);
    for (const layout of layouts) {
      for (const el of this.layoutElements(layout)) {
        const fn = el.getAttribute("android:onClick");
        if (!fn) continue;
        const id = (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "") || null;
        const host = c.kind === "activity" ? c.name : this.hostOf[c.name]?.host;
        const meth = host && this.findMethod(host, fn);
        if (!meth) continue;
        const cls = this.classes[meth.cls];
        if (out.some((h) => h.id === id && h.xml)) continue;
        out.push({ id, xml: true, label: id ? this.label(id, c.name) : fn, event: "tap", file: cls.file.path, line: cls.file.line(meth.open),
          code: this.snippet(cls.file, meth.start, meth.close + 1), effects: this.effects(cls, meth.open, meth.close) });
      }
    }
    // bottom navigation wired to a nav graph: each menu item opens the destination with the same id
    if (/setupWithNavController/.test(c.file.masked.slice(c.open, c.close)) && c.layout) {
      for (const el of this.layoutElements(c.layout)) {
        const menu = (el.getAttribute("app:menu") || "").replace("@menu/", "");
        const doc = menu && this.res.doc("menu", menu);
        if (!doc) continue;
        for (const it of doc.getElementsByTagName("item")) {
          const id = (it.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
          if (id && this.navDest[id] && !out.some((h) => h.id === id)) {
            out.push({ id, label: this.label(id, c.name), event: "tap", file: c.file.path, line: 0, code: "", effects: [{ type: "nav", to: this.navDest[id], cond: [], at: 0 }] });
          }
        }
      }
    }
    return out;
  }

  // Things that happen without a tap: in onCreate etc., and the system back button.
  automatic(c) {
    // click handlers and back callbacks defined inside onCreate don't run when it opens
    const exclude = [...this.listenerSpans(c).map((l) => l.span),
      ...c.methods.filter((m) => this.depthOf(c, m) > 0 && /^(handleOnBackPressed|onClick|onLongClick|onItemClick|onItemSelected|onCheckedChanged|onNavigationItemSelected|onTextChanged|afterTextChanged|beforeTextChanged|onProgressChanged|onStartTrackingTouch|onStopTrackingTouch|onEditorAction)$/.test(m.name)).map((m) => [m.open, m.close])];
    const out = [];
    const xmlClicks = new Set(this.layoutElements(c.layout || "").map((el) => el.getAttribute("android:onClick")).filter(Boolean));
    const members = c.methods.filter((m) => this.depthOf(c, m) === 0 && !xmlClicks.has(m.name));
    for (const m of members) {
      const back = /^(onBackPressed|handleOnBackPressed)$/.test(m.name);
      const entry = back || (this.calls[m.name] || 0) <= 1 || /^on[A-Z]/.test(m.name);
      if (!entry || /^(onClick|onItemClick|onCheckedChanged|onNavigationItemSelected|onLongClick|getView|onCreateViewHolder|onBindViewHolder)$/.test(m.name)) continue;
      const effects = this.effects(c, m.open, m.close, { exclude }).filter((e) => ["nav", "dialog", "back"].includes(e.type));
      if (!effects.length) continue;
      out.push({ trigger: back ? "System back button" : { onCreate: "When it opens", onCreateView: "When it opens", onViewCreated: "When it opens", onStart: "When it opens", onResume: "Each time it's shown" }[m.name] || `In ${m.name}()`,
        method: m.name, back, file: c.file.path, line: c.file.line(m.open), code: this.snippet(c.file, m.start, m.close + 1), effects });
    }
    // OnBackPressedCallback inside onCreate
    for (const m of c.methods.filter((x) => x.name === "handleOnBackPressed" && this.depthOf(c, x) > 0)) {
      const effects = this.effects(c, m.open, m.close).filter((e) => ["nav", "dialog", "back"].includes(e.type));
      if (effects.length) out.push({ trigger: "System back button", method: m.name, back: true, file: c.file.path, line: c.file.line(m.open), code: this.snippet(c.file, m.start, m.close + 1), effects });
    }
    return out;
  }

  snippet(f, a, b) {
    const from = f.lineStarts[f.line(a) - 1];
    const toLine = f.line(b);
    const to = toLine < f.lineStarts.length ? f.lineStarts[toLine] - 1 : f.text.length;
    const lines = f.text.slice(from, to).split("\n").slice(0, 60);
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
    return lines.map((l) => l.slice(indent)).join("\n");
  }

  // ---------------------------------------------------------------- the model the UI draws

  build() {
    const screens = {};
    const add = (id, s) => { if (!screens[id]) screens[id] = { id, ...s, handlers: [], auto: [], dialogs: [] }; return screens[id]; };
    for (const c of Object.values(this.classes)) {
      if (!["activity", "fragment", "dialog"].includes(c.kind)) continue;
      if (c.kind !== "activity" && !c.layout) continue;
      add(c.name, { cls: c.name, kind: c.kind, layout: c.layout, file: c.file.path, line: c.file.line(c.start), host: this.hostOf[c.name] || null });
    }
    for (const name of Object.keys(this.manifestActivities)) {
      if (!screens[name] && !this.classes[name]) add(name, { cls: name, kind: "activity", layout: null, missing: true });
    }
    // list-row layouts, including adapters defined in their own files
    for (const s of Object.values(screens)) {
      const c = this.classes[s.cls];
      if (!c) continue;
      const items = [...(c.itemLayouts || [])];
      for (const n of c.inner) items.push(...(this.classes[n].itemLayouts || []));
      const body = c.file.masked.slice(c.open, c.close);
      for (const a of Object.values(this.classes)) {
        if (a.kind === "adapter" && a.file !== c.file && new RegExp(`\\b${a.name}\\b`).test(body)) items.push(...a.itemLayouts);
      }
      s.itemLayouts = [...new Set(items)];
    }

    const edges = [];
    const edgeKey = new Set();
    const addEdge = (e) => {
      const key = `${e.from}|${e.to}|${e.viewId}|${e.auto ? e.label : ""}`;
      if (edgeKey.has(key) || e.from === e.to) return;
      edgeKey.add(key);
      edges.push(e);
    };
    const dialogNode = (owner, layout) => {
      const id = `${owner}::${layout}`;
      return add(id, { cls: owner, kind: "dialog", layout, file: screens[owner]?.file, dialogOf: owner, title: layout });
    };
    for (const s of Object.values(screens)) {
      const c = this.classes[s.cls];
      if (!c || s.dialogOf) continue;
      const cHandlers = this.handlers(c);
      // a fragment's buttons that live in the host layout also matter for the host's own node
      s.handlers = cHandlers;
      s.auto = this.automatic(c);
      // fragment classes reached by the activity just to be shown: hosting, not navigation
      for (const h of s.handlers) {
        for (const e of h.effects) {
          if (e.type === "nav" && screens[e.to]) addEdge({ from: s.id, to: e.to, viewId: h.id, label: h.label, cond: e.cond, via: e.via, event: h.event });
          if (e.type === "dialog") { const d = dialogNode(s.id, e.layout); addEdge({ from: s.id, to: d.id, viewId: h.id, label: h.label, cond: e.cond, event: h.event }); }
        }
      }
      for (const a of s.auto) {
        for (const e of a.effects) {
          if (e.type === "nav" && screens[e.to]) addEdge({ from: s.id, to: e.to, viewId: null, auto: true, label: a.trigger, cond: e.cond, via: e.via });
          if (e.type === "dialog") { const d = dialogNode(s.id, e.layout); addEdge({ from: s.id, to: d.id, viewId: null, auto: true, label: a.trigger, cond: e.cond }); }
        }
      }
    }
    // fragments placed in a layout (<fragment>, FragmentContainerView, NavHostFragment start) show up on their own
    for (const s of Object.values(screens)) {
      if (s.kind !== "activity" || !s.layout) continue;
      for (const el of this.layoutElements(s.layout)) {
        const tag = el.tagName.split(".").pop();
        if (tag !== "fragment" && tag !== "FragmentContainerView") continue;
        let cls = (el.getAttribute("android:name") || el.getAttribute("class") || "").split(".").pop();
        if (cls === "NavHostFragment") cls = this.navStart[(el.getAttribute("app:navGraph") || "").replace("@navigation/", "")];
        if (cls && screens[cls]) addEdge({ from: s.id, to: cls, viewId: null, auto: true, label: "When it opens", cond: [] });
      }
    }
    // dialogs get their own handlers (buttons inside the dialog layout, wired in the owner's code)
    for (const s of Object.values(screens)) {
      if (!s.dialogOf) continue;
      const owner = screens[s.dialogOf];
      const ids = new Set(this.layoutElements(s.layout).map((el) => (el.getAttribute("android:id") || "").replace(/^@\+?id\//, "")).filter(Boolean));
      const c = this.classes[owner.cls];
      const vars = this.viewVars(c);
      s.handlers = this.listenerSpans(c).filter((l) => {
        const recv = l.recv.replace(/\s/g, "");
        const id = vars[recv] || (recv.match(/R\.id\.(\w+)/) || [])[1];
        return id && ids.has(id);
      }).map((l) => {
        const recv = l.recv.replace(/\s/g, "");
        const id = vars[recv] || recv.match(/R\.id\.(\w+)/)[1];
        const [a, b] = l.body;
        return { id, label: this.label(id, c.name), event: "tap", file: c.file.path, line: c.file.line(a), code: this.snippet(c.file, a, b), effects: this.effects(c, a, b) };
      });
      // ...and they are no longer the owner's buttons
      owner.handlers = owner.handlers.filter((h) => !ids.has(h.id));
      for (const h of s.handlers) for (const e of h.effects) if (e.type === "nav" && screens[e.to]) addEdge({ from: s.id, to: e.to, viewId: h.id, label: h.label, cond: e.cond, event: h.event });
    }
    // edges from a dialog's buttons were first credited to the owner - keep only the dialog's
    const dialogButtons = new Set(Object.values(screens).filter((s) => s.dialogOf).flatMap((s) => s.handlers.map((h) => `${s.dialogOf}|${h.id}`)));
    const finalEdges = edges.filter((e) => !dialogButtons.has(`${e.from}|${e.viewId}`));

    for (const s of Object.values(screens)) s.launcher = !s.dialogOf && this.launchers.includes(s.id);
    return {
      screens, edges: finalEdges, launchers: this.launchers.filter((n) => screens[n]),
      appTheme: this.appTheme, appLabel: this.appLabel, activities: this.manifestActivities,
      classes: this.classes, hostOf: this.hostOf, idInfo: this.idInfo, files: this.files,
    };
  }
}
