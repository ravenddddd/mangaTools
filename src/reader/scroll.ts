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
import { VIEW_MAX_ZOOM, VIEW_MIN_ZOOM, VIEW_SNAP } from "./zoom";

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
 * The box standing in for the pages outside the drawn window, above and below it.
 *
 * Its height is what is not drawn, at the zoom in hand — which is what keeps the
 * scroll range, the scrollbar, every offset and a jump to a page the ones of the whole
 * book. `flex-shrink: 0` in the stylesheet for the same reason the rows have it: a
 * column flex box with a definite height would otherwise shrink the stands-in and the
 * range would be short by however much they gave up.
 */
export const CLASS_SCROLL_PAD = "manga-reader-scroll-pad";
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
 * How wide a page is fitted in the column, given the picture area.
 *
 * The area's width — or its height, whichever is smaller. Filling the width is right
 * on a window that is taller than it is wide, and too much on one that is not: a page
 * as wide as a 1600×900 window is a page three and a half screenfuls tall, read by
 * scrolling through it at a size that never shows a whole screenful of anything. So
 * the fit is capped at the height, which is the rule the other two modes already
 * follow — a page is never drawn larger than a screenful of it.
 *
 * `reserved` is the room the progress bar stands on, taken off **each side** of the
 * width and not off the height: the bar is down one side, and the pages are centred, so
 * both sides give it up or the page ends up off the middle. (The width is the only side
 * either way: a page capped by its height is already clear of a bar down the side.)
 * Nothing else is reserved — a zoom is free to run under it.
 *
 * It is a measurement and not a share of the box, which is why it is a number of pixels
 * rather than a percentage: `min(width, height)` has no percentage form. Zero means the
 * box has not been measured — a container not in the document yet, or the smoke tests'
 * DOM, which has no layout — and the caller fills the box instead, as it always did.
 */
export function columnFitted(
  width: number,
  height: number,
  reserved = 0
): number {
  if (!(width > 0) || !(height > 0)) return 0;
  // Twice the reserve, because the pages are centred: a reserve taken off one side only
  // would be a page pushed off the middle, which is the wrong shape of answer — the
  // reader asked for the page to keep out of the bar's way, not to move across.
  return Math.max(1, Math.min(width - 2 * reserved, height));
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
  const next = Math.min(
    Math.max(current * factor, VIEW_MIN_ZOOM),
    VIEW_MAX_ZOOM
  );
  // **The same snap the screen modes apply** (see zoom.ts). A wheel that goes out
  // and comes back otherwise leaves the pages a fraction of a percent off, and
  // the header then offers to reset a zoom nobody can see — `zoomedNow` is a
  // comparison against 1, not against "close enough".
  return Math.abs(next - 1) < VIEW_SNAP ? 1 : next;
}

/**
 * One property of one row, written only when it is not already what it should be.
 *
 * A write is a change even when the value is the same, and this half is written that way
 * everywhere else — see setAlong and setAlongLength in progress.ts, which compare before
 * they set. Here there is more to it than tidiness: the rows are every page of the
 * gallery, and a fit is redone on every resize event of a drag.
 */
function setStyle(
  node: HTMLElement,
  name: "width" | "maxWidth",
  value: string
): void {
  if (node.style[name] !== value) node.style[name] = value;
}

