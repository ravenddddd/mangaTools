/**
 * What this plugin knows about Stash's lightbox: its markup, how to read where it
 * is, how to move it, and how to fetch the pages it is showing.
 *
 * Every name in here is an assumption about a component Stash does not expose —
 * `LightboxComponent` is a plain `React.FC` with no `PatchComponent` wrapper, so
 * there is no supported way in and this is the boundary where that is admitted.
 * Keeping the assumptions in one file is what makes them checkable against
 * Stash's source, and what the test suite can pin the parts of that are pure
 * (`parseIndicator`, `galleryIdFromPath`).
 *
 * If Stash renames something here, the reader stops working — so everything that
 * reads the lightbox returns null rather than guessing, and the caller turns the
 * mode off. A reader that cannot tell where it is must not draw anything.
 */
import { gqlDoc, requirePluginApi } from "../plugin-api";
import { NR, type MangaReaderOrder, type MangaReaderStrip } from "./namespace";
import type { MangaReaderPage } from "./spreads";

/** The root element's class. Everything else is a child of it. */
export const CLASS_LIGHTBOX = "Lightbox";
export const CLASS_DISPLAY = "Lightbox-display";
export const CLASS_CAROUSEL = "Lightbox-carousel";
export const CLASS_INDICATOR = "Lightbox-header-indicator";
export const CLASS_OPTIONS_ICON = "Lightbox-header-options-icon";
export const CLASS_POPOVER_BODY = "popover-body";
/**
 * Where Stash puts its chapter menu, and the menu itself.
 *
 * Read, never written: Stash draws its own there when it has chapters to show, and
 * *only* then — it hands the lightbox an empty list whenever the list behind it is
 * not sorted by path, because its chapter numbers count in path order and would
 * point at the wrong images. So the presence of this button is also the answer to
 * "is Stash's own chapter navigation on screen", which is what decides whether
 * this plugin adds its own.
 */
export const CLASS_HEADER_LEFT_SPACER = "Lightbox-header-left-spacer";
export const CLASS_CHAPTER_BUTTON = "Lightbox-header-chapter-button";
/** The strip of thumbnails along the bottom, one per image the lightbox holds */
export const CLASS_NAV = "Lightbox-nav";
export const CLASS_NAV_IMAGE = "Lightbox-nav-image";
export const CLASS_NAV_SELECTED = "Lightbox-nav-selected";

/** The selectors, spelled once so a page of Stash's markup is read the same way everywhere */
export const SELECTOR_LIGHTBOX = ".Lightbox";
export const SELECTOR_DISPLAY = ".Lightbox-display";
export const SELECTOR_CAROUSEL = ".Lightbox-carousel";
export const SELECTOR_INDICATOR = ".Lightbox-header-indicator";
export const SELECTOR_OPTIONS_ICON = ".Lightbox-header-options-icon";
export const SELECTOR_POPOVER_BODY = ".popover .popover-body";
export const SELECTOR_HEADER_LEFT_SPACER = ".Lightbox-header-left-spacer";
export const SELECTOR_CHAPTER_BUTTON = ".Lightbox-header-chapter-button";
export const SELECTOR_NAV = ".Lightbox-nav";

/**
 * Stash's own next/previous buttons, the chevrons either side of the image.
 *
 * A class rather than a selector because the plugin walks up to one from a click's
 * target; the two buttons are the same component twice, so the icon inside is what
 * tells them apart — see navDirection in takeover.ts.
 */
export const CLASS_NAVBUTTON = "Lightbox-navbutton";

/** Where the lightbox is, as far as the reader can tell. */
export interface LightboxPosition {
  /** 1-based, as the lightbox's own header counts */
  current: number;
  total: number;
}

/**
 * Reads the lightbox's header, which spells out "N / M".
 *
 * That text is the lightbox's own statement of where it is, which is why it is
 * what this plugin reads rather than the carousel's image: the header is one
 * element with one meaning, where the carousel holds several slides at once and
 * which of them is current depends on its internals.
 *
 * Null whenever the text is not the shape expected. A gallery of one image has no
 * counter at all — Stash draws it only when there is more than one — and that is a
 * null too, for the same reason as any other: nothing may be assumed from it.
 */
