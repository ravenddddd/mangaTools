/**
 * The world the reader's smoke tests run in: a fake DOM, the fake Stash behind it,
 * and the bundled plugin loaded into both.
 *
 * Split out of `tests/reader.js` so that the suite's *sections* can live in files of
 * their own — the shape `tests/sections/*` already has, and for the same reason: one
 * file of eight thousand lines cannot be read, only grepped. Nothing here is new
 * code; it is the top of that file, moved, exporting what the sections used to close
 * over. A section file destructures the names it needs and is otherwise unchanged.
 *
 * Two things to keep in mind when adding to it. The world is **built once and
 * shared**: the sections run in one order against one plugin load, and some of them
 * leave state the next one reads — see the ordering sections, which share the
 * lightbox cache. And `require(BUNDLE)` lower down is what publishes `NR` and `NS`,
 * so a name read from either is only meaningful after it.
 */
/**
 * Manga Reader smoke test.
 *
 * What is under test is the *bundled* plugin, not the sources — the tests load
 * dist/mangaTools.js, the one file Stash loads, so a broken build shows up here
 * rather than in a browser. `pnpm test` from the repository root builds first.
 *
 * Two halves, tested differently and honestly so:
 *
 *   - the pairing rules are pure functions, called directly (see spreads.ts);
 *   - the reader is DOM work against Stash's own markup, so the tests drive it
 *     through a fake DOM (tests/dom.js) and a fake lightbox built the way Stash's
 *     is. What that cannot cover is whether Stash's markup is still what this
 *     plugin thinks it is — no test of ours can know that, which is why the plugin
 *     turns itself off rather than draw wrongly when it stops matching.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createDom } = require("../dom.js");

const BUNDLE = path.join(__dirname, "..", "..", "dist", "mangaTools.js");

// ── The environment the bundle loads into ──────────────────────────

const dom = createDom();

/** What the fake Stash answers with, per gallery, and what it was asked. */
const state = {
  language: null,
  galleries: {},
  queries: [],
  failing: false,
  /** Set by a test to hold the next gallery query open: see the client below */
  holdGallery: null,
  /**
   * What the library's copy of the reader's settings holds, or undefined for a library
   * nobody has written to — the state that makes the reader fall back to what this
   * browser remembers. Set by a section that wants the reading half to hear about a
   * change made *with the library*.
   */
  readerSettingsInConfig: undefined,
};

const mutations = [];

/**
 * Every settings write this suite saw, as the reader's own JSON.
 *
 * A list of its own rather than entries in `mutations`: the sections below walk that
 * one looking for `custom_fields`, and the plugin's settings are a different mutation
 * with a different shape. What the reader writes into the config is all this holds.
 */
