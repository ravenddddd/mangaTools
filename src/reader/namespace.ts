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
export interface MangaReaderSettings {
  /** The mode itself. Off until somebody turns it on. */
  doublePage: boolean;
  /** Whether the first page is given a screen of its own. */
  coverAlone: boolean;
  /** Whether a page wider than it is tall is taken for a spread. */
  detectSpreads: boolean;
  /**
   * How long a screen takes to fade in, in milliseconds. 0 draws it at once.
   *
   * A setting rather than a constant because how much of this is pleasant is a
   * matter of taste and of screen, and because "is it doing anything at all" is a
   * question a reader can only answer by moving it to an extreme.
   */
  fadeMs: number;
}

/** What is being read: the pages, where the reader is, and where its chapters are. */
export interface MangaReaderGallery {
  id: string;
  pages: MangaReaderPage[];
  screens: MangaReaderScreen[];
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
 * Read by the smoke test and by nothing else: the reader's own modules import
 * each other directly, and the published copy is what lets a test call a pure
 * function without a bundler of its own — the same arrangement the tools half
 * uses at `window.MangaTools`.
 */
export interface MangaReaderNamespace {
  parseSettings(raw: string | null): MangaReaderSettings;
  parseOffsets(raw: string | null): { [galleryId: string]: 0 | 1 };
  /**
   * What this browser is set to, including the keys the reader wrote before it
   * was bundled with the tools — see storedValue in settings.ts.
   *
   * Published for the tests, which have to seed a store to see the migration,
   * and cannot: the only other way in is through the lightbox, which cannot tell
   * a setting that was migrated from one that was simply there.
   */
  readSettings(): MangaReaderSettings;
  /** A gallery's remembered shift, from either key. Published for the same reason. */
  readOffset(galleryId: string): 0 | 1;
  parseIndicator(text: string): { current: number; total: number } | null;
  galleryIdFromPath(pathname: string): string | null;
  /** The order the lightbox is showing its images in, read from the URL */
  lightboxOrder(search: string): MangaReaderOrder;
  /** The thumbnails the lightbox is holding, and which of them is current */
  readStrip(lightbox: Element): MangaReaderStrip | null;
  /** Goes straight to an image by clicking its thumbnail, if it is held */
  clickStrip(lightbox: Element, index: number): boolean;
  /** Whether Stash's own chapter menu is on screen */
  hasOwnChapterMenu(lightbox: Element): boolean;
  isWideSpreadPage(page: MangaReaderPage): boolean;
  /**
   * How long a screen may be held back waiting for its images, in milliseconds.
   * Published for the tests, which have to wait exactly that long to see a slow
   * screen give up and show what it has. See draw in takeover.ts.
   */
  REVEAL_BUDGET_MS: number;
  /** The longest a screen may take to fade in. See FADE_MAX_MS in settings.ts. */
  FADE_MAX_MS: number;
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
  /** Stash's own chapters, translated against the path-ordered image ids */
  chaptersFromStash(
    rows: { title?: unknown; image_index?: unknown }[] | null | undefined,
    pathIds: string[]
  ): MangaReaderChapter[];
  /** Where each chapter falls in the order on screen */
  placeChapters(
    chapters: MangaReaderChapter[],
    pages: MangaReaderPage[]
  ): MangaReaderPlacedChapter[];
  /** The chapter an image is in, or null when it is in none */
  chapterAt(
    placed: MangaReaderPlacedChapter[],
    pageId: string
  ): MangaReaderPlacedChapter | null;
  screenAt(screens: MangaReaderScreen[], pageIndex: number): number;
  stepsToAdjacent(
    screens: MangaReaderScreen[],
    pageIndex: number,
    direction: 1 | -1
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
