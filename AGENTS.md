# SibuJS + sibujs-ui — Agents Reference

> Single-file reference for agents and LLMs. Covers **sibujs v4.14.1** (framework), **sibujs-ui v1.10.0** (Tailwind component library) and **sibujs-cli v1.7.0** (project CLI, §24).
>
> SibuJS is a function-based frontend framework. Fine-grained reactivity with no virtual DOM, no compiler, no JSX — plain TypeScript/JavaScript. Zero dependencies, ~31 KB gzipped runtime (the production CDN bundle `dist/cdn.global.js`; ~5 KB for the reactivity core alone).

---

## 1. Mental model

- **Components are plain functions** that return an element (usually an `HTMLElement`; any `Element` root, SVG included, is accepted — see the `Component` type in §4). They execute **exactly once** to build the DOM and wire reactive bindings. They never re-run.
- **State is signals** — `signal(initial)` returns `[getter, setter]`. Calling the getter inside a reactive context (`effect`, `derived`, `html``\`\`…\`\``, reactive props) creates a subscription; outside one, it just reads the current value.
- **Reactivity is opt-in per expression** — wrap `() => count()` to make a value reactive. Bare `count()` captures once.
- **Updates are surgical** — when a signal changes, only the DOM nodes that read it update. No component re-renders, no diffing.
- **No virtual DOM, no JSX, no compiler, no build step required** (but works fine with Vite/tsup/esbuild).
- **Three rendering modes** — `mount()` builds a fresh tree, `hydrate()` adopts an SSR tree, and `enhance()` attaches reactivity to existing server HTML **in place** (no re-render, no flash; see §11).

---

## 2. Installation

```bash
npm install sibujs
npm install sibujs-ui  # optional — Tailwind-styled components (peer: sibujs >=3.2.0 <5.0.0)
```

No bundler? Both packages also ship `<script>` bundles (`window.Sibu`, `window.SibuUI`) — see §11 and the sibujs-ui section. sibujs-ui components can also be copied into a project as source with `npx sibujs-ui add <name>`, or with `sibujs add <name>` from sibujs-cli (§24).

New project? `npm install -g sibujs-cli`, then `sibujs create my-app --ui blue --router` scaffolds Vite + TypeScript with sibujs-ui and routing (§24).

**Requirements (4.0).** Node.js **>= 22.3.0** for SSR and tooling — 18 and 20 are
not supported. Browsers: **Chrome/Edge >= 93, Firefox >= 92, Safari >= 15.4**;
the floor is what the source requires (`Object.hasOwn`,
`ParentNode.replaceChildren`, `new Error(msg, { cause })`) and is enforced by a
build gate.

`sibujs-ui` requires Tailwind CSS v4 and a theme token file. See the sibujs-ui section below.

---

## 3. Package exports (16 subpath entries + 4 script-tag bundles)

```
sibujs                 // root: signals, rendering, lifecycle, error handling
sibujs/browser         // composables: mouse, visibility, network, online, fullscreen, …
sibujs/data            // query, mutation, infiniteQuery, resource, socket, stream, offlineStore
sibujs/devtools        // initDevTools, HMR helpers, introspection
sibujs/ecosystem       // redux / zustand / mobx adapters
sibujs/motion          // transitions, animation primitives
sibujs/patterns        // machine, persisted, timeline, optimistic, globalStore
sibujs/performance     // concurrent scheduling, DOMPool, lazyChunk, trustHTML, compiled
sibujs/plugins         // router (+ route head, routerReady), i18n, Plugin system
sibujs/ssr             // renderToString(Async), renderRoute, hydrate (+ adopt), streaming, islands, trustHTML
sibujs/ssr/dom         // the built-in server DOM: installServerDom (v4.14)
sibujs/testing         // render, fireEvent, waitFor, queryBy*/findBy*
sibujs/ui              // form, inputMask, dialog, toast, embed, transitions, a11y, widgets…
sibujs/widgets         // headless tabs/select/selectMenu/accordion/combobox/popover/tooltip/…, isWidgetKeyEvent
sibujs/build           // Vite / Webpack plugins (incl. prerender), config and CDN helpers
sibujs/extras          // misc utilities
./cdn                  // IIFE bundle for <script> drop-in (window.Sibu) — PRODUCTION
./cdn-dev              // same bundle with dev warnings live — DEVELOPMENT (v4.2)
./cdn-full             // core + sibujs/patterns on window.Sibu — PRODUCTION (v4.4)
./cdn-full-dev         // the same with dev warnings live — DEVELOPMENT (v4.4)
```

---

## 4. Authoring style — shorthand is canonical

Every tag factory accepts three call shapes:

```ts
tag(children?)                      // bare wrapper / text / reactive child
tag("className", children)          // styled wrapper — string is a class ONLY when children follow
tag({ ...props }, children?)        // full props: attrs, class, style, event handlers, refs
```

> A **lone** string is a TEXT child: `div("Hello")` renders text. A string means `class` only when children follow it (`div("card", […])`). For a childless styled element use `div({ class: "…" })` — dev builds warn when a lone string looks like a class list.

```ts
import { div, h1, button, signal } from "sibujs";

function Counter() {
  const [count, setCount] = signal(0);
  return div("counter p-4", [
    h1("text-2xl", () => `Count: ${count()}`),
    button(
      { class: "btn-primary", on: { click: () => setCount((c) => c + 1) } },
      "Increment",
    ),
  ]);
}
```

Legacy forms (`{ nodes: ... }`, `` html`` `` tagged template) still work but are no longer documented. Prefer the shorthand.

### TagProps

```ts
interface TagProps<El extends Element = HTMLElement> {
  id?: string | (() => string | null | undefined);               // v4.7: a getter binds the id
  class?: string | (() => string | null | undefined | false)     // v4.7: falsy removes the attribute
        | Record<string, boolean | (() => boolean)>;
  style?: string | StyleMap | (() => string | StyleObject);      // v4.7: a getter may return an object
  ref?: { current: Element | null | undefined };                 // ref<T>() fits under strict
  on?: TagEventHandlers;                                         // keydown → KeyboardEvent, …
  onElement?(el: El): void;                                      // receives the specific element
  [attr: string]: unknown; // setAttribute for anything else
}
type StyleMap = Record<string, string | number | (() => string | number)>;  // per-property getters
type StyleObject = Record<string, string | number | null | undefined>;      // from a whole-style getter
```

