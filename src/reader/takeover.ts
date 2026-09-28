/**
 * The reader: putting two pages where the lightbox keeps one.
 *
 * HOW THIS WORKS, AND WHY IT IS LIKE THIS. Stash's lightbox cannot be patched —
 * `LightboxComponent` is a plain `React.FC`, with no `PatchComponent` wrapper — so
 * there is no supported way to change what it draws. What this file does instead:
 *
 *   1. watches the document for a lightbox appearing, with a `MutationObserver`;
 *   2. puts a container of its own **beside** Stash's carousel, never in place of
 *      it, so React is free to re-render its own subtree without ours going with
 *      it — and the carousel keeps existing, hidden, because it is the thing that
 *      holds the lightbox's idea of where it is;
 *   3. hides that carousel with a class and lays the two pages out itself;
 *   4. drives the lightbox through its own interface — reading where it is from
 *      its header, and moving it with its own arrow keys (see stash-lightbox.ts)
 *      rather than keeping a second idea of the current page that could drift from
 *      the first. Every way of moving — our keys, Stash's keys, the nav strip, a
 *      chapter — ends in the same DOM change, so there is one code path back to a
 *      correct drawing, and it is the observer's.
 *
 * The approach follows kokkengMangaViewer (github.com/kokkeng1/stash_plugin_custom),
 * which does the same thing for a scrolling view. Its lesson worth repeating is
 * that this is a *degradable* feature: everything that reads Stash's markup returns
 * null rather than guessing, and a null turns the mode off and says so. The worst
 * case is a reader who has to press a switch again, never a blank screen.
 */
import { stringFor } from "../i18n";
// The field plumbing both halves share: this one reads the same custom fields the
// tools half writes, under the same names, through the same helpers.
import { NS } from "../tools/fields";
import { bridged, installBridge, takeOver } from "./bridge";
import { syncChaptersTab } from "./chapters-tab";
import {
  type MangaReaderChapter,
  chaptersFromStash,
  parseChapters,
  placeChapters,
} from "./chapters";
import { NR, type MangaReaderOrder } from "./namespace";
import type { MangaReaderGallery, MangaReaderSettings } from "./namespace";
import {
  FADE_MAX_MS,
  readOffset,
  readSettings,
  writeOffset,
  writeSettings,
} from "./settings";
import type { MangaReaderPage, MangaReaderScreen } from "./spreads";
import { layout, screenAt, stepsToAdjacent } from "./spreads";
import {
  CLASS_NAVBUTTON,
  SELECTOR_DISPLAY,
  SELECTOR_LIGHTBOX,
  SELECTOR_POPOVER_BODY,
  type GalleryAnswer,
  carouselImage,
  fetchGallery,
  galleryIdFromPath,
  lightboxOrder,
  pressArrow,
  pressEscape,
  readPosition,
} from "./stash-lightbox";

/**
 * The three switches' words, in the interface's language.
 *
 * The ids are this half's own, so the union is what keeps a typo from rendering
 * an id: the catalog lookup itself takes any string and falls back to the id
 * when it finds nothing, which is the right behaviour for a message that is
 * missing and the wrong one for a name that was never spelled right.
 */
type ReaderLabel = "doublePage" | "fade" | "noChapter" | "offset";

const labelFor = (locale: string | null | undefined, key: ReaderLabel) =>
  stringFor(locale, `mangaReader.${key}`);

/** Class on Stash's lightbox while this plugin is drawing inside it */
const CLASS_ACTIVE = "manga-reader-active";
/** This plugin's own container, and the pages in it */
const CLASS_SPREAD = "manga-reader-spread";
const CLASS_PAGE = "manga-reader-page";
const CLASS_SINGLE = "is-single";
/** The switches this plugin adds to the lightbox's options menu */
const SWITCH_ID = "manga-reader-double-page";
const FADE_ID = "manga-reader-fade";
const OFFSET_ID = "manga-reader-offset";
/** Class of the group holding them, so it can be found again */
const CLASS_OPTIONS = "manga-reader-options";

/**
 * How many times the container may be put back before the plugin gives up.
 *
 * React owns the element this container sits in, so it can be removed at any
 * moment — the observer puts it back. A container that keeps vanishing is a
 * disagreement with Stash's rendering that re-inserting will not settle, and
 * fighting it in a loop would be worse than not drawing: off, with a line in the
 * console, is the honest ending.
 */
const MAX_REINSERTS = 8;

/** How many galleries' page lists are kept. See loadGallery. */
const CACHE_LIMIT = 8;

let settings: MangaReaderSettings = readSettings();

/** The lightbox being worked in, and this plugin's container inside it */
let root: Element | null = null;
let container: HTMLElement | null = null;

/**
 * The galleries whose pages are in hand, by id.
 *
 * Kept because the same gallery is opened and closed repeatedly — reading a few
 * pages, going back to the thumbnails, opening it again — and the page list is the
 * same answer every time. Bounded, because a session can touch a great many
 * galleries and this is a convenience, not a store.
 */
const loaded: Map<string, MangaReaderGallery> = new Map();

/** The gallery being read, and the screen being drawn from it */
let galleryId: string | null = null;
let shownAt = -1;

/**
 * Which draw the screen on the way in belongs to.
 *
 * A screen can be waiting for its images while the reader turns again, and the
 * older draw's reveal must not land on top of the newer one — see draw. A counter
 * rather than a flag, because the older draw has no way to know what replaced it.
 */
let drawGeneration = 0;

