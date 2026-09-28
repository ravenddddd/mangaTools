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

/** An element, with the handful of properties the plugin reads and writes. */
function makeElement(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    id: "",
    className: "",
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
     * Only the selector shapes the plugin uses: `.cls`, `.outer .inner`, `#id`, and
     * a bare tag name — each matching at any depth below the element it is asked of,
     * the way the real one does.
     *
     * Anything else returns null rather than guessing: a stub that quietly matched
     * the wrong thing would hide a broken selector instead of failing on it.
     */
    querySelector(selector) {
      const match = (node, sel) => {
        if (sel.startsWith("#")) return node.id === sel.slice(1);
        if (sel.startsWith(".")) return node.classList.contains(sel.slice(1));
        return node.tagName === sel.toUpperCase();
      };

      const search = (node, parts) => {
        const [head, ...rest] = parts;
        for (const child of node.children) {
          if (match(child, head)) {
            if (rest.length === 0) return child;
            const deeper = search(child, rest);
            if (deeper) return deeper;
          }
          const found = search(child, parts);
          if (found) return found;
        }
        return null;
      };

      return search(el, selector.trim().split(/\s+/));
    },

    addEventListener(type, fn) {
      if (!el.listeners[type]) el.listeners[type] = [];
      el.listeners[type].push(fn);
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
     * The animations started on this element, in order.
     *
     * A screen fades in as it arrives, and whether that happened is a thing only
     * this can see: it leaves no DOM behind, which is the point of animating a
     * property rather than a class.
     */
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
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: () => [],
    getElementById: (id) => body.querySelector("#" + String(id)),
    createElement: (tag) =>
      String(tag).toLowerCase() === "img" ? imageElement() : makeElement(tag),
    listeners: {},
    addEventListener(type, fn) {
      if (!document.listeners[type]) document.listeners[type] = [];
      document.listeners[type].push(fn);
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
    location: { pathname: "/" },
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
      window.listeners[type].push(fn);
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
