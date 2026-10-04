/**
 * What a gallery card shows of this plugin.
 *
 * Both of these are additions to Stash's own card rather than changes to it, and
 * both are drawn by a patch in index.tsx that hands the original component
 * straight back — see the two `after` patches for GalleryCard.Overlays and
 * GalleryCard.Popovers.
 *
 * The badge sits on the bottom of the cover: the language as a flag, or as its
 * name when the flags are turned off, in the chip fields-ui.tsx draws for the
 * settings page's example as well. It reads the store and nothing else, so it
 * costs no request on a list of a hundred cards.
 *
 * The mark sits at the end of the card's popover row, and says at a glance which
 * galleries this plugin manages. Its placement is the reason the second half of
 * this module exists: the row is Stash's, React does not own it, and the button
 * belongs *inside* it — the row is a flex container, so anything rendered beside
 * it lands on a line of its own. The anchor-and-portal arrangement that answers
 * that is below, with useAfterMount (hosts.ts) as the render pass that turns this
 * render's anchor into the next render's slot.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import { pickLanguage, store, storedIsManga, useGlobalVersion } from "./core";
import { languageChip } from "./fields-ui";
import { MangaIcon } from "./icons";
import { useAfterMount } from "./hosts";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. It is named nowhere else
// here — the hook that used to read React.useState and React.useLayoutEffect
// lives in hosts.ts — so the linter reads this as unused, and its own fix renames
// it to `_React`, which type-checks and then fails at run time. See fields-ui.tsx,
// which carries the same line for the same reason.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

// ─────────────────────── UI locale and flags ───────────────────────

/**
 * Current Stash UI locale.
 *
 * Reads it through react-intl, exactly like CountryLabel does — the plugin
 * never guesses the user's language. This is a hook, so it must be called
 * inside a component body.
 */
function useLocale(): string {
  return PluginApi.libraries.Intl.useIntl().locale;
}

// ─────────────────────────── Cover badge ───────────────────────────

/** Reads the in-memory store only; issues no requests. */
export function LanguageBadge(props: { galleryId: string }) {
  useGlobalVersion();
  const locale = useLocale();

  const info = NS.describe(
    pickLanguage(store?.get(String(props.galleryId))),
    locale
  );
  if (!info) return null;

  return languageChip(info);
}

/** Class of the empty span kept beside Stash's popover row, one per card */
const POPOVER_ANCHOR_CLASS = "manga-tools-popover-anchor";
/** Class of the node inside that row that our button is portalled into */
const POPOVER_SLOT_CLASS = "manga-tools-popover-slot";
/** Marks a row this plugin had to make, because Stash drew none */
const POPOVER_ROW_CLASS = "manga-tools-popovers";

/**
 * Whether an element carries a class.
 *
 * Read off `className` rather than through `classList`: the smoke tests' DOM
 * stub has the former and not the latter, and a class name is all this needs.
 */
function hasClass(el: Element | null, name: string): boolean {
  return !!el && (el.className || "").split(/\s+/).indexOf(name) >= 0;
}

/**
 * Finds (creating if needed) the node to portal a card's mark into: the last
 * child of Stash's own `.card-popovers` row.
 *
 * Why a portal *into* Stash's row, rather than a second row of our own: the row
 * is a flex container, so anything rendered beside it lands on a line of its own
 * instead of being another button on this one.
 *
 * The anchor is the empty span the caller renders next to that row, carrying the
 * gallery id. Searching for *that* is what makes the row found the right one: a
 * gallery appears in exactly one card in Stash's list, so the id names one anchor
 * — where `.card-popovers` alone would match the first row on the page however
 * far down it this card is. If a gallery ever did appear twice, the mark would
 * go to the first of them and the second would go without.
 *
 * A card with no image count, no tags, no performers, no scenes and no organized
 * mark has no row at all. One is then created with the classes Stash uses, so it
 * is indistinguishable from the real thing — because there is no real thing to
 * be distinguished from.
 */
function ensurePopoverSlot(galleryId: string): HTMLElement | null {
  const anchor = document.querySelector(
    '[data-gallery="' + galleryId + '"]'
  ) as HTMLElement | null;
  if (!anchor?.parentNode) return null;

  const previous = anchor.previousElementSibling;
  let row: Element;

  if (
    hasClass(previous, "card-popovers") ||
    hasClass(previous, POPOVER_ROW_CLASS)
  ) {
    row = previous as Element;
  } else {
    row = document.createElement("div");
    row.className = "btn-group card-popovers " + POPOVER_ROW_CLASS;
    anchor.parentNode.insertBefore(row, anchor);
  }

  let slot: Element | null = null;
  for (let i = 0; i < row.children.length; i++) {
    if (hasClass(row.children[i], POPOVER_SLOT_CLASS)) {
      slot = row.children[i];
      break;
    }
  }

  if (slot) {
    // Stash re-renders its row and can leave ours in the middle of it; the mark
    // belongs after Stash's own buttons, which is where they still are.
    if (row.lastElementChild !== slot) row.appendChild(slot);
    return slot as HTMLElement;
  }

  slot = document.createElement("span");
  slot.className = POPOVER_SLOT_CLASS;
  row.appendChild(slot);
  return slot as HTMLElement;
}

/**
 * The manga icon at the end of a card's popover row, or null when the gallery is
 * not one the plugin manages.
 *
 * An anchor plus a portal rather than the button itself, because the row it
 * belongs in is Stash's and React does not own it — see ensurePopoverSlot. The
 * anchor is rendered on every pass so there is always exactly one to find; on
 * the pass that also has a slot to draw, the two go out together.
 *
 * `useAfterMount` is what turns the anchor of this render into the slot of the
 * next one, on a real page: the anchor is not in the document until this render
 * has been committed.
 */
export function MangaPopoverMark(props: { galleryId: string }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const manga = storedIsManga(props.galleryId);
  const slot = manga ? ensurePopoverSlot(props.galleryId) : null;

  if (!manga || !NS.coverIcon) return null;

  return (
    <>
      <span className={POPOVER_ANCHOR_CLASS} data-gallery={props.galleryId} />
      {slot
        ? PluginApi.ReactDOM.createPortal(
            <button
              type="button"
              className="minimal btn btn-primary manga-tools-mark"
              title={t(intl, "mangaTools.manga.marked")}
            >
              <MangaIcon />
            </button>,
            slot
          )
        : null}
    </>
  );
}