const settingsWrites = [];
const client = {
  query: ({ query, variables, fetchPolicy }) => {
    state.queries.push({ query: String(query), variables, fetchPolicy });
    if (state.failing) return Promise.reject(new Error("no answer from Stash"));

    // The tools half's gallery map, told apart by having no variables at all: it bakes
    // its filter into the document, and every query the reader makes names a gallery.
    // Its answer is what tells this plugin a gallery is manga — see markedInStore —
    // so the worlds here are the marked ones, and a fixture marked `manga: false` is
    // the gallery this plugin is meant to leave alone.
    // The chapter import's plan: every marked gallery, with its own chapters and
    // this plugin's field. Told apart from the tools half's map by its *variables*
    // — that one has none at all, and this one names the field it is looking for —
    // which is why the query takes them as variables rather than splicing them in.
    if (variables?.field !== undefined) {
      const galleries = Object.keys(state.galleries)
        .filter((id) => state.galleries[id].manga !== false)
        .map((id) => {
          const gallery = state.galleries[id].gallery || {
            custom_fields: {},
            chapters: [],
          };

          return {
            id,
            custom_fields: gallery.custom_fields || {},
            chapters: gallery.chapters || [],
          };
        });

      return Promise.resolve({
        data: { findGalleries: { count: galleries.length, galleries } },
      });
    }

    if (!variables) {
      const marked = Object.keys(state.galleries)
        .filter((id) => state.galleries[id].manga !== false)
        .map((id) => ({
          id,
          custom_fields: { "plugin.mangaTools.manga": "true" },
        }));

      return Promise.resolve({
        data: { findGalleries: { count: marked.length, galleries: marked } },
      });
    }

    const gallery = state.galleries[variables.galleryId] || { images: [] };
    // Answered by the sort that was asked for, as Stash does — a stub that gave the
    // same list whatever it was asked for could not tell a reader that follows the
    // lightbox's order from one that ignores it. Fixtures without a path order are
    // the same list either way.
    const pages =
      variables.sort === "path" && gallery.pathImages
        ? gallery.pathImages
        : gallery.images;
    const answer = {
      data: {
        configuration: {
          interface: { language: state.language },
          // What the managing half reads the plugin's own settings out of. Only the
          // reading half's part of it is ever set here — a section that wants the reader
          // to hear about a change made *with the library* writes it and navigates.
          plugins: {
            mangaTools: {
              readerSettings: state.readerSettingsInConfig,
            },
          },
        },
        pages: { images: pages },
        // The gallery itself: this plugin's own custom fields, and Stash's own
        // chapters. A fixture that says nothing about either gets the empty
        // answer, which is a gallery with no chapters at all.
        findGallery: gallery.gallery || {
          id: variables.galleryId,
          custom_fields: {},
          chapters: [],
        },
        // The images in path order, for translating Stash's chapter numbers.
        // Answered whatever the fixture is: `@include` is the server's business,
        // and a stub that honoured it would be testing the stub.
        byPath: {
          images: (gallery.pathImages || gallery.images).map((i) => ({
            id: i.id,
          })),
        },
      },
    };

    // Held open by a test that wants to look at the lightbox while the answer is still
    // on its way — which is the whole of what a flash of Stash's own chrome is. What
    // is held is the answer itself, so releasing it gives the query what it would
    // have had.
    if (state.holdGallery) {
      return new Promise((resolve) => {
        state.holdGallery = () => resolve(answer);
      });
    }

    return Promise.resolve(answer);
  },
  // Writes, recorded rather than performed. This plugin does write — its own custom
  // fields, never Stash's own data — so what a test reads here is which mutation went
  // out and with what in it. Never Stash's rows: see the note on the chapter field.
  mutate: (options) => {
    // Plugin-settings writes go in a list of their own. The reader saves its settings
    // through the tools half — the plugin's settings are one map and the managing half
    // is what builds it — and every one of those carries an `input` but no
    // `custom_fields`, which is what the sections below walk `mutations` looking for.
    const settings = options?.variables?.input?.readerSettings;
    if (typeof settings === "string") {
      // The whole map, not just the reading half's part of it: what a section may want
      // to check is that saving one half's settings does not take the other half's with
      // it, and that is a question about the input.
      settingsWrites.push(options.variables.input);
      return Promise.resolve({ data: { configurePlugin: true } });
    }

    mutations.push(options);

    // **Applied to the fixture, the way a server would.** This used to record the
    // write and change nothing, which made every test of writing a test of the stub:
    // a surface that reads the field back after writing it got the value from before
    // the write, and a test could not tell "the reader re-read it" from "the reader
    // was never told". Only this plugin's own chapter field is applied — a fixture is
    // a gallery with chapters, not a server.
    const input = options?.variables?.input;
    const partial = input?.custom_fields?.partial;
    const gallery = state.galleries[input?.id]?.gallery;
    const name = "plugin.mangaTools.chapters";

    if (gallery && partial && partial[name] !== undefined) {
      gallery.custom_fields = {
        ...(gallery.custom_fields || {}),
        [name]: partial[name],
      };
    }

    return Promise.resolve({ data: {} });
  },
};

/**
 * The gallery queries this half made, out of everything the client was asked.
 *
 * The reader half is no longer alone with this client: the tools half shares the
 * page now, and asks for its own gallery map as it starts. So what the reader
 * asked for is picked out by its distinguishing feature rather than by position —
 * a gallery id among the variables, which the tools half never passes, since its
 * queries bake theirs into the document.
 *
 * Not by the query text: this suite's `gql` stub hands back an opaque object
 * rather than the source, so there is no text to match on here.
 */
const imageQueries = () =>
  state.queries.filter(
    (q) => q.variables && q.variables.galleryId !== undefined
  );

global.window = dom.window;
global.document = dom.document;
global.MutationObserver = dom.MutationObserver;
global.Image = dom.window.Image;
// The plugin dispatches key events at the lightbox and ignores any that are not
// `isTrusted`, which is how it tells its own apart from a reader's. Trusting an
// event is exactly what this lets a test do.
global.KeyboardEvent = function KeyboardEvent(type, init) {
  return dom.makeEvent(type, init);
};
// And the click this plugin *sends* — a chapter jump is a click on one of Stash's
// thumbnails, which a browser would construct the same way.
global.MouseEvent = function MouseEvent(type, init) {
  return dom.makeEvent(type, init);
};

/**
 * The API the bundle loads against.
 *
 * The reader itself uses a small part of this — `libraries.Apollo` and the
 * client — but the plugin ships as **one bundle**, so the other half's load-time
 * reads are here too: it derives a class from `React.Component`, registers its
 * patches through `patch`, and reads the locale through `libraries.Intl` as it
 * starts. Absent, those are not a quieter test: they are a bundle that throws
 * before the reader ever installs, which is exactly what this stub found.
 *
 * The patches are inert and nothing here renders, so registering them is the
 * whole of what this world has to make possible.
 */
/**
 * What the bridge asks the lightbox to show, as the plugin asks it.
 *
 * The lightbox itself is a stub because there is none here: what is worth pinning
 * is the *handover* — which images, which chapters, and the numbers that make
 * Stash's own jump land where this plugin means it to.
 */
const shown = [];
const patched = [];

/**
 * Stash's own events, by name, as a test reaches them.
 *
 * The reader subscribes to one — `stash:location`, which is how it hears that the
 * page changed under an open lightbox — and a subscription is only worth a test if
 * the test can send the event.
 */
const globalListeners = {};

