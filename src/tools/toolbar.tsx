/**
 * The manga switch in the gallery detail page's toolbar.
 *
 * The one control this plugin puts in the toolbar: a button that marks the gallery
 * as manga, drawn directly after Stash's organized button. What it shows is read
 * from this plugin's store rather than from the values Stash handed in — see
 * isMarkedNow — because the write below is deliberately invisible to the Apollo
 * cache those values come from, which makes them the last to know.
 *
 * Both directions write through this plugin's own mutation (writeQuietly) rather
 * than through Stash's, and that is not tidiness: sending custom_fields through
 * Stash's own update changes the cache, which reinitialises its edit form and
 * throws away whatever the reader has typed but not saved. Marking writes the
 * mark. Unmarking removes the mark *and* this plugin's other fields, behind a
 * question, because a gallery the plugin no longer manages should not be left
 * carrying half of its data.
 *
 * `CAN_WRITE` is read in this module's body, so it is evaluated while the bundle
 * loads — hence the defensive read and the log line rather than a throw: this half
 * shares a bundle with the reader's, which must not be taken down by anything that
 * happens here.
 *
 * The confirmation is here rather than in a module of its own: the shell has
 * exactly one user (ConfirmUnmark), and ConfirmUnmark exactly one asker (the
 * switch below).
 *
 * The mount point is with the other three in hosts.ts — see ensureToolbarHost —
 * and the patch that renders this is the CustomFields one in index.tsx: the one
 * patchable component on that page with the gallery's custom fields in hand, which
 * is what the two writes below need. That patch reads `CAN_WRITE` from here rather
 * than this module deciding for itself, so a Stash without a client does not even
 * build the switch.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import {
  MANGA_FIELD_NAME,
  emit,
  refreshAfterWrite,
  store,
  useGlobalVersion,
} from "./core";
import type { CustomFieldsMap } from "./core";
import {
  editFormFor,
  editFormIsDirty,
  isMarkedNow,
  writeQuietly,
} from "./mark";
import { MangaIcon } from "./icons";
import { ensureToolbarHost, useAfterMount } from "./hosts";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. React.useState below reads
// it explicitly, so the linter would keep this name either way — but that is not
// what the JSX here depends on.
const React = PluginApi.React;

/**
 * Whether this Stash has the client the switch writes through.
 *
 * Both of the switch’s writes go through this plugin’s own mutation, so the
 * client is all it needs. Stash injects StashService itself (it is a namespace
 * import of `src/core/StashService`), so a version without `getClient` is the
 * only way the lookup fails, and on such a version the toolbar gets nothing
 * rather than a switch that cannot work.
 *
 * Read defensively, with a Stash that has no API at all in mind: this line is in
 * the module body, so it is evaluated while the bundle loads, and this half
 * shares a bundle with the reader's — which must not be taken down by anything
 * that happens here.
 */
export const CAN_WRITE =
  typeof PluginApi.utils?.StashService?.getClient === "function";

if (!CAN_WRITE) {
  console.error(
    "[mangaTools] this Stash has no Apollo client, so the toolbar switch " +
      "cannot be shown. The rest of the plugin is unaffected."
  );
}

/**
 * A question, in a modal.
 *
 * Stash's own Bootstrap, so it looks like the rest of the page. One question is
 * asked through it — taking the manga mark off — and this comment claimed two for
 * a long time: the reader half's "import this library's chapters over the list you
 * have" is asked and drawn in the reader half (chapters-tab.ts), and never came
 * through here.
 */