/**
 * The screen whose images are still on their way, or -1 for none.
 *
 * `shownAt` says which screen the reader has asked for; whether it is *up* used to
 * be answered by asking the container how many children it had, and that stopped
 * being the same question once a screen began to be built off-screen and shown in
 * one step — during the wait the container is empty while the screen is already
 * under way. Read as "nothing has been drawn", every DOM change redrew the same
 * screen, and each redraw reset the wait it was in: a turn that produced a handful
 * of mutations (Stash's carousel swapping, its counter being rewritten) could go on
 * resetting the wait it needed to finish. The two questions are now two variables.
 */
let awaiting = -1;

/**
 * The offset for the gallery in hand, and which gallery that was.
 *
 * Per gallery, and remembered for it — see the note on OFFSET_KEY. Only one
 * gallery is being read at a time, so the value in hand is the one for `offsetFor`
 * and the two are set together.
 */
let offset: 0 | 1 = 0;
let offsetFor: string | null = null;

let reinsers = 0;
let language: string | null = null;
let logged = false;

/**
 * The lightbox whose clicks this plugin is listening to, if any. See watchClicks.
 */
let clickRoot: Element | null = null;

/**
 * The gallery whose pages are on their way, if any.
 *
 * `loadGallery` is called from every pass over the document, and the answer takes
 * a round trip — during which any DOM change runs another pass, finds no gallery
 * in hand, and asks again. One fetch per opening is what it should be, so the
 * gallery being fetched is remembered and a second ask for it is dropped.
 */
let pending: string | null = null;

/**
 * The lightbox the chapters were last handed to, and the gallery they were.
 *
 * A handover belongs to a lightbox: Stash builds a new one every time it is opened,
 * with no chapters of its own, so the gallery being read already is not a reason to
 * skip it. It is a reason to skip it *twice* for the same one, which is what this
 * remembers.
 */
let handedFor: { lightbox: Element; gallery: string } | null = null;

/**
 * Where the lightbox is being moved to, while it is on the way there.
 *
 * A turn of a screen is several pages, and the lightbox only moves one page per
 * press — and drops a press that arrives while the page before it is still
 * swapping. So a move is a small errand: press once, wait for the header to say it
 * landed, press again, and give up if it never does. See `press` and `arrived`.
 */
let errand: {
  /** The page index (0-based) the last press started from */
  from: number;
  /** The page index being aimed at */
  to: number;
  /** The press that has been sent and not yet seen land */
  retry: number | null;
} | null = null;

/** How long to wait for a press to land before sending it again, in milliseconds */
const PRESS_RETRY_MS = 120;
/** How many times one step may be re-sent before the errand is abandoned */
const MAX_ATTEMPTS = 3;
let attempts = 0;

// ── The loop ───────────────────────────────────────────────────────

/**
 * One pass over the document: is there a lightbox, and is it where it should be?
 *
 * Cheap by construction — a `querySelector` and a string compare in the common
 * case, since this runs on every DOM change in the page. Everything expensive
 * happens once per gallery, in `loadGallery`.
 */
function step(): void {
  // The gallery page's own Chapters tab, which is a different surface with the same
  // chapters — and is on screen exactly when there is *no* lightbox, so it is
  // watched before the lightbox is looked for. See chapters-tab.ts for what it does
  // and what it will not.
  syncChaptersTab();

  const lightbox = document.querySelector(SELECTOR_LIGHTBOX);

  if (!lightbox) {
    if (root) closeLightbox();
    return;
  }

  if (lightbox !== root) {
    closeLightbox();
    root = lightbox;
    galleryId = null;
    shownAt = -1;
    reinsers = 0;
    logged = false;
    handedFor = null;
  }

  const wantedId = galleryIdFromPath(window.location.pathname);
  if (!wantedId) return;

  // **Manga first, and nothing of this plugin's anywhere else.** The mark is what
  // says a gallery is this plugin's business, and the store knows it without asking —
  // see markedInStore. An unmarked gallery gets no switch in its lightbox, no
  // chapters in its tab, and nothing drawn over it; a gallery the store has not
  // answered for yet gets nothing either, and is looked at again when it does.
  const marked = NS.markedInStore(wantedId);
  if (marked !== true) {
    if (marked === false) leaveUnmarked(lightbox);
    return;
  }

  injectSwitch(lightbox);

  // Read whether or not the mode is on: the chapters are what the lightbox is handed
  // once this gallery is in hand, and a reader who never turns the spread view on
  // still wants them. The mode decides what is *drawn*, and nothing else.
  if (galleryId !== wantedId || !loaded.has(wantedId)) {
    loadGallery(wantedId);
    return;
  }

  const gallery = current();
  if (gallery) handOverChapters(lightbox, gallery);

  if (!wanted()) return;

  sync(lightbox);

  // After the drawing, so an unfinished move shows the page it is passing through
  // rather than skipping it.
  arrived(lightbox);
}

/** Whether the reader should be drawing, as far as can be told without asking */
function wanted(): boolean {
  const id = galleryIdFromPath(window.location.pathname);
  return (
    settings.doublePage &&
    root !== null &&
    id !== null &&
    NS.markedInStore(id) === true
  );
}

/**
 * Takes this plugin's switch back out of a lightbox on a gallery that is not manga.
 *
 * Rare but worth having: the mark can be removed from a gallery whose lightbox is
 * open, and the switch is the one thing of ours that is *added* rather than drawn —
 * a container is taken away by deactivating, and this is the same errand for a menu
 * entry.
 */
function leaveUnmarked(lightbox: Element): void {
  if (container || root !== lightbox) deactivate();

  const group = lightbox.querySelector("." + CLASS_OPTIONS);
  if (group) group.remove();
}

/** The pages of the gallery being read, if they are in hand */
function current(): MangaReaderGallery | null {
  return galleryId ? loaded.get(galleryId) || null : null;
}