dom.window.PluginApi = {
  React: {
    Component: class {
      constructor(props) {
        this.props = props || {};
        this.state = {};
      }
    },
    // Enough of React to run one component: elements built rather than rendered,
    // hooks in call order, effects run when the component is called, and refs that
    // hold what they were given.
    Fragment: Symbol("Fragment"),
    createElement: (type, props, ...children) => {
      const next = Object.assign({}, props);
      if (children.length === 1) next.children = children[0];
      else if (children.length > 1) next.children = children;
      return { type, props: next };
    },
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useEffect: (fn) => {
      fn();
    },
    useRef: (init) => ({ current: init }),
  },
  hooks: {
    // The state argument is ignored on purpose: this plugin passes nothing it
    // wants kept, and the hook's own state is what Stash's lightbox already has.
    useLightbox: (_state, chapters) => (props) => {
      shown.push({ props, chapters: (chapters || []).slice() });
    },
  },
  patch: {
    before: (target, fn) => patched.push({ target, fn }),
    instead: (target, fn) => patched.push({ target, fn }),
    after: (target, fn) => patched.push({ target, fn }),
  },
  // Stash's own router events, which the tools half reads the path from and the
  // reader listens to for a page change under an open lightbox.
  Event: {
    addEventListener: (name, fn) => {
      if (!globalListeners[name]) globalListeners[name] = [];
      globalListeners[name].push(fn);
    },
  },
  components: {},
  // Stash's own React, and the DOM renderer that puts one of its components inside
  // markup this plugin built. Inert here: what the icons look like is Stash's business.
  ReactDOM: { render: () => {} },
  libraries: {
    Apollo: { gql: (text) => ({ __document: text }) },
    Intl: {
      useIntl: () => ({ locale: "en-US", formatMessage: ({ id }) => id }),
    },
  },
  utils: { StashService: { getClient: () => client } },
};

// The reader reports through the console, and some of what it says is visible
// nowhere else — a failure it recovers from by turning itself off, above all.
// Recorded *and* forwarded, the way mangaTools' suite does it.
const realConsoleError = console.error;
const loggedErrors = [];
console.error = (...args) => {
  loggedErrors.push(args.map((a) => String(a)).join(" "));
  realConsoleError.apply(console, args);
};

// ── The runner ─────────────────────────────────────────────────────

const failures = [];

/**
 * Runs one section, reporting rather than rethrowing so the rest still run.
 *
 * Async, because half of this plugin is a promise: the pages are fetched, and
 * everything after that happens in a `then`.
 */
async function runSection(name, body) {
  try {
    await body();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`\n✗ ${name}`);
    console.error(err?.stack ? err.stack : String(err));
  }
}

/** Lets the bundle's promise chain run: one turn of the event loop is enough. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const errorsSince = (at) => loggedErrors.slice(at);

// ── Fixtures ───────────────────────────────────────────────────────

/** A page of the usual shape: taller than it is wide. */
const page = (id, width = 1000, height = 1500) => ({ id, width, height });

/** A page that spans two of them. */
const wide = (id) => page(id, 2000, 1500);

/**
 * A page as Stash's GraphQL answers with it: a size inside `visual_files`, and the
 * file's own path — which is what names a page that has no title.
 */
const image = (id, width, height) => ({
  id,
  visual_files: [{ path: "/data/" + id + ".jpg", width, height }],
});

/**
 * The same, with the URL Stash publishes for it — which carries the file's version
 * stamp in its query. The reader lifts that query onto its own relative path, so
 * the two are one cache entry rather than two; see pageUrl.
 */
const stamped = (id, width, height, t) => ({
  ...image(id, width, height),
  paths: {
    image: "http://stash.example.com:9998/image/" + id + "/image?t=" + t,
  },
});

/** A screen list as ids, `+` between the pages that share one. */
const shape = (screens) =>
  screens.map((s) => s.pages.map((p) => p.id).join("+"));

/**
 * An image as Stash's API answers for one: a title it may or may not have, and the
 * file it is, which is what its lightbox falls back to when the title is empty.
 */
const named = (id, title, path) => ({
  ...image(id, 1000, 1500),
  title,
  visual_files: [{ __typename: "ImageFile", path, width: 1000, height: 1500 }],
  // Which is what Stash's own footer links back to, and null folder and all: that is
  // what this Stash answers for a gallery outside its library folders.
  galleries: [{ id: "51", title: "Gallery 51", folder: null }],
  // Stash publishes a URL here as well, query and all, and it is not a file's name:
  // a footer that reads a page's name out of this says "image?t=1700000009".
  paths: {
    image:
      "http://stash.example.com:9998/image/" + id + "/image?t=17000000" + id,
  },
});

/** Pages a, b, c, … */
const pagesOf = (...ids) => ids.map((id) => page(String(id)));

/**
 * A lightbox, built the way Stash's is: a display area holding a carousel, and a
 * header holding the counter that says where it is.
 */
