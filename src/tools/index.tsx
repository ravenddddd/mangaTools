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
import { CensorshipIcon, formatCensorshipOption } from "./censorship";
import { NS } from "../languages";
import { t } from "../i18n";
import { gqlDoc, requirePluginApi } from "../plugin-api";
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
import type {
  MangaToolsApolloOperation,
  MangaToolsOption,
  MangaToolsPatchFn,
} from "../plugin-api";
import {
  CENSORSHIP_FIELD_NAME,
  CHAPTER_FIELD_NAME,
  FIELD_NAME,
  MANGA_FIELD_NAME,
  ORIGINAL_FIELD_NAME,
  PLUGIN_ID,
  TRANSLATION_GROUP_FIELD_NAME,
  censorshipOf,
  currentGalleryId,
  currentPath,
  emit,
  isGalleryContext,
  locationListener,
  pathNow,
  pickLanguage,
  refreshAfterWrite,
  refreshForSuggestions,
  start,
  started,
  stashClient,
  store,
  subscribe,
  useGlobalVersion,
} from "./core";
import type { CustomFieldsMap } from "./core";
import {
  Flag,
  formatLanguageOption,
  languageChip,
  resolveSelect,
} from "./fields-ui";
import { MangaIcon, SteakIcon } from "./icons";
import { MangaToolsSettings } from "./settings-page";
import {
  EDIT_ANCHOR,
  bulkAnchor,
  bulkDialogUp,
  ensureBulkFieldHost,
  ensureDetailHost,
  ensureFieldHost,
  fieldHosts,
  BULK_ANCHOR,
} from "./hosts";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** Column class names copied off a native form row */
type NativeFieldClasses = { group: string; label: string; control: string };

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

/** Registers a patch, and keeps one failing to register from taking the rest of
 *  the plugin with it.
 *
 * A patch whose *target does not exist* is not what this guards: Stash only
 * pushes the callback onto a list, so a name it has never heard of registers
 * happily and simply never fires — which is what `noteFired`'s log is for.
 *
 * What it guards is the API surface itself. This file runs top to bottom at load
 * time, so a `PluginApi.patch` that is missing or renamed — a Stash older or
 * newer than this plugin expects — would throw here and stop the module, and
 * every patch *below* that point would silently never register. A half-working
 * plugin with no error is the worst of both outcomes; this turns it into one
 * line on the console naming the target that did not make it.
 */
function registerPatch(
  kind: "before" | "instead" | "after",
  target: string,
  fn: MangaToolsPatchFn
): void {
  try {
    PluginApi.patch[kind](target, fn);
  } catch (e) {
    console.error(
      "[mangaTools] could not register the " + target + " patch:",
      e
    );
  }
}

/**
 * Records the first time a patch is actually invoked.
 *
 * Patching a component name that does not exist does not raise an error — it
 * simply never runs, leaving no trace to debug from. (This really happened:
 * CustomField looks like a patchable component but is a plain React.FC.)
 * This log is direct evidence that a patch took effect; it fires once per
 * target.
 */
const firedOnce: { [target: string]: boolean } = {};

function noteFired(target: string): void {
  if (firedOnce[target]) return;
  firedOnce[target] = true;
  console.info("[mangaTools] patch active: " + target);
}

/**
 * Records the first time a *condition* worth reporting is met, and says so once.
 *
 * The same discipline as `noteFired`, for the other half of the same problem: a
 * patch that never runs leaves no trace, and neither does a guard that decides not
 * to draw something. Both are silent by construction — that is what a guard is —
 * so the one place that can tell the difference is the plugin itself, at the
 * moment it decides. Once per key per page, because these run on every render.
 */
const notedOnce: { [key: string]: boolean } = {};

function noteOnce(key: string, message: string): void {
  if (notedOnce[key]) return;
  notedOnce[key] = true;
  console.warn("[mangaTools] " + message);
}

/** How many times the bulk rows have rendered — see diag */
let bulkRenders = 0;

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
 * The translation groups already in use, in the order the edit field offers them.
 *
 * Out of this plugin's own store, which is the same set of galleries everything
 * else here is about: every marked gallery carries its whole custom_fields map,
 * so the values in use are in memory already and no query is needed for them.
 * Empty until the first answer, which is right — before that there is nothing to
 * suggest, and the field is a plain text box regardless.
 *
 * Recomputed on every call rather than cached. The field that asks writes on every
 * keystroke, so this does run once per character — but it walks the marked
 * galleries and sorts the *distinct* names, which is tens of entries, and a walk
 * of a few thousand maps is not worth an invariant that can go stale: the store is
 * both replaced by a refresh and written into in place, and a cache keyed on
 * either one would be quietly wrong about the other.
 *
 * Case is left alone. Two groups whose names differ only in case are two names as
 * far as this is concerned, and folding them here would mean deciding which
 * spelling to offer somebody who typed the other one.
 */
/**
 * The two things the sidebar's group filter needs from the store, published here
 * rather than reached for by name.
 *
 * The section renders in Stash's sidebar, one module away from the store, and the
 * store is module state on purpose: a second reader of it would be a second answer
 * to "which groups does this library hold", which is the class of bug this file has
 * paid for more than once (see fields.ts on why one list is asked by everything).
 * So the functions are published, not the map — and `usualLanguages` is the same
 * walk of the same store the edit page's menu and the bulk row already use.
 */
NS.translationGroups = (): string[] => knownTranslationGroups();

function knownTranslationGroups(): string[] {
  if (!store) return [];

  const seen: { [name: string]: true } = {};
  store.forEach((fields) => {
    const name = NS.translationGroupOf(fields);
    if (name) seen[name] = true;
  });

  return Object.keys(seen).sort();
}

/**
 * Whether the store — a filled one — holds this gallery.
 *
 * Since the query asks for the mark, being in the map and being manga are the same
 * question, which is what makes the store a gate rather than a cache. This is the
 * one spelling of that question: isMarkedNow asks it here, so the cover badge, the
 * card's popover mark, the toolbar switch and the panels cannot come to different
 * conclusions about one gallery. They did once — membership here, and the map's
 * own value in the switch — and a gallery whose mark had been hand-set to an empty
 * string was manga to one and not to the other.
 */
