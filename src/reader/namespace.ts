/**
 * The settings the reader half keeps, the shape of what it is reading, and the
 * namespace it publishes its own logic on.
 *
 * Stash's API is declared once for the whole plugin, in `../plugin-api`: the two
 * halves are one bundle now, and a second `IPluginApi` in the same program does
 * not compile — TypeScript refuses two declarations of `window.PluginApi` with
 * different types, which is what two hand-written interfaces for one API are.
 * What is left here is what belongs to this half alone.
 *
 * Same arrangement as the tools half: the module attaches itself to the window
 * so a smoke test can reach the functions without a bundler of its own. Nothing
 * at runtime reads it — the plugin ships as one file, with its imports inlined.
 */
import type { MangaReaderChapter, MangaReaderPlacedChapter } from "./chapters";
import type { MangaReaderPage, MangaReaderScreen } from "./spreads";
import type { LightboxImage } from "./stash-lightbox";
import type { MangaReaderView } from "./zoom";

/**
 * The order the lightbox is showing its images in — see lightboxOrder in
 * stash-lightbox.ts for where it comes from and why it is not always path.
 */
export interface MangaReaderOrder {
  sort: string;
  direction: "ASC" | "DESC";
}

/** Where the lightbox's strip of thumbnails starts, and which one is current */
export interface MangaReaderStrip {
  start: number;
  count: number;
  selected: number;
}

/** Just the settings the reader keeps. See settings.ts. */
/**
 * How the pages are laid out to be read.
 *
 * Three, and they are exclusive: one page at a time, two pages at a time (the pairing
 * rules are about *that*), or the whole gallery as one continuous column scrolled
 * downwards. It was a boolean — `doublePage` — and a third answer is what a boolean
 * cannot hold.
 */
export type MangaReaderReadingMode = "single" | "double" | "scroll";

export interface MangaReaderSettings {
  /** Which of the three ways the pages are laid out. See MangaReaderReadingMode */
  readingMode: MangaReaderReadingMode;
  /** Whether the first page is given a screen of its own. */
  coverAlone: boolean;
  /** Whether a page wider than it is tall is taken for a spread. */
  detectSpreads: boolean;
  /** Whether a screen fades in at all. The length is FADE_MS, and is not a choice. */
  fade: boolean;
  /**
   * Whether the pairing starts one page over, for a gallery whose pages are grouped
   * wrongly — the escape hatch for a page that was taken for a spread and was not
   * one. Remembered for the browser rather than for the gallery: it is a reading
   * preference, and a reader who needs it needs it for the scan they are reading
   * rather than for one book.
   */
  offset: boolean;
}

/** What is being read: the pages, where the reader is, and where its chapters are. */
export interface MangaReaderGallery {
  id: string;
  pages: MangaReaderPage[];
  /**
   * The same pages in the shape Stash's lightbox reads, kept so that the handover
   * needs nothing but the gallery: a lightbox opens again and again on a gallery
   * already read, and every one of those is a lightbox to hand the chapters to.
   */
  images: LightboxImage[];
  screens: MangaReaderScreen[];
  /**
   * Whether those screens were laid out with two pages a screen.
   *
   * The screens are a function of the settings, so a cached gallery is only good for
   * the settings it was laid out under. Without this, a gallery read once and opened
   * again after a switch was moved would be drawn the old way — the cache outliving
   * the settings it was built from.
   *
   * The four that decide a layout, as one string, rather than a flag per setting: the
   * question the pass asks is "were these cut by what is set now", and a fifth setting
   * added to the layout has to change the answer without anyone remembering to add it
   * here. See pairingKey in takeover.ts.
   */
  pairedWith: string;
  /**
   * The gallery's chapters, placed in the order the pages came back in.
   *
   * Placed once, at the only moment the order is known — a gallery is fetched when
   * the lightbox opens, and changing the list's sort behind it reopens it. See
   * placeChapters.
   */
  chapters: MangaReaderPlacedChapter[];
}

/**
 * The namespace this half publishes its logic on.
 *
 * Read by the smoke test and, for two of its members, by the tools half: the
 * reader's own modules import each other directly, and the published copy is what
 * lets a test call a pure function without a bundler of its own — the same
 * arrangement the tools half uses at `window.MangaTools`. The exception is the
 * chapter import, which the plugin's settings panel asks for: the job is this
 * half's, because the format is, and the panel is the tools half's, so the
 * published copy is how the two meet without an import between them.
 */
