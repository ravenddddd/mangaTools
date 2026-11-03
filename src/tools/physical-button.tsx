/**
 * The physical-pages button in the Images tab's toolbar.
 *
 * **Why a button rather than a line of text.** The mode only does anything on an
 * unfiltered list sorted by path, ascending — three conditions the reader can
 * break without noticing, and each of which silently hands the grid back to
 * Stash's deduplicated list. A sentence saying so would be one more line to read
 * on a page that is already dense, and it would still not fix anything. A button
 * shows the state and is the fix: pressed means the mode is in force, unpressed
 * means one click puts the list in the state it needs.
 *
 * **It replaces the count line's hint, not the count line.** The line keeps
 * Stash's numbers in Stash's shape (see physical-grid.ts, which rewrites only its
 * text); what the gallery actually holds — files, and how many of them repeat an
 * image — is in the button's tooltip, where it is useful rather than in the way.
 *
 * **Fixed to path ascending.** Any other order would need an occurrence ordering
 * the pinned rules do not have: two occurrences of one image share every sort key
 * they could be given, so their order would have to be invented, and the reader's
 * chapters count in path order regardless. Ascending only is the version with no
 * invented rules in it.
 *
 * The mount point is the end of the list's toolbar, after the zoom slider — the
 * same place Stash's own list-level controls end. It is found (and made) in the
 * render body, the way the dialog's language card finds its own box: the toolbar
 * is rendered by the component this patch wraps, so on the first pass of a fresh
 * tab it is not in the document yet, and the layout effect below asks once more
 * after the commit.
 */
