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
 *   3. hides Stash's own header and carousel with classes — see `claim`, which does
 *      it the moment the lightbox is known to be one of this gallery's rather than
 *      when there is something to draw, so a reader never watches the wrong pages be
 *      replaced — and puts a container of its own beside the carousel and lays the
 *      pages out in it;
 *   4. keeps its **own idea of where the reader is** — a page, `place` — and never
 *      moves Stash's carousel. Stash's own two ways of turning move one *page* where
 *      a screen is one or two of them, and it drops a press that arrives while the
 *      last one is still swapping; so the three ways a reader has of asking for a
 *      turn all end in `turnBy`, which is arithmetic on `place`.
 *
 * WHAT IT IS RESPONSIBLE FOR, which is a lot for one file — the reason this list is
 * here is that the next thing added should be weighed against it: the pass over the
 * document and the gallery read behind it; the container and the screens drawn in it;
 * the gestures on those pages (a click that turns, a wheel that turns, a drag that
 * pans); the chapters — their menu in the header, and the tab on the gallery's own
 * page; the progress bar; the header; the footer's own name for the page; and the
 * route, which closes the lightbox when it changes underneath one. If any of it is
 * ever lifted out, the candidates are the gestures and the position — which are also
 * the two with the most interaction between them, and the source of nearly every bug
 * this half has had. See the note on state in progress.ts.
 *
 * The approach follows kokkengMangaViewer (github.com/kokkeng1/stash_plugin_custom),
 * which does the same thing for a scrolling view. Its lesson worth repeating is
 * that this is a *degradable* feature: everything that reads Stash's markup returns
 * null rather than guessing, and a null turns the mode off and says so. The worst
 * case is a reader who has to press a switch again, never a blank screen.
 */
// The field plumbing both halves share: this one reads the same custom fields the
// tools half writes, under the same names, through the same helpers.
import { requirePluginApi } from "../plugin-api";
// Imported for what it publishes on the reader's namespace, not for anything it
// exports: the chapter import has no caller in this half — the settings panel asks
// the reader half for it through `window.MangaReader` — and a module nothing
// imports is a module whose body never runs.
import "./chapters-import";
// The same, for the other half of the chapter work: the editor's write is called from
// chapters-tab.ts and this half's own cached copy is updated by what it announces.
import "./chapters-edit";
import { watchChapters } from "./chapters-edit";
import { NS } from "../tools/fields";
import { bridged, installBridge, takeOver } from "./bridge";
import { ensureChrome, forgetOpenMenu, removeChrome } from "./chrome";
import { syncChaptersTab } from "./chapters-tab";
import { syncFooter } from "./footer";
import {
  PROGRESS_IDLE_MS,
  PROGRESS_SCRUB_MS,
  ensureProgress,
  fractionOfPage,
  pageAtFraction,
  progressNodes,
  removeProgress,
} from "./progress";
import {
  type MangaReaderChapter,
  chapterAt,
  chaptersFromStash,
  parseChapters,
  placeChapters,
} from "./chapters";
import { NR, type MangaReaderOrder } from "./namespace";
import type { MangaReaderGallery, MangaReaderSettings } from "./namespace";
import { FADE_MS, readSettings, writeSettings } from "./settings";
import {
  CLASS_SCROLL,
  CLASS_SCROLLING,
  CLASS_SCROLL_PAGE,
  buildColumn,
  columnZoom,
  rowOffset,
  setColumnZoom,
  zoomedBy,
} from "./scroll";
import type { MangaReaderPage, MangaReaderScreen } from "./spreads";
import { layout, screenAt, stepsToAdjacent } from "./spreads";
import {
  CLASS_NAVBUTTON,
  SELECTOR_DISPLAY,
  SELECTOR_LIGHTBOX,
  type GalleryAnswer,
  carouselImage,
  fetchGallery,
  lightboxIsLoading,
  galleryIdFromPath,
  inFullscreen,
  lightboxOrder,
  pressEscape,
} from "./stash-lightbox";
import {
  VIEW_CLICK_MS,
  VIEW_MAX_ZOOM,
  VIEW_MIN_ZOOM,
  VIEW_PAN_STEP,
  VIEW_STEP,
  type MangaReaderView,
  centred,
  fitView,
  isZoomed,
  panned,
  zoomed,
} from "./zoom";

/**
 * The three switches' words, in the interface's language.
 *
 * The ids are this half's own, so the union is what keeps a typo from rendering
 * an id: the catalog lookup itself takes any string and falls back to the id
 * when it finds nothing, which is the right behaviour for a message that is
 * missing and the wrong one for a name that was never spelled right.
 */

/** A screen of one page, which the stylesheet lays out differently */
const CLASS_SINGLE = "is-single";
/** On the pages while they are zoomed: the one thing about a zoom the CSS can see */
const CLASS_ZOOMED = "is-zoomed";

/** Class on Stash's lightbox while this plugin is drawing inside it */
const CLASS_ACTIVE = "manga-reader-active";
/** This plugin's own container, and the pages in it */
const CLASS_SPREAD = "manga-reader-spread";
const CLASS_PAGE = "manga-reader-page";
/**
 * On the lightbox while this plugin has taken it over: its carousel, its header and
 * its footer are hidden by the stylesheet, and the pages and the header in their place
 * are this plugin's.
 */
const CLASS_TAKEOVER = "manga-reader-takeover";

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
 * Where the pages are drawn: fitted, moved, and at what scale.
 *
 * The pan is per screen and the zoom is not — see `centred`, which is what a turn
 * does to this. Reset when the lightbox closes, because the next gallery is not this
 * one and opening it at the last one's zoom would be a surprise.
 */
let view: MangaReaderView = fitView();

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
 * Where the reader is, in the pages of the gallery it is reading.
 *
 * This plugin's own, and that is the point of taking the lightbox over: Stash's own
 * idea of which image it is on stays under a carousel and a header this plugin hides,
 * and nothing here consults it after the first moment. A turn is arithmetic on this,
 * not a keystroke aimed at somebody else's index — which is what the errand machinery
 * (press, wait for the header to land, press again, give up after three tries) was
 * for, and it is gone with it.
 *
 * -1 until the gallery is read and the lightbox has said which image it is showing.
 */