/** Asks Stash for the gallery's pages, unless they are already in hand */
function loadGallery(id: string): void {
  // The offset belongs to one gallery, and is remembered for it: a gallery whose
  // pages are grouped wrongly is opened again and again, and being made to shift
  // the pairing every time would be the feature failing at its one job.
  if (offsetFor !== id) {
    offsetFor = id;
    offset = readOffset(id);
  }

  const already = loaded.get(id);
  if (already) {
    galleryId = id;
    shownAt = -1;
    step();
    return;
  }

  if (pending === id) return;

  const forLightbox = root;
  if (!forLightbox) return;
  pending = id;

  // Read here rather than remembered: the order belongs to the list the lightbox
  // was opened from, and opening another gallery — or the same one after changing
  // the list's sort — is a different order. See lightboxOrder.
  loadPages(id, lightboxOrder(window.location.search), forLightbox)
    .then((answer) => {
      // Another gallery was asked for while this was in flight: its answer is the
      // one that matters, and this one must not be drawn over it.
      if (pending !== id) return;
      pending = null;

      // The lightbox can have been closed — or another opened — while that was in
      // flight, and an answer for the previous one must not be drawn over this one.
      if (root !== forLightbox) return;

      const gallery: MangaReaderGallery = {
        id,
        pages: answer.pages,
        images: answer.images,
        screens: layout(answer.pages, { ...settings, offset }),
        chapters: placeChapters(chaptersOf(answer), answer.pages),
      };
      remember(id, gallery);

      language = answer.language;
      galleryId = id;
      shownAt = -1;
      step();
    })
    .catch((e) => {
      if (pending === id) pending = null;
      console.error(
        "[mangaReader] could not read this gallery's pages, turning the spread " +
          "view off:",
        e
      );
      deactivate();
    });
}

/**
 * The gallery's pages, in the order the lightbox is actually showing them.
 *
 * The order is *guessed* from the URL, and the URL is not always right: Stash's
 * gallery page keeps its inner tabs in component state, so switching from the
 * Images tab to the Chapters tab leaves `?sortby=title` in the address bar while
 * the lightbox that tab opens is Stash's own, and always path. Fetching a
 * title-ordered list for a path-ordered lightbox pairs the wrong pages and puts
 * every index this plugin computes off by however much the two orders disagree.
 *
 * So the guess is checked against the one thing that cannot be wrong — the image
 * actually on screen — and a list that disagrees is thrown away and asked for
 * again in path order, which is what the lightbox is in when the URL's order is
 * not it. If that disagrees too, nothing here fits and the caller is told so
 * rather than drawing pages that do not match the lightbox.
 *
 * A lightbox whose carousel cannot be read concludes nothing: the check is skipped
 * and the guess stands, because a reader that cannot verify an assumption is not
 * entitled to fail on it either.
 */
async function loadPages(
  id: string,
  order: MangaReaderOrder,
  lightbox: Element
): Promise<GalleryAnswer> {
  const answer = await fetchGallery(id, order);

  // Where the lightbox is, counted the way its own counter counts: an image's place
  // in the whole list, not in the page of it that happens to be loaded.
  const position = readPosition(lightbox);
  const shown = carouselImage(lightbox);
  const at = position ? position.current - 1 : -1;
  if (!shown || at < 0 || answer.pages[at]?.id === shown.id) return answer;

  if (order.sort === "path") {
    throw new Error(
      "[mangaReader] the lightbox is showing image " +
        shown.id +
        " where a path-ordered list has " +
        (answer.pages[shown.at]?.id ?? "nothing") +
        " — the list behind it is filtered, so its pages cannot be paired"
    );
  }

  const fallback = await fetchGallery(id, { sort: "path", direction: "ASC" });
  const still = carouselImage(lightbox);
  if (still && fallback.pages[at]?.id !== still.id) {
    throw new Error(
      "[mangaReader] the pages could not be matched to the lightbox in either " +
        "order, so the spread view would pair the wrong ones"
    );
  }

  return fallback;
}

/**
 * A gallery's chapters, from this plugin's own list or from Stash's.
 *
 * Ours when it is there, Stash's when it is not — and *nothing is written* either
 * way. A gallery nobody has edited stays on Stash's numbers for as long as it
 * exists, which is what makes this feature safe to have on a library that has
 * chapters already: opening one changes nothing, and the plugin's own list appears
 * only for a gallery whose chapters somebody has actually edited.
 *
 * Stash's numbers count in path order, so they are translated against the ids
 * fetched in that order. When the pages on screen *are* that order — every entry
 * but a sorted list — those ids were not asked for twice; see fetchGallery.
 */
function chaptersOf(answer: GalleryAnswer): MangaReaderChapter[] {
  const own = parseChapters(
    NS.pickField(answer.customFields, NS.CHAPTER_FIELD_NAME) || null
  );
  if (own) return own;

  if (answer.stashChapters.length === 0) return [];

  const pathIds = answer.pathIds || answer.pages.map((page) => page.id);
  return chaptersFromStash(answer.stashChapters, pathIds);
}

function remember(id: string, gallery: MangaReaderGallery): void {
  loaded.delete(id);
  loaded.set(id, gallery);

  while (loaded.size > CACHE_LIMIT) {
    const oldest = loaded.keys().next();
    if (oldest.done) break;
    loaded.delete(oldest.value);
  }
}

