/**
 * The reading progress bar: where the reader is in the book, and a way to move.
 *
 * Stash has nothing like it — its lightbox has a counter and, if asked for, a strip
 * of thumbnails, and neither is a way to cross four hundred pages — so this is this
 * plugin's own furniture rather than a copy of anything. What it is a copy of is the
 * *feel*: a player's scrubber, which is the one thing a reader has certainly used
 * for exactly this.
 *
 * **The handle follows the pointer, and only the jump is throttled.** Two things at
 * two speeds, and both are needed: the handle is redrawn on every pointer event with
 * its easing switched off, because a handle that moves a page at a time is a handle
 * that does not follow a hand; the jump is held to one every PROGRESS_SCRUB_MS,
 * because a jump is a fetch and a decode. So the bar tracks the pointer exactly and
 * the picture chases it.
 *
 * **A page is a mark on the bar, and the boundary is halfway between two marks.**
 * Page 3 sits at 3/40 and page 4 at 4/40, so letting go at 3.4 lands on 3 and at 3.5
 * on 4: the nearest mark. (Snapping to the slice the pointer is *in* — the `floor`
 * reading — means always arriving backwards, which is what this replaced.) Which
 * *screen* that page belongs to is not this half's business: a jump hands the reader
 * a page and the reader finds the screen holding it.
 *
 * **The read fill ends at that same mark**, which is why the handle sits on its edge
 * and not past it: everything before the mark has been read.
 *
 * **A chapter is a tick, drawn where its first page sits** — the same mark again, so
 * a tick and the handle line up whenever the reader is in that chapter, and two
 * chapters beginning on one page are one tick.
 *
 * Everything above the gestures is a pure function, called by the tests directly:
 * the fractions and the snapping are where a mistake would be invisible in a DOM
 * test and obvious on a bar.
 */
import { numbered } from "../i18n";
import type { MangaReaderPlacedChapter } from "./chapters";

/** Everything the bar draws from, gathered at the moment it is drawn */
export interface ProgressState {
  /** The page the book is open at: the first page of the screen on show */
  at: number;
  /**
   * Whether the bar runs down the side of the picture rather than along the bottom.
   *
   * The third mode is a column of pages rather than a screen, and what a reader wants
   * out of a bar there is what they want out of a scrollbar: the same question — how
   * far through the book am I — asked of a picture that is taller than it is wide.
   * Everything below is the same bar with one axis swapped: the same four pixels of
   * paint, the same sixteen of aim, the same ticks, the same bubble, the same drag.
   */
  vertical: boolean;
  /**
   * Whether the pages were cut again on this pass, so that nothing on screen has been
   * measured under the layout the bar is about to describe.
   *
   * Set by the reader when the pairing changes — a mode switched, a cover taken off a
   * page of its own — and it means the width below is *not* a measurement of a screen
   * that is no longer on the page: it is the previous layout's, or the column's rows'.
   * What the bar does with it is forget what it was holding, rather than hold a number
   * that describes nothing.
   */
  relaid: boolean;
  /** How many pages the gallery has, which is what the bar is a fraction of */
  total: number;
  /**
   * How long the bar stays after the last thing that woke it, in milliseconds — with the
   * two settings that are not lengths of time in it: PROGRESS_HOLD_MS (only while the
   * pointer is on it) and PROGRESS_NEVER (until the lightbox closes).
   *
   * The reader's own, out of the options panel, and passed rather than read from the
   * settings here for the reason everything else in this state is: this half draws from
   * what it is given.
   */
  idleMs: number;
  /**
   * How wide the pages on show are, in pixels — which is how wide the bar is.
   *
   * Measured by the reader, from the pages it drew: the bar belongs to those pages
   * the way a book's own edge does, and a track wider or narrower than the picture
   * reads as a control floating over it rather than as a part of it.
   */
  width: number;
  /** The chapters, placed in the order being read — one tick each */
  chapters: MangaReaderPlacedChapter[];
  /**
   * What the chapter a page is in is called, or "" for a page in none.
   *
   * Asked of the reader rather than worked out here: whether an image is in a
   * chapter is its own list's answer, and this half has page *numbers* only.
   */
  chapterNameAt(page: number): string;
  /** Stash's language, for the one thing here that is a string: an unnamed chapter */
  locale: string | null;
  handlers: {
    /** The page the reader picked, by dragging the bar or clicking a chapter's tick */
    onSeek(at: number): void;
  };
}

