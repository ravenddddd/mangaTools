/**
 * The reader on a touchscreen: what a finger's movement means.
 *
 * Pure decisions, no DOM — the wiring lives in takeover.ts and the bar's own in
 * progress.ts. What is here is the part that can be wrong in a way nothing else
 * notices: how far a finger may move and still be a tap, how far it must move to be a
 * swipe, which third of the page a tap landed in, whether two taps are a double tap,
 * and how far a pinch has taken the zoom.
 *
 * **The numbers.** A tap is ten pixels and four hundred milliseconds — a thumb on
 * glass wanders a little, and a pause before lifting is not a drag. A swipe is forty-
 * eight pixels, and horizontal rather than merely diagonal: at a 1.4 ratio a thumb
 * travelling forty-five degrees is left to the browser, because a reader trying to
 * scroll a screen mode has nowhere to go with that either.
 *
 * **The directions are the book's, not the browser's.** A manga is read right to
 * left, so a swipe *right* is the next page — the finger pulls the sheet the way a
 * paper one is turned — and so is `ArrowRight`, which is the other half of the same
 * promise. A tap on the right third is forward for the same reason.
 *
 * The view arithmetic a pinch needs is in zoom.ts (zoomedAbout); this file only says
 * what the fingers asked for.
 */
import { NR } from "./namespace";
import { VIEW_MAX_ZOOM, VIEW_MIN_ZOOM, VIEW_SNAP } from "./zoom";

/** How far a finger may travel and still be the tap it started as, in pixels */
export const TOUCH_TAP_SLOP = 10;
/** How far a swipe must travel before it is one, in pixels */
export const TOUCH_SWIPE = 48;
/** How long a touch may last and still be a tap, in milliseconds */
export const TOUCH_TAP_MS = 400;
/** The gap between two taps that makes them a double tap, in milliseconds */
export const TOUCH_DOUBLE_MS = 320;
/** How far apart two taps may land and still be the same double tap, in pixels */
export const TOUCH_DOUBLE_SLOP = 40;
/** What a double tap zooms to — close enough to read small print, far enough to keep
 * the page's own shape in sight. Not a setting: a gesture is not where a reader goes
 * looking for preferences, and the wheel's own zoom is still there for the rest. */
export const TOUCH_ZOOM = 2.5;

/** What a finger did, as the reader cares about it */
export type MangaReaderTouchGesture = "tap" | "forward" | "back" | "none";

/**
 * What a movement from a press to its release means.
 *
 * `ms` is how long the finger was down: a tap that lasted longer than TOUCH_TAP_MS is
 * `none`, because a finger resting on a page is a reader looking at it, not asking for
 * the next one.
 */
export function touchGesture(
  dx: number,
  dy: number,
  ms: number
): MangaReaderTouchGesture {
  const across = Math.abs(dx);
  const down = Math.abs(dy);

  if (across <= TOUCH_TAP_SLOP && down <= TOUCH_TAP_SLOP) {
    return ms <= TOUCH_TAP_MS ? "tap" : "none";
  }

  // Forwards is to the right — see the note at the top of this file.
  if (across >= TOUCH_SWIPE && across > down * 1.4) {
    return dx > 0 ? "forward" : "back";
  }

  return "none";
}

/**
 * Which third of the pages a tap landed in: -1 back, 1 forward, 0 the middle.
 *
 * Thirds rather than the halves a mouse click uses, because a finger has no cursor to
 * aim with: the middle of the screen is where a thumb falls, and a reader who meant
 * only to touch the page — or to stop a menu from closing, or to have nothing happen —
 * should not be given a page turn for it. A width that cannot be measured (a box not
 * laid out) is the middle: doing nothing is the honest answer to "where was that".
 */
export function tapZone(x: number, left: number, width: number): -1 | 0 | 1 {
  if (!(width > 0)) return 0;

  const at = (x - left) / width;
  if (at < 1 / 3) return -1;
  if (at > 2 / 3) return 1;
  return 0;
}

/** The spot a tap landed on, for the double tap's own comparison */
export interface MangaReaderTap {
  x: number;
  y: number;
  /** When it was lifted, on the same clock as the next one */
  at: number;
}

/**
 * Whether a tap is the second half of a double tap.
 *
 * Close in time and in place. A second tap far away is a new gesture — the reader
 * moved their hand — and turning it into a zoom would zoom something they were not
 * looking at.
 */
export function isDoubleTap(
  previous: MangaReaderTap | null,
  next: MangaReaderTap
): boolean {
  if (!previous) return false;

  const gap = next.at - previous.at;
  if (gap < 0 || gap > TOUCH_DOUBLE_MS) return false;

  return (
    Math.hypot(next.x - previous.x, next.y - previous.y) <= TOUCH_DOUBLE_SLOP
  );
}

/**
 * The zoom a pinch has asked for: the ratio of the fingers' spread to where it began.
 *
 * Bounded like the wheel's, and snapped to 1 near it — the same numbers and the same
 * reason (see VIEW_SNAP in zoom.ts): a pinch that comes back is a reader who has
 * changed their mind, not one who left the pages a fraction of a percent off and a
 * reset button offering to undo nothing.
 */
export function pinched(
  startZoom: number,
  startDistance: number,
  distance: number
): number {
  if (!(startDistance > 0) || !(distance > 0)) return startZoom;

  const wanted = Math.min(
    Math.max(startZoom * (distance / startDistance), VIEW_MIN_ZOOM),
    VIEW_MAX_ZOOM
  );

  return Math.abs(wanted - 1) < VIEW_SNAP ? 1 : wanted;
}

/**
 * The point between two touches, and how far apart they are.
 *
 * The pinch's two measurements in one place, because a caller that computed one and
 * not the other would be a zoom with no centre or a centre with no scale.
 */
export function pinchPoints(
  a: MangaReaderTap,
  b: MangaReaderTap
): {
  x: number;
  y: number;
  distance: number;
} {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

// Published for the smoke test, which reaches the reader's own logic through the
// window — see the note on MangaReaderNamespace in plugin-api.ts.
NR.touchGesture = touchGesture;
NR.tapZone = tapZone;
NR.isDoubleTap = isDoubleTap;
NR.pinched = pinched;
NR.TOUCH_ZOOM = TOUCH_ZOOM;
