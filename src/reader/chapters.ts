/**
 * Manga Reader — where a gallery's chapters are, in the order it is being read.
 *
 * Pure data plus pure functions: no PluginAPI, no DOM. Same arrangement as
 * spreads.ts, and for the same reason — the rules are what is worth pinning down,
 * and the code that draws them is DOM surgery inside Stash's own lightbox.
 *
 * **A CHAPTER IS A NAME AND A SET OF IMAGES, NOT A NUMBER.** Stash keeps a chapter
 * as `GalleryChapter { title, image_index }`, an integer that means "the Nth image"
 * — and the N counts in path order, because that is the order Stash's own lightbox
 * reads a gallery in. Everything else follows from that. Sort the same gallery by
 * title and the integer points somewhere else; add an image near the front and
 * every chapter after it is off by one. Stash's own code says as much by refusing
 * to hand its chapters to a lightbox that is not in path order.
 *
 * So this half keeps its own list, under `plugin.mangaTools.chapters`: each chapter
 * is a name and the ids of the images in it. Identity does not move when the order
 * does, so the same list is right in every sort, and survives images being added
 * and removed around it.
 *
 * **Which images are in a chapter is a fact about the images, so it is stored; what
 * order they are in is a fact about the view, so it is not.** The ids are written
 * in path order only to keep the file stable and diffable — the reader places each
 * chapter wherever its *earliest* image lands on screen, so the same list reads
 * correctly under a title sort, a path sort, or anything else.
 *
 * An image in no chapter is normal rather than a gap to be filled: a cover, a
 * divider, a page somebody has not decided about yet. Which is also why a chapter
 * does not "run to wherever the next one starts" any more — its pages are the ones
 * that say they are its, and a page that says nothing is in none of them.
 *
 * A gallery with no such field is read the old way, by expanding Stash's integer
 * runs into those sets — see chaptersFromStash. Reading writes nothing: a gallery
 * stays on Stash's numbers until its chapters are *imported* into the field, which
 * is a button in the Chapters tab for one gallery and a job on the settings page
 * for all of them (chapters-import.ts). So opening a gallery still changes nothing,
 * which is what makes this safe to have on a library that has chapters already.
 */
import { NR } from "./namespace";
import type { MangaReaderPage } from "./spreads";

/** A chapter as this plugin stores it: a name, and the images that are in it. */
export interface MangaReaderChapter {
  /** May be empty — Stash allows a chapter with no name, and so does this. */
  title: string;
  /**
   * The ids of this chapter's images, as strings.
   *
   * A set, not a sequence: the order they are written in is not read as meaning
   * anything. See the note at the top of the file.
   */
  images: string[];
}

/** A chapter placed in the order currently on screen. */
export interface MangaReaderPlacedChapter extends MangaReaderChapter {
  /** Index into the page list on screen of this chapter's *earliest* page */
  at: number;
  /**
   * …and of its *latest* one, which is the other end of the range the chapter menu
   * shows.
   *
   * Measured off the chapter's own images rather than off where the next chapter
   * begins. The two agree for every list this plugin has written and for every
   * Stash list it has imported — both are contiguous runs — but they part company
   * the moment a chapter in the middle is deleted, because a deletion leaves its
   * pages unowned: the run would go on claiming them, and its own images would not.
   */
  to: number;
}

/**
 * The only version of the stored shape this plugin understands.
 *
 * Written into everything it writes, and required of everything it reads: the
 * field is meant to sit in a library for years, and the day something needs to be
 * added to the shape (an explicit end, a spread hint) the reader has to be able
 * to tell the two apart rather than guess. A value with any other version is
 * treated as unreadable — see parseChapters — which means falling back to Stash's
 * chapters rather than acting on a shape this build does not know.
 */
export const CHAPTERS_VERSION = 1;

/** What a chapters field holds, once it has been read. */
interface StoredChapters {
  v?: unknown;
  chapters?: unknown;
}

/**
 * A gallery's stored chapters, or null when there are none this build can read.
 *
 * Null covers everything that is not a list this plugin wrote: an absent field, a
 * value somebody edited by hand, a version from a newer plugin. The caller's
 * answer to null is to fall back to Stash's own chapters, which is always
 * available and never wrong — while an empty *array* is a gallery whose chapters
 * were deliberately cleared, and is meant to draw nothing.
 *
 * Entries are kept as far as they can be read: a chapter with no name is a
 * chapter, and one with no images is kept too — it has a name and a place in the
 * list, and drawing it is the caller's decision rather than this function's. What
 * is dropped is what cannot be an id at all.
 */