/**
 * How long the bar waits between jumps, in milliseconds.
 *
 * Not a speed limit on the reader's hand — the handle above is never throttled. This
 * is how long the pictures are given, which is what a jump costs.
 */
export const PROGRESS_SCRUB_MS = 120;

/**
 * How long the bar is left alone before it gets out of the way, in milliseconds.
 *
 * The **default** rather than the rule: the reader can wind this clock, and the setting is
 * `progressIdleMs` — see PROGRESS_HOLD_MS and PROGRESS_NEVER for the two values of it that
 * are not lengths of time.
 */
export const PROGRESS_IDLE_MS = 2000;

/**
 * The two ends of that clock, neither of which is a length of time.
 *
 * `PROGRESS_HOLD_MS` is "no clock, and no lingering": the bar is a control that is there
 * while the pointer is on it and gone when it leaves, which is the one setting under which
 * a *turn* does not bring it out — there would be nobody pointing at it to read it. Every
 * other value leaves the turn alone and only decides how long the bar stays afterwards.
 *
 * `PROGRESS_NEVER` is the other end: it comes out and it stays out.
 */
export const PROGRESS_HOLD_MS = 0;
export const PROGRESS_NEVER = -1;

/** The longest the reader can ask for, in milliseconds — the slider's top step but one */
export const PROGRESS_IDLE_MAX_MS = 10000;

/** Where a page sits on the bar, as a fraction — see the note above */
export function fractionOfPage(page: number, total: number): number {
  if (total <= 1) return 0;
  return Math.min(Math.max(page, 0), total - 1) / total;
}

/** The page a point on the bar is nearest to, which is the boundary at the half */
export function pageAtFraction(fraction: number, total: number): number {
  if (total <= 1) return 0;
  const page = Math.round(fraction * total);
  return Math.min(Math.max(page, 0), total - 1);
}

/**
 * The chapters as ticks: where each begins, and one only where two begin together.
 *
 * A chapter starting past the end of the gallery has no tick to have — the list is
 * the reader's own and outlives the images under it — and a chapter with no name
 * still gets a tick, unnamed.
 */
export function progressNodes(
  chapters: MangaReaderPlacedChapter[],
  total: number,
  locale: string | null
): { name: string; at: number; fraction: number }[] {
  // The locale is the third rather than the second of the inputs on purpose: it
  // decides one word of one name and nothing about where a tick sits, so a caller
  // reading this for the arithmetic can ignore it.
  const nodes: { name: string; at: number; fraction: number }[] = [];
  const seen = new Set<number>();

  chapters.forEach((chapter, index) => {
    if (chapter.at < 0 || chapter.at >= total || seen.has(chapter.at)) return;
    seen.add(chapter.at);
    nodes.push({
      // A chapter with no name is named by its place, through the one helper the
      // header's menu also names it with: the two must not be able to disagree about
      // what an unnamed chapter is called.
      name:
        chapter.title ||
        numbered(locale, "mangaReader.chapterNumber", index + 1),
      at: chapter.at,
      fraction: fractionOfPage(chapter.at, total),
    });
  });

  return nodes;
}

/** The bar's own classes, kept together: the stylesheet names the same strings */
const CLASS_BAR = "manga-reader-progress";
const CLASS_TRACK = "manga-reader-progress-track";
const CLASS_READ = "manga-reader-progress-read";
const CLASS_THUMB = "manga-reader-progress-thumb";
const CLASS_NODES = "manga-reader-progress-nodes";
const CLASS_PAGE_WORDS = "manga-reader-progress-page";
const CLASS_CHAPTER_WORDS = "manga-reader-progress-chapter";
const CLASS_NODE = "manga-reader-progress-node";
const CLASS_LABEL = "manga-reader-progress-label";
/** While a pointer is down: the handle is the pointer, and nothing eases */
const CLASS_SCRUBBING = "is-scrubbing";
/** While it is asleep: out of sight, and out of the way of clicks */
const CLASS_IDLE = "is-idle";
/** The arrangement: down the side of the picture rather than along its bottom */
const CLASS_VERTICAL = "is-vertical";
/** While the bubble is up: the drag's page, or the chapter a tick is for */
const CLASS_SHOWING = "is-showing";
/** The state the bar was last drawn from, which its gestures read */
let latest: ProgressState | null = null;

