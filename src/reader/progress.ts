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
import type { MangaReaderPlacedChapter } from "./chapters";

/** Everything the bar draws from, gathered at the moment it is drawn */
export interface ProgressState {
  /** The page the book is open at: the first page of the screen on show */
  at: number;
  /** How many pages the gallery has, which is what the bar is a fraction of */
  total: number;
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

/** How long the bar is left alone before it gets out of the way, in milliseconds */
export const PROGRESS_IDLE_MS = 2000;

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
  total: number
): { name: string; at: number; fraction: number }[] {
  const nodes: { name: string; at: number; fraction: number }[] = [];
  const seen = new Set<number>();

  chapters.forEach((chapter, index) => {
    if (chapter.at < 0 || chapter.at >= total || seen.has(chapter.at)) return;
    seen.add(chapter.at);
    nodes.push({
      // A chapter with no name is named by its place, which is what the header's own
      // menu calls it too.
      name: chapter.title || "#" + (index + 1),
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
let labelWidth = 0;

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

  if (!bar) build(lightbox);
  // React owns the lightbox's children and can take this row away with them; the
  // observer puts it back, the same way the pages' container is put back.
  else if (bar.parentNode !== lightbox) place(lightbox);

  if (!bar || !track || !read || !thumb || !label || !nodes) return bar;

  update(state);

  return bar;
}

/** Takes the bar away, with the lightbox it belonged to */
export function removeProgress(lightbox: Element): void {
  const node = lightbox.querySelector("." + CLASS_BAR);
  if (node) node.remove();

  if (node !== bar) return;

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
  labelWidth = 0;
}

/** The elements the bar is made of, once per lightbox */
function build(lightbox: Element): void {
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
  // The bar is a sibling of the pages rather than a child of them, so a press here
  // never reaches the reader's own press. A *click* would still reach the lightbox,
  // though, and a click there is the click that closes Stash's lightbox.
  bar.addEventListener("click", (event) => event.stopPropagation());

  place(lightbox);
}

/**
 * Puts the bar in its own row, between the picture and the footer.
 *
 * A row rather than an overlay: the bar is about the pages, and a line drawn across
 * the bottom of them is a line drawn across the pages themselves. It sits against
 * the footer, so it goes before the footer in the lightbox's column.
 */
function place(lightbox: Element): void {
  if (!bar) return;

  const footer = lightbox.querySelector(".Lightbox-footer");
  if (footer) lightbox.insertBefore(bar, footer);
  else lightbox.appendChild(bar);
}

/** Draws the bar from a state: the ticks, the fill, the handle, the words */
function update(state: ProgressState): void {
  if (!bar || !track || !read || !thumb || !label || !nodes) return;

  const key = state.chapters.map((c) => c.at + ":" + c.title).join("|");
  if (!drawn || drawn.nodes !== key || drawn.total !== state.total) {
    drawNodes(state);
  }

  // A page that has not loaded yet measures nothing, and a bar a point wide is worse
  // than a bar a screen out of date: the width stands until there is a real one, and
  // an image finishing is what asks for the pass that takes it. See the load listener
  // in takeover.ts.
  //
  // And it stands while a pointer is down, whatever the pages measure: the bar's width
  // is half of what turns a pointer's x into a page, so a drag that narrowed it as it
  // went would move the pages out from under the hand that was choosing them. It takes
  // the new width when the drag is let go of, and the easing above carries it there.
  if (state.width > 0 && !pressed) {
    const wanted = Math.round(state.width) + "px";
    if (track.style.width !== wanted) track.style.width = wanted;
  }

  const settled = fractionOfPage(state.at, state.total);
  const fraction = pointer === null ? settled : pointer;
  const where = (fraction * 100).toFixed(3) + "%";

  if (read.style.width !== where) read.style.width = where;
  if (thumb.style.left !== where) thumb.style.left = where;

  // The bubble, when there is one. What it says was decided where it was set — see
  // setBubble — and a pass only draws it: writing it here is what let the reader's
  // own position land on top of a chapter's name.
  if (bubble) {
    if (labelPage?.textContent !== bubble.page) {
      if (labelPage) labelPage.textContent = bubble.page;
      labelWidth = label.offsetWidth;
    }
    if (labelChapter?.textContent !== bubble.chapter) {
      if (labelChapter) labelChapter.textContent = bubble.chapter;
      labelWidth = label.offsetWidth;
    }
  }

  // Where the bubble points is wherever it was put. With none up there is nothing to
  // point at, and moving the label to the handle is what made it slide across the bar
  // during the fade it was on its way out with.
  if (bubble) {
    const half = labelWidth / 2;
    const width = track.clientWidth || 0;
    const px =
      Math.max(half, Math.min(bubble.fraction * width, width - half)).toFixed(
        0
      ) + "px";
    if (label.style.left !== px) label.style.left = px;
  }

  // A bar with something new to say comes back: the reader who turned a page is
  // looking at the pages, and the bar is how they see where that was. Not on the
  // first pass, though — a lightbox that has just opened has said nothing yet, and a
  // bar that appears with it is a bar that has to be dismissed before it can be read.
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

  for (const node of progressNodes(state.chapters, state.total)) {
    const tick = document.createElement("div");
    tick.className = CLASS_NODE;
    tick.style.left = (node.fraction * 100).toFixed(3) + "%";
    // A tick's own press is a jump, not the start of a scrub.
    tick.addEventListener("mousedown", (event) => event.stopPropagation());
    tick.addEventListener("click", (event) => {
      event.stopPropagation();
      latest?.handlers.onSeek(node.at);
      wake();
    });
    // The name, in this plugin's own bubble rather than in the browser's: a title
    // attribute waits a second before it says anything, which is a second of not
    // knowing which of four ticks is the one under the pointer.
    // What to say about this tick, kept on it: the pointer finds the tick through the
    // DOM instead of through a listener of its own on every one of them — a tick
    // redrawn under a stationary pointer has no way to say that it has gone.
    tick.dataset.name = node.name;
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
  if (!pressed) takeBubbleDown();
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

  bar.classList.remove(CLASS_IDLE);
  if (idle !== null) window.clearTimeout(idle);

  idle = window.setTimeout(() => {
    idle = null;
    bar?.classList.add(CLASS_IDLE);
  }, PROGRESS_IDLE_MS);
}

function stopTimers(): void {
  if (idle !== null) window.clearTimeout(idle);
  if (pending !== null) window.clearTimeout(pending);
  idle = null;
  pending = null;
}

/** Whether a pointer is down on the bar */
let pressed = false;

/** Where a pointer is along the track, as a fraction of its width */
function fractionAt(clientX: number): number {
  if (!track) return 0;

  const rect = track.getBoundingClientRect();
  const width = rect.width || track.clientWidth || 1;
  return Math.min(Math.max((clientX - rect.left) / width, 0), 1);
}

function onPress(event: Event): void {
  const press = event as MouseEvent;
  if (press.button !== 0 || !track) return;

  press.preventDefault();
  press.stopPropagation();

  pressed = true;
  bar?.classList.add(CLASS_SCRUBBING);
  // Whatever the pointer was over, it is dragging now.
  bubble = null;
  scrubTo(fractionAt(press.clientX));

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onRelease);
}

function onMove(event: Event): void {
  if (!pressed) return;
  scrubTo(fractionAt((event as MouseEvent).clientX));
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