- **Typed factories (v4.7).** Every tag factory returns its specific element type: `div()` is an `HTMLDivElement`, `input()` an `HTMLInputElement`, `svg()` an `SVGSVGElement`; `tagFactory("my-el")` falls back to `HTMLElement`. No `as HTMLInputElement` cast is needed to reach `.value`, `.checked`, `.href` and so on. The factory type is `TagFunction<El, Props>`.
- **`Component<P = void, R extends Node = Element>`** (v4.7, a type exported from `sibujs`) is `(props: P) => R`. `mount`, `lazy`, `Suspense`, `Portal`, `registerComponent`, `DynamicComponent`, `defineComponent`, `defineSlottedComponent` and the HOC helpers (`withProps`, `withWrapper`, `withDefaults`, `compose`) accept it, and SVG roots work without casts.
- **Boolean attrs**: `true` → attribute present; `false` → removed. IDL props (`checked`, `disabled`, `selected`, `value`) are set as DOM properties.
- **Any attribute may be a getter** — including `id` (v4.7; it used to write the getter's source text), `input({ type })` and `a({ target })`. A getter resolving to `null`/`undefined` removes the attribute. Since v4.12 the typed factory props accept such getters: `img({ width: () => (cur() ? String(cur()!.width) : null) })` type-checks. The IDL props `value`, `checked`, `selected` and `disabled` keep their types — a getter there must return a value.
- **`aria-*` booleans** serialize (v4.5): `"aria-selected": () => selected()` writes `"true"`/`"false"`. Return `null` to remove an ARIA attribute.
- **Event handlers** live under `on`: `on: { click: e => …, input: e => … }`. Known DOM event names are typed (`keydown: (e: KeyboardEvent) => …` type-checks, v4.7); custom event names accept any `Event` subtype.
- **`onElement`** fires with the real element after construction — for imperative setup (third-party libs, measurements).

### Reactive class

```ts
div({ class: () => isActive() ? "active" : "idle" });   // string
div({ class: () => isActive() && "active" });            // v4.7: false/null/undefined removes the attribute
div({ class: { active: isActive, disabled: () => !enabled() } }); // object
div({ class: "base " + classVariant() });                // plain string (not reactive)
```

### Reactive style

```ts
div({
  style: {                                  // StyleMap — each property its own binding
    color: () => theme().fg,
    transform: () => `translateX(${x()}px)`,
  },
});

// v4.7: a whole-style getter may return an object. Properties are set one by one;
// a property a later run no longer lists (or sets to null) is removed.
div({ style: () => (dragging() ? { cursor: "grabbing", opacity: 0.6 } : { cursor: "grab" }) });
```

### Children

```ts
div([childA, childB])            // array of nodes
div(() => userName())            // reactive text
div([h1("Hi"), () => count()])   // mixed
```

---

## 5. Signals API

### signal

```ts
const [count, setCount] = signal(0);
count();            // 0
setCount(5);        // replace
setCount(c => c+1); // updater
const [name, setName] = signal("", { name: "name", equals: (a, b) => a === b });
```

### effect — side effects with dep tracking

```ts
const stop = effect(() => {
  document.title = `Count: ${count()}`;
});
stop(); // idempotent; second call is no-op
```

**v2.0 `onCleanup` param** — register teardown that runs before every re-run and on dispose:

```ts
effect((onCleanup) => {
  const handler = () => { /* … */ };
  window.addEventListener("resize", handler);
  onCleanup(() => window.removeEventListener("resize", handler));
});
```

Re-entry detection: an effect writing to a signal it reads dev-warns and drops the triggering update. Use `batch()` for mutual writes.

### derived — pull-based computed

```ts
const total = derived(() => price() * qty());
total(); // lazy; only recomputes when read AND a dep changed
total.dispose(); // v4.5: release source subscriptions; idempotent, accessor keeps its last value
```

A derived created per mount (e.g. per virtualized row) should be released with its owner: `onCleanup(flag.dispose, rowEl)`.

**v2.0 `equals` option** — suppress equivalent recomputes:

```ts
const user = derived(
  () => ({ id: id(), name: name() }),
  { equals: (a, b) => a.id === b.id && a.name === b.name },
);
```

### watch — imperative change callback

```ts
const stop = watch(count, (next, prev) => console.log(prev, "→", next));
```

### store — multi-key state with setState/reset

```ts
const [state, { setState, reset, subscribe }] = store({ count: 0, name: "Alice" });
state.count;       // reactive read
setState({ count: 5 });
setState(s => ({ ...s, count: s.count + 1 }));   // an updater returns the whole state
reset();
subscribe(s => console.log(s));
```

### ref — mutable reactive reference

```ts
const r = ref(0);
r.current = 5;           // setter; notifies
r.current;               // tracks reads in reactive contexts
```

### array — reactive array

```ts
const [items, { push, remove, removeWhere, set, updateWhere, clear }] = array<Todo>([]);
push({ id: 1, text: "Learn sibujs" });
// also: pop, shift, unshift, splice, update(index, value), sort, reverse, filter, map
items(); // readonly snapshot, reactive
```

### deepSignal / writable / untracked / on

```ts
const [cfg, setCfg] = deepSignal({ theme: { mode: "dark" } }); // deep-equal gate
const [full, setFull] = writable(() => first() + " " + last(), (v) => { /* setter */ });
full.dispose(); // v4.5: the getter is a derived — release it if it outlives its use
const x = untracked(() => count());           // read without subscribing
effect(on(() => count(), (c, prev) => { /* only runs on count change */ }));
```

### external — state SibuJS does not own

SibuJS tracks reads of **its own** signals. A chess engine, a canvas scene graph, an editor document, a cache a socket writes into — those keep state in objects the runtime never sees written. `external()` is the seam: a reactive token with **no value**.

```ts
import { external } from "sibujs";

const game = new Chess();   // owns the rules and the mutable state
const moved = external();   // owns "something changed"

ctx.text("@status", () => {
  moved.track();            // this binding reads the engine
  return game.isCheckmate() ? "Checkmate" : `${game.turn()} to move`;
});

game.move({ from: "e2", to: "e4" });
moved.invalidate();         // every consumer above re-reads
```

`track()` where you read, `invalidate()` where you mutate — deliberately two calls, because reading and mutating happen in different places. It never proxies, clones or diffs the object; `invalidate()` is an ordinary signal write, so it batches, works inside `derived()`/`effect()`, and never wakes a disposed consumer. **One source is one invalidation domain** — use several (`position`, `clock`, `history`) so a subsystem that changes at its own rate does not wake the rest. ~60 bytes gzipped.

Do **not** reach for a revision counter (`const [rev, setRev] = signal(0)`) — that is the pattern this replaces.

### batch / retrack / cycle detection

```ts
batch(() => {
  setA(1); setB(2); setC(3);
}); // single notification pass

// Low-level — used internally by derived pulls. Prunes stale deps via
// per-evaluation epochs (conditional branches no longer over-subscribe).
retrack(fn, subscriber);

// Cycle detection — a single subscriber firing more than 1 000 times during
// one drain is treated as a write-reads-self cycle and bails loudly (internal
// limit, not configurable from the public API).
setMaxDrainIterations(1_000_000);  // absolute safety net for legitimate fan-out
```

### Subscription introspection (sibujs/devtools)

Low-level helpers for devtools. Not needed in normal app code. (Also re-exported
from `sibujs/extras`; there is no `sibujs/reactivity/*` subpath.)

```ts
import { getSubscriberCount, getDependencies, inspectSignal, getSignalName,
         walkDependencyGraph } from "sibujs/devtools";

getSubscriberCount(count);           // active subscribers of a signal getter
getDependencies(subscriberFn);       // signals an effect/computed subscriber depends on
inspectSignal(count);                // { name, signal, subscriberCount } | null
getSignalName(count);                // the `name` option, if one was given
walkDependencyGraph(count, 5);       // signal → subscribers → … tree (maxDepth default 10)
```

### nextTick / defer / transition

```ts
await nextTick();          // microtask + rAF flush → DOM is up-to-date
const slow = defer(() => expensiveDerived()); // lags input for perf
const { pending, start } = transition();       // idle-priority updates
start(() => setHeavy(big));
```

---

## 6. Rendering

### mount — root

```ts
const { unmount } = mount(App, document.getElementById("root")!);
```

`mount(App, …)` is a render transaction (v4.7): if the component throws, or the
append fails, every binding and listener it registered is released before the
error reaches the caller. A pre-built node passed to `mount()` belongs to the
caller and is never rolled back.

### each — keyed list, O(n log n) LIS diff

```ts
each(
  () => todos(),                          // reactive array
  (item, index) => li(() => item().text), // item is a REACTIVE getter
  { key: (t) => t.id },                   // required for stable identity
);
```

The render callback runs **untracked** (v4.5; initial and later rows alike): a bare read in its body is a one-time read and never subscribes the list. Put reactive reads inside bindings or effects.

### when / show / match

```ts
when(() => loggedIn(), () => div("Welcome"));           // swap DOM
when(() => loggedIn(), () => loggedInView(), () => login()); // with else

show(() => isVisible(), () => div("optional content")); // toggles display:none

match(
  () => status(),
  {
    idle:    () => div("Idle"),
    loading: () => Loading(),
    error:   () => ErrorDisplay({ error: err() }),
  },
  () => div("Unknown"),   // fallback is the 3rd argument ("default" is an ordinary key)
);
```

**Both call shapes work everywhere (v4.2).** `show`, `when` and `match` each
accept a branch as a factory *or* as a ready-made element. Before 4.2 the
shapes disagreed — `show` took an element while `when` took thunks — and
passing the wrong one raised an obscure `TypeError`, or for `when` rendered
nothing at all with no error.

```ts
when(() => loggedIn(), div("Welcome"), div("Please log in"));  // elements
when(() => loggedIn(), () => div("Welcome"));                  // factories
show(() => visible(), span("hi"));                             // either
```

**`when` compares the condition's VALUE by identity (`Object.is`), not its
truthiness.** `when(() => selectedUser(), () => UserCard(selectedUser()!))`
rebuilds the card for every different user object. To rebuild only when
truthiness flips, return a boolean: `when(() => !!user(), …)`. For rebuilds keyed
on something else (an id, a mode), use `match`.

```ts
when(() => user(), () => Profile());     // rebuilds on EVERY new user object (e.g. each refetch)
when(() => !!user(), () => Profile());   // rebuilds only when logged-in state flips
```

**Unmounting a directive root removes its branch (v4.8).** A `when()` or
`match()` renders its branch next to an anchor; `mount(() => when(…))` followed
by `unmount()`, or an outer directive switching away, now removes the branch and
disposes its bindings instead of leaving it on the page.

**An outgoing branch never re-runs (v4.13).** When one write both switches a
branch and changes what the branch reads, the branch is disposed BEFORE any
binding or effect inside it runs again in that flush, so bindings that are only
valid while the branch is mounted are safe. Do not cache the last non-null value
to protect against a deselect:

```ts
match(() => sel()?.id ?? "", { "": () => span("nothing selected") },
  () => Panel({ rotation: () => sel()!.rotation }));   // ✓ setSel(null) swaps the branch; the getter never runs on null
```

The same holds for `each()` rows being removed, `KeepAlive` branches being
evicted, `DynamicComponent`, reactive children (`div(() => cond() ? A() : B())`)
and directives nested inside an outgoing branch (their selector does not run
either). Branches that stay mounted update normally in the same flush. The
scheduler runs a pending directive before the bindings it created, outermost
first. Nothing else is reordered.

**Branch factories run untracked (v4.7)**, like `each()` rows: a signal read
eagerly inside a `when`/`match` branch is a one-time read and never becomes a
dependency of the condition or the selector. Put reactive reads in bindings
inside the branch (`div(() => count())`).

A **factory** is re-invoked on every switch, so each branch is a fresh subtree.
A **bare element** is the same node every time: it is re-attached rather than
rebuilt, keeps whatever state it accumulated while detached, and keeps its own
reactive bindings (the directive did not create it, so it does not dispose it).
Dev warns the first time a node is re-attached, because that reuse is easy to
adopt by accident.

**TRAP — a rebuild destroys focus.** Swapping a `when`/`match` branch discards
the outgoing subtree, so focus, selection and any in-progress IME composition
inside it are lost. Since 4.2 the runtime restores focus when the rebuilt
subtree contains an element with the same `id`, `name` or `data-focus-key`, and
warns in dev when it cannot. The match must be unambiguous — a shared `name`
identifies a radio *group*, not a control — and an IME composition can never be
preserved, because it belongs to the destroyed node.

**Dropping focus on purpose — the `focus` option (v4.13).** When removing the
focused subtree is the point (Escape deselects a layer and closes its
properties panel), say so on that directive instead of living with the
warning. The options object goes last, or in place of the else-branch / fallback:

```ts
when(() => selected(), () => PropertiesPanel(), { focus: "discard" });          // silent, focus rests on <body>
when(() => open(), () => Menu(), () => null, { focus: { restoreTo: triggerEl } }); // focus moves to triggerEl
match(() => mode(), cases, { focus: { restoreTo: () => document.getElementById("canvas") } });
```

| `focus` | Behavior |
|---|---|
| `"preserve"` (default) | Restore by `data-focus-key` / `id` / `name`; dev-warn when impossible |
| `"discard"` | No restoration, no warning; focus falls to `<body>` |
| `{ restoreTo: el \| () => el }` | Restore by identity first; otherwise focus `el` (getter resolved at rebuild time); warn only if `el` is missing or not in the document |

The option applies only to that directive. A reactive child
(`div(() => …)`) has no options, so use `when`/`match` when you need one.

For a subtree holding a live edit, prefer keying with `match` on a shape key so
it is rebuilt only when the shape actually changes, and drive the rest with
reactive attributes and text children, which mutate nodes in place:

```ts
match(() => `${entity()}:${mode()}`, {   // rebuilds on shape change only
  "user:edit": () => UserForm(),
  "user:view": () => UserCard(),
});
```

### Fragment / Portal / lazy+Suspense / KeepAlive / DynamicComponent

```ts
Fragment([a, b, c]);                        // no wrapper element
Fragment([label, () => count()]);           // v4.7: a function child is reactive, as in a tag factory
mount(Fragment([a, b]), root);              // v4.7: unmount() removes everything the fragment filled

Portal(() => div("modal body"), document.body);

const LazyDash = lazy(() => import("./Dashboard"));
Suspense({ nodes: () => LazyDash(), fallback: () => Loading() });

KeepAlive(() => currentTab(), {
  home: () => HomePage(),
  settings: () => SettingsPage(),
}, { max: 5 });

registerComponent("grid", GridView);          // a Component, registered by name
DynamicComponent(() => view());                 // `is`: a registered name or a Component
```

`DynamicComponent(is)` takes only the getter (no props argument — close over
props in the component instead) and returns a `div.sibu-dynamic` container. It
swaps **only when what `is()` resolves to changes** (v4.7): the component body
runs untracked, so a signal it reads while building no longer remounts it. A
name registered after the first render replaces the "not found" placeholder,
and a component that threw is built again on the next run.

A `KeepAlive` case may return a `DocumentFragment`; it is wrapped in a
`display: contents` element so it can be detached and re-attached as one unit.
A fragment built in another document or realm (an iframe) is wrapped the same
way (v4.9).

### takePendingError (v2.0)

ErrorBoundary auto-walks mounted subtrees for errors stashed by `lazy()` rejections that beat any boundary to mount. For custom boundaries:

```ts
onMount(() => {
  const err = takePendingError(descendantEl);
  if (err) handleError(err);
}, root);
```

### tagFactory / action / Slots / onElement

```ts
const my = tagFactory("my-widget");             // custom element factory
my({ "data-id": 1 }, "body");

action(el, clickOutside, () => close());        // reusable el behaviors (by ref)
registerAction("longPress", longPress);         // name registry; built-ins auto-registered
action(el, "longPress", { duration: 500, callback });  // apply by name; getAction(name) to look up
div([getSlot(slots, "header")?.(), (getSlot(slots, "body") ?? defaultBody)()]); // Slots is a type; getSlot(slots, name = "default")

div({ onElement: (el) => initThirdParty(el) });
```

Built-in actions, as of v4.9:

- **`longPress`** tracks one press at a time, owned by the pointer that started
  it. Only that pointer's `pointerup`, `pointerleave` or `pointercancel` ends
  it; a second pointer is ignored; the same pointer pressing again restarts the
  press. Disposing the element cancels a pending press, so the callback never
  fires afterwards.
- **`clickOutside`** listens on the element's own document (`ownerDocument`),
  so it works for an element inside an iframe.
- **`trapFocus`** reads the focused element from the element's own document.

---

## 7. Lifecycle & disposal

```ts
onMount(() => { /* after insert */ return () => { /* optional cleanup */ }; }, el); // v4.7: cleanup also runs on el.remove()
onUnmount(() => { /* on remove */ }, el);
onCleanup(() => clearInterval(t), el);          // tied to element's disposal

const root = div(children);
registerDisposer(root, () => socket.close());   // arbitrary cleanup per node
dispose(root);                                  // post-order teardown

// Context (dependency injection)
const Theme = context<"light" | "dark">("light");
Theme.withContext("dark", () => App());         // scoped override, restored afterwards
const theme = Theme.use();                      // inside App subtree: a getter, call theme()
```

The three hooks are not interchangeable:

- **`onMount(fn, el)`** runs once `el` is connected (a microtask after render).
  The cleanup it returns runs once on teardown — `dispose(el)` or a native
  `el.remove()` — and runs immediately if the callback removed or disposed its
  own element. **The returned cleanup is honoured only when `el` is passed**;
  `onMount(fn)` just defers `fn`. No-op under SSR. The callback returns nothing
  or a cleanup function — since 4.10.1 a block body with no `return` type-checks.
  Async callbacks are not supported: a promise is not a cleanup.
- **`onUnmount(fn, el)`** runs once when `el` is disposed or leaves the DOM.
- **`onCleanup(fn, node)`** is a disposer on a node you own (the node is
  required): it runs when the node is disposed — `dispose()`, or a
  `when`/`match`/`each`/outlet discarding it.
- **Pinned scope (v4.10):** `onMount` / `onUnmount` callbacks, and the cleanup
  `onMount` returns, run in the scope they were registered in, however they are
  triggered — inside a route page, `route()` there is that page's route (§9).

### ErrorBoundary

Positional children (tag-factory shape). Two overloads:

```ts
ErrorBoundary(children: () => Element): Element;
ErrorBoundary(options: ErrorBoundaryOptions, children: () => Element): Element;
```

Options: `fallback(err, retry) => Element` (default = `ErrorDisplay`), `onError(err)`, `resetKeys: Array<() => unknown>` (auto-reset when any key changes after a caught error). The children function is re-invoked on retry and on every resetKey change.

```ts
// children-only form — uses the default ErrorDisplay fallback
ErrorBoundary(() => RiskyArea());

// full form
ErrorBoundary(
  {
    fallback: (err, retry) => ErrorDisplay({ error: err, onRetry: retry }),
    onError: (err) => logger.log(err),
    resetKeys: [() => userId()],   // auto-reset when any key changes
  },
  () => RiskyArea(),
);
```

**v3.0 breaking change:** the `{ nodes: () => Element }` option was dropped — children are now positional. `ErrorBoundaryProps` is kept as a deprecated alias of `ErrorBoundaryOptions`.

---

## 8. Data fetching (sibujs/data)

```ts
const q = query(
  () => `user:${userId()}`,                     // key: string or () => string (reactive)
  async ({ signal, key }) => fetch(`/api/users/${key.slice(5)}`, { signal }).then(r => r.json()),
  {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: () => userId() != null,           // v4.9: boolean or () => boolean (reactive)
    select: (u) => ({ ...u, name: formatName(u.name, nameStyle()) }), // select returns the same type T
  },
);
q.data(); q.loading(); q.fetching(); q.error(); q.isStale(); q.refetch();
q.dispose(); // v4.5: also disposes its internal loading/isStale deriveds (infiniteQuery likewise)

setQueryData("user:42", (prev) => ({ ...prev!, name: "Ada" }));   // explicit write — always notifies
getQueryData<User>("user:42");

const m = mutation<User, NewUser>(
  async (body, signal) => fetch("/users", { method: "POST", body: JSON.stringify(body), signal }).then(r => r.json()),
  { onSuccess: () => invalidateQueries((key) => key.startsWith("user:")) },
);
m.mutate({ name: "Bob" });         // fire-and-forget; errors surface via m.error()
await m.mutateAsync({ name: "Bob" });

const pages = infiniteQuery(
  "feed",
  ({ pageParam, signal }) => fetchPage(pageParam, signal),
  { initialPageParam: 0, getNextPageParam: (last) => last.nextCursor },
);
pages.pages(); pages.hasNextPage(); pages.fetchNextPage();

const r = resource(() => id(), (id, { signal }) => fetch(`/api/${id}`, { signal }).then(r => r.json()));
r.loading(); r.data(); r.error(); r.refetch();
r.mutate((prev) => ({ ...prev!, done: true }));   // explicit write — always notifies

// Route loaders (v4.6): loader data is scoped to the component being rendered
// (per SSR request on the server). loaderData() throws outside a scope.
const { view, resource: userRes } = withLoader(
  ({ params }, { signal }) => fetch(`/api/users/${params.id}`, { signal }).then(r => r.json()),
  { params: { id: "42" }, path: "/users/42" },
  () => UserPage(),                 // UserPage calls loaderData<User>() at its top
);
userRes.dispose();                  // when the route unmounts
// Two-step form: renderWithLoader(executeLoader(loader, ctx), () => UserPage())

const ws = socket("wss://…", {
  autoReconnect: true,
  // v2.0 defaults: maxReconnects=10, exponential backoff + jitter
});
const sse = stream("/events", { autoReconnect: true });

const store = await offlineStore({ name: "app", keyPath: "id" });
await store.put({ id: 1, text: "…" });
await store.sync();                // snapshot-then-delete; pull skips pending edits
```

**`enabled` (v4.9, `query()` and `infiniteQuery()`).** A boolean, or a function
that is re-evaluated reactively. Before 4.9 a function was treated as always
`true`, so a query meant to wait fetched immediately.

- **`query()`:** while `enabled` is `false`, nothing fetches — not the key
  change, `refetch()`, `invalidateQueries()`, `refetchInterval`, focus or
  reconnect. When it turns `true`, the query fetches under the usual staleness
  rules, so data invalidated while it was off is fetched then.
- **`infiniteQuery()`:** each time it turns `true`, the query loads from
  `initialPageParam`, as a key change does.
- The query only reacts when the answer flips, not to every change of a signal
  the function reads.
- **An empty key (`""`)** also holds a `query()` idle, without creating a cache
  entry (idle queries share no entry, so no `initialData` leaks between them).
- **`fetching()` follows the current key.** After a key change it is `true` only
  while a request for the new key is in flight (before 4.9 it could stay `true`
  when the new key had fresh cached data).
- **A key getter re-running to the same key does not refetch (v4.10).**
  ``query(() => `user:${id() % 10}`, fetchUser)`` with `id` 1 → 11 keeps
  `user:1` as is; wrapping the key in `derived()` is no longer needed. Stale
  data is refetched by `refetch()`, invalidation, `refetchInterval`, focus or
  reconnect — or on a same-key re-run when `enabled` has just turned `true` or
  the observer re-attaches because its cache entry was replaced — not by an
  unrelated signal change.
- **`infiniteQuery()` differs:** it has no shared cache, and **any** re-run of
  its key getter (a signal it reads changed, even to the same key) clears the
  pages and loads from `initialPageParam` again — the 4.10 same-key fix does
  not apply to it.
- **SSR:** inside `runInSSRContext` the query cache is request-scoped, so
  concurrent requests never share fetched data; on the client it is one
  process-global cache.

**`structuralSharing` (v4.7, `query()` and `resource()`, default `true`).** Each
fetched result is reconciled against the previous value of the same key: deeply
equal data keeps its reference and **notifies nobody**; partially changed data
keeps every unchanged nested object and array, so `each()` rows and deriveds
over untouched branches stay put. Background refreshes (`refetchInterval`,
focus, reconnect, `invalidateQueries()`) therefore no longer re-render unchanged
data. Only plain objects and arrays are compared — `Date`, `Map`, `Set` and class
instances compare by identity; cyclic data is taken as-is.

```ts
query(key, fetcher);                                   // default: shared, identical refetch is silent
query(key, fetcher, { structuralSharing: false });     // commit every result as-is — each fetch notifies
query(key, fetcher, { structuralSharing: (prev, next) => (prev?.version === next.version ? prev : next) });
resource(fetcher, { structuralSharing: false });       // same contract on resource()
```

- **Per observer.** The option governs only the observer that passes it. Every
  default observer of a key holds the same reference (the one `getQueryData()`
  returns); a function receives that observer's own previous value. It must not
  throw — if it does, the error is reported and `next` is committed unshared.
- **Explicit writes always land.** `setQueryData()` and `resource().mutate()`
  handed a new top-level reference commit a new top-level reference and notify,
  even when every child is unchanged (`prev.items.push(x); return { ...prev }`).
  Unchanged nested subtrees are still reused beneath it. Returning the same
  reference is not a change.
- **`select`** runs in the observer's own reactive computation: it re-runs when
  the cached value changes **or when a signal it reads changes** — and such a
  signal never re-runs the key or triggers a refetch. It runs once per fetch
  that changed the data, and its output is structurally shared too, so an
  identical refetch notifies nobody even when `select` builds a new object.

---

## 9. Routing (sibujs/plugins)

```ts
import { createRouter, Route, Outlet, RouterLink, navigate, route, plugin, inject,
         createPluginRegistry, setDefaultPluginRegistry } from "sibujs/plugins";

createRouter([
  { path: "/", component: HomePage },
  { path: "/users/:id", component: UserPage, beforeEnter: authGuard },
  { path: "/admin", lazy: () => import("./Admin"), children: [
    { path: "users", lazy: () => import("./AdminUsers") },
  ]},
  { path: "/old", redirect: "/new" },
], { mode: "history" });
// { mode: "hash" } (v4.12): the route lives in the fragment — navigate("/users/42")
// writes /#/users/42, RouterLink renders href="#/users/42", the page's own path
// and query are never touched, and reloads / new tabs resolve the same route.

navigate("/users/42");
route().path; route().params.id;   // plain snapshot; reactive when read inside a getter
// v4.10: inside a route page, route() is the route THAT page was committed with (§9 "Route-instance scope")
RouterLink({ to: "/users/42" }, "Profile");                     // children are positional
RouterLink({ to: "/cart" }, () => `Cart (${count()})`);         // v4.7: getter / number children work
RouterLink({ to: "/" }, translated("nav.home"));                // live i18n label (see i18n below)

// In the app tree, mount Route() as the top-level outlet — it renders the
// matched top-level route (e.g. HomePage at "/"):
mount(() => div([nav, Route()]), document.getElementById("app"));

// Outlet() is the NESTED outlet: place it inside a PARENT route's component to
// render that route's matched child. It renders nothing unless a nested child
// is matched (matched.length >= 2), so it does not belong at the app root — use
// Route() there. Example: AdminLayout ("/admin") renders its children via Outlet.
// v4.10: Outlet() reads its layout's route scope; an outgoing layout's Outlet()
// keeps its child until the layout itself is disposed.
function AdminLayout() {
  return div([adminNav, Outlet()]);   // AdminUsers renders here at "/admin/users"
}
```

**v2.0 security:** router refuses protocol-relative redirects (`"//evil.com/…"`) — CWE-601.

**Query semantics (v4.9, v4.11).** `route().query` holds decoded values (`+` is
a space, `%XX` is decoded), and a repeated key keeps its **last** value:
`?tag=a&tag=b` is `{ tag: "b" }`. **`route().queryAll`** (v4.11, also
`routerState().queryAll()`) holds **every** value of every key, in URL order,
with the same decoding: `?tag=a&tag=b` is `{ tag: ["a", "b"] }`. Read it for
multi-value filters. A navigation object accepts an array value, which repeats
the key; the URL written to history keeps every value.

Two locations have the same query when every key has the same values in the
same order — the order of keys does not matter. That one rule decides duplicate
navigation, `RouterLink` exact-active and the `KeepAliveRoute` cache key, and an
encoded `&` or `=` never reads as a separator:

```ts
await navigate("/search?a=1&b=2");
await navigate("/search?b=2&a=1");        // { success: false, reason: "duplicate" }
await navigate("/search?a=1%26b%3D2");    // a different query: { a: "1&b=2" }
RouterLink({ to: "/search?tag=a&tag=b" }, "Tags");  // exact-active on that same URL

// v4.11: multi-value filters
await navigate({ path: "/queue", query: { status: ["needs_review", "revision_requested"] } });
// URL: /queue?status=needs_review&status=revision_requested
route().queryAll.status;                  // ["needs_review", "revision_requested"]
route().query.status;                     // "revision_requested" (last value)
await navigate("/queue?status=revision_requested"); // NOT a duplicate: a value was removed
```

Before 4.11, `navigate()` rewrote the URL from the last-value-wins record (the
address bar lost every earlier value of a repeated key) and identity compared
only the last value, so adding a value to a filter was refused as `duplicate`.
Workarounds that read `location.search` with `URLSearchParams` and rewrite it
with `history.replaceState` after navigating are no longer needed.

**Outlets built ahead of time (v4.11).** `Route()`, `Outlet()` and
`KeepAliveRoute()` render next to a comment anchor, so they can only commit
while the anchor has a parent. An outlet created first and attached later now
renders once it is attached — including inside a subtree that joins the
document later — and an outlet created before `createRouter()` renders once the
router exists:

```ts
const page = Route();                                  // not attached yet
mount(() => div([nav, when(() => ready(), () => page, () => Spinner())]), app);
```

Before 4.11 this left the page area empty until the next navigation. A `Route()`
pass that fails while detached shows its error (with Retry) once attached.

### Route params and remounting (v4.7)

A route component **remounts when its own path params change**: `/users/1` →
`/users/2` disposes the old instance (running `onUnmount` / `onCleanup`,
releasing its bindings) and mounts a fresh one. Reading params once at setup is
therefore safe:

```ts
function UserPage() {
  const { id } = route().params;              // always the current id — the page remounts per id
  const q = query(`user:${id}`, fetchUser);
  return div(() => q.data()?.name ?? "…");
}
```

| Navigation | Default | With a `key` |
|---|---|---|
| The record's own path param (`/users/1` → `/users/2`) | remount | remount only when the key changes |
| Query- or hash-only (`?tab=a` → `?tab=b`, `#x` → `#y`) | kept | remount when the key reads it |
| A child's param only | child remounts inside `Outlet()`; parent layout kept | per record |
| Catch-all `*` tail (`/docs/a` → `/docs/b`) | kept — read `route().params.pathMatch` reactively | `key: (r) => r.params.pathMatch` remounts per path |

- A record with no params of its own is never remounted by a param change.
- `KeepAliveRoute()` keeps one instance per full location (path, query, hash).
  Since v4.10 a cached view keeps its own route while cached and is handed the
  current route when shown again.

**`key: (route) => string`** (a `RouteBase` option) sets the identity of the
mounted instance; the component remounts whenever the key changes. It is called
untracked with the committed route.

```ts
// One long-lived instance across ids — the page must then read params reactively:
{ path: "/records/:id", component: RecordPage, key: () => "record" },
//   inside RecordPage: div(() => route().params.id)  or  routerState().params().id
// Also remount when ?tab changes:
{ path: "/records/:id", component: RecordPage, key: (r) => `${r.params.id}|${r.query.tab ?? ""}` },
// Remount a catch-all per path:
{ path: "/docs/*", component: DocsPage, key: (r) => r.params.pathMatch },
```

Upgrading: a page that relied on staying mounted across param changes (to keep
local state, or because it already read params reactively) keeps that behaviour
with a constant `key`.

### Route-instance scope (v4.10)

A navigation commits the router's route first; the outlet swaps the page a
microtask later (a whole chunk download later for a lazy page). Inside a route
page, `route()`, `routerState()` and `router().currentRoute` now return the
route **that page instance was committed with**, so an outgoing page never sees
the incoming page's params, query or hash:

```ts
function UserPage() {
  const el = div(() => `User ${route().params.id}`);
  effect(() => analytics.view(route().params.id));  // never re-runs with the next page's params
  onUnmount(() => saveDraft(route().params.id), el); // teardown sees this page's id too
  return el;
}
```

- **Kept instances follow.** A page the outlet keeps (query- or hash-only
  change, a constant `key`, a layout whose child changed) is handed each new
  route — read it reactively, as before.
- **Replaced instances keep their own route** until they are disposed, teardown
  included (effect cleanups, `onUnmount`, disposers). Guards (such as "ignore
  routes outside this prefix") and `derived(() => route().params.id)` wrappers
  whose only purpose was keeping an outgoing page off the incoming route can be
  removed; keep guards that encode business logic.
- **Nested `Outlet()`** reads its layout's scope; an outgoing layout keeps its
  child until the layout itself is disposed. **`KeepAliveRoute()`**: a cached
  view keeps its route while cached and gets the current one when shown again.
- **Outside route instances** — app shell, tests, code right after
  `await navigate()` — the three read the router's route, current as soon as
  the navigation commits. A computation that outlives its page (an app-lifetime
  `derived()` created while the page rendered) falls back to the router's
  route once the page is disposed.
- **Reach.** The scope is synchronous and follows only work SibuJS schedules:
  setup, `when`/`match`/`each`, `KeepAlive`, `lazy()` and `Suspense` content,
  `Portal`, `onMount`/`onUnmount` (and the cleanup `onMount` returns), nested
  outlets. Code run from your own timer or event handler reads the router's
  route.
- **Limit — async components.** In a *direct* async route component
  (`component: async () => …`) only the code before the first `await` is
  scoped; code after it, and any effect it creates, reads the router's route,
  even while the page is outgoing — capture route data before the first
  `await`. A `lazy()` page is scoped, because SibuJS awaits the module and then
  calls its factory inside the scope — prefer `lazy()` for code-split pages
  that read the route while rendering. A `lazy()` module whose factory is
  itself `async` has the same limit as a direct async component.

```ts
{ path: "/a/:id", component: async () => {
  const id = route().params.id;       // scoped: this instance's route
  const data = await load(id);
  route();                            // after await: the router's route
  return div(data.title);
} },
{ path: "/b/:id", lazy: () => import("./B") },  // B's (sync) factory runs inside the scope
```

### Per-route `<head>` (v4.13)

A route record can declare `head`, and `createRouter({ head })` provides the
defaults plus a `titleTemplate`. On every committed navigation (including
back/forward) the router sets `document.title` and the matching tags, and
removes tags the new route does not set.

```ts
createRouter(routes, {
  mode: "history",
  head: { title: "Wraps Studio", titleTemplate: "%s · Wraps Studio", og: { siteName: "Wraps Studio", type: "website" } },
});

const routes: RouteDef[] = [
  { path: "/", component: Home, head: {
      title: () => t("home.title"),                  // getters are reactive: a locale switch updates the title
      description: "Design your wrap online.",
      canonical: "https://wraps.example/",
      og: { image: "https://wraps.example/og/home.png" },
  } },
  { path: "/orders/:id", component: Order, head: { title: (r) => `Order ${r.params.id}` } },
  { path: "/admin", component: Admin, head: { meta: [{ name: "robots", content: "noindex" }] } },
];
```

| Field | Renders |
|---|---|
| `title` | `document.title`, wrapped by `titleTemplate` (`"%s · Site"` or a function). The template is not applied to the default title itself |
| `description` | `<meta name="description">` |
| `canonical` | `<link rel="canonical">` |
| `og.{title,description,image,url,type,siteName}` | `<meta property="og:…">`. `og.title` / `og.description` / `og.url` default to `title` / `description` / `canonical` |
| `meta: [{ name \| property, content }]` | Any other meta, identified by `name` or `property` |
| `robots` (v4.14) | `<meta name="robots">`. A `noindex` route is left out of the pre-renderer's sitemap |
| `twitter.{card,site,creator,title,description,image}` (v4.14) | `<meta name="twitter:…">`; title / description / image default to the Open Graph values once `twitter` is declared |
| `alternates: [{ hreflang, href }]` (v4.14) | `<link rel="alternate" hreflang>`, one per translation, keyed by `hreflang` (or a getter returning the list) |
| `jsonLd` (v4.14) | `<script type="application/ld+json">` per object (or a getter). Serialized with `serializeJsonLd()`: `<`, `>`, `&`, U+2028/9 escaped, so data cannot close the element |

- Values are strings, `null` (clears a value set by a parent or the defaults), or getters `(route) => string` evaluated reactively. Nested records merge field by field, and the deepest record wins.
- The values pass the same entry and URL policy as `Head()`: unsafe `canonical` / `og:image` / `og:url` URLs are omitted. Use **absolute** URLs for these three, because link-preview bots do not resolve relative ones.
- **Opt-in.** The router touches `<head>` only after a route (or the router) declares `head`. Then it owns the title and the keys it publishes: a tag with the same key in `index.html` (or on a pre-rendered page) is replaced, not duplicated. Move site-wide defaults from `index.html` into `createRouter({ head })`.
- **Layering.** A component's `Head({ title })` / `title()` still wins while it is mounted (title lease stack). Do not declare the same meta key in both a route `head` and a component `Head()`.
- A route without a title shows the default title, or the `index.html` title.
- `resolveRouteHead(route, defaults)` and `routeHeadToHTML(head)` (exported from `sibujs/plugins`) give a server renderer the same result.

- **On the server (v4.14)** the same `head` is collected for the render result (`renderRoute` → `result.head`, §10) instead of written to a document, and a component's `Head({ title, meta, link })` inside the tree is collected too. The innermost entry wins its key (`name:…`, `property:…`, `link:rel:canonical`, `link:hreflang:…`); each key is emitted once. In the browser nothing changed: navigation updates the tags and removes the ones the next route does not set, and going back restores them.
- A link whose URL the policy refuses (`canonical: "javascript:…"`) is now left out entirely rather than rendered without an `href` (v4.14).
- **Only live entries count on the server (v4.14).** A `Head()` belongs to its component: one in a branch the render switched away from (a `when` that flipped once data arrived) is withdrawn, which reveals the entry it overrode. A getter (`title: () => q.data()?.name`) is read when the head is collected, after the render settled, so it contributes the loaded value. A reactive entry never publishes a meta refresh.

**`routerReady()` (v4.13)** resolves once the initial navigation has settled
(committed, redirected or failed) and the matched route components, lazy chunks
included, are loaded. It never rejects. Await it before `hydrate()` on a
pre-rendered page (§17).

### Server rendering through the router (v4.14)

```ts
// A router with its own location: no window, history or location access.
createRouter(routes, { mode: "memory", url: "/cotizar?servicio=dtf", head });
// Created inside a request scope (runInSSRContext, renderRoute) it is that request's
// alone: concurrent renders each have their own; the browser's global router is untouched.

const routes: RouteDef[] = [
  { path: "/", component: Home },
  { path: "/producto/:id", component: Product,
    getStaticPaths: async () => (await fetchCatalog()).map((p) => ({ id: p.id })) },  // pre-render list (§17)
  { path: "/cotizacion", redirect: "/cotizar", status: 301 },   // redirects default to 302
  { path: "/estado", component: Status, render: "ssr" },        // per request only: the pre-render is shell + head
  { path: "/disenador", component: Designer, render: "client" },// never on a server: shell + head, no sitemap
  { path: "*", component: NotFound, status: 404 },              // a bare "*" answers 404 even without status
];
```

| Route option | Meaning |
|---|---|
| `status` | HTTP status of a server render of the route; the deepest matched record that declares one wins |
| `render: "ssr" \| "prerender" \| "client"` | default (none): rendered by every server render. `"client"`: only the shell and the route's `head`. `"ssr"`: rendered per request, shell + head when pre-rendered. Inherited from the deepest record that declares it |
| `getStaticPaths()` | For a dynamic route: the params objects (or path strings) the pre-renderer writes a page for. May be async |
| `createRouter({ trailingSlash: "ignore" })` | `/cotizar/` is the `/cotizar` route (a static server serves `cotizar/index.html` there). Default `"strict"` |

`route()`, `routerState()`, `route().query` / `queryAll` and params read the
request's router during the render, exactly as in the browser. Guards,
`beforeEnter`, redirects and lazy routes run. See `renderRoute()` (§10) for the
status mapping.

### i18n (sibujs/plugins)

```ts
import { t, translated, setLocale, getLocale, registerTranslations, Trans,
         hasTranslation, getAvailableLocales } from "sibujs/plugins";

registerTranslations("en", { title: "Search", greeting: "Hello, {name}!", "search.ph": "Type to search" });
registerTranslations("es", { title: "Buscar", greeting: "¡Hola, {name}!", "search.ph": "Escribe para buscar" });

const [userName] = signal("Ada");
header([
  h1(translated("title")),                                  // live text node
  span(translated("greeting", { name: userName })),         // getter params are live too
  input({ placeholder: translated("search.ph") }),           // live attribute
  Trans("greeting", { name: userName }),                    // same, wrapped in a <span>
]);

setLocale("es");   // every text node and attribute updates in place — nothing rebuilt, focus and typed input survive
```

- **`translated(key, params?)`** (v4.7) returns a getter (`() => string`) usable as
  a text child or **any attribute**. Use it for everything on screen.
- **`t(key, params?)`** returns a **string snapshot**. It is live only inside a
  binding (`span(() => t("title"))`); called directly in a component body it
  renders once and never updates. Use it for one-off strings: event handlers,
  `confirm()` prompts, logs.
- **`TranslationParams`** (v4.7 type) = `Record<string, string | number | (() => string | number)>`:
  `t()`, `translated()` and `Trans()` accept getter values, resolved at lookup
  time. When params are passed, each `{name}` placeholder reads an own property
  only; one with no matching param renders empty (never `Object.prototype`).
- **Late registration works (v4.7).** `registerTranslations()` notifies bindings,
  so `setLocale("es")` followed by lazily loading the `es` messages shows Spanish
  instead of raw keys. `hasTranslation()` and `getAvailableLocales()` are reactive
  inside a binding.
- An unregistered key falls back to the key itself; a registered empty string is
  returned as-is. Inside `runInSSRContext`, `setLocale()` sets the locale for that
  request only; dictionaries are application-global.
- **`formatNumber()` / `formatCurrency()` follow the i18n locale (v4.8).** Both
  come from `sibujs/browser` and take the locale as an option:
  `formatNumber(n, { locale: "de-DE" })`, `formatCurrency(n, "EUR", { locale })`.
  Without one they use the active `setLocale()` locale when the i18n plugin is
  loaded (request-scoped during SSR), and a formatter called inside a binding
  (`span(() => formatNumber(total()))`) re-formats when the locale switches.

### Plugin system

```ts
const analytics = createPlugin("analytics", (ctx) => {
  ctx.provide("analytics", { track: (ev: string) => gtag("event", ev) });
});
plugin(analytics);
inject<{ track: (e: string) => void }>("analytics").track("signup");

// v4.6: install may be async; plugin() returns its promise. The install is a
// transaction — it commits only when it fulfils; a rejection commits nothing,
// is reported, and leaves the plugin installable again.
await plugin(createPlugin("i18n", async (ctx) => {
  ctx.provide("messages", await loadMessages());
}));
// registry.reset() cancels in-flight installs: they reject with
// PluginInstallCancelledError (check with isPluginInstallCancelledError(err)).

// v2.0: isolated registries for SSR-per-request / tests / multi-app
const iso = createPluginRegistry();
iso.plugin(analytics);
setDefaultPluginRegistry(iso); // (renamed from useDefaultPluginRegistry)
```

---

## 10. SSR (sibujs/ssr)

```ts
import { renderToString, hydrate, renderToDocument, renderToReadableStream,
         island, hydrateIslands, serializeState, deserializeState, trustHTML } from "sibujs/ssr";

// Node — takes a built node, not the component. Building the tree needs a DOM:
// tag factories return live nodes, on the server too. Register one first:
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
// …or jsdom: const { window } = new JSDOM("");
//   Object.assign(globalThis, { window, document: window.document, Node: window.Node,
//     Element: window.Element, HTMLElement: window.HTMLElement, DocumentFragment: window.DocumentFragment });
// Without one, the first builder throws "renderToString needs a DOM: register
// happy-dom or jsdom globals first" (v4.12; it used to be "document is not defined").
const html = renderToString(App());

// when/match/each render their first branch in a microtask — let it run first:
const page = await runInSSRContext(async () => {
  const tree = App();
  await Promise.resolve();
  return renderToString(tree);
});

// v4.12: SVG and MathML are serialized (viewBox, xlink:href and the rest keep their
// case and prefix; empty elements self-close), under the runtime policy: on* dropped,
// href/xlink:href through the URL allowlist, <set>/<animate> never targeting a URL or
// handler attribute, <script>/<style> stripped. Drop any element.outerHTML workaround.
renderToString(div([svg({ viewBox: "0 0 24 24" }, [path({ d: "M4 12h16" })])]));
// '<div data-sibu-ssr="true"><svg viewBox="0 0 24 24" data-sibu-ssr="true"><path d="M4 12h16" data-sibu-ssr="true" /></svg></div>'

// Browser
hydrate(App, document.getElementById("root")!);
// v2.0: hydrate uses REPLACE strategy so reactive bindings actually drive the DOM.
// The server nodes are discarded and rebuilt. v4.14 adds the opt-in adopting
// strategy (below): hydrate(App, root, { strategy: "adopt" }).

// Edge runtimes
const stream = renderToReadableStream(App());   // ReadableStream<string>

// Islands — mark them with island(id, component) while rendering
const htmlDoc = renderToDocument(() => div([Header(), island("cart", Cart)]), { title: "Shop" });
hydrateIslands(document.body, { cart: Cart });
// Legacy "replace" islands. For new code prefer enhance() / registerIsland() / mountIslands() — see §11.

// State transfer (XSS-safe, byte-capped, U+2028/9 escaped)
const scriptTag = serializeState({ user }, "nonce-abc");
const data = deserializeState<{ user: User }>(
  (d): d is { user: User } => typeof d === "object" && d !== null && "user" in d,
);

// Trusted HTML (required by compiled.staticTemplate + head extras — CWE-79 gate)
const safe = trustHTML("<p>already sanitized</p>");

// Per-request SSR context (uses AsyncLocalStorage when available)
import { runInSSRContext } from "sibujs";
await runInSSRContext(async () => { /* request handler */ });
```

### Async rendering — one `await`, no microtask juggling (v4.14)

```ts
import { renderToStringAsync, renderToDocumentAsync, settled, renderRoute } from "sibujs/ssr";

const { html, head, state, status, diagnostics } = await renderToStringAsync(() => App(), {
  timeout: 5000,          // then serialize what is ready; Suspense / lazy keep their fallbacks
  nonce: "abc",           // CSP nonce for the transfer script
  maxStateBytes: 1 << 20, // transferred-state cap; the largest entries are dropped first (dev warning names them)
  hydration: "adopt",     // emit adoption ids for hydrate(…, { strategy: "adopt" })
  log: true,              // dev: one summary per render (formatRenderDiagnostics())
});
```

- **Settled** means: every deferred directive commit has run, and every unit of
  work registered in the request has settled — `lazy()` chunks, `query()` and
  `resource()` fetches, the router's navigation and route loads,
  `prerenderWait()` promises. Pass a **function** so the tree is built inside the
  request scope. Outside `runInSSRContext` the call opens its own scope.
- `query()` now fetches during a server render (before 4.14 its effect never ran
  there). Intervals and window-focus refetches are off on the server;
  `enabled: false` and `ssr: false` queries do not fetch and are not waited for.
  `resource(source, fetcher)` fetches on the server too.
- An error no `ErrorBoundary` claims rejects the render with the failing node's
  DOM path (`render failed in bindChildNode at section.grid > div#card > span: …`).
  A timeout does not reject: `diagnostics.pending` names what was still running.
- `settled(root?, { timeout })` is the low-level wait for custom pipelines.
- The async renderers put `data-sibu-ssr` on top-level elements only
  (`marker: "all"` restores `renderToString`'s every-element marker).
- No DOM registered? They install the built-in **server DOM** (below).

### `renderRoute(routes, url, options)` — a URL through the router (v4.14)

```ts
const r = await renderRoute(routes, req.url, {
  router: { head, trailingSlash: "ignore" },  // createRouter options; mode/url are set for you
  app: () => App(),                           // the shell around Route(); default Route()
  document: { scripts: ["/assets/main.js"] }, // full document: head in <head>, state before the scripts
  rejectStatus: 401,                          // a guard that rejects (default 403)
});
if (r.location) return redirect(r.status, r.location);   // 301/302 + Location, no body
res.status(r.status).send(r.html);                         // 200, 404 (* route / route status), 403
```

`r.render` is the route's mode (`"client"` → empty body, head only), `r.noindex`
reflects `robots`, `r.redirectBy` says whether a redirect came from a `redirect`
record (the same for everyone) or a guard (visitor-dependent), `r.failure` why
a navigation did not commit (`"guard"`, `"redirect-loop"`, `"timeout"`, …).

| Outcome | `status` | Body |
|---|---|---|
| route rendered | 200, or the deepest matched record's `status` (`*` → 404) | the page |
| `redirect` record or guard redirect | the record's `status` (default 302; a guard redirect 302) + `location`, percent-encoded | none |
| guard rejected | `rejectStatus` (default 403) | none (head only) |
| other failed navigation (`"redirect-loop"`, an error) | 500 | none (head only) |
| not rendered within `timeout` | **503**, `failure: "timeout"` | none |

- **`timeout` is one deadline for the whole request** (default 5000 ms): the
  navigation (guards included), the matched components' loads, then building
  and settling the page with what is left. Past it while the page settles, what
  is ready is serialized with fallbacks (`diagnostics.timedOut`), as
  `renderToStringAsync` does.
- **Components load only for a response with a body.** A redirect, a failed
  navigation, a `render: "client"` route and a pre-rendered `render: "ssr"`
  route answer from the navigation and the route records, without importing a
  lazy route's module.
- **Router `base`:** pass the full request URL (`/app/about?x=1`). The base is
  stripped once, at a segment boundary (`/app/about` under `/app`, never
  `/application`), query and hash kept; navigation targets stay application
  paths, and a redirect's `location` carries the base once.

For a Node sidecar, `createRenderHandler(routes, options)` wraps it as
`(Request) => Promise<Response>` with `Cache-Control` and an optional page
cache keyed by URL plus `cache.version()`:

```ts
const handle = createRenderHandler(routes, {
  router: { head },
  document: { scripts: ["/assets/main.js"] },
  cache: { max: 500, ttl: 60_000, maxBytes: 32 * 1024 * 1024, version: () => catalogVersion },
  // A per-visitor page must stay out of the shared cache: say so.
  cacheControl: (r) =>
    r.route?.path.startsWith("/account") ? "private, no-store"
    : r.status === 200 && !r.diagnostics.timedOut ? "public, max-age=0, s-maxage=60, stale-while-revalidate=600"
    : "no-store",
});
```

- The cache is **shared by every visitor**. It keeps only 200 / 404 pages that
  did not time out and whose `Cache-Control` has no `no-store`, `no-cache` or
  `private` directive (parsed, any case). Without `cacheControl` the header is
  `public, max-age=0, s-maxage=60, stale-while-revalidate=600` for a 200,
  `public, max-age=3600` for a 301/308, and `no-store` for everything else and
  for a timed-out render, so a default 404 is not stored either. A
  `cacheControl` that returns `null` sends no header, which leaves the page
  cacheable.
- `x-sibu-cache: hit | miss | bypass` reports what happened. `maxBytes`
  (default 32 MB) bounds the stored HTML: a client inventing query strings
  evicts old pages but cannot grow the process.
- A render that throws answers a bare 500 (no stack, no message).

### Server DOM — no happy-dom / jsdom needed (v4.14)

`sibujs/ssr/dom` implements only what the runtime and serializer use (nodes,
attributes + NS, `classList`, `dataset`, `style` as a declaration map, events with
bubbling, `MutationObserver`, a selector engine, form-control IDL semantics).
Async renders install it automatically when no DOM is registered;
`installServerDom()` does it explicitly (it never replaces an existing DOM).
Output is byte-identical to jsdom's; a string `style` with CSS shorthands is the
one difference from happy-dom (its CSSOM expands shorthands). There is no
`window`, so `typeof window === "undefined"` keeps meaning "server". Browser-only
calls (`el.animate()`, `dialog.showModal()`, `innerHTML =`) throw an error naming
the API and the calling source location; `canvas.getContext()` and
`document.fonts` answer "unavailable" and are reported. Form-control defaults
write through as in a browser (4.14.1): `input.defaultChecked` and
`option.defaultSelected` set the attribute that `checked` / `selected` follow
until written, and a single-choice `<select>` keeps one option selected.

| 1 000 renders of the fixture landing page | per render | heap to register the DOM |
|---|---|---|
| server DOM | 0.24 ms | 1.0 MB |
| jsdom | 0.86 ms | 16.2 MB |
| happy-dom | 0.81 ms | 13.0 MB |

### Server vs browser code (v4.14)

| On the server | Runs? |
|---|---|
| component setup, reactive bindings, `derived()` | yes (initial values) |
| `effect()` / `watch()` | **no** — unless `effect(fn, { server: true })` |
| `onMount` / `onUnmount` | **no** (now also when a DOM is registered) |
| `query()` / `resource()` / `lazy()` / router loads | yes, and awaited |

```ts
import { isServer, isClient, ClientOnly } from "sibujs";
// Renders the fallback on the server (and during adoption), the content in the browser.
ClientOnly(() => RecoloredCanvas(product), { fallback: () => img({ src: product.image, width: 160, height: 160 }) });
```

`isServer()` is true in an SSR scope and in the build-time pre-renderer. Under a
full DOM emulation, a component that reads `localStorage`, `matchMedia`,
`requestAnimationFrame`, `IntersectionObserver`, `ResizeObserver`,
`document.fonts` or `canvas.getContext()` during a server render gets a dev
warning naming the site (and `diagnostics.browserApis`); under the server DOM a
`window` / `localStorage` ReferenceError is rethrown as a clear message.

### Adopting hydration (v4.14, opt-in)

```ts
// server: renderToStringAsync / renderRoute / the pre-renderer with { hydration: "adopt" }
// browser:
const result = await hydrate(() => App(), root, { strategy: "adopt", onMismatch: report });
// → { adopted, created, removed, mismatches, replacedRoot }
```

The client tree is built **on the server nodes**: zero elements created on
matching markup, images do not reload, typed input / checkboxes / focus / scroll
survive (handlers receive replayed `input`/`change` events). Elements carry a
creation-scope id (`data-sibu-h`) per directive scope, so data that arrived late
on the server still lines up. A divergent subtree is rebuilt alone and reported
(dev warning or `onMismatch`: kind, DOM path, both sides, likely cause). The
element ends with exactly the client's attributes through the client's policy.
`createId()` lines up. `replace` stays the default and is unchanged. Not
adopted: `KeepAlive`, `DynamicComponent`, `Portal` content and hand-made
`document.createElement` nodes (replaced locally). Design and limits:
`docs/architecture/hydration-adopt.md`.

- **Form state before takeover.** Text typed into an input or textarea, a
  checkbox or radio the user changed (radio groups included), and a `<select>`
  choice — single or multiple, the selected option nodes themselves, an emptied
  selection included — survive. "Changed" is measured against the markup's own
  default (for a drop-down with no `selected` attribute, the option this
  browser picks); an untouched control takes the client's value with nothing
  replayed.
- **Concurrent hydrations are independent.** Each `hydrate(…, { strategy:
  "adopt" })` — and each component island — has its own session: it resolves as
  soon as its own lazy chunks and route loads have settled, not when another
  island's do. `ClientOnly` content and `afterHydration()` callbacks run once,
  when their own hydration ends. A hydration started inside another one's
  build is its child: the parent waits for it.
- **`each()` keys while adopting:** a row's id encodes its key losslessly, so
  `1` and `"1"` are two rows, as in the reconciler, and two different strings
  never share one. Keys must be strings or numbers (`each`'s declared type): a
  boolean, object, symbol or bigint key throws a `TypeError` during an adopt
  render or hydration.

### Data transfer (v4.14)

The async renderers embed the request's `query()` cache, keyed `resource()`s
(`resource(fetcher, { key })`) and loaders (`executeLoader`, keyed by path) as
**one** escaped script (`window.__SIBU_TRANSFER__`, `serializeState` rules,
nonce, cap). The browser primes its cache from it on first use: data within
`staleTime` is not fetched again; stale data shows at once and refetches in the
background (structural sharing keeps the DOM still). Concurrent requests never
mix. `query(key, fn, { ssr: false })` opts a query out. A loader is keyed by
path and function name: two different loaders with the same name for one path
(two `loader: async () => …` properties) are ambiguous and are not transferred
at all — they fetch again in the browser — unless given
`executeLoader(loader, ctx, { key })`.

### Streaming with out-of-order Suspense (v4.14)

```ts
const stream = renderToReadableStream(() => App(), { document: { scripts: ["/main.js"] }, nonce, timeout: 10_000 });
```

Passing a **function** selects the new mode (a node keeps the old one). The head
and the shell flush as soon as everything outside the `Suspense` boundaries has
settled (each boundary on its fallback); each boundary then streams the moment
its own content and work are ready, in any order, with a nonce-aware swap
script; then the state and the scripts. Chunks are produced on demand
(backpressure); `cancel()` stops it. Head entries a boundary adds after the
shell flushed are not in the head. A nested boundary ready before the one
around it travels with that one's chunk, once. An error no `ErrorBoundary`
claims errors the stream wherever it occurs, with the failing node's DOM path —
the status was sent with the shell, so render error states through an
`ErrorBoundary`. Streaming pays off for slow, independent data on a per-request
server; for crawlers and a static backend pre-render instead (§17).

---

## 11. Reactive islands & progressive enhancement (sibujs, v3.4)

`enhance()` is the **third rendering mode** alongside `mount` and `hydrate`. It attaches reactivity to **existing server HTML in place** — no re-render, no flash, no VDOM, no build step. Imported from **`sibujs`** (core), not `sibujs/ssr` (that's the legacy replace-islands API — see §10).

### enhance(target, setup)

```ts
import { enhance, signal } from "sibujs";

// target: an Element or a selector string. setup wires reactivity, may return a cleanup.
const dispose = enhance("#widget", (ctx) => {
  const [n, setN] = signal(0);
  ctx.text("@count", () => n());            // @name -> [data-ref="name"] within the target
  ctx.on("@inc", "click", () => setN(v => v + 1));
  return () => {/* optional teardown */};
});
dispose();                                   // also auto-disposed when the element leaves the DOM
```

Writes are **skipped when the value already matches** the server markup (no hydration flash). Double-enhancing is a no-op (guarded via `data-sibu-enhanced`). `enhanceAll(selector, setup)` enhances every match.

### EnhanceContext

| method | purpose |
|---|---|
| `text(t, () => v)` | reactive `textContent` |
| `attr(t, name, () => v)` | reactive attribute; booleans literal-serialized (`aria-*`), `null`/`undefined` removes it |
| `classed(t, name, () => bool)` | toggle a class |
| `show(t, () => bool)` | toggle the `hidden` attribute (can reveal server-`hidden` elements) |
| `model(t, [get, set])` | two-way binding (text / checkbox / number / `select[multiple]`) |
| `each(t, (el, i) => desc)` | bind MANY existing elements from one descriptor — see below |
| `on(t, event, handler)` | add a listener (auto-removed on dispose) |
| `ref(name)` / `refs(name)` | resolve one / all `[data-ref]` elements |
| `cleanup(fn)` | register teardown tied to the element's disposer |

`t` is a `@name` ref or an `Element`.

### ctx.each — repeated enhancement

A board, a table, a keyboard, a legend: many elements the server already rendered, each needing several bindings.

```ts
ctx.each("@square", (el, index) => {
  const square = el.dataset.square;
  return {
    text: () => pieceAt(square),                       // -> ctx.text(el, …)
    attr: { "aria-selected": () => sel() === square }, // -> ctx.attr(el, …)
    class: { selected: () => sel() === square },       // -> ctx.classed(el, …)
    show: () => visible(square),                       // -> ctx.show(el, …)
    on: { click: () => choose(square) },               // -> ctx.on(el, …)
    cleanup: () => release(square),                    // -> ctx.cleanup(…)
  };
});
```

Every field is committed **through the matching `ctx.*` helper**, so ownership, disposal, sanitization and error metadata are identical to writing the loop by hand. It is sugar, not a template language: no expression parsing, no interpolation, no `eval`, **no new DOM** — node identity is preserved.

- Target: a `@ref`/CSS selector, or any iterable of elements (array, `NodeList`, `HTMLCollection`).
- Zero matches is a silent no-op; calling it twice creates two independent binding sets.
- A bad descriptor key or a non-function value throws in dev, naming the element index — inside `setup`, so the enhancement transaction rolls back.
- Anything it does not cover (`model`, listener options, a nested `enhance`) is written imperatively in the same callback, which receives the element.

### Island runtime

Declarative auto-mounting of many islands by name, with lazy activation strategies.

```ts
import { registerIsland, mountIslands, lazyIsland, unregisterIsland } from "sibujs";

registerIsland("counter", (ctx) => { /* same setup signature as enhance */ });
registerIsland("chart", lazyIsland(() => import("./chart-island.js"))); // code-split on demand

mountIslands();            // scan the document (or mountIslands(root)) and activate islands
```

Markup drives mounting and **when** each island activates:

```html
<div data-sibu-island="counter"></div>                                       <!-- load (default) -->
<div data-sibu-island="chart"  data-sibu-load="visible"></div>               <!-- IntersectionObserver -->
<div data-sibu-island="x"      data-sibu-load="idle"></div>                  <!-- requestIdleCallback -->
<div data-sibu-island="y"      data-sibu-load="interaction"></div>          <!-- first pointer/focus/key -->
<div data-sibu-island="z"      data-sibu-load="media" data-sibu-media="(min-width:768px)"></div>
```

`data-sibu-load`: `load` · `idle` · `visible` · `interaction` · `media`. Each strategy falls back gracefully where the API is missing (SSR / old browsers). A failing island's setup is isolated — it never breaks the others.

### Component islands from a server render (v4.14)

```ts
// server (inside the page): only this subtree ships JavaScript
island("cart", Cart, { items }, { load: "visible" });   // marker + JSON props + adoption ids

// browser: the island's own chunk
import { islandComponent } from "sibujs/ssr";
registerIsland("cart", lazyIsland(() => import("./Cart").then((m) => islandComponent(m.Cart, isCartProps))));
mountIslands();
```

When `mountIslands` activates it (any `data-sibu-load` strategy), the props are
read back from the markup (validate them: they come from the page) and the
component adopts the island's server nodes. The rest of the page keeps inert
server HTML: no bindings, no listeners. `island(id, factory)` with two arguments
is the legacy replace island, unchanged.

### CDN — zero build

The whole story runs from a single `<script>`. The IIFE bundle exposes everything on `window.Sibu`:

```html
<div data-sibu-island="counter">
  <output data-ref="n">0</output>
  <button data-ref="inc">+1</button>
</div>
<script src="https://unpkg.com/sibujs@latest/dist/cdn.global.js"></script>
<script>
  const { signal, registerIsland, mountIslands } = window.Sibu;
  registerIsland("counter", (ctx) => {
    const [n, setN] = signal(0);
    ctx.text("@n", () => n());
    ctx.on("@inc", "click", () => setN(v => v + 1));
  });
  mountIslands();
</script>
```

Islands runtime ~ **5.2 KB gzipped**.

**Four bundles — load exactly one.** All define `window.Sibu`, so loading
two leaves whichever came last in charge. `cdn` / `cdn-dev` carry the core
(`sibujs`) only; `cdn-full` / `cdn-full-dev` add `sibujs/patterns`. No bundle
carries the other subpaths (`sibujs/data`, `sibujs/plugins`, `sibujs/ui`, …) —
those need a bundler.

| File | `__SIBU_DEV__` | Use |
|---|---|---|
| `dist/cdn.global.js` | `false` | Production. Dev warnings are compiled out, not merely disabled — the strings are not in the file. |
| `dist/cdn.dev.global.js` | `true` | Development. Every warning is live with no build step. |
| `dist/cdn.full.global.js` | `false` | Production, **plus `sibujs/patterns`** (`machine`, `persisted`, `timeline`, `optimistic`, `globalStore`, …) (v4.4). |
| `dist/cdn.full.dev.global.js` | `true` | Development build of the full bundle (v4.4). |

```html
<!-- while building -->
<script src="https://unpkg.com/sibujs@latest/dist/cdn.dev.global.js"></script>
```
```html
<!-- to ship -->
<script src="https://unpkg.com/sibujs@latest/dist/cdn.global.js"></script>
```

Runtime behaviour is identical; only the warnings differ. A **bundled** app
needs neither file — import from `"sibujs"` and let the bundler define
`__SIBU_DEV__` per build (the `sibujs/build` Vite and webpack plugins do this).
The two CDN files exist because a `<script>` tag has no bundler to make that
choice, and before 4.2 the single CDN bundle carried every warning string as
dead weight it could never print.

**Patterns from a script tag (v4.4).** A `<script>` tag resolves no
specifiers, so `sibujs/patterns` is unreachable from the default bundle. The
`cdn.full` pair is a superset of it: the same `window.Sibu` with the patterns
spread onto it (core wins any name collision) and also kept as
`Sibu.patterns`. It is a separate file so pages that only need signals do not
download patterns (~35 KB gzip vs ~31 KB).

```html
<script src="https://unpkg.com/sibujs@latest/dist/cdn.full.global.js"></script>
<script>
  const { signal, registerIsland, mountIslands, machine } = window.Sibu;
</script>
```

**Components from a script tag.** sibujs-ui ships its own IIFE and stylesheet
(`window.SibuUI`); load it AFTER the runtime tag. See the sibujs-ui section.

---

## 12. State patterns (sibujs/patterns)

```ts
// Finite state machine
const { state, send, matches, can, context } = machine({
  initial: "idle",
  context: { retries: 0 },
  states: {
    idle:     { on: { FETCH: "loading" } },
    loading:  { on: {
      OK:    "success",                                                        // a transition is a target state…
      RETRY: { target: "loading", action: (ctx) => ({ retries: ctx.retries + 1 }) }, // …or { target, guard?, action? }
      GIVE_UP: { target: "failed", guard: (ctx) => ctx.retries >= 3 },         // guard false → event ignored
    } },
    success:  {},
    failed:   {},
  },
});
// One transition per event (no arrays); `action` returns a partial context. States may add entry/exit(ctx).

// Persisted state (localStorage/sessionStorage, tab-synced by default)
const [theme, setTheme] = persisted("theme", "light", {
  session: false, syncTabs: true,
  validate: (v): v is "light" | "dark" => v === "light" || v === "dark",
  // encrypt/decrypt must be SYNC — v2.0 docs clarify this
});

// Undo/redo
const t = timeline({ count: 0 });
t.set({ count: 5 }); t.undo(); t.redo(); t.jumpTo(0);
t.dispose(); // v4.5: releases value/canUndo/canRedo

// Optimistic updates with rollback
const { value, pending, update } = optimistic<number>(0);
await update(5, () => api.save(5));   // shows 5 at once; commits what the action resolves, rolls back if it rejects

// App-wide store
const app = globalStore({
  state: { count: 0, theme: "light" },
  actions: { inc: (s) => ({ count: s.count + 1 }), setTheme: (_s, theme: string) => ({ theme }) },
  middleware: [(state, action, payload, next) => { log(action); next(); }],
});
app.dispatch("inc"); app.getState().count; app.subscribe((s) => render(s));
const theme = app.select((s) => s.theme);   // reactive getter
```

`globalStore` semantics (v4.6):

- **Operations run in order.** A `dispatch()`/`reset()` started from a listener, middleware or action is queued and runs after the current one commits and delivers, so every listener sees states in commit order and its state equals `getState()`.
- **Listeners are isolated.** A throwing listener is reported (`phase: "event"`); the rest still receive the update and `dispatch()` does not throw.
- **Middleware** gets its own `next`, usable once (extra calls are ignored with a dev warning). It may be `async`: a rejection is reported with `phase: "async"`. A middleware that throws or rejects **before** calling `next()` never continues — the action does not run later.

---

## 13. Browser APIs (sibujs/browser)

```ts
const small  = media("(max-width: 640px)");         // { matches: () => boolean, dispose() }
small.matches(); small.dispose();
const net    = online();                             // { online: () => boolean, dispose() }
const vis    = visibility();                         // { visible: () => boolean, dispose() }
const { x, y } = mouse();                            // reactive position (+ dispose)
const { width, height } = windowSize();              // getters (+ dispose)
const { direction } = swipe(el);                     // () => "up" | "down" | "left" | "right" | null
const { params, hash, setParams } = urlState();      // URL-backed reactive state
const ch = broadcast("app");                         // BroadcastChannel: { last, post, dispose }
const fs = fullscreen();                             // { isFullscreen, element, enter(el), exit(), toggle(el), dispose }
const wake = wakeLock();                             // .request() / .release()

const { latitude, longitude, accuracy, error } = geo({ enableHighAccuracy: true });
const { level, charging } = battery();
const kb = keyboard({ keys: ["Shift"] });           // { pressed: () => Set<string>, isPressed(key), dispose() }
kb.isPressed("Shift");
// Held keys clear when the target's window blurs — for `keyboard({ target: el })`
// that is el's own window, e.g. an iframe's (v4.9).
const { speak, cancel, speaking } = speech();
const { pads } = gamepad();                          // () => GamepadSnapshot[]
const v = vibrate([200, 100, 200]);
const img = imageLoader("/photo.jpg");               // { status, image, width, height, dispose }
// v4.8: a URL outside the allowlist (data:, blob:, javascript:, …) or an empty
// one requests nothing and reports status() === "error".
const { copy, copied } = clipboard();
```

---

## 14. Widgets (sibujs/widgets) — headless state + ARIA `bind()`

Every widget returns a state object AND (v2.0) a `bind(els)` method that wires WAI-ARIA roles, attributes, and APG-spec keyboard. `bind()` is idempotent (WeakMap-keyed) and restores every touched attribute on dispose.

### tabs

```ts
const t = tabs({ tabs: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
t.activeTab(); t.setActiveTab("b"); t.nextTab(); t.prevTab(); t.isActive("a");

const dispose = t.bind({
  tablist,                          // HTMLElement
  tabs: { a: aBtn, b: bBtn },
  panels: { a: aPanel, b: bPanel }, // optional
});
```

### accordion

```ts
const acc = accordion({
  items: [{ id: "faq1", label: "…" }],
  multiple: false,
});
acc.toggle("faq1"); acc.isExpanded("faq1");
acc.bind({ root: container, triggers: { faq1: t1 }, panels: { faq1: p1 } });
```

### tooltip

```ts
const tip = tooltip({ delay: 200, hideDelay: 100 });
tip.show(); tip.hide(); tip.isVisible();
tip.bind({ trigger: btn, tooltip: tipEl });     // role=tooltip, aria-describedby splice, Escape, hoverable
```

### popover (non-modal dialog)

```ts
const pop = popover();
pop.open(); pop.close(); pop.toggle();
pop.bind({ trigger: btn, popover: popEl, labelledBy: titleEl });
```

### combobox (APG Combobox 1.2)

```ts
const c = combobox({ items, filterFn, itemToString });
c.setQuery("…"); c.filteredItems(); c.highlightNext(); c.selectHighlighted();
c.bind({ input: inputEl, listbox: listEl, option: (item, i) => optEls[i] });
```

### select (listbox)

```ts
const s = select({ items, multiple: false, isDisabled });
s.select(item); s.selectedItem(); s.toggle(item);
s.bind({ listbox: listEl, option: (item, i) => optEls[i] }); // typeahead + disabled-aware
```

`select()` is an always-visible listbox. For the usual dropdown (a button that
opens a list), use `selectMenu()`.

### selectMenu (APG select-only combobox, v4.13)

A trigger button that opens a popup listbox whose options can be **arbitrary
DOM**, such as each font name in its own typeface, which a native `<select>`
cannot render (macOS Chrome/Safari ignore `font-family` on `<option>`). Focus
stays on the trigger, and the list is navigated through `aria-activedescendant`.

```ts
const menu = selectMenu({
  items: FONTS,                         // or a getter for a reactive list
  value: () => font(),                  // controlled; omit and use defaultValue for uncontrolled
  onChange: setFont,
  itemToString: (f) => f.label,         // typeahead text
  isDisabled: (f) => !f.loaded,
});
const optionEls = FONTS.map((f) => li({ style: { fontFamily: f.css } }, f.label));
const list = ul({ class: "menu" }, optionEls);
const trigger = button(() => menu.value()?.label ?? "Choose a font");
const dispose = menu.bind({ trigger, listbox: list, option: (_f, i) => optionEls[i] });
menu.open(); menu.close(); menu.toggle(); menu.isOpen(); menu.active(); menu.activeItem(); menu.select(f);
```

| Key | Closed | Open |
|---|---|---|
| ↓ / ↑ / Enter / Space | open on the selected option | ↓↑ move (skip disabled, clamp); Enter/Space commit + close |
| Alt+↑ | — | commit + close |
| Home / End | open on first / last | first / last enabled |
| PageUp / PageDown | — | move by `pageSize` (default 10) |
| Escape | not handled (reaches the page) | close, keep value |
| Tab | — | commit, close, focus moves on (not claimed) |
| printable char | open + typeahead | typeahead (500 ms buffer; repeated letter cycles; Space continues a buffer) |

Outside press closes without committing, as does focus leaving the trigger. A
click on an option commits it and returns focus to the trigger. Pressing inside
the list never blurs the trigger. The active option is scrolled into view, and
the listbox is `hidden` while closed. `aria-selected` follows `value()` even
when it changes from outside while the list is open.

### Keyboard ownership — `isWidgetKeyEvent()` (v4.13)

Every widget **claims** the key events it acts on. Page-level shortcuts test
the claim, so arrowing through a dropdown does not also nudge the canvas, and
Escape that closes the dropdown does not also close the panel:

```ts
import { isWidgetKeyEvent, widgetKeyOwner } from "sibujs/widgets";
document.addEventListener("keydown", (e) => {
  if (isWidgetKeyEvent(e)) return;            // widgetKeyOwner(e) → "selectMenu" | "tabs" | …
  if (e.key === "ArrowLeft") nudgeLayer(-1, 0);
  if (e.key === "Escape") deselect();
});
```

- Claiming **marks** the event and does not stop propagation, so focus traps
  and loggers still see it. Popover and tooltip keep their existing
  `stopPropagation()` on Escape.
- A widget ignores an event a nested widget already claimed: Escape in a
  `selectMenu` inside a `popover` closes the menu, and the next Escape closes
  the popover. `dialog()` (`sibujs/ui`) ignores a claimed Escape the same way.
- Unhandled keys are not claimed. Closed-menu Escape and ArrowLeft/Right in a
  `selectMenu` reach the page as before.

### fileUpload

```ts
const u = fileUpload({ accept: "image/*", multiple: true, maxSize: 5e6 });
u.files(); u.errors(); u.addFiles(fileList); u.clear();
u.bind({ input: fileInput, dropZone: dropEl, hint: hintEl, errorRegion: errEl });
```

### datePicker

```ts
const p = datePicker({ initialDate, minDate, maxDate });
p.select(new Date()); p.nextMonth(); p.daysInMonth(); p.isSelected(date);
p.bind({ grid: gridEl, cell: (date) => cellEls.get(date.toDateString()) });
// Keyboard: arrows + Home/End + PageUp/Down (month) + Shift+PageUp/Down (year)
```

### contentEditable

```ts
const { content, setContent, bold, italic, underline, isFocused, setFocused } = contentEditable();
setContent({ html: "<b>hi</b>", sanitize: true }); // options form preferred
```

---

## 15. UI helpers (sibujs/ui)

```ts
// Forms — validators: required, email, minLength, maxLength, min, max (or any (v) => string | null)
const f = form({
  email: { initial: "", validators: [required(), email()] },
  age:   { initial: 0,  validators: [min(0), max(120)] },
});
const { fields, errors, isValid, isDirty, values, submitting, handleSubmit, reset } = f;
// v2.0: fields[name].set(val) clears manualErrors on edit (server errors don't stick)
input(bindField(fields.email, { type: "email" }));  // spreads value + on.input/change/blur
// bindField handles text/checkbox/select; a <select multiple> sets the field to an array of values
formEl.addEventListener("submit", handleSubmit(async (vals) => api.save(vals)));
// v4.6: a failing submit (throw or rejection) is reported with phase "async" and
// always releases submitting(); a synchronous throw no longer propagates to the caller.
onCleanup(f.dispose, formEl); // v4.6: releases the field errors and the aggregate deriveds

const mask = inputMask({ pattern: "(999) 999-9999", placeholder: "_" });
mask.bind(inputEl); // returns dispose

// Lists
VirtualList({ items: () => rows(), itemHeight: 48, containerHeight: 480, renderItem: (it) => row(it) });
// One axis only: vertical, fixed item + container height, window re-rendered per scroll.
// No horizontal virtualization or sticky headers — build 2-D grids from nested keyed each().
const feed = infiniteScroll({ onLoadMore: () => loadMore(), hasMore: () => more(), threshold: 200 });
feed.sentinelRef.current = sentinelEl;       // observed element; feed.loading(), feed.dispose()
const page = pagination({ totalItems: () => rows().length, pageSize: 20 });
onUnmount(page.dispose, el); // v4.5: releases its subscriptions to totalItems

// A11y
const fm = createFocusManager(container);
const lb = createListbox(listEl, { multiple: true });  // options: [role="option"][data-value]
lb.selectedValues();                          // v4.6: string[] in selection order (commas and "" are fine)
const d  = createDialogAria(dialogEl, { labelledBy: "dlg-title", describedBy: "dlg-desc" }); // ids
const id = createId("field");                 // v4.6: per-request counter inside runInSSRContext
hotkey("mod+s", () => save());                // v4.6: mod = Cmd on Apple, Ctrl elsewhere; unknown modifiers throw
announce("Saved", "polite");
const trapped = FocusTrap(panelEl, { autoFocus: true, restoreFocus: true }); // returns the container element
lazyEffect(el, () => animateIn(el));        // IntersectionObserver-gated

// Overlays
const dlg = dialog();                         // open-state controller, no DOM binding; Escape closes the top open one
dlg.open(); dlg.close(); dlg.toggle(); dlg.isOpen(); dlg.dispose();
const toasts = toast({ duration: 3000, maxToasts: 3 });   // a queue — render toasts() yourself
toasts.success("Saved"); toasts.show("Heads up", "warning"); toasts.dismissAll();

// Typed event bus — delivery walks a snapshot (v4.6): a throwing handler is
// reported and the rest still run; handlers added mid-emit get the next event.
const bus = eventBus<{ saved: User }>();
const off = bus.on("saved", (u) => toasts.success(`Saved ${u.name}`));
bus.emit("saved", user); off();

// Scoped styles — injects the prefixed CSS; put `attr` on the root element
const { scope, attr } = scopedStyle(".root { color: red; }");
const Card = withScopedStyle(".root { padding: 1rem; }", Container);
```

### Embedding a player — `embed()` (v4.12)

`iframe` is refused by the tag factories, `svgElement()` and `DOMPool`.
`embed()` is the one runtime door, and only to origins you allowlist. Never
build the frame with `document.createElement("iframe")`.

```ts
import { embed, setEmbedPolicy } from "sibujs/ui";

// Once at startup — on the server too. Origin, optionally with a path prefix.
// The default policy allows nothing.
setEmbedPolicy({
  allowedOrigins: ["https://www.youtube-nocookie.com/embed/", "https://player.vimeo.com/video/"],
});

function YouTube(id: string, title: string) {
  return embed({
    src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
    title,                                       // required: the frame's accessible name
    allow: "accelerometer; encrypted-media; picture-in-picture",
    aspectRatio: "16 / 9",                       // width: 100%, height from the ratio
  });
}
```

- `src` (a string or a getter) must be absolute `https:` and match an
  allowlisted origin and path prefix; otherwise it is omitted, with a dev
  warning. `javascript:`, `data:`, `blob:`, relative URLs and the page's own
  origin never match. A getter is re-checked on every change.
- Defaults: `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`,
  `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups
  allow-popups-to-escape-sandbox"` (`DEFAULT_EMBED_SANDBOX`, written before
  `src`). `sandbox`, `referrerpolicy` and `allow` can only be narrowed: extra
  sandbox tokens and non-player `allow` features (camera, microphone,
  geolocation, …) are dropped. `srcdoc` is never written.
- `allow` keeps a feature only when every declaration of it grants the frame's
  own origin (bare name, `'src'` or `*`). `fullscreen 'none'`, `fullscreen
  'self'` and `fullscreen https://other.example` drop `fullscreen` rather than
  grant it; feature names are case-sensitive (`FullScreen` grants nothing).
  `allowfullscreen` is written only when `fullscreen` survives.
- A `title` getter that turns blank keeps the previous title.
- `setEmbedPolicy()` inside `runInSSRContext()` configures that request only
  (multi-tenant servers); outside a request it sets the process-wide policy.
  A frame keeps the policy in force when it was built, for its whole life.
- `renderToString` serializes the frame against what `embed()` wrote: only the
  attributes it writes (plus `id`, `class`, `style`, `width`, `height`,
  `data-*`, `aria-*`) are served, `src` is re-checked, `sandbox` / `allow`
  can only be narrower, and a frame whose `title` was removed is not served.
  Mutating the frame later can only narrow what the server sends.

Click-to-load ("lite") variant — the thumbnail renders (and server-renders)
until the visitor asks for the player, so the page loads no third-party code
up front:

```ts
import { button, img, signal, when } from "sibujs";
import { embed } from "sibujs/ui";

function LiteYouTube(id: string, title: string) {
  const [playing, setPlaying] = signal(false);
  const safeId = encodeURIComponent(id);
  return when(
    () => playing(),
    () =>
      embed({
        src: `https://www.youtube-nocookie.com/embed/${safeId}?autoplay=1`,
        title,
        allow: "autoplay; encrypted-media; picture-in-picture",
        aspectRatio: "16 / 9",
        loading: "eager",                        // the visitor asked for it
      }),
    () =>
      button(
        { class: "lite-yt", "aria-label": `Play: ${title}`, on: { click: () => setPlaying(true) } },
        [img({ src: `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`, alt: "", loading: "lazy" })],
      ),
  );
}
// Style .lite-yt with aspect-ratio: 16 / 9 and a play icon; keep it a <button> for keyboard users.
```

---

## 16. Motion (sibujs/motion)

```ts
const [x, setX, disposeSpring] = springSignal(0, { stiffness: 0.15, damping: 0.8 }); // v2.0: dt-aware
setX(200);
const t = transition(el, { duration: 300, easing: "ease-out" });   // { enter(), leave() } → Promise<void>
const group = TransitionGroup({                // controller, not an element
  enter: (el) => animate(el, fadeIn()),
  leave: (el) => animate(el, fadeOut()),
});
group.track(list);                            // record positions for FLIP-style moves
group.add(el);                                // animate one in
await group.remove(el);                       // animate out, resolves when done
const vt = viewTransition(() => setView("next")); // View Transitions API
await vt.start(); vt.isTransitioning();
await animate(el, fadeIn({ duration: 300 }));  // Promise<void>
await stagger([a, b, c], slideIn("up"));      // presets are factories: slideIn(direction?, opts?)
```

---

## 17. Performance (sibujs/performance)

```ts
startTransition(() => setHeavy(big));            // normal priority
const slow = deferredValue(() => heavyDerived());  // mirrors the source at LOW priority
const cancel = scheduleUpdate(Priority.LOW, () => doWork());

// Compiled / static HTML (v2.0: requires TrustedHTML — CWE-79 gate)
const Hero = staticTemplate(trustHTML(`<section>…</section>`));
const Compiled = precompile(trustHTML(`<li></li>`), (el, props) => { el.textContent = props.text; });

// DOM node recycling
const pool = new DOMPool(200);                   // or getDOMPool() for the shared pool
const li = pool.acquire("li"); pool.release(li);

// Normalized entity store ({ ids, entities } per entity type)
const users = normalizedStore<User>({ name: "user" });   // idKey defaults to "id"
users.add(u); users.addMany(list); users.get("1"); users.getAll();
users.update("1", { name: "Ada" }); users.remove("1"); users.select((x) => x.admin);

// Preload an image; resolves with the loaded HTMLImageElement. v4.8: a URL
// outside the allowlist (including data: and blob:) requests nothing and rejects.
await preloadImage("/hero.webp");

// Code-split chunk loader (LRU cache + retry)
const chunks = createChunkRegistry({ cacheTTL: 60_000, retries: 3 });
const Heavy = lazyChunk("heavy", () => import("./Heavy"), chunks, () => Loading()); // () => HTMLElement
chunks.preload("heavy", () => import("./Heavy"));
```

### Build plugins (sibujs/build)

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { sibuVitePlugin } from "sibujs/build";

export default defineConfig({
  plugins: [sibuVitePlugin({
    // pureAnnotations: true,     // default — marks direct sibujs factory calls pure for tree-shaking
    // compileTemplates: true,    // default in production — compiles html`` templates imported from sibujs
    // staticOptimize: false,     // v4.7 default — opt-in; see below
    // devMode,                   // default: follows Vite's command/mode (`vite build` = production)
  })],
});
// webpack: plugins: [sibuWebpackPlugin()] from the same entry; dev mode follows webpack's resolved `mode`.
```

What to know from 4.7 (before it, production builds with the plugin were broken):

- **Injected imports target `sibujs`** (they named a package `sibu` that does not
  resolve) — compiled templates, `optimizeDeps`, `createViteConfig`, route
  splitting, the webpack vendor chunk, the CDN helpers and `generateImportMap()`.
- **`compileTemplates` renders exactly what the runtime parser renders.** Since
  4.8 every template is compiled: most become direct DOM code, and the rest — a
  `<meta>` or `<link>` (their static attributes are judged by the contextual
  security policy), a static `srcdoc`, an expression on `value` / `checked`, a
  top-level `${expr}` — are parsed at build time and rendered by the runtime's
  own executor. Only `html` imported from sibujs is compiled; injected imports
  are aliased, so they never collide with a local `div` or `label`.
- **`staticOptimize` is off by default.** It rewrites only provably static calls
  to `staticTemplate` (imported from `sibujs/performance`), and is opt-in because
  it is slower than the tag factory for single elements.
- **Pure annotations and rewrites skip shadowed names**: a local that shares a
  factory's name (a nested `function context()`, a method, a parameter) is left
  alone, so the minifier cannot delete a call with side effects.
- **Source maps and line numbers.** Transformed modules keep their line numbers
  and the Vite plugin returns a source map for every module it changes (no
  "Sourcemap is likely to be incorrect" warning).
- **webpack:** the plugin no longer injects a non-existent loader, and
  `__SIBU_DEV__` comes from webpack's resolved `mode` through `DefinePlugin` (a
  config without `mode` is production). For pure annotations, use a loader file
  that returns `createPureAnnotationsLoader()(source)`; since 4.8
  `sibuWebpackPlugin({ pureAnnotations: true })` logs exactly that instead of
  being silently ignored.

