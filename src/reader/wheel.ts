/**
 * The wheel: which chord the reader used, what they have set it to, and what that means.
 *
 * Three chords — the wheel, and the same wheel with shift or ctrl held — and each of them
 * can be bound to one of three things, or turned off. What a chord *means*, though, depends
 * on the mode it is used in, and that is the whole of this module: "scroll" is a pan of a
 * zoomed page where the pages are fitted to a screen, and the browser's own scrolling where
 * they are a column, and neither the reader nor the panel should have to know which.
 *
 * Nothing here touches the DOM or the settings: `takeover.ts` asks it what a wheel event
 * should do and then does it, and `chrome.ts` asks it what a chord is bound to *in this
 * mode* so that the panel can show the reader the truth rather than the stored value.
 */
import type {
  MangaReaderWheelAction,
  MangaReaderWheelEffect,
  MangaReaderWheelGesture,
} from "./namespace";

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
 * What a chord does when the reader has never said — which is the state every install
 * starts in, and the reason this is not one of the choices the panel offers.
 *
 * It is the reader's own arrangement, and it is the one thing here that depends on the
 * mode: a wheel turns a page where a screen is what is being read, and scrolls where the
 * pages are a column (there, scrolling *is* reading). Shift is Stash's own meaning for it —
 * up and down a tall page — and ctrl is the chord every mode zooms with, which is also
 * where a browser puts its own zoom and therefore a chord this plugin takes rather than
 * passes on.
 */
export function autoWheelAction(
  gesture: MangaReaderWheelGesture,
  scrolling: boolean
): MangaReaderWheelAction {
  if (gesture === "ctrl") return "zoom";
  if (scrolling) return "scroll";
  return gesture === "shift" ? "scroll" : "turn";
}

/**
 * What a chord actually does, once both the mode and the setting have been asked.
 *
 * Five answers, and two pairs of them are only the same word: "pan" is a transform over
 * pages fitted to a screen, which is what "scroll" means there; "scroll" is the browser's
 * own scrolling, which is what it means in the column — handed over rather than done,
 * because the browser's smooth scrolling is better than anything this plugin would write.
 * "None" is the setting that turns a chord off: the event is taken, and nothing is done
 * with it, so that "off" means off in every mode rather than in the two that have something
 * to scroll.
 */
export function wheelEffect(
  action: MangaReaderWheelAction,
  gesture: MangaReaderWheelGesture,
  scrolling: boolean
): MangaReaderWheelEffect {
  const chosen =
    action === "auto" ? autoWheelAction(gesture, scrolling) : action;

  if (chosen === "off") return "none";
  if (chosen === "turn") return "turn";
  if (chosen === "zoom") return "zoom";
  // "scroll" is the browser's where there is a scroll box to hand it to, and this
  // plugin's own pan where there is not.
  return scrolling ? "scroll" : "pan";
}