/** Draws whatever screen the lightbox is currently in */
function sync(lightbox: Element): void {
  const gallery = current();
  if (!gallery) return;

  const position = readPosition(lightbox);
  if (!position) {
    // The counter is drawn only when there is more than one image, so a gallery of
    // one page is the ordinary reason there is nothing to read here — and the
    // other reason is that Stash's markup has changed under this plugin, which is
    // worth a line rather than a silent nothing.
    if (gallery.pages.length <= 1) return;

    console.error(
      "[mangaReader] the lightbox header could not be read, so the spread view " +
        "cannot follow it — turning itself off"
    );
    deactivate();
    return;
  }

  const at = screenAt(gallery.screens, position.current - 1);
  if (at < 0) {
    console.error(
      "[mangaReader] the lightbox is at page " +
        position.current +
        ", which is not among the pages this plugin read — turning the spread " +
        "view off"
    );
    deactivate();
    return;
  }

  if (
    at === shownAt &&
    container &&
    (container.childElementCount || awaiting === at)
  ) {
    return;
  }

  // Only now, with somewhere to draw: inserting the container is what hides the
  // carousel, and a gallery with nothing to show must not be left with a hidden
  // one and an empty screen of ours.
  ensureContainer(lightbox);
  if (!container) return;

  draw(gallery.screens[at], at);
}

/**
 * Starts listening for clicks on Stash's nav buttons, once per lightbox.
 *
 * In the capture phase on the lightbox itself, which is what puts this in front of
 * Stash's own React handler: React listens on the root container, and an event that
 * has already been stopped on the way down never reaches it.
 */
function watchClicks(lightbox: Element): void {
  if (clickRoot === lightbox) return;

  if (clickRoot) clickRoot.removeEventListener("click", onNavClick, true);

  lightbox.addEventListener("click", onNavClick, true);
  clickRoot = lightbox;
}

/**
 * Creates the container, or puts it back if React has taken it away.
 *
 * Called only when there is something to draw, which is what makes a gallery with
 * nothing to show harmless: no container, and the carousel never hidden.
 */
function ensureContainer(lightbox: Element): void {
  const display = lightbox.querySelector(SELECTOR_DISPLAY);

  if (!display) {
    deactivate();
    return;
  }

  watchClicks(lightbox);

  if (container && container.parentNode === display) return;

  if (container) {
    reinsers += 1;
    if (reinsers > MAX_REINSERTS) {
      console.error(
        "[mangaReader] the lightbox keeps removing the reader's container — " +
          "turning the spread view off rather than fighting it"
      );
      deactivate();
      return;
    }
  }

  if (!container) {
    container = document.createElement("div");
    container.className = CLASS_SPREAD;
    container.addEventListener("click", onSpreadClick);
  }

  // Stash's own layers above this one are positioned; this makes the display the
  // containing block for the container rather than the page.
  (display as HTMLElement).style.position = "relative";
  display.appendChild(container);
  lightbox.classList.add(CLASS_ACTIVE);
}

/**
 * How long a screen may be held back waiting for its images.
 *
 * Waiting is the point — two pages that arrive separately read as a flicker rather
 * than as a page — but waiting *forever* on one slow image is worse than either.
 * Past this, whatever has arrived is shown and the rest lands when it lands.
 */
const REVEAL_BUDGET_MS = 300;

NR.REVEAL_BUDGET_MS = REVEAL_BUDGET_MS;

/**
 * Fades a screen in as it arrives.
 *
 * Against the lightbox's own background, not over the page before it. A cross-fade
 * is smoother on a photograph and worse on everything else: two pages of text
 * superimposed are illegible soup for as long as it lasts, which is the opposite of
 * what a fade is for. The carousel is hidden rather than gone, so what shows through
 * is Stash's own backdrop.
 *
 * How long it lasts is the reader's setting — the slider in the options menu — and 0
 * draws the screen at once. Skipped entirely for a reader who has asked their system
 * for less motion: this is decoration, and decoration does not get to overrule that.
 */
function fadeIn(element: HTMLElement): void {
  if (settings.fadeMs <= 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: settings.fadeMs,
    easing: "ease-out",
  });
}

/**
 * The URL to fetch a page from.
 *
 * The path is the one this plugin has always built; the query is Stash's own,
 * lifted from the URL it publishes for the image. That query is a version stamp,
 * and sharing it is the whole reason for any of this: the server answers
 * `/image/<id>/image?t=<mtime>` with `private, max-age=31536000, immutable`, and
 * the same path *without* it with `no-cache`. So a hand-built URL does not merely
 * miss a version — it throws away the caching Stash's own lightbox has already paid
 * for. Every page ends up fetched twice, once by each, with nothing making the two
 * halves of a screen finish together, which is exactly what a reader sees as one
 * page flicking in before the other.
 *
 * The path stays relative rather than using Stash's URL whole: either resolves to
 * the same resource and so the same cache entry, and a relative one cannot be
 * broken by a base URL naming a host the browser cannot reach.
 */
function pageUrl(page: MangaReaderPage): string {
  const query = /\?.*$/.exec(page.url || "");
  return "/image/" + page.id + "/image" + (query ? query[0] : "");
}

/**
 * Resolves when the browser can paint this image without a second jolt.
 *
 * `decode()` rejects for an image that failed, which is a settle too — a screen
 * must never be held back by a page that is not coming. A DOM without `decode` has
 * no loading state to report, so there is nothing to wait for.
 */
function decodedImage(image: HTMLImageElement): Promise<unknown> {
  return typeof image.decode === "function"
    ? image.decode().catch(() => {})
    : Promise.resolve();
}

/**
 * Draws one screen, and warms the pages either side of it.
 *
 * The screen is built **detached** and shown in one step: the two images of a pair
 * are fetched in parallel and finish at different times, and a screen that appears
 * in two pieces is the flicker this avoids. Until both are ready — or the budget
 * runs out — whatever the reader is already looking at stays where it is, which for
 * a page turn means the page they just left. (On the first screen there is nothing
 * to keep, so there the wait is a blank.)
 */