/** Draws the rows at the zoom in hand — the width, and the cap that keeps them sharp */
export function setColumnZoom(next: number, reserved = 0): number {
  // Where the reader is, read before anything changes size. A zoom multiplies every
  // height by the same factor, so the page at this position is the page at the same
  // position afterwards; a new fit does not, so there the position is read again once
  // the plan is rebuilt (see `zoomChanged`).
  const before = virtual && column ? columnPageAt(column) : -1;
  const zoomChanged = next !== zoom;

  zoom = next;
  const fitted = fittedWidth(reserved);

  if (virtual) {
    if (fitted > 0) replan(fitted);
    const at = zoomChanged || !column ? before : columnPageAt(column);
    renderWindow(at >= 0 ? at : 0);
    return zoom;
  }

  column?.querySelectorAll("." + CLASS_SCROLL_PAGE).forEach((row) => {
    const node = row as HTMLElement;
    // The page's own pixels: the zoom is a multiple of them, and the page is never
    // drawn wider than it was — the same rule as at 1:1, scaled.
    const natural = Number(node.dataset.width || 0);

    if (fitted > 0) {
      setStyle(node, "width", zoom * fitted + "px");
      setStyle(
        node,
        "maxWidth",
        zoom * (natural > 0 ? Math.min(natural, fitted) : fitted) + "px"
      );
      return;
    }

    // Nothing measured yet — a box that is not in the document, or a DOM with no
    // layout behind it. The page fills the box, as it did before there was a fit to
    // take it off, and the first measurement replaces this.
    setStyle(node, "width", zoom * 100 + "%");
    if (natural > 0) setStyle(node, "maxWidth", zoom * natural + "px");
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
 * **How many pages a thousand-page gallery actually has on screen at once.**
 *
 * The column used to hold a row — an element and an `<img>` — for every page of the
 * gallery, which is memory and first paint paid for pages nobody is looking at. The
 * rows are now a window around the reader's place: the two padding boxes above and
 * below carry the height of what is not drawn, so the scroll range, the scrollbar,
 * the progress bar and every offset stay those of the whole book.
 *
 * Twelve is a viewport and a half of even a short page, and three rows of lead above
 * the page at the top survive a flick that lands mid-page. It is not a measurement:
 * rows are only removed when the place moves past the edge of the window, so an
 * oversized window costs a handful of elements and an undersized one would re-render
 * while the reader scrolls. Two window-lengths is the point below which the whole
 * column is cheaper to build than the bookkeeping.
 */
const COLUMN_WINDOW = 12;
/** Rows kept above the page at the top, so a flick has somewhere to land */
const COLUMN_LEAD = 3;

/**
 * The heights of every row at zoom 1, and where each begins, from the pages' own
 * shapes and the width the pages are fitted to.
 *
 * **Null when the column cannot be planned**: a box that has not been measured
 * (`fitted` 0), or a page whose own size Stash did not report. A row with no shape
 * has no height until its picture lands, so the offsets would be a guess that the
 * scrollbar and every jump would inherit — the column falls back to the full build,
 * which is what it always did, and the reader sees exactly what they saw before.
 *
 * Height is width times the page's own ratio, and the width is the fitted width
 * capped by the page's own pixels — the same two numbers the row itself is given.
 * Zoom is not in here: every height scales with it, so the plan is kept at zoom 1 and
 * multiplied where it is used.
 */
export function columnPlan(
  pages: MangaReaderPage[],
  fitted: number
): { heights: number[]; offsets: number[] } | null {
  if (!(fitted > 0) || pages.length === 0) return null;

  const heights: number[] = [];
  const offsets: number[] = [0];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!(page.width > 0) || !(page.height > 0)) return null;

    const width = Math.min(page.width, fitted);
    const height = width * (page.height / page.width);
    heights.push(height);
    offsets.push(offsets[i] + height);
  }

  return { heights, offsets };
}

/**
 * The page at a given offset in the column, from the plan's cumulative offsets.
 *
 * The same rule as pageAtTop — the first row whose bottom is below the edge, which is
 * the page the reader is looking *into* — with the geometry already in hand, so a
 * scroll is a bisection over numbers rather than a `getBoundingClientRect` for every
 * row on screen.
 */
export function pageAtOffset(offsets: number[], at: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return -1;

  let low = 0;
  let high = count - 1;
  let found = count - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid + 1] > at) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return found;
}

/**
 * The window of rows to draw for a page: `[start, end)`.
 *
 * The page at the top gets `COLUMN_LEAD` rows above it when there is room, so a
 * scroll that goes either way lands on pages already drawn. The window slides to
 * `count - size` at the end of the book rather than shrinking, because an image's
 * height is not known to the pixel until it lands and a window that changed size near
 * the end would move the bottom of the scroll range under the reader.
 */
export function columnWindow(
  count: number,
  page: number,
  size = COLUMN_WINDOW
): { start: number; end: number } {
  const width = Math.max(1, Math.min(size, count));
  const start = Math.min(
    Math.max(0, page - COLUMN_LEAD),
    Math.max(0, count - width)
  );
  return { start, end: Math.min(count, start + width) };
}

/**
 * The virtual column in hand, or null for the full build.
 *
 * One object rather than a handful of module variables: the plan it was built from,
 * the window it is drawing and the two boxes that stand in for the rows outside it
 * are one state and are reset together.
 */
let virtual: {
  plan: { heights: number[]; offsets: number[] };
  /** The fit the plan was built at, so a refit knows whether to rebuild it */
  fitted: number;
  start: number;
  end: number;
  top: HTMLElement;
  bottom: HTMLElement;
  /** The drawn rows, in order — `start` … `end` */
  rows: HTMLElement[];
} | null = null;
/** The pages the column is drawing, and how to name one — kept for re-windows */
let columnPages: MangaReaderPage[] = [];
let columnUrlOf: ((page: MangaReaderPage, index: number) => string) | null =
  null;

