// Draws Android layout XML as HTML that looks like the phone screen: views become divs,
// LinearLayout/FrameLayout map to flex/grid, ConstraintLayout/RelativeLayout are solved in layout.js.

const SCREEN_W = 360, SCREEN_H = 760;
const BASE_FONT = 'Roboto, "Segoe UI", system-ui, sans-serif';
const NO_TOOLS_OVERRIDE = /^(context|ignore|targetApi|showIn|parentTag|locale|keep|discard|menu|openDrawer|viewBindingIgnore|layout_editor_absoluteX|layout_editor_absoluteY|listitem|itemCount|layoutManager|spanCount|orientation|layout)$/;

const DEFAULT_STYLE_ATTR = {
  Button: ["materialButtonStyle", "buttonStyle"], MaterialButton: ["materialButtonStyle"], AppCompatButton: ["buttonStyle"],
  TextView: ["textViewStyle"], MaterialTextView: ["textViewStyle"], EditText: ["editTextStyle"], TextInputEditText: ["editTextStyle"],
  CheckBox: ["checkboxStyle"], RadioButton: ["radioButtonStyle"], MaterialCardView: ["materialCardViewStyle"],
  Toolbar: ["toolbarStyle"], MaterialToolbar: ["toolbarStyle"], TextInputLayout: ["textInputStyle"], Chip: ["chipStyle"],
  LinearProgressIndicator: ["linearProgressIndicatorStyle"], CircularProgressIndicator: ["circularProgressIndicatorStyle"],
  BottomNavigationView: ["bottomNavigationStyle"], TabLayout: ["tabStyle"], SeekBar: ["seekBarStyle"], Slider: ["sliderStyle"],
};

function h(tag, cls, style) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (style) Object.assign(d.style, style);
  return d;
}

const gravityOf = (g) => {
  const t = new Set((g || "").split("|").map((x) => x.trim()));
  const hz = t.has("center") || t.has("center_horizontal") ? "center" : t.has("end") || t.has("right") ? "end" : t.has("start") || t.has("left") ? "start" : null;
  const vt = t.has("center") || t.has("center_vertical") ? "center" : t.has("bottom") ? "end" : t.has("top") ? "start" : null;
  return { h: hz, v: vt, fillH: t.has("fill") || t.has("fill_horizontal"), fillV: t.has("fill") || t.has("fill_vertical") };
};
const FLEX = { start: "flex-start", center: "center", end: "flex-end" };

class Renderer {
  constructor(res, model) {
    this.res = res;
    this.model = model;
    this.themes = {};
  }

  theme(name) {
    const key = name || "";
    if (!this.themes[key]) this.themes[key] = new Theme(this.res, name);
    return this.themes[key];
  }

  themeForScreen(s) {
    const host = s.host ? this.model.screens[s.host.host] : null;
    const cls = s.dialogOf || (host ? host.cls : s.cls);
    const act = this.model.activities[cls];
    let name = act?.theme || this.model.appTheme;
    // splash themes switch to postSplashScreenTheme once the app is running
    const post = name && this.res.styleItems(name).postSplashScreenTheme;
    if (post) name = post;
    return this.theme(name);
  }

  // ---------------------------------------------------------------- values

  col(v, ctx) { return v == null ? null : this.res.color(v, ctx.theme); }
  dp(v, ctx) { return v == null ? null : this.res.dp(v, ctx.theme); }
  str(v, ctx) { return v == null ? null : this.res.string(v, ctx.theme); }

  // merged attributes: theme default style < textAppearance < style < inline < tools
  attrs(x, ctx, overrides) {
    const inline = {}, tools = {};
    for (const at of x.attributes) {
      const q = at.name;
      if (q.startsWith("xmlns")) continue;
      const i = q.indexOf(":");
      const pfx = i < 0 ? "" : q.slice(0, i), local = i < 0 ? q : q.slice(i + 1);
      if (pfx === "tools") tools[local] = at.value; else inline[local] = at.value;
    }
    if (overrides) Object.assign(inline, overrides);
    const simple = x.tagName.split(".").pop();
    let def = {}, defName = null;
    for (const attr of DEFAULT_STYLE_ATTR[simple] || []) {
      const v = ctx.theme.items[attr];
      if (v) { def = this.res.styleItems(v); defName = v; break; }
    }
    const styleName = inline.style || defName;
    const style = inline.style ? this.res.styleItems(inline.style) : {};
    const ta = inline.textAppearance ?? style.textAppearance ?? def.textAppearance;
    const taItems = ta ? this.res.styleItems(ta) : {};
    const a = { ...def, ...taItems, ...style, ...inline };
    for (const [k, v] of Object.entries(tools)) if (!NO_TOOLS_OVERRIDE.test(k)) a[k] = v;
    a._tools = tools;
    a._chain = styleName ? this.res.styleChain(styleName).join(" ") : "";
    return a;
  }

  kindOf(simple, a, x) {
    const s = simple;
    if (/^(LinearLayout|LinearLayoutCompat|TableLayout|TableRow|NavigationRailView|SearchBar)$/.test(s)) return "linear";
    if (s === "RadioGroup") return "radiogroup";
    if (/^(ConstraintLayout|MotionLayout)$/.test(s)) return "constraint";
    if (/^(RelativeLayout|PercentRelativeLayout)$/.test(s)) return "relative";
    if (/^(ScrollView|NestedScrollView)$/.test(s)) return "scroll";
    if (s === "HorizontalScrollView") return "hscroll";
    if (/^(CardView|MaterialCardView)$/.test(s)) return "card";
    if (s === "CoordinatorLayout") return "coordinator";
    if (s === "AppBarLayout") return "appbar";
    if (/^(Toolbar|MaterialToolbar)$/.test(s)) return "toolbar";
    if (/^(BottomNavigationView|NavigationBarView)$/.test(s)) return "bottomnav";
    if (s === "TabLayout") return "tabs";
    if (s === "TabItem") return "tabitem";
    if (/^(DrawerLayout|SlidingPaneLayout)$/.test(s)) return "drawer";
    if (/^(NavigationView)$/.test(s)) return "hidden";
    if (/^(GridLayout)$/.test(s)) return "gridlayout";
    if (/^(ChipGroup|FlexboxLayout|MaterialButtonToggleGroup)$/.test(s)) return "flow";
    if (/^(ListView|RecyclerView|GridView|ExpandableListView)$/.test(s)) return "list";
    if (/^(ViewPager|ViewPager2)$/.test(s)) return "pager";
    if (/^(fragment|FragmentContainerView)$/.test(s)) return "fragment";
    if (/^(TextInputLayout)$/.test(s)) return "til";
    if (/^(Button|MaterialButton|AppCompatButton|ExtendedFloatingActionButton)$/.test(s)) return s === "ExtendedFloatingActionButton" ? "efab" : "button";
    if (s === "FloatingActionButton") return "fab";
    if (/^(EditText|TextInputEditText|AppCompatEditText|AutoCompleteTextView|MaterialAutoCompleteTextView|MultiAutoCompleteTextView)$/.test(s)) return "edit";
    if (/^(TextView|MaterialTextView|AppCompatTextView|CheckedTextView|Chronometer|TextClock)$/.test(s)) return "text";
    if (/^(CheckBox|MaterialCheckBox|AppCompatCheckBox)$/.test(s)) return "check";
    if (/^(RadioButton|MaterialRadioButton|AppCompatRadioButton)$/.test(s)) return "radio";
    if (/^(Switch|SwitchCompat|SwitchMaterial|MaterialSwitch|ToggleButton)$/.test(s)) return "switch";
    if (/^(SeekBar|Slider|RangeSlider|AppCompatSeekBar)$/.test(s)) return "seek";
    if (/^(ProgressBar|LinearProgressIndicator|CircularProgressIndicator|ContentLoadingProgressBar)$/.test(s)) return "progress";
    if (s === "RatingBar") return "rating";
    if (/^(ImageView|AppCompatImageView|ShapeableImageView|CircleImageView|RoundedImageView|ImageFilterView|LottieAnimationView|PhotoView)$/.test(s)) return "image";
    if (/^(ImageButton|AppCompatImageButton)$/.test(s)) return "imagebutton";
    if (/^(Chip)$/.test(s)) return "chip";
    if (/^(Spinner|AppCompatSpinner)$/.test(s)) return "spinner";
    if (/^(SearchView)$/.test(s)) return "search";
    if (/^(Space)$/.test(s)) return "space";
    if (/^(View|MaterialDivider|Divider)$/.test(s)) return "view";
    if (/^(FrameLayout|CollapsingToolbarLayout|SwipeRefreshLayout|ViewFlipper|ViewAnimator|TextSwitcher|ImageSwitcher|ViewSwitcher|MaterialToolbarLayout|BottomAppBar)$/.test(s)) return "frame";
    if (s === "Guideline" || s === "Barrier") return "guide";
    if (/^(Group|Layer|Flow|Placeholder|ViewStub|requestFocus|tag|MotionScene)$/.test(s)) return "skip";
    // the app's own custom views: use what they extend
    const base = this.model.classes[s]?.superName;
    if (base && base !== s) {
      const k = this.kindOf(base, a, x);
      if (k !== "unknown") return k;
    }
    if (x.children.length) {
      if (/Linear/.test(s)) return "linear";
      if (/Constraint/.test(s)) return "constraint";
      if (/Relative/.test(s)) return "relative";
      if (/Scroll/.test(s)) return "scroll";
      if (/Card/.test(s)) return "card";
      return "frame";
    }
    return "unknown";
  }

  // ---------------------------------------------------------------- entry points