function buildLightbox(current = 1, total = 5, ids = null) {
  const lightbox = dom.makeElement("div");
  lightbox.className = "Lightbox";

  const display = dom.makeElement("div");
  display.className = "Lightbox-display";

  // Stash's own chevrons, either side of the carousel and the same component
  // twice — what tells them apart is the Font Awesome icon inside each, which is
  // what the plugin reads.
  const navButton = (icon) => {
    const button = dom.makeElement("button");
    button.className = "Lightbox-navbutton d-none d-lg-block btn btn-link";
    const svg = dom.makeElement("svg");
    svg.dataset.icon = icon;
    button.appendChild(svg);
    return button;
  };
  const navLeft = navButton("chevron-left");
  const navRight = navButton("chevron-right");

  const carousel = dom.makeElement("div");
  carousel.className = "Lightbox-carousel";

  // Stash renders one child per image and slides the whole container by setting
  // its `left`; only the current image and its neighbours are given an `<img>`.
  // That is where `carouselImage` reads the order check from — and a lightbox built
  // without ids is one whose carousel says nothing, which is the case the check is
  // skipped in.
  const slides = [];
  const paint = (at) => {
    carousel.style.left = `${(at - 1) * -100}vw`;
    slides.forEach((slide, i) => {
      slide.textContent = "";
      if (!ids || Math.abs(i - (at - 1)) > 1) return;
      const img = dom.makeElement("img");
      img.src = `/image/${ids[i]}/image?t=1`;
      slide.appendChild(img);
    });
  };
  if (ids) {
    for (let i = 0; i < total; i++) {
      const slide = dom.makeElement("div");
      slide.className = "Lightbox-carousel-image";
      carousel.appendChild(slide);
      slides.push(slide);
    }
    paint(current);
  }

  display.appendChild(navLeft);
  display.appendChild(carousel);
  display.appendChild(navRight);

  const header = dom.makeElement("div");
  header.className = "Lightbox-header";
  // Where Stash puts its own chapter menu, and where this plugin puts its own when
  // Stash's is not there. Empty unless a test asks for one — see chapterButton.
  const leftSpacer = dom.makeElement("div");
  leftSpacer.className = "Lightbox-header-left-spacer";
  const indicator = dom.makeElement("div");
  indicator.className = "Lightbox-header-indicator";
  const counter = dom.makeElement("b");
  counter.textContent = `${current} / ${total}`;
  indicator.appendChild(counter);
  header.appendChild(leftSpacer);
  header.appendChild(indicator);

  const footer = dom.makeElement("div");
  footer.className = "Lightbox-footer";

  // What the footer names the image and links to, as Stash renders it: built once,
  // from the *index Stash mounted with*, and never again — which is the whole reason
  // this plugin has to correct it. See footer.ts.
  const footerCenter = dom.makeElement("div");
  footerCenter.className = "Lightbox-footer-center";
  const imageLink = dom.makeElement("a");
  imageLink.className = "image-link";
  // Named and pointed at the image Stash mounted on, and then never rewritten:
  // React renders this from its own index, which this plugin stops moving.
  const opening = (ids || [])[current - 1];
  imageLink.textContent = opening ? opening + ".jpg" : "";
  if (opening) imageLink.setAttribute("href", "/images/" + opening);
  const galleryLink = dom.makeElement("a");
  galleryLink.className = "image-gallery-link";
  // Stash's own, and right as it stands: there is one gallery behind the lightbox and
  // the reader never leaves it.
  galleryLink.textContent = "Gallery";
  footerCenter.appendChild(imageLink);
  footerCenter.appendChild(galleryLink);
  footer.appendChild(footerCenter);

  // The nav strip: one thumbnail per image the lightbox is holding, and clicking
  // one is Stash's own way of going straight to it. Built the way Stash builds it
  // — an `img` per image with `Lightbox-nav-image`, the current one marked — and
  // given the same click handling a React handler would give it, since that is
  // what makes it a jump.
  const nav = dom.makeElement("div");
  nav.className = "Lightbox-nav";
  const thumbs = [];
  /** What a click on a thumbnail does in Stash: `selectIndex(index)` */
  const selectIndex = (index) => {
    const thumb = thumbs[index];
    if (!thumb) return;

    for (const other of thumbs) other.classList.remove("Lightbox-nav-selected");
    thumb.classList.add("Lightbox-nav-selected");
    counter.textContent = `${index + 1} / ${thumbs.length}`;
  };
  nav.jumpTo = selectIndex;

  const setThumbs = (count, at = 0) => {
    for (const thumb of thumbs.slice()) thumb.remove();
    thumbs.length = 0;
    for (let i = 0; i < count; i++) {
      const thumb = dom.makeElement("img");
      thumb.className = "Lightbox-nav-image";
      thumb.addEventListener("click", () => selectIndex(i));
      nav.appendChild(thumb);
      thumbs.push(thumb);
    }

    if (thumbs.length > 0) thumbs[at]?.classList.add("Lightbox-nav-selected");
  };
  setThumbs(total, current - 1);
  footer.appendChild(nav);

  lightbox.appendChild(display);
  lightbox.appendChild(header);
  lightbox.appendChild(footer);
  dom.body.appendChild(lightbox);

  return {
    lightbox,
    display,
    carousel,
    navLeft,
    navRight,
    counter,
    leftSpacer,
    nav,
    thumbs,
    setThumbs,
    /**
     * Stash draws its own chapter menu when it was handed chapters, and only then.
     * A test that wants that case puts one here.
     */
    chapterButton: () => {
      const button = dom.makeElement("button");
      button.className = "Lightbox-header-chapter-button";
      leftSpacer.appendChild(button);
      return button;
    },
    /** What a reader sees as the lightbox moves — Stash rewrites this text */
    move: (at) => {
      counter.textContent = `${at} / ${total}`;
      paint(at);
    },
    openPopover: () => {
      // Stash unmounts the popover when it closes and builds a new one next time,
      // which is why the label is worked out at injection time.
      const previous = lightbox.querySelector(".popover");
      if (previous) previous.remove();
      const popover = dom.makeElement("div");
      popover.className = "popover";
      const body = dom.makeElement("div");
      body.className = "popover-body";
      popover.appendChild(body);
      lightbox.appendChild(popover);
      return body;
    },
    /**
     * Stash replaces the whole lightbox with a spinner while it fetches or swaps a
     * page. Everything else goes with it — the header, the carousel, the lot.
     */
    loading: (on) => {
      const existing = lightbox.querySelector(".LoadingIndicator");
      if (existing) existing.remove();

      if (on) {
        // Away rather than gone: Stash unmounts them, and this puts them back so the
        // rest of a section can carry on from where it was.
        display.remove();
        header.remove();
        const spinner = dom.makeElement("div");
        spinner.className = "LoadingIndicator";
        lightbox.appendChild(spinner);
        return;
      }

      if (display.parentNode) return;
      lightbox.appendChild(display);
      lightbox.appendChild(header);
    },
    close: () => lightbox.remove(),
  };
}