/** The column's content box, as the fit sees it — zeroes when nothing is laid out */
function fittedWidth(reserved: number): number {
  const box = column?.getBoundingClientRect();
  if (!box) return 0;
  return columnFitted(box.width || 0, box.height || 0, reserved);
}

/** One page as a row — the same row the full build makes, made by both paths */
function makeScrollRow(page: MangaReaderPage, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = CLASS_SCROLL_PAGE;
  // The page's own pixels, kept on the row: the zoom is a multiple of them, and
  // asking the picture for them later is asking something that may not have arrived.
  row.dataset.width = String(page.width > 0 ? page.width : 0);
  if (page.width > 0 && page.height > 0) {
    row.style.aspectRatio = page.width + " / " + page.height;
  }

  const image = document.createElement("img");
  image.src = columnUrlOf ? columnUrlOf(page, index) : "";
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
  return row;
}

/** A box standing in for the rows above or below the window */
function makePad(): HTMLElement {
  const pad = document.createElement("div");
  pad.className = CLASS_SCROLL_PAD;
  return pad;
}

/** The width one row is drawn at: the fit, capped by the page's own pixels, zoomed */
function rowWidth(page: MangaReaderPage, fit: number): number {
  return zoom * Math.min(page.width > 0 ? page.width : fit, fit);
}

/**
 * The pads and the drawn rows, at the zoom and fit in hand — without touching which
 * rows those are.
 *
 * Shared by the two times the numbers change but the window does not: a zoom, and a
 * jump to a page already on screen. Re-creating the rows there would throw away twelve
 * `<img>` elements the browser had already fetched.
 */
function applyWindow(): void {
  if (!virtual || !column) return;

  const { plan, start, end, rows, fitted, top, bottom } = virtual;
  const total = plan.offsets[plan.offsets.length - 1];
  setPad(top, plan.offsets[start]);
  setPad(bottom, total - plan.offsets[end]);

  rows.forEach((row, at) => {
    const width = rowWidth(columnPages[start + at], fitted) + "px";
    setStyle(row, "width", width);
    // The same number for the cap: the row's width here is already the page's own
    // pixels when those are the smaller of the two, which is the whole of what the
    // cap says. (The full build spells it as two values because it writes the fit
    // first and the cap second — see setColumnZoom.)
    setStyle(row, "maxWidth", width);
  });
}

/** Draws the rows of the window in hand, and then the numbers that place them */
function drawWindow(): void {
  if (!virtual || !column) return;

  const { start, end, top, bottom } = virtual;
  virtual.rows = [];

  column.textContent = "";
  column.appendChild(top);
  for (let i = start; i < end; i++) {
    const row = makeScrollRow(columnPages[i], i);
    virtual.rows.push(row);
    column.appendChild(row);
  }
  column.appendChild(bottom);
  applyWindow();
}

/** One pad's height, at the zoom in hand */
function setPad(pad: HTMLElement, height: number): void {
  const next = zoom * height + "px";
  if (pad.style.height !== next) pad.style.height = next;
}

/**
 * Draws the window around a page — the one place the set of rows can change.
 *
 * The pads take the place of everything not drawn, so the content's height and every
 * offset are those of the whole book: changing the window does not move the reader's
 * scroll position, and the scrollbar, the progress bar and a jump to a page all go on
 * meaning what they meant. A page already inside the window changes nothing but the
 * numbers.
 */
function renderWindow(page: number): void {
  if (!virtual || !column) return;

  const next = columnWindow(columnPages.length, Math.max(0, page));
  const same =
    next.start === virtual.start &&
    next.end === virtual.end &&
    virtual.rows.length === next.end - next.start;

  virtual.start = next.start;
  virtual.end = next.end;
  if (same) applyWindow();
  else drawWindow();
}

/**
 * The fitted width the plan is built from, with the room the bar stands on left out.
 *
 * A page's height is its width times its ratio, and the width is the fit capped by
 * the page's own pixels — so the plan is only right for the fit it was made at. A
 * zoom is a multiplier and does not belong here; a resize is a new plan.
 */
function replan(fitted: number): void {
  if (!virtual) return;
  const plan = columnPlan(columnPages, fitted);
  if (!plan) return;
  virtual.plan = plan;
  virtual.fitted = fitted;
}

/**
 * Every page as a row of the column, in reading order — or, when the column can be
 * planned, the window around the page being read.
 *
 * Reading order and not path order: the list is the one the lightbox is reading, the
 * same list the other two modes lay out, so a gallery sorted by title scrolls in that
 * order here as well.
 *
 * Each row's height is **reserved from the page's own size**, and each page is no
 * wider than its own pixels: a page drawn wider than it was is a page made blurry, and
 * a row whose height is not known until its picture lands is the whole column jumping
 * down by one page every time one arrives.
 *
 * **Virtual or not is decided here, once per column.** A measurable box and every page
 * with a size of its own means the whole column can be laid out as arithmetic, and
 * only a window of it is drawn; anything else — a box not laid out yet, a page Stash
 * did not measure — is the full build this always was. The two paths share the row
 * builder and the width rule, so they cannot disagree about what a row is.
 */
