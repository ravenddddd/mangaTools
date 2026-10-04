/**
 * A fake DOM: only the parts of it this plugin touches.
 *
 * This plugin's other half is DOM work, so there is no way to test it without one.
 * The rule here is the opposite of a browser: nothing is supported until the plugin
 * needs it, and everything supported is as close to the real thing as the plugin
 * can tell. A stub that is *more* capable than needed would let a call through
 * that fails in a browser, which is exactly the failure this suite exists to catch.
 *
 * The one deliberate departure is `flush()`: a real `MutationObserver` fires by
 * itself, and nothing here can watch for changes, so the test says when the
 * observer runs. That is the honest shape of the arrangement — the plugin's
 * assumption is that it is *called* on change, not that it can ask to be.
 */

/** Takes a child out of a parent's list, and forgets both ends of the link. */
function detach(parent, child) {
  const at = parent.children.indexOf(child);
  if (at >= 0) parent.children.splice(at, 1);
  if (child.parentNode === parent) child.parentNode = null;
}

/**
 * Fullscreen, as the document and the elements it hands out share it.
 *
 * The header draws a fullscreen button only where `document.fullscreenEnabled` says
 * there is one, and asks the lightbox for it — so the test world needs both halves,
 * and needs the element to become the document's fullscreen element, which is what
 * the button reads to decide which way it is going.
 */
const fullscreen = { element: null };

/**
 * One selector part — a tag, a class, an id, or one of those with **one attribute
 * test** — as a predicate over a node.
 *
 * The attribute forms are here because the plugin asks for them: the gallery behind
 * a scene page's lightbox is found by `img[src*="/image/{id}/"]` and named by the
 * card's own `a[href^="/galleries/"]`. A stub that answered those with nothing
 * would make that whole path untestable, and a green suite that cannot see a
 * feature is worse than a red one — it reads as proof.
 *
 * Anything else is still refused rather than guessed at: a stub that quietly
 * matched the wrong thing would hide a broken selector instead of failing on it.
 */
