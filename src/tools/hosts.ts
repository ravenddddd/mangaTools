/**
 * Where this plugin's own nodes go on Stash's pages.
 *
 * Three surfaces are drawn by putting a host element into Stash's markup and
 * rendering into it, rather than by patching the component that renders them: the
 * details tab's manga info block, the edit form's field block, and the bulk edit
 * dialog's rows. None of those three components is a PatchComponent, so there is
 * no element tree to hand a row to. This module is the whole of that arrangement —
 * the `data-field` anchor each one hangs off, the host node itself, and the rule
 * that keeps a host where it was put when React re-renders around it.
 *
 * **Nothing here imports anything of this plugin's.** It is Stash's markup, a
 * document, and three attribute selectors, which is what lets every surface reach
 * it in the same direction: index.tsx portals through it today, and each screen
 * that moves out of the entry file will too.
 *
 * The anchors are deliberately three different strings. Two of them name rows a
 * *dialog* has — the bulk dialog's own studio row and the row that identifies a
 * bulk dialog at all — and the studio row is not unique to it (the scrape dialog
 * carries the same attribute), which is why finding one means searching inside
 * the dialog's own form rather than the document.
 */

/**
 * Anchors for the two places a language field is inserted.
 *
 * Both are rows Stash itself tags with data-field, so the anchor survives
 * markup changes:
 *   - the gallery edit panel uses renderField, which tags the studio row
 *     `studio_id`
 *   - the bulk edit dialog uses BulkUpdateFormGroup, which tags it `studio`
 *
 * They are deliberately different strings, so the two lookups can never
 * match each other's row.
 */
export const EDIT_ANCHOR = '.form-group[data-field="studio_id"]';

/**
 * The studio row inside a bulk dialog, named by `BulkUpdateFormGroup` — and **not**
 * unique to it: the scrape dialog's studio row carries the same attribute, which is
 * why finding it means searching inside the dialog's form rather than the document.
 * See bulkAnchor.
 */
export const BULK_ANCHOR = '[data-field="studio"]';

/**
 * What identifies a bulk dialog: the row `BulkUpdateFormGroup name="rating"` emits,
 * and which nothing else in Stash emits at all — the edit pages do not name a
 * rating row that way, and the gallery scrape dialog has no rating row.
 *
 * It identifies *a* bulk dialog rather than the galleries one; the route guard is
 * what makes it the galleries one, since this plugin draws nothing on the scene,
 * image or performer pages those other bulk dialogs belong to.
 */
const BULK_DIALOG_MARK = '[data-field="rating"]';

/** Class name of the detail row's mount point */
const DETAIL_HOST_CLASS = "manga-tools-detail-host";

/**
 * The mount point. Held at module scope so a React re-render that drops it
 * reuses the same node instead of creating a new one every render.
 */
let detailHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point for the detail-page language row.
 *
 * Why this touches the DOM: everything inside `.gallery-details` is a bare
 * <h6>. The only component there is PhotographerLink, and neither it nor its
 * parent GalleryDetailPanel is patchable, so React offers no insertion point.
 *
 * Appending to the end of `.gallery-details` puts the row after "photographer"
 * and before "details" — the latter belongs to renderDetails() in the next .row.
 */
export function ensureDetailHost(): HTMLElement | null {
  const panel = document.querySelector(".gallery-details");
  if (!panel) {
    detailHost = null;
    return null;
  }

  if (!detailHost) {
    detailHost = document.createElement("div");
    detailHost.className = DETAIL_HOST_CLASS;
  }

  // A React re-render may push it earlier or drop it; keep it at the end.
  if (
    detailHost.parentNode !== panel ||
    panel.lastElementChild !== detailHost
  ) {
    panel.appendChild(detailHost);
  }

  return detailHost;
}

/** Class name of the edit field's mount point */
const FIELD_HOST_CLASS = "manga-tools-field-host";