/**
 * Mounts the bridge the plugin registered against Stash's image list.
 *
 * The plugin patches `ImageList` and puts a component beside its output; here the
 * patch is called by hand, since this world has no React. What comes back is the
 * element tree the patch would return, and the bridge is the function component in
 * it — calling it is what a render does, and what publishes the handle the reader
 * hands its chapters to.
 */
const mountBridge = () => {
  const patch = patched.find((p) => p.target === "ImageList");
  assert.ok(
    patch,
    "the plugin should patch the list a gallery's lightbox opens from"
  );

  const tree = patch.fn({}, "the list's own output");
  const bridge = (tree.props?.children || []).find(
    (child) => child && typeof child.type === "function"
  );
  assert.ok(bridge, "and render something beside it");
  bridge.type(bridge.props);
};

/**
 * Stash's Chapters tab, as far as this plugin can see it: a button, and a container
 * of rows beside it. The rows are Stash's own shape — an `<hr>` and a `btn-link` in
 * a `.row` — because that is what the plugin replaces them with.
 */
const buildChaptersTab = (chapters) => {
  const panel = dom.makeElement("div");
  const button = dom.makeElement("button");
  button.className = "btn btn-primary";
  button.textContent = "Create chapters";

  const container = dom.makeElement("div");
  container.className = "container";
  for (const chapter of chapters) {
    const wrap = dom.makeElement("div");
    wrap.appendChild(dom.makeElement("hr"));
    const line = dom.makeElement("div");
    line.className = "row";
    const row = dom.makeElement("button");
    row.className = "btn btn-link";
    row.textContent = `${chapter.title} - #${chapter.image_index}`;
    line.appendChild(row);
    wrap.appendChild(line);
    container.appendChild(wrap);
  }

  panel.appendChild(button);
  panel.appendChild(container);
  dom.body.appendChild(panel);

  return { panel, button, container, close: () => panel.remove() };
};

/**
 * What the reader's own chapter menu offers, in the order it offers it.
 *
 * The chapters are not handed to Stash's lightbox any more — they are this plugin's
 * own menu, in its own header — so this is where a section looks for them.
 *
 * The name out of each row, not the row's whole `textContent`: a row also carries the
 * range of pages the chapter covers, and a section asking what the chapters are
 * called is not asking about that.
 */
const chapterMenu = (box) =>
  [...box.lightbox.querySelectorAll(".manga-reader-menu-item")].map(
    (item) => item.querySelector(".manga-reader-chapter-name").textContent
  );

/** The same rows' page ranges, as they are shown: `"40–61"` */
const chapterRanges = (box) =>
  [...box.lightbox.querySelectorAll(".manga-reader-menu-item")].map(
    (item) => item.querySelector(".manga-reader-chapter-range").textContent
  );

/**
 * The reader's settings where they now live: with the library.
 *
 * Read back out of the settings write Stash was sent — the last one, which is the one a
 * section's own action caused — rather than out of `localStorage`, which is where they
 * used to be and is not where they are. Null when nothing has been written, which is a
 * state in its own right rather than a failure: a library nobody has changed yet has no
 * settings in it, and the reader falls back to what the browser remembers.
 */