  // A whole phone screen for a node of the flow chart. Mount it, then call relayout().
  screen(s, opts = {}) {
    const theme = this.themeForScreen(s);
    const ctx = { theme, depth: 0, items: [...(s.itemLayouts || [])], interactive: !!opts.interactive, seen: [] };
    const phone = h("div", "phone");
    phone.style.width = SCREEN_W + "px";
    phone.style.height = SCREEN_H + "px";
    const winBg = theme.attr("windowBackground");
    phone.style.background = this.col(winBg, ctx) || this.col("?colorBackground", ctx) || "#fff";
    if (winBg && !this.col(winBg, ctx)) this.paint(phone, this.drawableSrc(winBg, ctx), ctx);
    const bgColor = this.col(winBg, ctx) || this.col("?colorBackground", ctx) || "#ffffff";

    const statusColor = this.col(theme.items.statusBarColor, ctx) || (theme.family !== "m3" ? this.col("?colorPrimaryDark", ctx) : null) || bgColor;
    const status = h("div", "status-bar", { background: statusColor });
    const lightIcons = luminance(statusColor === "transparent" ? bgColor : statusColor) < 0.5;
    status.style.color = lightIcons ? "#fff" : "#1f1f1f";
    status.innerHTML = `<span>9:41</span><span class="status-icons"><i></i><i></i><b></b></span>`;
    phone.append(status);

    const owner = s.host ? this.model.screens[s.host.host] : s;
    if (!theme.noActionBar && owner && owner.kind === "activity" && !s.dialogOf) {
      const act = this.model.activities[owner.cls];
      const bar = h("div", "action-bar", {
        background: this.col(theme.family === "m3" ? "?colorSurface" : "?colorPrimary", ctx),
        color: this.col(theme.family === "m3" ? "?colorOnSurface" : "?colorOnPrimary", ctx) || "#fff",
      });
      bar.textContent = act?.label || this.model.appLabel || owner.cls;
      phone.append(bar);
    }

    const content = h("div", "screen-content");
    phone.append(content);
    let root = null;
    if (s.dialogOf) {
      const ownerScreen = this.model.screens[s.dialogOf];
      if (ownerScreen?.layout) {
        const under = this.layoutRoot(ownerScreen.layout, { ...ctx, items: [...(ownerScreen.itemLayouts || [])] }, { type: "root" });
        if (under) { under.classList.add("under-dialog"); content.append(under); }
      }
      const scrim = h("div", "dialog-scrim");
      const card = h("div", "dialog-card", {
        background: this.col("?colorSurface", ctx) || "#fff",
        borderRadius: (theme.family === "m3" ? 28 : 4) + "px",
      });
      root = this.layoutRoot(s.layout, ctx, { type: "dialog" });
      if (root) card.append(root);
      scrim.append(card);
      content.append(scrim);
    } else if (s.host && this.model.screens[s.host.host]?.layout) {
      const host = this.model.screens[s.host.host];
      ctx.fragmentInto = { container: s.host.container, layout: s.layout };
      ctx.items.push(...(host.itemLayouts || []));
      root = this.layoutRoot(host.layout, ctx, { type: "root" });
      if (root) content.append(root);
    } else if (s.layout) {
      root = this.layoutRoot(s.layout, ctx, { type: "root" });
      if (root) content.append(root);
    }
    if (!root) {
      const empty = h("div", "no-layout");
      empty.textContent = s.missing ? "Class not found in the project" : "No XML layout (built in code)";
      content.append(empty);
    }
    return phone;
  }

  // A single layout on its own (gallery): 360 wide, as tall as it needs.
  standalone(name, themeName, opts = {}) {
    const theme = this.theme(themeName || this.model.appTheme);
    const ctx = { theme, depth: 0, items: [], interactive: !!opts.interactive, seen: [] };
    const box = h("div", "phone standalone", { width: SCREEN_W + "px" });
    box.style.background = this.col("?colorBackground", ctx) || "#fff";
    const content = h("div", "screen-content");
    box.append(content);
    const root = this.layoutRoot(name, ctx, { type: "free" });
    if (root) content.append(root);
    return box;
  }

  layoutRoot(name, ctx, parent, overrides) {
    const doc = this.res.doc("layout", name);
    if (!doc || ctx.seen.includes(name) || ctx.seen.length > 8) return null;
    const c2 = { ...ctx, seen: [...ctx.seen, name] };
    const rootEl = doc.documentElement;
    if (rootEl.tagName === "merge") {
      const tag = rootEl.getAttribute("tools:parentTag") || "FrameLayout";
      const fake = rootEl.ownerDocument.createElement(tag);
      for (const at of rootEl.attributes) fake.setAttribute(at.name, at.value);
      fake.setAttribute("android:layout_width", "match_parent");
      fake.setAttribute("android:layout_height", parent.type === "free" ? "wrap_content" : "match_parent");
      for (const ch of [...rootEl.children]) fake.append(ch.cloneNode(true));
      return this.node(fake, parent, c2, overrides);
    }
    const out = this.node(rootEl, parent, c2, overrides);
    if (out) out.dataset.layout = name;
    return out;
  }

  // ---------------------------------------------------------------- views