function draw(screen: MangaReaderScreen, at: number): void {
  if (!container) return;

  // A fresh draw supersedes any wait in flight: whatever was being waited for is
  // not what is being drawn now. See `awaiting` for what the wait is for.
  awaiting = -1;

  // In reading order: the earlier page first in the DOM, which for a
  // right-to-left book is the right-hand one — the stylesheet reverses them, so
  // the order here stays "as read" and the direction is one CSS rule.
  const boxes: HTMLElement[] = [];
  const images: HTMLImageElement[] = [];

  screen.pages.forEach((page, index) => {
    const box = document.createElement("div");
    box.className = CLASS_PAGE;

    const image = document.createElement("img");
    image.src = pageUrl(page);
    image.alt = String(screen.start + index + 1);
    image.decoding = "async";

    box.appendChild(image);
    boxes.push(box);
    images.push(image);
  });

  const mine = ++drawGeneration;
  let revealed = false;
  const reveal = (): void => {
    // Superseded by a later turn, or the mode went off while waiting.
    if (revealed || mine !== drawGeneration || !container) return;
    revealed = true;

    // The wait is over, and the screen is a screen the container's children can
    // answer for again — which is what tells a container React has taken away from
    // one that is merely empty because nothing was drawn yet.
    if (awaiting === at) awaiting = -1;

    container.textContent = "";
    container.classList.toggle(CLASS_SINGLE, screen.pages.length === 1);
    boxes.forEach((box) => {
      container?.appendChild(box);
    });
    fadeIn(container);

    // The neighbours are warmed *after* this screen is up rather than alongside it:
    // they are four more images, and on a cold screen they would be competing for
    // the same bandwidth as the pair the reader is waiting for.
    preload(at);
  };

  // Already in the browser's cache — or a DOM that cannot say — means there is
  // nothing to wait for, and the screen goes up in the same tick as the turn.
  if (images.every((image) => image.complete !== false)) {
    reveal();
  } else {
    awaiting = at;
    Promise.all(images.map(decodedImage)).then(reveal);
    window.setTimeout(reveal, REVEAL_BUDGET_MS);
  }

  shownAt = at;

  const gallery = current();
  if (!logged && gallery) {
    logged = true;
    // One line per read, on the first gallery of the session: what was paired, and
    // where the switch that shifts it lives. The first thing to look at when the
    // pairs look wrong.
    console.info(
      "[mangaReader] " +
        gallery.screens.length +
        " screen(s) from " +
        gallery.pages.length +
        " page(s), offset " +
        offset +
        " — the lightbox's options menu can shift the pairing, and O does the same"
    );
  }
}

/**
 * Warms the images of the screens either side.
 *
 * A page turn that waits for its own bytes feels broken, and a screen is two
 * images rather than one. Nothing is awaited: this is the browser's cache being
 * filled, and with the version stamp on the URL (see pageUrl) what it fills is the
 * same entry Stash's own lightbox reads, so the next turn is a cache hit rather
 * than a fetch.
 */
function preload(at: number): void {
  const gallery = current();
  if (!gallery) return;

  for (const step of [1, -1]) {
    const screen = gallery.screens[at + step];
    if (!screen) continue;

    for (const page of screen.pages) {
      const image = new Image();
      image.src = pageUrl(page);
    }
  }
}

// ── Moving the lightbox, a page at a time ──────────────────────────

/** The page the lightbox says it is on, 0-based, or null when it cannot be read */
function currentIndex(lightbox: Element): number | null {
  const position = readPosition(lightbox);
  return position ? position.current - 1 : null;
}

/**
 * Starts moving the lightbox to a page, by whole pages.
 *
 * Called with the page index a turn of the screen lands on. Nothing is sent if the
 * lightbox is already there; otherwise the first press goes now and the rest
 * follow as it lands.
 */
function startErrand(lightbox: Element, to: number): void {
  const from = currentIndex(lightbox);
  if (from === null || from === to) return;

  endErrand();
  attempts = 0;
  errand = { from, to, retry: null };
  press(lightbox);
}

/** Sends the next press of the errand, and arms the retry that covers a dropped one */
function press(lightbox: Element): void {
  if (!errand) return;

  const from = currentIndex(lightbox);
  if (from === null) {
    endErrand();
    return;
  }
  if (from === errand.to) {
    endErrand();
    return;
  }

  errand.from = from;
  attempts += 1;
  pressArrow(from < errand.to ? 1 : -1);
  armRetry(lightbox);
}

/**
 * Waits a moment for the press to land, and sends it again if it did not.
 *
 * The lightbox drops a press that arrives while the page before it is still
 * swapping (see pressArrow), and a dropped press changes nothing in the DOM — so
 * nothing else here would ever notice. This is the only place that waits on a
 * clock rather than on the reader's own header.
 */
function armRetry(lightbox: Element): void {
  if (!errand) return;
  if (errand.retry !== null) window.clearTimeout(errand.retry);

  errand.retry = window.setTimeout(() => {
    if (!errand) return;
    errand.retry = null;

    const at = currentIndex(lightbox);
    // It landed: the drawing follows on its own, and the next press with it.
    if (at === null || at !== errand.from) return;

    if (attempts >= MAX_ATTEMPTS) {
      // Three presses that went nowhere: the lightbox is not moving for reasons
      // this plugin cannot see. Stop, and leave the reader where they are.
      console.error(
        "[mangaReader] the lightbox did not respond to the arrow keys, so the " +
          "spread view has stopped moving it — the page shown is the one it is on"
      );
      endErrand();
      return;
    }

    press(lightbox);
  }, PRESS_RETRY_MS);
}

