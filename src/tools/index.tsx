/**
 * Manga Tools — a toolbox that adapts Stash galleries to manga/comic management.
 *
 * Everything goes through the UI plugin API; no Stash core code is modified, so
 * Stash upgrades never produce merge conflicts.
 *
 * The language attribute lives in one of the Gallery's custom fields,
 * `plugin.mangaTools.language`. What is stored is the canonical code, not the
 * display name, and the name is looked up only when rendering — the same
 * approach Stash takes for performer nationality. It surfaces in five places:
 *
 *   - a flag badge on the bottom of the gallery card cover
 *   - a dropdown on the gallery edit page, so you never type a code by hand
 *   - the same dropdown in the bulk edit dialog, gated by the manga mark and
 *     riding along with Apply
 *   - a collapsible block in the details tab, where the raw code would be — the
 *     language as its flag and localised name, the censorship mark beside it
 *   - a filter section in the gallery list's sidebar (sidebar-filter.tsx),
 *     which narrows the list to one language
 *
 * A second attribute, the censorship mark, works the same way and lives in
 * `plugin.mangaTools.censorship`. It is a two-valued field rather than a boolean:
 * "not marked" is the absence of the key, which is what the selector's own clear
 * button produces. It surfaces in three places:
 *
 *   - a selector on the gallery edit page, beside the language one
 *   - a row in the details tab's block, as icon and word
 *   - a selector in the bulk edit dialog, gated the same way
 *
 * A third field decides whether any of it applies. A gallery carrying
 * `plugin.mangaTools.manga` is manga; one that does not is an ordinary Stash
 * gallery, and the only thing of this plugin's on it is the switch that sets the
 * mark. Everything above is drawn only on the first kind — and the card carries
 * that same mark's icon at the end of its popover row, which is what says which
 * kind a card is without opening anything.
 *
 * `languages.ts` holds the codes and their flags, `censorship.tsx` the
 * censorship vocabulary and its icons, `fields.ts` the field names and the
 * generic read/write helpers, and `core.ts` the state every other module reads —
 * the store, the fetch and the poll behind it, the settings, and the
 * subscription a surface redraws off. Filtering is spread across four modules —
 * `filter-model.ts` the criterion read/write logic, `filter-ui.tsx` the rows
 * both surfaces share, `sidebar-filter.tsx` the five sidebar sections, and
 * `dialog-filter.tsx` the dialog's language card. `fields-ui.tsx` and `icons.tsx`
 * hold the small pieces more than one surface draws, and the settings page is a
 * module of its own, mounted by a patch here. What is left below draws the rest.
 *
 * New features should keep the same shape: patches that hand anything they do
 * not own straight back to the original component, shared data in a module
 * rather than on the window, and a surface that reaches down to `core.ts`
 * rather than sideways into another surface.
 *
 * The plugin is one bundled file. The modules imported below are inlined into
 * it, so Stash loads exactly the one file ui.javascript names in mangaTools.yml
 * and there is no load order left to get wrong.
 */