export function ConfirmDialog(props: {
  children: unknown;
  confirmLabel: string;
  cancelLabel: string;
  variant: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Modal = Bootstrap?.Modal;
  const Button = Bootstrap?.Button;
  if (!Modal || !Button || !Modal.Body || !Modal.Footer) return null;

  return (
    <Modal show size="sm" onHide={props.onCancel}>
      <Modal.Body>{props.children}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
        <Button variant={props.variant} onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * Asks before a gallery stops being manga.
 *
 * Because unmarking is not a flag coming off: the plugin's fields go with it — a
 * gallery the plugin does not manage should not be left carrying half its data
 * (see the note on the toggle). That is worth a question, and Stash's own modal is
 * the way to ask it — the plugin has Bootstrap already.
 *
 * A modal rather than a second click on the switch: the switch has two states and
 * a two-step click would need a third, which is exactly the kind of state naming
 * this plugin went to some trouble to avoid.
 */
export function ConfirmUnmark(props: {
  onCancel: () => void;
  onConfirm: () => void;
  /** Whether the edit form is holding unsaved changes the write will reset */
  resetsForm: boolean;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();

  return (
    <ConfirmDialog
      variant="danger"
      confirmLabel={t(intl, "mangaTools.manga.confirmOk")}
      cancelLabel={t(intl, "mangaTools.manga.confirmCancel")}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    >
      <div>{t(intl, "mangaTools.manga.confirm")}</div>
      {/* Taking the mark off removes the language and the censorship with it,
          which the details panel draws — so the cache has to follow, and Stash's
          edit form reinitialises itself when it does. Marking is the other way
          round and is written quietly, so this only ever applies here. */}
      {props.resetsForm ? (
        <div>{t(intl, "mangaTools.manga.confirmResetsForm")}</div>
      ) : null}
    </ConfirmDialog>
  );
}

export function GalleryToolbar(props: {
  galleryId: string;
  values: CustomFieldsMap;
}) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const busyState = React.useState(false);
  const busy = busyState[0];
  const setBusy = busyState[1];
  const confirmState = React.useState(false);
  const confirming = confirmState[0];
  const setConfirming = confirmState[1];

  const host = ensureToolbarHost();
  if (!host) return null;

  // What the switch says comes from isMarkedNow: this plugin's store once it has
  // answered, and the values Stash handed in only before that — the write is
  // deliberately invisible to the Apollo cache those values come from, so they are
  // the last to know.
  //
  // The edit form is not consulted for the mark. It holds one only when this
  // plugin put it there, and it does that together with the write, so there is
  // nothing it could add. It *is* what a click writes through, though — see the
  // two write paths below, which look it up when the click happens rather than
  // capturing whatever was published on this render.
  const marked = isMarkedNow(props.galleryId, props.values);

  /**
   * Takes the mark off, and this plugin's fields with it.
   *
   * Semantically the gallery is no longer the plugin's: leaving `language` and
   * `censorship` behind would be leaving data that nothing displays and nothing
   * explains. Every key is removed by the spelling it actually has, so a key that
   * drifted in case goes too.
   *
   * (A setting for this — clear on unmark, or keep — is the obvious next thing;
   * for now clearing unconditionally, behind the question above, is the honest
   * default: the alternative silently keeps data the reader cannot see.)
   */
  const write = (fields: Record<string, unknown>) => {
    // Taking the mark off takes this plugin's fields with it, so the gallery
    // stops being one of its own: out of the store now, not after the round trip.
    // Everything drawn from it — the badge, the details panel, the switch — goes
    // with it. The panels are gated on the store rather than on Stash's values
    // (see isMarkedNow), which is what makes it safe to write this quietly: the
    // cache goes on holding fields that nothing on screen asks it for.
    store?.delete(props.galleryId);

    // Looked up now rather than captured on the render that drew the switch: the
    // click is what the form has to agree with, and the published form can have
    // changed since (the edit tab opening or closing).
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form's copy loses them too, and this is not symmetry for its own sake:
      // the map a Save sends back is the *whole* of the custom fields, so a form
      // still holding the mark puts it back the next time it is saved — and the
      // cache cannot be relied on to correct it, because this write does not
      // touch the cache at all.
      // The same fields, by the same spellings, as the `remove:` list the server
      // is given — NS.clearFields is the pair to fieldsToClear for that reason.
      form.onChange(NS.clearFields(form.values));
    }

    emit();

    setBusy(true);
    // Quiet, like the mark: through this plugin's own mutation rather than
    // Stash's, because changing the gallery's custom_fields in the cache is
    // exactly what reinitialises the edit form and throws away whatever the
    // reader has typed but not saved.
    writeQuietly(props.galleryId, fields).then(
      () => {
        setBusy(false);
        setConfirming(false);
        // The store is put right by the refresh, which drops a gallery the server
        // no longer answers with. Deferred, or a fetch built before the write
        // would land after it and put the gallery back.
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        setConfirming(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The store has been emptied and the page has been told, but the server
        // never heard: ask it what the truth is, exactly as marking does. Without
        // this the gallery stays missing from the map — so unmarked on screen —
        // until the next poll or navigation, while the server still holds it.
        refreshAfterWrite();
      }
    );
  };

  const onToggle = () => {
    if (!marked) {
      mark();
      return;
    }

    // Asked about, or done: the switch says which, and taking a mark off is the one
    // thing this plugin does that a reader might have meant to think about first.
    if (!NS.confirmUnmark) {
      onConfirmUnmark();
      return;
    }

    setConfirming(true);
  };

  /**
   * Marks the gallery: on the server, and in the edit form if it is open.
   *
   * Both, because each covers something the other cannot. The server write is
   * what the plugin's own store reads, so the switch, the card badges and the
   * bulk rows all follow. The form write is what keeps the form's copy of the
   * map — the one its Save sends back in full — from being a version without the
   * mark, which is what would silently drop it (see editForm).
   *
   * Nothing here reinitialises that form: the write is the quiet one, and the
   * form is told directly rather than through the cache. That is the whole reason
   * marking is safe to do with unsaved typing sitting in it, where taking the
   * mark off is not.
   */
  const mark = () => {
    // The two copies are each built on their own: the form's map is the reader's,
    // with whatever they have typed into it, and replacing it with the store's
    // would throw that away — which is the failure this whole change is about.
    //
    // Read at click time, not on the render that drew the switch, so the form
    // written to is the one on screen now.
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form gets the mark because the map its Save sends back is the *whole*
      // of it (`custom_fields: { full: … }`): a form that did not know about the
      // mark would drop it on the next save.
      form.onChange(NS.setField(form.values, MANGA_FIELD_NAME, NS.MANGA_VALUE));
    }

    // Marked here and now, so the switch, the details panel and the edit block —
    // all of which ask isMarkedNow — follow the click rather than waiting for a
    // server round trip that may yet fail. The write below either confirms this or,
    // on failure, is put right by the refresh that follows it.
    store?.set(
      props.galleryId,
      NS.setField(
        store?.get(props.galleryId) ?? props.values,
        MANGA_FIELD_NAME,
        NS.MANGA_VALUE
      )
    );

    emit();

    setBusy(true);
    writeQuietly(props.galleryId, {
      partial: { [MANGA_FIELD_NAME]: NS.MANGA_VALUE },
    }).then(
      () => {
        setBusy(false);
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The server never heard about it, so what is on screen is wrong: ask the
        // server what the truth is. Deferred like the other one, for the same
        // reason — a fetch started before this click would answer with the state
        // before it.
        refreshAfterWrite();
      }
    );
  };

  const onConfirmUnmark = () => {
    write({ remove: NS.fieldsToClear(props.values) });
  };

  return PluginApi.ReactDOM.createPortal(
    <>
      <button
        type="button"
        className={
          "minimal manga-tools-manga-toggle btn btn-secondary" +
          (marked ? " is-manga" : "")
        }
        title={t(
          intl,
          marked ? "mangaTools.manga.marked" : "mangaTools.manga.mark"
        )}
        aria-pressed={marked}
        disabled={busy}
        onClick={onToggle}
      >
        <MangaIcon />
      </button>
      {confirming ? (
        <ConfirmUnmark
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirmUnmark}
          /* Read here, as the question is drawn: a value captured on the render
             that drew the switch can be stale by the time it is shown. */
          resetsForm={editFormIsDirty()}
        />
      ) : null}
    </>,
    host
  );
}