let place = -1;

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
    place = -1;
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

  // Claimed before anything can be drawn in it.
  //
  // Stash's lightbox opens wearing its own chrome — its own counter, its own idea of
  // which order the pages are in, its own page in the carousel — and what this plugin
  // draws instead waits on a query. So the claiming comes first, the moment the
  // lightbox is known to be one of this gallery's, and the drawing follows when there
  // is something to draw. A lightbox that is empty for the length of a query is an
  // honest one; a flash of pages the reader is not going to be shown is not.
  claim(lightbox);

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
}

/**
 * Takes the lightbox over before there is anything to put in it.
 *
 * The two classes hide Stash's chrome and its carousel — see the stylesheet — and
 * draw nothing of this plugin's. So the lightbox is empty for as long as the gallery
 * takes to answer, and `deactivate` hands it all back if the answer never comes: the
 * worst case is a reader who waits and then has Stash's own lightbox, not one left
 * with no lightbox at all.
 */
function claim(lightbox: Element): void {
  lightbox.classList.add(CLASS_ACTIVE);
  lightbox.classList.add(CLASS_TAKEOVER);
}

/**
 * Whether the reader should be drawing, as far as can be told without asking.
 *
 * The mode is not part of this any more. It used to be — with the switch off, Stash's
 * own lightbox was left to draw — and taking the lightbox over is what removes the
 * distinction: on a gallery that is manga, this plugin draws, and the switch only says
 * whether a screen is one page or two. A reader who wants none of it unmarks the
 * gallery; that is the gate, and the only one.
 */
function wanted(): boolean {
  const id = galleryIdFromPath(window.location.pathname);
  return root !== null && id !== null && NS.markedInStore(id) === true;
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
}

/** The pages of the gallery being read, if they are in hand */
function current(): MangaReaderGallery | null {
  return galleryId ? loaded.get(galleryId) || null : null;
}

/**
 * A gallery's pages, cut into screens the way the settings in hand say.
 *
 * One place rather than three. The call sites differ only in which gallery they are
 * laying out, and an option written in one of them and forgotten in another is a
 * gallery that reads differently depending on how it was opened — which is what the
 * offset did while it was a per-gallery value read at load: a gallery opened one way
 * was paired one way and opened another way was paired the other.
 */
function laidOut(pages: MangaReaderPage[]): MangaReaderScreen[] {
  return layout(pages, {
    coverAlone: settings.coverAlone,
    detectSpreads: settings.detectSpreads,
    // The setting is a yes or no; the layout's own word for it is a page count.
    offset: settings.offset ? 1 : 0,
    double: settings.readingMode === "double",
  });
}

/**
 * What a gallery's screens were laid out by, as one string.
 *
 * Everything `laidOut` reads, in one value, so that "is this gallery cut the way the
 * settings say" is a comparison rather than a list of flags to keep in step — and so
 * that a setting added to the layout changes the answer without anyone remembering to
 * come back here.
 */
function pairingKey(): string {
  return [
    settings.readingMode,
    settings.coverAlone,
    settings.detectSpreads,
    settings.offset,
  ].join("|");
}

/** Asks Stash for the gallery's pages, unless they are already in hand */
function loadGallery(id: string): void {
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
        pairedWith: pairingKey(),
        screens: laidOut(answer.pages),
        chapters: placeChapters(chaptersOf(answer), answer.pages),
      };
      remember(id, gallery);

      language = answer.language;
      galleryId = id;
      shownAt = -1;
      place = -1;
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

  // Where the reader is, found by *which image* the lightbox is showing rather than by
  // counting to it: the carousel says what its current image is, and this plugin's
  // pages say where that image is in the list it fetched. No assumption about the
  // order stands between the two — the same image is the same image in any order.
  //
  // A carousel that cannot be read concludes nothing, and the list stands as fetched.
  const shown = carouselImage(lightbox);
  if (!shown) return answer;

  if (!answer.pages.some((page) => page.id === shown.id)) {
    throw new Error(
      "[mangaReader] the lightbox is showing image " +
        shown.id +
        ", which is not among the pages this plugin read — the list behind it is " +
        "filtered, so its pages cannot be paired"
    );
  }

  return answer;
}

/** Where the image the lightbox is showing sits in a gallery's pages, or -1 */
function placeOf(gallery: MangaReaderGallery, lightbox: Element): number {
  const shown = carouselImage(lightbox);
  if (!shown) return -1;

  for (let i = 0; i < gallery.pages.length; i++) {
    if (gallery.pages[i].id === shown.id) return i;
  }

  return -1;
}

