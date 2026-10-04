/**
 * Manga Tools — the filter model's pure logic, for all five fields.
 *
 * This module holds everything about reading one of this plugin's fields out of
 * Stash's filter model and writing it back as query parameters. Nothing here
 * touches the DOM or renders JSX; the two surfaces that use it — the sidebar
 * sections (sidebar-filter.tsx) and the dialog's Language card
 * (dialog-filter.tsx) — import it and keep their own rendering.
 *
 * **A table and two shapes.** Each field's filter is either a list of values
 * with (Any)/(None) over it, or a presence: the two are written once, and what
 * differs between the fields is data — see VALUED_FIELDS and PRESENCE_FIELDS.
 * Every field keeps its own named entry points below anyway, because the
 * surfaces and the tests know them by name, and a section asking for "the
 * censorship filter" reads better than a loop over a map.
 *
 * WHY THERE IS NO URL ENCODING HERE. Stash keeps its filter in the URL, in a `c`
 * query parameter it encodes with a private helper (translateJSON, in
 * models/list-filter/filter.ts) that swaps braces for parentheses. Rebuilding
 * that would mean reimplementing a format whose failure mode is silent — a
 * filter that just does not apply. Instead this clones the live model and asks
 * it for its own query parameters, so the encoding stays Stash's business. All
 * of that is public API on the model: `clone`, `options.criterionOptions`,
 * `makeCriterion` and `makeQueryParameters`.
 *
 * WHAT THE CONDITIONS MEAN, measured against a real library rather than assumed:
 *
 *   EQUALS     [a, b]       matches a OR b          (1 + 3 = 4 of 9 tagged)
 *   NOT_EQUALS [a, b]       excludes both, and ALSO matches galleries with no
 *                           language field at all   (1194 − 1 = 1193 for [a])
 *   NOT_NULL                galleries with a language
 *   IS_NULL                 galleries without one
 *
 * That last row is why the "exclude" here is a verbatim mirror of Stash's own
 * rather than something cleverer: excluding one language on a mostly-untagged
 * library still returns almost everything, and pretending otherwise would be
 * less honest than matching the studio filter and documenting it.
 *
 * Conditions are combined with AND, so include and exclude compose: "equals X
 * AND not-equals Y" is exactly "included X, excluded Y".
 */
import { NS } from "../languages";
import { t } from "../i18n";
import type {
  MangaToolsCriterionOption,
  MangaToolsCustomFieldCondition,
  MangaToolsFilterCriterion,
  MangaToolsFilterModel,
  MangaToolsHistory,
  MangaToolsIntl,
  MangaToolsLanguageSelection,
  MangaToolsMangaState,
} from "../plugin-api";

/** The `type` Stash's ListFilterOptions gives the custom-fields criterion */
const CUSTOM_FIELDS_TYPE = "custom_fields";

/**
 * The type this plugin registers its own criterion under, so the "edit filters"
 * dialog can offer a Language card of its own.
 *
 * Deliberately a different type from `custom_fields`, and deliberately not what
 * gets written to the URL — see registerLanguageCriterionOption.
 */
export const LANGUAGE_TYPE = "language";

export const EMPTY_SELECTION: MangaToolsLanguageSelection = {
  modifier: "",
  included: [],
  excluded: [],
};

/**
 * The fields a filter can name, as data.
 *
 * Every filter this module knows is one of two shapes, and the rest of the file
 * is those two shapes written once. What a field *is* is here; what the shape
 * *does* is below it.
 *
 * A **valued** field is a list of values with (Any)/(None) over it — the
 * language, the censorship, the translation group. The three differ in three
 * things only: where the values come from, how one reads in a tag, and which
 * criterion option the filter is attached to. The operations on a selection
 * (toggleIncluded and the rest) are shared verbatim, because they never ask
 * which field the codes belong to.
 *
 * A **presence** field is one value that means something by being there — the
 * manga mark and the raw mark. Its filter is a choice among two, marked and
 * unmarked, plus "neither asked for": two values need no include/exclude list
 * and no search box.
 *
 * Keyed by the name the surfaces know a field by, while each entry carries the
 * key it is stored under, because those are two different questions — a section
 * asks for "the censorship filter", a condition answers with
 * `plugin.mangaTools.censorship`.
 */

/** A field whose filter is a list of values with (Any)/(None) over it */
type ValuedField = {
  /** The key its values are stored under — see NS.ownField, which canonicalises it */
  key: string;
  /** What a tag calls the field itself */
  heading: (intl: MangaToolsIntl) => string;
  /**
   * What one value reads as in a tag, or null to print it as it stands.
   *
   * The group is the one that prints as it stands, and deliberately: its values
   * are names a reader typed into some gallery, so there is no table to look one
   * up in — and a name tidied for the tag would be a name that matches nothing.
   */
  valueName: (intl: MangaToolsIntl, value: string) => string | null;
};

