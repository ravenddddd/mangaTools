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
 * runs into those sets — see chaptersFromStash. Nothing is written until somebody
 * edits a gallery's chapters, so opening one changes nothing.
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
 * This is a translation, not a migration: nothing is written. A gallery stays on
 * this path until somebody edits its chapters, and a gallery nobody edits is never
 * written to at all.
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
    for (const id of chapter.images) {
      const index = position.get(id);
      if (index !== undefined && (at < 0 || index < at)) at = index;
    }

    if (at < 0) continue;
    placed.push({ title: chapter.title, images: chapter.images, at });
  }

  placed.sort((a, b) => a.at - b.at);
  return placed;
}

// Published for the smoke test, which reaches them through the window — see the
// note on MangaReaderNamespace in plugin-api.ts.
NR.CHAPTERS_VERSION = CHAPTERS_VERSION;
NR.parseChapters = parseChapters;
NR.chaptersFromStash = chaptersFromStash;
NR.placeChapters = placeChapters;