### Pre-rendering an SPA — `prerender` (v4.13)

An SPA ships an empty `<div id="app">`, so crawlers and link-preview bots
(WhatsApp, Facebook, Slack) see no content, and every route shares one title.
`prerender` renders listed routes **once, at build time**, to static HTML. It
needs no render server.

```ts
// vite.config.ts — npm i -D jsdom
sibuVitePlugin({
  prerender: {
    routes: ["/", "/cotizar", "/galeria"],   // or { path, output }
    origin: "https://wraps.example",         // location + base for relative fetch(); default http://localhost
    // entry: "/src/main.ts",                // default: the module script in index.html
    // timeout: 15000, settle: 50, concurrency: 4,
    // shell: "200.html",                    // untouched SPA shell; false to skip
  },
})
```

After the client build, each route runs **the app's own entry** in a fresh
worker thread with jsdom registered as the global DOM. The entry is compiled by
a second Vite SSR build of the same config. The pre-renderer waits until the
page has settled, then writes `dist/<route>/index.html`:

- **Settled** means every `fetch()` and every body read on its response
  (`json()`, `text()`, `arrayBuffer()`, `blob()`, `formData()`, `bytes()`, on
  clones too), every `prerenderWait(promise)`, the
  router's initial navigation and its lazy route chunks have finished, and the
  DOM has been quiet for `settle` ms. A route that does not settle within
  `timeout` fails the build with the number of pending promises.