import { NS } from "../languages";
import { numbered, t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import { currentGalleryId } from "./core";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** Stash's own end-of-toolbar control — see ZoomSlider.tsx */
const SLIDER_SELECTOR = ".zoom-slider-container";
/** This button's mount point, kept apart from the toolbar's own children */
const HOST_CLASS = "manga-tools-physical-host";

/** The handful of filter fields this module asks about */
export interface MangaToolsPhysicalFilter {
  sortBy?: string;
  sortDirection?: string;
  searchTerm?: string;
  criteria?: unknown[];
}

/**
 * Whether a list is in the state physical pages need: path order, ascending, no
 * search term, no criteria.
 *
 * The same rule `expandPhysicalPage` applies, in one place: a button that said
 * "on" while the grid showed Stash's deduplicated list would be worse than no
 * button at all.
 */
export function isPhysicalView(
  filter?: MangaToolsPhysicalFilter | null
): boolean {
  if (!filter) return false;
  if (String(filter.sortBy || "") !== "path") return false;
  if (String(filter.sortDirection || "").toUpperCase() !== "ASC") return false;
  if (filter.searchTerm) return false;
  return (filter.criteria?.length ?? 0) === 0;
}

/**
 * The query string that puts the list into physical-page view.
 *
 * **The filter is cleared and the sort is set; the UI options are kept.** Page
 * size, display mode and zoom are how the reader is looking at the list rather
 * than what is in it, and taking those away would make the button feel like a
 * reset. `sortdir` goes rather than being set to `asc`: absent means ascending for
 * everything but `date`, which is the rule Stash itself uses (see
 * `lightboxOrder`, which reproduces it for the reader).
 *
 * **Written to the URL rather than through the list's own state**, because the
 * button is not inside that component and cannot reach `setFilter`. Stash's
 * `useFilterURL` reads the query on every location change, which is the same route
 * the dialog's language card takes for Apply — and it is why `sortby` has to be
 * written explicitly: an empty query falls back to the *default* filter, which is
 * not necessarily a plain one.
 */
export function physicalQuery(search: string | undefined): string {
  const params = new URLSearchParams(search || "");
  params.delete("q");
  params.delete("c");
  params.delete("p");
  params.delete("sortdir");
  params.set("sortby", "path");
  return "?" + params.toString();
}

/**
 * How many of a gallery's pages are an image the gallery already showed.
 *
 * Occurrences minus distinct images: the number the count line cannot say, because
 * its total is the files' and its byline is Stash's.
 */
export function repeatingPages(files?: { imageId: string }[] | null): number {
  if (!files || files.length === 0) return 0;
  const seen = new Set<string>();
  for (const file of files) seen.add(file.imageId);
  return files.length - seen.size;
}

/** The mount point, made if the toolbar is there — and null while it is not. */
function ensureHost(): HTMLElement | null {
  const slider = document.querySelector(SLIDER_SELECTOR);
  const parent = slider?.parentNode as HTMLElement | null;
  if (!slider || !parent) return null;

  let host = document.querySelector("." + HOST_CLASS) as HTMLElement | null;
  if (!host) {
    host = document.createElement("span");
    host.className = HOST_CLASS;
  }

  // A re-render may displace it; keep it directly after the slider, which is the
  // end of Stash's own list-level controls.
  if (slider.nextElementSibling !== host) {
    parent.insertBefore(host, slider.nextElementSibling);
  }

  return host;
}

/**
 * What the button says, in the reader's language.
 *
 * Two strings rather than one with two numbers in it: the repeating-page count is
 * only worth saying when it is not zero, and a catalog entry with an optional
 * clause would make every translator write two sentences to say one.
 */
function titleFor(
  intl: ReturnType<typeof PluginApi.libraries.Intl.useIntl>,
  pressed: boolean,
  repeats: number
): string {
  if (!pressed) return t(intl, "mangaTools.physicalButton.off");

  let text = t(intl, "mangaTools.physicalButton.on");
  if (repeats > 0) {
    // One and many, because English needs both and this catalog has no plural
    // rules: "1 pages" in a tooltip is the kind of thing a reader notices and
    // cannot un-notice.
    text +=
      " · " +
      numbered(
        intl.locale,
        repeats === 1
          ? "mangaTools.physicalButton.repeatsOne"
          : "mangaTools.physicalButton.repeats",
        repeats
      );
  }
  return text;
}

/** The button itself, mounted into the Images tab's toolbar */
export function PhysicalPagesButton(props: {
  filter?: MangaToolsPhysicalFilter | null;
  files?: { imageId: string }[] | null;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const history = PluginApi.libraries.ReactRouterDOM.useHistory();
  const bumped = React.useState(0);
  const bump = bumped[1];

  const shown = NS.physicalPageMode() && currentGalleryId() !== "";

  // Created here rather than only in the effect: the toolbar of a tab that is
  // already on screen is in the document, and making the host during the same
  // pass keeps the first paint of a page turn from flickering a button in.
  const host = shown ? ensureHost() : null;

  React.useLayoutEffect(() => {
    // The first pass of a freshly opened tab has no toolbar yet — it is rendered
    // by the component this patch wraps, in the commit that this render is part
    // of. Asking once after that commit is enough: either it is there now, and a
    // re-render puts the button in, or the tab is not an image list at all.
    if (!shown || host) return;
    if (!ensureHost()) return;
    bump((n: number) => n + 1);
  });

  if (!shown || !host) return null;

  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) return null;

  const pressed = isPhysicalView(props.filter);
  const repeats = pressed ? repeatingPages(props.files) : 0;

  return PluginApi.ReactDOM.createPortal(
    <Bootstrap.Button
      variant="secondary"
      active={pressed}
      title={titleFor(intl, pressed, repeats)}
      aria-pressed={pressed}
      className="manga-tools-physical-button"
      onClick={() => {
        const search = physicalQuery(history.location.search);
        history.replace(Object.assign({}, history.location, { search }));
      }}
    >
      <PluginApi.components.Icon
        icon={PluginApi.libraries.FontAwesomeSolid?.faLayerGroup}
      />
    </Bootstrap.Button>,
    host
  );
}

// Published for the smoke test, which reaches this module through the window —
// see the note on MangaToolsNamespace in plugin-api.ts.
NS.isPhysicalView = isPhysicalView;
NS.physicalQuery = physicalQuery;
NS.repeatingPages = repeatingPages;