const savedReaderSettings = () => {
  const written = settingsWrites[settingsWrites.length - 1]?.readerSettings;
  // Read the way the plugin reads it rather than with a bare `JSON.parse`: the stored object
  // is the mode and a set of settings for each way of reading, and what a section means by
  // "the settings" is the flat one the reader in hand has. See settings.ts.
  return written ? NR.parseSettings(written) : null;
};

/**
 * The settings as the plugin *stores* them: the way of reading, and one set of settings per
 * way.
 *
 * The shape is the plugin's rather than a section's — see settings.ts — so this is the one
 * place a section says what it is putting in the library, and every set starts from the
 * plugin's own defaults for that mode rather than from a literal that could drift. A section
 * that wants a stored object rather than a write through the panel asks for this.
 */
const storedSettings = ({ readingMode = "single", profiles = {} } = {}) => {
  const sets = {};
  for (const mode of ["single", "double", "scroll"]) {
    sets[mode] = { ...NR.defaultProfile(mode), ...(profiles[mode] || {}) };
  }
  return JSON.stringify({ readingMode, profiles: sets });
};

/**
 * The whole of the reader's settings, with whatever a section is asking about
 * overridden.
 *
 * They are compared as a whole — a write carries the whole map, because that is what
 * saving plugin settings is — so every assertion about them wants all of them, and a
 * literal per assertion is a literal to grow each time one is added: when the two the
 * progress bar answers arrived, six of them had to. One place that lists them now, and
 * the default of each is written once.
 */
const settingsWith = (over = {}) => ({
  readingMode: "single",
  coverAlone: true,
  detectSpreads: true,
  fade: true,
  offset: false,
  showProgress: true,
  showChapterMarks: true,
  // Read off the bundle rather than written down, so that the default is asserted where it
  // is declared and a change to it is a change here too.
  progressIdleMs: NR.PROGRESS_IDLE_MS,
  // The wheel's three chords as a reader who has never touched them has them — for single
  // pages, which is the mode these sections are in unless they say otherwise. The column's
  // own set is the other way round; see wheel.ts.
  wheel: { plain: "turn", shift: "scroll", ctrl: "zoom" },
  ...over,
});

/** The rows this plugin drew in Stash's container */
const drawnRows = (container) =>
  [...container.children].map(
    (wrap) => wrap.children[1].children[0].textContent
  );

/**
 * Turns the reader by a screen, the way a reader does: a click on one of Stash's own
 * chevrons, which this plugin intercepts.
 *
 * A section used to move the lightbox and expect the reader to follow it. The reader's
 * place is its own now — that is what taking the lightbox over meant — so a section
 * that wants it somewhere else turns to get there. One click is one screen, which is
 * also why the sections that used to press twice no longer do.
 */
const turn = (box, screens = 1) => {
  for (let i = 0; i < screens; i++) {
    dom.click(box.navRight);
    dom.flush();
  }
};

/** The container this plugin draws in, if it is drawing */
const container = () => dom.body.querySelector(".manga-reader-spread");

/** What is drawn, as image paths */
const drawn = () =>
  (container()?.children || []).map((box) => box.children[0].src);

/** A key press a reader made, rather than one the plugin dispatched */
const press = (key) => {
  const event = dom.makeEvent("keydown", { key, isTrusted: true });
  dom.window.dispatchEvent(event);
  return event;
};

// ── What Stash answers with ────────────────────────────────────────
//
// Every fixture is in place before the first section runs. The plugin keeps the
// page list it is given, so a gallery asked for before its fixture existed would
// be remembered as an empty one for the rest of the run.

/** Five pages with a spread in the middle: 101 | 102 | 103(wide) | 104+105 */
const GALLERY_WITH_A_SPREAD = {
  images: [
    image("101", 1000, 1500),
    image("102", 1000, 1500),
    image("103", 2000, 1500),
    image("104", 1000, 1500),
    image("105", 1000, 1500),
  ],
};

/** Five ordinary pages: 401 | 402+403 | 404+405 */
const PLAIN_GALLERY = {
  images: [
    image("401", 1000, 1500),
    image("402", 1000, 1500),
    image("403", 1000, 1500),
    image("404", 1000, 1500),
    image("405", 1000, 1500),
  ],
};

/** Two ordinary pages, for the header that cannot be read */
const TWO_PAGES = {
  images: [image("201", 1000, 1500), image("202", 1000, 1500)],
};

/** One page, which has no counter at all — Stash draws it only for more than one */
const ONE_PAGE = { images: [image("301", 1000, 1500)] };

/** Two pages Stash published URLs for, version stamp and all */
const STAMPED_GALLERY = {
  images: [
    stamped("501", 1000, 1500, 1700000001),
    stamped("502", 1000, 1500, 1700000002),
  ],
};

/**
 * Two ordinary pages, for the tests that need a gallery nobody else has opened.
 *
 * Each of these is fetched once per gallery and remembered, so an assertion about
 * what was *asked for* needs a gallery that has not been asked for yet — three
 * more of these are registered under their own ids below.
 */
const ORDER_GALLERY = {
  images: [image("601", 1000, 1500), image("602", 1000, 1500)],
};