/** The elements the bar is made of, and the state its gestures read */
let bar: HTMLElement | null = null;
let track: HTMLElement | null = null;
let read: HTMLElement | null = null;
let thumb: HTMLElement | null = null;
let label: HTMLElement | null = null;
let labelPage: HTMLElement | null = null;
let labelChapter: HTMLElement | null = null;
let nodes: HTMLElement | null = null;

/** What the last pass drew, so a pass that changes nothing writes nothing */
let drawn: { nodes: string; at: number; total: number } | null = null;
/** How wide the label came out, measured when its words change rather than per move */
let lastVertical: boolean | null = null;
let labelWidth = 0;
/** The same, down the side: the bubble is placed along whichever axis the bar runs */
let labelHeight = 0;

/**
 * What the bubble is saying, and where it is saying it, or null when it is down.
 *
 * Kept here rather than worked out in every pass, because those are not the same
 * question: a pass that redrew the bubble from the reader's position drew over a
 * chapter's name the moment the pointer paused on its tick, which is what this did.
 *
 * A bubble that is taken down keeps the words it had while it fades: emptying it
 * first shows something else in the last tenth of a second, which is worse than
 * showing nothing.
 */
let bubble: {
  page: string;
  chapter: string;
  fraction: number;
} | null = null;

/**
 * Where the pointer is along the bar, as a fraction, while it is down.
 *
 * `null` is the whole of "no drag is happening": there is no second flag to fall out
 * of step with this one.
 */
let pointer: number | null = null;
/** Which page the drag is asking for, and when the last jump was sent */
let target = 0;
let lastJump = 0;
let pending: number | null = null;
/** The timer that will put the bar to sleep */
let idle: number | null = null;

/**
 * The last width the pages measured.
 *
 * Kept because a screen whose pictures have not arrived measures nothing, and the bar
 * of the screen before it is a better answer than no bar at all — the reader turned a
 * page, not off. Only the first screen of a gallery has no earlier width to stand on,
 * and that one waits. See the guard in wake.
 */
let lastWidth = 0;

/**
 * Whether the bar was asked for while there was nothing to draw it at.
 *
 * A turn asks the bar to say where the reader has got to, and it cannot while the new
 * pages are still on their way: a bar a point wide says nothing. So the asking is kept
 * and answered when there is a width — the bar comes out as the pages arrive, rather
 * than being left out for a turn nobody can see.
 */
let owed = false;

/**
 * Builds the bar, or updates the one on screen.
 *
 * Built on demand and updated in place, like the header: this runs on every change
 * the lightbox makes, so every write is guarded by a comparison — a write is a
 * change, and a change is another pass.
 */
export function ensureProgress(
  lightbox: Element,
  state: ProgressState
): HTMLElement | null {
  latest = state;

  if (!lightbox.querySelector(".Lightbox-footer")) return bar;

  // A gallery of one page has no progress to show, and a bar across the bottom of a
  // single picture is furniture with nothing to say — Stash draws its own counter
  // only for a lightbox of more than one image, for the same reason. Nothing is
  // built: an element hidden by a rule is still an element this plugin put on the
  // page, and this one has nothing to put there.
  if (state.total <= 1) return null;

  const parent = parentFor(lightbox);
  if (!parent) return null;

  if (!bar) build();
  // React owns the lightbox's children and can take this row away with them; the
  // observer puts it back, the same way the pages' container is put back.
  place(parent);

  if (!bar || !track || !read || !thumb || !label || !nodes) return bar;

  update(state);

  return bar;
}

