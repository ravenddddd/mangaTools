/**
 * The gallery's Images tab, drawn by its physical files.
 *
 * Stash's image list is `SELECT DISTINCT images.id`: content that appears four
 * times in one archive is one card, at one position. With "physical pages" on,
 * this module replaces the list the two views receive (the grid and the wall) with
 * the file occurrences the gallery actually holds — and patches the two pagination
 * components so the page count and the "N–M of T" line describe what is on screen.
 *
 * **Why `ImageList` and not `ImageCardGrid`.** `ImageList` is the one component
 * both display modes are rendered from, and it is the one that builds the
 * lightbox's own image list — so replacing its `images` fixes the grid, the wall
 * *and* the list Stash hands to the lightbox in one place. `ImageCardGrid` would
 * have covered only the grid.
 *
 * **The page numbers stay Stash's.** `FilteredImageList` fetches image pages and
 * `useEnsureValidPage` clamps the page number to the image page count. Adding
 * physical pages beyond that count would make them unreachable, so the files are
 * divided into the *same* number of pages (`Q = max(page size, ceil(files / pages))`)
 * and the same page number is rendered from the file list. The only visible cost is
 * that a page can hold slightly more cards than the page-size selector says.
 *
 * **Rendering is still Stash's.** The occurrence entries are clones of the image
 * objects Stash would have rendered, with a synthetic id (unique React key) and
 * the occurrence's own file in `visual_files`. Everything the card draws — tags,
 * performers, the date, the popovers — comes from the clone. The real image id is
 * put back for the card's link by the `ImageCard` patch.
 *
 * Down, never sideways: this reads the shared `gallery-files` module and Stash's
 * libraries, and nothing from the reader half.
 */
import {
  type GalleryFileEntry,
  fetchGalleryFiles,
  fetchGalleryScope,
} from "../gallery-files";
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import { currentGalleryId } from "./core";
import { noteFired, registerPatch } from "./patches";

const PluginApi = requirePluginApi();
const React = PluginApi.React;

/** What the list needs from a gallery's files, once they have been read. */
export interface GalleryGrid {
  files: GalleryFileEntry[];
  /** Every file in the gallery's scope, videos included — the revalidation count */
  total: number;
}

const cache = new Map<string, GalleryGrid>();
const inFlight = new Map<string, Promise<GalleryGrid>>();

/**
 * Reads a gallery's physical list, once per gallery per page load.
 *
 * Deliberately not revalidated: the list is the grid's, and the reader is the one
 * with a cache worth keeping correct — a change made elsewhere shows up when the
 * page is reloaded, which is the same thing Stash's own deduped list would do.
 */
function load(galleryId: string): Promise<GalleryGrid> {
  const cached = cache.get(galleryId);
  if (cached) return Promise.resolve(cached);

  const waiting = inFlight.get(galleryId);
  if (waiting) return waiting;

  const promise = fetchGalleryScope(galleryId)
    .then((scope) =>
      scope
        ? fetchGalleryFiles(galleryId, scope, true)
        : { files: [], total: 0 }
    )
    .then((list) => {
      const grid: GalleryGrid = { files: list.files, total: list.total };
      cache.set(galleryId, grid);
      inFlight.delete(galleryId);
      return grid;
    })
    .catch((error: unknown) => {
      inFlight.delete(galleryId);
      console.error(
        "[mangaTools] could not read this gallery's files, so its grid keeps " +
          "the deduplicated list:",
        error
      );
      return { files: [], total: 0 };
    });

  inFlight.set(galleryId, promise);
  return promise;
}

/**
 * Stash's page count, with the files laid into it at the chosen page size.
 *
 * `imagePages` is **Stash's own count**, taken from the `pageCount` prop — not
 * derived from a total. Stash v0.31.1 does not pass a `totalCount` to
 * `ImageList` at all, and deriving the count from `undefined` made it 1, which
 * put every file on one page: the page-size selector did nothing.
 *
 * The page size is the reader's, exactly: pages 1 … P−1 hold `userPerPage` files
 * and the **last page takes the remainder**. The page count stays Stash's (P),
 * because a higher number would be clamped away by `useEnsureValidPage`; the
 * price is that a gallery with many duplicates can have a long last page.
 *
 * Published for the smoke test: the arithmetic is where a page that cannot be
 * reached would come from, and it is the cheapest part of this module to pin.
 */
export function physicalPagePlan(
  imagePages: number,
  userPerPage: number,
  _fileCount: number
): { pages: number; perPage: number } {
  return {
    pages: Math.max(1, Math.floor(imagePages) || 1),
    perPage: Math.max(1, userPerPage),
  };
}