/**
 * The same eight pages, in two orders.
 *
 * `view` is what a title-sorted list hands the lightbox; `path` is the order
 * Stash's own chapter numbers count in. They are reverses of each other on
 * purpose: a fixture where the two agreed could not tell a list that follows the
 * view from one that quietly follows path — which is the whole question here.
 */
const CHAPTERS_VIEW = [701, 702, 703, 704, 705, 706, 707, 708];
const CHAPTERS_PATH = [708, 707, 706, 705, 704, 703, 702, 701];
const numbered = (ids) => ids.map((id) => image(String(id), 1000, 1500));

/**
 * A gallery whose chapters this plugin keeps itself.
 *
 * The first two pages are in no chapter at all — a cover and a title page, the
 * pages nobody would put in one — which is the difference this shape has over
 * Stash's: with Stash's numbers a page between two chapters belongs to the one
 * before it, and here a page nobody claimed is in nothing.
 *
 * The ids are written out of order too, since the array is a set: what places a
 * chapter is its earliest page on screen, not the order it was written in.
 */
const OWN_CHAPTERS = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
  gallery: {
    id: "31",
    custom_fields: {
      "plugin.mangaTools.chapters": JSON.stringify({
        v: 1,
        chapters: [
          { title: "開幕", images: ["704", "703"] },
          { title: "中盤", images: ["708", "705", "706", "707"] },
        ],
      }),
    },
    chapters: [],
  },
};

/**
 * And one still on Stash's own numbers: no field of ours, two chapters whose
 * starts count in path order. Expanded against CHAPTERS_PATH, the first one holds
 * the four images at the *end* of the reversed path — so on screen its earliest
 * page is fifth, while the second chapter's earliest is the first page of all.
 * The menu has to show the later-started chapter first, which is what "the list is in the
 * order on screen" means.
 */
const STASH_CHAPTERS = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
  gallery: {
    id: "32",
    custom_fields: {},
    chapters: [
      { title: "第一話", image_index: 1 },
      { title: "第二話", image_index: 5 },
    ],
  },
};

/**
 * A gallery that cleared its chapters on purpose, and still has Stash's rows.
 *
 * The empty array is the whole point of it: a list this plugin wrote may be empty
 * — that is what "these chapters were removed" looks like — and it is read as a
 * list that is *there*. A tab that treated it as absent would offer to import over
 * the gallery's own answer without asking, which is the one thing an import must
 * not do.
 */
const CLEARED_CHAPTERS = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
  gallery: {
    id: "35",
    custom_fields: {
      "plugin.mangaTools.chapters": JSON.stringify({ v: 1, chapters: [] }),
    },
    chapters: [{ title: "第一話", image_index: 1 }],
  },
};

/**
 * And one whose only Stash chapter points past the end of its own images.
 *
 * Translating it gives nothing — the row is dropped rather than clamped — so there
 * is nothing to bring over even though Stash has a chapter to show. Which is the
 * difference between "Stash has chapters" and "Stash has chapters this gallery can
 * use", and only the second is a reason to offer an import.
 */
const OUT_OF_RANGE_CHAPTERS = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
  gallery: {
    id: "37",
    custom_fields: {},
    chapters: [{ title: "gone", image_index: 99 }],
  },
};

// In place before the bundle loads, not merely before the sections run: the tools
// half's first refresh happens as it loads, and that refresh is what tells the reader
// which galleries are manga. A fixture registered afterwards would be a gallery the
// store had never heard of.
state.galleries["7"] = GALLERY_WITH_A_SPREAD;
state.galleries["8"] = PLAIN_GALLERY;
state.galleries["11"] = TWO_PAGES;
state.galleries["12"] = ONE_PAGE;
state.galleries["13"] = STAMPED_GALLERY;
// Registered so it is a gallery this plugin reads, with the failure injected instead
// of its answer — which is what that section is about.
state.galleries["9"] = PLAIN_GALLERY;
state.galleries["21"] = ORDER_GALLERY;
state.galleries["22"] = ORDER_GALLERY;
state.galleries["23"] = ORDER_GALLERY;
state.galleries["31"] = OWN_CHAPTERS;
state.galleries["32"] = STASH_CHAPTERS;
state.galleries["35"] = CLEARED_CHAPTERS;
// For the sections that edit: their writes are applied by the client, so a fixture
// they shared with a section that only *reads* chapters would be a fixture that
// changed under it.
state.galleries["38"] = {
  ...OWN_CHAPTERS,
  gallery: {
    ...OWN_CHAPTERS.gallery,
    id: "38",
    custom_fields: { ...OWN_CHAPTERS.gallery.custom_fields },
  },
};
state.galleries["39"] = {
  ...OWN_CHAPTERS,
  gallery: {
    ...OWN_CHAPTERS.gallery,
    id: "39",
    custom_fields: { ...OWN_CHAPTERS.gallery.custom_fields },
  },
};
state.galleries["37"] = OUT_OF_RANGE_CHAPTERS;
/** Two named images, for the fields Stash's lightbox names an image by */
const NAMED_GALLERY = {
  images: [
    named("901", "第二話", "/manga/author/002.jpg"),
    named("902", "", "/manga/author/003.jpg"),
  ],
};