/** Takes the bar away, with the lightbox it belonged to */
export function removeProgress(lightbox: Element): void {
  const node = lightbox.querySelector("." + CLASS_BAR);
  if (node) node.remove();

  if (node !== bar) return;

  // A drag still in flight: the move and the release are on the *document*, so they
  // outlive the element that started them, and a bar built for the next lightbox would
  // find a hand on it that is not there — holding its width for a press that ended in
  // a gallery nobody is looking at.
  //
  // Let go of it without asking for the page it was over. A release *seeks*, and this
  // one would seek into a lightbox that is being taken apart: the reader would lay out
  // and draw a screen for a container that no longer exists, over and over.
  if (pressed) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onRelease);
  }

  stopTimers();

  bar = null;
  track = null;
  read = null;
  thumb = null;
  label = null;
  nodes = null;
  drawn = null;
  latest = null;
  bubble = null;
  pointer = null;
  pressed = false;
  onTrack = false;
  labelWidth = 0;
  labelHeight = 0;
  // The width remembered for the pages and the wake that was owed are both the
  // *lightbox's* rather than the session's: each is something a screen whose pictures
  // have not arrived stands on, and the screen before them was in another book — where
  // the pages may be a different size, and where the reader was looking at something
  // else. Kept, they are a bar drawn at the last book's width, or a bar that comes out
  // over a picture nobody has looked at yet — which is the state this bar is asleep in
  // the first place for.
  lastWidth = 0;
  owed = false;
}

/**
 * Which way the bar runs, as the last pass was told.
 *
 * Read from the state rather than kept in a variable of its own: the mode is the
 * state's to know, and a second copy of it here is a second thing to keep in step.
 */
function vertical(): boolean {
  return latest?.vertical === true;
}

/**
 * How much of the picture area's right edge the bar stands on, in pixels.
 *
 * Zero unless the bar is the column's — a bar along the bottom takes nothing off a
 * width — and zero when it has not been drawn or measured yet, which is the answer the
 * caller acts on by leaving the whole width alone.
 *
 * The column's *fit* leaves this space, so a reader opening the column sees the whole
 * page beside the bar rather than under it — and with the same gap on the bar's far side
 * as on its near one. A zoom past the fit is free to run under it: the reader asked for
 * bigger, and the bar is a thin thing which by then is over the margin rather than over
 * the page.
 */
export function barReserve(area: { left: number; width: number }): number {
  if (!vertical() || !bar) return 0;

  const box = bar.getBoundingClientRect();
  if (!box.width) return 0;

  // The bar's own air on the side it is pinned to, mirrored on the other side of it: a
  // reader sees the same gap either side of the line rather than the page touching it on
  // one. Measured from the same rectangle, so the stylesheet's `right: 10px` stays the
  // stylesheet's — this is that number, read back rather than repeated.
  const right = area.left + area.width;
  const air = right - (box.left + box.width);

  return Math.max(0, right - box.left + air);
}

/**
 * How far along the bar something sits: a fraction, in the bar's own direction.
 *
 * The other axis is **cleared** rather than left where it was. The bar is one element
 * in both arrangements — the mode is a setting and can be turned while it is open —
 * and a reader who switched from the column back to a screen would otherwise be left
 * with a fill whose `height` the stylesheet wants and whose `width` an inline style
 * still says: an inline style wins, and the line would be the wrong length in a way
 * nothing in the drawing code could see.
 */
function setAlong(node: HTMLElement, fraction: number): void {
  const at = (fraction * 100).toFixed(3) + "%";

  if (vertical()) {
    if (node.style.top !== at) node.style.top = at;
    if (node.style.left) node.style.left = "";
  } else {
    if (node.style.left !== at) node.style.left = at;
    if (node.style.top) node.style.top = "";
  }
}

/** How long the filled part of the bar is, along it */
function setAlongLength(node: HTMLElement, fraction: number): void {
  const at = (fraction * 100).toFixed(3) + "%";

  if (vertical()) {
    if (node.style.height !== at) node.style.height = at;
    if (node.style.width) node.style.width = "";
  } else {
    if (node.style.width !== at) node.style.width = at;
    if (node.style.height) node.style.height = "";
  }
}