export function buildColumn(
  into: HTMLElement,
  pages: MangaReaderPage[],
  urlOf: (page: MangaReaderPage, index: number) => string
): void {
  column = into;
  columnPages = pages;
  columnUrlOf = urlOf;
  virtual = null;
  into.textContent = "";

  const plan = columnPlan(pages, fittedWidth(0));
  if (plan && pages.length > COLUMN_WINDOW * 2) {
    virtual = {
      plan,
      fitted: fittedWidth(0),
      start: 0,
      end: 0,
      top: makePad(),
      bottom: makePad(),
      rows: [],
    };
    renderWindow(0);
    return;
  }

  pages.forEach((page, index) => {
    into.appendChild(makeScrollRow(page, index));
  });
}

/** How far down a page's row begins, or null when the column has no such row */
export function rowOffset(into: HTMLElement, index: number): number | null {
  if (virtual && into === column) {
    if (index < 0 || index >= columnPages.length) return null;
    return zoom * virtual.plan.offsets[index];
  }

  const row = into.querySelectorAll("." + CLASS_SCROLL_PAGE)[index] as
    | HTMLElement
    | undefined;

  return row ? row.offsetTop : null;
}

/**
 * Which page the column has at its top.
 *
 * The planned column answers from its own arithmetic — the scroll position divided by
 * the zoom, bisected over the plan's offsets. The full build has no such numbers, so
 * it asks the browser where its rows are, as it always did.
 */
export function columnPageAt(into: HTMLElement): number {
  if (virtual && into === column) {
    const total = virtual.plan.offsets[virtual.plan.offsets.length - 1];
    if (total <= 0) return -1;
    return pageAtOffset(
      virtual.plan.offsets,
      Math.max(0, into.scrollTop || 0) / zoom
    );
  }

  const rows = into.querySelectorAll("." + CLASS_SCROLL_PAGE);
  if (rows.length === 0) return -1;

  const edge = into.getBoundingClientRect().top;

  // The rows are in reading order and their tops increase, so the first row whose
  // bottom is past the edge is found by bisection: a handful of layout reads per
  // scroll event instead of one for every page.
  let low = 0;
  let high = rows.length - 1;
  let found = rows.length - 1; // every row above the edge: the last page

  while (low <= high) {
    const mid = (low + high) >> 1;
    const rect = (rows[mid] as HTMLElement).getBoundingClientRect();
    if (rect.bottom > edge) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return found;
}

/**
 * Puts the column at a page, drawing the window around it first.
 *
 * The scroll position is set while the window that contains the page is in the
 * document — a scroll to an offset no drawn row covers would be clamped to what the
 * pads happen to say, and the browser would put the reader somewhere else.
 */
export function scrollColumnTo(into: HTMLElement, page: number): void {
  const offset = rowOffset(into, page);
  if (offset === null) return;

  if (virtual && into === column) renderWindow(page);
  into.scrollTop = offset;
}

/**
 * The reader scrolled: slide the window if the page at the top has moved near its
 * edge. Called from the scroll handler, after the place has been read.
 *
 * Near the edge rather than past it: one row of margin each way, so a scroll that is
 * still inside the window draws nothing, and one that has nearly left it has its next
 * pages already there.
 */
export function columnScrolled(into: HTMLElement): void {
  if (!virtual || into !== column) return;
  const at = columnPageAt(into);
  if (at < 0) return;
  if (at < virtual.start + 1 || at > virtual.end - 2) renderWindow(at);
}

/**
 * The column is gone — a mode that draws screens took the container back.
 *
 * The pages and the plan belong to the column that was built: keeping them would be a
 * window drawn from a book the container is no longer showing (see removeColumn in
 * takeover.ts, which is the only caller).
 */
export function forgetColumn(): void {
  virtual = null;
  columnPages = [];
  columnUrlOf = null;
}

// Published for the smoke test, which reaches the reader's own logic through the
// window — see the note on MangaReaderNamespace in plugin-api.ts.
NR.pageAtTop = pageAtTop;
NR.zoomedBy = zoomedBy;
NR.columnFitted = columnFitted;
NR.pageAtOffset = pageAtOffset;
NR.columnPlan = columnPlan;
NR.columnWindow = columnWindow;