/** The props this module reads off `ImageList`, which Stash types only as `any`. */
interface ImageListProps {
  filter?: {
    sortBy?: string;
    sortDirection?: string;
    currentPage?: number;
    itemsPerPage?: number;
    displayMode?: string;
    /** The search box, and any criterion the reader added. */
    searchTerm?: string;
    criteria?: unknown[];
  };
  images?: Occurrence[];
  totalCount?: number;
  pageCount?: number;
  selectedIds?: Set<string>;
  onSelectChange?: (id: string, selected: boolean, shiftKey: boolean) => void;
}

/** One card, in the shape Stash's list and cards read. */
interface Occurrence {
  id: string;
  paths: { thumbnail: string; preview: string; image: string };
  visual_files: Array<{
    __typename: string;
    id: string;
    path: string;
    width: number;
    height: number;
  }>;
  [key: string]: unknown;
}

function withFragment(url: string, fileId: string): string {
  // Unique for Stash's React keys, never sent to the server. See fetchPhysicalGallery.
  return url ? url + "#" + fileId : url;
}

/** A file occurrence as a card — the image's own object, with the file swapped in. */
function occurrenceOf(file: GalleryFileEntry): Occurrence {
  const image = (file.image || {}) as Record<string, unknown>;
  const paths = (image.paths || {}) as {
    thumbnail?: string;
    preview?: string;
    image?: string;
  };

  return {
    ...image,
    // Unique across occurrences of the same image, which is what React keys and
    // the grid's selection bookkeeping need. The ImageCard patch turns it back
    // into the real image id for the card's link.
    id: file.imageId + "::" + file.fileId,
    title: image.title ?? file.title,
    paths: {
      thumbnail: paths.thumbnail || file.thumbnail,
      preview: paths.preview || file.preview,
      image: withFragment(paths.image || file.imageUrl, file.fileId),
    },
    visual_files: [
      {
        __typename: "ImageFile",
        id: file.fileId,
        path: file.path,
        width: file.width,
        height: file.height,
      },
    ],
    tags: image.tags || [],
    performers: image.performers || [],
    galleries: image.galleries || [],
    studio: image.studio || null,
    organized: !!image.organized,
    o_counter: image.o_counter || 0,
  };
}

/** One physical page, as the list needs it. */
export interface PhysicalPage {
  images: Occurrence[];
  selectedIds: Set<string>;
  onSelectChange?: (id: string, selected: boolean, shiftKey: boolean) => void;
  /** Every file in the gallery — the pagination's total */
  total: number;
  /** What one page of this gallery holds */
  perPage: number;
  /** How many pages the files come to (never more than Stash's) */
  pages: number;
  /** The page actually rendered, clamped to `pages` */
  page: number;
}

/**
 * The physical list for this render, or null to leave Stash's list alone.
 *
 * Pure on purpose — the gallery comes in as a grid rather than out of the cache —
 * so the smoke test can drive it with a fixture, and so the only thing the patch
 * adds is "is the setting on, and which gallery is this".
 *
 * Returns the page's own data rather than a merged props object. The patch memoizes
 * this, and a merged object would carry every other prop — including ones whose
 * identity changes every render — back into `ImageList`.
 */
export function expandPhysicalPage(
  props: ImageListProps,
  grid: GalleryGrid
): PhysicalPage | null {
  const filter = props.filter;
  if (filter?.sortBy !== "path") return null;
  if (String(filter?.sortDirection || "").toUpperCase() !== "ASC") return null;

  // **A filtered list keeps Stash's own results.** The expansion starts from the
  // gallery's whole file list and would ignore the search box and every criterion
  // — showing a page of images the query did not return. What a *filtered*
  // occurrence list would mean (only the occurrences of the matched images?) is a
  // question of its own; until it is answered, the deduplicated results are the
  // honest ones.
  if (filter?.searchTerm) return null;
  if ((filter?.criteria?.length ?? 0) > 0) return null;

  if (!grid || grid.files.length === 0) return null;

  const userPerPage = Math.max(1, Number(filter?.itemsPerPage) || 100);

  // Stash's page count as it passed it to the list. `totalCount` is only a
  // fallback: this Stash gives `ImageList` a `pageCount` and no total.
  const stashedPages = Number(props.pageCount) || 0;
  const imagePages =
    stashedPages > 0
      ? stashedPages
      : Math.max(1, Math.ceil((Number(props.totalCount) || 0) / userPerPage));

  const plan = physicalPagePlan(imagePages, userPerPage, grid.total);
  const wanted = Number(filter?.currentPage) || 1;
  const page = Math.min(Math.max(1, wanted), plan.pages);

  const start = (page - 1) * plan.perPage;
  // The chosen page size everywhere, and everything left on the last page — the
  // page count is Stash's, so the remainder has to land somewhere.
  const end =
    page >= plan.pages
      ? grid.total
      : Math.min(start + plan.perPage, grid.total);
  const files = grid.files.slice(start, end);
  const images = files.map(occurrenceOf);

  // Selection is by image: every occurrence of a selected image is selected, and
  // a click on any of them selects the image Stash knows.
  const selected = new Set<string>();
  const selectedIds = props.selectedIds;
  if (selectedIds) {
    files.forEach((file, index) => {
      if (selectedIds.has(file.imageId)) selected.add(images[index].id);
    });
  }

  const onSelectChange = props.onSelectChange;
  const change = onSelectChange
    ? (synthetic: string, chosen: boolean, shiftKey: boolean) => {
        const real = synthetic.split("::")[0];
        onSelectChange(real, chosen, shiftKey);
      }
    : undefined;

  return {
    images,
    selectedIds: selected,
    onSelectChange: change,
    total: grid.total,
    perPage: plan.perPage,
    pages: plan.pages,
    page,
  };
}