/** The elements the bar is made of, once per lightbox */
function build(): void {
  bar = document.createElement("div");
  // Asleep to begin with: a lightbox that has just opened has said nothing yet, and a
  // bar that appears over the picture with it is a bar to be got rid of before the
  // picture can be read. What wakes it is the pointer reaching it, or a turn.
  bar.className = CLASS_BAR + " " + CLASS_IDLE;

  label = document.createElement("div");
  label.className = CLASS_LABEL;

  // Two lines: where the reader is, and what the chapter there is called. Neither in
  // the same breath as the other, because they are different kinds of thing — a
  // number that changes every screen, and a name that changes every few dozen.
  labelPage = document.createElement("div");
  labelPage.className = CLASS_PAGE_WORDS;
  labelChapter = document.createElement("div");
  labelChapter.className = CLASS_CHAPTER_WORDS;
  label.appendChild(labelPage);
  label.appendChild(labelChapter);

  track = document.createElement("div");
  track.className = CLASS_TRACK;

  read = document.createElement("div");
  read.className = CLASS_READ;

  nodes = document.createElement("div");
  nodes.className = CLASS_NODES;

  thumb = document.createElement("div");
  thumb.className = CLASS_THUMB;

  track.appendChild(read);
  track.appendChild(nodes);
  track.appendChild(thumb);
  // In the track, with it: the bubble is the width of the line it is about, so a
  // fraction of one is a place on the other. In the row, it would be measured
  // against whatever is positioned above that, which is the lightbox.
  track.appendChild(label);
  bar.appendChild(track);

  // The track, not the row it sits in: what a reader sees as the bar is the line, and
  // a strip the full width of the lightbox that answered to the pointer would keep the
  // bar awake for every movement along the bottom of the window — including the ones
  // that never came near it.
  //
  // It works while the bar is asleep because the track is a row of its own, over
  // nothing that anybody else wants.
  track.addEventListener("mousemove", onMoveOverBar);
  track.addEventListener("mouseleave", onLeaveTrack);

  track.addEventListener("mousedown", onPress);
}

/** The picture area, which the column's bar is drawn over rather than beside */
const SELECTOR_DISPLAY = ".Lightbox-display";

/**
 * Where the bar belongs, which is a different place in each arrangement.
 *
 * Along the bottom it gets **a row of its own**, between the picture and the footer:
 * a line drawn across the bottom of the pages would be a line across the pages, so it
 * sits against the footer, in the lightbox's own column.
 *
 * Down the side it goes **into the picture area**, because that is what it is as tall
 * as — the pages themselves. An overlay, by the same argument the other way: a
 * vertical strip beside the picture would be a strip taken off the picture.
 */
function parentFor(lightbox: Element): Element | null {
  if (!vertical()) return lightbox;
  return lightbox.querySelector(SELECTOR_DISPLAY);
}

/** Puts the bar where this arrangement wants it */
function place(parent: Element): void {
  if (!bar || bar.parentNode === parent) return;

  if (parent.classList.contains("Lightbox-display")) {
    parent.appendChild(bar);
    return;
  }

  const footer = parent.querySelector(".Lightbox-footer");
  if (footer) parent.insertBefore(bar, footer);
  else parent.appendChild(bar);
}