export function parseChapters(raw: string | null): MangaReaderChapter[] | null {
  if (!raw) return null;

  let stored: StoredChapters | null = null;
  try {
    stored = JSON.parse(raw) as StoredChapters;
  } catch {
    // Edited by hand, or another plugin's value under our key. Either way it is
    // not a list of chapters, and Stash's own is the honest fallback.
    return null;
  }

  if (!stored || typeof stored !== "object") return null;
  if (stored.v !== CHAPTERS_VERSION) return null;
  if (!Array.isArray(stored.chapters)) return null;

  const chapters: MangaReaderChapter[] = [];
  for (const entry of stored.chapters) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { title?: unknown; images?: unknown };
    if (!Array.isArray(row.images)) continue;

    const images: string[] = [];
    for (const id of row.images) {
      if (typeof id === "string" || typeof id === "number") {
        images.push(String(id));
      }
    }

    chapters.push({
      title: typeof row.title === "string" ? row.title : "",
      images,
    });
  }

  return chapters;
}

/**
 * A chapter list as the field's own JSON string — the inverse of parseChapters.
 *
 * The keys are written in a literal order rather than a sorted one, so the same
 * chapters always come out as the same bytes: a value whose spelling shifted on
 * every write would be a write that looks like an edit.
 *
 * Nothing is validated and nothing is dropped. This is handed a list that is
 * already this plugin's own shape — deciding what belongs in one is
 * chaptersFromStash's business, upstream of here. parseChapters is the tolerant
 * half of the pair, and the two are tested against each other rather than each on
 * its own: see the round-trip and fixed-point laws in the reader suite.
 */
export function serializeChapters(chapters: MangaReaderChapter[]): string {
  return JSON.stringify({
    v: CHAPTERS_VERSION,
    chapters: chapters.map((chapter) => ({
      title: typeof chapter.title === "string" ? chapter.title : "",
      images: chapter.images.map((id) => String(id)),
    })),
  });
}

/**
 * Stash's own chapters, translated into this plugin's shape.
 *
 * `pathIds` is the gallery's image ids in path order — the order `image_index`
 * counts in, and the whole reason the caller has to fetch that list.
 *
 * Stash's shape gives each chapter a start and nothing else, so a chapter's images
 * are the run from its own start up to the next one's: the ranges Stash infers at
 * read time, written out once. Expanding them here rather than inferring them
 * later is what lets one rule — "the chapter that lists this image" — serve both
 * sources, and it is what the stored form of a translated gallery would look like.
 *
 * Entries whose start falls outside `pathIds` are dropped: that is a chapter whose
 * images are no longer in the gallery, and there is nothing to point at.
 *
 * This translates and writes nothing itself. Its two callers are the tab's own
 * rows, which are drawn from it, and the import, which stores what it returns —
 * and a gallery nobody imports is never written to at all.
 */
export function chaptersFromStash(
  rows: { title?: unknown; image_index?: unknown }[] | null | undefined,
  pathIds: string[]
): MangaReaderChapter[] {
  if (!Array.isArray(rows)) return [];

  // By start, because the runs are read off consecutive pairs — and Stash's own
  // order is not something to rely on for that.
  const starts: { title: string; index: number }[] = [];
  for (const row of rows) {
    const index = Number(row?.image_index);
    if (!Number.isInteger(index) || index < 1 || index > pathIds.length)
      continue;

    starts.push({
      title: typeof row?.title === "string" ? row.title : "",
      index,
    });
  }

  starts.sort((a, b) => a.index - b.index);

  return starts.map((start, i) => {
    const next = starts[i + 1];
    const end = next ? next.index - 1 : pathIds.length;

    return {
      title: start.title,
      images: pathIds.slice(start.index - 1, end),
    };
  });
}

/**
 * Where each chapter falls in the order on screen.
 *
 * A chapter is placed at its **earliest** page in this order — the page a jump to
 * it should land on, and the page the menu has to point at. Everything after it
 * belongs to it or does not, and that is a fact the chapter already holds.
 *
 * Its **latest** page comes back with it, so the menu can say what range a chapter
 * covers without a second walk over the pages. See `to` on the placed shape for why
 * that end is measured off the chapter's own images.
 *
 * Chapters with nothing on screen at all are dropped: an image that has left the
 * gallery, or one another entry point is showing instead. The caller can say so;
 * what it must not do is place them somewhere plausible, because a boundary drawn
 * at the wrong page is worse than one that is missing.
 *
 * Ties keep the input order — the stored order for this plugin's own list, and
 * Stash's order for a translated one — so two chapters that begin on the same page
 * are shown in the order they were written rather than in whatever order a sort
 * happens to leave them.
 */