/**
 * A gallery's chapters, from this plugin's own list or from Stash's.
 *
 * Ours when it is there, Stash's when it is not — and *nothing is written* by
 * reading either way. A gallery nobody has imported stays on Stash's numbers for as
 * long as it exists, which is what makes this feature safe to have on a library that
 * has chapters already: opening one changes nothing, and the plugin's own list
 * appears only for a gallery whose chapters somebody has actually imported — see
 * chapters-import.ts for the write and chapters-tab.ts for the button.
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

  // A lightbox that is fetching or swapping shows a spinner *instead of* its header
  // and its carousel, and that is not a lightbox this plugin cannot follow — it is one
  // that is busy. What is on screen is still the screen the reader is on, so nothing
  // is drawn, nothing is decided, and the next pass finds it back.
  if (lightboxIsLoading(lightbox)) return;

  // Where the reader is, once: the lightbox says which image it is showing, and this
  // plugin's pages say where that image is. After this the position is this plugin's
  // own — a turn moves it, a chapter sets it, and Stash's index is never asked again.
  // The screens are a function of the settings, so a gallery laid out under other ones
  // is laid out again here rather than drawn the old way — including one fetched
  // earlier in the session and opened again after a switch was moved.
  if (gallery.pairedWith !== pairingKey()) {
    gallery.screens = laidOut(gallery.pages);
    gallery.pairedWith = pairingKey();
    shownAt = -1;
  }

  if (place < 0) {
    place = placeOf(gallery, lightbox);

    if (place < 0 && gallery.pages.length > 1) {
      console.error(
        "[mangaReader] the lightbox is showing an image this plugin did not read, so " +
          "the spread view cannot follow it — turning itself off"
      );
      deactivate();
      return;
    }
  }

  ensureChrome(lightbox, chromeState(gallery, lightbox));
  lightbox.classList.add(CLASS_TAKEOVER);

  const at = screenNow(gallery);

  // The footer's own name for the page, which Stash cannot work out for itself: its
  // render is of the place it mounted at, and this half is the only thing that knows
  // where the reader is now. See footer.ts. Before the screen's own early return,
  // because a footer left stale is stale whatever the screen is doing.
  const page = pageAt(gallery, at);
  syncFooter(lightbox, page < 0 ? null : gallery.images[page] || null);

  // The same position said as a fraction of the book, and the one gesture that
  // crosses it. See progress.ts. In the third mode the bar is a column too, and it is
  // drawn in the picture area rather than in a row of its own.
  const scrolling = settings.readingMode === "scroll";

  if (scrolling) {
    ensureProgress(lightbox, progressState(gallery, at, lightbox));
    ensureColumn(lightbox, gallery);
    return;
  }

  removeColumn();
  if (at >= 0) ensureProgress(lightbox, progressState(gallery, at, lightbox));

  if (at < 0) return;

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
 * Everything the progress bar draws from, gathered at the moment it is drawn.
 *
 * The page the chapter name is asked for is the *reader's* page number, and the
 * answer comes from the same membership rule the header's own name uses — see
 * chapterAt — so the bar cannot name a different chapter than the header does.
 */
function progressState(
  gallery: MangaReaderGallery,
  at: number,
  lightbox: Element
): Parameters<typeof ensureProgress>[1] {
  const screen = gallery.screens[at];
  const scrolling = settings.readingMode === "scroll";
  return {
    at: Math.max(pageAt(gallery, at), 0),
    total: gallery.pages.length,
    // The column's bar is a column too, and its extent is the picture area's rather
    // than a measurement of the pages — see progress.ts.
    width: scrolling ? 0 : pictureWidth(screen?.pages.length ?? 0),
    vertical: scrolling,
    chapters: gallery.chapters,
    chapterNameAt: (page) =>
      chapterAt(gallery.chapters, gallery.pages[page]?.id || "")?.title || "",
    locale: language,
    handlers: {
      onSeek: (to: number) => seekTo(lightbox, to),
    },
  };
}

/**
 * Everything the header draws from, gathered at the moment it is drawn.
 *
 * The chapter the reader is in comes from the chapter's own list of images — an image
 * in no chapter is in none, and the header says so rather than naming the chapter
 * before it. That is the answer Stash's own header could not give, and one of the
 * reasons this one is the plugin's.
 */
function chromeState(
  gallery: MangaReaderGallery,
  lightbox: Element
): Parameters<typeof ensureChrome>[1] {
  const at = screenNow(gallery);
  const image =
    at < 0 ? null : gallery.images[gallery.screens[at].start] || null;
  const pageId = gallery.pages[pageAt(gallery, at)]?.id || "";

  return {
    image,
    number: Math.max(place, 0) + 1,
    total: gallery.pages.length,
    chapter: chapterAt(gallery.chapters, pageId),
    chapters: gallery.chapters,
    placed: gallery.chapters,
    settings,
    locale: language,
    zoomed: zoomedNow(),
    handlers: {
      onResetZoom: () => {
        // Which of the two zooms is in hand is the mode's business, and the button
        // does not care: what a reader pressing it means is "back to the size the
        // pages fit at", in whichever of the two that is.
        view = fitView();
        if (settings.readingMode === "scroll") {
          setColumnZoom(1);
          scrollTo = Math.max(place, 0);
        }
        applyView();
        sync(lightbox);
      },
      onChapter: (to: number) => {
        place = to;
        // A chapter is a page to go to, and in the column that means scrolling to it;
        // in the screen modes the next pass draws the screen it is in.
        if (settings.readingMode === "scroll") scrollTo = to;
        step();
      },
      onSetting: (next: Partial<MangaReaderSettings>) => {
        settings = writeSettings(next);

        // Three of these settings are questions about how the pages are laid out —
        // one page or two, whether the cover stands alone, whether a wide page is a
        // spread — and every one of them has to re-lay the pages, or the reader
        // flips one and watches nothing happen until they reopen the lightbox. The
        // fade length is the one that is not: re-laying the pages because somebody
        // dragged a slider would redraw the screen they are looking at, for a setting
        // that cannot change it.
        // Nothing is re-laid here: the pass that follows compares what the settings
        // say against what this gallery was cut by — `pairedWith` — and lays it out
        // again when they differ. One place that decides a layout rather than two,
        // which is how the stale cache and the freshly-pushed setting stayed in step.
        //
        // The pass runs whatever changed, including a setting that moves no page at
        // all: a switch carries its own state and would look right either way, but a
        // pair of buttons does not — the half that was pressed has to *become* the
        // chosen one, and a mark that only moves on the next pass is a press that
        // looks like it did nothing.
        sync(lightbox);
      },
      onOffset: (next) => {
        setOffset(gallery, next);
        shownAt = -1;
        sync(lightbox);
      },
      onClose: () => pressEscape(),
    },
  };
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
    container.addEventListener("wheel", onSpreadWheel);
    container.addEventListener("mousedown", onSpreadPress);
    // The third mode's own way of moving the reader. Harmless in the other two: a
    // screen is not a scroll box and fires nothing.
    container.addEventListener("scroll", onColumnScroll);
    // An image that has not arrived measures nothing, and the progress bar is as wide
    // as the pages: this is the one event that says they are here, since a picture
    // finishing is not a change to the document for the observer to see.
    container.addEventListener(
      "load",
      () => {
        if (root) sync(root);
      },
      true
    );
  }

  // Stash's own layers above this one are positioned; this makes the display the
  // containing block for the container rather than the page.
  (display as HTMLElement).style.position = "relative";
  display.appendChild(container);
  lightbox.classList.add(CLASS_ACTIVE);
}