  node(x, parent, ctx, overrides) {
    const simple = x.tagName.split(".").pop();
    if (simple === "include") return this.include(x, parent, ctx);
    const a = this.attrs(x, ctx, overrides);
    const kind = this.kindOf(simple, a, x);
    if (kind === "skip") return null;
    const d = h("div", `v v-${kind}`);
    d.dataset.tag = simple;
    const id = (a.id || "").replace(/^@\+?(android:)?id\//, "");
    if (id) d.dataset.vid = id;
    d._a = a;
    d.parentType = parent.type;

    if (kind === "guide") {
      d.style.display = "none";
      d._guide = {
        barrier: simple === "Barrier",
        orientation: a.orientation, begin: this.dp(a.layout_constraintGuide_begin, ctx), end: this.dp(a.layout_constraintGuide_end, ctx),
        percent: a.layout_constraintGuide_percent != null ? parseFloat(a.layout_constraintGuide_percent) : null,
        direction: a.barrierDirection, refs: (a.constraint_referenced_ids || "").split(",").map((t) => t.trim()).filter(Boolean),
      };
      this.constraints(d, a, ctx);
      return d;
    }

    this.size(d, a, parent, ctx, kind);
    this.box(d, a, ctx, kind);
    const build = this["k_" + kind];
    if (build) build.call(this, d, a, x, ctx, parent);
    else this.k_unknown(d, a, x, ctx);
    // after building: the builders set display themselves
    if (a.visibility === "gone" || kind === "hidden") { d.style.display = "none"; d._gone = true; }
    else if (a.visibility === "invisible") d.style.visibility = "hidden";
    if (parent.type === "abs") this.constraints(d, a, ctx);

    // a fragment container that this screen's fragment goes into
    if (id && ctx.fragmentInto && ctx.fragmentInto.container === id && ctx.fragmentInto.layout) {
      const fl = ctx.fragmentInto.layout;
      const inner = this.layoutRoot(fl, { ...ctx, fragmentInto: null }, { type: "frame" });
      if (inner) { inner.classList.add("fragment-body"); d.append(inner); d.classList.add("fragment-host"); }
    }
    return d;
  }

  include(x, parent, ctx) {
    const name = (x.getAttribute("layout") || "").replace("@layout/", "");
    const overrides = {};
    for (const at of x.attributes) {
      const local = at.name.split(":").pop();
      if (at.name.startsWith("android:") && (local.startsWith("layout_") || local === "id" || local === "visibility")) overrides[local] = at.value;
    }
    const doc = this.res.doc("layout", name);
    if (!doc) return null;
    if (doc.documentElement.tagName === "merge") {
      if (ctx.seen.includes(name)) return null;
      const c2 = { ...ctx, seen: [...ctx.seen, name] };
      return [...doc.documentElement.children].map((ch) => this.node(ch, parent, c2)).flat().filter(Boolean);
    }
    const out = this.layoutRoot(name, ctx, parent, overrides);
    if (out) out.dataset.include = name;
    return out;
  }

  children(d, x, ctx, type) {
    const parent = { type, el: d };
    for (const ch of x.children) {
      const out = this.node(ch, parent, ctx);
      for (const o of [out].flat()) if (o) d.append(o);
    }
  }

  // ---------------------------------------------------------------- size, margins, padding, background

  spec(v, ctx) {
    if (v == null) return { mode: "wrap" };
    if (v === "match_parent" || v === "fill_parent") return { mode: "match" };
    if (v === "wrap_content") return { mode: "wrap" };
    const n = this.dp(v, ctx);
    if (n == null) return { mode: "wrap" };
    return n === 0 ? { mode: "zero", px: 0 } : { mode: "fixed", px: n };
  }

  margins(a, ctx) {
    const m = (k) => this.dp(a[k], ctx);
    const all = m("layout_margin");
    const hz = m("layout_marginHorizontal"), vt = m("layout_marginVertical");
    return {
      l: m("layout_marginStart") ?? m("layout_marginLeft") ?? hz ?? all ?? 0,
      r: m("layout_marginEnd") ?? m("layout_marginRight") ?? hz ?? all ?? 0,
      t: m("layout_marginTop") ?? vt ?? all ?? 0,
      b: m("layout_marginBottom") ?? vt ?? all ?? 0,
    };
  }

  size(d, a, parent, ctx, kind) {
    const st = d.style;
    const w = this.spec(a.layout_width, ctx), hh = this.spec(a.layout_height, ctx);
    d._w = w; d._h = hh;
    const m = this.margins(a, ctx);
    d._m = m;
    const lg = gravityOf(a.layout_gravity);
    const px = (n) => n + "px";
    if (parent.type !== "abs") st.margin = `${m.t}px ${m.r}px ${m.b}px ${m.l}px`;
    const fix = () => {
      if (w.mode === "fixed") { st.width = px(w.px); st.minWidth = px(w.px); }
      if (hh.mode === "fixed") { st.height = px(hh.px); st.minHeight = px(hh.px); }
    };
    switch (parent.type) {
      case "vlinear":
      case "hlinear": {
        const vert = parent.type === "vlinear";
        const main = vert ? hh : w, cross = vert ? w : hh;
        const mainProp = vert ? "height" : "width", crossProp = vert ? "width" : "height";
        const weight = parseFloat(a.layout_weight) || 0;
        if (weight > 0) {
          st.flex = `${weight} 1 ${main.mode === "fixed" ? main.px + "px" : main.mode === "zero" ? "0px" : "auto"}`;
          st[vert ? "minHeight" : "minWidth"] = "0";
        } else if (main.mode === "fixed") { st.flex = `0 0 ${main.px}px`; st[mainProp] = px(main.px); }
        else if (main.mode === "match") st.flex = "1 1 auto";
        else if (main.mode === "zero") { st.flex = "0 0 0px"; st[mainProp] = "0"; }
        else st.flex = vert ? "0 0 auto" : "0 1 auto";  // Android overflows (clips) a too-tall column, it never squeezes it
        if (cross.mode === "fixed") st[crossProp] = px(cross.px);
        const cg = vert ? lg.h : lg.v;
        if (cross.mode === "match") st.alignSelf = "stretch";
        else if (cg) st.alignSelf = FLEX[cg];
        if (!vert && kind === "text") st.minWidth = st.minWidth || "0";
        break;
      }
      case "frame":
      case "card": {
        st.gridArea = "1 / 1";
        st.justifySelf = w.mode === "match" ? "stretch" : FLEX[lg.h] || "start";
        st.alignSelf = hh.mode === "match" ? "stretch" : FLEX[lg.v] || "start";
        if (st.justifySelf !== "stretch") st.maxWidth = "100%";
        fix();
        break;
      }
      case "abs":
        st.position = "absolute";
        st.margin = "0";
        fix();
        break;
      case "scroll":
        if (w.mode === "fixed") st.width = px(w.px); else st.width = "auto";
        if (hh.mode === "fixed") st.height = px(hh.px);
        if (parent.fill) st.minHeight = "100%";
        break;
      case "hscroll":
        st.flex = "0 0 auto";
        if (w.mode === "fixed") st.width = px(w.px);
        if (hh.mode === "match") st.alignSelf = "stretch"; else if (hh.mode === "fixed") st.height = px(hh.px);
        break;
      case "root":
        st.width = w.mode === "fixed" ? px(w.px) : "100%";
        st.height = hh.mode === "fixed" ? px(hh.px) : hh.mode === "wrap" ? "auto" : "100%";
        st.gridArea = "1 / 1";
        if (hh.mode === "wrap") st.alignSelf = "start";
        break;
      case "dialog":
      case "free":
      case "row":
        // auto (not 100%) so margins stay inside the parent
        if (w.mode === "fixed") st.width = px(w.px);
        else if (parent.type === "row") st.alignSelf = "stretch";
        if (hh.mode === "fixed") st.height = px(hh.px);
        break;
      case "flow":
        fix();
        break;
      case "grid":
        fix();
        if (w.mode === "match") st.justifySelf = "stretch";
        break;
      case "coordinator": {
        st.flex = hh.mode === "match" || a.layout_behavior ? "1 1 auto" : "0 0 auto";
        if (hh.mode === "fixed") st.flex = `0 0 ${hh.px}px`;
        if (w.mode === "fixed") st.width = px(w.px); else if (w.mode === "match") st.alignSelf = "stretch";
        if ((lg.h || lg.v) && !a.layout_behavior && w.mode !== "match") {
          // floating children (FAB): pinned to a corner
          st.position = "absolute";
          st.margin = "0";
          if (lg.v === "end") st.bottom = m.b + "px"; else if (lg.v === "center") st.top = "50%"; else st.top = m.t + "px";
          if (lg.h === "end") st.right = m.r + "px"; else if (lg.h === "center") st.left = "50%"; else st.left = m.l + "px";
          if (lg.h === "center" || lg.v === "center") st.transform = `translate(${lg.h === "center" ? "-50%" : 0}, ${lg.v === "center" ? "-50%" : 0})`;
          fix();
        }
        break;
      }
      default:
        fix();
    }
    const minH = this.dp(a.minHeight, ctx), minW = this.dp(a.minWidth, ctx);
    if (minH && !(hh.mode === "fixed")) st.minHeight = minH + "px";
    if (minW && !(w.mode === "fixed")) st.minWidth = minW + "px";
    const maxW = this.dp(a.maxWidth, ctx), maxH = this.dp(a.maxHeight, ctx);
    if (maxW) st.maxWidth = maxW + "px";
    if (maxH) st.maxHeight = maxH + "px";
  }

  box(d, a, ctx, kind) {
    const st = d.style;
    const p = (k) => this.dp(a[k], ctx);
    const all = p("padding"), hz = p("paddingHorizontal"), vt = p("paddingVertical");
    const pad = {
      l: p("paddingStart") ?? p("paddingLeft") ?? hz ?? all,
      r: p("paddingEnd") ?? p("paddingRight") ?? hz ?? all,
      t: p("paddingTop") ?? vt ?? all,
      b: p("paddingBottom") ?? vt ?? all,
    };
    for (const [k, prop] of [["l", "paddingLeft"], ["r", "paddingRight"], ["t", "paddingTop"], ["b", "paddingBottom"]]) {
      if (pad[k] != null) st[prop] = pad[k] + "px";
    }
    d._pad = pad;
    const skipBg = ["button", "efab", "fab", "chip", "card", "til"].includes(kind);
    if (a.background && !skipBg) this.background(d, a.background, ctx, a.backgroundTint);
    else if (a.background && kind === "button") d._customBg = true;
    const el = this.dp(a.elevation, ctx) || this.dp(a.cardElevation, ctx);
    if (el && kind !== "card") d._shadow = `0 ${Math.min(el, 12) / 2}px ${Math.min(el, 12)}px rgba(0,0,0,.25)`;
    if (d._shadow) st.boxShadow = [d._shadow, st.boxShadow].filter(Boolean).join(", ");
    const alpha = parseFloat(a.alpha);
    if (!isNaN(alpha) && alpha < 1) st.opacity = alpha;
    const rot = parseFloat(a.rotation);
    if (rot) st.rotate = rot + "deg";
  }

  // ---------------------------------------------------------------- drawables

  // raw reference -> { color } | { img: {url, w, h} } | { el: Element } | null
  drawableSrc(ref, ctx) {
    if (!ref || ref === "@null") return null;
    const c = this.col(ref, ctx);
    if (c) return { color: c };
    const dr = this.res.drawable(ref, ctx.theme);
    if (!dr) {
      const r = this.res.resolve(ref, ctx.theme);
      if (r && r !== ref) return this.drawableSrc(r, ctx);
      return null;
    }
    if (dr.kind === "image") return { img: dr };
    return { el: dr.doc.documentElement };
  }

  itemSrc(item, ctx) {
    const ref = item.getAttribute("android:drawable");
    if (ref) return this.drawableSrc(ref, ctx);
    const col = item.getAttribute("android:color");
    if (col && item.tagName !== "item") return { color: this.col(col, ctx) };
    const child = [...item.children].find((c) => !c.tagName.startsWith("aapt"));
    return child ? { el: child } : (col ? { color: this.col(col, ctx) } : null);
  }

  background(d, ref, ctx, tint) {
    const src = this.drawableSrc(ref, ctx);
    if (!src) return;
    const t = tint && tint !== "@null" ? this.col(tint, ctx) : null;
    this.paint(d, src, ctx, t);
  }

  pickItem(el) {
    const items = [...el.children].filter((c) => c.tagName === "item");
    const plain = items.find((it) => ![...it.attributes].some((x) => /state_/.test(x.name) && x.value === "true"));
    return plain || items[items.length - 1];
  }

  paint(d, src, ctx, tint) {
    if (!src) return;
    const st = d.style;
    if (src.color) { st.backgroundColor = tint || src.color; return; }
    if (src.img) {
      if (tint) { st.backgroundColor = tint; st.maskImage = st.webkitMaskImage = `url("${src.img.url}")`; st.maskSize = st.webkitMaskSize = "100% 100%"; }
      else { st.backgroundImage = `url("${src.img.url}")`; st.backgroundSize = "100% 100%"; }
      return;
    }
    const el = src.el;
    const tag = el.tagName;
    if (tag === "shape") { this.shapeCss(d, el, ctx, tint); return; }
    if (/^(selector|animated-selector|level-list|transition|animation-list)$/.test(tag)) {
      const it = tag === "selector" || tag === "animated-selector" ? this.pickItem(el) : [...el.children].find((c) => c.tagName === "item");
      if (it) this.paint(d, this.itemSrc(it, ctx), ctx, tint);
      return;
    }
    if (tag === "ripple") {
      const it = [...el.children].find((c) => c.tagName === "item" && c.getAttribute("android:id") !== "@android:id/mask");
      if (it) this.paint(d, this.itemSrc(it, ctx), ctx, tint);
      return;
    }
    if (tag === "layer-list" || tag === "adaptive-icon") {
      const items = tag === "adaptive-icon" ? [...el.children].filter((c) => /background|foreground/.test(c.tagName)) : [...el.children].filter((c) => c.tagName === "item");
      if (items.length === 1 && !["left", "top", "right", "bottom", "width", "height", "gravity"].some((k) => items[0].hasAttribute("android:" + k))) {
        this.paint(d, this.itemSrc(items[0], ctx), ctx, tint);
        return;
      }
      st.isolation = "isolate";
      if (!st.position) st.position = "relative";
      for (const it of items) {
        const inset = (k) => this.dp(it.getAttribute("android:" + k), ctx) ?? 0;
        const layer = h("div", "bg-layer", { left: inset("left") + "px", top: inset("top") + "px", right: inset("right") + "px", bottom: inset("bottom") + "px" });
        const w = this.dp(it.getAttribute("android:width"), ctx), hh = this.dp(it.getAttribute("android:height"), ctx);
        if (w || hh) {
          const g = gravityOf(it.getAttribute("android:gravity") || "center");
          if (w) { layer.style.width = w + "px"; if (g.h === "center") { layer.style.left = `calc(50% - ${w / 2}px)`; layer.style.right = "auto"; } else if (g.h === "end") layer.style.left = "auto"; else layer.style.right = "auto"; }
          if (hh) { layer.style.height = hh + "px"; if (g.v === "center") { layer.style.top = `calc(50% - ${hh / 2}px)`; layer.style.bottom = "auto"; } else if (g.v === "end") layer.style.top = "auto"; else layer.style.bottom = "auto"; }
        }
        this.paint(layer, this.itemSrc(it, ctx), ctx, tint);
        d.prepend(layer);
      }
      // layers were prepended in reverse - put them back in order
      const layers = [...d.querySelectorAll(":scope > .bg-layer")];
      layers.reverse().forEach((l) => d.insertBefore(l, d.firstChild));
      return;
    }
    if (tag === "inset" || tag === "clip" || tag === "scale" || tag === "rotate") {
      const inner = this.itemSrc(el, ctx);
      const ins = (k) => this.dp(el.getAttribute("android:" + k) ?? el.getAttribute("android:inset"), ctx) ?? 0;
      if (!ins("insetLeft") && !ins("insetTop") && !ins("insetRight") && !ins("insetBottom")) { this.paint(d, inner, ctx, tint); return; }
      st.isolation = "isolate";
      if (!st.position) st.position = "relative";
      const layer = h("div", "bg-layer", { left: ins("insetLeft") + "px", top: ins("insetTop") + "px", right: ins("insetRight") + "px", bottom: ins("insetBottom") + "px" });
      this.paint(layer, inner, ctx, tint);
      d.prepend(layer);
      return;
    }
    if (tag === "vector" || tag === "animated-vector") {
      const v = this.vector(tag === "vector" ? el : this.drawableSrc(el.getAttribute("android:drawable"), ctx)?.el, ctx, tint);
      if (v) { st.backgroundImage = `url("${v.url}")`; st.backgroundSize = "100% 100%"; }
      return;
    }
    if (tag === "bitmap" || tag === "nine-patch") {
      const inner = this.drawableSrc(el.getAttribute("android:src"), ctx);
      if (inner?.img) {
        this.paint(d, inner, ctx, tint);
        if (el.getAttribute("android:tileMode") === "repeat") { st.backgroundSize = `${inner.img.w}px ${inner.img.h}px`; st.backgroundRepeat = "repeat"; }
      }
      return;
    }
    if (tag === "color") { st.backgroundColor = tint || this.col(el.getAttribute("android:color"), ctx); return; }
    if (tag === "item") this.paint(d, this.itemSrc(el, ctx), ctx, tint);
  }

  shapeCss(d, el, ctx, tint) {
    const st = d.style;
    const shape = el.getAttribute("android:shape") || "rectangle";
    const get = (tag) => [...el.children].find((c) => c.tagName === tag);
    const solid = get("solid"), stroke = get("stroke"), corners = get("corners"), grad = get("gradient");
    if (solid) st.backgroundColor = tint || this.col(solid.getAttribute("android:color"), ctx) || "transparent";
    else if (tint && !grad) st.backgroundColor = tint;
    if (grad) {
      const cols = ["startColor", "centerColor", "endColor"].map((k) => this.col(grad.getAttribute("android:" + k), ctx)).filter(Boolean);
      const type = grad.getAttribute("android:type") || "linear";
      if (cols.length === 1) cols.push(cols[0]);
      if (type === "radial") {
        const r = this.dp(grad.getAttribute("android:gradientRadius"), ctx);
        const cx = (parseFloat(grad.getAttribute("android:centerX") ?? 0.5) * 100) + "%", cy = (parseFloat(grad.getAttribute("android:centerY") ?? 0.5) * 100) + "%";
        st.backgroundImage = `radial-gradient(circle ${r ? r + "px" : "closest-side"} at ${cx} ${cy}, ${cols.join(", ")})`;
      } else if (type === "sweep") {
        st.backgroundImage = `conic-gradient(from 90deg, ${cols.join(", ")})`;
      } else {
        const angle = parseFloat(grad.getAttribute("android:angle") || 0);
        st.backgroundImage = `linear-gradient(${90 - angle}deg, ${cols.join(", ")})`;
      }
    }
    if (stroke) {
      const w = this.dp(stroke.getAttribute("android:width"), ctx) || 1;
      const c = this.col(stroke.getAttribute("android:color"), ctx) || "#000";
      if (this.dp(stroke.getAttribute("android:dashWidth"), ctx)) { st.outline = `${w}px dashed ${c}`; st.outlineOffset = `-${w}px`; }
      else st.boxShadow = [`inset 0 0 0 ${w}px ${c}`, d._shadow].filter(Boolean).join(", ");
    }
    if (shape === "oval") st.borderRadius = "50%";
    else if (shape === "line") {
      const w = this.dp(stroke?.getAttribute("android:width"), ctx) || 1;
      const c = this.col(stroke?.getAttribute("android:color"), ctx) || "#000";
      st.boxShadow = "";
      st.backgroundColor = "transparent";
      st.backgroundImage = `linear-gradient(transparent calc(50% - ${w / 2}px), ${c} calc(50% - ${w / 2}px), ${c} calc(50% + ${w / 2}px), transparent calc(50% + ${w / 2}px))`;
    } else if (shape === "ring") {
      st.borderRadius = "50%";
    } else if (corners) {
      const r = this.dp(corners.getAttribute("android:radius"), ctx) ?? 0;
      const c = (k) => this.dp(corners.getAttribute("android:" + k), ctx) ?? r;
      st.borderRadius = `${c("topLeftRadius")}px ${c("topRightRadius")}px ${c("bottomRightRadius")}px ${c("bottomLeftRadius")}px`;
    }
    const size = get("size");
    if (size) d._intrinsic = { w: this.dp(size.getAttribute("android:width"), ctx), h: this.dp(size.getAttribute("android:height"), ctx) };
  }

  // <vector> -> { url (svg data url), w, h }
  vector(el, ctx, tint) {
    if (!el) return null;
    const num = (k, dflt) => { const v = parseFloat(el.getAttribute("android:" + k)); return isNaN(v) ? dflt : v; };
    const vw = num("viewportWidth", 24), vh = num("viewportHeight", 24);
    const w = this.dp(el.getAttribute("android:width"), ctx) || vw, hh = this.dp(el.getAttribute("android:height"), ctx) || vh;
    const ownTint = !tint && el.getAttribute("android:tint") ? this.col(el.getAttribute("android:tint"), ctx) : null;
    const t = tint || ownTint;
    const colorOf = (node, attr) => {
      let raw = node.getAttribute("android:" + attr);
      if (!raw) {
        const aapt = [...node.children].find((c) => c.tagName === "aapt:attr" && c.getAttribute("name") === "android:" + attr);
        const g = aapt && aapt.getElementsByTagName("gradient")[0];
        if (g) raw = g.getAttribute("android:startColor") || g.getElementsByTagName("item")[0]?.getAttribute("android:color");
      }
      if (!raw) return null;
      const c = this.col(raw, ctx);
      if (!c || c === "transparent" || /rgba\(\d+, \d+, \d+, 0\)/.test(c)) return null;
      return t || c;
    };
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    let clipN = 0;
    const walk = (node) => {
      let out = "", openClips = 0;
      for (const ch of node.children) {
        const g = (k) => ch.getAttribute("android:" + k);
        if (ch.tagName === "path") {
          const fill = colorOf(ch, "fillColor"), stroke = colorOf(ch, "strokeColor");
          if (!fill && !stroke) continue;
          let s = `<path d="${esc(g("pathData") || "")}" fill="${fill || "none"}"`;
          if (g("fillAlpha")) s += ` fill-opacity="${g("fillAlpha")}"`;
          if (g("fillType") === "evenOdd") s += ` fill-rule="evenodd"`;
          if (stroke) {
            s += ` stroke="${stroke}" stroke-width="${parseFloat(g("strokeWidth") || 1)}"`;
            if (g("strokeAlpha")) s += ` stroke-opacity="${g("strokeAlpha")}"`;
            if (g("strokeLineCap")) s += ` stroke-linecap="${g("strokeLineCap")}"`;
            if (g("strokeLineJoin")) s += ` stroke-linejoin="${g("strokeLineJoin")}"`;
          }
          out += s + "/>";
        } else if (ch.tagName === "group") {
          const n = (k, dflt) => { const v = parseFloat(g(k)); return isNaN(v) ? dflt : v; };
          const px = n("pivotX", 0), py = n("pivotY", 0);
          const tf = `translate(${n("translateX", 0) + px} ${n("translateY", 0) + py}) rotate(${n("rotation", 0)}) scale(${n("scaleX", 1)} ${n("scaleY", 1)}) translate(${-px} ${-py})`;
          out += `<g transform="${tf}">${walk(ch)}</g>`;
        } else if (ch.tagName === "clip-path") {
          const id = `c${++clipN}`;
          out += `<clipPath id="${id}"><path d="${esc(g("pathData") || "")}"/></clipPath><g clip-path="url(#${id})">`;
          openClips++;
        }
      }
      return out + "</g>".repeat(openClips);
    };
    const alpha = parseFloat(el.getAttribute("android:alpha"));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${w}" height="${hh}" preserveAspectRatio="none"${isNaN(alpha) ? "" : ` opacity="${alpha}"`}>${walk(el)}</svg>`;
    return { url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), w, h: hh };
  }

