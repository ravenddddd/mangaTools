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
 * **The drag is Stash's own, which is to say unbounded.** Its image follows the
 * pointer wherever it goes, and what brings it back is the next image: the position
 * is reset every time the picture changes. Clamping the pan to the edge of the
 * screen looks tidier and is not what a reader who has used Stash's lightbox
 * expects, so it is not what this does.
 *
 * **What keeps the pages off the header is the clip, not arithmetic.** Stash's own
 * slides are painted with containment, so a zoomed image is cut off at the edge of
 * the picture area rather than scaled over the controls. See the `overflow` rule in
 * mangaReader.css: the same box, the same cut.
 *
 * Pure: no DOM, no state, and every function is a function of its arguments, so the
 * arithmetic — which is the part that can be wrong in a way nothing else notices — is
 * tested by calling it, and the wiring in takeover.ts is left with applying it.
 */

/** Where the pages are drawn: the fitted size, moved, and nothing else */
export interface MangaReaderView {
  /** 1 is the size the pages are fitted at, which is how they are drawn to begin with */
  zoom: number;
  /** How far the pages have been moved from the middle, in pixels */
  x: number;
  y: number;
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
 * How long a press may last and still be the click that turns a page.
 *
 * Stash's own 200 ms, and it is half of what tells a click from a drag there: the
 * other half is that the pointer never moved. Without it a reader who pressed,
 * thought better of it and released would turn a page they never asked for.
 */
export const VIEW_CLICK_MS = 200;

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
 * touched here: where the pages are looking is a place in the picture, and changing
 * the scale does not move the middle of it.
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
 * The pages moved by a pointer's worth of pixels.
 *
 * Nowhere in particular, and that is the point: Stash's own image follows the
 * pointer past the edge of the screen and stays there until the next image puts it
 * back in the middle. A pan that stopped at the edge would be this plugin's idea of
 * where the reader meant to stop, and it is not one worth having.
 */
export function panned(
  view: MangaReaderView,
  dx: number,
  dy: number
): MangaReaderView {
  return { zoom: view.zoom, x: view.x + dx, y: view.y + dy };
}