/**
 * Carries the errand on when a press has landed — called on every DOM change.
 *
 * This is what makes a turn feel immediate: the wait between presses is the
 * lightbox's own page swap, not a timer. The timer in armRetry is only there for
 * the press that landed nowhere.
 */
function arrived(lightbox: Element): void {
  if (!errand) return;

  const at = currentIndex(lightbox);
  if (at === null) {
    endErrand();
    return;
  }
  if (at === errand.to) {
    endErrand();
    return;
  }

  // Still on the page that press started from: it has not landed yet, and the
  // timer is watching for that. Anywhere else, it landed short of the target.
  if (at !== errand.from) press(lightbox);
}

function endErrand(): void {
  if (errand && errand.retry !== null) window.clearTimeout(errand.retry);
  errand = null;
}

// ── Turning the mode on and off ────────────────────────────────────

function activate(): void {
  settings = writeSettings({ doublePage: true });
  setSwitchChecked(true);
  step();
}

/**
 * Stops drawing, and undoes everything drawing changed.
 *
 * Leaves the lightbox as it was found: the carousel visible again, the display's
 * positioning restored, the container gone. Nothing here assumes it is in a good
 * state — the mode can be turned off from the options menu at any moment, and the
 * lightbox may already be closing.
 */
function deactivate(): void {
  if (container) {
    container.remove();
    container = null;
  }

  if (root) {
    root.classList.remove(CLASS_ACTIVE);
    const display = root.querySelector(SELECTOR_DISPLAY) as HTMLElement | null;
    if (display) display.style.position = "";
  }

  shownAt = -1;
}

function closeLightbox(): void {
  handedFor = null;

  if (clickRoot) {
    clickRoot.removeEventListener("click", onNavClick, true);
    clickRoot = null;
  }

  deactivate();
  root = null;
  galleryId = null;
  logged = false;
}

// ── The lightbox's chapters ────────────────────────────────────────

/**
 * Hands the lightbox this plugin's list, and its chapters with it.
 *
 * Stash shows a chapter menu of its own, and jumps with it — `gotoPage`, which is
 * `setIndex` and lands instantly. What it will not do is show that menu for a
 * lightbox whose list is not in path order, because its chapters' numbers count in
 * path order and would point at the wrong images. Both halves of that are about
 * the *numbers*, not the menu: hand it a list and a set of chapters whose numbers
 * count in that list, and its own menu is right — in any order at all.
 *
 * Which is what this does. The images are the ones the reader draws, in the order
 * it drew them; the chapters are the reader's, numbered by where each begins on
 * screen. What appears is Stash's own chapter menu, in its own place, with this
 * plugin's chapters in it, and clicking one is Stash's own instant jump.
 *
 * **Only on a list that has been verified**, and only when a bridge is mounted to
 * receive it: a list that does not match what the lightbox is showing would not be
 * a takeover but a swap to something else, and there is no bridge on a page with no
 * list behind the lightbox — where Stash's own chapters are already there and
 * already right.
 */
function handOverChapters(
  lightbox: Element,
  gallery: MangaReaderGallery
): void {
  if (!bridged()) return;
  if (handedFor?.lightbox === lightbox && handedFor.gallery === gallery.id)
    return;

  handedFor = { lightbox, gallery: gallery.id };
  takeOver({
    images: gallery.images,
    chapters: gallery.chapters,
    totalCount: gallery.images.length,
  });
}

// ── The switch in the lightbox's own options menu ──────────────────

/**
 * Adds this plugin's switches to the lightbox's options popover, once per opening.
 *
 * The same markup Stash's own options use (a `form-group` holding `form-check`s),
 * so they read as part of the menu rather than as something bolted on. Injected
 * into whatever popover is on screen at the time, because the popover is rebuilt
 * from scratch each time it is opened — which is also why these cannot be React
 * components of ours: there is no patch point in there.
 *
 * The mode switch is always there. The offset one appears only while a gallery is
 * in hand, because the offset is a page pairing and there is no pairing without
 * one — and it is the escape hatch for a page that was taken for a spread and was
 * not one, so it belongs where the reader looks when the pairs look wrong.
 *
 * A reader who opens the menu before this plugin has read a gallery's language
 * gets the English wording; the next opening has the right one.
 */
function injectSwitch(lightbox: Element): void {
  const body = lightbox.querySelector(SELECTOR_POPOVER_BODY);
  if (!body) return;

  // The group is put there once and completed afterwards: the menu can be opened
  // before the gallery's pages have arrived — two clicks from opening the lightbox
  // is enough — and the offset switch has nothing to offer until they have.
  const existing = body.querySelector("." + CLASS_OPTIONS);
  if (existing) {
    addOffsetSwitch(existing);
    return;
  }

  const group = document.createElement("div");
  group.className = "form-group " + CLASS_OPTIONS;
  group.appendChild(
    checkbox({
      id: SWITCH_ID,
      label: labelFor(language, "doublePage"),
      checked: settings.doublePage,
      onChange: (checked) => {
        if (checked) {
          activate();
        } else {
          settings = writeSettings({ doublePage: false });
          deactivate();
        }
      },
    })
  );

  // Beside the switch, because it is the same kind of thing: a reading preference
  // that lives with Stash's own in this menu. Its range reaches somewhere
  // unmistakable on purpose — a reader who cannot see a short fade has to be able to
  // find out whether it is working.
  group.appendChild(
    slider({
      id: FADE_ID,
      label: labelFor(language, "fade"),
      value: settings.fadeMs,
      max: FADE_MAX_MS,
      step: 20,
      unit: " ms",
      onChange: (value) => {
        settings = writeSettings({ fadeMs: value });
      },
    })
  );

  addOffsetSwitch(group);
  body.appendChild(group);
}