/** A field of one value, which means something by being there */
type PresenceField = {
  key: string;
  heading: (intl: MangaToolsIntl) => string;
  /** What the tag says when the key is there, and when it is not */
  on: (intl: MangaToolsIntl) => string;
  off: (intl: MangaToolsIntl) => string;
};

const VALUED_FIELDS: { [name: string]: ValuedField } = {
  language: {
    key: NS.FIELD_NAME,
    // Stash's own word for it, out of its locale files — see fieldLabel
    heading: fieldLabel,
    valueName: (intl, code) => NS.name(code, intl.locale),
  },
  censorship: {
    key: NS.CENSORSHIP_FIELD_NAME,
    heading: censorshipHeading,
    valueName: NS.censorshipLabel,
  },
  translationGroup: {
    key: NS.TRANSLATION_GROUP_FIELD_NAME,
    heading: translationGroupHeading,
    valueName: (_intl, value) => value,
  },
};

const PRESENCE_FIELDS: { [name: string]: PresenceField } = {
  manga: {
    key: NS.MANGA_FIELD_NAME,
    // The mark's own name rather than the verb: "Manga is Marked" is the
    // sentence a reader filtering a shelf is looking for.
    heading: (intl) => t(intl, "mangaTools.manga.marked"),
    on: (intl) => t(intl, "mangaTools.filter.manga.marked"),
    off: (intl) => t(intl, "mangaTools.filter.manga.unmarked"),
  },
  original: {
    key: NS.ORIGINAL_FIELD_NAME,
    // Not the field's own name — see originalHeading, which says why
    heading: originalHeading,
    on: (intl) => t(intl, "mangaTools.filter.original.raw"),
    off: (intl) => t(intl, "mangaTools.filter.original.cooked"),
  },
};

/** The valued field a stored key names, or null for a key that is not one */
function valuedFieldOf(key: string): ValuedField | null {
  for (const name in VALUED_FIELDS) {
    if (VALUED_FIELDS[name].key === key) return VALUED_FIELDS[name];
  }
  return null;
}

/** The presence field a stored key names, or null for a key that is not one */
function presenceFieldOf(key: string): PresenceField | null {
  for (const name in PRESENCE_FIELDS) {
    if (PRESENCE_FIELDS[name].key === key) return PRESENCE_FIELDS[name];
  }
  return null;
}

/**
 * Adds a Language criterion to Stash's list filter options, so the "edit
 * filters" dialog offers a card for it alongside its own.
 *
 * Why it is reachable at all: the dialog builds its cards from
 * `getFilterOptions(mode).criterionOptions`, a module-level array, and the model
 * reaches it as `filter.options.criterionOptions`. Stash only reads `type`,
 * `messageID` and `makeCriterion` off an option, so one can be added from here
 * without the class it would normally be built from.
 *
 * What it is NOT: a criterion of our own. The card opens Stash's custom-fields
 * editor, because CriterionEditor dispatches on `instanceof CustomFieldsCriterion`
 * and that is what makeCriterion returns. So it saves knowing the field name and
 * typing it — the value is still a code typed by hand. The sidebar is the
 * interface with the dropdown; this is a way in for someone already in the dialog.
 */
export function registerLanguageCriterionOption(
  filter: MangaToolsFilterModel
): void {
  const options = filter?.options?.criterionOptions;
  if (!options) return;

  let found: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    // Guarding on the array rather than a flag of our own: it is Stash's list
    // and it outlives this call, so asking it is both simpler and correct even
    // if Stash ever keeps more than one.
    if (options[i].type === LANGUAGE_TYPE) return;
    if (options[i].type === CUSTOM_FIELDS_TYPE) found = options[i];
  }
  if (!found) return;

  // Bound to a const so the closure below keeps the non-null type.
  const customFieldsOption = found;

  const option: MangaToolsCriterionOption = {
    type: LANGUAGE_TYPE,
    messageID: "config.ui.language.heading",
    makeCriterion: () => {
      // A real CustomFieldsCriterion, so CriterionEditor renders the editor
      // Stash wrote for it and the query it produces is the one the sidebar
      // already writes.
      const criterion = customFieldsOption.makeCriterion();

      // …relabelled as ours. Stash decides whether the card is in use by
      // comparing the criterion's option *type* against the card's, so without
      // this our card would never light up — worse, it would not open at all,
      // because the card body only renders for the criterion whose type matches.
      criterion.criterionOption = option;

      // Deliberately left with no conditions. Not an oversight: an empty
      // criterion fails isValid(), so simply opening the card cannot add
      // anything to the filter — which matters because a custom-field EQUALS
      // with no value matches *nothing* (measured: 0 of 1194 galleries). The
      // value only appears when the reader picks a language, and it is Stash's
      // own editor that commits it.
      criterion.value = [];

      // Kept off the URL on purpose. Stash decodes the query string inside
      // FilteredGalleryList, before this option can be registered, so a stored
      // type of "language" would fail to resolve on a reload and the filter
      // would vanish silently. The stored type stays "custom_fields", which
      // Stash always understands; only the in-session identity is ours.
      //
      // `this`, not the captured criterion: Stash clones criteria with
      // cloneDeep before committing them, and a closure would keep pointing at
      // the original object and serialise a stale value.
      criterion.toQueryParams = function (this: MangaToolsFilterCriterion) {
        return { type: CUSTOM_FIELDS_TYPE, value: this.value };
      };

      return criterion;
    },
  };

  options.push(option);
}

