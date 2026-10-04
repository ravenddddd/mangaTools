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
 * hold the small pieces more than one surface draws, `mark.ts` the mark and the
 * one write path, and `hosts.ts` the mount points every portal goes through.
 *
 * Every surface is a module of its own from there: the card's badge and mark
 * (cards.tsx), the toolbar switch (toolbar.tsx), the details tab's block
 * (details.tsx), the edit form's block (edit-page.tsx), the bulk dialog's rows
 * (bulk.tsx), and the settings page (settings-page.tsx). **This file is what is
 * left: the patches that mount them, and `install()`** — a surface is drawn by
 * the patch that has the right props in hand, and by no other surface.
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
import "./diag";
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import { DialogLanguageFilter } from "./dialog-filter";
import { registerLanguageCriterionOption } from "./filter-model";
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
  PLUGIN_ID,
  currentGalleryId,
  pickLanguage,
  start,
  storedIsManga,
  store,
  useGlobalVersion,
} from "./core";
import type { CustomFieldsMap } from "./core";
import { MangaToolsSettings } from "./settings-page";
import { MangaFieldBlock } from "./edit-page";
import { MangaDetailsPanel, guardedBlock } from "./details";
import { LanguageBadge, MangaPopoverMark } from "./cards";
import { CAN_WRITE, GalleryToolbar } from "./toolbar";
import { noteFired, registerPatch } from "./patches";
import { BulkFieldsRow, captureSelection } from "./bulk";
import { isMarkedNow, setEditForm } from "./mark";

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