export function parseIndicator(text: string): LightboxPosition | null {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) return null;

  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!total || current < 1 || current > total) return null;

  return { current, total };
}

/** Where the lightbox is, or null when it cannot be told. */
export function readPosition(root: Element): LightboxPosition | null {
  const indicator = root.querySelector(SELECTOR_INDICATOR);
  // The counter is the <b> inside the header: the span beside it is the chapter
  // name, which is not a number.
  const counter = indicator?.querySelector("b");
  if (!counter) return null;

  return parseIndicator(counter.textContent || "");
}

/** The gallery a path belongs to, or null for any other page. */
export function galleryIdFromPath(pathname: string): string | null {
  const match = /^\/galleries\/(\d+)/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * Presses one of the lightbox's own arrow keys, once.
 *
 * **One press, never a burst.** Stash's own key handler drops a press that arrives
 * while a page is still swapping (`isSwitchingPageRef` in its lightbox — "rapid
 * inputs are dropped", as its comment puts it), so two presses in the same tick
 * advance one page rather than two. That is intermittent, because a cached page
 * swaps fast enough for it not to happen, and it is why the reader presses, waits
 * for the header to say it landed, and presses again — see steppingTo in
 * takeover.ts.
 *
 * The event is dispatched on `document`, where the lightbox listens, and is
 * deliberately not `isTrusted` — which is how the reader's own key handler tells
 * it from a real key press and lets it through.
 */
export function pressArrow(direction: 1 | -1): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: direction > 0 ? "ArrowRight" : "ArrowLeft",
      bubbles: true,
      cancelable: true,
    })
  );
}

/**
 * Closes the lightbox, through Stash's own Escape.
 *
 * Stash listens for it on the document and closes — the same `close()` its own
 * click-on-the-background runs, so this is Stash's path rather than a second idea
 * of what closing means. The plugin needs it because its container covers the slide
 * that click would have landed on: everything under the pages is ours, so a click
 * there has to be turned back into what Stash would have done with it.
 */
export function pressEscape(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
  );
}

/**
 * Reads the order the lightbox is showing its images in, from the URL.
 *
 * **The pages have to be fetched in the order they are being shown.** The lightbox
 * opened from the gallery page's Chapters tab is Stash's own and always path — but
 * the one opened from the Images tab holds *the list's* images, in the list's own
 * sort, and that is a list the reader never sees. Pairing path-ordered pages
 * against a title-ordered carousel draws the wrong pages, and puts every index
 * this plugin computes — which page a screen starts at, which thumbnail to click
 * to reach a chapter — off by however much the two orders disagree.
 *
 * The URL is where the list keeps its filter (`?sortby=title&perPage=500`), and
 * Stash clears it when you leave the tab that owns it — so an absent `sortby` is
 * the case with no list behind it, which is the Chapters-tab lightbox and its path
 * order. Both read correctly, which is the only property that matters here.
 *
 * The direction rule is Stash's own, from `configureFromDecodedParams` in
 * `models/list-filter/filter.ts`: absent means ascending, *except* for `date`,
 * which means descending. Reproduced rather than simplified — a `date` list sorted
 * the other way would be a mismatch like any other.
 *
 * Filtered lists — a search term, a criterion in `c=` — are a mismatch this cannot
 * see, and they fail the check the caller already makes: the lightbox's own count
 * of how many images it is showing no longer matches the pages fetched here, so
 * nothing is drawn.
 */
export function lightboxOrder(search: string): MangaReaderOrder {
  const params = new URLSearchParams(search || "");
  const sort = params.get("sortby") || "path";
  const direction = params.get("sortdir");

  return {
    sort,
    direction:
      direction === "desc" || (direction === null && sort === "date")
        ? "DESC"
        : "ASC",
  };
}

/**
 * One query for everything opening a gallery needs.
 *
 * Two things, one round trip: the pages, and the language this Stash's interface
 * is in — which the plugin needs for the label it adds to the lightbox's options
 * menu, and which cannot be read from the page (Stash leaves `html lang` at `en`
 * whatever the interface is set to).
 *
 * The image filter is copied from GalleryViewer, which is the list the lightbox is
 * opened with: `per_page: -1` and the order the lightbox is being shown in. **The
 * sort has to match**, because the pairing is only meaningful against that order —
 * see lightboxOrder for where it comes from.
 *
 * The sort and the direction are *variables* rather than text spliced into the
 * query, because they come from the URL: a `sortby` with a quote in it would
 * otherwise be able to write GraphQL. Both are always sent — the server's default
 * when `sort` is unset is `title`, not `path`, so leaving one out would silently
 * ask for an order the lightbox is not showing.
 */