- The file is the built `index.html` with the rendered `#app` and that route's
  head (title, description, canonical, Open Graph from route `head`, §9). The
  built `<script>` tags are kept.
- `dist/200.html` keeps the untouched shell for routes that were not
  pre-rendered.

**Data.** `fetch()` and the body readers are awaited automatically; a body
nobody reads is never waited for. Relative URLs resolve against `origin`, so
the API must be reachable from the build machine. **Not awaited:** reading
`response.body` as a stream yourself (`getReader()`, `for await`), because a
stream may never end. Wrap that read in `prerenderWait()`. Register any other
async work the same way, or skip work that has no meaning at build time:

```ts
import { isPrerendering, prerenderWait, prerenderRoute } from "sibujs/ssr";
const wraps = prerenderWait(loadFromIndexedDB());     // a no-op in the browser
if (!isPrerendering()) connectWebSocket();            // build time: render the static shell only
```

Leave a route out of `routes` when its content is per-user (an admin panel) or
its data cannot be fetched at build time. It is served from the shell.

**Client takeover — `hydrate()` after `routerReady()`:**

```ts
createRouter(routes, { mode: "history", head: { title: "Wraps Studio", titleTemplate: "%s · Wraps Studio" } });
routerReady().then(() => hydrate(App, document.getElementById("app")!));   // also correct on the empty shell
```

