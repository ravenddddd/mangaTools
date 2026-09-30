/**
 * Writing a gallery's chapters, saying so, and taking the last one back.
 *
 * The editor and the importer both end here, which is the point: one place that
 * knows how a change is announced, and one place that remembers what the change
 * replaced. It is not part of chapters.ts because that file is the *format* — what
 * a chapter list is, what it means, and the arithmetic of changing one — while this
 * is what happens to a library when that list changes.
 *
 * The write itself is the tools half's (`NS.writeChapters`). The format is this
 * half's, so this half hands over a *string*, and the half that owns the mutation
 * never has to know what a chapter is.
 */
import { NS } from "../tools/fields";
import { type MangaReaderChapter, serializeChapters } from "./chapters";
import { NR } from "./namespace";

/** What each gallery's chapters were before the last change to them */
const undoable = new Map<string, MangaReaderChapter[]>();

/** Who wants to hear that a gallery's chapters have changed */
const listeners: ((galleryId: string) => void)[] = [];

/**
 * Writes a gallery's chapters, announcing them, and remembering what they replaced.
 *
 * `previous` is what an undo would put back, or null for a write that should have
 * no undo at all. The import is why that is a choice: it writes twenty-odd galleries
 * in a row, and one undo that took back whichever of them happened to be written
 * last would be a worse answer than none.
 *
 * Neither the undo nor the announcement happens for a write that failed. What the
 * caller does about a failure is its own business — the tab says so in the console,
 * the importer counts it and carries on with the rest.
 */
export function writeChapters(
  galleryId: string,
  next: MangaReaderChapter[],
  previous: MangaReaderChapter[] | null
): Promise<void> {
  return write(galleryId, next).then(() => {
    if (previous) undoable.set(galleryId, previous);
    announce(galleryId);
  });
}

/** Whether there is a change to this gallery's chapters to take back */
export function canUndoChapters(galleryId: string): boolean {
  return undoable.has(galleryId);
}

/**
 * Puts back what the last change to this gallery replaced.
 *
 * One level, and it does not arm another: an undo that could itself be undone is a
 * redo, and a redo is a state machine nobody asked for. The slot is cleared before
 * the write rather than after, so a change that could not be taken back is not one
 * this goes on offering.
 *
 * Doing nothing is not an error — a gallery with nothing to undo is a button that
 * should not have been offered, not a failure — so there is no write and nothing to
 * report.
 */
export function undoChapters(galleryId: string): Promise<void> {
  const previous = undoable.get(galleryId);
  if (!previous) return Promise.resolve();

  undoable.delete(galleryId);
  return write(galleryId, previous).then(() => {
    announce(galleryId);
  });
}

/**
 * Hears about a gallery's chapters changing, and stops hearing when the returned
 * function is called. The same shape the tools half publishes for its store, and
 * for the same reason: the surfaces that draw chapters each keep their own copy,
 * and a copy nobody tells about a change is a surface that keeps showing the old
 * list.
 */
export function watchChapters(fn: (galleryId: string) => void): () => void {
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

/** Tells everyone, over a copy of the list: a listener may unsubscribe as it runs */
function announce(galleryId: string): void {
  for (const fn of [...listeners]) fn(galleryId);
}

NR.writeChapters = writeChapters;
NR.watchChapters = watchChapters;
NR.canUndoChapters = canUndoChapters;
NR.undoChapters = undoChapters;
