/**
 * Manga Reader — where a gallery's chapters are, in the order it is being read.
 *
 * Pure data plus pure functions: no PluginAPI, no DOM. Same arrangement as
 * spreads.ts, and for the same reason — the rules are what is worth pinning down,
 * and the code that draws them is DOM surgery inside Stash's own lightbox.
 *
 * **A CHAPTER IS A NAME AND AN IMAGE, NOT A NUMBER.** Stash keeps a chapter as
 * `GalleryChapter { title, image_index }`, an integer that means "the Nth image"
 * — and the N counts in path order, because that is the order Stash's own lightbox
 * reads a gallery in. Everything else follows from that. Sort the same gallery by
 * title and the integer points somewhere else; add an image near the front and
 * every chapter after it is off by one. Stash's own code says as much by refusing
 * to hand its chapters to a lightbox that is not in path order.
 *
 * So this half keeps its own list, under `plugin.mangaTools.chapters`, storing the
 * *id* of the image each chapter starts at. Identity does not move when the order
 * does, so the same list is correct in every sort, and survives images being added
 * and removed around it. Its ranges stay implicit — a chapter runs to wherever the
 * next one starts — and that is deliberate: with the start anchored to an image
 * rather than a position, a new page dropped into the middle of a chapter joins
 * that chapter instead of what used to be the next one.
 *
 * A gallery with no such field is read the old way, by translating Stash's
 * integer against the path order — see chaptersFromStash. Nothing is written
 * until somebody edits a gallery's chapters, so opening one changes nothing.
 */
import { NR } from "./namespace";
import type { MangaReaderPage } from "./spreads";

/** A chapter as this plugin stores it: a name, and the image it starts at. */
export interface MangaReaderChapter {
  /** May be empty — Stash allows a chapter with no name, and so does this. */
  title: string;
  /** The id of the image the chapter starts at, as a string. */
  start: string;
}

/** A chapter placed in the order currently on screen. */
export interface MangaReaderPlacedChapter extends MangaReaderChapter {
  /** Index into the page list on screen of this chapter's first page */
  at: number;
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
 * Entries without a usable `start` are dropped rather than defaulted: a chapter
 * that does not say where it begins is not a chapter, and inventing a position for
 * it would put a boundary somewhere nothing meant.
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
    const row = entry as { title?: unknown; start?: unknown };
    const start = row.start;
    if (typeof start !== "string" && typeof start !== "number") continue;

    chapters.push({
      title: typeof row.title === "string" ? row.title : "",
      start: String(start),
    });
  }

  return chapters;
}

/**
 * Stash's own chapters, translated into this plugin's shape.
 *
 * `pathIds` is the gallery's image ids in path order — the order `image_index`
 * counts in, and the whole reason the caller has to fetch that list. Entries
 * whose index falls outside it are dropped: that is a chapter whose images are no
 * longer in the gallery, and there is no image to point at.
 *
 * This is a translation, not a migration: nothing is written. A gallery stays on
 * this path until somebody edits its chapters, and a gallery nobody edits is
 * never written to at all.
 */
export function chaptersFromStash(
  rows: { title?: unknown; image_index?: unknown }[] | null | undefined,
  pathIds: string[]
): MangaReaderChapter[] {
  const chapters: MangaReaderChapter[] = [];
  if (!Array.isArray(rows)) return chapters;

  for (const row of rows) {
    const index = Number(row?.image_index);
    if (!Number.isInteger(index) || index < 1 || index > pathIds.length)
      continue;

    chapters.push({
      title: typeof row?.title === "string" ? row.title : "",
      start: String(pathIds[index - 1]),
    });
  }

  return chapters;
}

/**
 * Where each chapter falls in the order on screen.
 *
 * The list on screen is the authority on order, and this asks it where each
 * chapter's first page is. Chapters whose image is not on screen at all are
 * dropped — a chapter pointing at an image that has left the gallery, or at one
 * another entry point is not showing — and the caller can say so; what it must
 * not do is place them somewhere plausible, because a boundary drawn at the wrong
 * page is worse than one that is missing.
 *
 * Ties keep the input order, which is Stash's own order for a translated list and
 * the stored order for ours — so two chapters that start at the same image are
 * shown in the order they were written rather than in whatever order a sort
 * happens to leave them.
 */
export function placeChapters(
  chapters: MangaReaderChapter[],
  pages: MangaReaderPage[]
): MangaReaderPlacedChapter[] {
  const at = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    if (!at.has(pages[i].id)) at.set(pages[i].id, i);
  }

  const placed: MangaReaderPlacedChapter[] = [];
  for (const chapter of chapters) {
    const index = at.get(chapter.start);
    if (index === undefined) continue;
    placed.push({ title: chapter.title, start: chapter.start, at: index });
  }

  placed.sort((a, b) => a.at - b.at);
  return placed;
}

/**
 * The chapter the page at `index` is in, or null when it is before the first one.
 *
 * "In" means from its own start up to the next chapter's, which is the implicit
 * range the whole design rests on.
 */
export function chapterAt(
  placed: MangaReaderPlacedChapter[],
  index: number
): MangaReaderPlacedChapter | null {
  let found: MangaReaderPlacedChapter | null = null;
  for (const chapter of placed) {
    if (chapter.at > index) break;
    found = chapter;
  }

  return found;
}

// Published for the smoke test, which reaches them through the window — see the
// note on MangaReaderNamespace in plugin-api.ts.
NR.CHAPTERS_VERSION = CHAPTERS_VERSION;
NR.parseChapters = parseChapters;
NR.chaptersFromStash = chaptersFromStash;
NR.placeChapters = placeChapters;
NR.chapterAt = chapterAt;