function matchesPart(node, sel) {
  const attr =
    /^([a-zA-Z]*)(?:([.#][\w-]+))?\[([\w-]+)(?:([*^])=([^\]]*))?\]$/.exec(sel);
  if (attr) {
    const tag = attr[1];
    const mod = attr[2];
    const name = attr[3];
    const op = attr[4];
    const raw = attr[5] || "";
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if (mod && !matchesPart(node, mod)) return false;

    const value = node.getAttribute ? node.getAttribute(name) : null;
    if (value === null) return false;
    if (!op) return true;

    const want = raw.replace(/^["']|["']$/g, "");
    return op === "^" ? value.indexOf(want) === 0 : value.indexOf(want) !== -1;
  }

  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel.startsWith(".")) return node.classList.contains(sel.slice(1));
  return node.tagName === sel.toUpperCase();
}

/** An element, with the handful of properties the plugin reads and writes. */
function makeElement(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    id: "",
    className: "",
    /**
     * What `getBoundingClientRect` answers, in the shape the plugin reads. Nothing
     * here lays anything out, so a test that means to measure an element — the
     * progress bar's track, which turns a pointer's x into a fraction of it — says
     * for itself where it is and how wide.
     */
    rect: { left: 0, top: 0, width: 0, height: 0 },
    // `data-*` attributes, as the real element exposes them: the plugin reads one
    // to tell Stash's two nav buttons apart.
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    listeners: {},
    // The plugin clears a container by assigning the empty string, and reads text
    // back off the indicator's <b>. Both, on one property, the way the real one
    // behaves: writing text replaces the children.
    textContent: "",

    get childElementCount() {
      return el.children.length;
    },

    /**
     * Attributes, for the ones the plugin sets that are not classes or text — the
     * `aria-expanded` on its menu's toggle, and the `title` carrying a chapter name
     * the button may be clipping. `data-*` is the `dataset` above, the way the real
     * element splits them.
     */
    attributes: {},
    setAttribute(name, value) {
      el.attributes[name] = String(value);
    },
    getBoundingClientRect() {
      return el.rect;
    },
    getAttribute(name) {
      return Object.hasOwn(el.attributes, name) ? el.attributes[name] : null;
    },
    removeAttribute(name) {
      delete el.attributes[name];
    },

    get classList() {
      return {
        contains: (name) => el.className.split(/\s+/).includes(name),
        add: (name) => {
          if (!el.classList.contains(name)) {
            el.className = (el.className + " " + name).trim();
          }
        },
        remove: (name) => {
          el.className = el.className
            .split(/\s+/)
            .filter((c) => c && c !== name)
            .join(" ");
        },
        toggle: (name, force) => {
          const on = force === undefined ? !el.classList.contains(name) : force;
          if (on) el.classList.add(name);
          else el.classList.remove(name);
        },
      };
    },

    appendChild(child) {
      if (child.parentNode) detach(child.parentNode, child);
      el.children.push(child);
      child.parentNode = el;
      return child;
    },

    /** The DOM's own `remove` takes no argument: it takes the node out of its parent */
    remove() {
      if (el.parentNode) detach(el.parentNode, el);
    },

    /**
     * The DOM's own `insertBefore`, for the two places the plugin wants a node in a
     * particular place: its header where Stash's header is, and its progress bar in
     * the row before the footer.
     */
    insertBefore(child, before) {
      if (child.parentNode) detach(child.parentNode, child);

      const at = el.children.indexOf(before);
      if (at === -1) return el.appendChild(child);

      el.children.splice(at, 0, child);
      child.parentNode = el;
      return child;
    },

    /**
     * The sibling before this one, elements only — the chapters tab is found by the
     * button Stash renders beside it.
     */
    get previousElementSibling() {
      if (!el.parentNode) return null;
      const at = el.parentNode.children.indexOf(el);
      return at > 0 ? el.parentNode.children[at - 1] : null;
    },

    /** Its mirror, for the nodes the plugin puts *after* one it found */
    get nextElementSibling() {
      if (!el.parentNode) return null;
      const at = el.parentNode.children.indexOf(el);
      const next = el.parentNode.children[at + 1];
      return next || null;
    },

    /** Whether the node is this element or below it — how a menu knows a click was inside it */
    contains(node) {
      for (let at = node; at; at = at.parentNode) {
        if (at === el) return true;
      }

      return false;
    },

    /**
     * The nearest ancestor matching, **the element itself included** — as in the
     * DOM. Asked for as `.gallery-card`: the card an image sits in is how a scene
     * page's lightbox is traced back to its gallery.
     */
    closest(selector) {
      const parts = selector.trim().split(/\s+/);

      for (let at = el; at; at = at.parentNode) {
        if (!matchesPart(at, parts[parts.length - 1])) continue;

        let up = at.parentNode;
        let ok = true;
        for (let want = parts.length - 2; want >= 0; want--) {
          while (up && !matchesPart(up, parts[want])) up = up.parentNode;
          if (!up) {
            ok = false;
            break;
          }
          up = up.parentNode;
        }

        if (ok) return at;
      }

      return null;
    },

    /**
     * Only the selector shapes the plugin uses: `.cls`, `.outer .inner`, `#id`, a
     * bare tag name, and one attribute test (`img[src*="/image/7/"]`) — each matching
     * at any depth below the element it is asked of, the way the real one does.
     *
     * Anything else returns null rather than guessing: a stub that quietly matched
     * the wrong thing would hide a broken selector instead of failing on it.
     *
     * **One pass, whatever the selector has in it.** The obvious way to write this —
     * for each child, try the rest of the selector here and then the whole selector
     * below — searches the subtree twice per level, so the cost doubles with every
     * level of the fixture. A depth of twenty is a million walks of the same nodes,
     * and a query the browser answers instantly becomes one that never returns. A
     * descendant selector is answered instead by walking the tree once and, for each
     * node, climbing its ancestors for the parts before the last — which is what the
     * real selector means: it is asked of the document, and this narrows the answer
     * to what is below `el`.
     */
    querySelector(selector) {
      const parts = selector.trim().split(/\s+/);

      /** Whether this node is the one the selector ends at: the last part is its
       * own, and every part before that has an ancestor of it above */
      const ends = (node) => {
        if (!matchesPart(node, parts[parts.length - 1])) return false;

        let at = node.parentNode;
        for (let want = parts.length - 2; want >= 0; want--) {
          while (at && !matchesPart(at, parts[want])) at = at.parentNode;
          if (!at) return false;
          at = at.parentNode;
        }

        return true;
      };

      /** Document order: a node, then its subtree, then its next sibling */
      const search = (node) => {
        for (const child of node.children) {
          if (ends(child)) return child;
          const found = search(child);
          if (found) return found;
        }

        return null;
      };

      return search(el);
    },

    /**
     * Every descendant matching, in document order — the plural of `querySelector`
     * above, with the same single-class/hash/tag matcher and the same refusal to
     * guess at anything else.
     *
     * One class only, as the plugin uses it: a selector of several classes is a
     * stub that would match the wrong thing rather than fail.
     */
    querySelectorAll(selector) {
      const sel = selector.trim();
      if (/\s/.test(sel) || sel.split(".").length > 2) return [];

      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (matchesPart(child, sel)) found.push(child);
          walk(child);
        }
      };
      walk(el);

      return found;
    },

    /**
     * Adding the same callback twice is not two listeners in the DOM either: the
     * second `addEventListener` of the same type and function is a no-op. This is
     * what lets the plugin put its move and release on the document on every press
     * and take them off once — a stub that piled them up would be *stricter* than
     * the browser and report a leak that is not one.
     */
    addEventListener(type, fn) {
      if (!el.listeners[type]) el.listeners[type] = [];
      if (!el.listeners[type].includes(fn)) el.listeners[type].push(fn);
    },

    /** Removing one matters here: the plugin takes its lightbox listener off again */
    removeEventListener(type, fn) {
      const list = el.listeners[type];
      if (!list) return;

      const at = list.indexOf(fn);
      if (at !== -1) list.splice(at, 1);
    },

    /** Fires the listeners this stub holds — the test's way of clicking things. */
    dispatch(type, event) {
      for (const fn of el.listeners[type] || []) fn(event || { type });
    },

    /**
     * The DOM's own dispatch, for the events the *plugin* sends — a click on one
     * of Stash's thumbnails, which is how a chapter jump is made.
     *
     * Bubbling, as the real one does, because Stash's handlers are delegated: a
     * click on a thumbnail in the nav strip is handled by whatever is listening
     * above it, not by the thumbnail. Same walk as `click` below, which is the
     * test's way of clicking.
     */
    dispatchEvent(event) {
      event.target = el;
      for (let node = el; node; node = node.parentNode) {
        const listener = node.listeners[event.type];
        if (typeof listener === "function") listener(event);
        else if (Array.isArray(listener)) for (const fn of listener) fn(event);
        if (event.propagationStopped) break;
      }

      return true;
    },

    /**
     * The animations started on this element, in order.
     *
     * A screen fades in as it arrives, and whether that happened is a thing only
     * this can see: it leaves no DOM behind, which is the point of animating a
     * property rather than a class.
     */
    /** Asked for by the header's fullscreen button, of the lightbox itself */
    requestFullscreen() {
      fullscreen.element = el;
      return Promise.resolve();
    },
    animations: [],
    animate(keyframes, options) {
      el.animations.push({ keyframes, options });
      return { cancel() {} };
    },
  };

  Object.defineProperty(el, "textContent", {
    get: () => el.children.map((c) => c.textContent).join("") || el.text,
    set: (value) => {
      el.text = String(value);
      el.children.length = 0;
    },
  });

  return el;
}

/** A minimal event, with `isTrusted` settable — see the note in smoke.js. */
function makeEvent(type, init) {
  const event = Object.assign(
    {
      type,
      isTrusted: false,
      repeat: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    },
    init || {}
  );

  return event;
}

/**
 * A document, a window, and the globals the bundle reads.
 *
 * `document.body` and `document` share one element tree: the plugin searches the
 * document for the lightbox and appends to nodes it found there, so the two being
 * the same tree is not a detail this stub may get wrong.
 */
function createDom() {
  const body = makeElement("body");

  // ── Images, and whether they are there yet ──
  //
  // A real `<img>` reports what it has: `complete`, and a `decode()` that resolves
  // when the frame can be painted. The plugin waits on both before showing a
  // screen, so a stub that had neither would make every screen appear at once —
  // and the waiting, which is the feature, would be untestable.
  //
  // This DOM has no network, so an image *is* there as soon as it is asked for.
  // Holding them open is how a test sees the wait: `holdImages()` before the turn
  // the test wants to be slow, then `settleImages()` when the bytes arrive.
  let imagesHeld = false;
  const waitingDecodes = [];
  let imagesAskedFor = 0;

  const imageElement = () => {
    imagesAskedFor += 1;
    const el = makeElement("img");
    Object.defineProperty(el, "complete", { get: () => !imagesHeld });
    el.decode = () =>
      imagesHeld
        ? new Promise((resolve) => waitingDecodes.push(resolve))
        : Promise.resolve();
    return el;
  };

  const document = {
    body,
    // The two sides of fullscreen the plugin reads: whether a button is worth
    // drawing at all, and which way the one that is drawn goes.
    fullscreenEnabled: true,
    get fullscreenElement() {
      return fullscreen.element;
    },
    exitFullscreen() {
      fullscreen.element = null;
      return Promise.resolve();
    },
    querySelector: (sel) => body.querySelector(sel),
    // Real, over the body: the plugin now looks for Stash's chapters panel by shape
    // rather than by an id, so an empty answer would be a page it cannot read.
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    getElementById: (id) => body.querySelector("#" + String(id)),
    createElement: (tag) =>
      String(tag).toLowerCase() === "img" ? imageElement() : makeElement(tag),
    listeners: {},
    addEventListener(type, fn) {
      if (!document.listeners[type]) document.listeners[type] = [];
      if (!document.listeners[type].includes(fn))
        document.listeners[type].push(fn);
    },
    // Taken off again by the plugin: a drag puts a move and a release on the document
    // and takes them off when it ends. A document that could not forget them would
    // hide a listener piling up on every drag.
    removeEventListener(type, fn) {
      const list = document.listeners[type];
      if (!list) return;

      const at = list.indexOf(fn);
      if (at !== -1) list.splice(at, 1);
    },
    /** Events the plugin dispatches land here: the test reads them back. */
    dispatchEvent(event) {
      event.target = document;
      for (const fn of document.listeners[event.type] || []) fn(event);
      return true;
    },
    dispatch(type, event) {
      for (const fn of document.listeners[type] || [])
        fn(event || makeEvent(type));
    },
    documentElement: makeElement("html"),
  };

  /** Every src an `Image` was given, in order: how the test sees preloading. */
  const preloaded = [];

  function ImageStub() {
    const image = { src: "" };
    Object.defineProperty(image, "src", {
      get: () => image.href,
      set: (value) => {
        image.href = value;
        preloaded.push(value);
      },
    });
    return image;
  }

  const observers = [];

  function MutationObserverStub(callback) {
    observers.push(callback);
    return {
      observe: () => {},
      disconnect: () => {
        const at = observers.indexOf(callback);
        if (at >= 0) observers.splice(at, 1);
      },
    };
  }

  const storage = new Map();

  /**
   * Whether the reader has asked their system for less motion. The plugin checks it
   * before fading a screen in, and a test can turn it on — see prefersReducedMotion.
   */
  let reducedMotion = false;

  const window = {
    document,
    // `search` is what the reader reads the lightbox's order from — the list the
    // lightbox was opened from keeps its filter there, and the reader has to fetch
    // the pages in that same order. A test sets it; see startReader in reader.js.
    location: { pathname: "/", search: "" },
    matchMedia: (query) => ({
      matches: /prefers-reduced-motion/.test(query) && reducedMotion,
      media: query,
    }),
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    listeners: {},
    addEventListener(type, fn) {
      if (!window.listeners[type]) window.listeners[type] = [];
      if (!window.listeners[type].includes(fn)) window.listeners[type].push(fn);
    },
    dispatchEvent(event) {
      event.target = window;
      for (const fn of window.listeners[event.type] || []) fn(event);
      return true;
    },
    Image: ImageStub,
    // The reader waits on a timer for a key press the lightbox dropped, so these
    // are the real ones: a test that has to wait for a retry can, and one that does
    // not is not slowed down by them.
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    // The tools half polls the library on one of these, started from its own
    // module body — so an absent one is a bundle that throws at load rather than
    // a feature that quietly does not work. Inert rather than real: what the
    // poll is for is its own suite's business, and a real interval would keep
    // this process alive for a test that never uses it.
    setInterval: () => 0,
    clearInterval: () => {},
  };

  return {
    body,
    document,
    window,
    preloaded,
    MutationObserver: MutationObserverStub,
    /** Lets the test run the observer, which nothing here can trigger by itself. */
    flush() {
      for (const callback of observers.slice()) callback();
    },
    observerCount: () => observers.length,
    makeElement,
    makeEvent,
    /**
     * How many `<img>` elements the plugin has made: how a test sees a screen being
     * drawn again when it should have been left alone.
     */
    imagesAskedFor: () => imagesAskedFor,
    /**
     * Dispatches an event with a chosen `target` — the element that has focus, as
     * far as the plugin can tell. `window.dispatchEvent` overwrites the target with
     * the window, and the plugin's key handler is registered on the window but reads
     * `event.target` to decide whether the key is the reader's or the focused
     * field's.
     */
    dispatchTo(target, event) {
      event.target = target;
      for (const fn of window.listeners[event.type] || []) fn(event);
      return event;
    },
    /**
     * A click on an element, bubbling up through its ancestors — which is how the
     * plugin hears it: it listens on its own container for clicks on a page, and on
     * the lightbox for clicks on Stash's nav buttons.
     */
    click(target, init) {
      const event = makeEvent("click", Object.assign({ offsetX: 0 }, init));
      event.target = target;

      for (let el = target; el; el = el.parentNode) {
        const listener = el.listeners.click;
        if (typeof listener === "function") listener(event);
        else if (Array.isArray(listener)) for (const fn of listener) fn(event);
        if (event.propagationStopped) break;
      }

      // **And then the document's**, which is where a listener that watches the
      // whole page puts itself: the reader half keeps one there to see which gallery
      // a click was inside, and a click that bubbled all the way up has reached it in
      // a browser. The walk above stops at the body, whose parent is nothing here.
      if (!event.propagationStopped && document.listeners.click) {
        const doc = document.listeners.click;
        if (typeof doc === "function") doc(event);
        else for (const fn of doc) fn(event);
      }

      return event;
    },
    /** Says the reader has asked their system for less motion */
    prefersReducedMotion(on) {
      reducedMotion = !!on;
    },
    /** The images the plugin asks for are not there yet: hold them open. */
    holdImages() {
      imagesHeld = true;
    },
    /** They have arrived: every held image settles at once. */
    settleImages() {
      imagesHeld = false;
      waitingDecodes.splice(0).forEach((resolve) => {
        resolve();
      });
    },
  };
}

module.exports = { createDom, makeElement, makeEvent };