/** Draws the bar from a state: the ticks, the fill, the handle, the words */
function update(state: ProgressState): void {
  if (!bar || !track || !read || !thumb || !label || !nodes) return;

  // The bar's own arrangement, which can change while it is on screen: the mode is a
  // setting, and the same bar is the same bar.
  //
  // A change of axis draws the ticks again, and *here*, above the gate that decides
  // whether to: they are written in one property or the other, and nothing else about
  // them changes when the bar turns — so a gate asking whether the *chapters* are the
  // same would leave them pointing along the axis they were made for. Below that gate
  // the invalidation would only be read by the next pass, and for a bar that has
  // stopped changing there is no next pass.
  if (state.vertical !== lastVertical) {
    lastVertical = state.vertical;
    drawn = null;
  }

  const key = state.chapters.map((c) => c.at + ":" + c.title).join("|");
  if (!drawn || drawn.nodes !== key || drawn.total !== state.total) {
    drawNodes(state);
  }

  bar.classList.toggle(CLASS_VERTICAL, state.vertical);

  // What the pages measure, remembered whenever there is a measurement to remember:
  // a screen whose pictures are still arriving measures nothing, and the width of the
  // screen before it is the better answer. The column's bar is measured by nobody: its
  // length is the picture area's, which the stylesheet says.
  //
  // Forgotten first when the pages were cut again on this pass — the screen before it is
  // from another layout in every sense, and holding its width is how the bar came out at
  // very nearly the full length of the picture area for a moment on the way out of the
  // column, where a page *is* that wide.
  if (state.relaid) lastWidth = 0;
  if (state.width > 0) lastWidth = state.width;

  // And it is written to the track only with no pointer down. The bar's width is half
  // of what turns a pointer's x into a page, so a drag that narrowed it as it went
  // would move the pages out from under the hand that was choosing them; the drag
  // takes the width it has been holding when it is let go of, and the easing above
  // carries it there.
  if (state.vertical) {
    // The column's bar is as long as the picture area, and the stylesheet is what says
    // so — a width left over from the other arrangement would win over it.
    if (track.style.width) track.style.width = "";
  } else if (!pressed && lastWidth > 0) {
    const wanted = Math.round(lastWidth) + "px";
    if (track.style.width !== wanted) track.style.width = wanted;
  } else if (!lastWidth) {
    // Nothing to hold — the pages on show have not been measured: the first screen of a
    // gallery, or the pass that re-cut them. The width that was written *before* goes with
    // it, or the track would keep drawing the old length from its own inline style while
    // the bar is waiting to be told a new one.
    if (track.style.width) track.style.width = "";
  }

  const settled = fractionOfPage(state.at, state.total);
  const fraction = pointer === null ? settled : pointer;

  setAlongLength(read, fraction);
  setAlong(thumb, fraction);

  // The bubble, when there is one. What it says was decided where it was set — see
  // setBubble — and a pass only draws it: writing it here is what let the reader's
  // own position land on top of a chapter's name.
  if (bubble) {
    if (labelPage?.textContent !== bubble.page) {
      if (labelPage) labelPage.textContent = bubble.page;
      labelWidth = label.offsetWidth;
      labelHeight = label.offsetHeight;
    }
    if (labelChapter?.textContent !== bubble.chapter) {
      if (labelChapter) labelChapter.textContent = bubble.chapter;
      labelWidth = label.offsetWidth;
      labelHeight = label.offsetHeight;
    }
  }

  // Where the bubble points is wherever it was put. With none up there is nothing to
  // point at, and moving the label to the handle is what made it slide across the bar
  // during the fade it was on its way out with.
  if (bubble) {
    const half = (vertical() ? labelHeight : labelWidth) / 2;
    const span = vertical() ? track.clientHeight : track.clientWidth;
    const px =
      Math.max(
        half,
        Math.min(bubble.fraction * (span || 0), (span || 0) - half)
      ).toFixed(0) + "px";

    if (vertical()) {
      if (label.style.top !== px) label.style.top = px;
    } else if (label.style.left !== px) label.style.left = px;
  }

  // A bar with something new to say comes back: the reader who turned a page is
  // looking at the pages, and the bar is how they see where that was. Not on the
  // first pass, though — a lightbox that has just opened has said nothing yet, and a
  // bar that appears with it is a bar that has to be dismissed before it can be read.
  // A wake that was owed, now that there is a width to draw the bar at.
  if (owed && (state.vertical || state.width > 0)) {
    owed = false;
    wake();
  }

  const moved =
    drawn !== null && (drawn.at !== state.at || drawn.total !== state.total);
  drawn = { nodes: key, at: state.at, total: state.total };

  // A tick's name is about where the reader was, and the book can move under a
  // pointer that has not — the bar's width changes with the screen. Then the bubble
  // is about a chapter nobody is pointing at, and no mouse event is coming to say so.
  //
  // Not while a pointer is down, though: a drag's jump *is* the book moving, and this
  // is what a drag landing on the page it was going to would take its own bubble away
  // with — which is what it did, whenever a pointer stopped to let a jump arrive.
  if (moved && !pressed) takeBubbleDown();
  if (moved) wake();
}

/** One tick per chapter, where its first page sits */
function drawNodes(state: ProgressState): void {
  if (!nodes) return;

  nodes.textContent = "";

  for (const node of progressNodes(state.chapters, state.total, state.locale)) {
    const tick = document.createElement("div");
    tick.className = CLASS_NODE;
    setAlong(tick, node.fraction);
    // What this tick is, kept on it: a press on it is that chapter — on the press, as
    // a press anywhere else on the line goes to where it landed — and the bubble says
    // its name. Both are read back from the DOM, because a tick redrawn under a
    // stationary pointer has no way to say that it has gone or that it is here.
    tick.dataset.name = node.name;
    tick.dataset.at = String(node.at);
    tick.dataset.fraction = String(node.fraction);
    nodes.appendChild(tick);
  }
}

/**
 * The pointer moving over the bar: awake, and either on a tick or not.
 *
 * One listener for the whole row rather than one per tick, because "the pointer is no
 * longer on that tick" is a question a tick cannot answer once it has been redrawn
 * under a pointer that has not moved and is no longer over it: nothing tells it.
 */