export function placeChapters(
  chapters: MangaReaderChapter[],
  pages: MangaReaderPage[]
): MangaReaderPlacedChapter[] {
  const position = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    if (!position.has(pages[i].id)) position.set(pages[i].id, i);
  }

  const placed: MangaReaderPlacedChapter[] = [];
  for (const chapter of chapters) {
    let at = -1;
    let to = -1;
    for (const id of chapter.images) {
      const index = position.get(id);
      if (index === undefined) continue;
      if (at < 0 || index < at) at = index;
      if (index > to) to = index;
    }

    if (at < 0) continue;
    placed.push({ title: chapter.title, images: chapter.images, at, to });
  }

  placed.sort((a, b) => a.at - b.at);
  return placed;
}

/**
 * Where each page sits in an order, by id.
 *
 * A page the order does not name answers `MAX_SAFE_INTEGER`: last, and tying with
 * every other page like it. That is the one place these edits and `placeChapters`
 * disagree, and on purpose — placing drops a chapter with nothing on screen, which
 * is right for drawing, while an edit that dropped one would be an edit that threw
 * a chapter away because a page of it had gone missing.
 */
function positionsIn(order: string[]): (id: string) => number {
  const position = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    if (!position.has(order[i])) position.set(order[i], i);
  }

  return (id) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
}

/** Where a chapter begins in an order: the position of its earliest page */
function startOf(
  chapter: MangaReaderChapter,
  position: (id: string) => number
): number {
  let at = Number.MAX_SAFE_INTEGER;
  for (const id of chapter.images) {
    const index = position(id);
    if (index < at) at = index;
  }

  return at;
}

/**
 * The chapters again, each one's images in the order given and the chapters
 * themselves by where they begin.
 *
 * Written order is kept where the order cannot say: pages it does not name stay in
 * the order they were written, at the end of their chapter, and a chapter with
 * nothing in the order at all keeps its place among the ones that tie with it.
 * Nothing is dropped and nothing is merged — the only additions and removals are
 * the ones an edit asked for.
 */