import "./fields";
import { CensorshipIcon } from "./censorship";
import { NS } from "../languages";
import { t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import { DialogLanguageFilter } from "./dialog-filter";
import { fieldLabel, registerLanguageCriterionOption } from "./filter-model";
import {
  SidebarCensorshipFilter,
  SidebarLanguageFilter,
  SidebarMangaFilter,
  SidebarOriginalFilter,
  SidebarTranslationGroupFilter,
  currentSidebarFilter,
  publishSidebarFilter,
} from "./sidebar-filter";
import type { ReactNode } from "react";
import type { MangaToolsFilterModel } from "../plugin-api";
import {
  MANGA_FIELD_NAME,
  PLUGIN_ID,
  censorshipOf,
  currentGalleryId,
  currentPath,
  emit,
  isGalleryContext,
  locationListener,
  pathNow,
  pickLanguage,
  refreshAfterWrite,
  start,
  started,
  storedIsManga,
  store,
  useGlobalVersion,
} from "./core";
import type { CustomFieldsMap } from "./core";
import { Flag, languageChip } from "./fields-ui";
import { MangaIcon } from "./icons";
import { MangaToolsSettings } from "./settings-page";
import { bulkAnchor, ensureDetailHost, fieldHosts } from "./hosts";
import { MangaFieldBlock } from "./edit-page";
import { noteFired, registerPatch } from "./patches";
import { BulkFieldsRow, bulkRenders, captureSelection } from "./bulk";
import {
  editFormFor,
  editFormIsDirty,
  isMarkedNow,
  setEditForm,
  writeQuietly,
} from "./mark";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/**
 * Pulls the original component out of a patch.instead callback's arguments.
 *
 * The official example writes `(props, _, original)`, but the number of
 * arguments passed depends on whether React supplies the legacy context, so a
 * hard-coded index can come back undefined. The last argument is always the
 * original component — reading it that way is safe either way.
 */
// biome-ignore lint/suspicious/noExplicitAny: the component a patch is handed // has no nameable type — its props differ per target, and it is used as JSX.
function originalFrom(args: unknown[]): any {
  return args[args.length - 1];
}

/**
 * Pulls the rendered result out of a patch.after callback's arguments.
 *
 * `after` is the one patch kind whose last argument is not a component: Stash
 * appends what everything before it produced — the original component's output,
 * or an `instead` function's — and the callback returns what should be rendered
 * in its place. Two accessors rather than one index for that reason: they look
 * interchangeable and are not, and mixing them up yields a component rendered as
 * a child rather than a crash.
 */
function resultFrom(args: unknown[]): ReactNode {
  return args[args.length - 1] as ReactNode;
}

/**
 * The filter model out of a rendered element tree, or null if it is not there.
 *
 * Whatever Stash hands the model to carries it as a `filter` prop, and a list
 * page has exactly one model, so the first one found is it. The shape is checked
 * rather than trusted: `filter` is a common enough prop name that a tree could
 * hold something else by it, and handing that to the sidebar's sections would
 * fail in a way that says nothing about the cause.
 */
function findFilter(node: ReactNode): MangaToolsFilterModel | null {
  if (node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFilter(child);
      if (found) return found;
    }
    return null;
  }

  const props = (node as { props?: { children?: ReactNode; filter?: unknown } })
    .props;
  if (!props) return null;
  if (Array.isArray(props.filter)) return null;
  const filter = props.filter as MangaToolsFilterModel | undefined;
  if (filter && Array.isArray(filter.criteria)) return filter;

  return findFilter(props.children);
}

/** Whether this Stash has the sidebar patch container the sections mount through */
function hasSidebarSectionsContainer(): boolean {
  const components = PluginApi.components as { [name: string]: unknown };
  return !!components && !!components["FilteredGalleryList.SidebarSections"];
}