`hydrate()` builds the live app and replaces the static markup in one swap.
`routerReady()` makes sure every route component (lazy chunks included) is
already loaded when the tree is built, so the outlet renders in the same task
and no empty frame is painted. The router adopts the pre-rendered head tags
(they carry `data-sibu-head`) instead of duplicating them. The trade-offs:

- **No flash** when the first client render matches the static page. If it
  differs (a time, a random value, `localStorage`-driven UI), the swap shows the
  client version immediately. Pass `hydrate(App, root, { diagnostics: true })`
  in development to log the first mismatch.
- **Pre-boot interaction is not kept.** Text typed or focus placed before the
  script runs is lost in the swap, so keep the bundle small or render inputs
  disabled until boot. Scroll position survives.
- **The static page is a snapshot.** Data changes after the build appear only
  after the client takes over; rebuild to refresh what bots see.
- `enhance()` (§11) is the alternative for server-owned markup that stays in
  place. It is not used here because the router and the app own the whole tree.

### Pre-rendering from a server entry (v4.14)

```ts
// vite.config.ts — no jsdom needed
sibuVitePlugin({
  prerender: {
    server: "src/entry-server.ts",   // exports routes, head (and optionally routerOptions, app)
    origin: "https://example.com",   // canonical/sitemap base
    fetch: process.env.API_URL,      // base for relative fetch() at build time, or a fetch function
    hydration: "adopt",              // the browser adopts the pages
    // routes: "auto" (default): every route without params + getStaticPaths() pages + redirects
    // trailingSlash: "always" (dir/index.html) | "never" (dir.html); notFound: "/404"; sitemap: true;
    // robots: true | "Disallow: /admin"; nonce; maxStateBytes; outDir; concurrency; timeout
  },
})
```