/**
 * A number the reader picks by dragging — this plugin's one setting that is not a
 * switch.
 *
 * A range input rather than a number box because the value is a feel and not a
 * figure, with the figure shown beside it so that "140" can mean something. `input`
 * rather than `change`, so what it sets follows the drag and a reader can find the
 * setting that suits them by looking.
 */
function slider(option: {
  id: string;
  label: string;
  value: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}): Element {
  const row = document.createElement("div");
  row.className = "row mb-1";

  const column = document.createElement("div");
  column.className = "col";

  const label = document.createElement("label");
  label.className = "form-label mb-0";
  label.htmlFor = option.id;
  label.textContent = option.label;

  const readout = document.createElement("span");
  readout.className = "ml-1";
  readout.textContent = option.value + option.unit;
  label.appendChild(readout);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "form-control-range";
  input.id = option.id;
  input.min = "0";
  input.max = String(option.max);
  input.step = String(option.step);
  input.value = String(option.value);

  input.addEventListener("input", () => {
    const value = Number(input.value);
    // The readout follows the drag rather than the next render: nothing else
    // redraws this menu while the reader is dragging.
    readout.textContent = value + option.unit;
    option.onChange(value);
  });

  column.appendChild(label);
  column.appendChild(input);
  row.appendChild(column);

  return row;
}

/** Adds the offset switch to the group, once there is a gallery to shift */
function addOffsetSwitch(group: Element): void {
  if (!current() || group.querySelector("#" + OFFSET_ID)) return;

  group.appendChild(
    checkbox({
      id: OFFSET_ID,
      label: labelFor(language, "offset"),
      checked: offset === 1,
      onChange: (checked) => {
        const gallery = current();
        if (gallery) setOffset(gallery, checked ? 1 : 0);
      },
    })
  );
}

/** One option row, in Stash's own markup: a form-check inside a row's column */
function checkbox(option: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): Element {
  const row = document.createElement("div");
  row.className = "row mb-1";

  const column = document.createElement("div");
  column.className = "col";

  const check = document.createElement("div");
  check.className = "form-check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = option.id;
  input.checked = option.checked;

  const text = document.createElement("label");
  text.className = "form-check-label";
  text.htmlFor = option.id;
  text.textContent = option.label;

  input.addEventListener("change", () => option.onChange(input.checked));

  check.appendChild(input);
  check.appendChild(text);
  column.appendChild(check);
  row.appendChild(column);

  return row;
}

/**
 * Keeps a switch in step when the state changes by another route.
 *
 * Both switches can be changed without being clicked — the mode by its own key
 * handling, the offset by `O` — and a checkbox that disagrees with what the reader
 * sees on screen is worse than no checkbox.
 */
function setSwitchChecked(checked: boolean): void {
  setChecked(SWITCH_ID, checked);
}

function setOffsetSwitchChecked(checked: boolean): void {
  setChecked(OFFSET_ID, checked);
}

function setChecked(id: string, checked: boolean): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.checked = checked;
}

// ── Keys ───────────────────────────────────────────────────────────

/**
 * Whether the arrow keys belong to whatever has focus.
 *
 * Only things the arrows actually *do* something to: a text field moves its caret,
 * a range input its handle. This listener is on the window, so without this it
 * would take the arrows from anything on the page.
 *
 * A **checkbox is not one of those** — the arrows do nothing to it; space is what
 * toggles it — and a checkbox is what this plugin's own switch in the lightbox's
 * options menu is. Exempting every `<input>` therefore meant that turning the mode
 * off and on *from that menu* left the focus on the switch, and the reader's next
 * arrow went straight past the reader to Stash's own handler, one page at a time:
 * "it only happens while the menu is open, and closing the menu fixes it".
 *
 * Written as the list of types that eat arrows rather than the list that does not,
 * so an input type nobody thought of leaves the arrows to the reader.
 */
function arrowsBelongTo(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;

  const type = ((target as HTMLInputElement).type || "text").toLowerCase();
  return (
    [
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "range",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ].indexOf(type) !== -1
  );
}

/**
 * Handles the arrows while the spread view is up, and the offset key.
 *
 * Listens on `window` **in the capture phase**, which is what puts it in front of
 * the lightbox's own handler on `document`: the event path runs window, then
 * document, then the target. The event is then stopped there, and this plugin
 * moves the lightbox itself — by whole screens rather than by pages, which is the
 * whole point of the mode.
 *
 * Events this plugin dispatched are ignored, by `isTrusted`: they are how the
 * lightbox is moved (see pressArrow), they are what was asked for already, and
 * handling them again would double every step.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (!event.isTrusted || !wanted() || !root) return;

  const lightbox = root;
  const gallery = current();
  if (!gallery) return;

  if (event.key === "o" || event.key === "O") {
    if (event.repeat) return;

    setOffset(gallery, offset === 0 ? 1 : 0);

    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

  // Holding an arrow down repeats, and Stash's own handler ignores repeats for the
  // arrows: paging twice as fast while a key is held is not what it does, and this
  // plugin is not going to start.
  if (event.repeat) return;

  if (arrowsBelongTo(event.target as HTMLElement | null)) return;

  // Nothing that way: leave the event to Stash, which will do exactly as much,
  // which is nothing. Consuming it here would only be a lie about having moved.
  if (!turnBy(lightbox, event.key === "ArrowRight" ? 1 : -1)) return;

  event.preventDefault();
  event.stopPropagation();
}

/**
 * Turns the lightbox by one *screen* in `direction`, and says whether it moved.
 *
 * The one place a turn happens, so that the three ways to ask for one — this
 * plugin's arrow keys, Stash's nav buttons and a click on a page — cannot disagree
 * about what a turn is. `false` means there is no screen that way, which is
 * deliberately not the same as having moved: a caller that says something happened
 * when nothing did is worse than one that says nothing.
 */