export const GALLERY_QUERY_TEXT = [
  "query MangaReaderGallery($galleryId: ID!, $sort: String, $direction: SortDirectionEnum, $withPathIds: Boolean!) {",
  "  configuration {",
  "    interface {",
  "      language",
  "    }",
  "  }",
  "  findGallery(id: $galleryId) {",
  "    id",
  "    custom_fields",
  "    chapters {",
  "      title",
  "      image_index",
  "    }",
  "  }",
  "  pages: findImages(",
  "    image_filter: { galleries: { value: [$galleryId], modifier: INCLUDES } }",
  "    filter: { per_page: -1, sort: $sort, direction: $direction }",
  "  ) {",
  "    images {",
  "      id",
  "      visual_files {",
  "        ... on ImageFile {",
  "          width",
  "          height",
  "        }",
  "      }",
  "      paths {",
  "        image",
  "      }",
  "    }",
  "  }",
  "  byPath: findImages(",
  "    image_filter: { galleries: { value: [$galleryId], modifier: INCLUDES } }",
  '    filter: { per_page: -1, sort: "path", direction: ASC }',
  "  ) @include(if: $withPathIds) {",
  "    images {",
  "      id",
  "    }",
  "  }",
  "}",
].join("\n");

let galleryQuery: unknown = null;

/** What the gallery query returns, as far as this plugin cares */
/**
 * Where the strip of thumbnails starts, how long it is, and which one is current.
 *
 * The strip is one thumbnail per image the lightbox is *holding* — the page it
 * fetched, not the whole gallery — and clicking one is Stash's own way of going
 * straight to an image: `selectIndex(index)` in its lightbox, which is the one
 * thing here that reaches the index directly rather than by pressing an arrow.
 * That is what makes a chapter jump one click instead of three hundred.
 *
 * All three numbers are 0-based, against the strip. `start` is the global index of
 * its first thumbnail, worked out from the header's own count of where the
 * lightbox is: the counter says which image is current, and the selected thumbnail
 * says how far into the strip that is.
 */
/** The thumbnails the lightbox is holding, or null when it is not holding any */
export function readStrip(lightbox: Element): MangaReaderStrip | null {
  const thumbs = stripThumbs(lightbox);
  if (!thumbs) return null;

  const selected = thumbs.findIndex((thumb) =>
    thumb.classList.contains(CLASS_NAV_SELECTED)
  );
  if (selected < 0) return null;

  const position = readPosition(lightbox);
  if (!position) return null;

  // The counter is 1-based and global; the strip is 0-based and local.
  const start = position.current - 1 - selected;
  if (start < 0) return null;

  return { start, count: thumbs.length, selected };
}

/**
 * Goes straight to an image by clicking its thumbnail, if the lightbox is holding
 * it. False when it is not — a target on a page the lightbox has not fetched, which
 * is a jump this cannot make rather than one it should guess at.
 */
export function clickStrip(lightbox: Element, index: number): boolean {
  const strip = readStrip(lightbox);
  if (!strip) return false;

  const at = index - strip.start;
  if (at < 0 || at >= strip.count) return false;

  const thumb = stripThumbs(lightbox)?.[at];
  if (!thumb) return false;

  // A real click on Stash's own element, so its handler runs the way it would for
  // a reader's click — no second idea of how the lightbox moves.
  thumb.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true })
  );

  return true;
}

/** The thumbnails, in the order the lightbox is holding them */
function stripThumbs(lightbox: Element): Element[] | null {
  const nav = lightbox.querySelector(SELECTOR_NAV);
  if (!nav) return null;

  // `children` and a class test rather than `querySelectorAll`: the stub the tests
  // run against has no selector engine below the root, and this is the same answer
  // without needing one.
  const thumbs = Array.from(nav.children).filter((child) =>
    child.classList.contains(CLASS_NAV_IMAGE)
  );

  return thumbs.length > 0 ? thumbs : null;
}

