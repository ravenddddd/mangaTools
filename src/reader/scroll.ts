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
  column: HTMLElement,
  pages: MangaReaderPage[],
  urlOf: (page: MangaReaderPage, index: number) => string
): void {
  column.textContent = "";

  pages.forEach((page, index) => {
    const row = document.createElement("div");
    row.className = CLASS_SCROLL_PAGE;
    if (page.width > 0) row.style.maxWidth = page.width + "px";
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
    column.appendChild(row);
  });
}

/** How far down a page's row begins, or null when the column has no such row */
export function rowOffset(column: HTMLElement, index: number): number | null {
  const row = column.querySelectorAll("." + CLASS_SCROLL_PAGE)[index] as
    | HTMLElement
    | undefined;

  return row ? row.offsetTop : null;
}

// Published for the smoke test, which reaches the reader's own logic through the
// window — see the note on MangaReaderNamespace in plugin-api.ts.
NR.pageAtTop = pageAtTop;
