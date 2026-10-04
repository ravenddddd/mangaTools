/**
 * The bulk edit dialog's manga rows.
 *
 * Another plugin cannot add a field to Stash's bulk dialog, so these rows are
 * *its* rows: they are drawn by a patch that mounts them beside the dialog's own
 * rating row, they read their values from the selected galleries rather than from
 * the dialog, and their values reach the mutation through installBulkLink, which
 * rewrites the dialog's own update as it goes past. Nothing about the dialog's
 * behaviour is changed from outside that.
 *
 * What the rows are about, and the reason the whole module exists: a bulk edit
 * that sets a language on forty galleries is worth having, and Stash's dialog has
 * nowhere to put it. Everything here is about answering one question honestly —
 * what do the selected galleries *currently* carry — because a control cannot show
 * one value for a selection that holds three. Those are the `selected*Aggregate`
 * functions, and the pending state beside them, which is what the user has chosen
 * so far and nothing to do with any gallery.
 *
 * The translation group and the original-text mark are the two that are not plain
 * selectors: choosing the mark takes the group away (see bulkGroupBeforeRaw), and
 * a group can be typed rather than picked. Both behave the way the edit page's
 * field does, which is the point.
 *
 * `bulkRenders` is here rather than with the diagnostics because this is what
 * counts: a dialog on screen with a count of 0 means the RatingSystem patch never
 * fired, not that a guard said no.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { formatCensorshipOption } from "./censorship";
import {
  formatGroupOption,
  formatLanguageOption,
  readNativeFieldClasses,
  resolveSelect,
} from "./fields-ui";
import { fieldLabel } from "./filter-model";
import { SteakIcon } from "./icons";
import {
  CENSORSHIP_FIELD_NAME,
  FIELD_NAME,
  MANGA_FIELD_NAME,
  ORIGINAL_FIELD_NAME,
  TRANSLATION_GROUP_FIELD_NAME,
  censorshipOf,
  emit,
  isGalleryContext,
  knownTranslationGroups,
  pickLanguage,
  refreshAfterWrite,
  stashClient,
  store,
  useGlobalVersion,
} from "./core";
import {
  BULK_ANCHOR,
  bulkAnchor,
  bulkDialogUp,
  ensureBulkFieldHost,
} from "./hosts";
import { noteOnce } from "./patches";
import { requirePluginApi } from "../plugin-api";
import type { MangaToolsGroupOption } from "./fields-ui";
import type {
  MangaToolsApolloOperation,
  MangaToolsOption,
} from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

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
export function captureSelection(selectedIds: unknown): void {
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
export function installBulkLink(): void {
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
export function BulkFieldsRow() {
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

/** How many times the bulk rows have rendered — see diag */
export let bulkRenders = 0;