/**
 * Finds the filter's criterion for language, whether it was made here or typed
 * by hand into the custom-fields card.
 *
 * Both types are accepted because they are the same criterion underneath: one
 * made by the dialog's Language card carries our label, one made by hand carries
 * the generic one. Missing either would let the two surfaces disagree about the
 * filter that is set.
 *
 * Matched on the criterion option's type rather than by importing Stash's
 * CustomFieldsCriterion class, which lives inside its bundle and is not
 * reachable from a plugin.
 */
function customFieldsCriterion(
  filter: MangaToolsFilterModel
): MangaToolsFilterCriterion | null {
  const criteria = filter?.criteria || [];
  for (let i = 0; i < criteria.length; i++) {
    const option = criteria[i]?.criterionOption;
    if (!option) continue;
    if (option.type === CUSTOM_FIELDS_TYPE || option.type === LANGUAGE_TYPE) {
      return criteria[i];
    }
  }
  return null;
}

/**
 * Is this condition about the field stored under `key`?
 *
 * Field names match case-insensitively, which is why the answer comes from
 * NS.ownField rather than from the string the condition carries.
 */
function isConditionOf(
  key: string,
  condition: MangaToolsCustomFieldCondition
): boolean {
  return !!condition && NS.ownField(condition.field) === key;
}

/** The values of a condition, as codes */
function conditionValues(condition: MangaToolsCustomFieldCondition): string[] {
  const values = condition.value || [];
  return values.map((v) => String(v));
}

/**
 * Is this criterion, as a whole, the language filter?
 *
 * *All* of its conditions, not any of them: a criterion that also carries another
 * field is not ours, and calling it ours would mislabel it and — worse — hand it
 * to Stash as the Language criterion. An empty one is not ours either; there is
 * nothing in it to recognise.
 *
 * Stricter than readLanguageFilter, which reports whatever it recognises and
 * ignores the rest. That is the right reading for a filter someone built by hand;
 * this one answers the different question "may we call this criterion ours".
 */
function isLanguageCriterion(
  criterion: MangaToolsFilterCriterion | null
): boolean {
  const conditions = criterion?.value || [];
  if (!conditions.length) return false;

  for (let i = 0; i < conditions.length; i++) {
    if (!isConditionOf(NS.FIELD_NAME, conditions[i])) return false;
  }

  return true;
}

/** The filter's criterion, if it is ours and nothing else's */
export function languageCriterionOf(
  filter: MangaToolsFilterModel
): MangaToolsFilterCriterion | null {
  const criterion = customFieldsCriterion(filter);
  return criterion && isLanguageCriterion(criterion) ? criterion : null;
}

/**
 * Hands the filter's language criterion over to Stash's own controls.
 *
 * The criterion is stored as a custom field and has to be — the query string is
 * read back before this plugin's option exists, so a stored type of "language"
 * would not resolve (see registerLanguageCriterionOption). But that leaves Stash
 * treating it as a custom field: its tag opens the custom-fields card, our card
 * never shows as the one in use, and it has no ✗ beside it. Two own properties
 * settle all three without touching the stored type.
 *
 *   criterionOption  our Language option, so everything that asks a criterion
 *                    which card it belongs to — the tag's click, the card's
 *                    remove button, the dialog's "is this in use" test — answers
 *                    "language".
 *   toQueryParams    the stored form, back to a custom field. Without it the swap
 *                    above would reach the URL and write `language` there, which
 *                    nothing can read back on a reload.
 *
 * Own properties on the criterion rather than a patch on its class, re-applied on
 * every render: each URL change decodes into fresh criteria, and the dialog works
 * on a cloneDeep of the filter, which carries own properties across.
 *
 * That it can be attached this late — after Stash has long since drawn its tag —
 * is the point: what it changes is read when the user *clicks*, not when Stash
 * renders. The tag's wording cannot rely on that and is repaired in the DOM
 * instead; see relabelTags.
 */