/**
 * The bulk dialog's studio row, found **inside the dialog's own form**.
 *
 * A plain document query is not enough, and the reason is not hypothetical: the
 * scrape dialog's rows are `ScrapeDialogRow`s, and its studio row carries the very
 * `data-field="studio"` this looks for. The mount point is live whenever a gallery
 * page is on screen — it is mounted by RatingSystem, which the *page* renders, not
 * the dialog — so with a scrape dialog open the first match was the scraped row,
 * and the mark checkbox appeared under it.
 *
 * Scoping the search is what fixes that, and it is the right way round for an
 * insertion: the question asked is "is the bulk dialog up, and where is its studio
 * row", and when it cannot be answered nothing is drawn. The form is reached from
 * the rating row every bulk dialog has (see BULK_DIALOG_MARK); a dialog without one
 * has no form to search, so its rows are never in scope at all.
 *
 * **`closest` rather than a hand-walked parent chain, and that is the whole of what
 * went wrong here.** The walk compared `tagName === "form"`, which no browser ever
 * answers: `tagName` is upper case there ("FORM"). It is lower case only in the
 * stub this was tested against, so the lookup succeeded in the tests and returned
 * null in every real browser — the rows were never placed, and nothing said why.
 * The comment that stood here said `closest` was avoided so the tests' DOM would
 * not have to implement one more method: the stub's convenience decided the
 * production code, and the stub was the thing that was wrong.
 */
export function bulkAnchor(): Element | null {
  const form = document.querySelector(BULK_DIALOG_MARK)?.closest("form");
  return form ? form.querySelector(BULK_ANCHOR) : null;
}

/**
 * Whether a bulk dialog is on the page at all — the rating row is the mark of it.
 *
 * The one question the mount point's diagnostic cannot answer by itself: an anchor
 * that cannot be found means "there is no dialog here" (an ordinary page) as well
 * as "there is a dialog and I cannot place the rows in it" (a bug). Only the second
 * is worth a line, and this is what tells them apart.
 */
export function bulkDialogUp(): boolean {
  return !!document.querySelector(BULK_DIALOG_MARK);
}

/** As above, held at module scope so the same node is reused */
export const fieldHosts: { [key: string]: HTMLElement | null } = {
  edit: null,
  bulk: null,
};

/**
 * Finds (creating if needed) the mount point for a language field row,
 * positioned **right after `anchor`**.
 *
 * Why not patch the component that renders that row: StudioSelect renders
 * inside a `<Col>`, so anything added there is nested inside that column and
 * the label column no longer lines up with the native fields. What is needed
 * is a sibling field row, so one has to be inserted into the DOM.
 *
 * Conveniently Stash leaves a data-field attribute on these rows (renderField
 * on the edit panel, BulkUpdateFormGroup in the bulk dialog), which makes a far
 * more stable anchor than walking the structure. Finding that anchor is the
 * callers' business: the edit panel's is a plain query, and the bulk dialog's has
 * to be scoped to the dialog (see bulkAnchor).
 *
 * `key` is per-anchor so the edit panel and the bulk dialog each keep their own
 * mount point; they are never on screen at the same time.
 */
function ensureHostAfter(
  anchor: Element | null,
  key: string
): HTMLElement | null {
  if (!anchor?.parentNode) {
    fieldHosts[key] = null;
    return null;
  }

  let host = fieldHosts[key];
  if (!host) {
    host = document.createElement("div");
    host.className = FIELD_HOST_CLASS;
    fieldHosts[key] = host;
  }

  // A React re-render may displace it; keep it directly after the studio row.
  // The reference node is nextElementSibling rather than nextSibling: it is
  // the same property the idempotency check above uses, and a stray whitespace
  // text node between the two does not change the position either way.
  if (
    host.parentNode !== anchor.parentNode ||
    anchor.nextElementSibling !== host
  ) {
    anchor.parentNode.insertBefore(host, anchor.nextElementSibling);
  }

  return host;
}

/** The gallery edit panel's mount point (see LanguageRow) */
export function ensureFieldHost(): HTMLElement | null {
  return ensureHostAfter(document.querySelector(EDIT_ANCHOR), "edit");
}

/** The bulk edit dialog's mount point (see BulkFieldsRow) */
export function ensureBulkFieldHost(): HTMLElement | null {
  return ensureHostAfter(bulkAnchor(), "bulk");
}