function storedIsManga(galleryId: string): boolean {
  // `?? false` is the null store: something it cannot answer is not a yes.
  return store?.has(String(galleryId)) ?? false;
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
function editFormFor(galleryId: string): typeof editForm {
  return editForm && editForm.galleryId === galleryId ? editForm : null;
}

/**
 * The translation group the original-text mark took away, so that a mis-click can
 * be undone by clicking the same button again.
 *
 * Held here rather than left in the gallery, which is the tempting way to do it:
 * a raw gallery carrying a group would be answering "who translated this" twice,
 * and the answer would travel — Stash's own custom-field filters would match it,
 * and so would this plugin's rule about the language a group's galleries carry.
 * The value waits until the mark comes off, and is never written anywhere.
 *
 * One shot, and only for the gallery it was taken from: un-marking puts it back
 * once, and the memory is dropped either way, so a later mark starts from nothing
 * rather than from a name somebody has already given up on. It does not survive a
 * reload, which is the price of not keeping a second copy of the name in the data.
 */
let originalGroupTaken: { galleryId: string; group: string } | null = null;

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
function isMarkedNow(
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
 * Whether this plugin's store holds a gallery — and, before it has answered, that it
 * does not know.
 *
 * The reader half's gate, and the reason asking costs nothing: the store is filled
 * from a query that filters on the manga mark *itself* (`refresh` below), so a
 * gallery in it is a gallery marked manga and a gallery without the mark is in
 * nobody's answer. Null is the third answer — before the first fetch — and it means
 * "not yet" rather than "no", which is what keeps a marked gallery from being drawn
 * on in the second before the answer arrives.
 */
NS.markedInStore = (galleryId: string | null | undefined): boolean | null =>
  store === null || !galleryId ? null : storedIsManga(galleryId);

/** Runs `fn` whenever the store is refreshed, and returns the way to stop. */
NS.watchStore = (fn: () => void): (() => void) => subscribe(fn);

/**
 * The reading half's settings, as the JSON string they are stored as.
 *
 * A string rather than an object, and deliberately: what this half does with them is
 * carry them to and from the plugin's configuration, and the reading half is the one
 * that knows what is in them — including how to read the shapes they used to be
 * written in. Parsing them here would be a second opinion about a format this half has
 * no business having.
 */
NS.readerSettingsRaw = null;

/**
 * Whether Stash's edit form has changes that have not been saved.
 *
 * Read out of the DOM because that is the only place it shows. The panel's own
 * Save button is disabled while there is nothing to save — GalleryEditPanel
 * renders it with `disabled={!formik.dirty || …}` — and the panel exists only
 * while its tab is open, so no button means nothing to lose.
 */
function editFormIsDirty(): boolean {
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
const MARK_QUERY_TEXT = [
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
function getMarkUpdate(): unknown {
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
function writeQuietly(
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

// ─────────────────────────── Edit-page dropdown ───────────────────────────

/**
 * One entry in the translation group's menu.
 *
 * Not a MangaToolsOption: that type carries a flag, which is a fact about a
 * language this plugin knows the flag for, and a group has no such table behind
 * it. `createLabel` says instead that this entry is the text somebody is typing,
 * offered so that choosing it is how a new group gets set.
 */
type MangaToolsGroupOption = {
  value: string;
  label: string;
  /** The wording for the create entry, already localised — see below. */
  createLabel?: string;
  /**
   * The language this group's galleries usually carry, for the menu's hint, or
   * null when there is nothing to say about it. Both forms, because which one is
   * drawn is the "Show flags" setting's business and that is read while
   * react-select renders — see formatGroupOption.
   */
  hint?: { flag: string | null; name: string } | null;
};

/**
 * Renders a group option: the name, or — in the menu only — the offer to create it
 * and the language its galleries usually carry.
 *
 * The "value" context is the box itself, and there the text is simply the name: an
 * offer to create what is already selected would read as a question, and a hint
 * about the group's usual language is not something to draw twice — the language
 * row above says what the language is. In the menu it is prefixed, so the entry
 * nobody has used before is told apart from the groups that exist, and the hint
 * rides at its far end.
 *
 * The hint is a flag or a name, and which one is the "Show flags" setting's call —
 * the same call it makes for the badge and the detail row, where a language is
 * drawn as a flag or as its name. A name is much the longer of the two, so it is
 * the one that gives way when the row runs out of room (see .manga-tools-hint-text).
 *
 * Everything drawn here is carried on the option rather than looked up in this
 * function: it is called by react-select while it renders, and a component's worth
 * of hooks cannot be used in something invoked per option. The options are built
 * in MangaFieldBlock, which has the reader's `intl` in hand.
 */
function formatGroupOption(
  option: MangaToolsGroupOption,
  meta?: { context?: string }
) {
  if (meta?.context !== "menu") return option.label;

  const hint = option.hint ? (
    NS.showFlags && option.hint.flag ? (
      <Flag
        flag={option.hint.flag}
        className="manga-tools-flag manga-tools-hint"
      />
    ) : (
      <span className="manga-tools-hint-text">{option.hint.name}</span>
    )
  ) : null;

  if (!option.createLabel) {
    // Plain names get the hint, and nothing else. Deliberately not the shared
    // `.manga-tools-option`: that one spaces an icon off its label, and spreading
    // its children apart here would push this row's name and hint to opposite
    // ends of a menu the other two dropdowns also draw.
    if (!hint) return option.label;
    return (
      <span className="manga-tools-group-option">
        <span>{option.label}</span>
        {hint}
      </span>
    );
  }

  return <span className="manga-tools-option">{option.createLabel}</span>;
}

/**
 * Copies the class names for each layer off the studio field's DOM.
 *
 * Column widths are deliberately not hard-coded: renderField's defaults differ
 * between Stash versions — develop uses { sm: 3, xl: 2 } while the build
 * actually running only had { sm: 3 }. The extra col-xl-2 made our label
 * column narrower than the native ones on wide screens, so nothing lined up.
 * Copying the class names that are already there is correct regardless of
 * version or breakpoint.
 *
 * Returns null when nothing can be read, and the caller falls back to a
 * conservative default.
 */
function readNativeFieldClasses(
  anchor: Element | null
): NativeFieldClasses | null {
  if (!anchor) return null;

  const label = anchor.querySelector("label");
  const control = label?.nextElementSibling;
  if (!label || !control) return null;

  return {
    group: anchor.className,
    label: label.className,
    control: control.className,
  };
}

/**
 * The edit page's language field, rendered through a portal into the row
 * **right after the studio field**.
 *
 * Why an always-present field rather than replacing the existing language
 * input row: CustomFieldsInput only renders input rows for fields that already
 * exist, and a new gallery has no language row to replace. Typing the field
 * name and code by hand for every gallery would defeat the point of the
 * dropdown. The existing language row is suppressed by the CustomFieldInput
 * patch below, so there is never a duplicate.
 *
 * The structure mirrors Stash's renderField (utils/form.tsx) — see
 * readNativeFieldClasses for how the column widths are matched.
 */
function MangaFieldBlock(props: {
  values?: CustomFieldsMap;
  onChange?: (values: CustomFieldsMap) => void;
}) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const state = React.useState(NS.openEditBlock);
  const open = state[0];
  const setOpen = state[1];
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;

  // The mount point is read during render (same approach as the detail page).
  // ensureFieldHost is idempotent and returns null when the anchor is absent.
  const host = isGalleryContext() ? ensureFieldHost() : null;

  // A manga gallery rarely has performers, so the row Stash draws for them steps
  // aside when the setting asks it to — see .hide-performers in mangaTools.css.
  // Hidden rather than not rendered, because the row is Stash's: its value stays
  // in Stash's form, so a gallery that does have performers keeps them on save,
  // and nothing here can lose data. The class goes on this plugin's own node,
  // which React does not manage, so a re-render of Stash's form cannot undo it.
  //
  // Asked together with whether any field is drawn, because the two are the same
  // question: with all four fields turned off this block does not exist, and a page
  // the plugin draws nothing on is a page whose fields it should not be hiding
  // either. The setting itself is not forgotten — it is read again the moment one
  // field is back on.
  if (host) {
    host.classList.toggle(
      "hide-performers",
      NS.hidePerformers && NS.anyFieldShowing()
    );
  }

  const bump = React.useState(0)[1];

  // On first mount the studio row **has not been committed to the DOM yet**:
  // CustomFieldsInput sits at the very end of the edit form, so when it renders
  // React has only just built the elements and has not written them out. This
  // pass therefore cannot find the anchor. The effect runs after the commit,
  // when it can, and one extra render is all it takes.
  //
  // It only bumps when the mount point differs from the one used for this
  // render, so once things settle the condition is never true again and there
  // is no render loop.
  // A layout effect, so the extra pass is flushed after React writes the DOM but
  // before the browser paints, and this correction adds no visible step of its
  // own.
  React.useLayoutEffect(() => {
    if (isGalleryContext() && ensureFieldHost() !== host) {
      bump((v) => v + 1);
    }
  });

  // No fields drawn means no block. An empty fold whose heading opens onto nothing
  // is worse than no fold at all, and the edit page is then Stash's own — which is
  // exactly what a reader who turned all four off asked for.
  if (!isGalleryContext() || !Select || !host || !NS.anyFieldShowing()) {
    return null;
  }

  // One writer for both rows: Stash's form owns the values map, so each row
  // hands it a new map rather than writing anything itself. That is what makes
  // Save persist the language and the mark together, and Cancel discard both.
  const write = (name: string, value: string) => {
    if (props.onChange) {
      props.onChange(NS.setField(props.values, name, value));
    }
  };

  // Writing a group is two edits in one, and they have to leave in one onChange:
  // declaring a group ends "this is the original", which is the other answer to
  // the same question. Two calls to write would each be computed from the props
  // the other has just made stale, so the map is folded once and handed over.
  const writeGroup = (value: string) => {
    let next = NS.setField(props.values, TRANSLATION_GROUP_FIELD_NAME, value);
    if (value) next = NS.setField(next, ORIGINAL_FIELD_NAME, "");
    if (props.onChange) props.onChange(next);
  };

  // The other answer, declared rather than picked from the menu — see
  // ORIGINAL_FIELD_NAME for why it is not a value of the group field. Toggling it
  // on clears whatever group was set, for the same reason writing a group clears
  // it: a gallery holding both has answered one question twice.
  //
  // What it takes away it holds on to, because a button that destroys a name
  // somebody typed is a button that gets destroyed by a mis-click — see
  // originalGroupTaken for why it is held outside the gallery rather than in it.
  const isOriginal = NS.isOriginal(props.values);
  const toggleOriginal = () => {
    const galleryId = currentGalleryId();
    let next = props.values;

    if (isOriginal) {
      // Put the name back, if this is the gallery it was taken from — and drop it
      // either way, so a mark that found nothing to take does not restore
      // something else's.
      const taken = originalGroupTaken;
      originalGroupTaken = null;
      next = NS.setField(next, ORIGINAL_FIELD_NAME, "");
      if (taken && taken.galleryId === galleryId && taken.group) {
        next = NS.setField(next, TRANSLATION_GROUP_FIELD_NAME, taken.group);
      }
    } else {
      const group = NS.translationGroupOf(props.values);
      originalGroupTaken = group
        ? { galleryId: galleryId, group: group }
        : null;
      next = NS.setField(next, ORIGINAL_FIELD_NAME, NS.ORIGINAL_VALUE);
      next = NS.setField(next, TRANSLATION_GROUP_FIELD_NAME, "");
    }

    if (props.onChange) props.onChange(next);
  };

  // Whether this click would put a name back, which the tooltip says — the undo is
  // worth having, and worth being visible rather than a surprise.
  const restoresGroup =
    !!originalGroupTaken &&
    originalGroupTaken.galleryId === currentGalleryId() &&
    !!originalGroupTaken.group;

  const current = NS.describe(pickLanguage(props.values), intl.locale);
  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => {
      // NS.enabledLanguages is null for "no restriction", otherwise the
      // dropdown is limited to exactly these codes. Display (badge / detail
      // row) is not affected — it always uses the full table via describe().
      return !NS.enabledLanguages || NS.enabledLanguages.has(o.value);
    }
  );

  // Keep an unrecognised current value in the list, otherwise picking
  // something else would make it unreachable.
  if (current && !current.known) {
    // Spread rather than concat: concat infers the literal's `flag: null` as a
    // literal type, which then fails to match MangaToolsOption's `string | null`.
    options = [
      { value: current.code, label: current.name, flag: null },
      ...options,
    ];
  }

  const selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  // The language every group's galleries usually carry, in one walk of the store
  // — the group menu below has two dozen names to ask about, and asking per name
  // would walk a few thousand galleries two dozen times, once per keystroke in the
  // field. What it can and cannot answer is NS.usualLanguagesOf's business.
  //
  // Read here rather than beside the group row below because the language row,
  // which is drawn first, is where the button goes. The group name is
  // NS.translationGroupOf's either way, not a second opinion about the field.
  const usualLanguages = NS.usualLanguagesOf(store);
  const usual =
    usualLanguages[NS.groupKey(NS.translationGroupOf(props.values))];

  // What the rule cannot know, and this row can:
  //
  //   enabledLanguages  the dropdown offers only the reader's enabled languages,
  //                     so a button offering another would write a value this
  //                     field's own menu could not then show
  //   already equal     writing what is already there is furniture. `current` is
  //                     the described value, so this compares languages rather
  //                     than strings — the field tolerates any case
  const offered =
    usual &&
    (!NS.enabledLanguages || NS.enabledLanguages.has(usual.code)) &&
    (!current || current.code !== usual.code)
      ? usual
      : null;
  const offeredInfo = offered ? NS.describe(offered.code, intl.locale) : null;

  // Stash's own furniture for a small button that belongs to the field beside it:
  // the same secondary button the date field carries, with one glyph as its whole
  // content — no name, because the field next to it already names what the button
  // writes, and a second label would be the same word twice.
  //
  // The glyph follows the "Show flags" setting, which says the reader does not
  // want flags in their interface — and this button is part of the interface, not
  // a value. A wand stands in: this is a suggestion. The language's name would be
  // the other honest choice and the wrong one, long enough to squeeze the field it
  // shares its column with, and saying what that field already says.
  //
  // Same shape as the ✗ in dialog-filter.tsx and for the same reason: the name
  // differs between FontAwesome versions, and `Icon` throws *inside a render* on an
  // undefined icon, which would take the page rather than the glyph. So the chain
  // has two spellings of the wand, then a different glyph that is still true of
  // what the button writes, and only then the name — which always exists, and is
  // the one thing a missing icon may not turn into an empty button.
  //
  // type="button" is not decoration: it sits inside Stash's own <form>, where a
  // button without one submits the form and takes the unsaved edits with it.
  const chipIcon =
    Solid.faWandMagicSparkles || Solid.faMagic || Solid.faLanguage || null;
  const chipTitle =
    offered && offeredInfo
      ? t(intl, "mangaTools.translationGroup.fill") +
        " " +
        offeredInfo.name +
        " — " +
        t(intl, "mangaTools.translationGroup.suggestedLanguage") +
        " (" +
        offered.count +
        ")"
      : "";
  const languageChip =
    offered && offeredInfo ? (
      <button
        type="button"
        className="btn btn-secondary manga-tools-chip"
        aria-label={chipTitle}
        title={chipTitle}
        onClick={() => write(FIELD_NAME, offered.code)}
      >
        {NS.showFlags && offeredInfo.flag ? (
          <Flag flag={offeredInfo.flag} className="manga-tools-flag" />
        ) : chipIcon ? (
          <Icon icon={chipIcon} />
        ) : (
          <span>{offeredInfo.name}</span>
        )}
      </button>
    ) : null;

  // Column widths come from the native field; this is the fallback.
  const cls = readNativeFieldClasses(document.querySelector(EDIT_ANCHOR)) || {
    group: "form-group row",
    label: "form-label col-form-label col-sm-3",
    control: "col-sm-9",
  };

  const languageField = (
    // Plain div/label carrying the copied class names, rather than
    // Form.Group/Form.Label/Col: those components regenerate the width classes
    // from their own defaults, which is what broke the alignment before.
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div
        className={cls.control + (languageChip ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          placeholder={t(intl, "mangaTools.select.placeholder")}
          value={selected}
          options={options}
          // react-select draws a vertical rule between the clear and expand
          // icons by default, and none of Stash's own dropdowns have it — its
          // Select.tsx sets components: { IndicatorSeparator: () => null } in
          // its default props, and CountrySelect and FilterSelect each strip it
          // too. Follow suit, so this field wears the same furniture as the row
          // above it and the one below.
          components={{ IndicatorSeparator: () => null }}
          // Flags are drawn with CSS and cannot live inside a plain-text label,
          // so the option has to be rendered here.
          formatOptionLabel={formatLanguageOption}
          // An empty value deletes the field, matching the native
          // onChange("", "") semantics.
          onChange={(opt: MangaToolsOption | null) => {
            write(FIELD_NAME, opt ? opt.value : "");
          }}
        />
        {languageChip}
      </div>
    </div>
  );

  // The mark, as a two-option selector rather than the cycle the toolbar used to
  // carry. Two options and a clear button cover the three states exactly, and the
  // reason the old control needed a third icon — "not marked" — was that a cycle
  // has to name every state it can reach. A selector does not: not marked *is*
  // nothing selected.
  const mark = censorshipOf(props.values);
  const markOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];
  const markSelected = markOptions.find((o) => o.value === mark) || null;

  const markField = (
    <div className={cls.group} data-field="manga_tools_censorship">
      <label className={cls.label} htmlFor="manga_tools_censorship">
        {t(intl, "mangaTools.censorship.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_censorship"
          isClearable
          isSearchable={false}
          // The placeholder is the third state's name, so it reads the same as
          // the row in the details block: 未标注 rather than an empty box.
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={markSelected}
          options={markOptions}
          components={{ IndicatorSeparator: () => null }}
          // The same treatment the language options get: an icon cannot live
          // inside a plain-text label, so the option is drawn here.
          formatOptionLabel={formatCensorshipOption}
          onChange={(opt: { value: string } | null) => {
            write(CENSORSHIP_FIELD_NAME, opt ? opt.value : "");
          }}
        />
      </div>
    </div>
  );

  // The translation group, wearing the same Select as the two fields above it —
  // which is a costume, because react-select cannot be typed into. What makes it
  // work is that **the text in the box is the field's value**: every keystroke is
  // written to the map as it is typed, exactly as the plain text box did, and the
  // menu is then built from the value rather than from any state of react-select's.
  //
  // That is what keeps it honest. react-select is a control for choosing from a
  // list, and the usual way to make it accept new text is to keep the search text
  // in state, offer it as an extra option, and hope the reader selects it — where
  // typing and then leaving throws the text away. Here there is nothing to throw
  // away: the value is already saved, and the "create" entry is a way of saying
  // "this text, yes" rather than the only way of keeping it.
  //
  // Two of react-select's behaviours have to be worked with rather than around,
  // and both are visible in its source (Select.js, "renderPlaceholderOrValue" and
  // "setValue"):
  //
  //   - The value area draws **nothing** while the input has text in it, because
  //     the input is then assumed to be showing that text; and choosing an option
  //     hides the input (`opacity: 0`) for a single select. So `inputValue` is left
  //     to react-select: it holds what is being typed, the box shows that while
  //     typing and the chosen name as plain text afterwards, and the field ends up
  //     behaving exactly like the two above it. Controlling `inputValue` to the
  //     value instead blanks the box — text hidden and no label drawn.
  //   - `onInputChange` fires for reasons other than typing — selecting, closing
  //     the menu — and its text is then the option's label or nothing at all.
  //     Taking it would put the search text back over the value just chosen, or
  //     clear the field as the menu closed. Only "input-change" is written.
  const groupRaw = NS.pickField(props.values, TRANSLATION_GROUP_FIELD_NAME);
  const groupName = NS.translationGroupOf(props.values);

  const known = knownTranslationGroups();
  // Offered only when the text is not a group this Stash knows: otherwise the menu
  // would spell the same name twice, in whatever case it was typed.
  const namesANewGroup =
    !!groupName &&
    !known.some((name) => NS.sameTranslationGroup(name, groupName));

  // The groups whose usual language is this gallery's come first, and the rest
  // keep their name order behind them. Sorted rather than filtered: the others are
  // still what a reader picks when this gallery is the exception, and hiding them
  // would make the menu lie about what the library holds.
  //
  // Nothing moves until the language is set — with no language there is nothing to
  // match against, and a list that reordered itself for no visible reason would be
  // worse than one that did not.
  const usualOf = (name: string) => usualLanguages[NS.groupKey(name)];
  const matchesNow = (name: string) => {
    const usualHere = usualOf(name);
    return !!current && !!usualHere && usualHere.code === current.code;
  };
  const ordered = known
    .filter(matchesNow)
    .concat(known.filter((name) => !matchesNow(name)));

  const groupOptions: MangaToolsGroupOption[] = [
    ...(namesANewGroup
      ? [
          {
            value: groupName,
            label: groupName,
            // Composed here rather than in formatGroupOption, which runs inside
            // react-select's render and cannot use a hook. Quoted, because the
            // name is a name and reading "Create Lily Manga" makes the offer look
            // like the answer.
            createLabel:
              t(intl, "mangaTools.translationGroup.create") +
              ' "' +
              groupName +
              '"',
          },
        ]
      : []),
    ...ordered.map((name) => {
      const usualHere = usualOf(name);
      // Both forms are built here because this is where the reader's `intl` is:
      // formatGroupOption runs inside react-select's render and cannot use a hook,
      // which is also why the create entry's wording is composed up here.
      const described = usualHere
        ? NS.describe(usualHere.code, intl.locale)
        : null;
      const hint = described
        ? { flag: described.flag, name: described.name }
        : null;
      return { value: name, label: name, hint: hint };
    }),
  ];

  // The other answer to "who translated this", as a pressed-state button beside
  // the field it belongs to — always drawn, because a control that vanishes when
  // it is on is a control nobody can turn off.
  //
  // It draws a steak rather than a word: 熟肉 by default, 生肉 once the gallery is
  // declared the original. A picture of the state rather than its name is the point
  // — 生肉/熟肉 is a piece of slang, and one that only reads in one language.
  //
  // `manga-tools-chip` is the same hook the language row's button carries: it is
  // what the stylesheet stretches to the field's height. `active` is Bootstrap's
  // own pressed look, so the state needs no styling of its own beyond the shape.
  // aria-pressed is what says "toggle" to a screen reader, and the name and tooltip
  // are where the words go, since the button has none of its own.
  // The two fields the row below is built from, asked once. Raw and the
  // translation group are two answers to one question, which is why the chip that
  // declares one of them rides on the other's row rather than having a row of its
  // own — and that is only true while both are drawn. With the group turned off,
  // raw is a field like any other and gets what every other field on this form
  // has: a switch, on a row of its own.
  const showGroup = NS.fieldShowing("translationGroup");
  const showOriginal = NS.fieldShowing("original");

  // Whether the *group row* is disabled by the raw mark, which is a different
  // question from whether the gallery is raw: with the raw field turned off there is
  // no switch anywhere to turn it back on, and a box greyed out with no way out of
  // it is worse than one the reader can type into. The value itself is untouched
  // either way — it simply stops steering a row it no longer belongs to.
  const rawShown = showOriginal && isOriginal;

  const originalLabel = t(intl, "mangaTools.translationGroup.original");
  const originalChip = (
    <button
      type="button"
      className={
        "btn btn-secondary manga-tools-chip manga-tools-original" +
        (isOriginal ? " active" : "")
      }
      aria-pressed={isOriginal}
      aria-label={originalLabel}
      title={t(
        intl,
        isOriginal
          ? restoresGroup
            ? "mangaTools.translationGroup.originalOffRestore"
            : "mangaTools.translationGroup.originalOff"
          : "mangaTools.translationGroup.originalOn"
      )}
      onClick={toggleOriginal}
    >
      <SteakIcon raw={isOriginal} />
    </button>
  );

  // Raw on its own, for the one arrangement where the chip above has no row to sit
  // on. It is the same control every other field of this plugin has on Stash's edit
  // page — a switch in the control column, with the label in the column the two
  // selects beside it use — because on its own it *is* just another boolean field,
  // and the chip was only ever there to say "this is the other answer to the
  // question the box next to it asks".
  //
  // Markup rather than react-bootstrap's Form.Check, like the rows around it: the
  // classes are Bootstrap's own switch (`form-check form-switch` + a checkbox with
  // `role="switch"`), which is exactly what Form.Check with type="switch" renders.
  const originalRow = (
    <div className={cls.group} data-field="manga_tools_original">
      <label className={cls.label} htmlFor="manga_tools_original">
        {originalLabel}
      </label>
      <div className={cls.control}>
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            role="switch"
            id="manga_tools_original"
            checked={isOriginal}
            onChange={toggleOriginal}
          />
        </div>
      </div>
    </div>
  );

  const groupField = (
    <div className={cls.group} data-field="manga_tools_translation_group">
      <label className={cls.label} htmlFor="manga_tools_translation_group">
        {t(intl, "mangaTools.translationGroup.heading")}
      </label>
      <div
        className={cls.control + (showOriginal ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select manga-tools-group-select"
          classNamePrefix="react-select"
          inputId="manga_tools_translation_group"
          isClearable
          // Disabled while the gallery is the original, because there is no group
          // to enter and a live box would invite one. This is not the same state as
          // an empty field: empty means "nobody has said", and raw means "not
          // applicable" — so the box says which one it is rather than looking
          // unfilled.
          //
          // The field keeps its shape: the control stays where it is, greyed, and
          // the button beside it is what turns this back on. Replacing the box with
          // a line of text would say the same thing and leave the row a different
          // shape from the two above it, which is the property the column widths
          // here took the most work to get right.
          isDisabled={rawShown}
          placeholder={t(
            intl,
            rawShown
              ? "mangaTools.translationGroup.originalDetail"
              : "mangaTools.translationGroup.placeholder"
          )}
          value={groupRaw ? { value: groupRaw, label: groupName } : null}
          options={groupOptions}
          formatOptionLabel={formatGroupOption}
          // react-select draws a vertical rule between the clear button and the
          // arrow, and none of Stash's own dropdowns have it — its Select.tsx sets
          // this in its default props and strips it too. Follow suit, so this field
          // has the same furniture as the two above it.
          components={{ IndicatorSeparator: () => null }}
          // What is in the menu is the groups that exist *now*, and a save is the
          // moment that changes — the value just written becomes one of them, and
          // a name that was only ever used by this gallery stops being one. This
          // plugin's store is otherwise only refetched on a timer (a minute), so
          // without this the menu goes on offering to create the name the gallery
          // already carries.
          onMenuOpen={() => refreshForSuggestions()}
          onInputChange={(text: string, meta: { action?: string }) => {
            if (meta?.action !== "input-change") return;
            // A box holding only spaces means nothing, and nothing removes the
            // key rather than storing whitespace that reads as empty everywhere
            // else.
            writeGroup(text.trim() ? text : "");
          }}
          onChange={(opt: MangaToolsGroupOption | null) => {
            // A group picked from the list is written in *its* spelling, which is
            // how a name typed in another case is put right; the create entry
            // carries the text back unchanged.
            writeGroup(opt ? opt.value : "");
          }}
        />
        {showOriginal ? originalChip : null}
      </div>
    </div>
  );

  // The field row is not wrapped in the disclosure, it is *shown or not shown* by
  // it, and that is deliberate: wrapping it would put a box between the row and
  // the padded column its negative margins cancel against, which is the whole
  // reason the mount point above is `display: contents`. Folding this way costs
  // the height animation — the fold is instant — and keeps the columns lined up
  // with the native fields, which is the property that took the work.
  //
  // The header does need a row of its own, or it would sit outside the form's
  // column grid; it borrows the same column classes as the rows around it.
  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      <div className={cls.group}>
        <div className="col-12">
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
        </div>
      </div>
      {open && NS.fieldShowing("censorship") ? markField : null}
      {open && NS.fieldShowing("language") ? languageField : null}
      {open && showGroup ? groupField : null}
      {/* Raw, as a row of its own, only where the group's row is not there to
          carry the chip. With both drawn the chip above is the whole of it, and
          with the field turned off there is nothing to draw. */}
      {open && showOriginal && !showGroup ? originalRow : null}
    </div>,
    host
  );
}

// ─────────────────────────── Bulk edit dialog ───────────────────────────

/** What a bulk select is about to do to one of the two valued fields */
type BulkValuePending = { kind: "set"; value: string } | { kind: "remove" };

/**
 * What the bulk dialog is about to do to each of this plugin's fields.
 *
 * State the dialog itself does not know about, and cannot be given:
 * EditGalleriesDialog is a plain React.FC (not a PatchComponent) and keeps its
 * pending edits in its own useState, so there is no way to add a field to them.
 * The rows therefore live outside that state and their values are merged into
 * the outgoing mutation instead — see installBulkLink.
 *
 * `null` means "leave the field alone". A select's ✗ clears back to null; its
 * "remove" option is the only way to empty a field across a whole selection.
 * The two are deliberately distinct — "do not change" and "delete" are not the
 * same thing, and a bulk dialog that could only do the first would be unable to
 * strip a value Stash's own edit form can clear.
 *
 * `bulkManga` is the master. The mark is what makes a gallery the plugin's at
 * all, so the other two rows are only drawn while it is "mark"; and "unmark"
 * wins over whatever they hold, because a gallery that stops being manga also
 * stops carrying their values. See selectedMangaAggregate for the three states.
 *
 * All three are dropped once the mutation succeeds and when the dialog closes,
 * so a cancelled dialog leaves nothing behind.
 */
let bulkLanguage: BulkValuePending | null = null;
let bulkCensorship: BulkValuePending | null = null;
let bulkGroup: BulkValuePending | null = null;
let bulkManga: "mark" | "unmark" | null = null;

/**
 * The raw mark as this dialog means to write it, or null for "leave it alone".
 *
 * Not a `BulkValuePending`: an unset raw is the *absence* of the key, which is how
 * every other "no" in this plugin is spelled (the mark itself included), so there is
 * no third state to carry. It is also the one pending whose third state is not a
 * value but a *combination* — see cycleOriginal, where un-pressing hands the group
 * back.
 */
let bulkOriginal: "raw" | "notRaw" | null = null;

/**
 * What the group box was about to write when the raw mark took it away.
 *
 * The edit page keeps the same memory per gallery (`originalGroupTaken`) and puts
 * the *name* back. A dialog cannot, and the difference is worth the extra state: a
 * bulk selection may have no group at all, or may have one the reader has already
 * asked to remove — and in both of those cases "the name" is the wrong thing to
 * restore. What is restored is the pending itself, `null` included, so un-pressing
 * gives back exactly what the box was saying: a name, a removal, or nothing.
 *
 * Outer `null` means raw took nothing (the note is not there to undo); `pending:
 * null` means it took "no view", which un-pressing gives back with the box reading
 * the selection's own group again.
 */
let bulkGroupBeforeRaw: { pending: BulkValuePending | null } | null = null;

/** Ids currently selected in the gallery list, captured from GalleryList */
let selectedGalleryIds: string[] = [];

/**
 * Records which galleries are selected.
 *
 * The bulk dialog does not hand its selection to anything a plugin can patch,
 * so it is read from GalleryList instead — the one patchable component that
 * receives `selectedIds`, and the parent of all three display modes, so grid,
 * list and wall are all covered by this single hook.
 *
 * Deliberately does **not** emit(): this runs during GalleryList's render, and
 * notifying subscribers there would set state on a component while a different
 * one is rendering. Nothing needs it either — the selection cannot change while
 * the modal is open.
 */
function captureSelection(selectedIds: unknown): void {
  const next: string[] = [];
  if (
    selectedIds &&
    typeof (selectedIds as { forEach?: unknown }).forEach === "function"
  ) {
    (selectedIds as Set<string>).forEach((id) => {
      next.push(String(id));
    });
  }

  const unchanged =
    next.length === selectedGalleryIds.length &&
    next.every((id, i) => id === selectedGalleryIds[i]);

  if (!unchanged) selectedGalleryIds = next;
}

/**
 * The language every selected gallery shares, or null when they differ (or when
 * none of them carries one).
 *
 * Mirrors getAggregateStudioId in Stash's utils/bulkUpdate.ts — comparing the
 * whole selection and falling back to "nothing in common" is what makes the
 * studio field show a value only when every selected item agrees. The languages
 * come from the plugin's own store rather than from the dialog, because the
 * dialog is the one thing that cannot be read.
 */
function selectedLanguageAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = pickLanguage(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (pickLanguage(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * The censorship every selected gallery shares, or null when they differ (or
 * when none of them carries one). The counterpart of selectedLanguageAggregate
 * above, which this plugin's own three-valued field needs just as much as the
 * language field does.
 */
function selectedCensorshipAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = censorshipOf(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (censorshipOf(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * The translation group every selected gallery shares, or null when they differ
 * (or when none of them carries one).
 *
 * Compared with `sameTranslationGroup` rather than by string equality, because
 * these values are typed: two galleries reading `Lily` and `lily` are one group,
 * and a menu prefilled from one of them is not a disagreement.
 */
function selectedGroupAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = NS.translationGroupOf(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    const name = NS.translationGroupOf(store?.get(selectedGalleryIds[i]));
    if (!NS.sameTranslationGroup(name, first)) return null;
  }

  return first || null;
}

/**
 * Whether every selected gallery is raw, none of them is, or the two are mixed —
 * the same three states the manga mark has, for the other field that is a claim
 * about a whole selection rather than a value to type into.
 *
 * A gallery with no answer at all reads as "not raw", which is what the field
 * means when it is absent everywhere else in the plugin.
 */
function selectedOriginalAggregate(): "all" | "none" | "mixed" {
  if (!selectedGalleryIds.length) return "none";

  let anyRaw = false;
  let anyOther = false;
  for (let i = 0; i < selectedGalleryIds.length; i++) {
    if (NS.isOriginal(store?.get(selectedGalleryIds[i]))) anyRaw = true;
    else anyOther = true;
    if (anyRaw && anyOther) return "mixed";
  }

  return anyRaw ? "all" : "none";
}

/**
 * Whether every selected gallery is manga, none of them is, or the two are
 * mixed. The three states the manga mark's checkbox has to express — a checkbox
 * can be checked, unchecked, or indeterminate, and which of those it shows is
 * exactly this.
 */
function selectedMangaAggregate(): "all" | "none" | "mixed" {
  if (!selectedGalleryIds.length) return "none";

  let anyManga = false;
  let anyOther = false;
  for (let i = 0; i < selectedGalleryIds.length; i++) {
    if (NS.isManga(store?.get(selectedGalleryIds[i]))) anyManga = true;
    else anyOther = true;
    if (anyManga && anyOther) return "mixed";
  }

  return anyManga ? "all" : "none";
}

/** Set once, so the link chain is never wrapped twice */
let bulkLinkInstalled = false;

/**
 * Is this operation Stash's gallery bulk update?
 *
 * Matched on the **root field name from the schema** (`bulkGalleryUpdate`,
 * graphql/schema/schema.graphql) rather than on the operation name codegen
 * happens to give it, and not on the shape of the variables either: the scene
 * and image bulk updates also take an `ids` array, and writing a language onto
 * scenes is not this plugin's business.
 */
function isGalleryBulkUpdate(query: unknown): boolean {
  const defs = query
    ? (query as { definitions?: unknown[] }).definitions
    : null;
  if (!defs?.length) return false;

  const op = defs[0] as {
    kind?: string;
    selectionSet?: { selections?: Array<{ name?: { value?: string } }> };
  };
  if (op?.kind !== "OperationDefinition") return false;

  const selections = op.selectionSet?.selections;
  if (!selections?.length) return false;

  const first = selections[0];
  return !!(first?.name && first.name.value === "bulkGalleryUpdate");
}

/**
 * The keys an unmark removes, across everything the dialog has selected.
 *
 * **The same function the single-gallery unmark uses** — `NS.fieldsToClear` — so that
 * "unmark" means one thing wherever it is asked for. That is not a tidying: this path
 * used to carry its own hand-written list of canonical names, and the list was wrong in
 * two ways a list cannot help being wrong. It did not consult `deleteOnUnmark`, so the
 * dialog destroyed values the setting had promised to keep; and being canonical it could
 * not remove a key that had drifted in case, which is the very thing `fieldsToClear`
 * exists to get right (a gallery would keep showing a language it was supposed to have
 * forgotten). It also fell behind: the third and fourth fields were never added to it.
 *
 * A union rather than any one gallery's answer, because one mutation covers N galleries
 * and names one key list. Removing a key a gallery does not carry is a no-op on the
 * server, which is what makes a single list safe for all of them. Asking the store for a
 * gallery it does not hold is the ordinary case, not a gap: the store is a gate rather
 * than a cache (see storedIsManga), and a gallery missing from it is one this plugin does
 * not consider manga — `fieldsToClear` answers for that case with the canonical mark,
 * which is exactly what should go.
 */
function bulkUnmarkKeys(): string[] {
  const keys: string[] = [];
  const seen: { [key: string]: true } = {};

  for (const id of selectedGalleryIds) {
    for (const key of NS.fieldsToClear(store?.get(id))) {
      if (seen[key]) continue;
      seen[key] = true;
      keys.push(key);
    }
  }

  return keys.length ? keys : [MANGA_FIELD_NAME];
}

/**
 * Merges the pending fields into a bulk gallery update, in place.
 *
 * CustomFieldsInput is what makes this safe: `partial` updates just the named
 * keys, so the rest of every gallery's custom fields is left alone, and `remove`
 * deletes only the named keys. Both may appear at once — the two pendings that
 * can coexist are a "set" on one field and a "remove" on another, which the
 * schema allows in a single input.
 *
 * Nothing is merged when the user has not touched any field — a bulk edit of
 * photographers must go out exactly as Stash built it. `bulkManga` is the one
 * pending the others defer to: unmarking clears every field this plugin owns, so
 * when it is set the other two are ignored entirely; and only "mark" writes the
 * manga field itself, since a selection that is already all-manga must not be
 * rewritten.
 *
 * @returns true when the operation was modified
 */
function applyPendingFields(operation: MangaToolsApolloOperation): boolean {
  const partial: { [name: string]: string } = {};
  const remove: string[] = [];

  if (bulkManga === "unmark") {
    remove.push(...bulkUnmarkKeys());
  } else {
    if (bulkManga === "mark") partial[MANGA_FIELD_NAME] = NS.MANGA_VALUE;

    if (bulkLanguage?.kind === "set") partial[FIELD_NAME] = bulkLanguage.value;
    else if (bulkLanguage?.kind === "remove") remove.push(FIELD_NAME);

    if (bulkCensorship?.kind === "set")
      partial[CENSORSHIP_FIELD_NAME] = bulkCensorship.value;
    else if (bulkCensorship?.kind === "remove")
      remove.push(CENSORSHIP_FIELD_NAME);

    if (bulkGroup?.kind === "set")
      partial[TRANSLATION_GROUP_FIELD_NAME] = bulkGroup.value;
    else if (bulkGroup?.kind === "remove")
      remove.push(TRANSLATION_GROUP_FIELD_NAME);

    if (bulkOriginal === "raw")
      partial[ORIGINAL_FIELD_NAME] = NS.ORIGINAL_VALUE;
    else if (bulkOriginal === "notRaw") remove.push(ORIGINAL_FIELD_NAME);
  }

  if (!Object.keys(partial).length && !remove.length) return false;

  // The route is checked here as well as by the row's mount, so "these fields
  // are only ever written on a gallery page" is a stated constraint rather than
  // a consequence of where the row happens to render.
  if (!isGalleryContext()) return false;

  if (!isGalleryBulkUpdate(operation.query)) return false;

  const input = operation.variables
    ? (operation.variables.input as { ids?: unknown } | undefined)
    : undefined;
  if (!input || !Array.isArray(input.ids)) return false;

  const fields: { partial?: Record<string, string>; remove?: string[] } = {};
  if (Object.keys(partial).length) fields.partial = partial;
  if (remove.length) fields.remove = remove;

  operation.variables = Object.assign({}, operation.variables, {
    input: Object.assign({}, input, {
      custom_fields: Object.assign(
        {},
        (input as { custom_fields?: unknown }).custom_fields,
        fields
      ),
    }),
  });

  return true;
}

/**
 * Hooks Stash's Apollo link chain so the pending fields ride along with the
 * dialog's own Apply.
 *
 * Why a link rather than patching the dialog: the dialog builds its mutation
 * from private state, so the last point this plugin and the dialog are both
 * present is the outgoing GraphQL operation. `setLink` is Apollo's own API for
 * changing the chain after the client exists, and the existing chain is passed
 * through untouched, so nothing else about the client changes.
 *
 * Installed lazily, the first time the bulk row mounts, so a user who never
 * opens the bulk dialog never has their client touched at all.
 */
function installBulkLink(): void {
  if (bulkLinkInstalled) return;

  const Apollo = PluginApi.libraries.Apollo;
  const client = stashClient();
  if (!client) return;

  if (
    !Apollo?.ApolloLink ||
    typeof client.setLink !== "function" ||
    !client.link
  ) {
    console.error(
      "[mangaTools] ApolloLink/setLink unavailable — the manga fields cannot be set from the bulk edit dialog"
    );
    return;
  }

  // Replace the chain with ours in front of the existing one. setLink replaces
  // the whole chain, so the current link must be passed through explicitly.
  const previous = client.link;

  client.setLink(
    Apollo.ApolloLink.from([
      new Apollo.ApolloLink((operation, forward) => {
        if (!applyPendingFields(operation)) {
          return forward(operation);
        }

        console.info(
          "[mangaTools] bulk update: sending the manga fields with the dialog's own update"
        );

        // Cleared only once the update actually succeeded, so a failed Apply
        // can simply be retried with the row still filled in.
        return forward(operation).map((result) => {
          bulkLanguage = null;
          bulkCensorship = null;
          bulkManga = null;

          // The badges read the plugin's own store, which this update has just
          // invalidated. Without this the covers keep the old flag until the
          // next poll or navigation.
          refreshAfterWrite();
          emit();

          return result;
        });
      }),
      previous,
    ])
  );

  bulkLinkInstalled = true;
}

/** The "remove" option's value — cannot collide with a language code or a censorship value */
const BULK_REMOVE_VALUE = "__manga_tools_remove__";

/**
 * The bulk edit dialog's manga rows, rendered through a portal into a mount
 * point inserted between Stash's "studio" and "performers" rows.
 *
 * Three rows, gated by the first. The mark is a tri-state checkbox — the same
 * shape Stash's own "organized" field takes — because a selection can be all,
 * none, or a mix, and a checkbox is the one control that says all three. The
 * language and censorship selects are only drawn while the selection is being
 * kept or made manga: the mark is what makes a gallery this plugin's at all, so
 * offering those fields over a selection that is not manga would be writing
 * values onto galleries that would then not display them. Unchecking a mark
 * that exists shows a warning instead, and Apply is what actually removes it.
 *
 * The values are deliberately **not** applied as they are picked: they are
 * merged into the dialog's own bulk update when Apply is pressed, so Cancel
 * discards them exactly like every other field in that dialog.
 */
function BulkFieldsRow() {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  const host = isGalleryContext() ? ensureBulkFieldHost() : null;
  const bump = React.useState(0)[1];

  // Same first-render problem as LanguageRow: the dialog mounts this component
  // from its rating row, which renders **before** the studio row it has to
  // anchor on has been committed to the DOM. The effect runs after the commit,
  // and one extra render is all it takes.
  // As in LanguageRow: before paint, so this pass adds no step of its own.
  React.useLayoutEffect(() => {
    if (!isGalleryContext()) return;

    installBulkLink();

    if (ensureBulkFieldHost() !== host) {
      bump((v) => v + 1);
    } else if (!host && bulkDialogUp()) {
      // **After the commit, and only when there is a dialog to place rows in.**
      // Both readings have settled by now: the dialog's rows are in the DOM, and
      // the anchor has either been found or has not. A mount point that cannot be
      // placed at this point, with the dialog up, is the failure this line exists
      // for — the one where the dialog is on screen, the rows are not, and nothing
      // else on the console says why. Two things would make it cry wolf instead:
      // asking during the render (the studio row is not committed yet on the first
      // one — the same reason this effect exists at all), and asking without the
      // dialog being up (`BulkFieldsRow` renders wherever a RatingSystem does, and
      // most of those pages have no bulk dialog and are not broken).
      noteOnce(
        "bulk-no-host",
        "the bulk edit dialog's mount point could not be placed — " +
          BULK_ANCHOR +
          " was not found inside the dialog's own form. MangaTools.diag() " +
          "reports what it sees."
      );
    }
  });

  // Losing the row means the dialog closed, so the pending values are no longer
  // wanted. Checked against the DOM rather than unconditionally, so an
  // unrelated re-render cannot throw them away while the dialog is open.
  React.useEffect(
    () => () => {
      if (!bulkAnchor()) {
        bulkLanguage = null;
        bulkCensorship = null;
        bulkGroup = null;
        bulkOriginal = null;
        bulkGroupBeforeRaw = null;
        bulkManga = null;
      }
    },
    []
  );

  // Counted, not logged: whether this component ever ran is what tells a bug in
  // the dialog apart from a bug in whatever mounts it, and a count is the only
  // form of that answer which does not depend on watching the console at the
  // right moment. MangaTools.diag() reports it.
  bulkRenders += 1;

  // Drawing nothing is silent, and **nothing is said from here**. Both of the ways
  // this render can come up empty have a better place to be reported from:
  //
  //   - "not a gallery route" is the ordinary case, not a failure. The rating row
  //     this component is mounted from belongs to *a* bulk dialog, and galleries,
  //     images, scenes and groups all draw that same row — images and scenes down
  //     to `scene_code` and `photographer`. So `/images` with its dialog open looks
  //     exactly like a gallery page whose route the plugin got wrong, and a line
  //     here would cry wolf on every one of them.
  //   - "the mount point could not be placed" is only answerable *after* the commit:
  //     the dialog's studio row is not in the DOM yet on this first render, by
  //     design (see the layout effect above). Reported from here it would fire once
  //     on every dialog that opens perfectly well. It is reported from the effect,
  //     which is the first moment the question has a true answer — and where the
  //     bug it exists for would still be caught, because a mount point that cannot
  //     be placed cannot be placed then either.
  //
  // So this guard is quiet, and the two lines that were here are gone: one cried
  // wolf, one was said twice (resolveSelect already names a missing react-select).
  if (!isGalleryContext() || !Select || !host) {
    return null;
  }

  const cls = readNativeFieldClasses(bulkAnchor()) || {
    group: "row",
    label: "col-form-label col-3",
    control: "col-9",
  };

  // The mark, and the third state its checkbox has to express. `tri` is the
  // checkbox's state as a boolean *or* the indeterminate it shows for a mixed
  // selection — which is why it is not just `bulkManga !== "unmark"`.
  const aggregate = selectedMangaAggregate();
  const tri =
    bulkManga === "mark"
      ? true
      : bulkManga === "unmark"
        ? false
        : aggregate === "all"
          ? true
          : aggregate === "none"
            ? false
            : undefined;

  // React has no `indeterminate` prop, so it is set on the DOM node directly —
  // the same thing Stash's IndeterminateCheckbox does with its ref.
  const setIndeterminate = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = tri === undefined;
  };

  // The cycle depends on what the selection already is, so the "no change" rest
  // state is one click away in every case: all↔unmark, none↔mark, and for a
  // mix, keep→mark→unmark→keep. Marking first matches a checkbox the reader
  // has to confirm before it will ever remove a mark.
  const cycleManga = () => {
    if (aggregate === "all") {
      bulkManga = bulkManga === "unmark" ? null : "unmark";
    } else if (aggregate === "none") {
      bulkManga = bulkManga === "mark" ? null : "mark";
    } else {
      bulkManga =
        bulkManga === null ? "mark" : bulkManga === "mark" ? "unmark" : null;
    }
    emit();
  };

  // The mark is native organized-style markup — a form-group wrapping a
  // form-check, checkbox then label, no grid columns — so it sits in the dialog
  // exactly like Stash's "organized" field rather than in the label/control
  // column split the selects below use.
  const mangaRow = (
    <div className="form-group" data-field="manga_tools_manga">
      <div className="form-check">
        <input
          type="checkbox"
          className="form-check-input"
          id="manga_tools_manga"
          ref={setIndeterminate}
          checked={tri === true}
          onChange={cycleManga}
        />
        <label className="form-check-label" htmlFor="manga_tools_manga">
          {t(intl, "mangaTools.manga.isManga")}
        </label>
      </div>
    </div>
  );

  // The one option both selects share, and the way each draws it. It is a real
  // option rather than the clear button, because clearing already means "leave
  // this field alone" — the two must both be reachable, and they are opposites.
  const removeOption: MangaToolsOption = {
    value: BULK_REMOVE_VALUE,
    label: t(intl, "mangaTools.bulk.remove"),
    flag: null,
  };
  const banIcon = Solid.faBan || null;
  const removeLabel = (
    <span className="manga-tools-option">
      {banIcon ? <Icon icon={banIcon} /> : null}
      {removeOption.label}
    </span>
  );
  const formatLanguageWithRemove = (opt: MangaToolsOption) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatLanguageOption(opt);
  const formatCensorshipWithRemove = (opt: { value: string; label: string }) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatCensorshipOption(opt);

  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => !NS.enabledLanguages || NS.enabledLanguages.has(o.value)
  );

  // Show exactly what is about to happen: what the user picked, otherwise the
  // selection's shared language. A mixed selection shows the placeholder — the
  // same way the studio field behaves — and the remove option is its own state
  // rather than an empty box, because an empty box means "leave alone".
  const langShown =
    bulkLanguage?.kind === "set"
      ? bulkLanguage.value
      : bulkLanguage?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedLanguageAggregate() || "";

  const current =
    langShown && langShown !== BULK_REMOVE_VALUE
      ? NS.describe(langShown, intl.locale)
      : null;

  // A code that is not in the enabled list still has to be shown while it is
  // sitting in the row, or the selection would look like it was ignored.
  const currentCode = current ? current.code : "";
  if (current && !options.some((o) => o.value === currentCode)) {
    options = [
      { value: current.code, label: current.name, flag: current.flag },
      ...options,
    ];
  }

  const selected =
    langShown === BULK_REMOVE_VALUE
      ? removeOption
      : current
        ? { value: current.code, label: current.name, flag: current.flag }
        : null;

  // The group this dialog is about to write — the pending one if there is one, the
  // selection's if they agree, otherwise none. It is what the suggestion below is
  // read from, and why the suggestion follows what you picked rather than what the
  // galleries still say.
  const groupNow =
    bulkGroup?.kind === "set"
      ? bulkGroup.value
      : bulkGroup?.kind === "remove"
        ? ""
        : selectedGroupAggregate() || "";

  // The language that group's galleries usually carry, offered the way the edit
  // page offers it: only when it is a language this field's own menu can show, and
  // only when it is not already what the row says. Same three conditions as there,
  // for the same three reasons — see the edit page's `offered`.
  const usualForGroup = NS.usualLanguagesOf(store)[NS.groupKey(groupNow)];
  const offered =
    usualForGroup &&
    (!NS.enabledLanguages || NS.enabledLanguages.has(usualForGroup.code)) &&
    (!current || current.code !== usualForGroup.code)
      ? usualForGroup
      : null;
  const offeredInfo = offered ? NS.describe(offered.code, intl.locale) : null;

  // The wand the edit page draws beside its group field, doing the same thing here:
  // this is a suggestion, and the glyph says so rather than naming a language the
  // field beside it already names. The chain of spellings is the same one — `Icon`
  // throws inside a render on an undefined icon, and an empty button is the one
  // outcome a missing glyph may not have.
  const wandIcon =
    Solid.faWandMagicSparkles || Solid.faMagic || Solid.faLanguage || null;
  const languageChip =
    offered && offeredInfo ? (
      <button
        type="button"
        className="btn btn-secondary manga-tools-chip"
        aria-label={offeredInfo.name}
        title={
          t(intl, "mangaTools.translationGroup.fill") +
          " " +
          offeredInfo.name +
          " — " +
          t(intl, "mangaTools.translationGroup.suggestedLanguage") +
          " (" +
          offered.count +
          ")"
        }
        onClick={() => {
          bulkLanguage = { kind: "set", value: offered.code };
          emit();
        }}
      >
        {wandIcon ? <Icon icon={wandIcon} /> : null}
      </button>
    ) : null;

  const languageRow = (
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div
        className={cls.control + (languageChip ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          // The dialog is a scrolling modal, so the menu has to escape it.
          menuPortalTarget={document.body}
          placeholder={t(intl, "mangaTools.select.placeholder")}
          value={selected}
          options={[...options, removeOption]}
          formatOptionLabel={formatLanguageWithRemove}
          components={{ IndicatorSeparator: () => null }}
          // Clearing means "leave the language alone", exactly as clearing the
          // studio field means "leave the studio alone" — neither sends a value.
          onChange={(opt: MangaToolsOption | null) => {
            if (!opt) {
              bulkLanguage = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkLanguage = { kind: "remove" };
            } else {
              bulkLanguage = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
        {languageChip}
      </div>
    </div>
  );

  const censorshipOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];

  const censoredShown =
    bulkCensorship?.kind === "set"
      ? bulkCensorship.value
      : bulkCensorship?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedCensorshipAggregate() || "";

  const censoredSelected =
    censoredShown === BULK_REMOVE_VALUE
      ? removeOption
      : censoredShown
        ? {
            value: censoredShown,
            label: NS.censorshipLabel(intl, censoredShown),
          }
        : null;

  const censorshipRow = (
    <div className={cls.group} data-field="manga_tools_censorship">
      <label className={cls.label} htmlFor="manga_tools_censorship">
        {t(intl, "mangaTools.censorship.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_censorship"
          isClearable
          isSearchable={false}
          menuPortalTarget={document.body}
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={censoredSelected}
          options={[...censorshipOptions, removeOption]}
          formatOptionLabel={formatCensorshipWithRemove}
          components={{ IndicatorSeparator: () => null }}
          onChange={(opt: { value: string } | null) => {
            if (!opt) {
              bulkCensorship = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkCensorship = { kind: "remove" };
            } else {
              bulkCensorship = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
      </div>
    </div>
  );

  // ── The translation group, and the raw mark that is its other answer ──
  //
  // The same pair the edit page draws, in the same shape: a select, and the steak
  // beside it. What differs is that a selection can hold more than one answer, so
  // each of the two has a third state the edit page's field never has.
  //
  // `showOriginal` is asked here as the edit page asks it, because it decides two
  // things in both places: whether the chip is drawn at all, and whether the row
  // is a chip row (a select sharing its column with a button) or a plain one.
  const showOriginal = NS.fieldShowing("original");

  const groupShown =
    bulkGroup?.kind === "set"
      ? bulkGroup.value
      : bulkGroup?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedGroupAggregate() || "";

  // Raw is the reason there is no group to enter, so the box says which of the two
  // emptinesses this is — the edit page's `rawShown`, asked of what this dialog is
  // about to write rather than of one gallery's value.
  const rawState: "raw" | "notRaw" | "mixed" =
    bulkOriginal === "raw"
      ? "raw"
      : bulkOriginal === "notRaw"
        ? "notRaw"
        : selectedOriginalAggregate() === "all"
          ? "raw"
          : selectedOriginalAggregate() === "none"
            ? "notRaw"
            : "mixed";
  const rawShown = showOriginal && rawState === "raw";

  // Whether pressing again would put a group back — which the tooltip says, and it
  // is a question about *what would come back* rather than about whether raw took
  // something: a selection with no group of its own has nothing to restore, and
  // saying it would be a promise the click does not keep.
  const restoresGroup =
    !!bulkGroupBeforeRaw &&
    (bulkGroupBeforeRaw.pending
      ? bulkGroupBeforeRaw.pending.kind === "set"
      : !!selectedGroupAggregate());

  // The cycle, and **what it is keyed on is the whole of getting this right**: the
  // selection's own state, not the pending value's. Keyed on the pending value, a
  // selection where nothing is raw sat at "not raw", and the first press moved the
  // pending value to "no view" — which the aggregate then answered identically, so
  // the button did not change, and read as broken. The mark's checkbox was keyed on
  // its aggregate from the start and has the property this does now: **every press
  // changes what is drawn**, whichever state the selection is in.
  //
  // So: every gallery raw toggles raw↔not-raw, none raw toggles the other way, and a
  // mix walks keep → raw → not raw → keep. Pressing raw takes the group away, which
  // is what the field means — and remembering it is what makes the next press an
  // undo rather than a second guess, exactly as the edit page remembers the name it
  // took.
  const cycleOriginal = () => {
    const aggregate = selectedOriginalAggregate();
    const next: "raw" | "notRaw" | null =
      aggregate === "all"
        ? bulkOriginal === "notRaw"
          ? null
          : "notRaw"
        : aggregate === "none"
          ? bulkOriginal === "raw"
            ? null
            : "raw"
          : bulkOriginal === null
            ? "raw"
            : bulkOriginal === "raw"
              ? "notRaw"
              : null;

    if (next === "raw") {
      bulkGroupBeforeRaw = { pending: bulkGroup };
      bulkGroup = { kind: "remove" };
    } else if (bulkGroupBeforeRaw) {
      // Whatever raw took comes back exactly as it was — which for a selection with
      // no group of its own is "nothing pending", not a name this dialog would have
      // had to invent.
      bulkGroup = bulkGroupBeforeRaw.pending;
      bulkGroupBeforeRaw = null;
    }

    bulkOriginal = next;
    emit();
  };

  const groupValue = groupShown === BULK_REMOVE_VALUE ? "" : groupShown;
  const known = knownTranslationGroups();
  // The create entry, by the edit page's rule: only while the typed text is not a
  // group this Stash already knows, so the menu never spells one name twice.
  const namesANewGroup =
    !!groupValue &&
    !known.some((name) => NS.sameTranslationGroup(name, groupValue));

  // The grouping the edit page uses, applied to the selection's agreed language:
  // the groups whose galleries usually carry that language come first, the rest
  // keep their name order behind them. With no agreed language there is nothing to
  // sort by, and name order is what is left.
  const agreedLanguage =
    bulkLanguage?.kind === "set"
      ? bulkLanguage.value
      : bulkLanguage?.kind === "remove"
        ? ""
        : selectedLanguageAggregate() || "";
  const usualLanguages = NS.usualLanguagesOf(store);
  const usualOf = (name: string) => usualLanguages[NS.groupKey(name)];
  const matchesAgreed = (name: string) => {
    const usualHere = usualOf(name);
    return !!agreedLanguage && !!usualHere && usualHere.code === agreedLanguage;
  };
  const ordered = known
    .filter(matchesAgreed)
    .concat(known.filter((name) => !matchesAgreed(name)));

  const groupOptions: MangaToolsGroupOption[] = [
    ...(namesANewGroup
      ? [
          {
            value: groupValue,
            label: groupValue,
            createLabel:
              t(intl, "mangaTools.translationGroup.create") +
              ' "' +
              groupValue +
              '"',
          },
        ]
      : []),
    ...ordered.map((name): MangaToolsGroupOption => {
      const usualHere = usualOf(name);
      const described = usualHere
        ? NS.describe(usualHere.code, intl.locale)
        : null;
      return {
        value: name,
        label: name,
        hint: described ? { flag: described.flag, name: described.name } : null,
      };
    }),
  ];

  // The remove entry is this plugin's four-valued answer rather than the clear
  // button: clearing means "leave the group alone", and taking it off a gallery is
  // a different thing that has to be reachable — the two are opposites, exactly as
  // in the two rows above.
  const groupRemoveOption: MangaToolsGroupOption = {
    value: BULK_REMOVE_VALUE,
    label: t(intl, "mangaTools.bulk.remove"),
  };
  // The remove entry is drawn by this row, everything else by the edit page's own
  // formatter — `meta` is passed straight through, because which context a label is
  // being drawn in (the menu, or the box holding the chosen value) is what decides
  // whether the hint is there, and react-select is what knows it.
  const formatGroupWithRemove = (
    opt: MangaToolsGroupOption,
    meta?: { context?: string }
  ) =>
    opt.value === BULK_REMOVE_VALUE
      ? removeLabel
      : formatGroupOption(opt, meta);

  const steakIcon = <SteakIcon raw={rawState === "raw"} />;
  const originalChip = (
    <button
      type="button"
      className={
        "btn btn-secondary manga-tools-chip manga-tools-original" +
        (rawState === "raw" ? " active" : "") +
        (rawState === "mixed" ? " mixed" : "")
      }
      // A button's third state has a name in ARIA, and `mixed` is it — the same
      // thing the mark's checkbox says with `indeterminate`.
      aria-pressed={rawState === "mixed" ? "mixed" : rawState === "raw"}
      aria-label={t(intl, "mangaTools.translationGroup.original")}
      title={t(
        intl,
        rawState === "raw"
          ? restoresGroup
            ? "mangaTools.translationGroup.originalOffRestore"
            : "mangaTools.translationGroup.originalOff"
          : rawState === "mixed"
            ? "mangaTools.translationGroup.originalMixed"
            : "mangaTools.translationGroup.originalOn"
      )}
      onClick={cycleOriginal}
    >
      {steakIcon}
    </button>
  );

  const groupRow = (
    <div className={cls.group} data-field="manga_tools_translation_group">
      <label className={cls.label} htmlFor="manga_tools_translation_group">
        {t(intl, "mangaTools.translationGroup.heading")}
      </label>
      <div
        className={cls.control + (showOriginal ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select manga-tools-group-select"
          classNamePrefix="react-select"
          inputId="manga_tools_translation_group"
          isClearable
          isDisabled={rawShown}
          menuPortalTarget={document.body}
          placeholder={t(
            intl,
            rawShown
              ? "mangaTools.translationGroup.originalDetail"
              : "mangaTools.translationGroup.placeholder"
          )}
          value={
            groupShown === BULK_REMOVE_VALUE
              ? groupRemoveOption
              : groupValue
                ? { value: groupValue, label: groupValue }
                : null
          }
          options={[...groupOptions, groupRemoveOption]}
          formatOptionLabel={formatGroupWithRemove}
          components={{ IndicatorSeparator: () => null }}
          onInputChange={(text: string, meta: { action?: string }) => {
            if (meta?.action !== "input-change") return;
            const typed = text.trim();
            bulkGroup = typed ? { kind: "set", value: typed } : null;
            emit();
          }}
          onChange={(opt: MangaToolsGroupOption | null) => {
            if (!opt) {
              bulkGroup = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              // **Only the group.** The chip beside this box is how raw is said, and
              // taking a group off a gallery says nothing about whether it is one.
              bulkGroup = { kind: "remove" };
            } else {
              // A group picked is a gallery that was translated, which is the edit
              // page's rule: choosing a name is the other answer to "is this raw".
              bulkGroup = { kind: "set", value: opt.value };
              if (showOriginal) bulkOriginal = "notRaw";
            }
            emit();
          }}
        />
        {showOriginal ? originalChip : null}
      </div>
    </div>
  );

  // The gate in order: a warning while the reader is unmarking, the mark itself,
  // and only then the fields it guards — each of which is drawn only while its
  // own switch says so, and none of which takes another down with it. The mark
  // is not one of the four fields and is never gated on them: it is what makes a
  // gallery this plugin's at all, and a dialog that could not set it would leave
  // every gallery unmarked.
  return PluginApi.ReactDOM.createPortal(
    <>
      {tri === false && aggregate !== "none" ? (
        <div className="alert alert-warning" role="alert">
          {/* What an unmark will actually do, which is a question the settings
              answer — and the two answers are far enough apart to need two
              sentences rather than one that hedges. */}
          {t(
            intl,
            NS.deleteOnUnmark
              ? "mangaTools.bulk.unmarkWarning"
              : "mangaTools.bulk.unmarkWarningKeep"
          )}
        </div>
      ) : null}
      {mangaRow}
      {tri === true && NS.fieldShowing("language") ? languageRow : null}
      {tri === true && NS.fieldShowing("censorship") ? censorshipRow : null}
      {tri === true && NS.fieldShowing("translationGroup") ? groupRow : null}
    </>,
    host
  );
}

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
      editForm = {
        galleryId,
        values: props.values ?? {},
        onChange: props.onChange,
      };
    }
    return () => {
      editForm = null;
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