export function adoptLanguageCriterion(filter: MangaToolsFilterModel): void {
  const criterion = languageCriterionOf(filter);
  if (!criterion) return;
  if (
    criterion.criterionOption &&
    criterion.criterionOption.type === LANGUAGE_TYPE
  ) {
    return;
  }

  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === LANGUAGE_TYPE) option = options[i];
  }
  if (!option) return;

  criterion.criterionOption = option;
  criterion.toQueryParams = function (this: MangaToolsFilterCriterion) {
    return { type: CUSTOM_FIELDS_TYPE, value: this.value };
  };
}

/**
 * Reads one valued field's part of the filter, ignoring whatever else it holds.
 *
 * Anything this does not recognise — another field, or a modifier that is not
 * one of ours — is simply not reported, which is what makes a section safe to
 * sit alongside a hand-built custom-field filter.
 */
function readValued(
  filter: MangaToolsFilterModel,
  key: string
): MangaToolsLanguageSelection {
  const criterion = customFieldsCriterion(filter);
  if (!criterion?.value) return EMPTY_SELECTION;

  const selection: MangaToolsLanguageSelection = {
    modifier: "",
    included: [],
    excluded: [],
  };

  criterion.value.forEach((condition) => {
    if (!isConditionOf(key, condition)) return;

    if (condition.modifier === "NOT_NULL") selection.modifier = "any";
    else if (condition.modifier === "IS_NULL") selection.modifier = "none";
    else if (condition.modifier === "EQUALS") {
      selection.included = conditionValues(condition);
    } else if (condition.modifier === "NOT_EQUALS") {
      selection.excluded = conditionValues(condition);
    }
  });

  return selection;
}

/**
 * Reads one presence field's state, ignoring whatever else the filter holds.
 *
 * A presence carries one value and means one thing by being there, so "the key
 * is there" is the whole of the question — the same one NS.isOriginal asks of
 * the raw mark and NS.isManga of the mark. `NS.setField` deletes a key written
 * empty, so a gallery that stopped being the original has no key at all rather
 * than an empty one, which is what keeps the two the same question.
 */
function readPresence(
  filter: MangaToolsFilterModel,
  key: string
): MangaToolsMangaState {
  const criterion = customFieldsCriterion(filter);
  if (!criterion?.value) return "";

  let state: MangaToolsMangaState = "";
  criterion.value.forEach((condition) => {
    if (!isConditionOf(key, condition)) return;

    if (condition.modifier === "NOT_NULL") state = "marked";
    else if (condition.modifier === "IS_NULL") state = "unmarked";
  });

  return state;
}

/** Reads the language part of the filter. See readValued for the rules */
export function readLanguageFilter(
  filter: MangaToolsFilterModel
): MangaToolsLanguageSelection {
  return readValued(filter, NS.FIELD_NAME);
}

/** Reads the censorship part of the filter. See readValued */
export function readCensorshipFilter(
  filter: MangaToolsFilterModel
): MangaToolsLanguageSelection {
  return readValued(filter, NS.CENSORSHIP_FIELD_NAME);
}

/** Reads the translation group selection from the filter. See readValued */
export function readGroupFilter(
  filter: MangaToolsFilterModel
): MangaToolsLanguageSelection {
  return readValued(filter, NS.TRANSLATION_GROUP_FIELD_NAME);
}

/** Reads the manga mark's state from the filter. See readPresence */
export function readMangaFilter(
  filter: MangaToolsFilterModel
): MangaToolsMangaState {
  return readPresence(filter, NS.MANGA_FIELD_NAME);
}

/** Reads the raw state from the filter. See readPresence */
export function readOriginalFilter(
  filter: MangaToolsFilterModel
): MangaToolsMangaState {
  return readPresence(filter, NS.ORIGINAL_FIELD_NAME);
}

/**
 * Changes to a selection.
 *
 * Pure functions rather than methods on a component, because two very different
 * surfaces share this state: the sidebar section and the filter dialog's card.
 * They are laid out differently and they commit at different times — the sidebar
 * writes the URL at once, the dialog waits for Apply — but what a click *means*
 * has to be identical in both, or the two drift apart and a filter set in one is
 * not the filter the other shows. Keeping the meaning here and the rendering
 * there is what prevents that.
 */

/** Adds a language to the included list, or takes it out again */
export function toggleIncluded(
  selection: MangaToolsLanguageSelection,
  code: string
): MangaToolsLanguageSelection {
  const already = selection.included.indexOf(code) !== -1;

  return {
    modifier: "",
    included: already
      ? selection.included.filter((c) => c !== code)
      : selection.included.concat([code]),
    // A language is included or excluded, never both: EQUALS and NOT_EQUALS for
    // one value is a contradiction and matches nothing.
    excluded: selection.excluded.filter((c) => c !== code),
  };
}

/** The same, on the excluded side */
export function toggleExcluded(
  selection: MangaToolsLanguageSelection,
  code: string
): MangaToolsLanguageSelection {
  const already = selection.excluded.indexOf(code) !== -1;

  return {
    modifier: "",
    included: selection.included.filter((c) => c !== code),
    excluded: already
      ? selection.excluded.filter((c) => c !== code)
      : selection.excluded.concat([code]),
  };
}

