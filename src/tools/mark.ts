/**
 * The mark: whether a gallery is one now, and the writes that change it.
 *
 * Two things every surface asks for live here. One is whether a gallery carries the
 * mark *at this moment* — read out of the store rather than out of anything Stash
 * handed in, for the reasons isMarkedNow gives. Reading a stale answer is what makes
 * a switch flip back, so the toolbar, the details panel, the edit block and the bulk
 * dialog all ask this one question here.
 *
 * The other is the write path: writeQuietly takes a gallery, one of this plugin's
 * fields and the value it should carry, sends it, and refetches without waiting. It
 * is the only way a value reaches Stash from this half that is not Stash's own edit
 * form, and every surface that sets one goes through it.
 *
 * The open edit form is here too, and deliberately *published* rather than owned
 * (see setEditForm). Stash's edit form is the one place a mark can be set for a
 * gallery that is not manga yet, so the patch that sees *every* gallery's form is
 * what fills it — see the CustomFieldsInput patch in index.tsx for why that cannot
 * be the edit block. What reads it back is editFormFor, and what reads it to decide
 * whether a question is safe to ask is editFormIsDirty.
 */
import { NS } from "../languages";
import {
  CHAPTER_FIELD_NAME,
  emit,
  refreshAfterWrite,
  stashClient,
  store,
  storedIsManga,
} from "./core";
import { gqlDoc, requirePluginApi } from "../plugin-api";
import type { CustomFieldsMap } from "./core";

const _PluginApi = requirePluginApi();

/**
 * The edit form's custom-fields map and its setter, while the edit tab is open.
 *
 * Published by MangaFieldBlock, which is rendered inside that form and so has
 * both. Marking from the toolbar writes through this as well as to the server
 * (see `mark`), so the form's own copy of the map carries the mark and a later
 * Save — which sends the whole map back (`custom_fields: { full: … }`) — cannot
 * drop it. Cleared when the block unmounts: a setter left behind would write into
 * a form that is no longer there.
 */
let editForm: {
  /** The gallery the form is for — the form on screen is always the route's */
  galleryId: string;
  values: CustomFieldsMap;
  onChange: (values: CustomFieldsMap) => void;
} | null = null;

/** The published form, if it is the one for this gallery */
export function editFormFor(galleryId: string): typeof editForm {
  return editForm && editForm.galleryId === galleryId ? editForm : null;
}

/**
 * Whether this gallery is manga, as far as anything on screen is concerned.
 *
 * Once the store has an answer it *is* the answer, and a gallery missing from it
 * is one the server does not consider manga (see storedIsManga, which is where
 * the question is actually settled). That is not the same thing as the store
 * having nothing to say yet, which is the only case the values Stash passed in are
 * for — and telling the two apart is what the store being null is for. Reading a
 * missing gallery as "no answer" was wrong in a way that showed: the values come
 * out of Apollo's cache, which both of this plugin's writes leave alone on
 * purpose, so on a gallery the cache still held as marked, taking the mark off
 * left the switch saying it was still on.
 *
 * The store is otherwise the one to trust because the plugin's own writes keep it
 * in step (see `mark` and `write`) *and* it is refreshed from the server.
 * Everything that asks the question — the toolbar switch, the details panel, the
 * edit block — asks it here.
 *
 * The edit form is not consulted, which is worth spelling out: the form holds a
 * mark only when this plugin put one there, and it does that together with the
 * write, so the two agree by construction. A form the reader edited cannot hold
 * one at all — the mark has no control in that form.
 */
export function isMarkedNow(
  galleryId: string | null | undefined,
  values?: CustomFieldsMap
): boolean {
  // No id means this is not one gallery's page — the list's bulk dialog is the
  // case that matters — so there is nothing to look up and the values are all
  // there is to go on. Before the first answer, likewise.
  if (store === null || !galleryId) return NS.isManga(values);
  return storedIsManga(galleryId);
}

/**
 * Whether Stash's edit form has changes that have not been saved.
 *
 * Read out of the DOM because that is the only place it shows. The panel's own
 * Save button is disabled while there is nothing to save — GalleryEditPanel
 * renders it with `disabled={!formik.dirty || …}` — and the panel exists only
 * while its tab is open, so no button means nothing to lose.
 */
export function editFormIsDirty(): boolean {
  const save = document.querySelector(".edit-buttons-container .edit-button");
  return !!save && (save as HTMLButtonElement).disabled !== true;
}