/**
 * Whether Stash's own chapter menu is on screen.
 *
 * Its absence is not a fault: it means the lightbox was handed an empty chapter
 * list, which Stash does whenever the list behind it is not in path order. See the
 * note on CLASS_CHAPTER_BUTTON.
 */
export function hasOwnChapterMenu(lightbox: Element): boolean {
  return lightbox.querySelector(SELECTOR_CHAPTER_BUTTON) !== null;
}

interface GalleryPayload {
  configuration?: { interface?: { language?: string } };
  findGallery?: {
    id?: string;
    custom_fields?: unknown;
    chapters?: Array<{ title?: string; image_index?: number }>;
  };
  pages?: {
    images?: Array<{
      id: string;
      visual_files?: Array<{ width?: number; height?: number }>;
      paths?: { image?: string };
    }>;
  };
  /** Only asked for when the order is not path — see fetchGallery */
  byPath?: { images?: Array<{ id: string }> };
}

export interface GalleryAnswer {
  /** The interface language, or null when Stash did not say */
  language: string | null;
  pages: MangaReaderPage[];
  /** This gallery's custom fields, as Stash holds them */
  customFields: unknown;
  /** Stash's own chapters, in the shape its own field has */
  stashChapters: { title?: string; image_index?: number }[];
  /**
   * The gallery's image ids in path order, or null when they were not asked for.
   *
   * Asked for only when the pages themselves are not in path order, because that
   * is the only case that needs them: Stash's chapter numbers count in path order,
   * so translating one into an image means counting that way. When the pages *are*
   * path-ordered they are that list already, and asking twice would be the same
   * answer at twice the price.
   */
  pathIds: string[] | null;
}

/**
 * The pages of a gallery, in the order the lightbox shows them.
 *
 * A page's size comes from its first visual file that reported one; a page with
 * none still counts, because dropping it would shift every pair after it. That is
 * the one place a missing size matters, and it is why spreads.ts treats an unknown
 * size as an ordinary page rather than as a spread.
 */
export async function fetchGallery(
  galleryId: string,
  order: MangaReaderOrder
): Promise<GalleryAnswer> {
  if (!galleryQuery) {
    galleryQuery = gqlDoc(GALLERY_QUERY_TEXT, "build the gallery query");
  }
  const query = galleryQuery;
  if (!query) throw new Error("[mangaReader] no gallery query document");

  // The path-ordered ids are needed to translate Stash's chapter numbers, and are
  // only worth asking for when the pages are not already in that order.
  const pathIdsNeeded = order.sort !== "path";

  const data = await requirePluginApi()
    .utils.StashService.getClient()
    // no-cache: this is read once per gallery opened and nothing else in the page
    // wants it in Apollo's normalised cache — the lightbox's own query is the one
    // that belongs there, and two writers of the same Image objects is how a
    // cache starts disagreeing with itself.
    .query({
      query,
      variables: {
        galleryId,
        sort: order.sort,
        direction: order.direction,
        withPathIds: pathIdsNeeded,
      },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data as GalleryPayload | undefined);

  const pages: MangaReaderPage[] = (data?.pages?.images || []).map((image) => {
    const file = (image.visual_files || []).find(
      (f) => typeof f?.width === "number" && typeof f?.height === "number"
    );

    return {
      id: String(image.id),
      width: file?.width || 0,
      height: file?.height || 0,
      // Stash's own URL for the image, kept for the query on it — which is a
      // version stamp, and is the whole reason this field is fetched at all. See
      // pageUrl in takeover.ts.
      url: image.paths?.image || "",
    };
  });

  return {
    language: data?.configuration?.interface?.language || null,
    pages,
    customFields: data?.findGallery?.custom_fields || {},
    stashChapters: data?.findGallery?.chapters || [],
    pathIds: pathIdsNeeded
      ? (data?.byPath?.images || []).map((image) => String(image.id))
      : null,
  };
}

NR.parseIndicator = parseIndicator;
NR.galleryIdFromPath = galleryIdFromPath;
NR.lightboxOrder = lightboxOrder;
NR.readStrip = readStrip;
NR.clickStrip = clickStrip;
NR.hasOwnChapterMenu = hasOwnChapterMenu;