/**
 * (Any) or (None): the two states a language field can be in with no particular
 * value asked for.
 *
 * The lists are dropped rather than kept. They cannot be expressed at the same
 * time as a modifier — only the modifier survives into the query — and quietly
 * discarding them later would be worse than making the choice visible now.
 */
export function withModifier(
  _selection: MangaToolsLanguageSelection,
  modifier: "any" | "none"
): MangaToolsLanguageSelection {
  return { modifier: modifier, included: [], excluded: [] };
}

/** Back to the default, which is "no restriction at all" */
export function withoutModifier(
  selection: MangaToolsLanguageSelection
): MangaToolsLanguageSelection {
  return {
    modifier: "",
    included: selection.included.slice(),
    excluded: selection.excluded.slice(),
  };
}

/** Is this asking for nothing? */
export function isEmptySelection(
  selection: MangaToolsLanguageSelection
): boolean {
  return (
    !selection.modifier &&
    !selection.included.length &&
    !selection.excluded.length
  );
}

/** Are these the same request? Compared as sets, so click order cannot matter */
export function sameSelection(
  a: MangaToolsLanguageSelection,
  b: MangaToolsLanguageSelection
): boolean {
  return (
    a.modifier === b.modifier &&
    sameCodes(a.included, b.included) &&
    sameCodes(a.excluded, b.excluded)
  );
}

function sameCodes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  const x = a.slice().sort();
  const y = b.slice().sort();
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * The modifier's own word, taken from Stash's messages so it agrees with the
 * wording Stash puts on the same condition — "is", "is not", "is null", "is not
 * null". An explicit list rather than a message id built from the modifier name:
 * the ids are Stash's, and this is the whole of the set this plugin produces
 * (see selectionConditions). Null for anything else, which leaves that condition
 * to Stash.
 */
function modifierWord(intl: MangaToolsIntl, modifier: string): string | null {
  if (modifier === "IS_NULL") {
    return message(intl, "criterion_modifier.is_null", "is null");
  }
  if (modifier === "NOT_NULL") {
    return message(intl, "criterion_modifier.not_null", "is not null");
  }
  if (modifier === "NOT_EQUALS") {
    return message(intl, "criterion_modifier.not_equals", "is not");
  }
  if (modifier === "EQUALS") {
    return message(intl, "criterion_modifier.equals", "is");
  }
  return null;
}

/**
 * One of the sentences a language filter is made of, in Stash's own words.
 *
 * Per condition rather than per selection, because that is how Stash draws them:
 * a criterion holding one condition gets one tag, and one holding several gets a
 * tag each — which a language filter with both picks and exclusions has. So
 * "Language is Japanese" and "Language is not Korean" are two sentences, and the
 * tag row shows both.
 *
 * Assembled from Stash's messages rather than written here, so a tag reads
 * exactly like one Stash draws. That means the criterion's localised name and the
 * modifier's own label, which is also why (Any) comes out as "is not null": that
 * is what the modifier it produces means.
 *
 * Null when the modifier is not one of ours, so a hand-built condition this
 * plugin does not understand keeps Stash's wording rather than being given one
 * that would say something else.
 */
/**
 * One condition's tag sentence, for a valued field.
 *
 * Assembled from Stash's messages rather than written here, so a tag reads
 * exactly like one Stash draws: the criterion's localised name, the modifier's
 * own label, and the values joined. That is also why (Any) comes out as "is not
 * null": that is what the modifier it produces means.
 *
 * Null when the modifier is not one of ours, so a hand-built condition this
 * plugin does not understand keeps Stash's wording rather than being given one
 * that would say something else.
 */
function valuedConditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition,
  field: ValuedField
): string | null {
  const word = modifierWord(intl, condition.modifier);
  if (word === null) return null;

  return intl.formatMessage(
    { id: "criterion_modifier.format_string" },
    {
      criterion: field.heading(intl),
      modifierString: word,
      valueString: conditionValues(condition)
        .map((value) => field.valueName(intl, value))
        .join(", "),
    }
  );
}

/**
 * One condition's tag sentence, for a presence field.
 *
 * A presence has only two conditions, NOT_NULL and IS_NULL, and its tag says
 * "marked" / "unmarked" — the field's own two words — rather than "is (not) null": the
 * latter is the *mechanism*, and a reader filtering a shelf wants the meaning.
 * Anything else is a condition this plugin does not write, and is left to
 * Stash.
 */
function presenceConditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition,
  field: PresenceField
): string | null {
  const state =
    condition.modifier === "NOT_NULL"
      ? field.on(intl)
      : condition.modifier === "IS_NULL"
        ? field.off(intl)
        : null;
  if (state === null) return null;

  return intl.formatMessage(
    { id: "criterion_modifier.format_string" },
    {
      criterion: field.heading(intl),
      modifierString: message(intl, "criterion_modifier.equals", "is"),
      valueString: state,
    }
  );
}

/**
 * One condition's tag sentence, for whichever of this plugin's fields it names.
 *
 * Dispatches on the field, because the three fields share one criterion and so
 * one criterion can carry conditions for all three. Null for a condition naming
 * a field this plugin does not own, or a modifier it has no wording for, so a
 * hand-built condition keeps Stash's wording rather than being given one that
 * would say something else.
 */
/**
 * One condition's tag sentence, for whichever of this plugin's fields it names.
 *
 * Dispatches through the table, because the fields share one criterion and so
 * one criterion can carry conditions for several of them. Null for a condition
 * naming a field this plugin does not own, or a modifier it has no wording for,
 * so a hand-built condition keeps Stash's wording rather than being given one
 * that would say something else.
 */
export function conditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition
): string | null {
  const key = NS.ownField(condition.field);

  const valued = valuedFieldOf(key);
  if (valued) return valuedConditionLabel(intl, condition, valued);

  const presence = presenceFieldOf(key);
  if (presence) return presenceConditionLabel(intl, condition, presence);

  return null;
}

/**
 * What every tag for this criterion should say, in order — or null if any of its
 * conditions is one this plugin has no wording for, in which case the whole
 * criterion is left as Stash drew it.
 */
export function tagLabels(
  intl: MangaToolsIntl,
  criterion: MangaToolsFilterCriterion
): string[] | null {
  const conditions = criterion.value || [];
  const labels: string[] = [];

  for (let i = 0; i < conditions.length; i++) {
    const label = conditionLabel(intl, conditions[i]);
    if (label === null) return null;
    labels.push(label);
  }

  return labels.length ? labels : null;
}

/**
 * One field's tag wordings, in the order Stash draws them — or null when the
 * filter says nothing about that field, or when one of its conditions is one this
 * plugin has no wording for.
 *
 * Per field rather than per criterion, because the fields share one
 * custom-fields criterion: a filter with a language and a censorship holds both
 * as conditions of the *same* criterion, and Stash draws a tag for each. A
 * section words the tags of its own field, so what it passes here has to be that
 * field's conditions — handing over the whole criterion would put another field's
 * wording on its tag, and requiring the criterion to hold nothing but this field
 * (which is what isLanguageCriterion asks, for adoption) would leave every tag
 * as Stash drew it the moment two fields were set at once.
 */
export function fieldTagLabels(
  intl: MangaToolsIntl,
  filter: MangaToolsFilterModel,
  fieldName: string
): string[] | null {
  const criterion = customFieldsCriterion(filter);
  const conditions = criterion?.value || [];
  const labels: string[] = [];

  for (let i = 0; i < conditions.length; i++) {
    if (NS.ownField(conditions[i].field) !== fieldName) continue;

    const label = conditionLabel(intl, conditions[i]);
    if (label === null) return null;
    labels.push(label);
  }

  return labels.length ? labels : null;
}

/** The conditions our selection turns into */
/**
 * The conditions a valued selection turns into.
 *
 * (Any) and (None) are a presence question rather than a value one, so they
 * become NOT_NULL / IS_NULL; anything else is the include and exclude lists,
 * which is all a value filter can say.
 */
function valuedConditions(
  key: string,
  selection: MangaToolsLanguageSelection
): MangaToolsCustomFieldCondition[] {
  if (selection.modifier === "any") {
    return [{ field: key, modifier: "NOT_NULL" }];
  }
  if (selection.modifier === "none") {
    return [{ field: key, modifier: "IS_NULL" }];
  }

  const conditions: MangaToolsCustomFieldCondition[] = [];
  if (selection.included.length) {
    conditions.push({
      field: key,
      modifier: "EQUALS",
      value: selection.included.slice(),
    });
  }
  if (selection.excluded.length) {
    conditions.push({
      field: key,
      modifier: "NOT_EQUALS",
      value: selection.excluded.slice(),
    });
  }
  return conditions;
}

/** The condition a presence state turns into, or none for "not asked for" */
function presenceConditions(
  key: string,
  state: MangaToolsMangaState
): MangaToolsCustomFieldCondition[] {
  if (state === "marked") return [{ field: key, modifier: "NOT_NULL" }];
  if (state === "unmarked") return [{ field: key, modifier: "IS_NULL" }];
  return [];
}

/** The conditions a language selection turns into. See valuedConditions */
export function selectionConditions(
  selection: MangaToolsLanguageSelection
): MangaToolsCustomFieldCondition[] {
  return valuedConditions(NS.FIELD_NAME, selection);
}

