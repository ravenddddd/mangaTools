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
 * The same page count Stash computed, with the files divided into it.
 *
 * Published for the smoke test: the arithmetic is where a page that cannot be
 * reached would come from, and it is the cheapest part of this module to pin.
 */
export function physicalPagePlan(
  imageCount: number,
  userPerPage: number,
  fileCount: number
): { pages: number; perPage: number } {
  const imagePages = Math.max(1, Math.ceil(imageCount / userPerPage));
  const perPage = Math.max(userPerPage, Math.ceil(fileCount / imagePages));
  return { pages: Math.max(1, Math.ceil(fileCount / perPage)), perPage };
}

/** What the grid is showing, for the two pagination components. */
interface PageView {
  galleryId: string;
  total: number;
  perPage: number;
}

let pageView: PageView | null = null;
const viewListeners = new Set<() => void>();

function setPageView(next: PageView | null): void {
  if (
    (next === null && pageView === null) ||
    (next !== null &&
      pageView !== null &&
      next.galleryId === pageView.galleryId &&
      next.total === pageView.total &&
      next.perPage === pageView.perPage)
  ) {
    return;
  }

  pageView = next;
  viewListeners.forEach((fn) => {
    fn();
  });
}

/**
 * The view the pagination components should draw, re-rendering when it changes.
 *
 * They are rendered *before* `ImageList` in Stash's tree, so the list cannot hand
 * them the numbers directly; a small store and a subscription are what puts the
 * physical count on the page a tick after the list has computed it.
 */
function usePageView(): PageView | null {
  const [, bump] = React.useState(0);

  React.useEffect(() => {
    const fn = () => bump((n: number) => n + 1);
    viewListeners.add(fn);
    return () => {
      viewListeners.delete(fn);
    };
  }, []);

  return pageView;
}

/** The props this module reads off `ImageList`, which Stash types only as `any`. */
interface ImageListProps {
  filter?: {
    sortBy?: string;
    sortDirection?: string;
    currentPage?: number;
    itemsPerPage?: number;
    displayMode?: string;
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

/**
 * The physical list for this render, or null to leave Stash's list alone.
 *
 * Pure on purpose — the gallery comes in as a grid rather than out of the cache —
 * so the smoke test can drive it with a fixture, and so the only thing the patch
 * adds is "is the setting on, and which gallery is this".
 */
export function expandPhysicalPage(
  props: ImageListProps,
  grid: GalleryGrid
): { props: ImageListProps; total: number; perPage: number } | null {
  const filter = props.filter;
  if (filter?.sortBy !== "path") return null;
  if (String(filter?.sortDirection || "").toUpperCase() !== "ASC") return null;
  if (!grid || grid.files.length === 0) return null;

  const userPerPage = Number(filter?.itemsPerPage) || 100;
  const plan = physicalPagePlan(
    Number(props.totalCount) || 0,
    userPerPage,
    grid.total
  );
  const wanted = Number(filter?.currentPage) || 1;
  const page = Math.min(Math.max(1, wanted), plan.pages);

  const start = (page - 1) * plan.perPage;
  const files = grid.files.slice(start, start + plan.perPage);
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
    props: {
      ...props,
      images,
      selectedIds: selected,
      onSelectChange: change,
      totalCount: grid.total,
      pageCount: plan.pages,
      filter: {
        ...(filter || {}),
        currentPage: page,
        itemsPerPage: plan.perPage,
      },
    },
    total: grid.total,
    perPage: plan.perPage,
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

    const galleryId = NS.physicalPages ? currentGalleryId() : "";
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
    const expanded =
      NS.physicalPages && grid ? expandPhysicalPage(props, grid) : null;

    React.useEffect(() => {
      setPageView(
        expanded
          ? { galleryId, total: expanded.total, perPage: expanded.perPage }
          : null
      );
      return () => setPageView(null);
      // The primitives that make the view, not the object rebuilt each render.
    }, [galleryId, expanded?.total, expanded?.perPage]);

    return next(expanded ? expanded.props : props);
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

/**
 * The two pagination components, drawn from the physical view when there is one.
 *
 * `instead` rather than `before` because of the subscription: the numbers are set
 * by the list, which renders *after* these, so the component has to be able to
 * redraw when they arrive.
 */
function registerPaginationPatch(
  target: "Pagination" | "PaginationIndex"
): void {
  registerPatch("instead", target, (...args: unknown[]) => {
    const props = args[0] as {
      totalItems?: number;
      itemsPerPage?: number;
    };
    const next = args[args.length - 1] as (p: unknown) => unknown;
    const view = usePageView();

    return next(
      view
        ? { ...props, totalItems: view.total, itemsPerPage: view.perPage }
        : props
    );
  });
}

/** Registers all four patches. Called once, from the entry file. */
export function registerPhysicalPagePatches(): void {
  registerListPatch();
  registerCardPatch();
  registerPaginationPatch("Pagination");
  registerPaginationPatch("PaginationIndex");
}

// Published for the smoke test, the way the reader half publishes its pure
// functions. The cast is only about the list's props, which Stash has no type for.
NS.physicalPagePlan = physicalPagePlan;
NS.expandPhysicalPage = expandPhysicalPage as unknown as (
  props: unknown,
  grid: unknown
) => unknown;