state.galleries["41"] = OWN_CHAPTERS;
state.galleries["42"] = OWN_CHAPTERS;
state.galleries["43"] = OWN_CHAPTERS;
state.galleries["33"] = OWN_CHAPTERS;
state.galleries["34"] = OWN_CHAPTERS;
state.galleries["51"] = NAMED_GALLERY;
// For the section about a lightbox whose pages are still being read: a gallery no
// other section has opened, since a gallery already read answers from the cache and
// there would be nothing in flight to look at.
state.galleries["53"] = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
};
// For the sections about the pairing shift, which is remembered per gallery.
state.galleries["36"] = PLAIN_GALLERY;
// A gallery this plugin has no business on: marked `manga: false`, which is what keeps
// it out of the store — and the store is what the reader half asks.
state.galleries["61"] = {
  images: numbered(CHAPTERS_VIEW),
  pathImages: numbered(CHAPTERS_PATH),
  manga: false,
  gallery: {
    id: "61",
    custom_fields: {},
    chapters: [{ title: "第一話", image_index: 1 }],
  },
};

require(BUNDLE);

const NR = global.window.MangaReader;
/** The tools half's namespace, which the chapter import reaches its write through */
const NS = global.window.MangaTools;

async function startReader(options) {
  const {
    galleryId = "7",
    at = 1,
    total = 5,
    on = true,
    language = null,
    counterText,
    search = "",
    ids = null,
    mode = null,
    // A page with no gallery, or a gallery this plugin does not touch, has no
    // switch of ours — and a section about that would be asking for the wrong thing.
    expectSwitch = true,
  } = options || {};

  for (const child of dom.body.children.slice()) child.remove();
  dom.window.location.pathname = galleryId ? `/galleries/${galleryId}` : "/";
  // Cleared every time, not left as the last test set it: the order is read from
  // the URL as the gallery is fetched, so a leftover would be a section reading
  // another section's sort.
  dom.window.location.search = search;
  state.language = language;
  dom.flush();

  // What the carousel is showing, unless the section says otherwise: the gallery's
  // own images, which is what Stash would have loaded. The reader finds its place by
  // matching that image against its list, so any order of the same images does.
  const showing =
    ids ||
    (state.galleries[galleryId]
      ? (
          state.galleries[galleryId].pathImages ||
          state.galleries[galleryId].images ||
          []
        ).map((i) => String(i.id))
      : null);

  const box = buildLightbox(at, total, showing);
  // Some lightboxes have no counter at all — Stash draws it only for more than one
  // image — and that has to be true before the mode is turned on, not after.
  if (counterText !== undefined) box.counter.textContent = counterText;
  const popover = box.openPopover();
  dom.flush();

  // The pairing is the reader's own now, in its own header — see chrome.ts. It is
  // there for a marked gallery whether or not a pair is on, because the mode is not
  // what puts the reader on a gallery: the mark is.
  await settle();
  // Which of the three ways the pages are laid out. `on` still says whether they are
  // paired, because that is what most of the suite means by it; the mode is named
  // when a section wants the column, which cannot be reached through `on` at all.
  const wanted = {
    single: "#manga-reader-single-page",
    double: "#manga-reader-double-page",
    scroll: "#manga-reader-scroll",
  }[mode || (on ? "double" : "single")];
  const input = box.lightbox.querySelector(wanted);
  if (expectSwitch) {
    assert.ok(
      input,
      "the pairing should be in the lightbox's own options menu"
    );
  }

  // Whether to press it, read off the control: a press on the half already chosen
  // says nothing at all, so doing it unconditionally would be a section turning the
  // mode on twice and calling the second one a change.
  if (input && !input.classList.contains("is-on")) dom.click(input);
  await settle();

  return { box, input, popover };
}

function stopReader(box) {
  box.close();
  dom.flush();
}

function stopTab(tab) {
  tab.close();
  dom.window.location.pathname = "/";
  dom.flush();
}

module.exports = {
  stopTab,
  stopReader,
  startReader,
  assert,
  fs,
  path,
  BUNDLE,
  dom,
  state,
  mutations,
  settingsWrites,
  client,
  imageQueries,
  shown,
  patched,
  globalListeners,
  realConsoleError,
  loggedErrors,
  failures,
  runSection,
  settle,
  errorsSince,
  page,
  wide,
  image,
  stamped,
  shape,
  named,
  pagesOf,
  buildLightbox,
  mountBridge,
  buildChaptersTab,
  chapterMenu,
  chapterRanges,
  savedReaderSettings,
  storedSettings,
  settingsWith,
  drawnRows,
  turn,
  container,
  drawn,
  press,
  GALLERY_WITH_A_SPREAD,
  PLAIN_GALLERY,
  TWO_PAGES,
  ONE_PAGE,
  STAMPED_GALLERY,
  ORDER_GALLERY,
  CHAPTERS_VIEW,
  CHAPTERS_PATH,
  numbered,
  OWN_CHAPTERS,
  STASH_CHAPTERS,
  CLEARED_CHAPTERS,
  OUT_OF_RANGE_CHAPTERS,
  NAMED_GALLERY,
  NR,
  NS,
};