/**
 * The query parameters for the filter with this selection applied, or null when
 * the filter offers no custom-fields criterion to attach it to.
 *
 * Every language condition is replaced and the rest are kept, so this composes
 * with a hand-made custom-field filter instead of discarding it. Case variants
 * of the field name go too, so a criterion a user typed as
 * "plugin.mangaTools.Language" cannot end up holding two conditions for one
 * field.
 *
 * The model is cloned because it is Stash's live state object; mutating it in
 * place would change the filter without telling anything to re-render.
 */
/**
 * The query parameters for the filter with one field's conditions replaced.
 *
 * Every condition for that field is replaced and the rest are kept, so this
 * composes with a hand-made custom-field filter instead of discarding it. Case
 * variants of the field name go too, so a criterion a user typed as
 * "plugin.mangaTools.Language" cannot end up holding two conditions for one
 * field.
 *
 * The criterion is the *same* one for every field — there is one custom-fields
 * criterion per list, holding a condition per field — so this merges into
 * whichever is already there rather than adding a second.
 *
 * The model is cloned because it is Stash's live state object; mutating it in
 * place would change the filter without telling anything to re-render.
 *
 * `adopt` asks for this plugin's own criterion option in preference to Stash's
 * plain custom-fields one, and only the language field has one: the dialog's
 * Language card registers it, so a filter set from the sidebar shows as that
 * card rather than as a generic custom field. Falls back either way, because
 * the two are the same criterion underneath.
 */
function queryFor(
  filter: MangaToolsFilterModel,
  key: string,
  conditions: MangaToolsCustomFieldCondition[],
  adopt: boolean
): string | null {
  if (!filter || typeof filter.clone !== "function") return null;

  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
    if (adopt && options[i].type === LANGUAGE_TYPE) option = options[i];
  }
  if (!option) return null;
  const criterionOption = option;

  const next = filter.clone();
  let criterion = customFieldsCriterion(next);

  const kept: MangaToolsCustomFieldCondition[] = [];
  if (criterion?.value) {
    for (let j = 0; j < criterion.value.length; j++) {
      if (!isConditionOf(key, criterion.value[j]))
        kept.push(criterion.value[j]);
    }
  }

  const all = kept.concat(conditions);

  if (!all.length) {
    // Nothing left to say: drop the criterion rather than leave an empty one,
    // which would show as a filter tag with no meaning.
    next.criteria = (next.criteria || []).filter((c) => c !== criterion);
  } else {
    if (!criterion) {
      criterion = criterionOption.makeCriterion();
      next.criteria = (next.criteria || []).concat([criterion]);
    }
    criterion.value = all;
  }

  return next.makeQueryParameters();
}

/**
 * Reports a filter change the way Stash does it: by replacing the URL.
 *
 * Stash's own list hook re-reads the query string on every location change, so
 * this is the supported route into its filter state — and it is what makes the
 * tag, the result count, pagination and a bookmarkable URL all follow along for
 * free. `replace` rather than `push`, matching that hook, so changing a filter
 * does not fill up the back button.
 *
 * The sidebar's own filter sections take a `setFilter` callback instead, which a
 * plugin is never handed; this reaches the same state through the other door.
 *
 * `what` names the field in the one place this can fail: a list that offers no
 * custom-fields criterion to attach the filter to at all.
 */
function applyQuery(
  history: MangaToolsHistory,
  search: string | null,
  what: string
): void {
  if (search === null) {
    console.error(
      "[mangaTools] this list has no custom-fields filter, so the " +
        what +
        " filter is unavailable"
    );
    return;
  }

  history.replace(Object.assign({}, history.location, { search: search }));
}

/** The query parameters for the filter with this language selection applied */
export function languageFilterQuery(
  filter: MangaToolsFilterModel,
  selection: MangaToolsLanguageSelection
): string | null {
  return queryFor(
    filter,
    NS.FIELD_NAME,
    valuedConditions(NS.FIELD_NAME, selection),
    true
  );
}

/** Reports a language change the way Stash does it: by replacing the URL */
export function applyLanguage(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  selection: MangaToolsLanguageSelection
): void {
  applyQuery(history, languageFilterQuery(filter, selection), "language");
}

/** The query parameters for the filter with this censorship selection applied */
export function censorshipFilterQuery(
  filter: MangaToolsFilterModel,
  selection: MangaToolsLanguageSelection
): string | null {
  return queryFor(
    filter,
    NS.CENSORSHIP_FIELD_NAME,
    valuedConditions(NS.CENSORSHIP_FIELD_NAME, selection),
    false
  );
}

/** Reports a censorship change the way applyLanguage does, by replacing the URL */
export function applyCensorship(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  selection: MangaToolsLanguageSelection
): void {
  applyQuery(history, censorshipFilterQuery(filter, selection), "censorship");
}

