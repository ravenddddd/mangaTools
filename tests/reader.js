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
const path = require("node:path");
const { createDom } = require("./dom.js");

const BUNDLE = path.join(__dirname, "..", "dist", "mangaTools.js");

// ── The environment the bundle loads into ──────────────────────────

const dom = createDom();

/** What the fake Stash answers with, per gallery, and what it was asked. */
const state = {
  language: null,
  galleries: {},
  queries: [],
  failing: false,
};

const mutations = [];
const client = {
  query: ({ query, variables, fetchPolicy }) => {
    state.queries.push({ query: String(query), variables, fetchPolicy });
    if (state.failing) return Promise.reject(new Error("no answer from Stash"));

    // The tools half's gallery map, told apart by having no variables at all: it bakes
    // its filter into the document, and every query the reader makes names a gallery.
    // Its answer is what tells this plugin a gallery is manga — see markedInStore —
    // so the worlds here are the marked ones, and a fixture marked `manga: false` is
    // the gallery this plugin is meant to leave alone.
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
    return Promise.resolve({
      data: {
        configuration: { interface: { language: state.language } },
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
    });
  },
  // Stash's writes, recorded rather than performed: this plugin is not allowed to
  // make any — see the note on never touching Stash's own data — and a stub that
  // simply had no mutate would hide a write that tried.
  mutate: (options) => {
    mutations.push(options);
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
 */
const chapterMenu = (box) =>
  [...box.lightbox.querySelectorAll(".manga-reader-menu-item")].map(
    (item) => item.textContent
  );

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
 * The menu has to show 第二話 before 第一話, which is what "the list is in the
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

dom.window.location.pathname = "/";

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

// ── Sections ───────────────────────────────────────────────────────

async function main() {
  // The tools half's gallery map is fetched as the bundle loads, and it is what tells
  // the reader which galleries are manga — so nothing here is marked until its answer
  // lands, which is a promise and therefore after a turn.
  await settle();

  await runSection("the plugin loads and watches for a lightbox", () => {
    assert.ok(NR, "the bundle should publish window.MangaReader");
    assert.strictEqual(typeof NR.layout, "function");
    assert.strictEqual(
      dom.observerCount(),
      1,
      "one observer on the document, which is how the lightbox is found"
    );
    assert.strictEqual(
      (dom.window.listeners.keydown || []).length,
      1,
      "and one key listener, on the window, so it runs before Stash's own"
    );
  });

  await runSection("settings are parsed defensively", () => {
    const defaults = {
      doublePage: false,
      coverAlone: true,
      detectSpreads: true,
      fadeMs: 140,
    };

    assert.deepStrictEqual(
      NR.parseSettings(null),
      defaults,
      "a browser that has never been asked gets the defaults — the mode off"
    );
    assert.deepStrictEqual(
      NR.parseSettings('{"doublePage":true}'),
      { ...defaults, doublePage: true },
      "a stored object may be missing a field: the rest are defaults"
    );
    assert.deepStrictEqual(
      NR.parseSettings('{"doublePage":"yes"}'),
      defaults,
      "and a value of the wrong type is not a setting"
    );
    assert.deepStrictEqual(
      NR.parseSettings("not json"),
      defaults,
      "nor is something else's value under our key"
    );

    // The fade is the one setting that is a number, and it ends up as a duration in
    // a Web Animation: something that is not a finite number of milliseconds would
    // be a screen that never arrives, so it is checked rather than trusted.
    const fade = (raw) => NR.parseSettings(raw).fadeMs;
    assert.strictEqual(fade('{"fadeMs":250}'), 250, "a number is a setting");
    assert.strictEqual(
      fade('{"fadeMs":0}'),
      0,
      "and 0 is one — no fade at all"
    );
    assert.strictEqual(
      fade('{"fadeMs":-40}'),
      0,
      "a negative one is clamped, not obeyed"
    );
    assert.strictEqual(
      fade('{"fadeMs":99999}'),
      NR.FADE_MAX_MS,
      "and an absurd one is capped at what the slider offers"
    );
    assert.strictEqual(
      fade('{"fadeMs":"140"}'),
      140,
      "a string is not a number"
    );
    assert.strictEqual(fade('{"fadeMs":null}'), 140, "nor is null");
  });

  await runSection("the lightbox header is read as a position", () => {
    assert.deepStrictEqual(NR.parseIndicator("3 / 12"), {
      current: 3,
      total: 12,
    });
    assert.deepStrictEqual(
      NR.parseIndicator(" 1 / 2 "),
      { current: 1, total: 2 },
      "whitespace is not part of the number"
    );
    assert.strictEqual(NR.parseIndicator(""), null, "no counter at all");
    assert.strictEqual(NR.parseIndicator("Chapter 3"), null);
    assert.strictEqual(
      NR.parseIndicator("0 / 12"),
      null,
      "a page number out of range is not a position to draw from"
    );
    assert.strictEqual(NR.parseIndicator("13 / 12"), null);
  });

  await runSection("the gallery is read out of the path", () => {
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7"), "7");
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7/images"), "7");
    assert.strictEqual(
      NR.galleryIdFromPath("/galleries"),
      null,
      "the gallery list is not one gallery"
    );
    assert.strictEqual(NR.galleryIdFromPath("/scenes/7"), null);
    assert.strictEqual(
      NR.galleryIdFromPath("/images/7"),
      null,
      "an image's own page has no gallery to pair"
    );
  });

  await runSection("what counts as a spread", () => {
    assert.strictEqual(NR.isWideSpreadPage(page("tall")), false);
    assert.strictEqual(NR.isWideSpreadPage(wide("w")), true);
    assert.strictEqual(
      NR.isWideSpreadPage(page("square", 1000, 1000)),
      false,
      "the ratio is strictly greater than one"
    );
    assert.strictEqual(
      NR.isWideSpreadPage(page("unknown", 0, 0)),
      false,
      "a page with no size reported is not evidence of a spread"
    );
  });

  await runSection("the cover, and the pairs that follow it", () => {
    assert.deepStrictEqual(NR.layout([]), []);

    assert.deepStrictEqual(shape(NR.layout(pagesOf("a"))), ["a"]);

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"))),
      ["a", "b+c", "d+e"],
      "the cover stands alone and the rest pair up"
    );

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"), { coverAlone: false })),
      ["a+b", "c+d", "e"],
      "without a cover to respect, the odd page is the last one"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout(pagesOf("a", "b", "c", "d", "e"), {
          coverAlone: true,
          offset: 1,
        })
      ),
      ["a", "b", "c+d", "e"],
      "the offset strands one more page, which puts a wrongly-grouped gallery's " +
        "pairs back"
    );

    // The layout must not touch what it was given: the page list is a fetched
    // answer that is kept for the rest of the session.
    const pages = pagesOf("a", "b");
    const before = JSON.stringify(pages);
    NR.layout(pages);
    assert.strictEqual(JSON.stringify(pages), before, "and it is not mutated");
  });

  await runSection("a page that spans two of them", () => {
    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c"), page("d")], {
          coverAlone: false,
        })
      ),
      ["a+b", "w", "c+d"],
      "a spread takes a screen of its own, and the pairing carries on after it"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), wide("w"), page("b"), page("c")], {
          coverAlone: false,
        })
      ),
      ["a", "w", "b+c"],
      "a page whose neighbour is a spread stands alone — the case that leaves a " +
        "single page in the middle of a book. If the pairing after it is then " +
        "wrong for a book, the offset is what puts it right"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c")], {
          coverAlone: false,
          detectSpreads: false,
        })
      ),
      ["a+b", "w+c"],
      "with the detection off a wide page is just a page"
    );

    assert.deepStrictEqual(
      shape(NR.layout([wide("x"), wide("y")], { coverAlone: false })),
      ["x", "y"],
      "two spreads in a row are two screens"
    );
  });

  await runSection("where a screen starts, and how far to move", () => {
    const screens = NR.layout(pagesOf("a", "b", "c", "d", "e"));

    screens.forEach((screen, at) => {
      screen.pages.forEach((_page, offset) => {
        assert.strictEqual(NR.screenAt(screens, screen.start + offset), at);
      });
    });
    assert.deepStrictEqual(
      screens.flatMap((s) => s.pages.map((p) => p.id)),
      ["a", "b", "c", "d", "e"],
      "every page is on exactly one screen, in order"
    );
    assert.strictEqual(NR.screenAt(screens, 99), -1);
    assert.strictEqual(NR.screenAt([], 0), -1);

    assert.strictEqual(NR.stepsToAdjacent(screens, 0, 1), 1);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 1, 1),
      2,
      "forward from the first page of a pair skips both its pages"
    );
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 2, 1),
      1,
      "and from the second page of one only moves on by that one"
    );
    assert.strictEqual(NR.stepsToAdjacent(screens, 0, -1), 0);
    assert.strictEqual(NR.stepsToAdjacent(screens, 4, 1), 0);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 4, -1),
      -3,
      "backwards lands on the first page of the screen behind, which from the " +
        "last pair is three pages away"
    );
  });

  // ── The reader itself ────────────────────────────────────────────
  //
  // Every section below puts the page back to a known state before it does
  // anything, and that is not tidiness: one failing assertion would otherwise leave
  // a lightbox behind with the mode still on, and every section after it would be
  // testing that instead of what it says. A test that fails should fail alone.

  /**
   * A lightbox on a gallery page, with this plugin's switch set where the section
   * needs it, and the pages fetched.
   *
   * The mode is set by *using the switch*, which is the only way to change it from
   * outside the bundle — the plugin's copy of the settings is module state, and
   * writing localStorage behind its back would be testing a state it never reads.
   */
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

    // The switch is the reader's own now, in its own header — see chrome.ts. It is
    // there for a marked gallery whether or not the mode is on, because the mode is
    // not what puts the reader on a gallery: the mark is.
    await settle();
    const input = box.lightbox.querySelector("#manga-reader-double-page");
    if (expectSwitch) {
      assert.ok(
        input,
        "the switch should be in the lightbox's own options menu"
      );
    }

    if (input && input.checked !== on) {
      // Only when it would be a change: a browser does not fire `change` for a value
      // that was already that value, and the reader re-lays the pages when it hears
      // one — which would be a redraw this section never asked for.
      input.checked = on;
      input.dispatch("change");
    }
    await settle();

    return { box, input, popover };
  }

  /**
   * A gallery of five ordinary pages: screens are [1] [2+3] [4+5], so a pair is
   * something the arrows and the offset can be seen against. Gallery 8 in these
   * fixtures has a spread in it, which changes what the pairing does.
   */
  /** Closes the lightbox and lets the reader notice */
  function stopReader(box) {
    box.close();
    dom.flush();
  }

  /** Puts the chapters tab away, the way leaving the page would */
  function stopTab(tab) {
    tab.close();
    dom.window.location.pathname = "/";
    dom.flush();
  }

  /**
   * The switch is one page or two now, not draw or not. What decides whether a gallery
   * is this plugin's to draw is the mark on the gallery — see markedInStore — so a
   * reader with the switch off gets single pages rather than Stash's lightbox.
   */
  await runSection(
    "a marked gallery is drawn with the switch off too",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: false });

      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "one page at a time, since the pairing is off"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "and the reader is drawing in the lightbox either way"
      );

      stopReader(box);
    }
  );

  await runSection("the switches are in the reader's own header", async () => {
    const { box, input } = await startReader({ on: false });

    assert.strictEqual(input.type, "checkbox");
    assert.strictEqual(
      input.checked,
      false,
      "off, because the mode is off — the switch shows the state, it does not set it"
    );

    // In the reader's own header, which is the only home it has: the one that used
    // to be injected into Stash's options popover was inside the very header the
    // reader hides, so a reader could turn the reader off from a menu it could not
    // see it had.
    const inChrome = (node) => {
      for (let at = node; at; at = at.parentNode) {
        if (at.classList?.contains("manga-reader-chrome")) {
          return true;
        }
      }
      return false;
    };
    assert.strictEqual(
      inChrome(input),
      true,
      "in the reader's own header, not in somebody else's menu"
    );
    assert.strictEqual(
      box.lightbox.querySelector(".manga-reader-chrome .form-check") !== null,
      true,
      "and in Stash's own markup, so it reads as one of its settings"
    );

    stopReader(box);
  });

  await runSection(
    "the switch speaks the interface language once it is known",
    async () => {
      // The language comes from Stash's answer to the gallery query, so the wording
      // is right from the *second* time the menu is opened — which is all it can be,
      // and worth saying out loud. A gallery no earlier section has opened, since a
      // gallery already read is remembered and would not be asked about again.
      const { box } = await startReader({
        galleryId: "51",
        total: 2,
        on: true,
        language: "zh-TW",
      });

      const label = box.lightbox.querySelector(
        ".manga-reader-chrome .form-check-label"
      );
      assert.strictEqual(
        label.textContent,
        "雙頁閱讀",
        "a traditional-Chinese interface reads the traditional wording"
      );

      stopReader(box);
    }
  );

  await runSection(
    "turning it on draws the pages the lightbox is showing",
    async () => {
      // Read whether or not the mode is on — the chapters go to the lightbox either
      // way — so by the time this section runs the gallery has been read already, and
      // what is worth pinning is that turning the mode on does not ask again.
      const before = imageQueries().length;
      const { box } = await startReader({ on: true });

      assert.deepStrictEqual(
        imageQueries().slice(before),
        [],
        "a gallery already read is not asked for again when the mode is turned on"
      );
      assert.strictEqual(
        imageQueries()[0].fetchPolicy,
        "no-cache",
        "…and what was read is not written into Apollo's cache, where the lightbox's " +
          "own query lives"
      );

      const drawnBox = container();
      assert.ok(drawnBox, "and a container to draw them in");
      assert.strictEqual(
        drawnBox.parentNode,
        box.display,
        "inside the display area"
      );
      assert.ok(
        box.display.children.indexOf(drawnBox) >
          box.display.children.indexOf(box.carousel),
        "beside Stash's carousel rather than in place of it — which is what keeps " +
          "React free to re-render its own subtree without ours going with it. " +
          "Compared by position rather than by an index into markup this plugin " +
          "does not own, since Stash's chevrons sit in that row too"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "with the class that hides the carousel"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the cover alone, because that is the screen page 1 is on"
      );
      assert.ok(
        dom.preloaded.includes("/image/102/image"),
        "and the pages of the next screen are warmed, so a turn does not wait"
      );

      // Every way of turning ends in the same place: this is a click on Stash's own
      // chevron, and the reader's own position is what moves.
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "page 2 stands alone: its neighbour is the spread, and one page is not the " +
          "left half of a screen"
      );

      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/103/image"],
        "the spread takes a screen of its own"
      );

      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "and the pairing carries on after it — in reading order, which the " +
          "stylesheet reverses for a right-to-left book"
      );

      stopReader(box);
    }
  );

  await runSection(
    "a screen goes up when both of its images are there",
    async () => {
      const { box } = await startReader({ on: true });
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "precondition: the cover is up"
      );

      // Held from here: the next turn's images are coming, and are not here.
      dom.holdImages();
      turn(box, 3);
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the reader keeps the screen it has rather than showing one page of the next — " +
          "two images that arrive apart read as a flicker, not as a page"
      );

      dom.settleImages();
      await settle();
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "and the pair goes up together once both are ready"
      );

      stopReader(box);
    }
  );

  await runSection(
    "a slow image does not hold the screen forever",
    async () => {
      const { box } = await startReader({ on: true });
      dom.holdImages();
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "precondition: waiting, with the previous screen still up"
      );

      // The budget is the plugin's own, published for this: the wait ends when it
      // runs out, not when the bytes turn up. A page that never arrives must not be
      // able to leave the reader on a page they have already turned.
      await new Promise((resolve) =>
        setTimeout(resolve, NR.REVEAL_BUDGET_MS + 50)
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "past the budget, whatever has arrived is shown"
      );

      dom.settleImages();
      stopReader(box);
    }
  );

  await runSection(
    "a screen the reader has left is never shown late",
    async () => {
      const { box } = await startReader({ on: true });

      dom.holdImages();
      turn(box);
      turn(box);
      turn(box);

      dom.settleImages();
      await settle();
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "only the screen the reader is on: the one they turned past does not land on " +
          "top of it when its images finally arrive"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the images are asked for the way Stash asks for them",
    async () => {
      const { box } = await startReader({
        galleryId: "13",
        on: true,
        total: 2,
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/501/image?t=1700000001"],
        "the relative path with the version stamp the API published — which is what " +
          "makes it the same cache entry Stash's own lightbox fills, rather than a " +
          "second fetch of an image the browser already has"
      );
      assert.ok(
        dom.preloaded.includes("/image/502/image?t=1700000002"),
        "and the page being warmed is asked for with its own stamp"
      );

      stopReader(box);
    }
  );

  /**
   * The order is guessed from the URL, and the URL is not always right — Stash's
   * gallery page keeps its inner tabs in component state, so a lightbox opened
   * from the Chapters tab is path-ordered while the address bar still says
   * `?sortby=title` from the Images tab. A wrong guess pairs the wrong pages, so
   * it is checked against the image actually on screen and thrown away if it does
   * not match.
   */
  /**
   * The place is found by *which image* is showing, not by counting or by trusting the
   * order a URL named. The same image is the same image in any order, so this is the
   * one thing that cannot be wrong — and the reason nothing here has to agree with
   * Stash about how a gallery is sorted.
   */
  await runSection("the place is found by which image is showing", async () => {
    const before = imageQueries().length;
    const { box } = await startReader({
      galleryId: "41",
      on: true,
      total: 8,
      // The URL names title order while the carousel is showing path order — the case
      // that used to cost a second fetch, and now costs nothing, because where the
      // reader is has nothing to do with either order.
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_PATH.map(String),
    });

    assert.deepStrictEqual(
      imageQueries()
        .slice(before)
        .map((q) => q.variables.sort),
      ["title"],
      "the list is fetched in the order the URL names, and that is all it is used for"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "and what is drawn is the screen around the image the lightbox is showing"
    );
    stopReader(box);

    // The same gallery, the other way round: the pages drawn follow the carousel.
    const again = await startReader({
      galleryId: "42",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    assert.deepStrictEqual(
      drawn(),
      ["/image/701/image"],
      "whichever image it is showing is the one whose screen is drawn"
    );
    stopReader(again.box);
  });

  /**
   * The arrows move the *reader* now, not the lightbox: a press is a screen, and
   * nothing is sent anywhere. That is what taking the lightbox over bought — the old
   * shape was a press aimed at Stash's index, waiting for its header to say the press
   * had landed and retrying if it did not, with the whole errand to hold it together.
   */
  await runSection(
    "the arrows move by screen, and drive nothing else",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });

      // What the plugin sends the lightbox, as opposed to what it consumes. It dispatches
      // nothing at all now; this is the listener that would see it if it did.
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const forwards = press("ArrowRight");
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "a press moves by a screen, not by a page"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "and the lightbox is not driven to get there: its pages are this plugin's"
      );
      assert.strictEqual(
        forwards.defaultPrevented,
        true,
        "and the press is consumed, so Stash's own handler does not take it too"
      );
      assert.strictEqual(forwards.propagationStopped, true);

      sent.length = 0;
      press("ArrowLeft");
      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "backwards is a screen too, back to the cover"
      );
      assert.deepStrictEqual(sent, [], "and still nothing is sent");

      // The end of the book is left to Stash, which does nothing with it either:
      // consuming the press would only be a lie about having moved.
      turn(box, 3);
      sent.length = 0;
      const pastTheEnd = press("ArrowRight");
      assert.deepStrictEqual(sent, [], "nothing to move on to");
      assert.strictEqual(pastTheEnd.defaultPrevented, false);

      // A key press this plugin did not make passes straight through to the lightbox —
      // if its own handler took these, every step would double.
      sent.length = 0;
      dom.document.dispatchEvent(
        dom.makeEvent("keydown", { key: "ArrowRight", isTrusted: false })
      );
      assert.deepStrictEqual(
        sent,
        ["ArrowRight"],
        "an untrusted press is not ours"
      );

      stopReader(box);
    }
  );

  await runSection("a change elsewhere does not restart the wait", async () => {
    // Held from before anything is drawn, which is when the two questions differ:
    // with no previous screen to keep, the container is empty while the first one
    // is on its way — and "empty" and "nothing drawn yet" are not the same thing.
    dom.holdImages();
    const { box } = await startReader({ on: true });

    const before = dom.imagesAskedFor();
    // Stash keeps changing the page while the screen is on its way: its counter is
    // rewritten, its slides swap, the menu that was just open closes. Any of those
    // is a DOM change, and each used to be read as "nothing has been drawn".
    dom.flush();
    dom.flush();
    await settle();

    assert.strictEqual(
      dom.imagesAskedFor() - before,
      0,
      "the screen is asked for once, however much the page changes while it loads"
    );

    dom.settleImages();
    await settle();
    assert.deepStrictEqual(
      drawn(),
      ["/image/101/image"],
      "and it goes up when its image is there"
    );

    stopReader(box);
  });

  await runSection(
    "a focused field does not take the arrows from the reader",
    async () => {
      const { box, input } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const keyTo = (target, key) =>
        dom.dispatchTo(
          target,
          dom.makeEvent("keydown", { key, isTrusted: true })
        );

      // The options menu is open and the focus is on the switch the reader just
      // clicked — a checkbox. The arrows do nothing to a checkbox (space toggles it),
      // so a press here is still the reader's. Treating every `<input>` as a field
      // that owns the arrows meant these went past the reader to Stash's own handler,
      // a page at a time: "it only happens while the menu is open".
      turn(box);
      sent.length = 0;
      const onSwitch = keyTo(input, "ArrowRight");
      assert.strictEqual(
        onSwitch.defaultPrevented,
        true,
        "a press with the switch focused is the reader's"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/404/image", "/image/405/image"],
        "…and it turns the reader by a screen like any other"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…without sending anything to the lightbox, since nothing needs it to move"
      );

      // A text field is a different matter: the arrows are its own, and the plugin
      // must not take them from it.
      const field = dom.makeElement("input");
      field.type = "text";
      const inField = keyTo(field, "ArrowRight");
      assert.strictEqual(
        inField.defaultPrevented,
        false,
        "a text field keeps its own arrow keys"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…and nothing is sent for it either: the lightbox is not what moves"
      );

      stopReader(box);
    }
  );

  await runSection(
    "Stash's own chevrons turn a screen, not a page",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      // The pair 402+403 is the second screen, so a click on Stash's chevron is a turn
      // — where Stash's own handler would move one page, which is the same screen and
      // would look like nothing happening.
      sent.length = 0;
      const click = dom.click(box.navRight);
      assert.strictEqual(
        click.defaultPrevented,
        true,
        "the click is the reader's"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "…and Stash's own button never sees it"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "and it turned a screen, not a page"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…without driving the lightbox to do it"
      );

      sent.length = 0;
      const back = dom.click(box.navLeft);
      assert.strictEqual(
        back.propagationStopped,
        true,
        "the other chevron is the same"
      );
      assert.deepStrictEqual(sent, [], "and it drives nothing either");

      stopReader(box);
    }
  );

  await runSection(
    "a click on a page turns it, as Stash's own does",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const page = () => container().children[0].children[0];
      // As the browser would report it: the width of the image on screen, which is
      // what tells the two halves apart. Set per draw, because a draw replaces the
      // images.
      const laidOut = () => {
        page().offsetWidth = 100;
      };

      laidOut();
      sent.length = 0;
      const forward = dom.click(page(), { offsetX: 80 });
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "the right half of a page goes forward, like Stash's own image click"
      );
      assert.strictEqual(forward.propagationStopped, true);
      assert.deepStrictEqual(
        sent,
        [],
        "and the lightbox is not driven to do it"
      );

      laidOut();
      sent.length = 0;
      dom.click(page(), { offsetX: 10 });
      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "and the left half goes back"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the space around the pages still closes the lightbox",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const keys = [];
      dom.document.addEventListener("keydown", (event) => keys.push(event.key));

      // Stash closes its lightbox when a click reaches the slide the pages sit in
      // (Lightbox.tsx's handleClose), and every bit of that slide is behind this
      // plugin's container — so the click is turned back into what Stash would have
      // done with it, which is Escape. What the harness can see is the ask: its
      // lightbox has no Escape of its own to act on it.
      const click = dom.click(container());
      assert.deepStrictEqual(
        keys,
        ["Escape"],
        "a click on the letterbox asks Stash to close"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "and nothing else sees it"
      );

      stopReader(box);
    }
  );

  /**
   * In fullscreen, a click on the space around the pages does nothing.
   *
   * The click that closes the lightbox everywhere else is a click on the margin of a
   * book, and a reader who has filled the screen with one and then clicks its margin
   * has asked for nothing — being handed their browser back is not nothing. Leaving
   * fullscreen is the header's button, or Escape: deliberately not the thing a reader
   * hits while reading.
   */
  await runSection(
    "while fullscreen, a click on the space around the pages does nothing",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const keys = [];
      dom.document.addEventListener("keydown", (event) => keys.push(event.key));

      dom.click(box.lightbox.querySelector(".manga-reader-fullscreen"));
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "the header's button fills the screen with the lightbox"
      );

      // The letterbox: the container itself, not a page inside it.
      const click = dom.click(container());
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "and a click on the space around the pages leaves the screen as it is"
      );
      assert.deepStrictEqual(
        keys,
        [],
        "and closes nothing either: it is the margin of a book, not a way out of one"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "and nothing else sees it"
      );

      dom.click(container());
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "the next one is no different — leaving fullscreen is the button, or Escape"
      );

      // Out of fullscreen, the same click is the click it has always been.
      dom.click(box.lightbox.querySelector(".manga-reader-fullscreen"));
      assert.strictEqual(
        dom.document.fullscreenElement,
        null,
        "the button gives the screen back"
      );
      dom.click(container());
      assert.deepStrictEqual(
        keys,
        ["Escape"],
        "and with the screen given back, the letterbox closes the lightbox as it did"
      );

      stopReader(box);
    }
  );

  /**
   * Back closes the lightbox.
   *
   * Stash's lightbox lives in its own state and not in the route: nothing about a
   * page change takes it away, so pressing Back leaves the reader looking at the
   * pages of a gallery they are no longer on. What the route does give is the event
   * that says the page changed, and a page change under an open lightbox is that
   * lightbox's cue to close — through the same Escape everything else closes it by.
   */
  await runSection("Back closes the lightbox", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });
    const keys = [];
    dom.document.addEventListener("keydown", (event) => keys.push(event.key));

    const relocate = (pathname) => {
      for (const fn of globalListeners["stash:location"] || []) {
        fn({ detail: { data: { location: { pathname } } } });
      }
    };

    relocate("/galleries/8");
    assert.deepStrictEqual(
      keys,
      [],
      "the page as it already stands is not a move — Stash reports it on mount too"
    );

    relocate("/galleries/8");
    assert.deepStrictEqual(
      keys,
      [],
      "and neither is a list re-sorted behind the lightbox, which is a change of " +
        "query rather than of page"
    );

    relocate("/galleries");
    assert.deepStrictEqual(
      keys,
      ["Escape"],
      "while leaving the page closes the lightbox, the way Escape does"
    );

    stopReader(box);
  });

  await runSection("a screen arrives rather than snapping in", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    const spread = container();
    assert.strictEqual(
      spread.animations.length,
      1,
      "the first screen fades in as it arrives"
    );
    assert.deepStrictEqual(
      spread.animations[0].keyframes,
      [{ opacity: 0 }, { opacity: 1 }],
      "…from nothing to what it is: a fade, not a slide or a scale"
    );

    // Counted, not compared against one: the animations are the container's own
    // history, and the container outlives the screens drawn into it.
    const before = spread.animations.length;
    turn(box);
    assert.strictEqual(
      spread.animations.length,
      before + 1,
      "and every screen after it does the same"
    );

    // A reader who has asked their system for less motion gets the page, not the
    // dissolve — decoration does not get to overrule that.
    dom.prefersReducedMotion(true);
    const quiet = spread.animations.length;
    turn(box, 2);
    dom.flush();
    assert.strictEqual(
      spread.animations.length,
      quiet,
      "nothing is animated when reduced motion is on"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/404/image", "/image/405/image"],
      "…though the screen itself is still drawn"
    );
    dom.prefersReducedMotion(false);

    stopReader(box);
  });

  await runSection(
    "the fade is a setting, in the menu beside the switch",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });

      const fade = box.lightbox.querySelector("#manga-reader-fade");
      assert.ok(fade, "the options menu offers the fade length as a slider");
      assert.strictEqual(
        fade.type,
        "range",
        "a range, so it can be found by dragging"
      );
      assert.strictEqual(
        fade.max,
        "1000",
        "and it reaches somewhere unmistakable"
      );
      assert.strictEqual(fade.value, "140", "starting where the default is");
      // The value is shown beside the label — the readout inside the label is where
      // the number lives, so it is readable from the menu without a render.
      assert.strictEqual(
        fade.parentNode.querySelector(".manga-reader-readout").textContent,
        "140 ms",
        "and showing what it is set to, beside it"
      );

      // Dragging it changes what the next screen does, which is the only way to tell
      // that this setting is connected to anything.
      const before = container().animations.length;
      fade.value = "600";
      fade.dispatch("input");
      turn(box);

      const animations = container().animations;
      assert.strictEqual(
        animations.length,
        before + 1,
        "a turn after the drag still fades"
      );
      assert.strictEqual(
        animations[animations.length - 1].options.duration,
        600,
        "…for as long as the slider says"
      );

      // Zero is a setting too, and it means what it says: the screen arrives at once.
      fade.value = "0";
      fade.dispatch("input");
      box.move(4);
      dom.flush();
      assert.strictEqual(
        container().animations.length,
        before + 1,
        "and 0 draws the screen with no animation at all"
      );

      // Put back: the setting is remembered across sections, and one left at 0 would
      // be changing what every section after this one reads.
      fade.value = "140";
      fade.dispatch("input");

      stopReader(box);
    }
  );

  await runSection("the offset key re-pairs the gallery", async () => {
    const { box } = await startReader({ galleryId: "36", on: true });

    // On the second screen, which is where the two layouts differ: without the offset
    // its screen is 2+3, and with it page 2 stands alone.
    turn(box);
    const before = drawn();
    assert.deepStrictEqual(before, ["/image/402/image", "/image/403/image"]);

    press("o");
    assert.deepStrictEqual(
      drawn(),
      ["/image/402/image"],
      "O shifts the pairing by one page and redraws — the escape hatch for a page " +
        "that was taken for a spread and was not one"
    );
    assert.strictEqual(
      box.lightbox.querySelector("#manga-reader-offset").checked,
      true,
      "and the switch in the options menu says so, because both routes go through " +
        "the one place that sets it"
    );

    press("o");
    assert.deepStrictEqual(drawn(), before, "and shifts it back");

    stopReader(box);
  });

  await runSection(
    "the offset is a switch, and is remembered for the gallery",
    async () => {
      const { box } = await startReader({ galleryId: "36", on: true });

      const offsetSwitch = box.lightbox.querySelector("#manga-reader-offset");
      assert.ok(
        offsetSwitch,
        "the options menu offers the offset while a gallery is in hand"
      );
      assert.strictEqual(
        offsetSwitch.checked,
        false,
        "and it starts unshifted"
      );

      turn(box);
      offsetSwitch.checked = true;
      offsetSwitch.dispatch("change");

      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "turning it on re-pairs the gallery there and then"
      );
      assert.deepStrictEqual(
        JSON.parse(
          dom.window.localStorage.getItem("plugin.mangaTools.offsets")
        ),
        { 36: 1 },
        "and the gallery's shift is remembered, so it need not be set again"
      );

      stopReader(box);

      // Opened again — a fresh lightbox, a fresh popover — it starts where the reader
      // left it.
      const again = await startReader({ galleryId: "36", on: true });
      assert.strictEqual(
        again.box.lightbox.querySelector("#manga-reader-offset").checked,
        true,
        "the gallery opens with the shift it was given"
      );

      turn(again.box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "and with the pairing it had"
      );

      stopReader(again.box);
    }
  );

  await runSection(
    "turning the pairing off leaves one page a screen",
    async () => {
      const { box, input } = await startReader({ galleryId: "8", on: true });
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "drawing pairs first"
      );

      input.checked = false;
      input.dispatch("change");

      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "and with the pairing off the page the reader is in stands alone"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "in the same lightbox, still drawn by this plugin"
      );

      stopReader(box);
    }
  );

  await runSection("the mode is remembered for the next session", async () => {
    // Off first, so turning it on is a change — which is what a switch reports, and
    // what makes it write anything at all.
    const off = await startReader({ galleryId: "8", on: false });
    stopReader(off.box);

    const { box, input } = await startReader({ galleryId: "8", on: false });
    assert.ok(container(), "drawing either way");

    input.checked = true;
    input.dispatch("change");

    assert.deepStrictEqual(
      JSON.parse(dom.window.localStorage.getItem("plugin.mangaTools.settings")),
      { doublePage: true, coverAlone: true, detectSpreads: true, fadeMs: 140 },
      "the switch writes the setting it changed and leaves the rest alone"
    );

    stopReader(box);
  });

  await runSection(
    "a gallery Stash cannot answer for is not drawn",
    async () => {
      state.failing = true;
      const at = loggedErrors.length;

      const { box } = await startReader({
        galleryId: "9",
        on: true,
        expectSwitch: false,
      });

      assert.strictEqual(container(), null, "nothing is drawn");
      assert.ok(
        errorsSince(at).some((line) =>
          /could not read this gallery's pages/.test(line)
        ),
        "and the failure is reported rather than passed over"
      );

      state.failing = false;
      stopReader(box);
    }
  );

  /**
   * The header used to be how the reader knew where it was, so one it could not read
   * was a lightbox it must not draw over. The place comes from *which image is
   * showing* now, and the header is not read at all — so a header this plugin cannot
   * make sense of is nothing to it.
   */
  await runSection(
    "a header this plugin cannot read is not its business",
    async () => {
      const at = loggedErrors.length;
      const { box } = await startReader({ galleryId: "11", on: true });

      // A header with no counter in it: several pages, and nothing that says "N / M".
      box.counter.textContent = "1";
      dom.flush();

      assert.deepStrictEqual(
        drawn(),
        ["/image/201/image"],
        "the pages are drawn all the same"
      );
      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "and nothing is reported: the counter is not what the reader reads"
      );

      stopReader(box);
    }
  );

  /**
   * A gallery of one page: nothing to pair, and nothing wrong with it either. The
   * header's counter is drawn only when there is more than one image, which is what
   * used to make this look like markup that had changed — it is drawn now by this
   * plugin, and the page count is its own.
   */
  await runSection("a one-page gallery is drawn, and is quiet", async () => {
    const at = loggedErrors.length;
    const { box } = await startReader({
      galleryId: "12",
      counterText: "",
      on: true,
    });

    assert.deepStrictEqual(
      drawn(),
      ["/image/301/image"],
      "the one page is drawn"
    );
    assert.deepStrictEqual(
      errorsSince(at),
      [],
      "and nothing is reported: one page is not a fault"
    );

    stopReader(box);
  });

  // ── Chapters ──────────────────────────────────────────────────────

  /**
   * The rules, called directly. What a chapter is here is a name and the images
   * that are in it, and every one of these is about keeping that rather than a
   * position — Stash's own shape is the opposite, and the reason this plugin keeps
   * a list of its own at all.
   */
  await runSection(
    "what a stored chapter list is, and what it is not",
    async () => {
      const chapters = (value) => NR.parseChapters(JSON.stringify(value));

      assert.deepStrictEqual(
        chapters({
          v: 1,
          chapters: [
            { title: "開幕", images: ["703", "701"] },
            { title: "中盤", images: [705] },
          ],
        }),
        [
          { title: "開幕", images: ["703", "701"] },
          { title: "中盤", images: ["705"] },
        ],
        "a list this plugin wrote is read back, ids as strings either way they were written"
      );
      assert.deepStrictEqual(
        chapters({ v: 1, chapters: [] }),
        [],
        "an empty list is a gallery whose chapters were cleared, and draws nothing"
      );
      assert.strictEqual(
        chapters({ v: 2, chapters: [{ images: ["1"] }] }),
        null,
        "a version this build does not know is unreadable, not best-effort"
      );
      assert.strictEqual(
        NR.parseChapters(null),
        null,
        "no field at all is null"
      );
      assert.strictEqual(NR.parseChapters(""), null, "and so is an empty one");
      assert.strictEqual(
        NR.parseChapters("not json"),
        null,
        "a hand-edited value is unreadable rather than a guess"
      );
      assert.deepStrictEqual(
        chapters({
          v: 1,
          chapters: [
            { title: "x" },
            { title: "kept", images: [] },
            { title: "mixed", images: ["9", null, "10"] },
            "nonsense",
            null,
          ],
        }),
        [
          { title: "kept", images: [] },
          { title: "mixed", images: ["9", "10"] },
        ],
        "a chapter is kept as far as it can be read, and one that is not a chapter is not"
      );

      // Stash's own numbers, expanded against the order they count in. Stash gives
      // each chapter a start and nothing else, so a chapter's images are the run
      // from its own start up to the next one's — written out once, here, so that
      // one rule can serve both sources.
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [
            { title: "二", image_index: 5 },
            { title: "一", image_index: 1 },
          ],
          ["708", "707", "706", "705", "704", "703", "702", "701"]
        ),
        [
          { title: "一", images: ["708", "707", "706", "705"] },
          { title: "二", images: ["704", "703", "702", "701"] },
        ],
        "a chapter index counts from one, and its images run to the next chapter's"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [{ title: "only", image_index: 3 }],
          ["a", "b", "c", "d"]
        ),
        [{ title: "only", images: ["c", "d"] }],
        "and the last chapter runs to the end"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [{ title: "gone", image_index: 99 }],
          ["1", "2", "3"]
        ),
        [],
        "a chapter pointing past the end is dropped rather than clamped"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(null, ["1"]),
        [],
        "and a gallery with none translates to none"
      );

      // Where they fall on screen: at the chapter's earliest page in this order.
      const pages = numbered(CHAPTERS_VIEW).map((i) => page(String(i.id)));
      const placed = NR.placeChapters(
        [
          // Written out of order on purpose: the array is a set, so which id is
          // first in it means nothing.
          { title: "開幕", images: ["704", "702"] },
          { title: "中盤", images: ["708", "705", "706"] },
          { title: "not here", images: ["999"] },
          { title: "empty", images: [] },
        ],
        pages
      );
      assert.deepStrictEqual(
        placed.map((c) => [c.title, c.at]),
        [
          ["開幕", 1],
          ["中盤", 4],
        ],
        "each chapter at its earliest page in this order, and one with nothing here is not placed"
      );
      assert.deepStrictEqual(
        NR.placeChapters(
          [
            { title: "後", images: ["705"] },
            { title: "前", images: ["701"] },
          ],
          pages
        ).map((c) => c.title),
        ["前", "後"],
        "the list's own order does not decide — the screen does"
      );

      // What a chapter is placed at is the earliest page it lists, which is the
      // page a jump to it should land on.
      assert.strictEqual(placed[0].at, 1, "placed at its earliest page");
      assert.deepStrictEqual(
        placed[0].images,
        ["704", "702"],
        "…keeping the images it was given, in the order they were written"
      );
    }
  );

  /**
   * The handover: what the lightbox is given, and what it is not.
   *
   * This plugin does not draw a chapter menu of its own. Stash's own menu does the
   * jumping — `gotoPage`, which is an instant `setIndex` — and the only thing it
   * refuses is a list not in path order, because its chapter numbers count in path
   * order. Hand it this plugin's list *and* chapters numbered in that list, and its
   * own menu is right in any order. So what these sections pin is the handover
   * itself: the images, the chapters, and the numbers that make the jump land.
   */
  await runSection(
    "the lightbox is handed this plugin's own chapters",
    async () => {
      mountBridge();
      const { box } = await startReader({
        galleryId: "31",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.strictEqual(
        shown.length,
        1,
        "the lightbox was handed a list, once"
      );
      const { props } = shown[0];

      assert.strictEqual(
        props.images.length,
        8,
        "the images are the ones the reader drew"
      );
      assert.deepStrictEqual(
        props.images.map((i) => i.id),
        CHAPTERS_VIEW.map(String),
        "in the order it drew them"
      );
      assert.ok(
        typeof props.images[0].paths.image === "string" &&
          props.images[0].visual_files[0].width === 1000,
        "each in the shape Stash's lightbox reads: a picture URL and a native size"
      );
      assert.strictEqual(props.totalCount, 8, "counted as the lightbox counts");
      assert.strictEqual(
        props.pageSize,
        8,
        "one page of everything, so it never asks for another"
      );

      assert.deepStrictEqual(
        chapterMenu(box),
        ["開幕", "中盤"],
        "and the chapters, in the order they begin on screen"
      );

      stopReader(box);
    }
  );

  await runSection(
    "Stash's own chapters are handed over in the order on screen",
    async () => {
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "32",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.deepStrictEqual(
        chapterMenu(box),
        ["第二話", "第一話"],
        "a gallery still on Stash's numbers is listed in the order it is read"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the images carry what Stash names them by, and it does the naming",
    async () => {
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "51",
        on: true,
        total: 2,
        search: "?sortby=title&perPage=500",
      });

      const [first, second] = shown[0].props.images;
      assert.strictEqual(
        first.title,
        "第二話",
        "a title comes through as it is"
      );
      assert.strictEqual(
        first.visual_files[0].path,
        "/manga/author/002.jpg",
        "…and so does the file it is"
      );
      assert.strictEqual(second.title, "", "an image with no title has none");
      assert.strictEqual(
        second.visual_files[0].path,
        "/manga/author/003.jpg",
        "…and still says which file it is, which is what Stash shows instead"
      );

      stopReader(box);
    }
  );

  /**
   * The footer names the page the reader is on.
   *
   * Stash renders its footer from *its* place in the lightbox, and this half never
   * moves that place: a turn is the reader's own arithmetic, and the carousel is left
   * where the lightbox opened, hidden, holding the index it mounted with. So the
   * footer named the image the reader opened on — right on the first page and never
   * again. What is corrected is the image link, in place; see footer.ts.
   */
  await runSection("the footer names the page the reader is on", async () => {
    const { box } = await startReader({
      galleryId: "51",
      on: true,
      total: 2,
      search: "?sortby=title&perPage=500",
    });

    const center = box.lightbox.querySelector(".Lightbox-footer-center");
    const link = center.querySelector(".image-link");
    const gallery = center.querySelector(".image-gallery-link");

    assert.strictEqual(
      link.textContent,
      "第二話",
      "the page the lightbox opened on is the one the footer names"
    );
    assert.strictEqual(link.getAttribute("href"), "/images/901");

    // Stash's own gallery link, left alone: one gallery behind the lightbox, and the
    // reader never leaves it — so there is nothing there to correct.
    assert.strictEqual(
      gallery.textContent,
      "Gallery",
      "and the gallery link is Stash's own, untouched"
    );

    // A turn, and the name follows it — the title where there is one, and the file's
    // name where there is not, which is the rule Stash's own footer names a page by.
    dom.click(box.navRight);
    assert.deepStrictEqual(drawn(), ["/image/902/image"]);
    assert.strictEqual(
      link.textContent,
      "003.jpg",
      "the next page is named by its file, since it has no title"
    );
    assert.strictEqual(link.getAttribute("href"), "/images/902");

    // And the click: a router link goes where it was *rendered* to go, so the
    // corrected href would mean nothing if the router still heard the click.
    const click = dom.click(link);
    assert.strictEqual(
      click.propagationStopped,
      true,
      "a click on the footer's link is kept from the router, so the browser follows " +
        "the corrected href rather than the one Stash rendered"
    );

    stopReader(box);
  });

  await runSection(
    "a carousel showing images this plugin never read",
    async () => {
      shown.length = 0;
      mountBridge();
      const at = loggedErrors.length;

      // A carousel showing some other gallery's images. Finding its place by identity
      // is the one thing this plugin does to know where it is, so an image it never
      // read is a lightbox it cannot follow — and it says so rather than drawing
      // whatever happens to sit at that number.
      const { box } = await startReader({
        galleryId: "33",
        on: true,
        expectSwitch: false,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: ["901", "902", "903", "904", "905", "906", "907", "908"],
      });
      await settle();

      assert.strictEqual(container(), null, "nothing is drawn");
      assert.deepStrictEqual(
        shown,
        [],
        "and nothing is handed over, so Stash's own menu — or none — stands"
      );
      assert.ok(
        errorsSince(at).some((line) =>
          /not among the pages this plugin read/.test(line)
        ),
        "and the reader says what it could not find"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the chapters go to the lightbox with the mode off",
    async () => {
      // Twice, and the first one is what makes the second mean anything: startReader
      // turns the switch off *after* it has built a lightbox, so its own flush happens
      // with the mode still on from the section before — and a read already begun
      // finishes whatever the mode says by then.
      const first = await startReader({ galleryId: "33", on: false, total: 8 });
      stopReader(first.box);

      // A gallery neither call has read, so the read in this one happens with the mode
      // already off — which is the whole question.
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "34",
        on: false,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/701/image"],
        "one page at a time: the pairing is off, and the mark is what decides the rest"
      );
      assert.strictEqual(
        shown.length,
        1,
        "and the lightbox has the chapters anyway, since a reader who never turns the " +
          "spread view on still wants them"
      );
      assert.deepStrictEqual(
        chapterMenu(box),
        ["開幕", "中盤"],
        "…the gallery's chapters, in the order on screen"
      );

      stopReader(box);
    }
  );

  /**
   * The gallery page's own Chapters tab, which this plugin renders from its own
   * chapters. Stash's rows are read for as long as they are all that knows where a
   * chapter is, and are never written — the point of taking the tab over is that
   * the plugin's field becomes the one that says where chapters are.
   */
  /**
   * The two menus in the reader's own header. Nothing else asserts that they open —
   * which is how they shipped dead: the state changed on a click and nothing redrew,
   * so a reader pressing either of them saw nothing at all.
   */
  await runSection("the header's two menus open and close", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const menu = (which) => chrome.querySelector(".manga-reader-menu-" + which);
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );

    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "the chapter menu starts closed"
    );

    dom.click(toggle("chapters"));
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      true,
      "and the button in the header opens it"
    );
    assert.deepStrictEqual(
      [...menu("chapters").children].map((item) => item.textContent),
      ["開幕", "中盤"],
      "onto the gallery's chapters"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      true,
      "the other button opens the settings"
    );
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "and only one menu is open at a time"
    );
    assert.ok(
      menu("settings").querySelector("#manga-reader-double-page"),
      "which holds the switches"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      false,
      "and pressing it again puts the menu away"
    );

    stopReader(box);
  });

  /**
   * What this header looks like is Stash's stylesheet's business, which means the
   * markup has to be Stash's own: every class asserted here is one its own lightbox
   * header puts on the same element, read off its `LightboxHeader`. A class of this
   * plugin's own would be styled by nothing and would read as a plugin's header,
   * which is the one thing this half exists not to be.
   *
   * The icon names are asserted for the same reason: the stub has no Font Awesome
   * to draw with, so the name the button asks for is the whole of what a test can
   * see — and it is also the part that was wrong, when the header drew its own
   * three bars and its own cross out of characters.
   */
  await runSection("the header is Stash's own markup", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );
    const owns = (el, ...names) =>
      names.every((name) => el.classList.contains(name));

    const chapterButton = toggle("chapters");
    assert.ok(
      owns(
        chapterButton,
        "minimal",
        "Lightbox-header-chapter-button",
        "dropdown-toggle",
        "btn",
        "btn-primary"
      ),
      "the chapter button is the Dropdown.Toggle Stash's own header draws"
    );
    const dropdown = chrome.querySelector(".dropdown");
    assert.ok(
      dropdown.contains(chapterButton),
      "inside the wrapper a dropdown menu is positioned against — without it the " +
        "menu is positioned against the page, and opens off the bottom of it"
    );
    assert.ok(
      dropdown.contains(chrome.querySelector(".Lightbox-header-chapters")),
      "and the menu is in that same wrapper, which is what positions it"
    );

    assert.strictEqual(
      chrome
        .querySelector(".manga-reader-chapter-menu")
        .getAttribute("data-manga-reader-hidden"),
      null,
      "and a gallery that has chapters is offered the menu to read them in"
    );

    const gear = toggle("settings");
    assert.ok(
      owns(gear, "btn", "btn-link"),
      "the gear is one of the link buttons Stash draws the rest of its header with"
    );
    const anchor = chrome.querySelector(".Lightbox-header-options-icon");
    assert.ok(
      anchor.contains(gear) &&
        anchor.contains(chrome.querySelector(".popover")),
      "and it sits in the options box its popover is measured from"
    );
    assert.strictEqual(
      chrome.querySelector(".manga-reader-options-anchor"),
      anchor,
      "which this plugin also names, because the measuring is the one thing it adds"
    );

    const close = chrome.querySelector(".manga-reader-close");
    assert.strictEqual(close.tagName, "BUTTON");
    assert.ok(owns(close, "btn", "btn-link"), "the cross is one too");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(close),
      "at the end of the group that ends the row"
    );
    assert.strictEqual(
      close.title,
      "Close Lightbox",
      "and says what Stash's own says"
    );

    // Fullscreen, which Stash offers where the browser has it and this header has
    // to offer the same way — including asking for it of the lightbox, since that
    // is what fills the screen rather than the browser's own chrome coming back.
    const full = chrome.querySelector(".manga-reader-fullscreen");
    assert.ok(
      full,
      "the header should draw a fullscreen button where the browser has one"
    );
    assert.ok(
      owns(full, "btn", "btn-link"),
      "the fullscreen button is one of the link buttons too"
    );
    assert.strictEqual(full.dataset.icon, "faExpand");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(full),
      "drawn in the group that ends the row, where Stash draws its own"
    );
    assert.strictEqual(dom.document.fullscreenElement, null);
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      box.lightbox,
      "pressing it fills the screen with the lightbox"
    );
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      null,
      "and pressing it again gives the screen back — read at the click, so leaving " +
        "fullscreen with Esc does not leave the button pointing the wrong way"
    );

    // The settings panel, which is a `popover` because that is what Stash's own
    // options menu is: a heading, a body, and a `form-group` around each control.
    // Without the body the controls sit against the border, with no gap between
    // them and none to the edge.
    const settings = chrome.querySelector(".manga-reader-menu-settings");
    assert.ok(
      settings.classList.contains("popover") &&
        settings.classList.contains("manga-reader-settings"),
      "the settings are a popover"
    );
    const header = settings.querySelector(".popover-header");
    assert.ok(
      header,
      "the panel should have a heading, as Stash's own options popover does"
    );
    assert.strictEqual(
      header.textContent,
      "Options",
      "worded as Stash words its own"
    );
    const body = settings.querySelector(".popover-body");
    assert.ok(body, "and a body, which is where its padding comes from");
    for (const id of [
      "#manga-reader-double-page",
      "#manga-reader-offset",
      "#manga-reader-fade",
    ]) {
      const control = settings.querySelector(id);
      assert.ok(control, `${id} should be in the panel`);
      assert.ok(
        body.contains(control),
        `${id} should be inside the body rather than beside it`
      );
      assert.ok(
        [...body.querySelectorAll(".form-group")].some((group) =>
          group.contains(control)
        ),
        `${id} should have a form-group of its own — that is where the gap between ` +
          "one control and the next comes from"
      );
    }

    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "the chapter button asks for bars while the chapters are away"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faTimes",
      "and for a cross while they are open, as Stash's own does"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "and for bars again once they are put away"
    );
    assert.strictEqual(gear.dataset.icon, "faCog", "the gear is always a cog");
    assert.strictEqual(
      close.dataset.icon,
      "faTimes",
      "and the cross is always a cross"
    );

    stopReader(box);
  });

  /**
   * A gallery in no chapters has no chapter menu: no menu, and no button to open one.
   *
   * Stash's own header is empty of them on such a gallery — it renders its chapter
   * menu only when it has chapters to put in it — and a button that opens nothing is
   * worse than no button at all: it says there are chapters, and then shows none.
   */
  await runSection(
    "a gallery in no chapters gets no chapter button",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const menu = chrome.querySelector(".manga-reader-chapter-menu");

      assert.ok(menu, "the header is built with a place for the chapter menu");
      assert.notStrictEqual(
        menu.getAttribute("data-manga-reader-hidden"),
        null,
        "and the place is hidden, because this gallery has no chapters to put in it"
      );

      stopReader(box);
    }
  );

  /**
   * The wheel, and the press and drag: Stash's two ways of looking closer, which
   * this half had lost with the images it replaced. Stash's zoom acts on the image
   * inside its carousel — the carousel this half hides — so a reader who zooms a
   * page in Stash's lightbox expects the same wheel here, and the same hand.
   *
   * The arithmetic is pinned on its own, by calling it (see the section after this
   * one). What is pinned here is that the two gestures reach it, and what they leave
   * on the screen — including the one thing that must *not* happen: a drag ending in
   * a click, which would turn the page for the trouble of moving it.
   */
  await runSection("the wheel zooms and the drag pans", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    const spread = container();
    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const transform = () => spread.style.transform;
    const zoomButton = () => chrome.querySelector(".manga-reader-zoom");
    const offered = () =>
      zoomButton().getAttribute("data-manga-reader-hidden") === null;
    const wheel = (deltaY, init) =>
      spread.dispatch(
        "wheel",
        dom.makeEvent("wheel", Object.assign({ deltaY }, init))
      );

    // What the browser would report for a page, which is what says which half of it
    // a click landed on. The test world has no layout, so a test that means to click
    // a page has to say how wide it is.
    const laidOut = () => {
      for (const page of spread.children) {
        page.children[0].offsetWidth = 500;
        page.children[0].offsetHeight = 800;
      }
    };

    laidOut();
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(1)",
      "the pages are drawn fitted and centred"
    );
    assert.strictEqual(
      spread.children[0].children[0].draggable,
      false,
      "and each page says it is not draggable: a browser's own drag of an image is " +
        "a drag of the file, and it swallows the moves a pan is made of"
    );
    assert.strictEqual(offered(), false, "so there is no zoom to reset");

    wheel(-100);
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(1.1)",
      "a wheel away from the reader zooms in — Stash's own 10% a notch"
    );
    assert.strictEqual(offered(), true, "and the header offers to put it back");

    wheel(100);
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(1)",
      "a notch back lands exactly on the fitted size, not near it"
    );

    for (let i = 0; i < 30; i++) wheel(100);
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(0.1)",
      "and zooming out stops at a tenth rather than at nothing"
    );

    for (let i = 0; i < 60; i++) wheel(-100);
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(8)",
      "while zooming in stops at eight — a ceiling Stash has not got, because " +
        "past it there is no reading and no way back"
    );

    // One notch in from the ceiling, and then the drag. Read off the transform
    // rather than assumed: what the wheel did is this test's subject too.
    wheel(100);
    const scale = /scale\((.*)\)$/.exec(transform())[1];
    spread.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
    );
    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 140, clientY: 100 })
    );
    assert.strictEqual(
      transform(),
      "translate(40px, 0px) scale(" + scale + ")",
      "a drag moves the pages by as much as the pointer moved"
    );

    // And on, past the edge of the screen: Stash's own image follows the pointer
    // wherever it goes, and what brings it back is the next image rather than a stop
    // at the border.
    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 5000, clientY: 100 })
    );
    assert.strictEqual(
      transform(),
      "translate(4900px, 0px) scale(" + scale + ")",
      "a drag carries on past the edge of the screen, as Stash's own does"
    );

    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    const before = drawn();
    dom.click(spread.children[0].children[0], { offsetX: 400 });
    assert.deepStrictEqual(
      drawn(),
      before,
      "the release that ends a drag is not a click: the page does not turn"
    );
    assert.strictEqual(
      transform(),
      "translate(4900px, 0px) scale(" + scale + ")",
      "and the pages stay where they were dragged to"
    );

    // A press that stayed put but lasted: also not a click. Stash's own other half
    // of the test, and the reason a reader who pressed and thought better of it is
    // not sent a page on.
    spread.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        timeStamp: 0,
      })
    );
    dom.document.dispatch(
      "mouseup",
      dom.makeEvent("mouseup", { timeStamp: NR.VIEW_CLICK_MS + 1 })
    );
    dom.click(spread.children[0].children[0], { offsetX: 400 });
    assert.deepStrictEqual(
      drawn(),
      before,
      "a press that lasted longer than a click is not one, even if the pointer " +
        "never moved"
    );

    laidOut();
    dom.click(spread.children[0].children[0], { offsetX: 400 });
    assert.deepStrictEqual(
      drawn(),
      ["/image/402/image", "/image/403/image"],
      "a click with no drag in front of it still turns the page"
    );
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(" + scale + ")",
      "and the next screen arrives centred, at the zoom the reader was reading at"
    );

    dom.click(zoomButton());
    assert.strictEqual(
      transform(),
      "translate(0px, 0px) scale(1)",
      "the header's reset puts the pages back to the fitted size"
    );
    assert.strictEqual(offered(), false, "and takes itself away again");

    stopReader(box);
  });

  /**
   * The same zoom, with no DOM in the way.
   *
   * Read off Stash's own source rather than invented: the tenth of a step, the floor
   * at a tenth of the fit, and the snap to 1 that keeps a wheel that went out and
   * came back from leaving a hair of zoom behind — which the header would then offer
   * to reset, for a zoom nobody can see.
   */
  await runSection("the zoom's arithmetic, called on its own", () => {
    assert.deepStrictEqual(
      NR.fitView(),
      { zoom: 1, x: 0, y: 0 },
      "fitted is one, and the middle of the screen"
    );
    assert.deepStrictEqual(
      NR.centred({ zoom: 2, x: 30, y: -40 }),
      { zoom: 2, x: 0, y: 0 },
      "a turn takes the pan away and keeps the zoom"
    );
    assert.strictEqual(NR.isZoomed(NR.fitView()), false);
    assert.strictEqual(NR.isZoomed({ zoom: 1.1, x: 0, y: 0 }), true);

    assert.strictEqual(
      NR.zoomed(NR.fitView(), 1 + 0.01).zoom,
      1,
      "a hair off the fitted size is the fitted size"
    );
    assert.strictEqual(NR.zoomed(NR.fitView(), 1.1).zoom, 1.1);
    assert.strictEqual(NR.zoomed(NR.fitView(), 0.0001).zoom, NR.VIEW_MIN_ZOOM);
    assert.strictEqual(NR.zoomed(NR.fitView(), 1e6).zoom, NR.VIEW_MAX_ZOOM);

    // The pan is where the pointer took the pages and nothing else: no bounds, in
    // either direction, at the fitted size or past the edge. Stash's own drag is the
    // same, and the next screen is what puts them back in the middle.
    assert.deepStrictEqual(
      NR.panned(NR.fitView(), 100, 100),
      { zoom: 1, x: 100, y: 100 },
      "a fitted page follows the pointer as readily as a zoomed one does"
    );
    assert.deepStrictEqual(
      NR.panned({ zoom: 2, x: 40, y: 0 }, -30, 25),
      { zoom: 2, x: 10, y: 25 },
      "and from wherever it already was"
    );
    assert.deepStrictEqual(
      NR.panned({ zoom: 2, x: 0, y: 0 }, 9999, -9999),
      { zoom: 2, x: 9999, y: -9999 },
      "however far that is: past the edge of the screen is still somewhere a " +
        "reader meant to go, and Stash does not stop them either"
    );
  });

  /**
   * The bar's arithmetic, called on its own.
   *
   * The snapping is the whole feel of the thing and the least visible in a DOM test:
   * a page is a mark, and the boundary between two marks is halfway between them.
   */
  await runSection("the progress bar's arithmetic", () => {
    // Eight pages, so the marks are at 0, 1/8, 2/8 … and the boundaries at the
    // halves: 3.4 in page terms lands on 3, 3.5 on 4.
    assert.strictEqual(NR.pageAtFraction(3.4 / 8, 8), 3);
    assert.strictEqual(NR.pageAtFraction(3.5 / 8, 8), 4);
    assert.strictEqual(NR.pageAtFraction(3.6 / 8, 8), 4);
    assert.strictEqual(
      NR.pageAtFraction(1, 8),
      7,
      "the far end is the last page, not one past it"
    );
    assert.strictEqual(NR.pageAtFraction(-0.5, 8), 0);
    assert.strictEqual(NR.pageAtFraction(0.99, 8), 7);

    assert.strictEqual(NR.fractionOfPage(0, 40), 0);
    assert.strictEqual(NR.fractionOfPage(3, 40), 3 / 40);
    assert.strictEqual(
      NR.fractionOfPage(39, 40),
      39 / 40,
      "the last page is a mark short of the end, like every other page"
    );
    assert.strictEqual(NR.fractionOfPage(999, 40), 39 / 40);

    // A gallery with one page has no fractions to speak of, and no bar.
    assert.strictEqual(NR.fractionOfPage(0, 1), 0);
    assert.strictEqual(NR.pageAtFraction(0.7, 1), 0);

    // Ticks: one per chapter, where each begins, and two on one page are one tick.
    assert.deepStrictEqual(
      NR.progressNodes(
        [
          { title: "開幕", at: 0, images: [] },
          { title: "中盤", at: 4, images: [] },
          { title: "同名", at: 4, images: [] },
          { title: "越界", at: 99, images: [] },
        ],
        20
      ),
      [
        { title: "開幕", at: 0, fraction: 0 },
        { title: "中盤", at: 4, fraction: 4 / 20 },
      ],
      "at the page each chapter begins on, and once"
    );
  });

  /**
   * The bar itself: drawn where the reader is, dragged to somewhere else.
   *
   * Two speeds are the point of it — the handle follows the pointer, the jump is
   * throttled — and both are pinned here, including the half that must not happen:
   * a drag that turns the page, or a press on the bar that pans it.
   */
  await runSection("the progress bar shows the way, and moves it", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const bar = box.lightbox.querySelector(".manga-reader-progress");
    assert.ok(bar, "a gallery with pages has a bar");
    assert.strictEqual(
      bar.getAttribute("data-manga-reader-hidden"),
      null,
      "and it is on the screen"
    );

    const track = bar.querySelector(".manga-reader-progress-track");
    const read = bar.querySelector(".manga-reader-progress-read");
    const thumb = bar.querySelector(".manga-reader-progress-thumb");
    const ticks = () => [
      ...bar.querySelectorAll(".manga-reader-progress-node"),
    ];

    // The track as the browser would measure it, since a pointer's x is only a
    // fraction of something.
    track.rect = { left: 0, top: 0, width: 800, height: 4 };

    assert.strictEqual(read.style.width, "0.000%", "the book opens unread");
    assert.strictEqual(thumb.style.left, "0.000%");

    assert.strictEqual(ticks().length, 2, "one tick per chapter");
    assert.deepStrictEqual(
      ticks().map((tick) => [tick.title, tick.style.left]),
      [
        ["開幕", "25.000%"],
        ["中盤", "50.000%"],
      ],
      "at the page each begins on, which is 2 of 8 and 4 of 8"
    );

    // A turn: the bar follows the reader.
    dom.click(box.navRight);
    assert.deepStrictEqual(drawn(), ["/image/702/image", "/image/703/image"]);
    assert.strictEqual(
      read.style.width,
      "12.500%",
      "a screen later, the fill ends where the reader is: page 2 of 8"
    );

    // A drag: the handle follows the pointer on every event — to the pixel, with no
    // snapping — while the jump that costs a fetch is held back.
    const still = container().style.transform;
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 700 })
    );
    assert.strictEqual(
      thumb.style.left,
      "87.500%",
      "the handle is where the pointer is, not on the nearest page"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "and the jump behind it went to the screen holding page 8"
    );

    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 100 })
    );
    assert.strictEqual(
      thumb.style.left,
      "12.500%",
      "the next pointer event moves the handle again, just as immediately"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "while the jump waits its turn — two pictures a millisecond apart would be " +
        "one fetch and one decode each, which is what the wait is for"
    );

    // Let go before the wait is up: the release lands where the pointer left off,
    // whatever the jump it was owed — a reader who has stopped dragging has stopped
    // asking, and waiting out a timer they cannot see is the bar arguing with them.
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "letting go lands on what the pointer asked for, without waiting its turn"
    );

    await new Promise((resolve) =>
      setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "and the jump it was owed never comes: a reader who has let go of the bar is " +
        "not carried back to where they were dragging"
    );

    // A second drag, this time with the wait allowed to run out: the handle moves at
    // once, the jump lands when its turn comes, and the release asks for nothing new.
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 400 })
    );
    assert.strictEqual(
      thumb.style.left,
      "50.000%",
      "halfway along is page 4 of 8"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "which is the screen holding it"
    );

    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 100 })
    );
    assert.strictEqual(thumb.style.left, "12.500%");
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "a second jump this soon is held back, so the picture is still behind"
    );

    await new Promise((resolve) =>
      setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "and the picture follows the handle when the wait runs out"
    );

    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));

    // A press on the bar is not a press on the pages: the bar is their sibling, so
    // nothing the reader does to it can pan them or turn them.
    assert.strictEqual(
      container().style.transform,
      still,
      "dragging the bar pans nothing"
    );
    assert.strictEqual(
      dom.click(track).propagationStopped,
      true,
      "and the click it ends with never reaches Stash's lightbox, which closes on one"
    );

    // A tick is a jump to its chapter.
    dom.click(ticks()[1]);
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "clicking a chapter's tick opens the book at that chapter"
    );

    stopReader(box);
    assert.strictEqual(
      box.lightbox.querySelector(".manga-reader-progress"),
      null,
      "and the bar goes with the lightbox"
    );
  });

  /**
   * The bar sleeps when nothing is happening, and wakes when something is.
   *
   * The clock is the test's: waiting two and a half seconds to see a bar go away is
   * a test nobody would keep. The timers the plugin sets are the plugin's own — it
   * is the callback that is run by hand here.
   */
  await runSection("the progress bar sleeps, and wakes", async () => {
    const real = dom.window.setTimeout;
    const timers = [];
    dom.window.setTimeout = (fn, ms) => {
      timers.push({ fn, ms });
      return real(fn, ms);
    };

    try {
      const { box } = await startReader({ galleryId: "8", on: true });
      const bar = box.lightbox.querySelector(".manga-reader-progress");
      const asleep = () => bar.classList.contains("is-idle");

      assert.strictEqual(
        asleep(),
        false,
        "a bar that has just been drawn is awake"
      );

      const sleep = timers.find((timer) => timer.ms === NR.PROGRESS_IDLE_MS);
      assert.ok(sleep, "and it has set itself a clock to go to sleep by");

      sleep.fn();
      assert.strictEqual(
        asleep(),
        true,
        "which, when it runs out, puts it away"
      );

      // Anything moving over the lightbox brings it back — including a pointer that
      // never touches the bar, which is the case that matters: asleep, it is taking
      // no pointers of its own.
      box.lightbox.dispatch("mousemove", dom.makeEvent("mousemove", {}));
      assert.strictEqual(
        asleep(),
        false,
        "and moving over the lightbox wakes it"
      );

      sleep.fn();
      dom.click(box.navRight);
      assert.strictEqual(
        asleep(),
        false,
        "as does turning a page: the bar has something new to say"
      );

      stopReader(box);
    } finally {
      dom.window.setTimeout = real;
    }
  });

  /**
   * A gallery of one page gets no bar.
   *
   * There is no progress to show through a single picture, and a bar across the foot
   * of one would be furniture with nothing to say — the same reason Stash draws its
   * own counter only for a lightbox of more than one image.
   */
  await runSection("a gallery of one page gets no bar", async () => {
    const { box } = await startReader({
      galleryId: "12",
      on: true,
      total: 1,
    });

    assert.strictEqual(
      box.lightbox.querySelector(".manga-reader-progress"),
      null,
      "the one-page gallery has no bar at all — not a hidden one"
    );

    stopReader(box);
  });

  /**
   * Paging past what the lightbox has loaded makes it fetch, and while it fetches it
   * shows a spinner *instead of* its header and its carousel. That is not a lightbox
   * this plugin cannot read — it is one that is busy — and reading it as the former is
   * how a reader ended up watching a spinner with the spread view switched off behind
   * it.
   */
  await runSection(
    "a busy lightbox is waited out, not given up on",
    async () => {
      const { box } = await startReader({
        galleryId: "8",
        on: true,
        search: "?sortby=title&perPage=500",
      });
      const wasDrawn = drawn();
      const at = loggedErrors.length;

      box.loading(true);
      dom.flush();
      await settle();

      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "a lightbox fetching its next page is not a fault to report"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "and the reader is still on: Stash's spinner is what is on screen, which is " +
          "Stash's business, and the spread view has not switched itself off behind it"
      );

      // Back, and drawing again — the screen the reader was on, redrawn.
      box.loading(false);
      dom.flush();
      await settle();
      assert.deepStrictEqual(drawn(), wasDrawn, "and it picks up where it was");

      stopReader(box);
    }
  );

  await runSection(
    "a gallery that is not manga gets nothing of ours",
    async () => {
      shown.length = 0;
      mountBridge();
      const at = loggedErrors.length;

      // The switch on, Stash's own chapters on the gallery, and pages to spare:
      // everything this plugin could do here, it does not — because the gallery is not
      // marked manga, which is the whole of what makes one this plugin's business.
      const { box } = await startReader({
        galleryId: "61",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
        expectSwitch: false,
      });
      await settle();

      assert.strictEqual(
        box.popover ? box.popover.querySelector(".manga-reader-options") : null,
        null,
        "no switch of this plugin's in its options menu"
      );
      assert.strictEqual(container(), null, "nothing drawn over it");
      assert.deepStrictEqual(shown, [], "and nothing handed to its lightbox");
      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "and it is not even read, so nothing is reported about it either"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the chapters tab is drawn from this plugin's chapters",
    async () => {
      mountBridge();
      const at = mutations.length;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-hidden"),
        "",
        "Stash's own button goes, since this plugin is what would edit them now — " +
          "attributes seen: " +
          JSON.stringify(tab.button.attributes)
      );
      assert.deepStrictEqual(
        drawnRows(tab.container),
        ["第一話 - #1", "第二話 - #5"],
        "and the rows are Stash's chapters, counted in path order — the order this " +
          "tab has always counted in, and the order it is listed in"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "reading a gallery's chapters does not write anything, least of all Stash's rows"
      );

      stopTab(tab);
    }
  );

  await runSection(
    "a chapter in the tab opens the lightbox there",
    async () => {
      mountBridge();
      shown.length = 0;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);
      dom.flush();
      await settle();

      // The second row is 第二話, which begins at path position 4 — the tab lists
      // path order, so that is both what the row says and where the click goes.
      dom.click(tab.container.children[1].children[1].children[0]);

      assert.strictEqual(shown.length, 1, "the lightbox was asked to open");
      assert.strictEqual(
        shown[0].props.initialIndex,
        4,
        "at the page that chapter begins on"
      );
      assert.strictEqual(
        shown[0].props.images.length,
        8,
        "with the gallery's images, so the reader and the lightbox agree"
      );
      // Nothing else is handed over: the chapters are the reader's own menu, drawn
      // from the moment it draws. What the stub records as empty is what the bridge
      // was asked for, which is images and a place.
      assert.deepStrictEqual(shown[0].chapters, []);

      stopTab(tab);
    }
  );

  /**
   * Last on purpose: it empties this browser's settings and puts the *old* keys
   * back, which every section above depends on being absent. What it checks is
   * the one thing the migration promises — a reader who had both switches set
   * before the halves were bundled still has them after — and the one thing it
   * must not do, which is take the old value away from the standalone Manga
   * Reader that may still be installed beside this plugin.
   */
  await runSection(
    "settings and shifts from before the merge are still read",
    async () => {
      const store = dom.window.localStorage;
      const settings = {
        doublePage: true,
        coverAlone: false,
        detectSpreads: true,
        fadeMs: 300,
      };

      store.removeItem("plugin.mangaTools.settings");
      store.removeItem("plugin.mangaTools.offsets");
      store.setItem("mangaReader.settings", JSON.stringify(settings));
      store.setItem("mangaReader.offsets", JSON.stringify({ 8: 1 }));

      assert.deepStrictEqual(
        NR.readSettings(),
        settings,
        "the old key's settings are the ones read"
      );
      assert.strictEqual(NR.readOffset("8"), 1, "…and its per gallery shifts");
      assert.deepStrictEqual(
        JSON.parse(store.getItem("plugin.mangaTools.settings")),
        settings,
        "…and they are copied to the key this plugin writes"
      );
      assert.deepStrictEqual(
        JSON.parse(store.getItem("plugin.mangaTools.offsets")),
        { 8: 1 },
        "…shifts included, so a later write merges rather than replaces"
      );
      assert.ok(
        store.getItem("mangaReader.settings") &&
          store.getItem("mangaReader.offsets"),
        "and the old keys are left where they are, for the plugin that still reads them"
      );
    }
  );

  /**
   * Also last, and for a related reason: it loads the bundle a *second* time, in
   * a world where the tools half cannot start, to see the one promise the merge
   * makes. The halves share a bundle, so a throw during either one's startup
   * would otherwise take both down — the entry starts them one at a time, each
   * inside its own guard, and this is what that is for.
   *
   * A missing `setInterval` because it is one of the few things the tools half
   * reaches for *while starting* and cannot guard against itself: it is where the
   * poll behind its store begins. What the reader half has to show for it is that
   * it is still there — still watching the document, still taking the arrow keys.
   *
   * Take the guard out of the entry and this section is not what fails: the bundle
   * throws at the first load, near the top of this file, and the run dies there.
   * Both are red, which is what matters — but the message here is the readable one,
   * and it is only readable because the guard is doing its job.
   */
  await runSection(
    "a tools half that cannot start leaves the reader readable",
    async () => {
      const window = dom.window;
      const realSetInterval = window.setInterval;
      const errorsAt = loggedErrors.length;
      const keysAt = (window.listeners.keydown || []).length;

      window.setInterval = undefined;
      delete require.cache[require.resolve(BUNDLE)];
      require(BUNDLE);
      window.setInterval = realSetInterval;

      assert.ok(
        errorsSince(errorsAt).some((line) =>
          /tools half could not be started/.test(line)
        ),
        "the half that failed says which one it was"
      );
      assert.ok(
        (window.listeners.keydown || []).length > keysAt,
        "and the reader half is running anyway"
      );
    }
  );

  // ── The tally ────────────────────────────────────────────────────

  if (failures.length === 0) {
    console.log("\nAll mangaReader smoke tests passed");
  } else {
    console.error(
      `\n${failures.length} section(s) failed: ${failures.join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("the smoke test itself failed:", e);
  process.exitCode = 1;
});