Each URL is rendered with `renderRoute()` on the server DOM: guards, redirects,
lazy routes and data run as in §10, and the page gets the body, the route head
(the shell's `<title>` is replaced; its text travels in `data-sibu-base-title`)
and the transferred state. Written: `dist/<route>/index.html`, `dist/404.html`
from the `*` route, `dist/200.html` (shell), `dist/sitemap.xml` (not `noindex`,
not `render: "client"`), `dist/robots.txt`, `dist/redirects.json` (a `redirect`
record's 301/302 — answer them in the backend). `render: "client"` / `"ssr"`
routes get the shell plus their head. A route behind a guard (`/mi-cuenta`) is
skipped in `"auto"`; a guard redirect is visitor-dependent and never written as
a static redirect. An API that cannot be reached — or a route that does not
render within `timeout` — fails the build naming the route (or
`getStaticPaths()` of the route). The head markup and the state are inserted
literally: a `$&` or `$'` in a title is text. `sibujs prerender [--routes …]`
(§24) renders an existing build again. The 4.13 jsdom mode (no `server`) is
unchanged; `sitemap`, `robots`, `notFound`, `outDir` and `trailingSlash` are
opt-in there.

```ts
// the client entry
createRouter(routes, { mode: "history", head, trailingSlash: "ignore" });
routerReady().then(() =>
  root.hasChildNodes() ? hydrate(() => Route(), root, { strategy: "adopt" }) : mount(() => Route(), root),
);
```

### Static backend (Python/Go/PHP) + SibuJS pre-rendering

| | 1. Pre-render at build time | 2. Backend templates + islands | 3. Node render sidecar |
|---|---|---|---|
| HTML from | `vite build` | the backend's templates | Node, per request |
| SibuJS on the server | build time only | none | yes |
| Data freshness | last build (rebuild on change) | live | live (cache per URL + version) |
| Choose when | pages change on deploy / admin edits | mostly server pages, a few widgets | per-user or fast-changing pages |

1. **Pre-render** (above). URL → file: `/` → `index.html`, `/cotizar` and
   `/cotizar/` → `cotizar/index.html`, unknown → `404.html` (status 404), a
   browser-only deep link not pre-rendered → `200.html`, `redirects.json` →
   301/302 in the backend. FastAPI: a catch-all that serves those files (see
   `examples/static-backends/fastapi/app.py`); nginx:
   `try_files $uri $uri/index.html /200.html; error_page 404 /404.html;`.
   Hashed `/assets/*` immutable, HTML `no-cache`. **Freshness:** have the admin's
   save call a webhook that runs `sibujs prerender --routes <changed pages>` (or a
   full build) and syncs `dist/`. `createISR()` is a client-side
   stale-while-revalidate resource, not page regeneration; transferred data past
   its `staleTime` refetches in the browser anyway.
2. **Templates + islands.** The backend renders Jinja / `html/template` / PHP;
   `registerIsland` + `mountIslands` (§11) enhance the interactive parts; head
   tags are the template's. No SibuJS on the server.
3. **Sidecar.** `createRenderHandler(routes, { cache: { version } })` behind
   Node's `http` (`examples/static-backends/sidecar/server.mjs`); the backend
   proxies HTML routes to it and falls back to the pre-rendered files when it is
   down.

See `examples/static-backends/` and `fixtures/ssr-app` (the acceptance app) in
the repository; `examples/prerender-spa` is the 4.13 jsdom mode.

---

## 18. Testing (sibujs/testing)

```ts
import { render, fireEvent, waitFor, waitForSignal, queryByText, findByRole, type } from "sibujs/testing";

const { container, getByRole, getByText, unmount } = render(App);
await fireEvent.click(getByRole("button"));
await type(input, "hello");
await waitFor(() => expect(getByText("Saved")).toBeInTheDocument());
await waitForSignal(isLoaded, (v) => v === true);
unmount(); // v2.0: runs dispose() before clearing DOM — no reactive leaks between tests

// v4.14 — server rendering
import { renderOnServer, hydrateInTest } from "sibujs/testing";
const page = await renderOnServer(routes, { url: "/cotizar?servicio=dtf", router: { head }, hydration: "adopt" });
expect(page.status).toBe(200);
expect(page.text("h1")).toBe("Cotiza tu pedido");
expect(page.meta("og:title")).toBe("Cotizar");
const takeover = await hydrateInTest(page.html, () => Route(), { strategy: "adopt", state: page.state });
expect(takeover.mismatches).toEqual([]);
expect(takeover.created).toBe(0);   // elements the takeover had to create
```

`renderOnServer` takes a route table (`url`) or a component and returns the
render result plus `query`, `queryAll`, `text`, `getByText`, `meta`, `title`
over the HTML (needs jsdom/happy-dom for parsing). `hydrateInTest` runs the
transfer script, hydrates (replace or adopt) and counts created elements.

---

## 19. Ecosystem adapters (sibujs/ecosystem)

```ts
import { reduxAdapter, zustandAdapter, mobXAdapter } from "sibujs/ecosystem";
import { plugin, inject } from "sibujs/plugins";

// v2.0: useSelector → select
plugin(reduxAdapter({ store: reduxStore }));
const redux = inject<ReduxAdapterAPI<MyState>>("redux");
const count = redux.select(s => s.counter);
redux.dispatch({ type: "INC" });

plugin(zustandAdapter({ store: bearStore }));
const zs = inject<ZustandAdapterAPI<BearState>>("zustand");
const bears = zs.select(s => s.bears);
bears.dispose(); // v4.5: select() returns a derived — dispose one discarded before the adapter

plugin(mobXAdapter({ autorun }));            // pass MobX's autorun — sibujs never imports mobx
const mobx = inject<MobXAdapterAPI>("mobx");
const val = mobx.fromMobX(() => observable.value);

// v3.4: UI-component-library adapters — wrap a component library as Sibu components
import { antdAdapter, componentAdapter, createTheme } from "sibujs/ecosystem";
const { Button, Input, Card } = antdAdapter.components;   // ready-made: antdAdapter / chakraAdapter / materialAdapter
mount(() => Button({ variant: "primary" }, "Save"), root);

const ui = componentAdapter({                              // ...or adapt your own library declaratively
  name: "my-lib",
  prefix: "my",
  components: {
    Button: { tag: "button", baseClass: "my-btn", variants: { primary: "my-btn-primary" }, sizes: { sm: "my-btn-sm" } },
  },
});
ui.components.Button({ variant: "primary", size: "sm" }, "Save"); // v4.6: children are positional

// Every adapter owns a reactive theme; components update when it changes (v4.6).
ui.theme.setTheme({ classOverrides: { "Button-primary": "brand-btn" } }); // keys: <Component>, <Component>-<variant|size>
ui.theme.setTheme({ prefix: "acme" });                    // re-prefixes the mapping's "my-…" classes
const release = ui.theme.applyTo(document.documentElement); // syncs theme.variables as CSS custom properties
const theme = createTheme({ prefix: "my", variables: { "--radius": "6px" } }); // standalone theme
```

---

## 20. Devtools (sibujs/devtools)

```ts
import { initDevTools, enableDebug, measureRender, createProfiler,
         captureSignalGraph, diffSignalGraphs, createTraceProfiler } from "sibujs/devtools";

initDevTools();                                // v2.0: enabled/expose default to development builds only
initDevTools({ enabled: true, expose: true }); // explicit; expose puts the API on globalThis.__SIBU__
enableDebug();                                 // verbose logging; disableDebug() / isDebugEnabled()
const MeasuredList = measureRender("MyList", MyList);   // returns the wrapped component
const prof = createProfiler("MyList");         // { renderCount, lastRenderTime, averageRenderTime, … }

// HMR
import { registerHMR, clearHMRModule, createHMRBoundary } from "sibujs/devtools";
```

---

## 21. Migration cheat sheets

### 4.0 breaking changes

| Breaking change | Before (3.x) | After (4.0) |
|---|---|---|
| Node.js | `>= 18.0.0` | **`>= 22.3.0`** — SSR request isolation needs `process.getBuiltinModule` |
| Browsers | Chrome 80 / FF 78 / Safari 14 | **Chrome/Edge 93, FF 92, Safari 15.4** (what the source already required) |
| WASM options | `loadWasmModule(src, options)` | `loadWasmModuleWithOptions(src, options)` — `loadWasmModule`'s 2nd arg is `WebAssembly.Imports` only |
| `CustomElementOptions.extends` | declared, read nowhere | **removed** — customized built-ins were never implemented |

Nothing else was removed or renamed; several type declarations became *more*
permissive, so 3.x code still compiles.

### New in 4.14.1

A fix to the built-in server DOM (`sibujs/ssr/dom`); nothing else changed.
Writing `input.defaultChecked`, `option.defaultSelected`, `option.label` or an
attribute node's `nodeValue` / `textContent` during a server render threw
`Cannot set property … which has only a getter`, and `select.multiple` did not
reflect. They now behave as in a browser and in jsdom: the defaults set or
remove the `checked` / `selected` attribute, which `checked` / `selected`
follow until written; in a `<select>` without `multiple`, `selected = true`
deselects the other options and a `defaultSelected` write keeps only the last
selected one. Nothing to change in application code.

### New in 4.14

Server rendering that works without hand-wiring: one `await` renders a settled
page, a built-in server DOM, the router renders a URL with an HTTP status,
one head API for server and client, opt-in adopting hydration, automatic data
transfer, pre-rendering from a server entry, component islands from SSR,
out-of-order streaming, and test helpers.

| New API | Where |
|---|---|
| `renderToStringAsync()`, `renderToDocumentAsync()`, `settled()`, `formatRenderDiagnostics()` | `sibujs/ssr` (§10) |
| `renderRoute()`, `createRenderHandler()` | `sibujs/ssr` (§10) |
| `installServerDom()`, `createServerDocument()`, `isServerDom()` | `sibujs/ssr/dom` (§10) |
| `hydrate(App, root, { strategy: "adopt" })`, `{ hydration: "adopt" }` render option | `sibujs/ssr` (§10) |
| `renderToReadableStream(() => App(), options)` (out-of-order Suspense) | `sibujs/ssr` (§10) |
| `island(name, Component, props, { load })`, `islandComponent()`, `componentIsland()` | `sibujs/ssr` (§11) |
| `isServer()`, `isClient()`, `ClientOnly()`, `effect(fn, { server: true })` | `sibujs` (§10) |
| `createRouter({ mode: "memory", url, trailingSlash })`; route `status`, `render`, `getStaticPaths` | `sibujs/plugins` (§9) |
| route `head`: `robots`, `twitter`, `alternates`, `jsonLd`; `serializeJsonLd()`, `jsonLdScript()` | `sibujs/plugins` (§9) |
| `query(…, { ssr })`, `resource(…, { key })` | `sibujs/data` (§10) |
| `sibuVitePlugin({ prerender: { server, fetch, trailingSlash, outDir, notFound, sitemap, robots, hydration, … } })` | `sibujs/build` (§17) |
| `renderOnServer()`, `hydrateInTest()` | `sibujs/testing` (§18) |
| `serializeState(…, { global })` | `sibujs/ssr` |

What a 4.13 app could notice — only inside server renders, none in a browser:

| Change | Before (4.13) | After (4.14) |
|---|---|---|
| `query()` inside `runInSSRContext` | never fetched (its effect did not run); `data()` was `initialData` | fetches; the async renderers wait for it. `renderToString` is still synchronous and does not wait |
| `resource(source, fetcher)` inside `runInSSRContext` | never fetched | fetches |
| `onMount` / `onUnmount` inside `runInSSRContext` with happy-dom/jsdom registered | ran | do not run (as the SSR docs always said) |
| route `head` with a `canonical` the URL policy refuses | `<link rel="canonical">` without `href` | no link at all |
| `Head()` inside an SSR request scope | wrote into the shared `document.head` | collected for the render result |
| A memory router created inside a request scope | no memory mode existed | request-scoped |
| `serializeState()` with a `"__proto__"` key | an object-literal payload: the key set the prototype in the browser | emitted through `JSON.parse`: the browser reads it as data, as the server did |
| A route head `titleTemplate` with `$&` / `$'` in the title | spliced in matched text | inserted literally |

- **Unchanged:** `renderToString`, `renderToDocument`, node-based
  `renderToReadableStream`, `hydrate()` (replace), `island(id, factory)`,
  `hydrateIslands`, `enhance` / `mountIslands`, the 4.13 pre-renderer's output
  (its new options are opt-in), and the browser behaviour of every API.
- **Security:** every new output path goes through the existing policy — the
  serializer's attribute rules, the head entry/URL policy for route and
  component head, `escapeScriptJson` for the transfer script and JSON-LD,
  attribute escaping for island props. Adoption strips server attributes the
  client did not write and re-checks kept ones (`src`, `value`) against the URL
  policy. `trustHTML()` stays the only raw-HTML door. The serializer escapes
  comment text beginning with `>` or `->`; a redirect `Location` is
  percent-encoded; `trailingSlash: "ignore"` and the server DOM's `!important`
  parsing do not backtrack on a long run of `/` or spaces from a request; the
  render handler answers a throwing render with a bare 500, and its page cache
  is bounded in bytes and never stores a `private` / `no-store` page.

### New in 4.13.1

No runtime or API changes: the published code is the same as 4.13.0 apart from
the version it reports. The release makes a pre-renderer test independent of
machine speed.

### New in 4.13

Bindings in an outgoing branch never re-run, a select-only dropdown widget with
keyboard ownership, per-route `<head>`, build-time pre-rendering, and an
explicit opt-out for intentional focus loss. New API: `selectMenu()`,
`isWidgetKeyEvent()`, `widgetKeyOwner()` (`sibujs/widgets`); route `head`,
`createRouter({ head })`, `routerReady()`, `resolveRouteHead()`,
`routeHeadToHTML()` (`sibujs/plugins`); `isPrerendering()`, `prerenderRoute()`,
`prerenderWait()` (`sibujs/ssr`); `sibuVitePlugin({ prerender })`, `prerender()`
(`sibujs/build`); the `focus` option of `when()` / `match()`. Behavior changes
to check when upgrading:

| Change | Before (4.12) | After (4.13) |
|---|---|---|
| One write both switches a `when`/`match`/`each`/`KeepAlive`/`DynamicComponent` branch and changes what the branch reads (`setSel(null)` under `match(() => sel()?.id ?? "", …, () => span(() => sel()!.name))`) | each binding in the outgoing branch ran once more and threw (`Uncaught error during binding`) before the branch was disposed | the branch is disposed first; its bindings, effects and nested directive selectors do not run again (§6). Remove "cache the last non-null value" workarounds |
| A key a widget handles (arrow in a listbox, Escape in a combobox) bubbling to a page-level `keydown` | indistinguishable from a page key | marked: `isWidgetKeyEvent(e)` is `true` (§14). Propagation is unchanged |
| Escape handled by a widget nested in a `popover()` / `tabs()` / `dialog()` | the outer one acted too (Escape closed the combobox *and* the dialog) | only the inner widget acts. The next Escape reaches the outer one |
| `when(cond, then, { focus: … })` / `match(v, cases, { focus: … })` | a plain object branch rendered `[object Object]` | the object is the options bag (§6) |
| Routes declaring `head` | no such option | the router owns `document.title` and those tags (§9). Routes without `head` anywhere: nothing changes |

- **Unchanged:** `hydrate()` still replaces the server tree, and it is the
  takeover for pre-rendered pages (§17). `Head()` and `title()` keep their
  lease semantics and layer above route titles.
- **Security:** route `head` values pass the same entry and URL policy as
  `Head()`. The pre-renderer runs your own entry with your own config. It
  writes only under `outDir` and refuses route paths containing `..`.

### New in 4.12

SVG in server output, a clear error for SSR without a DOM, a safe way to embed
a player, hash-mode routes kept in the fragment, and nullable attribute getters
in the typed props. New API:
`embed()`, `setEmbedPolicy()`, `DEFAULT_EMBED_SANDBOX` and the types
`EmbedProps` / `EmbedPolicy` (all from `sibujs/ui`). Behaviour changes to check
when upgrading:

| Change | Before (4.11) | After (4.12) |
|---|---|---|
| `renderToString()` / `renderToStream()` with SVG or MathML in the tree | emitted as escaped text — the graphic was missing until hydration | serialized as markup, names and `xlink:` prefixes intact, empty elements self-closed, under the runtime policy (§10). `element.outerHTML` workarounds can go |
| A foreign element the HTML parser would rebuild in another namespace (an SVG `<path>` outside `<svg>`, an SVG element named `meta` / `p` / `img`, an HTML `<div>` directly inside `<svg>`) | emitted as escaped text | stripped with its subtree, so an inert SVG `<link>` / `<meta>` can never be served as a live HTML one |
| A `<set>` / `<animate>` aimed at `href` or an `on*` attribute in SSR output | nothing SVG was emitted | the element is emitted without its `attributeName`, as the client writers leave it |
| Building a tree with no global `document` (plain Node, no DOM registered) | `ReferenceError: document is not defined` from inside a tag factory | `Error: renderToString needs a DOM: register happy-dom or jsdom globals first` from the first builder (§10) |
| `createRouter(routes, { mode: "hash" })` then `navigate("/editor/1")` | wrote `/editor/1` into the pathname and `RouterLink` rendered `href="/editor/1"`, so a reload resolved the wrong route | writes `/#/editor/1`; `RouterLink` renders `href="#/editor/1"`; the document's path and query are left alone (§9) |
| Embedding a YouTube / Vimeo player | impossible without `document.createElement("iframe")` | `embed()` with `setEmbedPolicy()` (§15); plain `iframe` stays refused |
| `img({ width: () => (ok() ? "640" : null) })` and other typed attribute getters returning `null` / `undefined` | TS2345 | type-checks; the runtime already removed the attribute. `value` / `checked` / `selected` / `disabled` unchanged |

- **Unchanged:** `hydrate()` still replaces the server tree. An adopting
  strategy is designed (`docs/architecture/hydration-adopt.md`) but not
  shipped; nothing in 4.12 changes hydration.
- **Security:** nothing in 4.12 widens what a runtime value can inject. SSR of
  SVG applies the same policy as the client writers; `embed()` only frames
  `https:` origins the application allowlisted, with a sandbox and permissions
  callers can narrow but not widen, and the SSR serializer judges an `embed()`
  frame against what `embed()` wrote, so a later mutation can only narrow it.

### New in 4.11

Every value of a repeated query key, and outlets that render when attached
late. New API: `RouteContext.queryAll` (`route().queryAll`,
`routerState().queryAll()`), array values in a navigation object's `query`, and
the types `QueryValues` and `NavigationQuery` (all from `sibujs/plugins`).
`route().query` is unchanged — last value wins. Behaviour changes to check when
upgrading:

| Change | Before (4.10) | After (4.11) |
|---|---|---|
| Query identity with a repeated key (`?tag=a&tag=b` vs `?tag=b`) | the same route — only the last value was compared | different routes: every value counts, in order; key order still does not matter. Affects `duplicate` detection, `RouterLink` exact-active and the `KeepAliveRoute` cache key (§9) |
| `navigate("/queue?status=a&status=b")`, and the first resolution of a page loaded with that URL | the address bar was rewritten to `?status=b` | the URL keeps every value |
| Adding a value to a multi-value filter (`?status=b` → `?status=a&status=b`) | refused as `duplicate` | navigates |
| An outlet created first and attached later (`const page = Route()` handed to `when()`) | rendered nothing until the next navigation | renders once attached, also inside a subtree that joins the document later |
| An outlet created before `createRouter()` | rendered nothing | renders once the router exists, and follows a replacement router |

- **Workarounds to remove:** reading `location.search` with `URLSearchParams`
  and rewriting the URL with `history.replaceState` after `navigate()` to keep
  repeated keys; loading data before mounting only so `Route()` could sit
  directly in the layout instead of inside `when()`.
- **Errors:** a `Route()` pass that fails while its anchor is detached shows
  its error, with the Retry button, once the anchor is attached; a navigation
  started in the meantime wins over the held error.

### New in 4.10.1

A typing fix. `onMount(() => { el.focus(); }, el)` failed to compile (TS2345)
because the callback was typed `() => undefined | CleanupFn`; it is now
`() => void | (() => void)`, so the `return undefined;` workaround can go.
Nothing changes at runtime. Async callbacks remain outside the contract and are
rejected by the type.

### New in 4.10

Route pages read their own committed route, and `query()` stops refetching
when its key getter re-runs to the same key. No public type changes. Behaviour
changes to check when upgrading:

| Change | Before (4.9) | After (4.10) |
|---|---|---|
| `route()` / `routerState()` / `router().currentRoute` inside a route page that is being replaced | returned the **incoming** route while the outgoing page was still mounted — its effects re-ran with the next page's params, and its teardown saw them too | return the route **that page** was committed with, until it is disposed; guards such as "only follow routes under this prefix" are no longer needed (§9) |
| A page the outlet keeps (query- or hash-only change, a layout whose child changed) | followed every navigation | unchanged: it is handed each new route |
| Nested `Outlet()` inside an outgoing layout | cleared its child as soon as the navigation committed | keeps its child until the layout is disposed |
| `KeepAliveRoute()` view while cached | kept following navigation | keeps its own route; gets the current one when shown again |
| `query()` key getter re-running to the **same** key (`` () => `user:${id() % 10}` `` with `id` 1 → 11) | refetched (always, with the default `staleTime: 0`) | no fetch; wrapping the key in `derived()` is no longer needed (§8) |

- **Scope of the fix:** everything a route component creates reads its route —
  in setup, and later through `when`/`match`/`each`, `lazy()`, `Suspense`,
  `Portal`, `onMount` / `onUnmount` (including the cleanup `onMount` returns).
  Code outside route instances (app shell, tests, code right after
  `await navigate()`) still reads the router's current route immediately.
- **Limit:** in a *direct* async route component (`component: async () => …`),
  only the code before the first `await` is scoped; code after it, and any
  effect it creates, reads the router's route. `lazy()` pages are scoped,
  because SibuJS calls the module's factory after it resolves; an `async`
  factory inside a `lazy()` module has the same limit (§9).
- **Unchanged:** navigation timing, guards, `afterEach`, loaders, SSR and
  hydration.
- **Fixed:** `lazyChunk()`, `defineRemoteComponent()` and an `ErrorBoundary`
  fallback for a rejected async child render in the owner scope of the
  component that asked for them.

### New in 4.9

Reactive `enabled` for queries, one router query identity, and lifecycle and
document-ownership fixes. The only type change widens `enabled` to
`boolean | (() => boolean)`. Behaviour changes to check when upgrading:

| Change | Before (4.8) | After (4.9) |
|---|---|---|
| `query()` / `infiniteQuery()` `enabled: () => boolean` | the function was taken as `true`; the query fetched at once | reactive: idle while `false`, fetches when it turns `true` (§8) |
| Navigating to the current URL with its query reordered (`?b=2&a=1` from `?a=1&b=2`) | a new navigation | fails with `reason: "duplicate"`, as `RouterLink` already matched it; `KeepAliveRoute` reuses the cached view (§9) |
| `svgElement()` given a child from another document or an iframe | silently dropped | appended (adopted); a plain object that only imitates a node throws a `TypeError` |
| `longPress` with a second pointer down during a press | could start a second timer that was never cancelled | ignored; the press belongs to the pointer that started it (§6) |
| `keyboard({ target })` for an element in an iframe | held keys cleared on the top window's blur | cleared on the element's own window's blur |

- **Fixed (data):** a `query()` on the empty key no longer shares one cache
  entry with every other idle query (the first one's `initialData` leaked into
  the rest); `fetching()` no longer stays `true` after a key change to fresh
  cached data; concurrent `createISR().revalidate()` calls join the running
  fetch — the fetcher runs once and every caller settles with it, instead of
  the later calls resolving at once.
- **Fixed (router):** `?a=x%26b%3Dy` is no longer exact-active for `?a=x&b=y`,
  and a URL with a repeated key (`?tag=a&tag=b`) is exact-active on itself.
- **Fixed (lifecycle):** `longPress` could fire after release or after disposal
  when a second `pointerdown` overwrote its timer; `pointercancel` now ends a
  press.
- **Fixed (documents and realms):** `KeepAlive` wraps a fragment built in an
  iframe instead of emptying it; `clickOutside` and `trapFocus` use the
  element's own document.

### New in 4.8

Security hardening of every attribute writer, plus fixes for directive
unmounting and locale-aware formatting. Behaviour changes to check when
upgrading:

| Change | Before (4.7) | After (4.8) |
|---|---|---|
| A refused URL, `srcset` or `style` value | written empty (`<a href="">`) | the attribute is **omitted** (`<a>`), as `Head()` and SSR already did; an authored `""` is still written |
| Runtime `href` on a `<link>` whose `rel` contains `stylesheet` | loaded whatever CSS the URL pointed at | refused in either attribute order and through reactive changes (`preload` → `stylesheet`); name the stylesheet in static template source or use `Head({ link })` from `sibujs/ssr` |
| Runtime `src` / `href` / `type` on a `<script>` (`` html`<script src=${url}>` ``) | written when the URL passed the allowlist | refused; name the script in static source or use `Head({ script })` |
| `<meta>` with a reactive `http-equiv` or `content` | `meta()` / `html` / bindings could publish a refresh redirect `Head()` refused | never carries a refresh directive, on every API |
| Static `srcdoc` in an `html` template | written on the client (SSR dropped it) | refused everywhere |
| `preloadImage()` / `imageLoader()` with a refused URL (including `data:` and `blob:`) | requested it | request nothing: `preloadImage()` rejects with an `Error`, `imageLoader()` reports `status() === "error"` |
| `svgElement()` / `DOMPool.acquire()` with `script`, `iframe`, `object`, `embed`, `frame` or `frameset` | created the element | refused, like the tag factories |
| `worker()` / `workerFn()` / `createWorkerPool()` given a non-function | turned it into worker source with `toString()` | throw a `TypeError` |

- **Trust model:** static template source (the text of an `html` template) is
  developer-authored and trusted; runtime values (`${…}` interpolations, props,
  getters, `enhance()` values) are untrusted by default — URL allowlist, `on*`
  strings refused, `style` filtered per declaration. Contextual rules (meta
  refresh, runtime `<script>` source, runtime stylesheet `href`, SVG animation
  targets) apply whatever the source, and `srcdoc` is refused everywhere. SSR
  applies the runtime value policy to everything it emits. SibuJS does not
  sanitize arbitrary HTML — `trustHTML()` is a compile-time brand, not a check.
- **Security:** `scopedStyle()` uses the framework's CSS policy (its private
  copy let `image-set()`, `image()`, `src()` and an `@import` without `;`
  through); `createTheme()` / `setTheme()` filter variable values like any
  inline style; SVG `<set>` / `<animate>` may not target a URL or handler
  attribute; `sanitizeSrcset()` splits candidates like the browser; SSR without
  a DOM drops only the blocked `style` declarations instead of the whole
  attribute; a response's `"__proto__"` key stays data under structural
  sharing; `machine()` ignores events and states that are not the config's own.
- **Fixed:** unmounting a `when()` / `match()` root removes its branch (it used
  to stay on the page with live bindings, §6); `formatNumber()` /
  `formatCurrency()` follow the i18n locale (§9); `defineRemoteComponent()`
  accepts any `Element` root; `enableListenerTracking()` accepts an
  `AbortSignal` from another realm.
- **Build:** every `html` template is compiled, and `<meta>` / `<link>`
  templates keep the runtime's security checks in production (§17).

### New in 4.7

Live i18n, stable query data, precise types and a working production build
plugin. Behaviour changes to check when upgrading:

| Change | Before (4.6) | After (4.7) |
|---|---|---|
| Route param change (`/records/1` → `/records/2`) | kept the first instance, which went on showing the old record | the route's component **remounts** (`onUnmount`/`onCleanup` run); query/hash-only changes and catch-all `*` tails keep the instance; a constant `key` restores reuse (§9) |
| Identical background refetch | committed a new reference and re-rendered every binding over `data` | deeply equal data keeps its reference and notifies nobody (`structuralSharing`, §8) |
| `sibuVitePlugin({ staticOptimize })` | on by default (and produced broken code) | **off** by default, opt-in (§17) |
| `when()` / `match()` branch factories | ran tracked — an eager read could become a dependency of the condition | run **untracked**, like `each()` rows (§6) |
| `DynamicComponent()` | any signal read while building remounted the component | swaps only when `is()` resolves to something else (§6) |
| Build plugins in production | injected imports from a package named `sibu`; webpack plugin broke every build | `compileTemplates` on in production renders what the runtime renders; source maps returned (§17) |

`when()` still compares its condition **by identity** (unchanged in 4.7): a
condition returning an object rebuilds for every new object, e.g. on each
refetch. Use `when(() => !!x(), …)` to rebuild only on a truthiness flip.

- **Added:** `translated(key, params?)` — a live getter for text children and
  attributes; getter interpolation params in `t()` / `translated()` / `Trans()`
  and the `TranslationParams` type; `registerTranslations()` after `setLocale()`
  now updates bindings (§9).
- **Added:** the `key` route option (§9); `RouterLink(props, children)` renders
  getter and number children (`` () => `Cart (${count()})` ``, `translated("nav.home")`).
- **Added:** `structuralSharing` for `query()` and `resource()`, default on (§8).
  Explicit writes are exempt: `setQueryData()` / `resource().mutate()` handed a
  new top-level object always commit a new reference and notify, even when every
  child is unchanged (`prev.items.push(x); return { ...prev }` still works).
  `select` re-runs on its own signals without refetching, once per fetch.
- **Types:** tag factories return their specific element (`input()` is an
  `HTMLInputElement` — drop the casts); public `Component<P, R>` type; typed `on`
  handlers; `onElement` gets the specific element; `ref<T>()` fits `ref` under
  `strict`; new exported types `TagFunction`, `StyleMap`, `StyleObject`,
  `TagEventHandlers` (§4). `onMount`/`onUnmount`/`Portal` take any `Element`, so
  SVG roots need no casts.
- **Props:** reactive `id`; a `class` getter returning `false`/`null`/`undefined`
  removes the attribute; a `style` getter may return a style object;
  `input({ type })` and `a({ target })` accept getters (§4).
- **Fixed:** `Fragment()` function children are reactive and `mount(Fragment(…))`
  unmounts everything it filled; `mount()` rolls back a component that throws;
  a failed first run of `effect()` / `derived()` no longer leaves subscriptions
  behind; `onMount()` cleanups run on native `element.remove()`; `catchError()`
  observes rejections from any `PromiseLike`; DevTools hook errors are contained.

### New in 4.6

Mostly fixes: lifecycle, reentrancy and error containment across the core and
the subpaths. Two changes can break code that relied on the old behaviour:

| Change | Before (4.5) | After (4.6) |
|---|---|---|
| Route loader data | `loaderData()` read whichever loader ran last, app-wide | scoped to `renderWithLoader(resource, render)` / `withLoader(loader, ctx, render)`; **throws** outside one (§8) |
| `form().handleSubmit` | a synchronous throw from the submit callback propagated | reported (`phase: "async"`, `name: "form.handleSubmit"`), like a rejection |

The render-transaction internals (`withDisposerRollback`, `beginDisposerCapture`,
`endDisposerCapture`, `currentDisposerCapture`, `DisposerCapture`, `idSegment`)
are no longer exported from `sibujs`; they were never meant as public API.

- **Added:** `form().dispose()` (§15), `ListboxHandle.selectedValues()` (§15),
  `theme.applyTo(root)` on component adapters (§19), async plugin installs and
  `PluginInstallCancelledError` / `isPluginInstallCancelledError()` (§9),
  `DisposableAccessor<T>` (the return type of `debounce`, `throttle`, `previous`)
  and `PersistedSetter<T>` (`persisted()`'s setter, which carries `dispose()`).
- **`globalStore`** queues reentrant operations, isolates listeners and accepts
  `async` middleware (§12). **`eventBus()` / `createSharedScope()`** deliver from a
  snapshot and isolate handlers (§15).
- **`machine.send()`** is run-to-completion: an event sent during a transition is
  queued and processed after it, in order.
- **`hotkey("mod+s")`** now means Cmd on Apple and Ctrl elsewhere — before 4.6 the
  unknown `mod` was dropped and the shortcut fired on a bare `s`. Unknown
  modifiers throw.
- **Component adapters** take positional children and read their theme
  reactively (§19).
- **`createId()`** is request-scoped inside `runInSSRContext`, so server ids match
  a fresh client's.
- **`defineElement()`** batches attribute writes made while rendering into one
  follow-up render (stopping after 10 passes), keeps the working subtree when a
  re-render throws, and releases disposers registered on the host on disconnect.
- **Widget bindings and `VirtualList`** report later update failures with their
  owner node, so the nearest `ErrorBoundary` renders its fallback.

### New in 4.2

Additive only — no breaking changes. The theme is making failures *observable*
in development: several of these were cases where the runtime did the wrong
thing, or the right thing for an unstated reason, and said nothing.

- **`show` / `when` / `match` accept both an element and a factory.** The shapes
  used to disagree; passing the wrong one raised an obscure `TypeError`, or for
  `when` rendered nothing with no error. See §6.
- **Focus and selection survive a reactive rebuild** when the rebuilt subtree
  contains an element with the same `id`, `name` or `data-focus-key`, and dev
  warns when they cannot be re-established. IME composition cannot be preserved
  — it belongs to the destroyed node. See §6.
- **`dist/cdn.dev.global.js`** — a development CDN bundle with warnings live.
  `dist/cdn.global.js` is now built with diagnostics compiled out. Load exactly
  one. See §11.
- **Fixed:** `RouterLink` silently ignored a reactive or conditional `class` —
  it read the prop as a string only, so any other form was dropped without a
  word. It now resolves the same shapes the tag factories do.
- **Fixed:** the style sanitizer announced nothing when it dropped an inline
  `url()`, so blocked images rendered as empty boxes with a clean console. Each
  drop now names the property, value, element, reason and the alternatives.
- **Fixed:** development warnings never actually compiled out of production
  builds — the dev gate could not be statically folded, so every warning string
  shipped. Production bundles are now smaller than 4.1 despite everything above.
- **Narrowed:** the lone-string class warning now requires a multi-token string.
  See the development-warnings note in §22 for the measured trade.

### New in 4.1

Additive only — no breaking changes.

- **`external()`** (core) — reactive integration with state SibuJS does not own. See §5.
- **`ctx.each()`** on `EnhanceContext` — repeated enhancement bindings over existing elements. See §11.
- **Fixed:** an `enhance()` binding that throws on a later update now reaches the enclosing `ErrorBoundary` — those bindings previously reported as generic effects with no DOM node, so the boundary branch was unreachable for progressive enhancement.
- **Fixed:** a reactive binding whose *first* evaluation throws no longer survives as a zombie. Previously it stayed subscribed with no disposer, so a later write re-ran it and mutated DOM belonging to an enhancement that had already rolled back.

### New in 4.0

```ts
import { asyncDerived, replaceChildrenSafely, setRuntimeErrorHandler } from "sibujs";
import { navigate } from "sibujs/plugins";

// Replace children AND dispose the outgoing subtree. Native replaceChildren()
// detaches without running teardown, leaving live bindings on orphaned nodes.
// Variadic, like the native method. Nodes present in `next` are never disposed.
replaceChildrenSafely(parent, ...next);

// One place to observe every error the runtime catches and contains.
setRuntimeErrorHandler((err, ctx) => report(err, ctx.phase));

// asyncDerived: disposable, and the factory receives an AbortSignal.
// Returns an object (not a tuple); `initial` is required.
const user = asyncDerived(async ({ signal }) => (await fetch(url(), { signal })).json(), null);
user.value(); user.loading(); user.error();
user.refresh();
user.dispose();   // 4.0: unsubscribe, abort the in-flight run, ignore late resolves

// Failed navigations carry a reason: "guard" | "superseded" | "router-destroyed"
// | "redirect-loop" | "unsafe-target" | "duplicate" | "error".
const res = await navigate("/admin");
if (!res.success && res.reason === "guard") showAccessDenied();
```

Behavioural fixes worth knowing: a reactive attribute resolving to
`null`/`undefined` now **removes** the attribute instead of writing `"null"`;
`t()` returns a registered empty string instead of falling back to the key; and
`maxSubscriberRepeats` defaults to 1 000 (was 50).

### v2.0 migration cheat sheet

| Breaking change | Before | After |
|---|---|---|
| Redux/Zustand selector | `api.useSelector(s => …)` | `api.select(s => …)` |
| Plugin registry swap | `useDefaultPluginRegistry(r)` | `setDefaultPluginRegistry(r)` |
| Remote module import | `loadRemoteModule(url)` (warn) | `loadRemoteModule(url, { allowedOrigins: […] })` or `{ unsafelyAllowAnyOrigin: true }` (CWE-829) |
| WASM load | `loadWasmModule(url)` | `loadWasmModuleWithOptions(url, { allowedOrigins: […] })` — see the 4.0 table above |
| Static template | `staticTemplate(htmlString)` | `staticTemplate(trustHTML(htmlString))` (CWE-79) |
| Router redirect `"//other/…"` | warned, redirected | throws `NavigationFailureError` (CWE-601) |
| `hydrate()` | in-place attr reconcile (broken) | replace strategy — reactive bindings drive visible DOM |
| `socket()` / `stream()` | `maxReconnects: Infinity` default | `maxReconnects: 10` default + exponential backoff |
| `optimisticList` aliases | `addOptimistic` / `removeOptimistic` / `updateOptimistic` | `add` / `remove` / `update` |
| `contentEditable().setContent` | `(html: string)` | `(string \| { text \| html, sanitize? })` |

---

## 22. Common mistakes

| Wrong | Right | Why |
|---|---|---|
| `div(count())` | `div(() => count())` | Unwrapped call captures once, never updates |
| `when(() => show(), () => div(\`n=${n()}\`))` | `when(() => show(), () => div(() => \`n=${n()}\`))` | A `when`/`match` branch factory rebuilds only when the condition/key changes and runs **untracked** (v4.7); a signal read **eagerly** in the factory is frozen at build time. Use a nested getter for reactive branch content |
| `when(() => user(), () => Profile())` meaning "when logged in" | `when(() => !!user(), () => Profile())` | `when` compares the condition by identity (`Object.is`), so every new `user` object (each refetch, each `setUser({...})`) rebuilds the branch and discards its state. Return a boolean to rebuild only on a truthiness flip |
| `span(t("title"))`, `input({ placeholder: t("search") })` | `span(translated("title"))`, `input({ placeholder: translated("search") })` | `t()` returns a string snapshot: called eagerly it freezes the text, so `setLocale()` never updates it. `translated()` (v4.7) is a getter for text and attributes, updated in place |
| `(input({ … }) as HTMLInputElement).value` | `input({ … }).value` | v4.7 tag factories return their specific element type; the cast is noise |
| `const id = route().params.id` in a parent layout, a catch-all or a constant-`key` route | `div(() => route().params.id)` or `routerState().params().id` inside a getter | Since v4.7 a route component remounts when its **own** params change, so a setup-time read is safe there. Anything that stays mounted across the change (layouts, `*` routes, `key: () => "x"`) must read params reactively. A `KeepAliveRoute` view is one instance per full location, and since v4.10 keeps its own route while cached |
| `route()` after an `await` in `component: async () => …` | read the route before the first `await`, or use a `lazy()` page | Only code before the first `await` runs in the page's route scope (v4.10); after it, `route()` and new effects read the router's route — the next page's while this one is outgoing. `lazy()` calls the module's factory inside the scope (§9) |
| `route().query.status` for a multi-value filter (`?status=a&status=b`) | `route().queryAll.status ?? []`, and `navigate({ path, query: { status: ["a", "b"] } })` to write it | `query` keeps only the last value of a repeated key; `queryAll` (v4.11) has every value, and the router keeps every value in the URL |
| `DynamicComponent(() => view(), props)` | `DynamicComponent(() => view())`, closing over props in the component | `DynamicComponent` takes only the `is` getter |
| `RouterLink({ to: "/", nodes: "Home" })` | `RouterLink({ to: "/" }, "Home")` | Children are positional; `nodes` is deprecated |
| `each(todos(), render)` | `each(() => todos(), render, { key })` | `each` needs a reactive getter + key function |
| `item.text` inside `each` render | `item().text` | The render callback receives a reactive getter, not a plain object |
| `signal(prop ?? defaultValue)` when `prop` is a getter | `typeof prop === "function" ? prop : signal(prop ?? defaultValue)[0]` | A getter stored in a signal becomes the value itself (the function literal) instead of being followed |
| Writing to a signal inside an effect that reads it | wrap in `batch()` or split effects | v2.0 detects re-entry and drops the update with a dev warning |
| `textarea({ rows: "3" })` | `textarea({ rows: 3 })` | Typed overloads enforce numeric props |
| Calling `setContent("<b>x</b>")` expecting escape | use `setContent({ html, sanitize: true })` | Bare string is raw HTML for back-compat |
| Relying on `hydrate()` to preserve SSR DOM refs | grab refs after mount, or adopt (`{ strategy: "adopt" }`, v4.14) | The replace strategy discards the server subtree |
| `document.createElement("iframe")` for a video player | `embed({ src, title })` after `setEmbedPolicy({ allowedOrigins })` (§15) | The factories refuse `iframe`; `embed()` is the one door, with an origin allowlist and a sandbox. A hand-built frame bypasses both |
| `svgEl.outerHTML` to get SVG into server HTML | `renderToString(tree)` | Since v4.12 SSR serializes SVG and MathML itself, under the URL / handler / animation policy `outerHTML` never applied |
| `renderToString(App())` in plain Node with no DOM registered | register happy-dom or jsdom globals first (§10) | Tag factories return live nodes, on the server too. v4.12 throws `renderToString needs a DOM` instead of `document is not defined` |
| `renderToString(tree)` right after building a tree with `when` / `each` | `await renderToStringAsync(() => tree)` (v4.14) | Their first branch renders in a microtask; serializing synchronously emits only the anchor comment |
| `div("space-y-6")` for a styled empty wrapper | `div({ class: "space-y-6" })` — or `div("space-y-6", children)` | A **lone** string is a TEXT child, so the class names render as visible text. With children it's the class. Same rule in sibujs-ui (`Skeleton({ class: "h-6 w-48" })`, not `Skeleton("h-6 w-48")`). Dev warns only for **multi-token** class-shaped strings (`div("mb-3 aspect-video w-full")`); a single token like `space-y-6` is indistinguishable from an identifier such as `item-0`, so it passes silently — see §22 note below. |
| A `when`/`match` branch containing a focused input | give the input a stable `id`/`name`/`data-focus-key`, or key the subtree so it does not rebuild mid-edit | A rebuild destroys the outgoing subtree and takes focus, selection and IME state with it. v4.2 restores focus when identity can be re-established unambiguously, and warns when it cannot. |
| Caching the last non-null value so `() => sel()!.x` survives a deselect | write `() => sel()!.x` inside a branch keyed on `sel()` | Since v4.13 the outgoing branch is disposed before its bindings re-run (§6); the guard is dead code |
| Living with "discarded the focused element" when closing a panel on Escape | `when(() => open(), Panel, { focus: "discard" })`, or `{ focus: { restoreTo: trigger } }` | Dropping focus on purpose is now declared on the directive (v4.13); the default keeps warning |
| A page-level `keydown` that also reacts to keys pressed inside a dropdown | `if (isWidgetKeyEvent(e)) return;` first | Widgets claim the keys they handle (v4.13) without stopping propagation (§14) |
| A native `<select>` whose `<option>`s are styled per item (fonts, swatches) | `selectMenu()` with your own option elements (§14) | macOS Chrome/Safari ignore `font-family` on `<option>` |
| Hard-coding `<meta name="description">` / `og:*` in `index.html` once routes declare `head` | put site-wide values in `createRouter({ head })` | The router replaces template tags for the keys it manages. A default in `index.html` disappears on the first route that sets that key (§9) |
| `await routerReady()` at the top level of the entry | `routerReady().then(() => hydrate(App, root))` | Vite's default build target does not allow top-level `await` |
| Pointing the backend fallback at `dist/index.html` after pre-rendering | fall back to `dist/200.html` | `index.html` is now the pre-rendered home page. A deep link would flash it before the router takes over (§17) |
| `await Promise.resolve(); renderToString(tree)` to wait for data (v4.14) | `await renderToStringAsync(() => App())` | One microtask covers only directive commits; data, lazy chunks and route loads need the settle loop |
| `renderToStringAsync(App())` (a node) | `renderToStringAsync(() => App())` | A function is built inside the request scope; a node built outside it uses the global query cache |
| Reading `window`, `localStorage`, `matchMedia` or canvas in a component body that renders on the server | `onMount()`, an effect, or `ClientOnly(() => …, { fallback })` | They do not exist on the server (or run against an emulation); the render reports or throws |
| `hydrate(App, root, { strategy: "adopt" })` on output rendered without `{ hydration: "adopt" }` | render with the option (or the pre-renderer's `hydration: "adopt"`) | Without ids nothing can be claimed: the whole tree is replaced and a dev warning says so |
| `Date.now()`, `Math.random()` or locale-dependent text in a render that is adopted | compute it in an effect or `ClientOnly`, or transfer it | The browser text differs; adoption keeps the client's and reports a mismatch |
| Pre-rendering a page behind a login guard | `render: "client"` (shell + head), served from `200.html` | A guard rejects on the server; the pre-renderer skips the route |
| Serving a per-visitor page (cart, account) through `createRenderHandler({ cache })` with the default `Cache-Control` | `cacheControl` returning `"private"` (or `"no-store"`) for it | The page cache is shared by every visitor; a 200 is stored unless its `Cache-Control` opts out (§10) |
| `renderRoute(routes, url.slice(base.length))` under a router `base` | `renderRoute(routes, req.url, { router: { base } })` | The base is stripped once, at a segment boundary; the request URL is what `renderRoute` expects (§10) |
| `each(items, render, { key: (r) => r.active })` (boolean or object keys) on a page that is adopted | a string or number key (`r.id`) | An adopt render or hydration throws a `TypeError`: other key types have no lossless id, and `each` declares `string \| number` |
| A static server serving `cotizar/index.html` at `/cotizar/` with a strict router | `createRouter({ trailingSlash: "ignore" })` | `/cotizar/` is otherwise the `*` route in the browser |
| Reading a signal only inside a conditional branch and expecting stable reactivity | read conditionally-needed signals up front, or know the rule below | A getter is reactive only to signals it read on its **most recent** run; the engine re-tracks every run, so a branch newly taken subscribes its signals (and abandoned branches unsubscribe). |

### Development warnings (v4.2)

Every diagnostic below is **development-only** and is *compiled out* of a
production build — the message strings are absent from the bundle, not merely
unreached. The gate is the `__SIBU_DEV__` define, set by the `sibujs/build`
Vite and webpack plugins; for `<script>` users it is baked into which CDN file
you load (§11).

| Warning | Means |
|---|---|
| `lone string "…" looks like a class list` | A multi-token class-shaped string was passed as a lone argument, so it renders as visible text. Pass `{ class: … }`, or add children. |
| `style declaration "…" was dropped by the style sanitizer` | An inline `url()` / `expression()` / `@import` was removed. Use an `<img>` for a content image, or a stylesheet class for decoration. Inline `style` values, `scopedStyle()` and theme variables are filtered; a stylesheet you ship (a `.css` file, a `style()` element) is not. |
| `refusing "…" in this element's context` (v4.8) | A write was refused by the contextual policy: a runtime `href` on a stylesheet `<link>`, a runtime `src` on a `<script>`, a refresh directive on a `<meta>`, or an SVG animation aimed at a URL/handler attribute. The attribute is left off. Put the URL in static template source, or use `Head({ link })` / `Head({ script })` for a runtime-chosen one. |
| `embed: refusing src "…"` (v4.12) | An `embed()` `src` — static or from a getter — is not an `https:` URL on an origin `setEmbedPolicy()` allows. The frame is left without a `src`. Add the origin (and path prefix) to the policy, or fix the URL. |
| `embed: sandbox "…" was narrowed` / `embed: allow "…" was narrowed` / `embed: referrerpolicy "…" is less strict` (v4.12) | An `embed()` option asked for more than the defaults. A sandbox may only drop tokens of `DEFAULT_EMBED_SANDBOX`; `allow` keeps player features only; `referrerpolicy` must be at least `strict-origin-when-cross-origin`. The narrower value is used. |
| `a reactive rebuild discarded the focused element` | A `when`/`match`/reactive-children rebuild took the caret. Give the element a stable `id`/`name`/`data-focus-key`, or key the subtree. If dropping focus is intended, pass `{ focus: "discard" }` (or `{ focus: { restoreTo: el } }`) to that `when`/`match` (v4.13). |
| `a branch was given as an element rather than a function` | A bare-element branch is being re-attached, bringing its accumulated state with it. Intentional or not, it is not a rebuild. |
| `Multiple instances of the reactive runtime` | A bundler emitted two copies. Reactivity still works — all copies share the first via a global registry — so this is a size issue, not a correctness one. |
| `suppressing further ones for the rest of this session` | 100 distinct warnings of that kind have been reported and the rest are being withheld so they cannot flood the console. Fix the reported ones and reload. |

**The lone-string heuristic is deliberately narrow.** It fires only when a
string has two or more whitespace-separated tokens and at least two of them are
utility-shaped. A single token (`space-y-6`, `truncate`) is indistinguishable
from the identifiers applications legitimately render as text — `item-0`,
`user-42`, `home-content`, `v4.1.0`, `src/index.ts` — and warning on that shape
measured ~30% false positives, including a warning per row for a list rendering
`item-0`…`item-999`. The narrower rule measures 0% false positives on the same
corpus, at the cost of missing single-token class lists. Repeated warnings are
de-duplicated per tag and string.

---

## 23. Lint inline disable

```ts
// sibujs-disable-next-line no-direct-dom-mutation
el.innerHTML = trustedHtml;
```

---

## 24. sibujs-cli (v1.7.0)

`npm install -g sibujs-cli` (or `npx sibujs <command>`). Node.js >= 22.12.0. The bin is `sibujs`.

### Project commands

```bash
sibujs create my-app                        # Vite + TypeScript, the simplest app
sibujs create my-app --ui blue --router     # sibujs-ui (with Tailwind) + routing; --tailwind for Tailwind only
sibujs create my-app --prerender            # v1.7: pre-rendered routing app (head, render modes, sitemap, ClientOnly)
sibujs create my-app --ssr                  # v1.7: --prerender + a Node server rendering per request
sibujs generate component MyButton          # alias: sibujs g component MyButton
sibujs dev --port 4000 --host               # the project's own Vite, never npx vite
sibujs build --ssr
sibujs build --ssr src/entry-server.ts      # v1.7: that server entry, into dist-server/
sibujs prerender --routes /,/products/mug   # v1.7: pre-render an existing build again (all routes without --routes)
sibujs preview --port 5000
sibujs lint src/App.ts --warn-only          # violations exit 1 unless --warn-only
sibujs lint src tests scripts               # v1.6: files or directories (no args: src/)
sibujs analyze                              # estimated bundle cost per imported API
```

`--ui [theme]` themes: default, blue, green, red, orange, amber, yellow, teal, purple, violet, rose. `create --ui` installs the **npm package** sibujs-ui; use `init`/`add` below to copy components as source instead (or both).

- **Template versions (v1.7):** `create` scaffolds with `sibujs ^4.14.1`, `sibujs-cli ^1.7.0`, `vite ^8.3.1`, `typescript ~6.0.3`; with `--ui` also `sibujs-ui ^1.9.1`; with Tailwind (`--tailwind` or `--ui`) `tailwindcss` / `@tailwindcss/vite ^4.3.3`.
- **`analyze` (v1.7)** estimates against sibujs 4.14.0: a 35 KB base for any app plus a per-import cost, recalibrated on the scaffolded apps. It runs slightly under a real build; treat it as a floor.
- **Lint paths (v1.6):** each argument is a file or a directory. A directory is linted recursively (`.ts`, `.tsx`, `.js`, `.jsx`), skipping `node_modules` and `dist` at any depth; several paths combine in order and a file reached twice is linted once. A missing path, an unsupported file type or an unreadable directory is reported (`Path not found: …`, `Unsupported file type: …`, `Cannot read directory: …`) and fails the run even with `--warn-only`; the other paths are still linted. Paths are literal — globs are expanded by the shell.
- **TypeScript per project (v1.6):** the linter parses with the TypeScript compiler of the project being linted (falling back to the CLI's own), resolved against the same directory as the paths and cached per project root.

### Copy-paste components (v1.5)

```bash
sibujs init                                 # components.json, Tailwind CSS 4, @/ alias, base styles, cn()
sibujs init --style violet --yes            # theme, no prompts
sibujs add button dialog                    # components + every registry item they import; installs npm deps
sibujs add card --overwrite                 # replace a copy that differs from the registry
sibujs add dialog --path src/widgets        # other directory; imports follow via tsconfig paths
sibujs add --all --dry-run                  # plan only, write nothing
sibujs list --type ui --json
```

- **`init`** writes `components.json`; adds `tailwindcss` + `@tailwindcss/vite` and the Vite plugin when Tailwind is missing (warns on Tailwind 3); creates or detects the stylesheet and adds the `@import` lines; declares `"@/*": ["./src/*"]` in tsconfig and `resolve.alias` in the Vite config; copies `base`, `utils` and `theme-<style>`. Flags: `--style`, `--css`, `--force`, `--overwrite`, `--yes`, `--dry-run`, `--no-install`, `--registry`, `--cwd`.
- **`add`** resolves `registryDependencies`, rewrites `@/components/ui/*` and `@/lib/*` imports to your aliases, and installs missing packages with the project's package manager. Flags: `--all`, `--overwrite`, `--yes`, `--path`, `--dry-run`, `--no-install`, `--registry`, `--cwd`.
- **Existing files are never replaced silently**: identical files are left alone; a file that differs is replaced with `--overwrite`, asked about per file in a terminal (before anything is written), and kept and reported otherwise (CI, `--yes`).
- **`--path`** must be covered by a tsconfig `paths` wildcard; the ui alias moves with the files. An alias is never guessed from the shape of another one.
- **Vite edits** only touch the object after the single `export default` (`defineConfig({ … })` or `{ … }`). A plugin counts only when its imported binding is *called* in that object's top-level `plugins`. Anything ambiguous (function-form config, exported variable, existing `resolve` without the alias, tsconfig with comments) gets printed instructions instead of an edit. Since 1.5.1, any spread, computed key or shorthand property in the config object (a later `...base` overrides the explicit `plugins` / `resolve`) leaves the file untouched and prints the lines to add, and a renamed import (`import { fileURLToPath as toPath } from "node:url"`) is called by its local name; a type-only import or an unrelated `fileURLToPath` in the file gets instructions instead.
- A failed package install exits 1 after the files are copied. Unknown names get "did you mean" hints.

### components.json

Every key is optional; directories are derived from the aliases through tsconfig `paths`. The file is also valid for `npx sibujs-ui` (which additionally offers `diff`).

```json
{
  "$schema": "https://unpkg.com/sibujs-cli/schema/components.json",
  "style": "default",
  "tailwind": { "version": 4, "css": "src/app.css" },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "utils": "@/lib/utils", "lib": "@/lib" },
  "paths": { "ui": "src/components/ui", "lib": "src/lib", "styles": "src/styles/sibujs-ui" }
}
```

`style`: `default` or a theme color. `tailwind.css`: stylesheet that receives the `@import` lines (`null` prints them). `aliases.utils` other than `<lib>/utils` moves `cn()` there. A top-level `css` key (written by `npx sibujs-ui init`) is read as `tailwind.css`.

### Registry source

Precedence: `--registry` → `SIBUJS_REGISTRY` env → `registry` in components.json → `https://unpkg.com/sibujs-ui@latest/dist/registry`. A source is a directory (`../sibujs-ui/dist/registry`, `node_modules/sibujs-ui/dist/registry`), a base URL (`https://unpkg.com/sibujs-ui@1.10.0/dist/registry`) or a URL template containing `{name}`. `@latest` is pinned to the release it redirects to for the whole run. An explicit `init --registry` is saved in components.json.

Registry content is validated as untrusted input: item names, file paths (must stay inside their directory), CSS imports and npm package specs (no shell metacharacters, no leading `-`).

---

# sibujs-ui (v1.10.0) — Tailwind component library

> 56+ Tailwind-styled components inspired by shadcn/ui, built on sibujs. Zero VDOM. Tree-shakeable. Peer: `sibujs >=3.2.0 <5.0.0`. Requires Tailwind v4.

## Setup

Three ways to consume it, all built from the same source in every release. They can be mixed.

| | npm package | CDN (no build) | Copy-paste (CLI, v1.7) |
|---|---|---|---|
| Install | `npm install sibujs-ui sibujs` | two `<script>` + one `<link>` | `npx sibujs-ui add button` |
| Import | `from "sibujs-ui"` | `window.SibuUI` | `from "@/components/ui/button"` |
| Updates | bump the version | change the URL | `npx sibujs-ui diff`, then `add --overwrite` |
| Use when | components as-is, customised via props/class/tokens | pages without a bundler (islands) | you need to edit a component's markup, variants or behaviour |

### npm package

```css
/* main stylesheet — Tailwind v4 */
@import "tailwindcss";
@import "tw-animate-css";
@import "sibujs-ui/themes/base.css";     /* REQUIRED — @theme bridge (bg-background, text-foreground, …), keyframes, data-state variants */
@import "sibujs-ui/themes/default.css";  /* neutral light + dark tokens (class="dark" for dark mode) */
@import "sibujs-ui/themes/blue.css";     /* optional accent: amber, blue, green, orange, purple, red, rose, teal, violet, yellow */
```

There is no Tailwind preset and no JS config: the theme is CSS only.

### Without a bundler (CDN, v1.6)

```html
<link rel="stylesheet" href="https://unpkg.com/sibujs-ui@latest/dist/sibujs-ui.css" />
<script src="https://unpkg.com/sibujs@latest/dist/cdn.global.js"></script>      <!-- runtime FIRST -->
<script src="https://unpkg.com/sibujs-ui@latest/dist/cdn.global.js"></script>
<script>
  const { Button, Card, Dialog } = window.SibuUI;
  document.body.append(Button({ variant: "outline" }, "Click me"));
</script>
```

- The stylesheet is NOT optional: it holds the utilities the components use plus the base and default themes. Without it components work but render as browser defaults. It includes Preflight, so it restyles the host page.
- SibuJS is not bundled in; `sibujs-ui` reads `window.Sibu` and throws a clear error if the runtime tag is missing or comes later.
- `cdn.dev.global.js` keeps warnings live. The CDN build carries every component and the full icon set (no tree-shaking).
- Exports: `sibujs-ui/cdn`, `sibujs-ui/cdn-dev`, `sibujs-ui/cdn-css`.

### Copy-paste with the CLI (v1.7)

```bash
npx sibujs-ui init                 # components.json, base styles, lib/utils.ts (cn)
npx sibujs-ui add button dialog    # copies files + everything they import; installs missing npm deps
npx sibujs-ui add --all
npx sibujs-ui list
npx sibujs-ui diff [name]          # local copy vs registry
```

- Files land in `src/components/ui/` (components), `src/lib/` (`utils`, `types`, `lifecycle`, `controlled`, `aria`, `form-control`, `scroll-lock`, `item-labels`, `icons`) and `src/styles/sibujs-ui/` (css). Configurable in `components.json` (`paths`, `aliases`, `css`).
- Copied files import each other via `@/components/ui/*` and `@/lib/*`; declare `"paths": { "@/*": ["./src/*"] }` in tsconfig and the same alias in the bundler.
- Existing files that differ are skipped unless `--overwrite`. `--dry-run` and `--no-install` are available. A failed dependency install exits 1. The package manager comes from `packageManager` or the nearest lockfile, up to the repo root.
- `lib/icons.ts` holds only the ~20 icons the components use; for others use `lucide` or the npm package.
- Registry: static JSON in the package, `dist/registry/index.json` + `<name>.json` (e.g. `https://unpkg.com/sibujs-ui@1.10.0/dist/registry/button.json`). `npx sibujs-ui@<version>` pins the components you get; `--registry <dir|url>` reads another registry.
- **sibujs-cli ≥ 1.5 reads the same registry** as `sibujs init`, `sibujs add`, `sibujs list`, and additionally sets up Tailwind CSS 4 and the `@/` alias (tsconfig + Vite). Both CLIs share one `components.json`; `diff` exists only in `npx sibujs-ui`. See §24.

## Component API pattern

Every component is a function taking `(propsOrChildren?, children?)`. Props mirror TagProps; components forward unknown props to the root element.

```ts
import { Button, Input, Card, CardContent } from "sibujs-ui";

// Positional: class + children
Button("btn-primary", "Click me");

// Props object
Button(
  { variant: "default", size: "lg", on: { click: save } },
  "Save changes",
);
```

### Controlled vs uncontrolled

Stateful components take a value prop (`value`, `checked`, `selected`, `pressed`, `open`), a change callback (`onValueChange`, `onCheckedChange`, `onSelect`, `onOpenChange`; `onChange` on `NativeSelect`) and a `defaultValue` / `defaultChecked` / `defaultPressed` / `defaultOpen` for uncontrolled use.

- **A getter makes the prop controlled.** The component shows what the getter returns, follows external changes, and a user action only reports the proposed value through the callback — the owner writes the signal. A change the owner does not commit is reverted: the component keeps showing the owner's value.
- **`defaultValue` / `defaultChecked`** is the uncontrolled initial value; the component then owns its state.
- **A plain (non-getter) value** means one of two things, unchanged from 1.7.x:
  - **Initial value** — the user can change it: `DropdownMenuCheckboxItem`, `ContextMenuCheckboxItem`, `MenubarCheckboxItem` (`checked`), `DropdownMenuRadioGroup`, `ContextMenuRadioGroup`, `ToggleGroup`, `NativeSelect`, `CommandInput` (`value`) and `Calendar` (`selected`). It behaves like `defaultValue` / `defaultChecked` (its explicit form, where the component has one).
  - **Fixed value** — a user action only calls the callback and the shown value does not change: `Select`, `Combobox`, `Slider`, `InputOTP`, `MenubarRadioGroup` (`value`), and likewise `Checkbox`, `Switch`, `Toggle`, `Tabs`, `Accordion`, `RadioGroup`. For uncontrolled use pass `defaultValue` / `defaultChecked` / `defaultPressed`. The `Select` label, the `InputOTP` hidden input and `InputOTP`'s `onComplete` stay on the fixed value; a click or keystroke does not move them.

```ts
const [fruit, setFruit] = signal("apple");
Select({ value: fruit, onValueChange: setFruit, name: "fruit" }, [/* … */]);   // controlled
Select({ defaultValue: "apple", name: "fruit" }, [/* … */]);                   // uncontrolled
Select({ value: "apple", onValueChange: log }, [/* … */]);                     // plain = fixed: always shows "apple"
Checkbox({ checked: agreed, onCheckedChange: setAgreed });                     // controlled
DropdownMenuCheckboxItem({ checked: true, onCheckedChange: save }, "Show grid"); // plain = initial, still toggles
NativeSelect({ value: "b", name: "size" }, [/* … */]);                         // plain = initial; user can change it, reset returns to "b"
Input({ value: name, on: { input: (e) => setName((e.target as HTMLInputElement).value) } }); // Input: value + native events
```

### BaseProps (shared)

```ts
interface BaseProps {
  class?: string | (() => string);            // merged with the component's classes via cn()
  style?: Record<string, string | number | (() => string | number)> | string | (() => string);
  ref?: { current: Element | null };
  on?: Record<string, (ev: Event) => void>;
  [attr: string]: unknown;                    // id, data-*, aria-* … forwarded to the root
}
```

## Utilities

```ts
import { cn, cnReactive } from "sibujs-ui";

cn("base", active && "active", { disabled: !enabled() });   // clsx + tailwind-merge
cnReactive("base", () => (open() ? "ring-2" : ""));          // returns a getter when any input is a function
```

Variants are `class-variance-authority` (`cva`) functions inside the components; exported helpers such as `buttonVariants` and `badgeVariants` are cva functions.

## Icons

```ts
import { ChevronDownIcon, XIcon, CheckIcon } from "sibujs-ui";
Button({}, [CheckIcon({ size: 16 }), "Save"]); // IconProps: { class?, size? (px, default 24), …attrs }
```

## Themes

12 CSS files ship under `sibujs-ui/themes/`: `base.css` (the required bridge), `default.css` (every token — `--background`, `--foreground`, `--primary`, `--border`, `--ring`, … — light on `:root`, dark on `.dark`) and 10 accent themes that override `--primary` and the chart and sidebar tokens. Dark mode is `class="dark"` on `<html>` or any ancestor. There is no `data-theme` switch; to change accents at runtime, scope your own token overrides under a class.

## Components (56 in sibujs-ui 1.10.0 — brief usage; entries below group related families)

### Primitives
- **Button** — `Button({ variant: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link", size: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg", disabled, type }, …)`. v1.9: `disabled` is `boolean | (() => boolean)` — a getter updates the property and the attribute; `false` removes the attribute.
- **Badge** — `Badge({ variant: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link" }, "label")`
- **Kbd** — `Kbd("⌘K")`
- **Label** — `Label({ for: id }, "Email")`
- **Separator** — `Separator({ orientation: "horizontal" | "vertical" })`
- **Skeleton** — `Skeleton({ class: "h-6 w-48" })` (a lone string is a text child — pass sizing classes via `class`)
- **Spinner** — `Spinner()` / `Spinner({ class: "size-6" })` — no `size` prop; size it with a class (default `size-4`)

### Form
- **Input / Textarea** — styled native inputs; `value` is a string or a getter, events go through `on` (`on: { input }`).
- **NativeSelect** — `NativeSelect({ value, defaultValue, onChange: (v) => …, name }, [NativeSelectOption({ value: "a" }, "A"), …])`. v1.8: a plain `value` is the **initial** value, exactly like `defaultValue` (and wins when both are given): it is selected once the options exist, the user can change it, and a form reset returns to it — the initial option is marked as the reset default, including an option rendered later (a reactive list), until the user picks something else. A getter `value` makes it controlled: external changes update the selection, a user change only calls `onChange`, and a selection the owner does not commit reverts to the getter right away; a controlled value whose option renders later is selected when that option mounts.
- **InputGroup** — wraps an Input with leading/trailing adornments.
- **InputOTP** — `InputOTP({ value, onValueChange, onComplete, maxLength: 6 })`, slot-based with paste support. A plain `value` is fixed (use `defaultValue` for uncontrolled use). v1.8: `value` may be a getter; typed or pasted input the owner does not commit is not kept — the hidden input stays on the owner's value, and `onComplete` and the active slot follow the committed value, so a rejected paste neither completes the code nor moves the caret.
- **Checkbox / Switch / Toggle** — `checked` / `pressed` (value or getter), `defaultChecked` / `defaultPressed`, `onCheckedChange` / `onPressedChange`.
- **ToggleGroup** — `ToggleGroup({ type: "single" | "multiple", value, defaultValue, onValueChange })`. v1.8: a getter `value` is controlled; a plain `value` is the initial value.
- **Slider** — `Slider({ value: number[] | () => number[], defaultValue, min, max, step, onValueChange })`. v1.8: thumbs are added/removed when the value's length changes; a multi-thumb range fills between the lowest and highest thumb.
- **Form parts** — `FormItem`, `FormLabel({ for, error })`, `FormDescription`, `FormMessage`: layout and styling only. There is no `Form` root — use a native `form` element, with `form()` from sibujs/ui for state and validation.
- **Field** — label + input + description + error row.
- **RadioGroup** — `RadioGroup({ value, defaultValue, onValueChange, name, required }, [RadioGroupItem({ value: "a" }), …])`; native radios, so it submits and validates.

### Layout
- **Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter / CardAction**.
- **AspectRatio** — `AspectRatio({ ratio: 16/9 }, img)`.
- **ResizablePanelGroup / ResizablePanel / ResizableHandle** — `ResizablePanelGroup({ direction: "horizontal" | "vertical", onLayout, autoSaveId }, […])`.
- **ScrollArea** — virtual scrollbar.
- **Sidebar / SidebarProvider / SidebarTrigger / SidebarMenu** — app shell pattern.
- **Item / ItemGroup / ItemMedia / ItemContent / ItemActions** — list rows.
- **Empty** — empty-state placeholder.
- **ButtonGroup** — grouped buttons with shared borders.

### Overlays
- **Dialog / DialogTrigger / DialogContent / DialogHeader / DialogFooter / DialogTitle / DialogDescription / DialogClose** — modal. v1.9: while open (and while its close animation plays) the portal (overlay + content) is a child of `document.body`, so an ancestor's `overflow`, stacking context or `transform` no longer clips or offsets it; the most recently opened dialog stacks on top. `DialogContent` returns an in-tree `data-slot="dialog-anchor"` (`display: contents`); disposing it — directly or through any ancestor — removes the portal and releases its listeners and scroll lock, even while open. Closed, under SSR or never opened, the portal stays inside the anchor. **Upgrade:** an open dialog's content is no longer a descendant of the `Dialog` element — query the document (`[role=dialog]`, `[data-slot=dialog-content]`) instead of `dialogEl.querySelector(…)`. `AlertDialog`, `Sheet` and `Drawer` are unchanged.
- **Escape (v1.9.1)** — `Dialog`, `Sheet`, `Drawer`, `Popover`, `Select`, `DropdownMenu`, `ContextMenu`, `Menubar` and `NavigationMenu` share one Escape stack: each Escape closes only the most recently opened of them and calls `preventDefault()`, so nested overlays close one layer per press, innermost first. With none open, Escape is left untouched. An Escape that arrives already `defaultPrevented` — handled by a focused `Select` trigger or `Combobox` input, or by your own handler — closes nothing. `AlertDialog` does not close on Escape; `Tooltip` and `HoverCard` close on Escape only from their focused trigger.
- **Server rendering (v1.10.0, sibujs 4.14+)** — every component renders on the server (`renderToStringAsync`, `renderRoute`, the pre-renderer; SibuJS's built-in server DOM or jsdom / happy-dom), and the server HTML matches the first browser render: `data-state`, `aria-*`, visibility, check icons, labels and `Slider` thumbs are in it, so a closed `Select`, menu or `Popover` is hidden and an open `Dialog` shown. A controlled getter (`value: () => tab()`) decides it, including a value that changes while the render settles. `Dialog`, `DropdownMenu`, menubar submenus and a portaled `Tooltip` keep their content in place on the server; the browser moves it to `<body>`. `Checkbox`, `Switch`, `RadioGroup` and `Select` include their native form inputs (`name`, `value`, `checked`, `required`), so a server-rendered form submits before JavaScript runs — `Combobox` has no form input. Ids come from `createId()`, the same on every request and in the browser, so `hydrate(…, { strategy: "adopt" })` takes the markup over without a mismatch. Not in the server HTML: positions and sizes measured from layout, and a chart's dark-mode colors (its light colors are inline until the stylesheet arrives). v1.9.2 fixed `Calendar`, `Checkbox`, `Switch`, `RadioGroup`, `NativeSelect` and `ToggleGroup`, which threw on the server DOM.
- **AlertDialog** — dialog variant for confirmations.
- **Sheet** — side-docked dialog.
- **Drawer** — bottom sheet.
- **Popover / PopoverTrigger / PopoverContent** — non-modal.
- **HoverCard** — popover on hover.
- **Tooltip / TooltipProvider / TooltipTrigger / TooltipContent**.
- **DropdownMenu / ContextMenu / Menubar / NavigationMenu** — menu family. `…RadioGroup({ value, defaultValue, onValueChange })` and `…CheckboxItem({ checked, defaultChecked, onCheckedChange })` accept getters (v1.8, controlled: a click only reports). A plain value is the initial value — except `MenubarRadioGroup`, where a plain `value` stays fixed (use `defaultValue` there for uncontrolled use).

### Data
- **Table / TableHeader / TableBody / TableFooter / TableRow / TableHead / TableCell / TableCaption**.
- **Tabs / TabsList / TabsTrigger / TabsContent** — `Tabs({ value, defaultValue, onValueChange }, […])`.
- **Accordion / AccordionItem / AccordionTrigger / AccordionContent**.
- **Collapsible / CollapsibleTrigger / CollapsibleContent**.
- **Pagination / PaginationContent / PaginationItem / …**.
- **Breadcrumb / BreadcrumbList / BreadcrumbItem / BreadcrumbLink**.
- **Progress** — `Progress({ value: () => pct() })`.
- **ChartContainer / ChartTooltipContent / ChartLegendContent / ChartStyle** — `ChartContainer({ config }, chartEl)`: a themed container (`--color-<key>` variables from `config: ChartConfig`, light and dark) for any charting library; it draws no chart itself.

### Picker
- **Calendar** — `Calendar({ mode: "single" | "range", selected, onSelect, defaultMonth })`. v1.8: `selected` may be a getter (single or range) — the Calendar then shows what it returns and a click only calls `onSelect`; a plain `selected` is the initial selection. It opens on the selected month when there is no `defaultMonth`; an external selection change moves the view to show it, a click never does.
- **Combobox** — `Combobox({ value, defaultValue, onValueChange, multiple, open }, [ComboboxInput(…), ComboboxContent([ComboboxList([ComboboxItem({ value: "a" }, "A")])])])`. v1.8: `value` may be a getter (string or string[]); the input text, `ComboboxValue` and the checkmarks follow it and follow changes to an item's own content.
- **Select** — `Select({ value, defaultValue, onValueChange, name, required }, [SelectTrigger([SelectValue({ placeholder: "Pick…" })]), SelectContent([SelectItem({ value: "a" }, "A")])])`. v1.8:
  - The trigger label and `SelectValue` render the item matching the current value (placeholder when none) — right on first render, after a programmatic change, and when the selected item's own content changes (e.g. a `translated()` label switching locale). The label never jumps to a click the owner did not commit (a controlled owner that rejects it, or a plain fixed `value`).
  - **Form participation:** a visually hidden native input submits the value under `name`, enforces `required` through `checkValidity()`, and returns the control to `defaultValue` on form reset (a controlled owner gets `onValueChange`). Focus landing on it moves to the trigger.
- **Command** — `Command({ onValueChange }, [CommandInput({ value, placeholder }), CommandList([…])])`. v1.8: `CommandInput`'s `value` fills the input **and filters the items** from construction on, also outside a `Command`. A plain `value` is the initial text; the user edits it freely. A getter is authoritative: each user edit is proposed once through the `Command`'s `onValueChange`, the getter is read again right after, and the input and the filter settle on what it returns — an edit the owner rejects is reverted and never filtered, an accepted or transformed one is filtered once. `CommandDialog`'s `open` accepts a getter.

### Misc
- **Avatar / AvatarImage / AvatarFallback**.
- **Alert / AlertTitle / AlertDescription** — inline status.
- **Sonner** — `Toaster()` renders the stack; sibujs-ui's own `toast("Saved")` / `toast({ title, description, variant, duration, action })` / `toast.success(msg)` queues one and returns its id (not `toast()` from sibujs/ui).
- **DirectionProvider / useDirection** — `DirectionProvider({ dir: "rtl" }, children)` sets `dir` on a `display: contents` wrapper; `useDirection(el)` reads the closest `[dir]` (`"ltr"` by default).
- **Carousel** — slide deck with keyboard + touch.

## Compound components

Many components export both a root and named children:

```ts
Card({ class: "w-80" }, [
  CardHeader([
    CardTitle("Profile"),
    CardDescription("Public info"),
  ]),
  CardContent([Input({ value: name, on: { input: (e) => setName((e.target as HTMLInputElement).value) } })]),
  CardFooter([Button({ variant: "default" }, "Save")]),
]);
```

## Positioning pattern (popover-family)

The props go on the **content** part (`PopoverContent`, `HoverCardContent`, `DropdownMenuContent`, `TooltipContent`), not the root:

```ts
{
  side?: "top" | "right" | "bottom" | "left",
  align?: "start" | "center" | "end",   // not on TooltipContent
  sideOffset?: number,                  // default 4
}
```

`PopoverContent`, `HoverCardContent` and `TooltipContent` are placed with CSS (`position: absolute`, `calc(100% + sideOffset)`) relative to their root, so they move with it when the page scrolls. `DropdownMenuContent` — and `TooltipContent({ portal: true })` — is appended to `document.body` with `position: fixed` and measured when it opens; it is not re-measured on scroll or resize. No collision handling, no floating-ui dependency.

## Menu item pattern

```ts
DropdownMenuContent([
  DropdownMenuLabel("Account"),
  DropdownMenuSeparator(),
  DropdownMenuItem({ on: { click: profile } }, [UserIcon({ size: 14 }), "Profile"]),
  DropdownMenuItem({ on: { click: signOut }, variant: "destructive" }, "Sign out"),
  DropdownMenuSub([
    DropdownMenuSubTrigger("More"),
    DropdownMenuSubContent([DropdownMenuItem({}, "Nested")]),
  ]),
  DropdownMenuSeparator(),
  DropdownMenuCheckboxItem({ checked: showGrid, onCheckedChange: setShowGrid }, "Show grid"), // getter: controlled
  DropdownMenuRadioGroup({ defaultValue: "asc", onValueChange: sort }, [                   // uncontrolled
    DropdownMenuRadioItem({ value: "asc" }, "Ascending"),
    DropdownMenuRadioItem({ value: "desc" }, "Descending"),
  ]),
]);
```

---

# Quick recipes

### Persisted counter

```ts
import { button, div, h1 } from "sibujs";
import { persisted } from "sibujs/patterns";

function Counter() {
  const [count, setCount] = persisted("count", 0);
  return div([
    h1(() => `Count: ${count()}`),
    button({ on: { click: () => setCount(c => c + 1) } }, "+1"),
  ]);
}
```

### Fetch user + show loading

```ts
import { div, p } from "sibujs";
import { query } from "sibujs/data";
import { match } from "sibujs";
import { Loading, ErrorDisplay } from "sibujs";

function UserCard({ id }: { id: number }) {
  const q = query(
    `user:${id}`,
    async ({ signal }) => fetch(`/api/users/${id}`, { signal }).then(r => r.json()),
  );
  // A string key: `match` rebuilds only when the state changes, not on every refetch.
  const state = () => (q.error() ? "error" : q.data() === undefined ? "loading" : "ready");

  return div([
    match(state, {
      loading: () => Loading(),
      error:   () => ErrorDisplay({ error: q.error()! }),
      ready:   () => p(() => q.data()!.name),   // text stays live; unchanged refetches notify nobody
    }),
  ]);
}
```

### Tabs + ARIA wiring

```ts
import { div, button, onMount } from "sibujs";
import { tabs } from "sibujs/widgets";

function ProfileTabs() {
  const t = tabs({ tabs: [
    { id: "info",     label: "Info" },
    { id: "security", label: "Security" },
  ], defaultTab: "info" });

  const tablist = div({ class: "flex gap-2" });
  const info = div({ id: "info-tab" }, "Info content");
  const sec  = div({ id: "sec-tab" },  "Security content");
  const infoBtn = button({}, "Info");
  const secBtn  = button({}, "Security");
  tablist.append(infoBtn, secBtn);

  onMount(() => t.bind({
    tablist,
    tabs:   { info: infoBtn, security: secBtn },
    panels: { info, security: sec },
  }), tablist);

  return div([tablist, info, sec]);
}
```

---

**Framework:** sibujs 4.14.1 · **UI library:** sibujs-ui 1.10.0 · **CLI:** sibujs-cli 1.7.0 · **Tests:** 9470 passing, 1 skipped (606 files) · **Runtime:** ~31 KB gzipped · **Zero runtime dependencies**.