/** The query parameters for the filter with this group selection applied */
export function groupFilterQuery(
  filter: MangaToolsFilterModel,
  selection: MangaToolsLanguageSelection
): string | null {
  return queryFor(
    filter,
    NS.TRANSLATION_GROUP_FIELD_NAME,
    valuedConditions(NS.TRANSLATION_GROUP_FIELD_NAME, selection),
    false
  );
}

/** Reports a group change the way applyLanguage does, by replacing the URL */
export function applyGroup(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  selection: MangaToolsLanguageSelection
): void {
  applyQuery(history, groupFilterQuery(filter, selection), "translation group");
}

/** The query parameters for the filter with this manga state applied */
export function mangaFilterQuery(
  filter: MangaToolsFilterModel,
  state: MangaToolsMangaState
): string | null {
  return queryFor(
    filter,
    NS.MANGA_FIELD_NAME,
    presenceConditions(NS.MANGA_FIELD_NAME, state),
    false
  );
}

/** Reports a manga change the way applyLanguage does, by replacing the URL */
export function applyManga(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  state: MangaToolsMangaState
): void {
  applyQuery(history, mangaFilterQuery(filter, state), "manga");
}

/** The query parameters for the filter with this raw state applied */
export function originalFilterQuery(
  filter: MangaToolsFilterModel,
  state: MangaToolsMangaState
): string | null {
  return queryFor(
    filter,
    NS.ORIGINAL_FIELD_NAME,
    presenceConditions(NS.ORIGINAL_FIELD_NAME, state),
    false
  );
}

/** Reports a raw change the way applyLanguage does, by replacing the URL */
export function applyOriginal(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  state: MangaToolsMangaState
): void {
  applyQuery(history, originalFilterQuery(filter, state), "raw");
}

/**
 * Localised text for the "language" label.
 *
 * Reuses config.ui.language.heading straight out of Stash's own locale files.
 * It exists in **every** locale Stash ships (en-GB, zh-CN, ja-JP, …), so this gets
 * all of Stash's UI languages for free instead of maintaining a label table here.
 * of maintaining a label table here.
 *
 * Written twice until the tools half's surfaces stopped importing from its entry
 * file — the copy here existed precisely so that this module would not have to
 * reach back into index.tsx. With the dependency running one way, the entry file
 * imports this one and the other copy is gone.
 */
export function fieldLabel(intl: MangaToolsIntl): string {
  return intl.formatMessage({
    id: "config.ui.language.heading",
    defaultMessage: "Language",
  });
}

/** The censorship field's own label — this plugin's word, since Stash has none */
export function censorshipHeading(intl: MangaToolsIntl): string {
  return t(intl, "mangaTools.censorship.heading");
}

/** The translation group's label, and the raw field's — this plugin's words too */
export function translationGroupHeading(intl: MangaToolsIntl): string {
  return t(intl, "mangaTools.translationGroup.heading");
}

/**
 * The raw field's criterion name, which is deliberately not the field's own name.
 *
 * The field's own name and its two states are the same word, so a tag built from
 * that name says the word twice and reads as a mistake. The criterion is therefore
 * the *thing being asked about* (the original text) and the values are its two
 * answers, which is the shape the censorship tag already has: the state's name
 * under the field's name.
 */
export function originalHeading(intl: MangaToolsIntl): string {
  return t(intl, "mangaTools.filter.original.heading");
}

/** Stash's own wording for the two list states, so nothing here reads as foreign */
export function message(
  intl: MangaToolsIntl,
  id: string,
  fallback: string
): string {
  return intl.formatMessage({ id: id, defaultMessage: fallback });
}

// Published on the namespace alongside the rest of the plugin's pure logic, so
// the smoke tests can exercise the read/merge rules against a stub filter model
// without rendering anything.
NS.toggleIncluded = toggleIncluded;
NS.toggleExcluded = toggleExcluded;
NS.withModifier = withModifier;
NS.withoutModifier = withoutModifier;
NS.isEmptySelection = isEmptySelection;
NS.sameSelection = sameSelection;
NS.conditionLabel = conditionLabel;
NS.tagLabels = tagLabels;
NS.fieldTagLabels = fieldTagLabels;
NS.readLanguageFilter = readLanguageFilter;
NS.languageFilterQuery = languageFilterQuery;
NS.readCensorshipFilter = readCensorshipFilter;
NS.censorshipFilterQuery = censorshipFilterQuery;
NS.readMangaFilter = readMangaFilter;
NS.mangaFilterQuery = mangaFilterQuery;
NS.readGroupFilter = readGroupFilter;
NS.groupFilterQuery = groupFilterQuery;
NS.readOriginalFilter = readOriginalFilter;
NS.originalFilterQuery = originalFilterQuery;
NS.registerLanguageCriterionOption = registerLanguageCriterionOption;
NS.adoptLanguageCriterion = adoptLanguageCriterion;