function turnBy(lightbox: Element, direction: 1 | -1): boolean {
  const gallery = current();
  if (!gallery) return false;

  const at = currentIndex(lightbox);
  if (at === null) return false;

  const steps = stepsToAdjacent(gallery.screens, at, direction);
  if (steps === 0) return false;

  startErrand(lightbox, at + steps);
  return true;
}

/**
 * The icon Stash put inside one of its nav buttons, or "" when there is none.
 *
 * Walked rather than queried, and by hand: the two buttons are the same component
 * twice, so this is what tells them apart, and `data-icon` is Font Awesome's own
 * attribute rather than a class of Stash's that could be renamed.
 */
function navIcon(button: Element): string {
  for (const child of Array.from(button.children)) {
    const name = (child as HTMLElement).dataset?.icon;
    if (name) return name;
  }
  return "";
}

/** Which way a click on Stash's nav buttons goes, or 0 for anything else */
function navDirection(target: Element | null): 1 | -1 | 0 {
  let el: Element | null = target;
  while (el && !el.classList?.contains(CLASS_NAVBUTTON)) el = el.parentElement;
  if (!el) return 0;

  const icon = navIcon(el);
  if (icon === "chevron-right") return 1;
  if (icon === "chevron-left") return -1;

  // An icon this plugin does not recognise: leave the button to Stash rather than
  // guess a direction from the order the two happen to be rendered in.
  return 0;
}

/**
 * Stash's own nav buttons, taken over the way its arrow keys are.
 *
 * They are Stash's buttons and they move one page, which in a two-page view is the
 * same screen — so a reader who clicks the chevrons sees nothing happen, twice. The
 * click is stopped before Stash's own handler sees it and the same turn an arrow
 * press starts is started instead.
 *
 * On the lightbox in the capture phase, because the buttons are Stash's and may be
 * re-rendered at any time: one listener that survives that is worth more than two
 * on elements that do not.
 */
function onNavClick(event: Event): void {
  if (!wanted() || !container || !root) return;

  const direction = navDirection(event.target as Element | null);
  if (!direction) return;

  if (turnBy(root, direction)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * A click on this plugin's own pages, and on the space around them.
 *
 * Both are Stash's behaviours, which the container would otherwise swallow by
 * covering the slide they used to land on:
 *
 *   - **on a page**: the right half turns forward and the left half back, exactly
 *     as Stash's own image click does (LightboxImage.tsx). Read per image, as Stash
 *     reads it, rather than per screen — a pair is two images and each half of each
 *     one goes the way the reader who clicked it meant.
 *   - **anywhere else**, the letterbox: Stash closes the lightbox when a click
 *     reaches the slide, and the whole slide is behind these pages.
 */
function onSpreadClick(event: Event): void {
  const lightbox = root;
  if (!lightbox || !container) return;

  const target = event.target as HTMLElement | null;
  if (target?.tagName !== "IMG") {
    event.stopPropagation();
    pressEscape();
    return;
  }

  // `offsetX` is the click's place inside the image itself, which is how Stash
  // reads it too: per image, not per screen. A width that cannot be compared —
  // nothing laid out yet — goes forward, which is the direction a click on a page
  // means when there is nothing to read into it.
  const click = event as MouseEvent;
  const width = target.offsetWidth;
  const forward = !width || click.offsetX >= width / 2;
  if (turnBy(lightbox, forward ? 1 : -1)) event.stopPropagation();
}

/**
 * Shifts a gallery's pairing by one page, or puts it back, and remembers it.
 *
 * Two ways in — the key and the switch in the options menu — and both come through
 * here, so they cannot disagree about what the offset is.
 */
function setOffset(gallery: MangaReaderGallery, next: 0 | 1): void {
  offset = next;
  offsetFor = gallery.id;
  writeOffset(gallery.id, next);

  gallery.screens = layout(gallery.pages, { ...settings, offset });
  shownAt = -1;

  setOffsetSwitchChecked(next === 1);
  step();
}

// ── Wiring ─────────────────────────────────────────────────────────

/**
 * Starts watching. Called once, when the script loads.
 *
 * An observer on the whole document rather than a listener on the lightbox,
 * because the lightbox is created and destroyed by Stash and there is no moment to
 * attach to. `subtree` because everything interesting happens below the body, and
 * the handler is cheap enough to run on every batch — see `step`.
 */
export function install(): void {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", install);
    return;
  }

  const observer = new MutationObserver(() => {
    try {
      step();
    } catch (e) {
      // An observer callback that throws is an observer that never runs again,
      // which would take the reader off the page silently. Report, and put the
      // lightbox back the way it was: whatever is wrong, the reader can still read.
      console.error(
        "[mangaReader] the reader failed and has been turned off:",
        e
      );
      deactivate();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", onKeyDown, true);

  // Before the first pass, so that a gallery read in the same tick has somewhere
  // to hand its chapters. See handOverChapters.
  installBridge();

  // The store answers a moment after the page loads, and until it does nothing here
  // knows whether a gallery is manga. So the pass that the answer makes possible runs
  // when it arrives, rather than waiting for something else to change the page.
  NS.watchStore(() => step());

  // The switch is a setting, not a mode: nothing is drawn until the reader turns it
  // on, but the observer has to be running for the switch to be there at all.
  step();
}