function onMoveOverBar(event: Event): void {
  // The pointer is on the line, which is a fact one of the clock's settings is about —
  // see PROGRESS_HOLD_MS. Set before waking, since waking is what reads it.
  onTrack = true;
  wake();

  // A drag has a bubble of its own, and the pointer crossing a tick on its way is not
  // a reason to change it: what a drag says is where it is going, not which chapter
  // it happens to be passing over.
  if (pressed) return;

  const node = event.target as HTMLElement | null;
  const tick = node?.classList?.contains(CLASS_NODE) ? node : null;

  if (!tick) {
    takeBubbleDown();
    return;
  }

  const chapter = tick.dataset?.name || "";
  if (bubble?.chapter === chapter) return;

  setBubble({
    page: "",
    chapter,
    fraction: Number(tick.dataset?.fraction || 0),
  });
  redraw();
}

/** The pointer left the line: the bubble goes, unless a drag is holding it */
function onLeaveTrack(): void {
  onTrack = false;
  if (!pressed) takeBubbleDown();

  // With no lingering allowed the pointer *is* the bar's visibility: it leaves, and the
  // bar goes with it. Every other setting has a clock to wait on instead — see wake.
  if (!pressed && latest?.idleMs === PROGRESS_HOLD_MS) {
    bar?.classList.add(CLASS_IDLE);
  }
}

/**
 * The tick a pointer is on, if it is on one.
 *
 * The whole height of the track counts, since that is the box a tick answers to: a
 * reader aiming at a chapter aims at the place, not at the four pixels of it that are
 * painted.
 */
function tickUnder(target: EventTarget | null): HTMLElement | null {
  const node = target as HTMLElement | null;
  return node?.classList?.contains(CLASS_NODE) ? node : null;
}

/** Puts the bubble up, or moves it: what it says is decided by whoever calls this */
function setBubble(next: {
  page: string;
  chapter: string;
  fraction: number;
}): void {
  bubble = next;
  bar?.classList.add(CLASS_SHOWING);
}

/** Takes the bubble down, leaving it the words it had to fade out with */
function takeBubbleDown(): void {
  if (!bubble) return;

  bubble = null;
  bar?.classList.remove(CLASS_SHOWING);
  redraw();
}

/** Brings the bar back, and starts the clock that will put it away again */
function wake(): void {
  if (!bar) return;

  // Nothing measured yet: the pages are still on their way, and a bar a point wide is
  // worse than no bar — least of all here, where there is no earlier width to stand
  // on. The row keeps its place so the picture does not move; what brings the bar out
  // is the pass an image's own `load` asks for. See the load listener in takeover.ts.
  //
  // The column's bar is never in that position: nothing about it is measured, so
  // there is always something to draw it at.
  if (!vertical() && lastWidth <= 0) {
    bar.classList.add(CLASS_IDLE);
    owed = true;
    return;
  }

  // Whatever clock was running goes, because the reader can move this setting while the
  // bar is out — and a clock set under the old one would put the bar away under the new.
  if (idle !== null) {
    window.clearTimeout(idle);
    idle = null;
  }

  const idleMs = latest?.idleMs ?? PROGRESS_IDLE_MS;

  // No lingering, so no clock: the pointer is what has this bar out, and a turn that
  // called this is a turn that would be showing a bar to nobody. See onLeaveTrack, which
  // is the other half of it.
  if (idleMs === PROGRESS_HOLD_MS) {
    bar.classList.toggle(CLASS_IDLE, !onTrack);
    return;
  }

  bar.classList.remove(CLASS_IDLE);

  // …and the other end: out, and out it stays.
  if (idleMs === PROGRESS_NEVER) return;

  idle = window.setTimeout(() => {
    idle = null;
    bar?.classList.add(CLASS_IDLE);
  }, idleMs);
}

function stopTimers(): void {
  if (idle !== null) window.clearTimeout(idle);
  if (pending !== null) window.clearTimeout(pending);
  idle = null;
  pending = null;
}

/** Whether a pointer is down on the bar */
let pressed = false;