/**
 * The `ImageList` patch: load the gallery's files, then hand Stash's own list an
 * occurrence-based one for the same page.
 *
 * A hook is used here rather than a plain props rewrite because the fetch is
 * asynchronous: the first render shows Stash's deduplicated list, and the state
 * bump redraws it once the files are in hand.
 */
function registerListPatch(): void {
  registerPatch("instead", "ImageList", (...args: unknown[]) => {
    noteFired("ImageList");

    const props = args[0] as ImageListProps;
    const next = args[args.length - 1] as (p: ImageListProps) => unknown;

    const galleryId = NS.physicalPageMode() ? currentGalleryId() : "";
    const [, bump] = React.useState(0);

    React.useEffect(() => {
      if (!galleryId) return;
      let live = true;
      load(galleryId).then(() => {
        if (live) bump((n: number) => n + 1);
      });
      return () => {
        live = false;
      };
    }, [galleryId]);

    const grid = galleryId ? cache.get(galleryId) : undefined;

    // **Memoized, and this is not an optimisation.** `ImageList` hands its
    // `images` to `useLightbox`, whose effect calls `setLightboxState` whenever
    // that array's identity changes — and `ImageList` is a consumer of the
    // lightbox context, so a fresh array on every render is an update loop that
    // freezes the page the moment the lightbox opens. The dependencies are the
    // values the expansion reads, not `props` (whose identity is new each render).
    const filter = props.filter;
    const sortBy = filter?.sortBy;
    const sortDirection = filter?.sortDirection;
    const currentPage = filter?.currentPage;
    const itemsPerPage = filter?.itemsPerPage;
    const totalCount = props.totalCount;
    const selectedIds = props.selectedIds;

    // **The selection handler is read through a ref, not a dependency.** It is a
    // plain function in `useListSelect`, so its identity changes whenever the list
    // around this one re-renders — and a changed dependency would rebuild `images`,
    // which is the identity the lightbox watches. The wrapper is stable; the
    // handler it calls is always the current one.
    const selectRef = React.useRef<ImageListProps["onSelectChange"]>(undefined);
    selectRef.current = props.onSelectChange;

    const change = React.useCallback(
      (synthetic: string, chosen: boolean, shiftKey: boolean) => {
        selectRef.current?.(synthetic.split("::")[0], chosen, shiftKey);
      },
      []
    );

    const expanded = React.useMemo(
      () =>
        NS.physicalPageMode() && grid
          ? expandPhysicalPage({ ...props, onSelectChange: change }, grid)
          : null,
      [
        grid,
        sortBy,
        sortDirection,
        currentPage,
        itemsPerPage,
        totalCount,
        selectedIds,
        change,
      ]
    );

    if (!expanded) return next(props);

    return next({
      ...props,
      images: expanded.images,
      selectedIds: expanded.selectedIds,
      onSelectChange: expanded.onSelectChange,
      totalCount: expanded.total,
      pageCount: expanded.pages,
      filter: {
        ...(props.filter || {}),
        currentPage: expanded.page,
        itemsPerPage: expanded.perPage,
      },
    });
  });
}

/** The card's link is `/images/<id>` — the real image, not the occurrence. */
function registerCardPatch(): void {
  registerPatch("before", "ImageCard", (...args: unknown[]) => {
    const props = args[0] as { image?: { id?: string } };
    noteFired("ImageCard");

    const image = props.image;
    if (!image || typeof image.id !== "string" || image.id.indexOf("::") < 0) {
      return [props];
    }

    return [{ ...props, image: { ...image, id: image.id.split("::")[0] } }];
  });
}

/** Registers the two patches. Called once, from the entry file. */
export function registerPhysicalPagePatches(): void {
  registerListPatch();
  registerCardPatch();
}

// Published for the smoke test, the way the reader half publishes its pure
// functions. The cast is only about the list's props, which Stash has no type for.
NS.physicalPagePlan = physicalPagePlan;
NS.expandPhysicalPage = expandPhysicalPage as unknown as (
  props: unknown,
  grid: unknown
) => unknown;