  // An <img>-like element showing a drawable (src of ImageView, icons...). -> { node, w, h }
  icon(ref, ctx, tint, fit = "contain") {
    const src = this.drawableSrc(ref, ctx);
    if (!src) return null;
    if (src.img) {
      if (tint) {
        const m = h("div", "icon", { backgroundColor: tint, maskImage: `url("${src.img.url}")`, webkitMaskImage: `url("${src.img.url}")`, maskSize: fit === "cover" ? "cover" : fit === "fill" ? "100% 100%" : "contain", webkitMaskSize: fit === "cover" ? "cover" : fit === "fill" ? "100% 100%" : "contain", maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat", maskPosition: "center", webkitMaskPosition: "center" });
        return { node: m, w: src.img.w, h: src.img.h };
      }
      const img = h("img", "icon", { objectFit: fit });
      img.src = src.img.url;
      img.alt = "";
      return { node: img, w: src.img.w, h: src.img.h };
    }
    let el = src.el;
    if (el && /^(selector|animated-selector|level-list|ripple|layer-list|inset|bitmap)$/.test(el.tagName) && el.tagName !== "layer-list") {
      if (el.tagName === "bitmap") return this.icon(el.getAttribute("android:src"), ctx, tint, fit);
      const it = el.tagName === "inset" ? el : el.tagName === "ripple" ? [...el.children].find((c) => c.tagName === "item" && c.getAttribute("android:id") !== "@android:id/mask") : this.pickItem(el);
      if (it) {
        const ref2 = it.getAttribute("android:drawable");
        if (ref2) return this.icon(ref2, ctx, tint, fit);
        const child = [...it.children][0];
        if (child) el = child;
      }
    }
    if (el && (el.tagName === "vector" || el.tagName === "animated-vector")) {
      const v = this.vector(el.tagName === "vector" ? el : this.drawableSrc(el.getAttribute("android:drawable"), ctx)?.el, ctx, tint);
      if (!v) return null;
      const img = h("img", "icon", { objectFit: fit === "cover" ? "cover" : "contain" });
      img.src = v.url;
      img.alt = "";
      return { node: img, w: v.w, h: v.h };
    }
    if (src.color) return { node: h("div", "icon", { background: tint || src.color }), w: 0, h: 0 };
    const div = h("div", "icon");
    this.paint(div, src, ctx, tint);
    return { node: div, w: div._intrinsic?.w || 0, h: div._intrinsic?.h || 0 };
  }

  // ---------------------------------------------------------------- text

  fontCss(a, ctx, defaults = {}) {
    const st = {};
    const fam = a.fontFamily ?? ctx.theme.attr("fontFamily") ?? ctx.theme.attr("android:fontFamily");
    let weight = defaults.weight || 400;
    let family = BASE_FONT;
    if (fam) {
      const r = this.res.resolve(fam, ctx.theme) || "";
      const proj = this.res.font(r, ctx.theme);
      if (proj) family = `"${proj}", ${BASE_FONT}`;
      else if (/medium/.test(r)) weight = 500;
      else if (/light/.test(r)) weight = 300;
      else if (/thin/.test(r)) weight = 200;
      else if (/black/.test(r)) weight = 900;
      if (/monospace/.test(r)) family = "ui-monospace, Consolas, monospace";
      if (/^serif/.test(r)) family = "Georgia, serif";
      if (/condensed/.test(r)) st.fontStretch = "condensed";
    }
    const ts = a.textStyle || "";
    if (/bold/.test(ts)) weight = 700;
    if (/italic/.test(ts)) st.fontStyle = "italic";
    if (a.textFontWeight) weight = parseInt(a.textFontWeight, 10) || weight;
    st.fontFamily = family;
    st.fontWeight = weight;
    return st;
  }

  textStyle(t, a, ctx, def = {}) {
    const size = this.dp(a.textSize, ctx) ?? def.size ?? 14;
    const color = this.col(a.textColor, ctx) ?? def.color ?? this.col("?android:textColorSecondary", ctx) ?? "#666";
    Object.assign(t.style, this.fontCss(a, ctx, def), { fontSize: size + "px", color });
    const ls = parseFloat(a.letterSpacing);
    if (!isNaN(ls)) t.style.letterSpacing = ls + "em";
    else if (def.letterSpacing) t.style.letterSpacing = def.letterSpacing + "em";
    const extra = this.dp(a.lineSpacingExtra, ctx) || 0, mult = parseFloat(a.lineSpacingMultiplier) || 1;
    const lh = this.dp(a.lineHeight, ctx);
    t.style.lineHeight = lh ? lh + "px" : (size * 1.18 * mult + extra) + "px";
    const caps = a.textAllCaps ?? def.caps;
    if (caps === "true" || caps === true) t.style.textTransform = "uppercase";
    return { size, color };
  }

  textContent(a, ctx) {
    const t = this.str(a.text, ctx);
    return t && !/^@\w+\//.test(t) ? t : "";
  }

  // TextView-like content (text + compound drawables), aligned by gravity
  textBody(d, a, ctx, def = {}) {
    const g = gravityOf(a.gravity || def.gravity);
    const text = this.textContent(a, ctx);
    const hint = text ? null : this.str(a.hint, ctx);
    const span = h("span", "txt");
    const { size, color } = this.textStyle(span, a, ctx, def);
    span.textContent = text || hint || "";
    if (!text && hint) span.style.color = this.col(a.textColorHint, ctx) || this.col("?android:textColorHint", ctx) || "rgba(128,128,128,.7)";
    span.style.textAlign = g.h === "center" ? "center" : g.h === "end" ? "right" : "left";
    const maxLines = parseInt(a.maxLines || a.lines, 10) || (a.singleLine === "true" ? 1 : 0);
    if (maxLines === 1) { span.style.whiteSpace = "nowrap"; span.style.overflow = "hidden"; span.style.textOverflow = a.ellipsize ? "ellipsis" : "clip"; }
    else if (maxLines > 1) { span.classList.add("clamp"); span.style.webkitLineClamp = maxLines; }
    d.classList.add("textual");
    const st = d.style;
    st.display = "flex";
    // compound drawables
    const tint = this.col(a.drawableTint, ctx);
    const comp = {};
    for (const side of ["Start", "Left", "Top", "End", "Right", "Bottom"]) {
      const ref = a["drawable" + side] || a["drawable" + side + "Compat"];
      if (!ref) continue;
      const ic = this.icon(ref, ctx, tint);
      if (!ic) continue;
      ic.node.style.width = (ic.w || size) + "px";
      ic.node.style.height = (ic.h || size) + "px";
      ic.node.style.flex = "none";
      comp[{ Left: "Start", Right: "End" }[side] || side] = ic.node;
    }
    const gap = (this.dp(a.drawablePadding, ctx) ?? 0) + "px";
    const vertical = comp.Top || comp.Bottom;
    st.flexDirection = vertical ? "column" : "row";
    st.gap = gap;
    if (vertical) { st.alignItems = FLEX[g.h] || "flex-start"; st.justifyContent = FLEX[g.v] || "flex-start"; }
    else { st.alignItems = FLEX[g.v] || (comp.Start || comp.End ? "center" : "flex-start"); st.justifyContent = FLEX[g.h] || "flex-start"; }
    if (comp.Start) d.append(comp.Start);
    if (comp.Top) d.append(comp.Top);
    span.style.minWidth = "0";
    if (!vertical && (comp.End) && g.h !== "center") span.style.flex = "1 1 auto";
    d.append(span);
    if (comp.End) d.append(comp.End);
    if (comp.Bottom) d.append(comp.Bottom);
    return { span, size, color };
  }

  // ---------------------------------------------------------------- containers

  k_linear(d, a, x, ctx) {
    const vert = a.orientation === "vertical" || (d.dataset.tag === "TableLayout");
    const st = d.style;
    st.display = "flex";
    st.flexDirection = vert ? "column" : "row";
    const g = gravityOf(a.gravity);
    st.justifyContent = FLEX[vert ? g.v : g.h] || "flex-start";
    st.alignItems = FLEX[vert ? g.h : g.v] || "flex-start";
    if (d.dataset.tag === "TableRow" || d.dataset.tag === "TableLayout") st.alignItems = "stretch";
    this.children(d, x, ctx, vert ? "vlinear" : "hlinear");
  }

  k_radiogroup(d, a, x, ctx) {
    if (!a.orientation) a.orientation = "vertical";
    const checked = (a.checkedButton || "").replace(/^@\+?id\//, "");
    this.k_linear(d, a, x, { ...ctx, checkedRadio: checked });
  }

  k_frame(d, a, x, ctx) {
    const st = d.style;
    st.display = "grid";
    st.gridTemplate = "minmax(0, 1fr) / minmax(0, 1fr)";
    this.children(d, x, ctx, "frame");
  }

  k_drawer(d, a, x, ctx) {
    this.k_frame(d, a, x, ctx);
    // only the main content shows; drawers (layout_gravity start/end) stay closed
    [...d.children].slice(1).forEach((c) => { if (c._a && /start|end|left|right/.test(c._a.layout_gravity || "")) c.style.display = "none"; });
  }

  k_card(d, a, x, ctx) {
    const st = d.style;
    const m3 = ctx.theme.family === "m3";
    const material = d.dataset.tag === "MaterialCardView";
    const bg = this.col(a.cardBackgroundColor, ctx) || (a.background ? null : this.col(m3 ? "?colorSurface" : "?colorSurface", ctx) || "#fff");
    if (a.background) this.background(d, a.background, ctx);
    else if (bg) st.backgroundColor = bg;
    const r = this.dp(a.cardCornerRadius, ctx) ?? (material ? (m3 ? 12 : 4) : 2);
    st.borderRadius = r + "px";
    const shadows = [];
    const elev = this.dp(a.cardElevation, ctx) ?? (material && m3 ? 0 : 2);
    if (elev) shadows.push(`0 ${Math.min(elev, 10) / 2}px ${Math.min(elev, 10) * 1.2}px rgba(0,0,0,.22)`);
    const sw = this.dp(a.strokeWidth, ctx) ?? (material && m3 && /Outlined|^$/.test(a._chain || "") && elev === 0 ? 1 : 0);
    if (sw) shadows.push(`inset 0 0 0 ${sw}px ${this.col(a.strokeColor, ctx) || this.col("?colorOutlineVariant", ctx) || "#ccc"}`);
    st.boxShadow = shadows.join(", ");
    st.overflow = "hidden";
    const cp = this.dp(a.contentPadding, ctx);
    if (cp) st.padding = cp + "px";
    this.k_frame(d, a, x, ctx);
  }

  k_scroll(d, a, x, ctx) {
    const st = d.style;
    st.display = "block";
    st.overflow = ctx.interactive ? "auto" : "hidden";
    d.classList.add("scrollable");
    const parent = { type: "scroll", el: d, fill: a.fillViewport === "true" };
    for (const ch of x.children) { const o = this.node(ch, parent, ctx); for (const n of [o].flat()) if (n) d.append(n); }
  }

  k_hscroll(d, a, x, ctx) {
    const st = d.style;
    st.display = "flex";
    st.overflow = ctx.interactive ? "auto" : "hidden";
    this.children(d, x, ctx, "hscroll");
  }

  k_constraint(d, a, x, ctx) {
    d.style.position = d.style.position || "relative";
    this.children(d, x, ctx, "abs");
  }

  k_relative(d, a, x, ctx) { this.k_constraint(d, a, x, ctx); }

  k_coordinator(d, a, x, ctx) {
    const st = d.style;
    st.display = "flex";
    st.flexDirection = "column";
    st.position = st.position || "relative";
    this.children(d, x, ctx, "coordinator");
  }

  k_appbar(d, a, x, ctx) {
    if (!a.background) d.style.backgroundColor = this.col(ctx.theme.family === "m3" ? "?colorSurface" : "?colorPrimary", ctx);
    a.orientation = "vertical";
    this.k_linear(d, a, x, ctx);
  }

  k_flow(d, a, x, ctx) {
    const st = d.style;
    st.display = "flex";
    st.flexWrap = a.singleLine === "true" ? "nowrap" : "wrap";
    const gap = this.dp(a.chipSpacing, ctx) ?? 8;
    st.columnGap = (this.dp(a.chipSpacingHorizontal, ctx) ?? gap) + "px";
    st.rowGap = (this.dp(a.chipSpacingVertical, ctx) ?? gap) + "px";
    st.alignItems = "center";
    this.children(d, x, ctx, "flow");
  }

  k_gridlayout(d, a, x, ctx) {
    const st = d.style;
    const cols = parseInt(a.columnCount, 10) || 2;
    st.display = "grid";
    st.gridTemplateColumns = `repeat(${cols}, auto)`;
    this.children(d, x, ctx, "grid");
    for (const c of d.children) {
      const ca = c._a || {};
      if (ca.layout_row != null) c.style.gridRow = `${+ca.layout_row + 1} / span ${ca.layout_rowSpan || 1}`;
      if (ca.layout_column != null) c.style.gridColumn = `${+ca.layout_column + 1} / span ${ca.layout_columnSpan || 1}`;
      if (ca.layout_columnWeight) c.style.justifySelf = "stretch";
    }
  }

  k_fragment(d, a, x, ctx) {
    this.k_frame(d, a, x, ctx);
    const cls = (a.name || a.class || "").split(".").pop();
    let layout = (a._tools.layout || "").replace("@layout/", "") || null;
    if (cls === "NavHostFragment") {
      const graph = (a.navGraph || "").replace("@navigation/", "");
      const doc = this.res.doc("navigation", graph);
      const start = doc && (doc.documentElement.getAttribute("app:startDestination") || "").replace(/^@\+?id\//, "");
      const startEl = start && [...doc.getElementsByTagName("*")].find((e) => (e.getAttribute("android:id") || "").replace(/^@\+?id\//, "") === start);
      const startCls = startEl && (startEl.getAttribute("android:name") || "").split(".").pop();
      layout = layout || (startEl && (startEl.getAttribute("tools:layout") || "").replace("@layout/", "")) || this.model.classes[startCls]?.layout;
    } else if (!layout && this.model.classes[cls]) layout = this.model.classes[cls].layout;
    const id = d.dataset.vid;
    if (ctx.fragmentInto && ctx.fragmentInto.container === id) return;  // node() adds the screen's fragment
    if (layout) {
      const inner = this.layoutRoot(layout, ctx, { type: "frame" });
      if (inner) d.append(inner);
    } else this.placeholder(d, cls || "Fragment");
  }

  k_pager(d, a, x, ctx) {
    this.k_frame(d, a, x, ctx);
    if (!d.children.length) this.placeholder(d, d.dataset.tag);
  }

  k_list(d, a, x, ctx) {
    const st = d.style;
    st.overflow = "hidden";
    let item = (a._tools.listitem || "").replace("@layout/", "");
    if (!item || !this.res.doc("layout", item)) item = ctx.items && ctx.items.length ? ctx.items.shift() : null;
    const horizontal = /horizontal/.test(a._tools.orientation || a.orientation || "") || /LinearLayoutManager.*HORIZONTAL/.test(a._tools.layoutManager || "");
    const span = parseInt(a._tools.spanCount || a.spanCount || a.numColumns, 10) || (/Grid/.test(d.dataset.tag + (a._tools.layoutManager || "")) ? 2 : 1);
    const count = parseInt(a._tools.itemCount, 10) || (span > 1 ? span * 4 : 6);
    if (span > 1) { st.display = "grid"; st.gridTemplateColumns = `repeat(${span}, minmax(0, 1fr))`; st.alignContent = "start"; }
    else { st.display = "flex"; st.flexDirection = horizontal ? "row" : "column"; }
    const divider = d.dataset.tag === "ListView" && !a.divider ? this.col("?colorOutlineVariant", ctx) || "rgba(128,128,128,.25)" : null;
    if (!item) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = h("div", "list-skeleton");
        row.innerHTML = `<i></i><span><b></b><b></b></span>`;
        d.append(row);
      }
      d.dataset.note = "List items are created in code";
      return;
    }
    d.dataset.item = item;
    for (let i = 0; i < count; i++) {
      const row = this.layoutRoot(item, { ...ctx, items: [] }, { type: horizontal ? "hscroll" : "row" });
      if (!row) break;
      row.classList.add("list-row");
      if (i > 0) row.dataset.copy = "1";
      if (divider && i > 0) row.style.borderTop = `1px solid ${divider}`;
      if (horizontal) row.style.flex = "0 0 auto";
      d.append(row);
    }
  }

  // ---------------------------------------------------------------- widgets

  k_text(d, a, x, ctx) {
    this.textBody(d, a, ctx, { size: 14, color: this.col("?android:textColorSecondary", ctx) });
    if (d.dataset.tag === "CheckedTextView" && a.checkMark) {
      const ic = this.icon(a.checkMark, ctx, this.col(a.checkMarkTint, ctx));
      if (ic) { ic.node.style.width = ic.node.style.height = "24px"; ic.node.style.marginLeft = "auto"; d.append(ic.node); }
    }
  }

  buttonVariant(a) {
    const c = a._chain || "";
    if (/OutlinedButton/.test(c)) return "outlined";
    if (/TextButton/.test(c)) return "text";
    if (/TonalButton/.test(c)) return "tonal";
    if (/ElevatedButton/.test(c)) return "elevated";
    return "filled";
  }

  k_button(d, a, x, ctx) {
    const st = d.style;
    const t = ctx.theme;
    const material = t.family !== "appcompat" || d.dataset.tag === "MaterialButton";
    const variant = material ? this.buttonVariant(a) : "legacy";
    const m3 = t.family === "m3";
    let fill, text;
    if (variant === "legacy") { fill = t.dark ? "#5a5a5a" : "#d6d7d7"; text = t.dark ? "#fff" : "#000000de"; }
    else if (variant === "filled") { fill = this.col("?colorPrimary", ctx); text = this.col("?colorOnPrimary", ctx); }
    else if (variant === "tonal") { fill = this.col("?colorSecondaryContainer", ctx); text = this.col("?colorOnSecondaryContainer", ctx); }
    else if (variant === "elevated") { fill = this.col("?colorSurfaceContainer", ctx) || this.col("?colorSurface", ctx); text = this.col("?colorPrimary", ctx); }
    else { fill = "transparent"; text = this.col("?colorPrimary", ctx); }
    const tint = a.backgroundTint && a.backgroundTint !== "@null" ? this.col(a.backgroundTint, ctx) : null;
    if (d._customBg && (!material || a.backgroundTint === "@null" || !tint)) this.background(d, a.background, ctx);
    else st.backgroundColor = tint || fill;
    const radius = this.dp(a.cornerRadius, ctx) ?? (variant === "legacy" ? 2 : m3 ? 20 : 4);
    if (!d._customBg || tint) st.borderRadius = radius + "px";
    const sw = this.dp(a.strokeWidth, ctx) ?? (variant === "outlined" ? 1 : 0);
    if (sw) st.boxShadow = [`inset 0 0 0 ${sw}px ${this.col(a.strokeColor, ctx) || this.col("?colorOutline", ctx)}`, d._shadow].filter(Boolean).join(", ");
    if (variant === "elevated" || variant === "legacy") st.boxShadow = [st.boxShadow, "0 1px 3px rgba(0,0,0,.25)"].filter(Boolean).join(", ");
    const pad = d._pad;
    if (pad.l == null) st.paddingLeft = (variant === "text" ? 12 : m3 ? 24 : 16) + "px";
    if (pad.r == null) st.paddingRight = (variant === "text" ? 12 : m3 ? 24 : 16) + "px";
    if (pad.t == null) st.paddingTop = "4px";
    if (pad.b == null) st.paddingBottom = "4px";
    // MaterialButton keeps 6dp of empty inset above and below the visible button
    const inset = material ? (this.dp(a.insetTop, ctx) ?? 6) : 0;
    const insetB = material ? (this.dp(a.insetBottom, ctx) ?? 6) : 0;
    if (inset || insetB) {
      const m = d._m;
      if (d.style.position !== "absolute") st.margin = `${m.t + inset}px ${m.r}px ${m.b + insetB}px ${m.l}px`;
      else d._m = { ...m, t: m.t + inset, b: m.b + insetB };
      if (d._h.mode === "fixed") st.height = st.minHeight = (d._h.px - inset - insetB) + "px";
    }
    if (!a.minHeight && d._h.mode !== "fixed") st.minHeight = (material ? 36 : 48) + "px";
    if (!a.minWidth && d._w.mode !== "fixed") st.minWidth = (material ? 64 : 88) + "px";
    const body = this.textBody(d, { gravity: "center", ...a, textColor: a.textColor }, ctx, {
      size: 14, weight: 500, color: text, caps: material && m3 ? false : "true", letterSpacing: m3 ? 0.007 : 0.09, gravity: "center",
    });
    body.span.style.whiteSpace = body.span.style.whiteSpace || "nowrap";
    if (a.icon) {
      const ic = this.icon(a.icon, ctx, this.col(a.iconTint, ctx) || body.color);
      if (ic) {
        const s = this.dp(a.iconSize, ctx) || 18;
        Object.assign(ic.node.style, { width: s + "px", height: s + "px", flex: "none" });
        d.style.gap = (this.dp(a.iconPadding, ctx) ?? 8) + "px";
        if (/end/.test(a.iconGravity || "")) d.append(ic.node); else d.insertBefore(ic.node, body.span);
        if (!body.span.textContent) { d.style.paddingLeft = d.style.paddingRight = "12px"; d.style.minWidth = "0"; }
      }
    }
  }

  k_efab(d, a, x, ctx) {
    a = { ...a, cornerRadius: a.cornerRadius || (ctx.theme.family === "m3" ? "16dp" : "28dp") };
    d._customBg = false;
    if (!a.backgroundTint) a.backgroundTint = ctx.theme.family === "m3" ? "?colorPrimaryContainer" : "?colorSecondary";
    if (!a.textColor) a.textColor = ctx.theme.family === "m3" ? "?colorOnPrimaryContainer" : "?colorOnSecondary";
    a.insetTop = a.insetBottom = "0dp";
    if (!a.minHeight) d.style.minHeight = "56px";
    this.k_button(d, a, x, ctx);
    d.style.boxShadow = "0 3px 8px rgba(0,0,0,.3)";
  }

  k_fab(d, a, x, ctx) {
    const st = d.style;
    const m3 = ctx.theme.family === "m3";
    const size = this.dp(a.fabCustomSize, ctx) || (a.fabSize === "mini" ? 40 : 56);
    this.fixSize(d, size, size);
    Object.assign(st, { display: "flex", alignItems: "center", justifyContent: "center", flex: "none" });
    st.borderRadius = m3 ? (a.fabSize === "mini" ? 12 : 16) + "px" : "50%";
    st.backgroundColor = this.col(a.backgroundTint, ctx) || this.col(m3 ? "?colorPrimaryContainer" : "?colorSecondary", ctx);
    st.boxShadow = "0 3px 8px rgba(0,0,0,.3)";
    const ic = this.icon(a.src || a.srcCompat, ctx, this.col(a.tint, ctx) || this.col(m3 ? "?colorOnPrimaryContainer" : "?colorOnSecondary", ctx));
    if (ic) { Object.assign(ic.node.style, { width: "24px", height: "24px" }); d.append(ic.node); }
  }

  k_edit(d, a, x, ctx) {
    const st = d.style;
    const inTil = ctx.inTil;
    if (!a.background && !inTil) {
      st.boxShadow = `inset 0 -1.5px 0 ${this.col(a.backgroundTint, ctx) || this.col("?colorControlNormal", ctx) || "#888"}`;
    }
    if (d._pad.t == null) st.paddingTop = inTil ? "16px" : "10px";
    if (d._pad.b == null) st.paddingBottom = inTil ? "16px" : "10px";
    if (d._pad.l == null) st.paddingLeft = inTil ? "16px" : "4px";
    if (d._pad.r == null) st.paddingRight = inTil ? "16px" : "4px";
    if (!a.minHeight && !inTil) st.minHeight = "48px";
    const tc = this.col("?android:textColorPrimary", ctx) || this.col("?colorOnSurface", ctx);
    this.textBody(d, { gravity: "center_vertical", ...a, hint: inTil ? null : a.hint }, ctx, { size: inTil ? 16 : 18, color: tc });
    if (inTil && !this.textContent(a, ctx) && ctx.inTil.hint) {
      const span = d.querySelector(".txt");
      span.textContent = ctx.inTil.hint;
      span.style.color = this.col("?colorOnSurfaceVariant", ctx) || this.col("?android:textColorHint", ctx);
    }
    if (a.inputType && /Password/.test(a.inputType) && this.textContent(a, ctx)) {
      const span = d.querySelector(".txt");
      span.textContent = "•".repeat(Math.min(12, span.textContent.length));
    }
  }

  k_til(d, a, x, ctx) {
    const st = d.style;
    const chain = a._chain || "";
    const outlined = /OutlinedBox/.test(chain) || a.boxBackgroundMode === "outline";
    const m3 = ctx.theme.family === "m3";
    const r = this.dp(a.boxCornerRadiusTopStart, ctx) ?? (m3 ? 4 : 4);
    st.display = "flex";
    st.flexDirection = "column";
    st.position = st.position || "relative";
    const field = h("div", "til-box");
    Object.assign(field.style, { display: "flex", alignItems: "center", borderRadius: outlined ? r + "px" : `${r}px ${r}px 0 0`, position: "relative" });
    const strokeC = this.col(a.boxStrokeColor, ctx) || this.col("?colorOutline", ctx) || "#888";
    if (outlined) field.style.boxShadow = `inset 0 0 0 ${this.dp(a.boxStrokeWidth, ctx) ?? 1}px ${strokeC}`;
    else {
      field.style.backgroundColor = this.col(a.boxBackgroundColor, ctx) || this.col("?colorSurfaceVariant", ctx) || "rgba(0,0,0,.06)";
      field.style.boxShadow = `inset 0 -1px 0 ${this.col("?colorOnSurfaceVariant", ctx) || "#666"}`;
    }
    if (a.background) this.background(field, a.background, ctx);
    const bg = this.col(a.boxBackgroundColor, ctx);
    if (bg && outlined) field.style.backgroundColor = bg;
    const hint = this.str(a.hint, ctx);
    if (a.startIconDrawable) {
      const ic = this.icon(a.startIconDrawable, ctx, this.col(a.startIconTint, ctx) || this.col("?colorOnSurfaceVariant", ctx));
      if (ic) { Object.assign(ic.node.style, { width: "24px", height: "24px", marginLeft: "12px", flex: "none" }); field.append(ic.node); }
    }
    const inner = { type: "vlinear", el: field };
    const box = h("div", "", { flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0 });
    field.append(box);
    for (const ch of x.children) {
      const n = this.node(ch, inner, { ...ctx, inTil: { hint } });
      for (const o of [n].flat()) if (o) { o.style.alignSelf = "stretch"; box.append(o); }
    }
    if (a.endIconMode === "password_toggle" || a.endIconDrawable || a.endIconMode === "clear_text" || a.endIconMode === "dropdown_menu") {
      const ic = h("div", "til-end");
      ic.textContent = a.endIconMode === "dropdown_menu" ? "▾" : a.endIconMode === "clear_text" ? "✕" : "";
      if (a.endIconMode === "password_toggle") ic.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`;
      if (a.endIconDrawable) { const e = this.icon(a.endIconDrawable, ctx, this.col(a.endIconTint, ctx) || this.col("?colorOnSurfaceVariant", ctx)); if (e) { ic.textContent = ""; Object.assign(e.node.style, { width: "24px", height: "24px" }); ic.append(e.node); } }
      ic.style.color = this.col(a.endIconTint, ctx) || this.col("?colorOnSurfaceVariant", ctx);
      field.append(ic);
    }
    d.append(field);
    if (a.helperText) {
      const help = h("div", "til-help");
      help.textContent = this.str(a.helperText, ctx);
      help.style.color = this.col("?colorOnSurfaceVariant", ctx);
      d.append(help);
    }
  }

  markBox(kind, checked, color, off, ctx) {
    const box = h("div", `mark mark-${kind}`);
    if (kind === "check") {
      Object.assign(box.style, { width: "18px", height: "18px", borderRadius: "2px", boxShadow: checked ? "none" : `inset 0 0 0 2px ${off}`, background: checked ? color : "transparent" });
      if (checked) box.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="${this.col("?colorOnPrimary", ctx) || "#fff"}" stroke-width="3"/></svg>`;
    } else {
      Object.assign(box.style, { width: "20px", height: "20px", borderRadius: "50%", boxShadow: `inset 0 0 0 2px ${checked ? color : off}` });
      if (checked) box.innerHTML = `<i style="background:${color}"></i>`;
    }
    return box;
  }

  k_check(d, a, x, ctx, kind = "check") {
    const checked = a.checked === "true" || (kind === "radio" && ctx.checkedRadio && ctx.checkedRadio === d.dataset.vid);
    const color = this.col(a.buttonTint, ctx) || this.col("?colorPrimary", ctx);
    const off = this.col(a.buttonTint, ctx) || this.col("?colorOnSurfaceVariant", ctx) || this.col("?colorControlNormal", ctx) || "#777";
    if (a.button === "@null" || a.button === "@android:color/transparent") {
      // a custom-styled toggle (button removed, background shows state)
      this.textBody(d, { gravity: "center", ...a }, ctx, { size: 14, color: this.col("?android:textColorPrimary", ctx) });
      return;
    }
    const mark = a.button ? (this.icon(a.button, ctx, null)?.node || this.markBox(kind, checked, color, off, ctx)) : this.markBox(kind, checked, color, off, ctx);
    if (a.button && mark.tagName === "IMG") Object.assign(mark.style, { width: "24px", height: "24px" });
    mark.style.flex = "none";
    mark.style.margin = "0 8px 0 3px";
    if (!a.minHeight) d.style.minHeight = "48px";
    this.textBody(d, { gravity: "center_vertical", ...a }, ctx, { size: 14, color: this.col("?android:textColorPrimary", ctx) || this.col("?colorOnSurface", ctx) });
    d.style.alignItems = "center";
    d.insertBefore(mark, d.firstChild);
  }

  k_radio(d, a, x, ctx) { this.k_check(d, a, x, ctx, "radio"); }

  k_switch(d, a, x, ctx) {
    const checked = a.checked === "true";
    const m3 = ctx.theme.family === "m3" || d.dataset.tag === "MaterialSwitch";
    if (d.dataset.tag === "ToggleButton") { a = { ...a, text: checked ? a.textOn || "ON" : a.textOff || "OFF" }; this.k_button(d, a, x, ctx); return; }
    if (!a.minHeight) d.style.minHeight = "48px";
    const text = this.textContent(a, ctx);
    this.textBody(d, { gravity: "center_vertical", ...a }, ctx, { size: 14, color: this.col("?android:textColorPrimary", ctx) || this.col("?colorOnSurface", ctx) });
    d.style.alignItems = "center";
    d.style.justifyContent = "space-between";
    d.style.gap = "12px";
    if (text) d.querySelector(".txt").style.flex = "1 1 auto";
    const on = this.col(a.trackTint, ctx) || this.col(a.thumbTint, ctx) || this.col("?colorPrimary", ctx);
    const track = h("div", "sw-track");
    const thumb = h("i");
    track.append(thumb);
    if (m3) {
      Object.assign(track.style, { width: "52px", height: "32px", borderRadius: "16px", background: checked ? on : this.col("?colorSurfaceVariant", ctx) || "#ddd", boxShadow: checked ? "none" : `inset 0 0 0 2px ${this.col("?colorOutline", ctx)}` });
      Object.assign(thumb.style, { width: checked ? "24px" : "16px", height: checked ? "24px" : "16px", left: checked ? "24px" : "8px", background: checked ? this.col("?colorOnPrimary", ctx) : this.col("?colorOutline", ctx) });
    } else {
      Object.assign(track.style, { width: "36px", height: "14px", borderRadius: "7px", background: checked ? withAlpha(on, 0.5) : "rgba(128,128,128,.4)" });
      Object.assign(thumb.style, { width: "20px", height: "20px", left: checked ? "16px" : "0", top: "-3px", background: checked ? on : "#ececec", boxShadow: "0 1px 2px rgba(0,0,0,.4)" });
    }
    d.append(track);
  }

  k_seek(d, a, x, ctx) {
    const st = d.style;
    if (d._h.mode !== "fixed") this.fixSize(d, null, 40);
    st.display = "flex";
    st.alignItems = "center";
    const max = parseFloat(a.max ?? a.valueTo ?? 100) || 100;
    const min = parseFloat(a.valueFrom ?? a.min ?? 0) || 0;
    const v = parseFloat(a.progress ?? a.value ?? (min + max) / 2);
    const pct = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
    const color = this.col(a.progressTint, ctx) || this.col(a.trackColorActive, ctx) || this.col("?colorPrimary", ctx);
    const track = h("div", "seek-track", { background: this.col(a.progressBackgroundTint, ctx) || this.col(a.trackColorInactive, ctx) || withAlpha(color, 0.3) || "#ccc" });
    const fill = h("div", "seek-fill", { width: pct * 100 + "%", background: color });
    const thumb = h("div", "seek-thumb", { left: pct * 100 + "%", background: this.col(a.thumbTint, ctx) || color });
    track.append(fill, thumb);
    const wrap = h("div", "", { flex: "1", margin: "0 12px", position: "relative" });
    wrap.append(track);
    d.append(wrap);
  }

  k_progress(d, a, x, ctx) {
    const st = d.style;
    const horizontal = /Horizontal/.test(a._chain + " " + (a.style || "")) || d.dataset.tag === "LinearProgressIndicator";
    const color = this.col(a.progressTint, ctx) || this.col(a.indicatorColor, ctx) || this.col("?colorPrimary", ctx) || "#6750a4";
    const max = parseFloat(a.max) || 100;
    const indeterminate = a.indeterminate === "true" || (!horizontal && a.progress == null) || (horizontal && a.progress == null && d.dataset.tag !== "LinearProgressIndicator");
    const pct = indeterminate ? (horizontal ? 0.35 : 0.7) : Math.max(0, Math.min(1, parseFloat(a.progress || 0) / max));
    if (horizontal) {
      const th = this.dp(a.trackThickness, ctx) || 4;
      if (d._h.mode !== "fixed") this.fixSize(d, null, th);
      const track = this.col(a.progressBackgroundTint, ctx) || this.col(a.trackColor, ctx) || withAlpha(color, 0.25);
      st.background = `linear-gradient(90deg, ${color} ${pct * 100}%, ${track} ${pct * 100}%)`;
      st.borderRadius = (this.dp(a.trackCornerRadius, ctx) ?? th / 2) + "px";
      if (a.progressDrawable) { st.background = ""; this.background(d, a.progressDrawable, ctx); const f = h("div", "", { position: "absolute", inset: "0", width: pct * 100 + "%", background: color, borderRadius: "inherit" }); st.position = st.position || "relative"; d.append(f); }
    } else {
      const s = d._w.mode === "fixed" ? d._w.px : this.dp(a.indicatorSize, ctx) || 48;
      this.fixSize(d, d._w.mode !== "fixed" ? s : null, d._h.mode !== "fixed" ? s : null);
      st.display = "flex";
      st.alignItems = "center";
      st.justifyContent = "center";
      const r = 20, c = 2 * Math.PI * r;
      d.innerHTML = `<svg viewBox="0 0 48 48" width="100%" height="100%"><circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}" transform="rotate(-90 24 24)"/></svg>`;
    }
  }

  k_rating(d, a, x, ctx) {
    const n = parseInt(a.numStars, 10) || 5, r = parseFloat(a.rating) || 0;
    const small = /Small|Indicator/.test(a._chain + (a.style || ""));
    const color = this.col(a.progressTint, ctx) || this.col("?colorPrimary", ctx);
    d.style.display = "flex";
    d.style.fontSize = (small ? 16 : 36) + "px";
    d.style.lineHeight = "1";
    for (let i = 0; i < n; i++) { const s = h("span"); s.textContent = "★"; s.style.color = i < Math.round(r) ? color : "rgba(128,128,128,.35)"; d.append(s); }
  }

  k_image(d, a, x, ctx, button = false) {
    const st = d.style;
    st.display = "flex";
    st.alignItems = "center";
    st.justifyContent = "center";
    st.overflow = "hidden";
    const scale = a.scaleType || (button ? "center" : "fitCenter");
    const fit = { centerCrop: "cover", fitXY: "fill", center: "none", matrix: "none" }[scale] || "contain";
    const tint = a.tint && a.tint !== "@null" ? this.col(a.tint, ctx) : null;
    const ref = a.srcCompat || a.src;
    if (button && !a.background) {
      st.backgroundColor = ctx.theme.dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)";
      st.borderRadius = "4px";
    }
    const ic = ref ? this.icon(ref, ctx, tint, fit === "none" ? "contain" : fit) : null;
    if (!ic) {
      if (!ref && !a.background && d._w.mode !== "fixed") d.classList.add("empty-image");
      return;
    }
    const n = ic.node;
    const w = d._w, hh = d._h;
    const iw = ic.w || 24, ih = ic.h || 24;
    if (fit === "none") { n.style.width = iw + "px"; n.style.height = ih + "px"; n.style.flex = "none"; }
    else {
      n.style.width = "100%";
      n.style.height = "100%";
      if (w.mode === "wrap" && hh.mode === "wrap") { n.style.width = iw + "px"; n.style.height = ih + "px"; }
      else if (w.mode === "wrap" || w.mode === "zero" && d.parentType !== "abs") { st.aspectRatio = `${iw} / ${ih}`; }
      else if (hh.mode === "wrap" && a.adjustViewBounds === "true") { st.aspectRatio = `${iw} / ${ih}`; n.style.height = "auto"; }
      else if (hh.mode === "wrap") st.height = st.height || `${Math.min(ih, 300)}px`;
    }
    d.append(n);
    // round images
    const shape = (a.shapeAppearanceOverlay || a.shapeAppearance || "") + " " + d.dataset.tag;
    if (/[Cc]ircle|Round|circular/.test(shape)) st.borderRadius = "50%";
    const bw = this.dp(a.civ_border_width, ctx) || (d.dataset.tag === "ShapeableImageView" ? this.dp(a.strokeWidth, ctx) : 0);
    if (bw) st.boxShadow = `inset 0 0 0 ${bw}px ${this.col(a.civ_border_color, ctx) || this.col(a.strokeColor, ctx) || "#fff"}`;
    if (st.borderRadius && st.boxShadow) n.style.borderRadius = "50%";
  }

  k_imagebutton(d, a, x, ctx) { this.k_image(d, a, x, ctx, true); }

  k_chip(d, a, x, ctx) {
    const st = d.style;
    const m3 = ctx.theme.family === "m3";
    const checked = a.checked === "true";
    st.minHeight = "32px";
    st.borderRadius = (this.dp(a.chipCornerRadius, ctx) ?? (m3 ? 8 : 16)) + "px";
    st.padding = "0 12px";
    const bg = this.col(a.chipBackgroundColor, ctx) || (checked ? this.col("?colorSecondaryContainer", ctx) : m3 ? "transparent" : "rgba(128,128,128,.18)");
    st.backgroundColor = bg;
    const sw = this.dp(a.chipStrokeWidth, ctx) ?? (m3 && !checked ? 1 : 0);
    if (sw) st.boxShadow = `inset 0 0 0 ${sw}px ${this.col(a.chipStrokeColor, ctx) || this.col("?colorOutline", ctx)}`;
    this.textBody(d, { gravity: "center", ...a }, ctx, { size: 14, weight: 500, color: this.col("?colorOnSurfaceVariant", ctx) || this.col("?android:textColorPrimary", ctx) });
    d.style.alignItems = "center";
    if (a.chipIcon) { const ic = this.icon(a.chipIcon, ctx, this.col(a.chipIconTint, ctx)); if (ic) { Object.assign(ic.node.style, { width: "18px", height: "18px", marginRight: "8px" }); d.insertBefore(ic.node, d.firstChild); } }
    if (checked && !a.chipIcon) { const ck = h("span"); ck.textContent = "✓"; ck.style.marginRight = "6px"; d.insertBefore(ck, d.firstChild); }
  }

  k_spinner(d, a, x, ctx) {
    const st = d.style;
    if (!a.minHeight) st.minHeight = "48px";
    const entries = this.res.array(a.entries);
    const text = entries[0] || this.str(a.prompt, ctx) || "Select…";
    this.textBody(d, { ...a, text, gravity: "center_vertical" }, ctx, { size: 16, color: this.col("?android:textColorPrimary", ctx) || this.col("?colorOnSurface", ctx) });
    if (d._pad.l == null) st.paddingLeft = "12px";
    d.style.alignItems = "center";
    const arrow = h("span", "spin-arrow");
    arrow.textContent = "▾";
    d.querySelector(".txt").style.flex = "1 1 auto";
    d.append(arrow);
  }

  k_search(d, a, x, ctx) {
    const st = d.style;
    st.minHeight = "48px";
    st.display = "flex";
    st.alignItems = "center";
    st.gap = "12px";
    st.padding = st.padding || "0 12px";
    st.color = this.col("?colorOnSurfaceVariant", ctx) || "#666";
    st.fontSize = "16px";
    d.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>`;
    const q = h("span");
    q.textContent = this.str(a.queryHint, ctx) || "Search";
    d.append(q);
  }

  k_toolbar(d, a, x, ctx) {
    const st = d.style;
    const m3 = ctx.theme.family === "m3";
    if (!a.background) st.backgroundColor = this.col(m3 ? "?colorSurface" : "?colorPrimary", ctx);
    if (d._h.mode !== "fixed") st.minHeight = "56px";
    st.display = "flex";
    st.alignItems = "center";
    const fg = this.col(a.titleTextColor, ctx) || this.col(m3 ? "?colorOnSurface" : "?colorOnPrimary", ctx) || "#fff";
    if (a.navigationIcon) {
      const ic = this.icon(a.navigationIcon, ctx, this.col(a.navigationIconTint, ctx) || fg);
      if (ic) {
        const b = h("div", "tb-icon");
        Object.assign(ic.node.style, { width: "24px", height: "24px" });
        b.append(ic.node);
        b.dataset.vid = "__toolbar_nav";
        d.append(b);
      }
    }
    const title = this.str(a.title, ctx);
    if (title) {
      const t = h("div", "tb-title");
      t.textContent = title;
      Object.assign(t.style, this.fontCss(a, ctx, { weight: m3 ? 400 : 500 }), { color: fg, fontSize: (m3 ? 22 : 20) + "px", marginLeft: a.navigationIcon ? "8px" : "16px" });
      const sub = this.str(a.subtitle, ctx);
      if (sub) { const s = h("div", "tb-sub"); s.textContent = sub; s.style.color = fg; t.append(s); }
      d.append(t);
    }
    const rest = h("div", "", { flex: "1 1 auto", display: "flex", alignItems: "center", minWidth: 0, alignSelf: "stretch" });
    this.children(rest, x, ctx, "hlinear");
    d.append(rest);
    const menu = this.res.doc("menu", (a.menu || "").replace("@menu/", ""));
    if (menu) {
      let overflow = false;
      for (const it of menu.getElementsByTagName("item")) {
        const show = it.getAttribute("app:showAsAction") || it.getAttribute("android:showAsAction") || "";
        const ref = it.getAttribute("android:icon");
        if (!/always|ifRoom/.test(show) || !ref) { overflow = true; continue; }
        const ic = this.icon(ref, ctx, fg);
        if (!ic) continue;
        const b = h("div", "tb-icon");
        b.dataset.vid = (it.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
        Object.assign(ic.node.style, { width: "24px", height: "24px" });
        b.append(ic.node);
        d.append(b);
      }
      if (overflow) { const o = h("div", "tb-icon tb-more"); o.textContent = "⋮"; o.style.color = fg; d.append(o); }
    }
  }

  k_bottomnav(d, a, x, ctx) {
    const st = d.style;
    const m3 = ctx.theme.family === "m3";
    if (!a.background) st.backgroundColor = this.col(a.backgroundTint, ctx) || this.col(m3 ? "?colorSurfaceContainer" : "?colorSurface", ctx) || "#fff";
    if (d._h.mode !== "fixed") this.fixSize(d, null, m3 ? 80 : 56);
    st.display = "flex";
    st.alignItems = "stretch";
    if (!m3) st.boxShadow = "0 -1px 4px rgba(0,0,0,.15)";
    const menu = this.res.doc("menu", (a.menu || "").replace("@menu/", ""));
    const items = menu ? [...menu.getElementsByTagName("item")] : [];
    const checkedColor = this.stateColor(a.itemIconTint, ctx, true) || this.col(m3 ? "?colorOnSecondaryContainer" : "?colorPrimary", ctx);
    const plainColor = this.stateColor(a.itemIconTint, ctx, false) || this.col("?colorOnSurfaceVariant", ctx) || "#777";
    const textOn = this.stateColor(a.itemTextColor, ctx, true) || (m3 ? this.col("?colorOnSurface", ctx) : checkedColor);
    const textOff = this.stateColor(a.itemTextColor, ctx, false) || plainColor;
    items.forEach((it, i) => {
      const on = i === 0;
      const cell = h("div", "bn-item");
      cell.dataset.vid = (it.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
      const ic = this.icon(it.getAttribute("android:icon"), ctx, on ? checkedColor : plainColor);
      const pill = h("div", "bn-pill", { background: on && m3 ? this.col(a.itemActiveIndicatorStyle ? "?colorSecondaryContainer" : "?colorSecondaryContainer", ctx) : "transparent" });
      if (ic) { Object.assign(ic.node.style, { width: "24px", height: "24px" }); pill.append(ic.node); }
      const lab = h("div", "bn-label");
      lab.textContent = this.str(it.getAttribute("android:title"), ctx) || "";
      lab.style.color = on ? textOn : textOff;
      if (on) lab.style.fontWeight = 600;
      cell.append(pill, lab);
      d.append(cell);
    });
  }

  stateColor(ref, ctx, checked) {
    const r = this.res.resolve(ref, ctx.theme);
    const m = r && r.match(/^@color\/(\w+)$/);
    const doc = m && this.res.doc("color", m[1]);
    if (!doc) return ref ? this.col(ref, ctx) : null;
    const items = [...doc.getElementsByTagName("item")];
    const it = checked ? items.find((x) => x.getAttribute("android:state_checked") === "true" || x.getAttribute("android:state_selected") === "true") : items.find((x) => ![...x.attributes].some((y) => /state_/.test(y.name) && y.value === "true"));
    return it ? this.col(it.getAttribute("android:color"), ctx) : null;
  }

  k_tabs(d, a, x, ctx) {
    const st = d.style;
    if (d._h.mode !== "fixed") this.fixSize(d, null, 48);
    st.display = "flex";
    const m3 = ctx.theme.family === "m3";
    const sel = this.col(a.tabSelectedTextColor, ctx) || this.col("?colorPrimary", ctx);
    const off = this.col(a.tabTextColor, ctx) || this.col("?colorOnSurfaceVariant", ctx) || "#777";
    const ind = this.col(a.tabIndicatorColor, ctx) || sel;
    const tabs = [...x.children].filter((c) => c.tagName.split(".").pop() === "TabItem");
    const list = tabs.length ? tabs : [1, 2, 3].map(() => null);
    list.forEach((t, i) => {
      const cell = h("div", "tab");
      if (t) cell.dataset.vid = (t.getAttribute("android:id") || "").replace(/^@\+?id\//, "");
      cell.textContent = t ? this.str(t.getAttribute("android:text"), ctx) || "" : `Tab ${i + 1}`;
      cell.style.color = i === 0 ? sel : off;
      if (!m3) cell.style.textTransform = "uppercase";
      if (i === 0) cell.style.boxShadow = `inset 0 -${m3 ? 3 : 2}px 0 ${ind}`;
      d.append(cell);
    });
  }

  k_tabitem() {}

  k_view(d, a, x, ctx) {
    if (d.dataset.tag === "MaterialDivider" || d.dataset.tag === "Divider") {
      if (d._h.mode !== "fixed") d.style.height = "1px";
      d.style.backgroundColor = this.col(a.dividerColor, ctx) || this.col("?colorOutlineVariant", ctx) || "rgba(128,128,128,.3)";
    }
  }

  k_space() {}
  k_hidden() {}

  // a widget with a built-in size (FAB, slider...): also tell the constraint solver
  fixSize(d, w, hh) {
    if (w != null) { d.style.width = w + "px"; d.style.minWidth = w + "px"; d._w = { mode: "fixed", px: w }; }
    if (hh != null) { d.style.height = hh + "px"; d._h = { mode: "fixed", px: hh }; }
  }

  placeholder(d, label) {
    const p = h("div", "placeholder");
    p.textContent = label;
    d.append(p);
    if (d._h.mode === "wrap") d.style.minHeight = "56px";
    if (d._w.mode === "wrap") d.style.minWidth = "120px";
  }

  k_unknown(d, a, x, ctx) {
    if (x.children.length) { this.k_frame(d, a, x, ctx); return; }
    d.style.display = "grid";
    this.placeholder(d, d.dataset.tag);
  }
}
