/**
 * Zoom and pan for the pages this plugin draws.
 *
 * Stash's zoom acts on the image inside its carousel — the carousel this half hides,
 * and whose images it replaces with its own. So the gesture that means "look closer"
 * in Stash's lightbox meant nothing here, and this is what brings it back: the same
 * wheel, the same drag, and the same numbers Stash uses for both.
 *
 * **What is zoomed is a screen, not a page.** Stash's unit is one image; this half's
 * is one screenful, which in a two-page view is two of them. A pair zooms together,
 * because that is what a reader looking closer at a spread means.
 *
 * **The pan is clamped against the pages, not against the box they sit in.** The
 * pages are centred in a box that is usually wider than they are, and a pan clamped
 * by the box would let a page be dragged most of the way off the screen, with nothing
 * to bring it back. The clamp is the difference between the two sizes, and it is what
 * keeps a page where it can be found.
 *
 * Pure: no DOM, no state, and every function is a function of its arguments, so the
 * arithmetic — which is the part that can be wrong in a way nothing else notices — is
 * tested by calling it, and the wiring in takeover.ts is left with measuring and
 * applying.
 */

/** Where the pages are drawn: the fitted size, moved, and nothing else */
export interface MangaReaderView {
  /** 1 is the size the pages are fitted at, which is how they are drawn to begin with */
  zoom: number;
  /** How far the pages have been moved from the middle, in pixels */
  x: number;
  y: number;
}

/** A box in the page, in pixels: one of the two a pan is measured against */
export interface MangaReaderBox {
  width: number;
  height: number;
}

/** The floor Stash puts under its own zoom */
export const VIEW_MIN_ZOOM = 0.1;
/**
 * The ceiling this plugin puts under its own.
 *
 * Stash has none. Past a point — a two-page screen at eight times the fit is a
 * quarter of one page — more is not reading, it is a blur with no way back, and the
 * wheel that got there zooms out again only by the same slow steps.
 */
export const VIEW_MAX_ZOOM = 8;
/** How much one wheel notch changes the zoom — Stash's own step, measured off its source */
export const VIEW_STEP = 1.1;
/** How far one wheel notch scrolls the pages when the wheel is shifted — Stash's own */
export const VIEW_PAN_STEP = 75;
/**
 * How close to the fitted size counts as being the fitted size.
 *
 * Stash's own epsilon, and it is worth its own name: without it a wheel that goes
 * out and comes back leaves the pages a fraction of a percent off, and the header
 * offers to reset a zoom nobody can see.
 */
export const VIEW_SNAP = 0.015;
/**
 * How far the pointer may travel and still be a click rather than a drag.
 *
 * A press that moves is a pan — the pages follow the pointer — and a press that does
 * not is the click that turns the page. Without a threshold every drag would end in
 * a turn, because that is what a click on a page means.
 */
export const VIEW_SLOP = 4;

/** The fitted view: what a screen is drawn at, and what a zoom is reset to */
export function fitView(): MangaReaderView {
  return { zoom: 1, x: 0, y: 0 };
}

/**
 * The same zoom, centred again.
 *
 * What a turn does: Stash resets the *position* on every image change and only
 * resets the zoom if its own `resetZoomOnNav` says so, which it does not by default.
 * Reading small print at 3x and turning the page keeps the 3x.
 */
export function centred(view: MangaReaderView): MangaReaderView {
  return { zoom: view.zoom, x: 0, y: 0 };
}

/** Whether the pages are at the fitted size, which is when there is nothing to reset */
export function isZoomed(view: MangaReaderView): boolean {
  return view.zoom !== 1;
}

/**
 * One step closer, or further away.
 *
 * Bounded at both ends, and snapped to 1 near it — see VIEW_SNAP. The pan is not
 * touched here: whether a pan is still possible after a zoom is a question about the
 * pages, and the caller has their size.
 */
export function zoomed(view: MangaReaderView, factor: number): MangaReaderView {
  const wanted = Math.min(
    Math.max(view.zoom * factor, VIEW_MIN_ZOOM),
    VIEW_MAX_ZOOM
  );
  const zoom = Math.abs(wanted - 1) < VIEW_SNAP ? 1 : wanted;

  return { ...view, zoom };
}

/**
 * The pages moved by a pointer's worth of pixels, and then put back in their box.
 *
 * Clamped to what the scaled pages can give: if they are wider than the box there is
 * that much to pan, and if they are not there is nothing, so a press on a fitted
 * page moves nothing at all. Both ends are clamped, which Stash's own drag is not —
 * its pages can be thrown off the screen and only a click brings them back.
 */
export function panned(
  view: MangaReaderView,
  dx: number,
  dy: number,
  pages: MangaReaderBox,
  box: MangaReaderBox
): MangaReaderView {
  return {
    zoom: view.zoom,
    x: clamp(view.x + dx, (view.zoom * pages.width - box.width) / 2),
    y: clamp(view.y + dy, (view.zoom * pages.height - box.height) / 2),
  };
}

/** Within `limit` either way, and never outside 0 — a box with nothing to pan in it */
function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;

  const bound = Math.max(limit, 0);
  if (!Number.isFinite(bound)) return 0;

  return Math.min(Math.max(value, -bound), bound);
}