export interface MangaReaderNamespace {
  parseSettings(raw: string | null): MangaReaderSettings;
  /**
   * What this browser is set to, including the keys the reader wrote before it
   * was bundled with the tools — see storedValue in settings.ts.
   *
   * Published for the tests, which have to seed a store to see the migration,
   * and cannot: the only other way in is through the lightbox, which cannot tell
   * a setting that was migrated from one that was simply there.
   */
  readSettings(): MangaReaderSettings;
  parseIndicator(text: string): { current: number; total: number } | null;
  galleryIdFromPath(pathname: string): string | null;
  /** The order the lightbox is showing its images in, read from the URL */
  lightboxOrder(search: string): MangaReaderOrder;
  /**
   * Where the lightbox is and which image is there, read from its carousel — see
   * carouselImage, which is also how a fetched order is checked against what is on
   * screen.
   */
  carouselImage(lightbox: Element): { at: number; id: string } | null;
  /**
   * Whether the lightbox is busy fetching or swapping. It renders a spinner in place
   * of everything while it is — see lightboxIsLoading, which is the difference between
   * a busy lightbox and one whose markup has changed under this plugin.
   */
  lightboxIsLoading(lightbox: Element): boolean;
  /**
   * The thumbnails the lightbox is holding, and which of them is current.
   *
   * Read for the one thing a jump needs: clicking one is Stash's own
   * `selectIndex`. Stash renders the strip only when `showNavigation` is set, which
   * neither of the gallery lightboxes sets — so this is here for the lightboxes
   * that do, and for the day one of them changes.
   */
  readStrip(lightbox: Element): MangaReaderStrip | null;
  isWideSpreadPage(page: MangaReaderPage): boolean;
  /**
   * How long a screen may be held back waiting for its images, in milliseconds.
   * Published for the tests, which have to wait exactly that long to see a slow
   * screen give up and show what it has. See draw in takeover.ts.
   */
  REVEAL_BUDGET_MS: number;
  /** How long a screen takes to fade in, when it fades. See FADE_MS in settings.ts. */
  FADE_MS: number;
  layout(
    pages: MangaReaderPage[],
    options?: Partial<{
      coverAlone: boolean;
      offset: 0 | 1;
      detectSpreads: boolean;
    }>
  ): MangaReaderScreen[];
  /** The stored shape's version. See chapters.ts. */
  CHAPTERS_VERSION: number;
  /** This gallery's stored chapters, or null when there are none to read */
  parseChapters(raw: string | null): MangaReaderChapter[] | null;
  /** A chapter list as the field's JSON string — the inverse of parseChapters */
  serializeChapters(chapters: MangaReaderChapter[]): string;
  /** Stash's own chapters, translated against the path-ordered image ids */
  chaptersFromStash(
    rows: { title?: unknown; image_index?: unknown }[] | null | undefined,
    pathIds: string[]
  ): MangaReaderChapter[];
  /** How much wheel travel turns one screen — see onSpreadWheel in takeover.ts */
  WHEEL_TURN: number;
  /** How long the wheel is still before what it has travelled is forgotten */
  WHEEL_REST_MS: number;
  /**
   * The page the reader is on in a gallery, by id, or null when they are not in it —
   * published by takeover.ts for the tab's form, which opens on the page somebody was
   * reading. An id, because the two halves may count the pages in different orders.
   */
  readingPageIdNow(galleryId: string): string | null;
  /**
   * The query the plan is asked with, as the text Stash is sent.
   *
   * Published for the tests, which pin it: the client they run against answers
   * anything, so this shape can only be checked against a real instance — and an
   * edit that is not checked is how the first version of it came back with nothing.
   */
  CHAPTERS_QUERY_TEXT: string;
  /**
   * Which marked galleries have chapters of Stash's to bring into this plugin's
   * field, and which already have a list of their own — see chapters-import.ts. One
   * read-only query, and no writes: what a settings panel shows before asking.
   */
  planChapterImports(): Promise<{
    toImport: string[];
    owned: string[];
    considered: number;
  }>;
  /**
   * Writes those chapters, one gallery at a time, through the tools half. Reported
   * rather than thrown: a gallery that failed is one entry, and the rest are done.
   */
  runChapterImports(
    plan: { toImport: string[]; owned: string[]; considered: number },
    options?: {
      reimport?: boolean;
      onProgress?: (done: number, total: number) => void;
    }
  ): Promise<{
    written: string[];
    failed: { id: string; error: unknown }[];
    skippedEmpty: string[];
  }>;
  /** Writes a gallery's chapters and says so — see chapters-edit.ts */
  writeChapters(galleryId: string, next: MangaReaderChapter[]): Promise<void>;
  /**
   * Hears about a gallery's chapters changing; the returned function stops it. For
   * the surfaces that keep their own copy of the list — which is all of them.
   */
  watchChapters(
    fn: (galleryId: string, chapters: MangaReaderChapter[]) => void
  ): () => void;
  /**
   * The chapter an image is in, or null when it is in none — see chapters.ts, where
   * the answer comes from what each chapter lists rather than from its neighbours.
   */
  chapterAt(
    placed: MangaReaderPlacedChapter[],
    pageId: string
  ): MangaReaderPlacedChapter | null;
  /**
   * A chapter beginning at this page — the run from here to the next chapter's
   * start, out of whatever held it — or null when there is nothing to make. See
   * chapters.ts: this is what the editor's "create" writes.
   */
  addChapterAt(
    chapters: MangaReaderChapter[],
    order: string[],
    pageId: string,
    title: string
  ): MangaReaderChapter[] | null;
  /** The chapter beginning at this page renamed, or null when none begins there */
  renameChapterAt(
    chapters: MangaReaderChapter[],
    order: string[],
    startPageId: string,
    title: string
  ): MangaReaderChapter[] | null;
  /**
   * The chapter beginning at one page beginning at another instead: the chapters
   * are re-cut as the runs between their starts, which is what changing a start
   * means. Null when there is no such chapter, or nowhere to move it to.
   */
  moveChapterStart(
    chapters: MangaReaderChapter[],
    order: string[],
    fromPageId: string,
    toPageId: string
  ): MangaReaderChapter[] | null;
  /**
   * The same list without the chapter holding this page — its pages are owned by
   * nobody afterwards — or null when no chapter holds it.
   */
  removeChapterAt(
    chapters: MangaReaderChapter[],
    order: string[],
    pageId: string
  ): MangaReaderChapter[] | null;
  /** Where each chapter falls in the order on screen */
  placeChapters(
    chapters: MangaReaderChapter[],
    pages: MangaReaderPage[]
  ): MangaReaderPlacedChapter[];
  screenAt(screens: MangaReaderScreen[], pageIndex: number): number;
  /**
   * The zoom and pan of the pages this half draws — see zoom.ts, which is where the
   * arithmetic lives and why it is arithmetic rather than DOM work.
   */
  fitView(): MangaReaderView;
  centred(view: MangaReaderView): MangaReaderView;
  zoomed(view: MangaReaderView, factor: number): MangaReaderView;
  panned(view: MangaReaderView, dx: number, dy: number): MangaReaderView;
  isZoomed(view: MangaReaderView): boolean;
  VIEW_MIN_ZOOM: number;
  VIEW_MAX_ZOOM: number;
  VIEW_STEP: number;
  /** How long a press may last and still be the click that turns a page */
  VIEW_CLICK_MS: number;
  /**
   * The progress bar's own arithmetic and its two timings — see progress.ts, where
   * the snapping is explained and why the handle is not throttled with it.
   */
  fractionOfPage(page: number, total: number): number;
  pageAtFraction(fraction: number, total: number): number;
  progressNodes(
    chapters: MangaReaderPlacedChapter[],
    total: number,
    locale: string | null
  ): { name: string; at: number; fraction: number }[];
  PROGRESS_SCRUB_MS: number;
  PROGRESS_IDLE_MS: number;
  stepsToAdjacent(
    screens: MangaReaderScreen[],
    pageIndex: number,
    direction: 1 | -1
  ): number;
  /**
   * Which page of the scrolled column the reader is on, from where its rows are —
   * see scroll.ts. Here rather than reached through the DOM for the same reason as
   * the bar's arithmetic: the tests' DOM has no layout, so the decision has to be
   * callable on numbers a section made up.
   */
  pageAtTop(rows: { top: number; bottom: number }[], edge: number): number;
  /**
   * The column's zoom one notch on, clamped — see scroll.ts, where the range and the
   * step are explained. Pure, and here for the same reason as the page above: the
   * tests' DOM has no layout, so the arithmetic has to be callable on its own.
   */
  zoomedBy(current: number, factor: number): number;
  /**
   * How far a menu has to move sideways to be inside the window — see chrome.ts.
   *
   * Here rather than reached through the DOM for the same reason as the bar's
   * arithmetic: the tests' DOM has no layout, so a placement is a number they have to
   * be able to ask for directly.
   */
  fitShift(
    left: number,
    width: number,
    viewport: number,
    margin: number
  ): number;
}

/** The one namespace object, created here because this module is the types' home */
window.MangaReader = window.MangaReader || ({} as MangaReaderNamespace);
export const NR: MangaReaderNamespace = window.MangaReader;

declare global {
  interface Window {
    /**
     * Published by this half's own modules, read by its smoke test.
     *
     * The reader's `PluginApi` is declared with the tools', in `../plugin-api`,
     * because the two halves share one bundle and one declaration of it.
     */
    MangaReader?: MangaReaderNamespace;
  }
}