/**
 * The gallery the column was built for, or null when no column is up.
 *
 * A column is not redrawn per pass the way a screen is: its rows are every page of
 * the gallery, and rebuilding them would throw away the reader's scroll position —
 * which in this mode *is* where they are.
 */
let columnFor: string | null = null;

/**
 * A page the column is to be scrolled to, or null when nothing has asked.
 *
 * Written only by the things that *move* the reader: a turn, a chapter, the bar, and
 * the mode being entered. Never by the reader's own scrolling, because a request put
 * in by that would be this plugin undoing what they just did.
 */
let scrollTo: number | null = null;

/**
 * The column of pages: built once per gallery, and then scrolled rather than drawn.
 *
 * `ensureContainer` first, because this is the same container the other two modes
 * draw a screen into — the one that covers Stash's carousel. What changes is what is
 * inside it and how it behaves: a row per page, in reading order, scrolled by the
 * browser rather than turned a screen at a time.
 *
 * The transform goes: the zoom is a transform on this container and a scroll box
 * cannot be transformed (`clientX` stops meaning what it meant, and the scrolled
 * content moves with it). There is nothing to zoom in this mode anyway — a page is
 * already as wide as the picture area.
 */
function ensureColumn(lightbox: Element, gallery: MangaReaderGallery): void {
  ensureContainer(lightbox);
  if (!container) return;

  container.classList.add(CLASS_SCROLL);
  // And the mode on the lightbox, for the one rule that is about Stash's own furniture
  // rather than this plugin's: the chevron that sits where this bar now is. See the
  // stylesheet.
  lightbox.classList.add(CLASS_SCROLLING);
  container.style.transform = "";
  view = fitView();

  let built = false;
  if (columnFor !== gallery.id) {
    buildColumn(container, gallery.pages, (page) => pageUrl(page));
    columnFor = gallery.id;
    built = true;
    // Nothing to wait for: every row's height comes from the page's own shape, so the
    // column is complete the moment it is built.
    awaiting = -1;
    // A fresh column at the size the pages fit at, like a fresh screen: the zoom is
    // this reader's for as long as they are reading, and coming back to the mode is
    // not asking for the last one. Here rather than above, because this runs on every
    // pass — and a reset on every pass is a zoom that never happens.
    setColumnZoom(1);
  }

  // Where the reader is, in the column's own coordinates. On a fresh column that is
  // the page they were on — the mode was switched, and the place did not move — and
  // otherwise only when something asked.
  const to = built ? place : scrollTo;
  scrollTo = null;
  if (to === null || to < 0) return;

  const offset = rowOffset(container, to);
  if (offset !== null) container.scrollTop = offset;
}

/**
 * Takes the column away, for a mode that draws screens.
 *
 * Only when there is one: this is called on every pass of the other two modes, and
 * doing its work then — clearing the class, and the transform with it — would be this
 * function undoing the zoom on every pass of a lightbox that never had a column in it.
 */
function removeColumn(): void {
  if (columnFor === null) return;

  columnFor = null;
  scrollTo = null;
  view = fitView();
  setColumnZoom(1);
  // And the screen is drawn again: while the column was up, nothing was drawn into
  // this container and `shownAt` still says the screen from before it — which the pass
  // would take for the screen already on show, leaving the reader the column's own rows
  // in a mode that has no column.
  shownAt = -1;
  container?.classList.remove(CLASS_SCROLL);
  root?.classList.remove(CLASS_SCROLLING);
}

/** Which page the column is showing at its top, from where its rows are */
function columnPageAt(column: HTMLElement): number {
  const rows = Array.from(column.querySelectorAll("." + CLASS_SCROLL_PAGE)).map(
    (row) => (row as HTMLElement).getBoundingClientRect()
  );

  return NR.pageAtTop(
    rows.map((rect) => ({ top: rect.top, bottom: rect.bottom })),
    column.getBoundingClientRect().top
  );
}

/**
 * The reader scrolled the column, so the page at the top is where they are now.
 *
 * This is not the same thing as the pass that follows it. That pass draws whatever
 * the mode says, and in this mode what it draws depends on `place` — so if this asked
 * for a scroll as well, the reader's own scrolling would be undone by the answer to
 * it. It does not: only a turn, a chapter, the bar, or the mode being entered puts a
 * request in `scrollTo`, and this is none of those.
 */
