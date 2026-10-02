/**
 * The reader's third way of laying the pages out: the whole gallery as one column,
 * scrolled downwards.
 *
 * Every other mode is **discrete** — one screen at a time, and the reader's place is
 * arithmetic on the place in the book. This one is not: the pages are stacked, the
 * browser scrolls them, and where the reader is depends on where the column happens
 * to be. What it keeps from the rest of the reader is the *place itself*: a page
 * rather than a pixel. Scrolling is the fifth way of moving it, after a turn, a
 * chapter jump, the progress bar and the key, and that is what lets the header, the
 * counter, the chapter menu and the bar go on saying the same things in all three
 * modes.
 *
 * **What it does not do is measure anything.** The other two modes ask the browser
 * where the pages ended up, because a screen's width depends on what is in it. A
 * column's height does not: a page's own shape says how tall its row is, and the
 * gallery answer carries that shape, so the column is the right height before a single
 * picture has arrived. Which is what keeps a reader halfway down a long gallery from
 * having the page move under their eyes as the images land.
 */
import { NR } from "./namespace";
import type { MangaReaderPage } from "./spreads";
import { VIEW_MAX_ZOOM, VIEW_MIN_ZOOM } from "./zoom";

/**
 * What the container is, while this mode is on.
 *
 * The same container the other two modes draw a screen into — see ensureColumn in
 * takeover.ts — with the class that turns it from a centred row into a scrolling
 * column. A class rather than a `display` of its own: the container is a flex box in
 * every mode, and a mode that set `display: block` would have to put the centring
 * back by hand.
 */
export const CLASS_SCROLL = "is-scroll";
/** One page of the column */
export const CLASS_SCROLL_PAGE = "manga-reader-scroll-page";
/**
 * The same mode, marked on the lightbox.
 *
 * For the one rule that is about *Stash's* furniture rather than this plugin's: the
 * next-page chevron sits against the right edge of the picture area, which is where
 * the column's bar now is. One class on each element, because one is about what this
 * plugin draws and the other is about where it is drawn.
 */
export const CLASS_SCROLLING = "manga-reader-position-scrolling";

/**
 * How much wider than the picture area a page is drawn, as a multiplier.
 *
 * In the two screen modes the zoom is a `transform` on the container, and it can be:
 * the pages are *fitted* into that container, so there is slack in both directions to
 * zoom into. Here there is none — a page is exactly as wide as the picture area — so
 * the very first notch of zoom-in makes it wider than the area, and what has to grow
 * is the **page itself** rather than a transform over it.
 *
 * That is not a detail of implementation. A transform on a scroll box does not move
 * its scroll range: the range is computed from the layout box, the transform is
 * painted after it, and a reader zoomed in would find the edges of the page
 * unreachable. A page that is *drawn* wider has a scroll range wide enough by
 * construction — which is the browser's own model of page zoom, and the reason the
 * drag in this mode is a drag of the scroll position rather than a pan.
 *
 * Kept here rather than in takeover.ts because the rows are here: it is the width of
 * every row, so it is this module's number.
 */
let zoom = 1;

/** How far the column is zoomed, as a multiplier of the picture area's width */
export function columnZoom(): number {
  return zoom;
}

/**
 * The zoom one notch further in or out, clamped to the same range the screen modes
 * use — the same numbers, because it is the same gesture and a reader who is used to
 * one should not find the other stopping somewhere else.
 *
 * Pure, so that the range and the step are testable without a DOM: see zoom.ts for
 * the three numbers.
 */
export function zoomedBy(current: number, factor: number): number {
  return Math.min(Math.max(current * factor, VIEW_MIN_ZOOM), VIEW_MAX_ZOOM);
}

/** Draws the rows at the zoom in hand — the width, and the cap that keeps them sharp */
export function setColumnZoom(next: number): number {
  zoom = next;
  column?.querySelectorAll("." + CLASS_SCROLL_PAGE).forEach((row) => {
    const node = row as HTMLElement;
    // The width is the zoom; the cap is the page's own pixels times it, so a page is
    // never drawn wider than it was — the same rule as at 1:1, scaled.
    const natural = Number(node.dataset.width || 0);
    node.style.width = zoom * 100 + "%";
    if (natural > 0) node.style.maxWidth = zoom * natural + "px";
  });

  return zoom;
}

/** The column in hand, so a zoom can be drawn on it without being handed it again */
let column: HTMLElement | null = null;

/**
 * Which page the reader is on, from where each page's row is.
 *
 * The first row whose bottom edge is below the top of the picture area: the page the
 * reader is looking *into* rather than the one most of which is on screen. The
 * most-visible row is the other candidate, and it is what a scrollbar's thumb would
 * say — but it changes its mind about a tall page going past, and a counter that
 * flickers between two pages is worse than one that says the top page.
 *
 * Pure arithmetic over where the rows are, because the tests' DOM has no layout: a
 * section says where the rows are, and this decides.
 */
export function pageAtTop(
  rows: { top: number; bottom: number }[],
  edge: number
): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].bottom > edge) return i;
  }

  // Every row is above the edge: the reader has scrolled past the end, which is the
  // last page rather than none of them. An empty column is the one case with no
  // answer at all.
  return rows.length > 0 ? rows.length - 1 : -1;
}

/**
 * Every page as a row of the column, in reading order.
 *
 * Reading order and not path order: the list is the one the lightbox is reading, the
 * same list the other two modes lay out, so a gallery sorted by title scrolls in that
 * order here as well.
 *
 * Each row's height is **reserved from the page's own size**, and each page is no
 * wider than its own pixels: a page drawn wider than it was is a page made blurry, and
 * a row whose height is not known until its picture lands is the whole column jumping
 * down by one page every time one arrives.
 */
export function buildColumn(
  into: HTMLElement,
  pages: MangaReaderPage[],
  urlOf: (page: MangaReaderPage, index: number) => string
): void {
  column = into;
  into.textContent = "";

  pages.forEach((page, index) => {
    const row = document.createElement("div");
    row.className = CLASS_SCROLL_PAGE;
    // The page's own pixels, kept on the row: the zoom is a multiple of them, and
    // asking the picture for them later is asking something that may not have arrived.
    row.dataset.width = String(page.width > 0 ? page.width : 0);
    if (page.width > 0 && page.height > 0) {
      row.style.aspectRatio = page.width + " / " + page.height;
    }

    const image = document.createElement("img");
    image.src = urlOf(page, index);
    image.alt = String(index + 1);
    image.decoding = "async";
    // The browser fetches what is coming rather than all four hundred pages: the
    // column holds an element per page either way, and what this spares is the
    // requests.
    image.loading = "lazy";
    // A browser's own drag of an image is a drag of the file, and it swallows the
    // pointer moves a scroll is made of.
    image.draggable = false;

    row.appendChild(image);
    into.appendChild(row);
  });

  setColumnZoom(zoom);
}

/** How far down a page's row begins, or null when the column has no such row */
export function rowOffset(into: HTMLElement, index: number): number | null {
  const row = into.querySelectorAll("." + CLASS_SCROLL_PAGE)[index] as
    | HTMLElement
    | undefined;

  return row ? row.offsetTop : null;
}

// Published for the smoke test, which reaches the reader's own logic through the
// window — see the note on MangaReaderNamespace in plugin-api.ts.
NR.pageAtTop = pageAtTop;
NR.zoomedBy = zoomedBy;