/**
 * The mutation that marks a gallery.
 *
 * Its selection set is `id` and nothing else, which is the whole point: Apollo
 * writes what the mutation returns into the cache, so asking for no gallery
 * fields leaves the cached gallery exactly as it was — same object, same
 * custom_fields — and an edit form built from it does not reinitialise (see
 * refresh() for the same argument about the store's query).
 *
 * Stash's own `useGalleryUpdate` cannot be used here: its document asks for the
 * gallery, which is what we must not have.
 */
export const MARK_QUERY_TEXT = [
  "mutation MangaToolsSetFields($input: GalleryUpdateInput!) {",
  "  galleryUpdate(input: $input) {",
  "    id",
  "  }",
  "}",
].join("\n");

/**
 * The same, as a document — through `gql`, the way every other operation here is
 * built.
 *
 * Handing Apollo the raw text does not work: what `client.mutate` expects is a
 * `DocumentNode`, and a string that Apollo declines to parse comes back as a
 * rejected promise with nothing useful in it. The tests cannot see the
 * difference (their `gql` is a stub that answers with what it was given), which
 * is how this got as far as a release: it was written as a template string and
 * every assertion still passed.
 */
let markUpdate: unknown = null;
export function getMarkUpdate(): unknown {
  if (markUpdate) return markUpdate;

  markUpdate = gqlDoc(MARK_QUERY_TEXT, "build the mutation");
  return markUpdate;
}

/**
 * Writes fields, and leaves the page's cached gallery alone. See MARK_QUERY_TEXT.
 *
 * Rejects when there is nothing to write *with* — no document, or no client —
 * rather than resolving as though it had been sent. Both of the callers' paths
 * refresh, so the page comes out the same either way; what a rejection buys is
 * the line the caller logs, and without it this is the one failure of the pair
 * that leaves no trace at all: no request on the wire, nothing in the console,
 * and a click that looks exactly like a successful one. Apollo rejects for its
 * own reasons, so the callers already have that path — this only makes the two
 * failures this function can have take it too.
 */
export function writeQuietly(
  galleryId: string,
  fields: Record<string, unknown>
): Promise<unknown> {
  const mutation = getMarkUpdate();
  if (!mutation) {
    return Promise.reject(
      new Error("[mangaTools] no mutation document, the write was not sent")
    );
  }

  const client = stashClient();
  if (!client) {
    return Promise.reject(
      new Error("[mangaTools] no Apollo client, the write was not sent")
    );
  }

  return client.mutate({
    mutation,
    variables: { input: { id: galleryId, custom_fields: fields } },
  });
}

/**
 * Writes a gallery's chapters into this plugin's own field.
 *
 * The value arrives **already serialised**, and that is the point: the shape is the
 * reader half's — it owns the format, its version, and the tolerant parsing of it —
 * and this half's job is to put a string where the reader says. It is also what
 * keeps the dependency between the halves pointing one way; nothing here has to
 * know what a chapter is.
 *
 * The same pairing the mark uses: the store and Stash's own form are told first, so
 * what is on screen follows the click rather than a round trip that may yet fail,
 * and the refresh either confirms it or puts it right. The form copy matters *more*
 * here than it does for the mark — this key is hidden from Stash's own custom-field
 * editor (it is one of ours, see ownField), so a Save that did not know about it is
 * the one way its value could vanish with nothing on screen to notice.
 *
 * Rejects when nothing could be sent, and passes that on: the batch importer counts
 * a gallery it could not write and carries on with the rest.
 */
NS.writeChapters = (galleryId: string, json: string): Promise<void> => {
  // Only when there is an entry to update: a gallery the store has never heard of
  // is one this half is not managing, and inventing an entry for it would be the
  // store saying it is marked.
  const current = store?.get(galleryId);
  if (current) {
    store?.set(galleryId, NS.setField(current, CHAPTER_FIELD_NAME, json));
  }

  const form = editFormFor(galleryId);
  if (form) {
    form.onChange(NS.setField(form.values, CHAPTER_FIELD_NAME, json));
  }

  emit();

  return writeQuietly(galleryId, {
    partial: { [CHAPTER_FIELD_NAME]: json },
  }).then(
    () => {
      refreshAfterWrite();
    },
    (e: unknown) => {
      console.error("[mangaTools] could not write this gallery's chapters:", e);
      refreshAfterWrite();
      throw e;
    }
  );
};

/**
 * Publishes the open edit form, or clears it with null.
 *
 * A setter rather than the binding itself, because the binding is read here and
 * written one module away: Stash's edit form is the only place a mark can be set on
 * a gallery that is not manga yet, so the CustomFieldsInput patch is what fills it,
 * and an imported binding cannot be assigned. Cleared when the form goes, so nothing
 * writes into a form that is no longer there.
 */
export function setEditForm(form: typeof editForm): void {
  editForm = form;
}
