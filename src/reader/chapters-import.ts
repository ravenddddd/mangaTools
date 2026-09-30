/**
 * Importing Stash's chapters into this plugin's own field, for a whole library.
 *
 * The Chapters tab does this one gallery at a time, where the reader already has
 * everything the translation needs. This is the same move for every marked gallery
 * at once, because a library that has been on Stash's own rows all along needs it
 * *everywhere*: it is the same job each time, and the tab would make it one visit
 * per gallery. What is here is the job; where it is asked for is the plugin's own
 * settings panel, and the panel reaches it through the namespace — the reader half
 * publishes it, and nothing in the tools half has to know what a chapter is.
 *
 * **Two steps, and the split is deliberate.** Planning is one read-only query over
 * the marked galleries: which of them have chapters, and which already have a list
 * of this plugin's own. Running fetches each gallery that is actually being
 * imported, because translating Stash's numbers needs that gallery's images in
 * *path* order and the plan's query carries no images — one fetch per gallery being
 * written, and none for the rest.
 *
 * Nothing here writes anything by itself: every gallery goes through the tools
 * half's `NS.importChapters`, which is the same call the tab's button makes, so
 * there is one write path and one place that reports a failed one.
 */
import { requirePluginApi, gqlDoc } from "../plugin-api";
import { NS } from "../tools/fields";
import {
  chaptersFromStash,
  parseChapters,
  serializeChapters,
} from "./chapters";
import { NR } from "./namespace";
import { fetchGallery } from "./stash-lightbox";

/**
 * Every marked gallery, with its own chapters and this plugin's field.
 *
 * Asked with the mark as a *variable* rather than spliced into the document, so a
 * test can tell this query from the tools half's own gallery map — which is the
 * same `findGalleries` with no variables at all. It also keeps the field name in
 * one place, which is where it belongs.
 */
export const CHAPTERS_QUERY_TEXT = [
  "query MangaReaderChapterImports($field: String!, $perPage: Int!) {",
  "  findGalleries(",
  "    gallery_filter: { custom_fields: { value: [$field], modifier: EQUALS } }",
  "    filter: { per_page: $perPage }",
  "  ) {",
  "    count",
  "    galleries {",
  "      id",
  "      custom_fields",
  "      chapters {",
  "        title",
  "        image_index",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

let chaptersQuery: unknown = null;

/** What that query answers, as far as this plugin cares */
interface ChaptersPayload {
  findGalleries?: {
    count?: number;
    galleries?: {
      id?: string | number;
      custom_fields?: unknown;
      chapters?: { title?: string; image_index?: number }[];
    }[];
  };
}

/** What a plan says: what would be written, and what stands in the way */
export interface ChapterImportPlan {
  /** Marked galleries with chapters of Stash's and no list of this plugin's own */
  toImport: string[];
  /**
   * The ones that already have a list of this plugin's own, which an import would
   * be writing over. Left out of a run unless it is asked for.
   */
  owned: string[];
  /** How many marked galleries were looked at, for the panel's wording */
  considered: number;
}

/** What a run did */
export interface ChapterImportRun {
  written: string[];
  /** A gallery whose write was refused: one failure does not stop the rest */
  failed: { id: string; error: unknown }[];
  /**
   * Galleries whose own rows translate to nothing — every chapter of Stash's
   * pointing past the end of the images. Nothing is written for them, and that is
   * the point: the translation of nothing is an *empty* list, and writing an empty
   * list is clearing a gallery's chapters, which is not what an import is for.
   */
  skippedEmpty: string[];
}

/**
 * Which galleries have chapters to bring over.
 *
 * A gallery with no rows of Stash's is not in either list: there is nothing to
 * write, so it is not a decision anybody has to make. A gallery whose rows all
 * point past the end of its images *looks* like one here — this query carries no
 * images — which is why the run checks again before it writes. See `skippedEmpty`.
 */
export async function planChapterImports(): Promise<ChapterImportPlan> {
  if (!chaptersQuery) {
    chaptersQuery = gqlDoc(
      CHAPTERS_QUERY_TEXT,
      "build the chapter import query"
    );
  }
  const query = chaptersQuery;
  if (!query) throw new Error("[mangaReader] no chapter import query document");

  const data = await requirePluginApi()
    .utils.StashService.getClient()
    // no-cache, for the reason every query in this half gives: these are Gallery
    // objects, and a copy landing in Apollo's normalised cache is what tells an
    // open edit form to reinitialise itself.
    .query({
      query,
      variables: { field: NS.MANGA_FIELD_NAME, perPage: -1 },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data as ChaptersPayload | undefined);

  const galleries = data?.findGalleries?.galleries || [];
  const plan: ChapterImportPlan = { toImport: [], owned: [], considered: 0 };

  for (const gallery of galleries) {
    const id = gallery?.id === undefined ? "" : String(gallery.id);
    if (!id) continue;

    plan.considered += 1;

    if (!(gallery.chapters || []).length) continue;

    const own = parseChapters(
      NS.pickField(gallery.custom_fields, NS.CHAPTER_FIELD_NAME) || null
    );
    (own ? plan.owned : plan.toImport).push(id);
  }

  return plan;
}

/**
 * Does the work, one gallery at a time.
 *
 * Sequential rather than all at once, deliberately: this is 20-odd fetches and
 * 20-odd writes against somebody's Stash, and the progress a reader can see is
 * worth more than the seconds a burst would save. One gallery failing is counted
 * and the rest carry on — a library half imported is a library half imported.
 *
 * A run that is interrupted needs no state of its own to resume: what it wrote is
 * now a list of this plugin's own, so those galleries are in `owned` on the next
 * plan and are skipped unless a re-import is asked for.
 */
export async function runChapterImports(
  plan: ChapterImportPlan,
  options: {
    reimport?: boolean;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<ChapterImportRun> {
  const ids = options.reimport
    ? [...plan.toImport, ...plan.owned]
    : [...plan.toImport];

  const run: ChapterImportRun = { written: [], failed: [], skippedEmpty: [] };
  let done = 0;

  for (const id of ids) {
    try {
      // Path order, which is what Stash's own chapter numbers count in. The tab
      // asks for the same order for the same reason.
      const answer = await fetchGallery(id, { sort: "path", direction: "ASC" });
      const chapters = chaptersFromStash(
        answer.stashChapters,
        answer.pages.map((page) => page.id)
      );

      if (chapters.length === 0) {
        run.skippedEmpty.push(id);
      } else {
        await writeChapters(id, serializeChapters(chapters));
        run.written.push(id);
      }
    } catch (error) {
      run.failed.push({ id, error });
    }

    done += 1;
    options.onProgress?.(done, ids.length);
  }

  return run;
}

/** The tools half's write, or a rejection naming the half that is missing */
function writeChapters(galleryId: string, json: string): Promise<void> {
  const write = NS.importChapters;
  if (typeof write !== "function") {
    return Promise.reject(
      new Error(
        "[mangaReader] the tools half is not running, so chapters cannot be written"
      )
    );
  }

  return write(galleryId, json);
}

NR.planChapterImports = planChapterImports;
NR.runChapterImports = runChapterImports;