function onColumnScroll(): void {
  const lightbox = root;
  if (!lightbox || !container) return;
  if (settings.readingMode !== "scroll" || !wanted()) return;

  const at = columnPageAt(container);
  if (at < 0 || at === place) return;

  place = at;
  sync(lightbox);
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
 * The page the reader is on in a gallery, by id, or null when they are not in it.
 *
 * Published for the Chapters tab, which cannot see the lightbox's own state and has
 * no business asking Stash's counter: the tab's form opens on the page somebody was
 * reading, and an *id* is what survives the two halves counting in different orders.
 */
NR.readingPageIdNow = (galleryId: string): string | null => {
  const gallery = loaded.get(galleryId);
  if (!gallery || place < 0) return null;

  return gallery.pages[place]?.id ?? null;
};

/**
 * A chapter list was written — by the tab's form, or by an import.
 *
 * The cached gallery is drawn from the list it was read with, so it is drawn from a
 * list that is now out of date: the chapter menu and the progress bar's ticks would
 * go on showing the chapters as they were. What was written comes with the news, so
 * there is nothing to fetch — the same chapters placed in the order this half is
 * already using, and the lightbox's own furniture is right again. The reader is not
 * moved: a rename or a boundary is not a reason to turn a page.
 */
watchChapters((galleryId, chapters) => {
  const gallery = loaded.get(galleryId);
  if (!gallery) return;

  gallery.chapters = placeChapters(chapters, gallery.pages);
  if (root) sync(root);
});

// The zoom's arithmetic, published the way the layout's and the chapters' are: it is
// pure, it is where a bug would hide from a DOM test, and a test that can call it
// directly is the cheaper way to pin it.
NR.fitView = fitView;
NR.centred = centred;
NR.zoomed = zoomed;
NR.panned = panned;
NR.isZoomed = isZoomed;
NR.VIEW_MIN_ZOOM = VIEW_MIN_ZOOM;
NR.VIEW_MAX_ZOOM = VIEW_MAX_ZOOM;
NR.VIEW_STEP = VIEW_STEP;
NR.VIEW_CLICK_MS = VIEW_CLICK_MS;

// The progress bar's arithmetic, published for the same reason the zoom's is: the
// fractions and the snapping are where a mistake would be invisible in a DOM test.
NR.fractionOfPage = fractionOfPage;
NR.pageAtFraction = pageAtFraction;
NR.progressNodes = progressNodes;
NR.PROGRESS_SCRUB_MS = PROGRESS_SCRUB_MS;
NR.PROGRESS_IDLE_MS = PROGRESS_IDLE_MS;

/**
 * Fades a screen in as it arrives.
 *
 * Against the lightbox's own background, not over the page before it. A cross-fade
 * is smoother on a photograph and worse on everything else: two pages of text
 * superimposed are illegible soup for as long as it lasts, which is the opposite of
 * what a fade is for. The carousel is hidden rather than gone, so what shows through
 * is Stash's own backdrop.
 *
 * Whether it happens at all is the reader's setting — the pair of buttons in the
 * options panel — and how long it takes is FADE_MS, which is not. Skipped entirely
 * for a reader who has asked their system for less motion: this is decoration, and
 * decoration does not get to overrule that.
 */
function fadeIn(element: HTMLElement): void {
  if (!settings.fade) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: FADE_MS,
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
    // A browser's own drag of an image is a drag of the *file*, and it swallows the
    // pointer moves a pan is made of. Stash's own images say the same.
    image.draggable = false;

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
    // Where the reader is looking, one screen on: the middle of it, at whatever
    // zoom they were reading at. Stash does the same on its own image change, and
    // resetting it here — with the screen rather than with the turn — covers the
    // other ways a screen arrives: a chapter, a shift of the pairing, a re-lay.
    view = centred(view);
    applyView();

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
        (settings.offset ? 1 : 0) +
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

/**
 * The page the reader is on, as the mode means it.
 *
 * The screen modes mean the page their *screen* begins with: a screen is what they
 * draw and what the counter counts, and a pair is one screen — so the header names the
 * chapter the reader came into the screen by, which is what it has always done. The
 * column has no screens: its pages are its own rows, and the page at the top *is* the
 * page the reader is on.
 *
 * One place, because three surfaces ask: the footer's name for the page, the bar's
 * position in the book, and the chapter the header shows.
 */
function pageAt(gallery: MangaReaderGallery, at: number): number {
  if (settings.readingMode === "scroll") return Math.max(place, 0);
  return at < 0 ? -1 : gallery.screens[at].start;
}

/** The page the lightbox says it is on, 0-based, or null when it cannot be read */
/**
 * Where the reader is on screen, as a screen index, or -1 when it is nowhere yet.
 *
 * A screen is what the reader draws; `place` is a page. This is the one conversion
 * between them, and the only thing a turn has to know.
 */
function screenNow(gallery: MangaReaderGallery): number {
  if (place < 0) return -1;
  return screenAt(gallery.screens, place);
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

  // A new container is a new view — see ensureContainer, which is where it is made.
  // This much is for the container that had one: the lightbox is gone and nothing
  // should be waiting on its release.
  view = fitView();
  pressed = null;
  held = false;

  // The header goes with the drawing, and the lightbox gets Stash's own back: the
  // class that hides its chrome is the one that carries this plugin's.
  if (root) {
    removeChrome(root);
    removeProgress(root);
    root.classList.remove(CLASS_TAKEOVER);
  }
  forgetOpenMenu();
  place = -1;

  if (root) {
    root.classList.remove(CLASS_ACTIVE);
    const display = root.querySelector(SELECTOR_DISPLAY) as HTMLElement | null;
    if (display) display.style.position = "";
  }

  shownAt = -1;
}

function closeLightbox(): void {
  handedFor = null;
  place = -1;
  forgetOpenMenu();

  if (clickRoot) {
    clickRoot.removeEventListener("click", onNavClick, true);
    clickRoot = null;
  }

  deactivate();
  root = null;
  galleryId = null;
  logged = false;
}

/**
 * Asks for a pass, for the changes that are nobody's DOM mutation.
 *
 * The pages are measured from their layout boxes, so anything that changes what they
 * are fitted to changes what the progress bar measures — and a resize or a
 * fullscreen change is not a change to the document for the observer to see.
 */
function measureAgain(): void {
  if (root) sync(root);
}

// ── The lightbox's chapters ────────────────────────────────────────

/**
 * Hands the lightbox the list this plugin is drawing from.
 *
 * The images and nothing else: the chapters are this half's own menu now, and what
 * Stash needs the list for is its own footer — the name of the page and the way back
 * to the gallery it came from.
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
/**
 * The switches are not injected into Stash's options popover any more.
 *
 * They were, and that popover is inside the header this plugin hides — two homes for
 * one setting, and the one a reader could reach was the one that turned the reader off
 * behind its own back. There is one home now, and it is the reader's own: see
 * chrome.ts.
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
    // The shift is a shift of the pairing, and the column has no pairing to shift.
    if (settings.readingMode !== "double") return;

    setOffset(gallery, !settings.offset);

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

  // One page in the column, rather than a screenful: a screenful is however much
  // fits, which is a measurement and a different answer on every window — and a page
  // is what the counter counts and what a turn is called in the other two modes
  // ("left and right move a *screen*, not a page" is true there because a screen is
  // the unit there).
  if (settings.readingMode === "scroll") {
    const next = Math.min(
      Math.max(place + direction, 0),
      gallery.pages.length - 1
    );
    if (next === place) return false;

    place = next;
    scrollTo = next;
    sync(lightbox);
    return true;
  }

  const at = screenNow(gallery);
  if (at < 0) return false;

  const steps = stepsToAdjacent(gallery.screens, place, direction);
  if (steps === 0) return false;

  // Straight to it: the pages are all here, so a turn is where the reader is going
  // rather than an errand aimed at a lightbox that has to be waited for. `sync` draws
  // the screen the new place is in.
  place += steps;
  sync(lightbox);
  return true;
}

/**
 * How wide the pages on show are drawn, which is the width the progress bar takes.
 *
 * Measured from the *layout* box of each image — `offsetWidth` and `offsetLeft`,
 * neither of which the zoom's transform touches — and taken as the span from the
 * leftmost edge to the rightmost, so a pair measures as the pair and a lone page as
 * itself. Nothing has been laid out yet on the first pass of a fresh lightbox, and a
 * width of zero is answered for in the stylesheet: the track's own maximum keeps it
 * from drawing wider than the row it is in.
 *
 * **Every image on screen has to have a size before any of this counts.** The two
 * pages of a screen arrive one at a time, and the first to land measures as itself:
 * half a pair is not the width of a pair, and taking that measurement is what made
 * the bar narrow to one page and then jump back out — a bar "collapsing", and only
 * ever in double-page mode, since on a single page the one image landing *is* the
 * whole measurement. A partial measurement is no measurement, so this answers zero
 * and the bar holds the width it had, exactly as it does for a screen that has
 * measured nothing at all. See `lastWidth` in progress.ts.
 */
function pictureWidth(pages: number): number {
  if (!container || pages <= 0) return 0;

  const images = Array.from(container.querySelectorAll("img")) as HTMLElement[];
  if (!images.length) return 0;

  for (const image of images) {
    if (!image.offsetWidth) return 0;
  }

  let left = Number.POSITIVE_INFINITY;
  let right = 0;

  for (const image of images) {
    left = Math.min(left, image.offsetLeft);
    right = Math.max(right, image.offsetLeft + image.offsetWidth);
  }

  return right > left ? right - left : 0;
}

/**
 * Moves the reader to a page, which is the third way the place moves.
 *
 * The reader's arrow keys and Stash's chevrons turn by a *screen*; a chapter jump
 * puts the place at a chapter's first page; this is the progress bar, which names a
 * page and expects the book to be open at whichever screen holds it. The page is
 * kept as asked for rather than rounded down to that screen's first page: the
 * counter in the header counts the page the reader chose, which is the page the bar
 * named all the while it was being dragged, and `screenNow` is what turns the page
 * into the screen to draw.
 */
function seekTo(lightbox: Element, at: number): void {
  const gallery = current();
  if (!gallery) return;

  place = Math.min(Math.max(at, 0), gallery.pages.length - 1);
  // The column goes where the seek asked: it is the only mode where the place and
  // what is on screen are two different things, so it is the only one that has to be
  // told. Idempotent, so a seek that changes nothing scrolls nowhere.
  if (settings.readingMode === "scroll") scrollTo = place;

  sync(lightbox);
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
 *     reaches the slide, and the whole slide is behind these pages — unless the
 *     lightbox is filling the screen, where a click on the margin asks for nothing
 *     and is given nothing.
 */
function onSpreadClick(event: Event): void {
  const lightbox = root;
  if (!lightbox || !container) return;

  // The release behind this click was not one of Stash's clicks — it was a pan, or a
  // press that lasted — and a press and a release on one element is a click whether
  // or not either of those is true. Turning the page as well would mean every drag
  // cost a page. See onSpreadRelease.
  if (held) {
    held = false;
    return;
  }

  const target = event.target as HTMLElement | null;

  // A page in the column is not something to turn: there is no page on either side of
  // it, only more of the same column, which the reader scrolls. The letterbox below
  // still closes the lightbox, so this is the one click that means nothing.
  if (settings.readingMode === "scroll" && target?.tagName === "IMG") return;

  if (target?.tagName !== "IMG") {
    // In fullscreen, a click on the space around the pages does nothing at all.
    // Leaving fullscreen is the header's button or Escape, and nobody asking for a
    // page turn hits the letterbox by accident — whereas a reader who has filled the
    // screen with a book and then clicks the margin has asked for nothing, and being
    // given their browser back is not nothing.
    if (inFullscreen(lightbox)) {
      event.stopPropagation();
      return;
    }

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
 * How much wheel travel turns one screen.
 *
 * A mouse's own notch is about a hundred pixels, so a notch is a page and no more.
 * The number is what makes a *trackpad* usable: it sends a burst of small events for
 * one flick, and a page turn per event would cross a book in a flick.
 */
export const WHEEL_TURN = 100;

/** How long the wheel is still before what it has travelled is forgotten */
export const WHEEL_REST_MS = 250;

// Published where they are declared: an assignment up with the other publications
// would read them in their own dead zone.
NR.WHEEL_TURN = WHEEL_TURN;
NR.WHEEL_REST_MS = WHEEL_REST_MS;

/** What the wheel has travelled since the last screen it turned */
let wheelRun = 0;
/** The timer that forgets it once the wheel has stopped */
let wheelRest: number | null = null;

/**
 * The wheel: a page — or, with **ctrl** held, closer and further away.
 *
 * Not Stash's arrangement, and deliberately. Its `scrollMode` default is Zoom, so
 * its wheel zooms and its shifted wheel scrolls; here the wheel turns a page, which
 * is what a hand on a wheel in front of a book means, and **ctrl+wheel** is what
 * zooms — which is also where a browser puts its own zoom, so the chord is taken
 * rather than passed on. Shift keeps Stash's own meaning for it: up and down the
 * page, for looking at a tall one without turning away from it.
 *
 * A wheel is not one event per notch. What it has travelled is added up and a screen
 * is turned per WHEEL_TURN of it, with the remainder kept — a slow drift adds up to
 * a turn of its own otherwise — and forgotten once the wheel has been still for
 * WHEEL_REST_MS.
 *
 * The zoom keeps Stash's numbers and this plugin's centre: about the middle of the
 * screen rather than about the pointer, because the pages are fitted to a box and
 * what a reader means by "closer" is closer in the middle of what they are looking
 * at.
 *
 * The carousel behind these pages is hidden rather than gone, and a hidden element
 * is not a place a wheel event can land — so this is the only wheel in the lightbox,
 * and there is nothing to stop from hearing it.
 */
function onSpreadWheel(event: Event): void {
  const lightbox = root;
  if (!lightbox || !container) return;

  const wheel = event as WheelEvent;

  // In the column the wheel is the browser's: scrolling *is* reading there, so the
  // plain wheel is left entirely alone. **Ctrl is not** — it is the chord the other
  // two modes zoom with, and it does the same thing to the pages here, one notch a
  // step.
  //
  // What it does not share is the machinery. There the zoom is a transform over pages
  // *fitted* to the screen, with slack in both directions to zoom into; here the page
  // is already as wide as the picture area, so what zooms is the page itself — a
  // transform on a scroll box would leave the scroll range where it was and put the
  // edges of a zoomed page out of reach. See the note on `zoom` in scroll.ts.
  if (settings.readingMode === "scroll") {
    if (!wheel.ctrlKey && !wheel.metaKey) return;

    wheel.preventDefault();
    const was = columnZoom();
    setColumnZoom(zoomedBy(was, wheel.deltaY < 0 ? VIEW_STEP : 1 / VIEW_STEP));
    if (columnZoom() === was) return;

    // And the reader stays on the page they were reading. Every row has a different
    // height at a different zoom, so where they were *in the column* does not survive
    // the change — the page does, which is what this half keeps and why.
    scrollTo = Math.max(place, 0);
    sync(lightbox);
    return;
  }

  // Taken whatever is done with it: ctrl+wheel is the browser's own page zoom, and
  // without this a reader zooming into a page would zoom the whole interface.
  wheel.preventDefault();

  if (wheel.ctrlKey || wheel.metaKey) {
    view = zoomed(view, wheel.deltaY < 0 ? VIEW_STEP : 1 / VIEW_STEP);
    applyView();
    redrawChrome();
    return;
  }

  if (wheel.shiftKey) {
    view = panned(view, 0, wheel.deltaY < 0 ? -VIEW_PAN_STEP : VIEW_PAN_STEP);
    applyView();
    redrawChrome();
    return;
  }

  wheelRun += wheel.deltaY;

  if (wheelRest !== null) window.clearTimeout(wheelRest);
  wheelRest = window.setTimeout(() => {
    wheelRest = null;
    wheelRun = 0;
  }, WHEEL_REST_MS);

  while (Math.abs(wheelRun) >= WHEEL_TURN) {
    const forward = wheelRun > 0;
    wheelRun -= forward ? WHEEL_TURN : -WHEEL_TURN;

    // Nothing that way: keep nothing of what it travelled, or the next notch of the
    // same wheel would turn a page the reader is already on the edge of.
    if (!turnBy(lightbox, forward ? 1 : -1)) {
      wheelRun = 0;
      break;
    }
  }
}

/**
 * A press on the pages, which is either the start of a pan or the start of a click.
 *
 * Which of the two it was is decided on the way out — see onSpreadRelease, which is
 * where Stash's rule lives — so both are watched from here. The move and the release
 * are on the document rather than on the pages: a drag that leaves the pages, or the
 * lightbox, is still a drag, and it has to end somewhere.
 */
function onSpreadPress(event: Event): void {
  const press = event as MouseEvent;
  if (press.button !== 0) return;

  // In the column the press begins a *scroll* the reader makes with the pointer,
  // which is what a drag on a column of pages means: the same movement the wheel
  // makes, on the same scroll box, so the two cannot disagree about where the reader
  // is. Nothing is transformed — a pan is a transform, and this container scrolls.
  if (settings.readingMode === "scroll") {
    if (!container) return;

    dragFrom = {
      x: press.clientX,
      y: press.clientY,
      left: container.scrollLeft || 0,
      top: container.scrollTop || 0,
      at: press.timeStamp,
    };
    held = false;
    press.preventDefault();
    document.addEventListener("mousemove", onSpreadMove);
    document.addEventListener("mouseup", onSpreadRelease);
    return;
  }

  pressed = { x: press.clientX, y: press.clientY, at: press.timeStamp };
  held = false;

  document.addEventListener("mousemove", onSpreadMove);
  document.addEventListener("mouseup", onSpreadRelease);
}

/**
 * Where a drag in the column started, and where the box was scrolled to then.
 *
 * The container's own scroll position, because the drag *is* a scroll: the pointer
 * moves, the box follows, and everything that reads the box — the place in the book,
 * the bar, the header — reads a scroll that happened.
 */
let dragFrom: {
  x: number;
  y: number;
  left: number;
  top: number;
  at: number;
} | null = null;

/** Where the pointer went down, and when: the two halves of Stash's click test */
interface MangaReaderPress {
  /** Where the press landed, which is what says whether the pointer moved at all */
  x: number;
  y: number;
  /** When it landed, which is what says whether it lasted long enough to be a pan */
  at: number;
}

let pressed: MangaReaderPress | null = null;

/**
 * Whether the press that has just ended was anything but a click.
 *
 * Read by the click handler, which cannot tell for itself: a press and a release on
 * one element is a click whether or not the pointer went anywhere in between, and
 * whether or not it took a second to do it.
 */
let held = false;

function onSpreadMove(event: Event): void {
  if (!container) return;

  // The column's drag: the box follows the pointer, which is a scroll like any other
  // — and this is why it needs no guard against the wheel. Both of them move the same
  // scroll position, so neither can be surprised by the other, and the pass that reads
  // it afterwards reads a scroll that happened rather than one this half arranged.
  if (dragFrom) {
    const drag = event as MouseEvent;
    container.scrollLeft = dragFrom.left - (drag.clientX - dragFrom.x);
    container.scrollTop = dragFrom.top - (drag.clientY - dragFrom.y);

    // Anything at all is a drag, so the release after one is not a click on a page —
    // and in this mode a click does nothing anyway, which is the one place the two
    // modes agree for different reasons.
    held = true;
    return;
  }

  if (!pressed) return;

  const move = event as MouseEvent;
  const dx = move.clientX - pressed.x;
  const dy = move.clientY - pressed.y;

  // Anything at all is a drag: Stash's own test is whether the pointer is where it
  // went down, to the pixel, because a hand that meant to click does not move.
  held = true;

  // The pages follow the pointer by the distance moved *since the last event*, so
  // that a long drag does not chase one accumulated offset from where it began.
  pressed.x = move.clientX;
  pressed.y = move.clientY;

  view = panned(view, dx, dy);
  applyView();
}

function onSpreadRelease(event: Event): void {
  document.removeEventListener("mousemove", onSpreadMove);
  document.removeEventListener("mouseup", onSpreadRelease);

  // Stash's other half: a press that lasted is not the tap that turns a page, even
  // if the pointer stayed put. A reader who pressed and thought better of it has
  // asked for nothing.
  const release = event as MouseEvent;
  const from = dragFrom || pressed;
  if (from && release.timeStamp - from.at > VIEW_CLICK_MS) held = true;

  dragFrom = null;
  pressed = null;
}

/**
 * Puts the view on the pages.
 *
 * The whole screen is scaled as one thing, because that is the unit this half reads
 * in: a pair of pages zooms together, and the transform that does it is one line
 * rather than one per image. `translate` first so the movement is in pixels of the
 * screen rather than of the scaled pages.
 *
 * A transform does not clip, so the pages scaled past the edge of the picture area
 * would paint over the header — which is exactly what Stash's own slides prevent,
 * and what the `overflow` rule in mangaReader.css prevents here.
 */
function applyView(): void {
  if (!container) return;

  // In the column there is no transform — the zoom is the pages' own width, and a
  // transform on a scroll box would leave its scroll range behind (see scroll.ts). The
  // class is toggled all the same, because what it says is that there is something here
  // to drag, which is true of a zoomed column: the drag scrolls it.
  if (settings.readingMode !== "scroll") {
    container.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  }
  container.classList.toggle(CLASS_ZOOMED, zoomedNow());
}

/** Whether the pages are drawn larger than the size they fit at, in either mode */
function zoomedNow(): boolean {
  if (settings.readingMode === "scroll") return columnZoom() !== 1;
  return isZoomed(view);
}

/**
 * Draws the header again, because a zoom is a thing the header says something about.
 *
 * Through `sync` rather than at the header directly: it is the one path that decides
 * what is drawn, it is cheap when nothing has changed, and a second way in would be a
 * second set of conditions to keep in step with the first.
 */
function redrawChrome(): void {
  if (root) sync(root);
}

/**
 * Shifts a gallery's pairing by one page, or puts it back, and remembers it.
 *
 * Two ways in — the key and the switch in the options menu — and both come through
 * here, so they cannot disagree about what the offset is.
 */
function setOffset(gallery: MangaReaderGallery, next: boolean): void {
  settings = writeSettings({ offset: next });

  // Laid out again here rather than left to the pass, because the turn that follows
  // (the O key) is arithmetic on the screens: they have to be this gallery's own
  // before it happens.
  gallery.screens = laidOut(gallery.pages);
  gallery.pairedWith = pairingKey();
  shownAt = -1;

  step();
}

/**
 * The page the reader is on, as Stash's own router last reported it.
 *
 * `null` until the first report, which is the page as it already stands rather than
 * a move away from it — Stash dispatches on mount as well as on every change.
 */
let seenPath: string | null = null;

/** Stash's "stash:location" payload, which is `Event.dispatch("location", ...)` */
type LocationEvent = {
  detail?: { data?: { location?: { pathname?: string } } };
};

/**
 * Back closes the lightbox.
 *
 * Stash's lightbox is in its own state and not in the route: nothing about a route
 * change takes it away, so a reader who presses Back leaves the gallery page and
 * finds the pages still over whatever they landed on — and the lightbox's own images
 * belong to the page they came from. So a route change under an open lightbox is
 * that lightbox's cue to close, through the same Escape Stash's own close runs.
 *
 * A change of *query* is not a move: the Images list re-sorts by writing `sortby`
 * into the URL with the lightbox open, and closing it there would be closing it for
 * a change it is already following.
 */
function onLocation(event: unknown): void {
  const path = (event as LocationEvent)?.detail?.data?.location?.pathname;
  if (typeof path !== "string") return;

  const moved = seenPath !== null && path !== seenPath;
  seenPath = path;

  if (moved && root) pressEscape();
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

  // Two changes that move everything the reader draws in and leave the document
  // exactly as it was: a window resized, and the lightbox filling the screen or
  // giving it back. What the pages are fitted to has changed, so how wide the
  // progress bar is has changed with it — and nothing else here would notice until
  // something else moved. See pictureWidth.
  document.addEventListener("fullscreenchange", measureAgain);
  window.addEventListener("resize", measureAgain);

  // Stash's own router, which tells plugins when the page has changed — see
  // onLocation for what this half does with it. Guarded the way the tools half
  // guards it: a Stash without the event has no route changes to offer.
  const api = requirePluginApi();
  if (api.Event?.addEventListener) {
    api.Event.addEventListener("stash:location", onLocation);
  }

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