/**
 * Whether the pointer is on the bar's line at all.
 *
 * Kept because one of the clock's settings is about exactly that — see PROGRESS_HOLD_MS,
 * where the pointer is the whole of the bar's visibility. Written in three places, all of
 * them pointer events on the track: a move over it, a leave, and a press that landed on it
 * without a move first.
 */
let onTrack = false;

/**
 * Where a pointer is along the track, as a fraction of its length.
 *
 * The one place the axis has to be chosen twice: which of the pointer's two
 * coordinates is the one along the bar, and which of the box's two extents it is a
 * fraction of. Everything above this line is the same arithmetic either way, which is
 * what makes the two arrangements one bar rather than two.
 */
function fractionAt(event: MouseEvent): number {
  if (!track) return 0;

  const rect = track.getBoundingClientRect();
  const span = vertical()
    ? rect.height || track.clientHeight || 1
    : rect.width || track.clientWidth || 1;
  const from = vertical()
    ? event.clientY - rect.top
    : event.clientX - rect.left;

  return Math.min(Math.max(from / span, 0), 1);
}

function onPress(event: Event): void {
  const press = event as MouseEvent;
  if (press.button !== 0 || !track) return;

  press.preventDefault();
  press.stopPropagation();

  // A press on the line is on it, whether or not a move was seen first: a hand that lands
  // and drags has not been anywhere else, and the setting with no lingering in it would
  // otherwise put the bar away under the drag that is using it.
  onTrack = true;

  pressed = true;
  bar?.classList.add(CLASS_SCRUBBING);

  // A press on a chapter's tick is that chapter, and it goes on the press: the same
  // rule as a press anywhere else on the line, which goes to where it landed. What is
  // different is what the bubble says — the name it already had, until the pointer
  // moves and the drag has something of its own to say.
  const tick = tickUnder(press.target);
  if (tick) {
    const fraction = Number(tick.dataset?.fraction || 0);
    target = Number(tick.dataset?.at || 0);
    pointer = fraction;
    lastJump = Date.now();
    // Said here as well as on the hover, because a finger never hovers: a press that
    // arrived without one would otherwise be a jump to a chapter that says nothing.
    setBubble({ page: "", chapter: tick.dataset?.name || "", fraction });
    latest?.handlers.onSeek(target);
    redraw();
  } else {
    // Whatever the pointer was over, it is dragging now.
    bubble = null;
    scrubTo(fractionAt(press));
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onRelease);
}

function onMove(event: Event): void {
  if (!pressed) return;
  scrubTo(fractionAt(event as MouseEvent));
}

function onRelease(): void {
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseup", onRelease);

  pressed = false;
  bar?.classList.remove(CLASS_SCRUBBING);
  settle();
}

/**
 * The pointer moved: the handle follows it, and the jump is what waits.
 *
 * Two speeds, deliberately — see the note at the top of the file. The handle is
 * drawn here on every event; the jump is the part held to PROGRESS_SCRUB_MS.
 */
function scrubTo(fraction: number): void {
  pointer = fraction;
  target = pageAtFraction(fraction, latest?.total ?? 1);
  setBubble({
    page: target + 1 + " / " + (latest?.total ?? 1),
    chapter: latest?.chapterNameAt(target) || "",
    fraction,
  });
  redraw();

  // Already over the page the book is open at — which for a two-page screen is
  // either of its pages, so a drag across a pair asks for nothing.
  if (!latest || target === latest.at) return;

  const since = Date.now() - lastJump;
  if (pending !== null) {
    window.clearTimeout(pending);
    pending = null;
  }

  if (since >= PROGRESS_SCRUB_MS) {
    lastJump = Date.now();
    latest.handlers.onSeek(target);
  } else {
    pending = window.setTimeout(() => {
      pending = null;
      lastJump = Date.now();
      latest?.handlers.onSeek(target);
    }, PROGRESS_SCRUB_MS - since);
  }
}

/** Letting go: the handle settles on the page the reader chose, and stays there */
function settle(): void {
  if (pending !== null) {
    window.clearTimeout(pending);
    pending = null;
  }

  lastJump = Date.now();
  const wanted = target;
  pointer = null;

  latest?.handlers.onSeek(wanted);
  // The drag is over, so its bubble is too: what it was saying was where the drag was
  // going, and the reader has arrived.
  takeBubbleDown();
  redraw();
}

/** Draws the bar again from the state it was last given */
function redraw(): void {
  if (latest) update(latest);
}