/** Whether the missing-sidebar-container error has been logged already */
let warnedMissingSidebarContainer = false;

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
function LanguageBadge(props: { galleryId: string }) {
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
 * Forces one more render once a component has mounted.
 *
 * Every mount point below is found by looking in the document, and the first
 * render of a page happens *before* React has committed any of it: a lookup at
 * that point sees the previous page's markup, which on a load is nothing at all.
 * Effects flush after the commit, so the extra render this asks for is the first
 * one that can see the toolbar. One bump and not a loop: the dependency list is
 * empty, so the effect never runs twice.
 *
 * A layout effect rather than a plain one, for the reason the other mount points
 * give: it runs after React has written the DOM but before the browser paints,
 * which is the only window in which the second render is invisible. A plain
 * effect would leave the button missing for a frame.
 *
 * The tests' React stub runs the callback immediately and its state setter is
 * inert, so under the stub this is a no-op — which is sound, because a test
 * builds the DOM it wants found *before* calling the component.
 */
function useAfterMount(): void {
  const bump = React.useState(0)[1];
  React.useLayoutEffect(() => {
    bump(1);
  }, []);
}

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
function MangaPopoverMark(props: { galleryId: string }) {
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

// ────────────────────────── Gallery toolbar ──────────────────────────

/** Class of the mount point in the gallery toolbar */
const TOOLBAR_HOST_CLASS = "manga-tools-toolbar-host";

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
const CAN_WRITE =
  typeof PluginApi.utils?.StashService?.getClient === "function";

if (!CAN_WRITE) {
  console.error(
    "[mangaTools] this Stash has no Apollo client, so the toolbar switch " +
      "cannot be shown. The rest of the plugin is unaffected."
  );
}

/** As with the other mount points, held at module scope so a re-render reuses
 *  the same node rather than making a new one every time. */
let toolbarHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point in the gallery detail page's
 * toolbar, directly after the span holding Stash's organized button.
 *
 * Why the DOM at all: the toolbar is rendered by `Gallery`, which is not a
 * registered component, so there is no patch to hang a React child off — the
 * same situation as the detail row (see ensureDetailHost).
 *
 * Why that button and not the group's two spans by position: the second span is
 * the operation menu, whose contents depend on the entity and on the user's
 * settings. The organized button is drawn for every gallery, on every version,
 * in a group of its own, which makes it the one stable handle in there.
 *
 * Scoped to `.gallery-toolbar`, so the bulk edit dialog's organized button —
 * same class, different place — is never mistaken for it.
 */
function ensureToolbarHost(): HTMLElement | null {
  const button = document.querySelector(".gallery-toolbar .organized-button");

  // The button is not always there, and its absence is not the toolbar's: Stash
  // renders a spinner in its place while its own save runs (OrganizedButton has a
  // `loading` branch), which is exactly what clicking organized does. Treating
  // that as "no toolbar" took this plugin's switch off the page — the reader saw
  // it vanish under their own cursor and stay gone until the next refresh.
  // Nothing about the button's absence says anything about the host.
  if (!button) return toolbarHost;

  const anchor = (button?.parentNode || null) as HTMLElement | null;
  if (!anchor?.parentNode) {
    toolbarHost = null;
    return null;
  }

  if (!toolbarHost) {
    toolbarHost = document.createElement("span");
    toolbarHost.className = TOOLBAR_HOST_CLASS;
  }

  // A React re-render may displace it; keep it directly after that span, which
  // puts it between the organized button and the operation menu.
  if (anchor.nextElementSibling !== toolbarHost) {
    anchor.parentNode.insertBefore(toolbarHost, anchor.nextElementSibling);
  }

  return toolbarHost;
}

/**
 * A question, in a modal.
 *
 * The shell both of this plugin's confirmations use — taking the manga mark off,
 * and importing a library's chapters over the lists this plugin already has. Stash's
 * own Bootstrap, so it looks like the rest of the page; the two differ only in what
 * they say and in which of them is the dangerous answer.
 */
function ConfirmDialog(props: {
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
function ConfirmUnmark(props: {
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

function GalleryToolbar(props: { galleryId: string; values: CustomFieldsMap }) {
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

// ─────────────────────────── Bulk edit dialog ───────────────────────────

// ─────────────────────────── The manga panel ───────────────────────────
//
// The gallery's manga attributes, as a collapsible block in the details tab.
// A disclosure rather than a tab this plugin injects into Stash's tab bar: it
// owns its own open state and nothing else's, which is the entire difference —
// a tab would have to agree with react-bootstrap about which tab is active, and
// that is what made the first attempt at this too fragile to keep.
//

/**
 * Renders nothing rather than taking the page with it, and says so.
 *
 * For the block this plugin adds to the details tab, so that a mistake in it
 * costs one section rather than the whole page: React 17 answers a throw inside a
 * render by unmounting the tree, which is what left the app sitting on "Loading"
 * while this was being built. A boundary turns that into a log line naming the
 * block.
 *
 * Built on first use rather than where it is written, and that is about the
 * bundle rather than about React. A class body is evaluated where it stands, so
 * `extends React.Component` resolves the API *while the file loads* — and this
 * half shares a bundle with the reader's, whose half must not be taken down by
 * anything that happens during this one's load. Inside a render, a throw costs
 * one block; at load it costs both halves.
 */
type GuardedBlockProps = { name: string; children?: ReactNode };
type GuardedBlockState = { failed: boolean };

let guardedBlockClass: React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> | null = null;

/** The error boundary, made once and reused. Call it from inside a render. */
function guardedBlock(): React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> {
  if (guardedBlockClass) return guardedBlockClass;

  guardedBlockClass = class extends (
    React.Component<GuardedBlockProps, GuardedBlockState>
  ) {
    state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error: unknown) {
      console.error(
        "[mangaTools] the " +
          this.props.name +
          " threw while rendering, so it is " +
          "not on the page. Everything else the plugin does is unaffected.",
        error
      );
    }

    render() {
      return this.state.failed ? null : this.props.children;
    }
  };

  return guardedBlockClass;
}

/**
 * The gallery's manga attributes, as labelled rows.
 *
 * A row is drawn only when its value is set — an unset one is simply absent,
 * the same way the rest of the plugin keeps an unset value quiet. With no value
 * at all the whole panel is dropped, since a fold whose only content is its own
 * heading is not worth a line.
 */
function MangaDetailsPanel(props: { values: CustomFieldsMap }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const state = React.useState(NS.openDetailsBlock);
  const open = state[0];
  const setOpen = state[1];

  // Each value is read only if its field is drawn, so a field that is off cannot
  // reach the panel through the back door — a row whose value happens to be set on
  // the gallery is exactly what "turned off" has to hide. What it does not do is
  // touch the gallery: the values stay where they are, and turning the field back
  // on brings them back.
  const language = NS.fieldShowing("language")
    ? NS.describe(pickLanguage(props.values), intl.locale)
    : null;
  const mark = NS.fieldShowing("censorship") ? censorshipOf(props.values) : "";
  const group = NS.fieldShowing("translationGroup")
    ? NS.translationGroupOf(props.values)
    : "";
  const original = NS.fieldShowing("original") && NS.isOriginal(props.values);
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;
  const Collapse = PluginApi.libraries.Bootstrap?.Collapse;

  // Nothing set means nothing to say: with none of the four set the whole panel
  // is dropped, rather than left as an empty fold with only its heading. The same
  // test answers "are there any fields at all": with every one of them turned off
  // none of the four can be set, so the panel drops without a second question.
  if (!language && !mark && !group && !original) return null;

  // The same mount point the plain language row used: the end of .gallery-details,
  // which lands after "photographer" and before "details".
  const host = ensureDetailHost();
  if (!host) return null;

  // The flag and the space before the name are conditional, and both for the same
  // reason: an unknown value has no flag, and a row that always put a space there
  // would read "Language:  klingon".
  const showFlag = NS.showFlags && !!language?.flag;

  // Two <h6>s, exactly as the rows above and below are drawn — the pieces are
  // separate children rather than a label and a value in a wrapper, so the text
  // nodes come out the way Stash's own rows produce them. Each is drawn only
  // when its value is set.
  //
  // The censorship row comes first, then the language, then the group: the
  // censorship is about the copy in hand — what was or was not done to the scans —
  // and the other two are about where the text came from. The raw mark is not a
  // row at all: it rides on the language, when there is one.
  const body = (
    <div className="manga-tools-panel-body">
      {mark ? (
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.censorship.heading") + ": "}
          <CensorshipIcon value={mark} />
          {mark ? " " : null}
          {NS.censorshipLabel(intl, mark)}
        </h6>
      ) : null}
      {language ? (
        <h6 className="manga-tools-detail">
          {fieldLabel(intl) + ": "}
          {showFlag ? (
            <Flag flag={language.flag as string} className="manga-tools-flag" />
          ) : null}
          {showFlag ? " " : null}
          {language.name}
          {/*
            The raw mark rides on this row rather than having one of its own. It
            answers a question about the language — the text is in it, untranslated
            — and as a row of its own under the *group's* label it read like a group
            called "raw", which is the reading this field exists to avoid.

            The space in front of it is part of the string, not a text node of its
            own like the flag's: English wants one before a bracket and Chinese
            takes none, so the catalog is where that difference belongs.
          */}
          {original
            ? t(intl, "mangaTools.translationGroup.originalInline")
            : null}
        </h6>
      ) : null}
      {group ? (
        // No icon and no flag: a group's name is its own, and there is nothing
        // here to draw beside it. Drawn last, because it is the one row that is
        // the same shape on every gallery rather than picked from a list.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.heading") + ": "}
          {group}
        </h6>
      ) : null}
      {original && !language ? (
        // Raw with no language row to carry the mark, so it stands on its own —
        // and without the group's label, for the reason above. The wording carries
        // the rest: a bare "原文" under that label would read like a group called
        // that, which is why the string says what it does.
        //
        // "No language row" rather than "no language set": with the language field
        // turned off there is no row to ride on whatever the gallery holds, and a
        // raw mark with no way of being shown is worse than one shown plainly.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.originalDetail")}
        </h6>
      ) : null}
    </div>
  );

  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      {/*
        Stash's own collapsible section, reproduced rather than invented: the
        classes are `components/Shared/CollapseButton.tsx`'s, and its stylesheet is
        what makes this look like the rest of the page. `minimal` is the class
        that gives a button the page's text colour — without it a bare <button>
        keeps the browser's own, which is black whatever the theme.
      */}
      <div className="collapse-header">
        {Button ? (
          <Button
            className="minimal collapse-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              icon={open ? Solid.faChevronDown : Solid.faChevronRight}
              fixedWidth
            />
            <span>{t(intl, "mangaTools.panel.heading")}</span>
          </Button>
        ) : null}
      </div>

      {/* With no Bootstrap at all the body simply shows — degraded, not hidden. */}
      {Collapse ? <Collapse in={open}>{body}</Collapse> : body}
    </div>,
    host
  );
}

// ───────────────────────────── Patch registration ─────────────────────────────

// 1. The badge on the bottom of the gallery card cover.
//
//    `after`, not `instead`: nothing about Stash's own output is being changed,
//    only added to. That is what lets the original component be left alone —
//    GalleryCard.Overlays uses useMemo internally, so calling it directly (as the
//    official example does) is exactly the thing not to do, and `after` never
//    calls it at all.
registerPatch("after", "GalleryCard.Overlays", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Overlays");

  const id = props.gallery?.id;
  const value = id ? pickLanguage(store?.get(String(id))) : "";

  // Nothing to add: the gallery has no language, or the badge is turned off, or
  // the language field itself is. Asked here rather than inside the badge for the
  // reason every guard on this half is asked as early as it can be: a component
  // that is not rendered cannot draw anything by accident.
  if (!value || !NS.showCoverBadge || !NS.fieldShowing("language"))
    return result;

  return (
    <>
      {result}
      <LanguageBadge galleryId={id as string} />
    </>
  );
});

// 1b. The manga icon at the end of the same card's popover row.
//
//     Deliberately not another cover badge: the language badge is a flag, which
//     reads at a glance, while "this is one the plugin manages" is not a value you
//     scan for. The popover row is where Stash already puts this kind of thing
//     (organized, and the two counts), and it costs nothing on the many cards that
//     are not manga, which is most of them.
//
//     The gate is the store rather than a value: on a card there is nothing else to
//     ask, and the store holds exactly the galleries the query found — which, since
//     the query asks for the mark, is the same set as "is manga".
registerPatch("after", "GalleryCard.Popovers", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Popovers");

  const id = props.gallery?.id;
  if (!id || !storedIsManga(String(id))) return result;

  return (
    <>
      {result}
      <MangaPopoverMark galleryId={String(id)} />
    </>
  );
});

// 2. Edit page: render the language field (it portals itself after the studio
//    row, so it contributes nothing at this position).
registerPatch("instead", "CustomFieldsInput", (...args: unknown[]) => {
  const props = args[0] as {
    values?: CustomFieldsMap;
    onChange?: (values: CustomFieldsMap) => void;
  };
  const Original = originalFrom(args);
  noteFired("CustomFieldsInput");

  // Subscribed for the same reason as the details panel above: whether the edit
  // block is drawn is asked from the store now, and a mark made from the toolbar
  // changes that without touching anything Stash would re-render this for.
  useGlobalVersion();

  // This component *is* the gallery's edit form's custom-fields section: it is
  // rendered for every gallery, whether or not this plugin has marked it, and it
  // is handed both the form's map and the setter for it. Published for the
  // toolbar switch, which marks through the form as well as through the server —
  // publishing it from the edit block instead would cover only galleries that are
  // already manga, and marking a gallery that is not is exactly the case this is
  // for. Cleared when the form goes, so nothing writes into one that is not there.
  React.useEffect(() => {
    const galleryId = currentGalleryId();
    if (props.onChange && galleryId) {
      setEditForm({
        galleryId,
        values: props.values ?? {},
        onChange: props.onChange,
      });
    }
    return () => {
      setEditForm(null);
    };
  });

  return (
    <>
      {/* Only on a gallery that is manga. An unmarked gallery's edit form is
          Stash's own, unchanged — the plugin is not there at all. */}
      {isMarkedNow(currentGalleryId(), props.values) ? (
        <MangaFieldBlock values={props.values} onChange={props.onChange} />
      ) : null}
      <Original {...props} />
    </>
  );
});

// 3. Edit page: stop rendering the input row of every field this plugin owns —
//    they are all handled above now. Every other field goes straight back to the
//    original component, so the plugin has zero effect on them.
//
//    isNew must pass through: that is the "new field" row, and the user may be
//    in the middle of typing a name that will turn out to be ours. Returning null
//    would make the whole row vanish mid-keystroke.
//
//    All three, not just the language: this patch is what stops a raw
//    `plugin.mangaTools.censorship` row appearing in the form, and it went
//    unnoticed that it only ever checked for the language one until the other two
//    fields existed.
/**
 * Whether this plugin takes over the row Stash would draw for one of its own keys.
 *
 * The two patches below are the two halves of one answer, which is why this is one function
 * rather than a condition written twice: the edit form *swallows* each of this plugin's rows,
 * and the details page *lifts* each of its keys out of the custom fields it hands to Stash.
 * Both of them are ways of taking the row over, and both have to give it up together or the
 * page says two different things about the same field.
 *
 * Taken over for every key this plugin recognises — unless the reader has asked for disabled
 * fields to be left to Stash (`showDisabledFields` in plugin-api.ts), in which case the row is
 * given back for a field that is off. A field that is *on* is always this plugin's: it draws a
 * nicer row than Stash's, whose label is the field's name.
 *
 * And the chapters key is never given back, whatever the reader has asked for: its value is
 * JSON, and the row Stash would draw for it is a blob in the edit form. See ownField in
 * fields.ts, where that key is recognised for exactly this reason — so that it cannot be left
 * behind in Stash's own rows.
 */
function takesOverFieldRow(key: unknown): boolean {
  if (!NS.ownField(key)) return false;

  // The chapters key is the one of ours with no name — see fieldNameOf — and it is never given
  // back: its value is JSON, and the row Stash would draw for it is a blob in the edit form.
  const name = NS.fieldNameOf(key);
  if (!name) return true;

  return !NS.showDisabledFields || NS.fieldShowing(name);
}

registerPatch("instead", "CustomFieldInput", (...args: unknown[]) => {
  const props = args[0] as { field?: string; isNew?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFieldInput");

  // `isNew` passes through whatever this says: that is the "new field" row, and the reader may
  // be in the middle of typing a name that will turn out to be one of ours.
  if (!props.isNew && takesOverFieldRow(props.field)) {
    return null;
  }

  return <Original {...props} />;
});

/**
 * What this half makes of the page it is on, for a console.
 *
 * `MangaTools.diag()` — nothing in the plugin reads it. It exists because this
 * file keeps meeting the same shape of failure: a row that should be on the page
 * is not, and the console says nothing at all, because the two things that decide
 * it — a patch onto a component name Stash may not have, and a guard reading a
 * route the plugin may never have learned — are both silent by construction.
 * `noteFired` covers the first. This covers the rest, by reporting the inputs
 * those guards read rather than the conclusion they reached:
 *
 *   url / path          the browser's path, the path checks' answer, and the last
 *                       one Stash announced. A disagreement here is the whole of
 *                       one entire class of bug (see pathNow)
 *   locationListener    whether the plugin hears about navigation at all
 *   bulkRenders         whether the bulk rows ever ran — 0 with a dialog open means
 *                       the RatingSystem patch did not fire, not that a guard said no
 *   bulkAnchor / hosts  where the rows would go, and whether that mount point is
 *                       actually on the page ("detached" is a node React has
 *                       dropped out of the document while the plugin still portals
 *                       into it)
 */
NS.diag = () => ({
  url: window.location.pathname || "",
  path: pathNow(),
  rememberedPath: currentPath,
  galleryContext: isGalleryContext(),
  galleryId: currentGalleryId(),
  started,
  locationListener,
  eventApi: !!PluginApi.Event?.addEventListener,
  bulkRenders,
  bulkAnchor: !!bulkAnchor(),
  hosts: Object.keys(fieldHosts).map((key): [string, string] => [
    key,
    fieldHosts[key]
      ? fieldHosts[key]?.parentNode
        ? "attached"
        : "detached"
      : "none",
  ]),
});

// 4. Detail page: show the language as "flag + localised name", positioned
//    under "photographer", and hang the censorship button off the toolbar.
//
//    Note the target is CustomFields (plural, the container), not CustomField —
//    the latter is a plain React.FC with no PatchComponent wrapper, so patching
//    it reports no error and simply never runs.
//
//    Both of this plugin's fields are lifted out of `values`, so Stash does not
//    also draw them as raw custom-field rows; everything else is handed to the
//    original untouched. The panel portals itself under "photographer" and
//    draws the language entry there, and the censorship button portals itself
//    into the toolbar —
//    which is why this component is where it is rendered from. It is the one
//    patchable component on this page that has the gallery's custom fields in
//    hand, and the toolbar's own component is not patchable at all.
//
//    The button does not depend on those fields being there, only on this being
//    a gallery: `CustomFields` is rendered by the gallery detail panel whatever
//    a gallery carries, including nothing.
registerPatch("instead", "CustomFields", (...args: unknown[]) => {
  const props = args[0] as { values?: CustomFieldsMap; fullWidth?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFields");

  // Subscribed, because what this renders depends on this plugin's own state:
  // whether the gallery is marked, which is now answered from the store rather
  // than from the values Stash passed in (see isMarkedNow). Without this, marking
  // a gallery on this very page would not draw the panel — nothing here would
  // re-render, since the write deliberately leaves Apollo's cache alone.
  useGlobalVersion();

  const values = props.values;
  if (!values || typeof values !== "object") return <Original {...props} />;

  const rest = Object.assign({}, values) as CustomFieldsMap;
  let lifted = false;

  Object.keys(values).forEach((k) => {
    // A key that is *not* taken over stays in `rest`, and Stash draws its own row for it —
    // with the value untouched, which is the whole of what "given back" means here.
    if (!takesOverFieldRow(k)) return;
    lifted = true;
    delete rest[k];
  });

  // Empty on every entity's page but a gallery's, which is what keeps the
  // button off a scene's or a performer's detail page.
  const galleryId = currentGalleryId();

  // Made here rather than at module scope, for the reason on guardedBlock: one
  // class, made once, so the block below is not remounted on every render.
  const Guard = guardedBlock();

  // Nothing to lift out and no toolbar to put a button in: hand the original
  // component its own props object back, unwrapped. This is the common case on
  // every non-gallery entity.
  if (!lifted && !galleryId) return <Original {...props} />;

  return (
    <>
      {/* Stash passed `values`, and `rest` differs from it only when something
          of ours was lifted out; passing the original props object otherwise
          keeps the identity its own memoisation compares. */}
      <Original
        {...(lifted ? Object.assign({}, props, { values: rest }) : props)}
      />
      {/*
        The panel, in the details tab, where the plain language row used to be.
        Drawn for a manga gallery that carries a value; the panel itself drops
        out entirely when none of its three fields is set.
      */}
      {galleryId && isMarkedNow(galleryId, values) ? (
        <Guard name="manga panel">
          <MangaDetailsPanel values={values} />
        </Guard>
      ) : null}
      {/*
        Rendered whether or not this gallery carries the field yet, and that is
        the whole point: this button is the only way to set a mark, so gating it
        on a mark already existing would leave every gallery permanently
        unmarked. An absent key is simply the "not marked" state, and the first
        click writes the canonical spelling.
      */}
      {galleryId && CAN_WRITE ? (
        <GalleryToolbar galleryId={galleryId} values={values} />
      ) : null}
    </>
  );
});

// 5. Settings page: swap the stock per-setting input for the multiselect above,
//    but only for this plugin — every other plugin's settings go straight back
//    to the original component untouched.
registerPatch("instead", "PluginSettings", (...args: unknown[]) => {
  const props = args[0] as { pluginID?: string };
  const Original = originalFrom(args);
  noteFired("PluginSettings");

  // The ID is not handed down: the plugin's own is a constant here, and it is what
  // everything that writes settings uses — see settingsInput and saveSettings, which is
  // where the whole map is built and which owns the ID rather than taking it.
  if (props.pluginID === PLUGIN_ID) {
    return <MangaToolsSettings />;
  }

  return <Original {...props} />;
});

// 6. Bulk edit: records which galleries are selected. `before` only observes —
//    the props are handed straight back, so GalleryList renders exactly as it
//    would without the plugin. This is the only way to see the selection: the
//    dialog that uses it is not patchable.
registerPatch("before", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { selectedIds?: unknown };
  noteFired("GalleryList");
  captureSelection(props ? props.selectedIds : null);
  return args;
});

// 7. The gallery list's filter sections. Stash wraps its own sidebar filter
//    sections in a patch container, `FilteredGalleryList.SidebarSections`, and
//    that is where these go: pushed in front of Stash's own, they land where
//    they have always been — after the sidebar's saved-filters header, before
//    its studio filter. Nothing is inserted into the DOM for this, and nothing
//    has to be found again after a re-render.
//
//    Two things make it work, and both are why this is not done from the list
//    below. The container is handed nothing but its children, so the filter
//    model has to come from somewhere else: it is published from
//    `FilteredGalleryList`'s own output (see the patch above), which React
//    renders before the sidebar and so before this container — the sections read
//    it on the same pass. Publishing from `GalleryList` instead, whose props do
//    carry the model, does not work: that is the list of cards, rendered *after*
//    the sidebar, so the sections would read nothing on the first pass and only
//    appear a render later.
registerPatch("after", "FilteredGalleryList.SidebarSections", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList.SidebarSections");

  const filter = currentSidebarFilter();
  if (!filter) return result;

  return (
    <>
      {/* One section per field, each drawn only while its field is. The manga
          section is not one of them: the mark is what makes a gallery this
          plugin's at all, so it is offered whatever the four switches say — and
          it is first, because it is the one that is always there.

          The order is the fields' own: the two that describe what a gallery *is*
          (which language, whose translation), then the two that qualify the
          edition (censorship, and whether it is the original). */}
      <SidebarMangaFilter filter={filter} />
      {NS.filterShowing("language") ? (
        <SidebarLanguageFilter filter={filter} />
      ) : null}
      {NS.filterShowing("censorship") ? (
        <SidebarCensorshipFilter filter={filter} />
      ) : null}
      {NS.filterShowing("translationGroup") ? (
        <SidebarTranslationGroupFilter filter={filter} />
      ) : null}
      {NS.filterShowing("original") ? (
        <SidebarOriginalFilter filter={filter} />
      ) : null}
      {result}
    </>
  );
});

// 7b. Publishes the filter the sidebar's sections are built from.
//
//    `FilteredGalleryList` creates the model (`useFilteredItemList`) and passes
//    it down to everything that uses it; nothing above it has it, and the
//    sidebar's container is handed only children. An `after` patch sees the
//    component's output — the element tree, with the model on the props of the
//    elements that were given it — while still running *before* React descends
//    into that tree, which is exactly the window the sidebar needs.
//
//    The walk is recursive rather than a path through `SidebarPane`/`Sidebar`/
//    `SidebarContent`: that tree is Stash's, and one of those being renamed or
//    wrapped would silently leave the sections unbuilt.
registerPatch("after", "FilteredGalleryList", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList");

  // The container the sections are mounted through, checked here rather than at
  // load: components are registered as their module loads, and this one may not
  // exist yet when the plugin does. Rendering the list is the proof that its
  // module is loaded, and a Stash without it — it arrived in v0.31 — would
  // otherwise lose the three sections without a word.
  if (!warnedMissingSidebarContainer && !hasSidebarSectionsContainer()) {
    warnedMissingSidebarContainer = true;
    console.error(
      "[mangaTools] this Stash has no FilteredGalleryList.SidebarSections, so " +
        "the language, censorship and manga filter sections are unavailable. " +
        "Stash v0.31 added the patch container they are mounted through."
    );
  }

  publishSidebarFilter(findFilter(result));
  return result;
});

// 8. The filter dialog's card. Rendered from `GalleryList` because that is the
//    component with the model in hand on this page; the card portals itself into
//    the dialog through the DOM, since a dialog is not part of the list's tree.
registerPatch("instead", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { filter?: MangaToolsFilterModel };
  const Original = originalFrom(args);
  noteFired("GalleryList.filter");

  // The filter dialog builds its cards from a shared options array that the
  // model reaches. Registering here is the first moment that array is in hand;
  // the call is idempotent and the array is only ever pushed to once. Skipped
  // entirely while the language field is off: a card for a field this plugin does
  // not manage is a way into a filter nothing would then draw.
  if (props.filter && NS.fieldShowing("language")) {
    registerLanguageCriterionOption(props.filter);
  }

  return (
    <>
      {NS.fieldShowing("language") ? (
        <DialogLanguageFilter filter={props.filter as MangaToolsFilterModel} />
      ) : null}
      <Original {...props} />
    </>
  );
});

// 8. Bulk edit: mounts the manga rows into the bulk edit dialog. The dialog
//    itself is not a PatchComponent, so RatingSystem — the only patchable
//    component it renders — is used purely as a mount point; the rows are
//    positioned by the DOM anchor and their values reach the mutation through
//    installBulkLink, not through the dialog.
//
//    `after` for the same reason as the card, and one more: RatingSystem is
//    rendered by Stash's own scene and gallery pages with a rating system the
//    user chose, so leaving its output exactly as it was is worth more here than
//    anywhere else.
registerPatch("after", "RatingSystem", (...args: unknown[]) => {
  noteFired("RatingSystem");

  return (
    <>
      {resultFrom(args)}
      <BulkFieldsRow />
    </>
  );
});

/**
 * Brings the tools half up: the settings refresh, the store's first fetch, the
 * poll behind it, and the location listener.
 *
 * The patches above had no part in this — they registered themselves as the file
 * loaded, and each one is guarded on its own (see registerPatch), so none of them
 * can throw. This is the whole of what a caller has to *do*, and the caller is
 * the shared entry (`src/mangaTools.tsx`), which calls it inside its own guard:
 * a Stash this half cannot start on costs the tools and not the reader.
 *
 * Nothing calls it here. It used to be called from the bottom of this file, back
 * when this file was the entry — one bundle means one entry, and the load-time
 * work of both halves is now the shared one's to start.
 */
export function install(): void {
  start();
}
