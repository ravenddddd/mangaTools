/**
 * Writing a gallery's chapters, and saying so.
 *
 * The editor and the importer both end here, which is the point: one place that knows
 * how a change is announced. It is not part of chapters.ts because that file is the
 * *format* — what a chapter list is, what it means, and the arithmetic of changing
 * one — while this is what happens to a library when that list changes.
 *
 * The write itself is the tools half's (`NS.writeChapters`). The format is this
 * half's, so this half hands over a *string*, and the half that owns the mutation
 * never has to know what a chapter is.
 */
import { NS } from "../tools/fields";
import { type MangaReaderChapter, serializeChapters } from "./chapters";
import { NR } from "./namespace";

/** Who wants to hear that a gallery's chapters have changed, and what to */
const listeners: ((
  galleryId: string,
  chapters: MangaReaderChapter[]
) => void)[] = [];

/**
 * Writes a gallery's chapters and announces them.
 *
 * Nothing is announced for a write that failed. What a caller does about a failure is
 * its own business — the tab says so in the console, the importer counts it and
 * carries on with the rest.
 */
export function writeChapters(
  galleryId: string,
  next: MangaReaderChapter[]
): Promise<void> {
  return write(galleryId, next).then(() => {
    announce(galleryId, next);
  });
}

/**
 * Hears about a gallery's chapters changing, and stops hearing when the returned
 * function is called. The same shape the tools half publishes for its store, and
 * for the same reason: the surfaces that draw chapters each keep their own copy,
 * and a copy nobody tells about a change is a surface that keeps showing the old
 * list.
 *
 * **The new list comes with the news**, rather than only the gallery it belongs to.
 * A listener that was told just *which* gallery changed would have to fetch the
 * value back to have anything to draw — and what was written is known exactly here,
 * so a fetch would be a round trip to learn something the writer already had.
 */
export function watchChapters(
  fn: (galleryId: string, chapters: MangaReaderChapter[]) => void
): () => void {
  listeners.push(fn);

  return () => {
    const at = listeners.indexOf(fn);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/** The tools half's write, or a rejection naming the half that is missing */
function write(
  galleryId: string,
  chapters: MangaReaderChapter[]
): Promise<void> {
  const write = NS.writeChapters;
  if (typeof write !== "function") {
    return Promise.reject(
      new Error(
        "[mangaReader] the tools half is not running, so chapters cannot be written"
      )
    );
  }

  return write(galleryId, serializeChapters(chapters));
}

/** Tells everyone, over a copy of the listeners: one may unsubscribe as it runs */
function announce(galleryId: string, chapters: MangaReaderChapter[]): void {
  for (const fn of [...listeners]) fn(galleryId, chapters);
}

NR.writeChapters = writeChapters;
NR.watchChapters = watchChapters;