function inOrder(
  chapters: MangaReaderChapter[],
  position: (id: string) => number
): MangaReaderChapter[] {
  return chapters
    .map((chapter, index) => ({
      chapter: {
        title: chapter.title,
        images: [...chapter.images].sort((a, b) => position(a) - position(b)),
      },
      at: startOf(chapter, position),
      index,
    }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((entry) => entry.chapter);
}

/**
 * A chapter beginning at this page, or null when there is nothing to make.
 *
 * The pages it takes are the run from here to the next chapter's start, out of
 * whatever held them — so one call covers both halves of what the reader means:
 * splitting a chapter in two, and claiming an unowned run (the pages before the
 * first chapter, or the ones a delete released).
 *
 * Null when the page is not one this gallery has, and when a chapter already
 * begins there: a chapter with no pages is not a chapter, it is a row that draws
 * nothing and cannot be clicked.
 */
export function addChapterAt(
  chapters: MangaReaderChapter[],
  order: string[],
  pageId: string,
  title: string
): MangaReaderChapter[] | null {
  const position = positionsIn(order);
  const at = position(pageId);
  if (at === Number.MAX_SAFE_INTEGER) return null;

  const starts = chapters.map((chapter) => startOf(chapter, position));
  if (starts.some((start) => start === at)) return null;

  // Where it ends: the next chapter's start, or the end of the gallery. A chapter
  // the order cannot place is not a boundary — it has no position to be one at.
  const next = starts.filter(
    (start) => start > at && start !== Number.MAX_SAFE_INTEGER
  );
  const end = next.length > 0 ? Math.min(...next) : order.length;

  const rest = chapters.map((chapter) => ({
    title: chapter.title,
    images: chapter.images.filter((id) => {
      const index = position(id);
      return index < at || index >= end;
    }),
  }));

  return inOrder([...rest, { title, images: order.slice(at, end) }], position);
}

/**
 * The same list with the chapter starting at this page renamed, or null when no
 * chapter begins there.
 *
 * Only the title is touched. Renaming is not a reason to re-cut anything, and an
 * edit that quietly re-flowed the pages while somebody was typing a name would be
 * the worst kind of surprise.
 */
export function renameChapterAt(
  chapters: MangaReaderChapter[],
  order: string[],
  startPageId: string,
  title: string
): MangaReaderChapter[] | null {
  const position = positionsIn(order);
  const at = position(startPageId);
  if (at === Number.MAX_SAFE_INTEGER) return null;

  const found = chapters.findIndex(
    (chapter) => startOf(chapter, position) === at
  );
  if (found < 0) return null;

  return chapters.map((chapter, index) =>
    index === found ? { title, images: chapter.images } : chapter
  );
}

/**
 * The chapter that begins at `fromPageId` beginning at `toPageId` instead, or null
 * when there is no such chapter or nowhere to move it to.
 *
 * The chapters are re-cut as runs between their starts, which is what the reader
 * is saying when they change this number: the pages the chapter gives up go to the
 * chapter before it — the earlier chapter runs up to this one's start, the way a
 * chapter's pages always have — and if the new start lands before another
 * chapter's, the two change places rather than fighting over the same pages.
 *
 * A page nobody owns is the one thing this cannot produce: that is what `remove`
 * is for. Where the list already had one (a chapter that was deleted), the run it
 * falls in comes back to the chapter before it — the starts say where the chapters
 * are, and re-cutting is the price of moving one.
 */
export function moveChapterStart(
  chapters: MangaReaderChapter[],
  order: string[],
  fromPageId: string,
  toPageId: string
): MangaReaderChapter[] | null {
  const position = positionsIn(order);
  const from = position(fromPageId);
  const to = position(toPageId);
  if (from === Number.MAX_SAFE_INTEGER || to === Number.MAX_SAFE_INTEGER)
    return null;
  if (from === to) return null;

  const moved = chapters.findIndex(
    (chapter) => startOf(chapter, position) === from
  );
  if (moved < 0) return null;
  // Somewhere another chapter already begins: the two would end up sharing their
  // first page, and one of them would hold nothing.
  const taken = chapters.some(
    (chapter, index) => index !== moved && startOf(chapter, position) === to
  );
  if (taken) return null;

  // Everything the order can place, re-cut; then whatever it cannot, kept as it
  // was and kept last.
  const placed = chapters
    .map((chapter, index) => ({
      chapter,
      index,
      at: index === moved ? to : startOf(chapter, position),
    }))
    .filter((entry) => entry.at !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at));

  const runs = placed.map((entry, i) => ({
    title: entry.chapter.title,
    images: order.slice(
      entry.at,
      i + 1 < placed.length ? placed[i + 1].at : order.length
    ),
  }));

  const unplaced = chapters.filter(
    (chapter) => startOf(chapter, position) === Number.MAX_SAFE_INTEGER
  );

  return [...runs, ...unplaced];
}

/**
 * The same list without the chapter holding this page, or null when no chapter
 * holds it.
 *
 * Its pages are in no chapter afterwards — a state this format has and Stash's
 * numbers cannot: an image nobody claimed, like the cover before a first chapter.
 * They are not given to the chapter before, because deleting a chapter and moving
 * a boundary are different things, and only one of them is about where a boundary
 * goes. That makes this the one edit that can leave pages owned by nobody.
 */
export function removeChapterAt(
  chapters: MangaReaderChapter[],
  order: string[],
  pageId: string
): MangaReaderChapter[] | null {
  const position = positionsIn(order);
  const at = position(pageId);
  if (at === Number.MAX_SAFE_INTEGER) return null;

  const found = chapters.findIndex((chapter) =>
    chapter.images.some((id) => position(id) === at)
  );
  if (found < 0) return null;

  return chapters.filter((_, index) => index !== found);
}

/**
 * The chapter an image is in, or null when it is in none.
 *
 * Null is a real answer rather than a failure: a cover, a divider, a page nobody has
 * put in a chapter. The header says so, which is also how a page that still needs a
 * chapter becomes visible — and it is the answer Stash's own header cannot give, since
 * its chapters are ranges and a page between two of them belongs to the one before.
 *
 * Which chapter that is comes from the chapter's own list of images — not from where
 * the image sits between its neighbours.
 */
/**
 * The characters a pasted list decorates a line with.
 *
 * Measured rather than guessed: across the 244 galleries of the user's library whose
 * description lists what the volume contains, the entries begin with a middle dot
 * (U+30FB), with a filled square (U+25A0), or with nothing at all. The rest of the set
 * is what a hand-made list tends to use.
 *
 * **Nothing beyond this is touched.** The tail of a line is content — a product code
 * like `(RJ242738)`, a length like `(10P)`, a bracketed remark, a count of instalments
 * — and a parser that decided those were decoration would be editing the title.
 */
const BULLETS = "・･•‣∙-–—*+■□●○◎※>";

/** Pairs a whole line may be wrapped in, dropped as a pair and only as a pair */
const WRAPPERS: Array<[string, string]> = [
  ["『", "』"],
  ["「", "」"],
  ["【", "】"],
  ["〈", "〉"],
  ["《", "》"],
  ["〔", "〕"],
  ["＜", "＞"],
  ["<", ">"],
  ["[", "]"],
  ["（", "）"],
  ["(", ")"],
  ["｛", "｝"],
  ["{", "}"],
];

/** A line with one layer of wrapping taken off, or the line itself */
function unwrapped(line: string): string {
  for (let i = 0; i < WRAPPERS.length; i++) {
    const open = WRAPPERS[i][0];
    const close = WRAPPERS[i][1];
    if (
      line.length >= open.length + close.length &&
      line.startsWith(open) &&
      line.endsWith(close)
    ) {
      return line.slice(open.length, line.length - close.length).trim();
    }
  }
  return line;
}

/**
 * The titles in a pasted list, one per line, with the decoration taken off.
 *
 * **Decoration only.** A leading bullet goes, and the brackets a line is wholly
 * wrapped in go, over and over until neither is there — and that is the whole of it.
 * Nothing here decides what a title is, drops a line for looking odd, or reads
 * anything out of what follows the title; the reader's own list is what makes this
 * workable, and the block it comes from is not something this plugin can parse (see
 * `doc/mock/bulk-chapters.html` for the measurements).
 *
 * Blank lines are dropped, which is what makes a pasted block with air in it behave
 * like one without. A line left empty by the unwrapping — a pair of brackets with
 * nothing between them — is dropped too: there is no such title.
 */
export function parseChapterList(text: string): string[] {
  const out: string[] = [];

  String(text ?? "")
    .split(/\r?\n/)
    .forEach((raw) => {
      let line = raw.trim();

      while (line.length > 0 && BULLETS.indexOf(line[0]) !== -1) {
        line = line.slice(1).trim();
      }

      let was = "";
      while (line !== was) {
        was = line;
        line = unwrapped(line);
      }

      if (line) out.push(line);
    });

  return out;
}

/**
 * Several chapters at once — or none at all.
 *
 * Cut one at a time through addChapterAt and thrown away whole if any of them cannot
 * be: pages that are not this gallery's, a position two of them want, a position an
 * existing chapter already begins at. Half a list of chapters is worse than none,
 * because the reader cannot tell which half arrived.
 *
 * The order the entries are given in does not matter: a chapter's pages are the run
 * from its start to the *next* boundary, so the result is decided by the set of
 * positions rather than by the order they were cut in.
 */
export function addChaptersAt(
  chapters: MangaReaderChapter[],
  order: string[],
  entries: Array<{ pageId: string; title: string }>
): MangaReaderChapter[] | null {
  let next = chapters;

  for (let i = 0; i < entries.length; i++) {
    const added = addChapterAt(
      next,
      order,
      entries[i].pageId,
      entries[i].title
    );
    if (!added) return null;
    next = added;
  }

  return next;
}

export function chapterAt(
  placed: MangaReaderPlacedChapter[],
  pageId: string
): MangaReaderPlacedChapter | null {
  for (const chapter of placed) {
    if (chapter.images.includes(pageId)) return chapter;
  }

  return null;
}

// Published for the smoke test, which reaches them through the window — see the
// note on MangaReaderNamespace in plugin-api.ts.
NR.CHAPTERS_VERSION = CHAPTERS_VERSION;
NR.chapterAt = chapterAt;
NR.parseChapters = parseChapters;
NR.serializeChapters = serializeChapters;
NR.chaptersFromStash = chaptersFromStash;
NR.placeChapters = placeChapters;
NR.addChapterAt = addChapterAt;
NR.addChaptersAt = addChaptersAt;
NR.parseChapterList = parseChapterList;
NR.renameChapterAt = renameChapterAt;
NR.moveChapterStart = moveChapterStart;
NR.removeChapterAt = removeChapterAt;
