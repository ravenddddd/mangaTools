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
export const PROGRESS_IDLE_MS = 2500;

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
): { title: string; at: number; fraction: number }[] {
  const nodes: { title: string; at: number; fraction: number }[] = [];
  const seen = new Set<number>();

  for (const chapter of chapters) {
    if (chapter.at < 0 || chapter.at >= total || seen.has(chapter.at)) continue;
    seen.add(chapter.at);
    nodes.push({
      title: chapter.title,
      at: chapter.at,
      fraction: fractionOfPage(chapter.at, total),
    });
  }

  return nodes;
}

/** The bar's own classes, kept together: the stylesheet names the same strings */
const CLASS_BAR = "manga-reader-progress";
const CLASS_TRACK = "manga-reader-progress-track";
const CLASS_READ = "manga-reader-progress-read";
const CLASS_THUMB = "manga-reader-progress-thumb";
const CLASS_NODES = "manga-reader-progress-nodes";
const CLASS_NODE = "manga-reader-progress-node";
const CLASS_LABEL = "manga-reader-progress-label";
/** While a pointer is down: the handle is the pointer, and nothing eases */
const CLASS_SCRUBBING = "is-scrubbing";
/** While it is asleep: out of sight, and out of the way of clicks */
const CLASS_IDLE = "is-idle";
/** The state the bar was last drawn from, which its gestures read */
let latest: ProgressState | null = null;

/** The elements the bar is made of, and the state its gestures read */
let bar: HTMLElement | null = null;
let track: HTMLElement | null = null;
let read: HTMLElement | null = null;
let thumb: HTMLElement | null = null;
let label: HTMLElement | null = null;
let nodes: HTMLElement | null = null;

/** What the last pass drew, so a pass that changes nothing writes nothing */
let drawn: { nodes: string; at: number; total: number } | null = null;
/** How wide the label came out, measured when its words change rather than per move */
let labelWidth = 0;

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
/** The lightbox whose pointer movements are being watched */
let watching: Element | null = null;

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

  const display = lightbox.querySelector(".Lightbox-display");
  if (!display) return bar;

  // A gallery of one page has no progress to show, and a bar across the bottom of a
  // single picture is furniture with nothing to say — Stash draws its own counter
  // only for a lightbox of more than one image, for the same reason. Nothing is
  // built: an element hidden by a rule is still an element this plugin put on the
  // page, and this one has nothing to put there.
  if (state.total <= 1) return null;

  if (!bar) build(display);

  if (!bar || !track || !read || !thumb || !label || !nodes) return bar;

  inset(lightbox);
  watch(lightbox);
  update(state);

  return bar;
}

/** Takes the bar away, with the lightbox it belonged to */
export function removeProgress(lightbox: Element): void {
  const node = lightbox.querySelector("." + CLASS_BAR);
  if (node) node.remove();

  if (node !== bar) return;

  stopTimers();
  if (watching) watching.removeEventListener("mousemove", onWake);

  bar = null;
  track = null;
  read = null;
  thumb = null;
  label = null;
  nodes = null;
  drawn = null;
  latest = null;
  watching = null;
  pointer = null;
  pressed = false;
  labelWidth = 0;
}

/** The elements the bar is made of, once per lightbox */
function build(display: Element): void {
  bar = document.createElement("div");
  bar.className = CLASS_BAR;

  label = document.createElement("div");
  label.className = CLASS_LABEL;

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
  bar.appendChild(label);
  bar.appendChild(track);

  track.addEventListener("mousedown", onPress);
  // The bar is a sibling of the pages rather than a child of them, so a press here
  // never reaches the reader's own press. A *click* would still reach the lightbox,
  // though, and a click there is the click that closes Stash's lightbox.
  bar.addEventListener("click", (event) => event.stopPropagation());

  display.appendChild(bar);
}

/** Draws the bar from a state: the ticks, the fill, the handle, the words */
function update(state: ProgressState): void {
  if (!bar || !track || !read || !thumb || !label || !nodes) return;

  const key = state.chapters.map((c) => c.at + ":" + c.title).join("|");
  if (!drawn || drawn.nodes !== key || drawn.total !== state.total) {
    drawNodes(state);
  }

  const settled = fractionOfPage(state.at, state.total);
  const fraction = pointer === null ? settled : pointer;
  const where = (fraction * 100).toFixed(3) + "%";

  if (read.style.width !== where) read.style.width = where;
  if (thumb.style.left !== where) thumb.style.left = where;

  const page = pointer === null ? state.at : target;
  const name = state.chapterNameAt(page);
  const words = page + 1 + " / " + state.total + (name ? " · " + name : "");
  if (label.textContent !== words) {
    label.textContent = words;
    labelWidth = label.offsetWidth;
  }

  // Kept inside the bar rather than centred on a point that may be at either end.
  const half = labelWidth / 2;
  const width = track.clientWidth || 0;
  const left = Math.max(half, Math.min(fraction * width, width - half));
  const px = left.toFixed(0) + "px";
  if (label.style.left !== px) label.style.left = px;

  // A bar with something new to say comes back: the reader who turned a page is
  // looking at the pages, and the bar is how they see where that was.
  const moved = !drawn || drawn.at !== state.at || drawn.total !== state.total;
  drawn = { nodes: key, at: state.at, total: state.total };
  if (moved) wake();
}

/**
 * Stops the bar short of Stash's own page-turn buttons.
 *
 * Measured from the button rather than written down: the chevrons are Stash's markup
 * and its stylesheet decides how wide they are, and a number here would be a copy of
 * that decision, drifting the moment either changes. A lightbox with no chevrons —
 * which is a lightbox of one image, where this bar is not drawn at all — leaves the
 * bar the full width, which is what no inset means.
 */
function inset(lightbox: Element): void {
  if (!bar) return;

  const button = lightbox.querySelector(
    ".Lightbox-navbutton"
  ) as HTMLElement | null;
  const width = button?.offsetWidth || 0;
  const value = width + "px";

  if (bar.style.left !== value) bar.style.left = value;
  if (bar.style.right !== value) bar.style.right = value;
}

/** One tick per chapter, where its first page sits */
function drawNodes(state: ProgressState): void {
  if (!nodes) return;

  nodes.textContent = "";

  for (const node of progressNodes(state.chapters, state.total)) {
    const tick = document.createElement("div");
    tick.className = CLASS_NODE;
    tick.style.left = (node.fraction * 100).toFixed(3) + "%";
    if (node.title) tick.title = node.title;
    // A tick's own press is a jump, not the start of a scrub.
    tick.addEventListener("mousedown", (event) => event.stopPropagation());
    tick.addEventListener("click", (event) => {
      event.stopPropagation();
      latest?.handlers.onSeek(node.at);
      wake();
    });
    nodes.appendChild(tick);
  }
}

/**
 * Watches the lightbox for movement, once per lightbox.
 *
 * On the lightbox rather than on the bar, because the bar is asleep and taking no
 * pointers exactly when it matters most: a pointer that never touches the bar is the
 * one that has to bring it back.
 */
function watch(lightbox: Element): void {
  if (watching === lightbox) return;

  if (watching) watching.removeEventListener("mousemove", onWake);
  lightbox.addEventListener("mousemove", onWake);
  watching = lightbox;
}

function onWake(): void {
  wake();
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
  redraw();
}

/** Draws the bar again from the state it was last given */
function redraw(): void {
  if (latest) update(latest);
}
