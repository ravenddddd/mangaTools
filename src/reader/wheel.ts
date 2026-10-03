/**
 * The wheel: which chord the reader used, what they have bound it to, and what that means.
 *
 * Three chords — the wheel, and the same wheel with shift or ctrl held — and each of them
 * can be bound to one of three things, or turned off. **Bound per reading mode**: a wheel
 * that turns a page is what a reader wants in front of a screen, and is a jump in a column
 * where the plain wheel is how the column is scrolled, so the bindings are kept in a table
 * of three modes by three chords and the panel edits the row of whichever mode is on.
 *
 * What a *word* means still depends on the mode it is used in — "scroll" is a pan of a
 * zoomed page where the pages are fitted to a screen, and the browser's own scrolling where
 * they are a column — and that is the whole of what is left here.
 *
 * Nothing in this module touches the DOM or the settings: `takeover.ts` asks it what a wheel
 * event should do and then does it, and `chrome.ts` asks it for the table the panel draws.
 */
import type {
  MangaReaderReadingMode,
  MangaReaderWheelAction,
  MangaReaderWheelBindings,
  MangaReaderWheelEffect,
  MangaReaderWheelGesture,
} from "./namespace";

/** The three ways of reading, in the order the panel offers them */
export const READING_MODES: MangaReaderReadingMode[] = [
  "single",
  "double",
  "scroll",
];

/** The three chords of the wheel, in the order the panel lists them */
export const WHEEL_GESTURES: MangaReaderWheelGesture[] = [
  "plain",
  "shift",
  "ctrl",
];

/** The four things a chord can be bound to, in the order the dropdowns offer them */
export const WHEEL_ACTIONS: MangaReaderWheelAction[] = [
  "off",
  "turn",
  "zoom",
  "scroll",
];

/** Whether a value — off a dropdown, or out of a hand-edited settings object — is one */
export function isWheelAction(value: unknown): value is MangaReaderWheelAction {
  return (
    value === "off" ||
    value === "turn" ||
    value === "zoom" ||
    value === "scroll"
  );
}

/** Which of the three chords a wheel event is, ctrl taking precedence over shift */
export function wheelGesture(wheel: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): MangaReaderWheelGesture {
  if (wheel.ctrlKey || wheel.metaKey) return "ctrl";
  return wheel.shiftKey ? "shift" : "plain";
}

/**
 * How far a wheel event travelled, and which way.
 *
 * `deltaY` is the axis a wheel normally sends, and the one this plugin reads everywhere
 * else. `deltaX` is what some browsers put it on when shift is held — scrolling sideways is
 * *their* meaning for that chord — so a chord the reader has bound to something reads
 * whichever axis carries the movement rather than the one that happens to be named. A
 * trackpad that sends both is taken as a vertical movement, which is what it meant.
 */
export function wheelDelta(wheel: { deltaX: number; deltaY: number }): number {
  return wheel.deltaY || wheel.deltaX;
}

/**
 * What a chord actually does, once the mode has been asked as well.
 *
 * Four answers, and two pairs of them are only the same word: "pan" is a transform over
 * pages fitted to a screen, which is what "scroll" means there; "scroll" is the browser's
 * own scrolling, which is what it means in the column — handed over rather than done,
 * because the browser's smooth scrolling is better than anything this plugin would write.
 * "None" is the chord turned off: the event is taken and nothing is done with it, so that
 * off means off in every mode rather than in the two that have something to scroll.
 *
 * "Turn" is the same turn every other way of asking for one makes — `turnBy`, which is a
 * screen where a screen is read and the next page's row in the column. A wheel is a
 * continuous device, which is why the column's *plain* wheel is bound to scrolling rather
 * than to this; a reader who binds a chord to it there has asked for pages, and gets them.
 */
export function wheelEffect(
  action: MangaReaderWheelAction,
  scrolling: boolean
): MangaReaderWheelEffect {
  if (action === "off") return "none";
  if (action === "turn") return "turn";
  if (action === "zoom") return "zoom";
  return scrolling ? "scroll" : "pan";
}

/** The three chords with one of them rebound, which is how the panel writes a choice */
export function withWheelAction(
  wheel: MangaReaderWheelBindings,
  gesture: MangaReaderWheelGesture,
  action: MangaReaderWheelAction
): MangaReaderWheelBindings {
  return { ...wheel, [gesture]: action };
}

/**
 * The three chords as a reader who has never touched them has them, for one way of reading.
 *
 * The column is the one mode where the plain wheel is the reading gesture: it scrolls, and
 * freely — so the chord a reader holds down is the one that goes a page at a time. In front
 * of a screen it is the other way round, which is what this plugin has always done: the
 * wheel turns the page, and shift goes up and down a tall one.
 */
export function defaultWheel(
  mode: MangaReaderReadingMode
): MangaReaderWheelBindings {
  return mode === "scroll"
    ? { plain: "scroll", shift: "turn", ctrl: "zoom" }
    : { plain: "turn", shift: "scroll", ctrl: "zoom" };
}
