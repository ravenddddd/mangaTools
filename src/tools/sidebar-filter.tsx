/**
 * Manga Tools — the gallery list's filter sections, in the sidebar.
 *
 * Five sections — the mark, the language, the censorship, the translation group
 * and the raw field — drawn as pinned sidebar filters like Stash's own studio
 * section. They share the read/write logic in filter-model.ts and the rows in
 * filter-ui.ts; what they also share, and what lives here, is the section shell: a
 * collapsible heading, the chosen values shown above the fold, and the candidate
 * list below it.
 *
 * **Two shapes, not five sections.** Every one of the five is a valued field —
 * (Any)/(None), include, exclude, a list to search — or a presence: two values,
 * one of which may be chosen. `useValuedSection` and `usePresenceSection` are
 * those two shapes, `VALUED_SECTIONS` and `PRESENCE_SECTIONS` are what differs
 * between the fields, and the five exported components below are what the entry
 * file mounts by name.
 *
 * Both are **hooks that are called rather than components that are rendered**:
 * they read the section's open state and repair its tag row, so they have to be
 * hooks, and being called keeps the element tree flat, which is what the section
 * tests navigate. See the note on languageChip in fields-ui.tsx for the same rule
 * where no hook is involved.
 *
 * The three valued sections were one section written three times until they
 * became this, and writing them once turned up two places where they did not
 * agree: the group's candidates did not step aside while (Any)/(None) was set,
 * and its search box was not emptied when a row was picked. **Both were
 * oversights and both are gone** — with one function there is nothing left to
 * disagree with, and the rule the language section has always followed now holds
 * for all three: two sections must not behave differently for no reason the
 * reader can see.
 *
 * One difference is not an oversight and stays; see plainCandidates.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import {
  adoptLanguageCriterion,
  applyCensorship,
  applyGroup,
  applyLanguage,
  applyManga,
  applyOriginal,
  censorshipHeading,
  fieldLabel,
  fieldTagLabels,
  isEmptySelection,
  message,
  readCensorshipFilter,
  readGroupFilter,
  readLanguageFilter,
  readMangaFilter,
  readOriginalFilter,
  toggleExcluded,
  toggleIncluded,
  translationGroupHeading,
  withModifier,
  withoutModifier,
} from "./filter-model";
import {
  LanguageRow,
  TAG_MARK,
  TAG_SELECTOR,
  flagOf,
  isFieldTag,
  matchesQuery,
  selectableOptions,
  tagText,
  visibleOptions,
} from "./filter-ui";
import type { ReactElement, ReactNode } from "react";
import type {
  MangaToolsFilterModel,
  MangaToolsHistory,
  MangaToolsIntl,
  MangaToolsLanguageSelection,
  MangaToolsMangaState,
  MangaToolsOption,
} from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/**
 * Where a section's open/closed state is kept: the history entry's own state,
 * which is where Stash keeps the same thing for its sections — under a
 * `sectionOpen` object it owns. A separate key per section avoids colliding
 * with it and with each other.
 *
 * The choice of place matters. `history.state` survives a reload, so a reader
 * who opened the section to pick a language finds it still open afterwards,
 * which is the behaviour Stash's own sections have. It is also readable
 * synchronously on the first render, so there is nothing to correct afterwards
 * and the section does not visibly move.
 */
const SECTION_STATE_KEY = "mangaToolsLanguageOpen";
const CENSORSHIP_SECTION_STATE_KEY = "mangaToolsCensorshipOpen";
const MANGA_SECTION_STATE_KEY = "mangaToolsMangaOpen";
const GROUP_SECTION_STATE_KEY = "mangaToolsTranslationGroupOpen";
const ORIGINAL_SECTION_STATE_KEY = "mangaToolsOriginalOpen";

/**
 * Whether the reader is on a touch device.
 *
 * Mirrors Stash's ScreenUtils.isTouch, which its own sidebar filters consult
 * before moving focus back to their search box: on a touch screen that would
 * raise the keyboard after every tap, which is worse than the convenience is
 * worth.
 */
function isTouchDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * The fields whose tags this plugin re-words, and the mark it leaves on each.
 *
 * One mark per field, because a tag Stash drew for our criterion carries the
 * custom field's raw key and nothing that says which of our fields it is. The
 * mark is both how a tag is recognised on a later pass and how one section's
 * tags are told from another's.
 *
 * A table rather than four constants and four predicates: the entries differ in
 * these three strings and nothing else, and every reader of them is the same
 * loop.
 */
const TAGGED_FIELDS: { name: string; key: string; mark: string }[] = [
  { name: "language", key: NS.FIELD_NAME, mark: TAG_MARK },
  {
    name: "censorship",
    key: NS.CENSORSHIP_FIELD_NAME,
    mark: "data-manga-tools-censorship",
  },
  { name: "manga", key: NS.MANGA_FIELD_NAME, mark: "data-manga-tools-manga" },
  {
    name: "translationGroup",
    key: NS.TRANSLATION_GROUP_FIELD_NAME,
    mark: "data-manga-tools-group",
  },
  {
    name: "original",
    key: NS.ORIGINAL_FIELD_NAME,
    mark: "data-manga-tools-original",
  },
];

/** One entry above, by the name the surfaces know the field by */
function taggedField(name: string) {
  for (let i = 0; i < TAGGED_FIELDS.length; i++) {
    if (TAGGED_FIELDS[i].name === name) return TAGGED_FIELDS[i];
  }
  // Not reachable: every caller names a field the table holds.
  return TAGGED_FIELDS[0];
}

/** Is this tag Stash's tag for that field? */
function isTagOf(name: string, tag: Element): boolean {
  const field = taggedField(name);
  return isFieldTag(tag, field.key, field.mark);
}

/**
 * The tags in the list's own row — that is, everything outside the dialog — that
 * a given predicate recognises.
 *
 * The dialog's row is excluded on purpose, because the two rows mean different
 * things: this one reports the filter the list is *applied* to, which is what the
 * labels this plugin builds describe, while the dialog's reports the dialog's
 * working copy, which may be ahead of it. See manageDialogTags in
 * dialog-filter.tsx for that one.
 */
function listFieldTags(isField: (tag: Element) => boolean): Element[] {
  const all = document.querySelectorAll(TAG_SELECTOR);
  const ours: Element[] = [];

  for (let i = 0; i < all.length; i++) {
    if (all[i].closest(".edit-filter-dialog")) continue;
    if (isField(all[i])) ours.push(all[i]);
  }

  return ours;
}

/** The tags in the list's own row that belong to one field */
function listTagsOf(name: string): Element[] {
  return listFieldTags((tag) => isTagOf(name, tag));
}

/** Writes labels into tags, in order, one per tag, under the given mark */
function writeTagLabels(tags: Element[], labels: string[], mark: string): void {
  for (let i = 0; i < tags.length && i < labels.length; i++) {
    tagText(tags[i]).nodeValue = labels[i];
    tags[i].setAttribute(mark, labels[i]);
  }
}

/**
 * Re-words the tags in the list's row, which report the applied filter.
 *
 * Stash draws one tag per condition of the criterion, worded from the criterion's
 * own `getLabel` — which for a custom field is the generic sentence with the raw
 * field name in it, "plugin.mangaTools.language (custom field) is ja, en".
 * Everything else about the tag is right: it opens our card, its ✗ removes the
 * filter (see adoptLanguageCriterion). Only the words are wrong, so only the words
 * are replaced, by fieldTagLabels — one tag per condition of that field, in the
 * same order.
 *
 * In the DOM rather than through getLabel, because of *when* each is read. Stash
 * renders its tag row before this plugin is mounted — that row belongs to the
 * component that owns the filter, and this plugin mounts inside the list, which
 * itself only renders once the first query has come back. An override attached
 * during our render therefore cannot affect the tag already built in that same
 * pass, and nothing would re-render it afterwards to pick the override up. A
 * layout effect, by contrast, runs after React has written the DOM and before the
 * browser paints, which is the one moment that can still change what is on
 * screen. (It cannot change the first paint of a page *load*, which happens
 * before this plugin is mounted at all: the tag is briefly Stash's own wording
 * and is corrected when the list appears.)
 *
 * React does not undo this. On a later render it compares its own previous output
 * with the new one, so while the label it computes is unchanged it never touches
 * the text node we rewrote; and when the label does change it writes its own
 * version, which the next layout effect repairs in the same commit.
 *
 * Labels are taken in order, one per tag, because that is how Stash draws them: a
 * tag for each of the criterion's conditions, in their order.
 */
function relabelTags(labels: string[]): void {
  writeTagLabels(listTagsOf("language"), labels, TAG_MARK);
}

/** Re-words the censorship tags in the list's row. See relabelTags. */
function relabelCensorshipTags(labels: string[]): void {
  writeTagLabels(
    listTagsOf("censorship"),
    labels,
    taggedField("censorship").mark
  );
}

/** Re-words the manga tags in the list's row. See relabelTags. */
function relabelMangaTags(labels: string[]): void {
  writeTagLabels(listTagsOf("manga"), labels, taggedField("manga").mark);
}

/** Re-words the translation group tags in the list's row. See relabelTags. */
function relabelGroupTags(labels: string[]): void {
  writeTagLabels(
    listTagsOf("translationGroup"),
    labels,
    taggedField("translationGroup").mark
  );
}

/** Re-words the raw tags in the list's row. See relabelTags. */
function relabelOriginalTags(labels: string[]): void {
  writeTagLabels(listTagsOf("original"), labels, taggedField("original").mark);
}

/**
 * The filter the three sections are built from, or null until the list has
 * rendered.
 *
 * They need Stash's filter model — to read the current selection and to write
 * the URL — and the only place it exists is inside `FilteredGalleryList`, which
 * creates it and hands it to the elements that use it. The sidebar's patch
 * container is handed nothing but its children, so the entry file publishes the
 * model here from `FilteredGalleryList`'s own output: that component is rendered
 * *before* the sidebar, so the sections read the model on the same pass and
 * there is nothing to correct afterwards.
 *
 * Module state, like the tag marks above — but the alternative is the DOM: a
 * mount point looked up by class, a portal into it, and an extra render pass to
 * get it placed, which is what this replaced.
 */
let sidebarFilter: MangaToolsFilterModel | null = null;

/** Set by the entry file, once per render of the gallery list. See above. */
export function publishSidebarFilter(
  filter: MangaToolsFilterModel | null
): void {
  sidebarFilter = filter;
}

/** The filter the sections are built from, or null before the list has rendered */
export function currentSidebarFilter(): MangaToolsFilterModel | null {
  return sidebarFilter;
}

/**
 * The pieces every filter section shares: the intl and history hooks, and the
 * open/closed state read from (and written back to) the history entry's state.
 */
function useSidebarSection(stateKey: string) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const history = PluginApi.libraries.ReactRouterDOM.useHistory();

  const openState = React.useState<boolean>(() => {
    const state = history.location.state;
    const stored = state ? state[stateKey] : undefined;
    return typeof stored === "boolean" ? stored : false;
  });
  const open = openState[0];
  const setOpen = openState[1];

  /**
   * Opens or closes the section, and records the choice where Stash records its
   * own — so it survives a reload, which is what makes the section feel like it
   * remembers rather than resetting every time.
   *
   * Deliberately *not* opened just because the filter is set. Stash does no such
   * thing — nothing in it writes a section's open state except the reader's own
   * click — and deriving it here would both diverge and flicker, since a filter
   * arriving from the URL is known a render later than the first paint.
   */
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    history.replace(
      Object.assign({}, history.location, {
        state: Object.assign({}, history.location.state, {
          [stateKey]: next,
        }),
      })
    );
  }

  return { intl, history, open, toggleOpen };
}

/**
 * The section shell all three filters share.
 *
 * Markup copied from Stash's own sidebar section (CollapseButton/SidebarSection),
 * so it reads as one of them rather than as something bolted on. What differs
 * between the three — the heading, the chosen rows, and the candidate list — is
 * passed in; what is identical lives here.
 */
function SidebarSection(props: {
  heading: string;
  open: boolean;
  onToggle: () => void;
  /** The rows above the fold-away list, including any modifier entry */
  chosenItems: ReactElement[];
  excludedItems: ReactElement[];
  /** The word for the Bootstrap-missing message: "language", "censorship", … */
  what: string;
  children?: ReactNode;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot draw the " +
        props.what +
        " filter"
    );
    return null;
  }

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  return (
    <div className="sidebar-section sidebar-list-filter">
      <div className="collapse-header">
        <Bootstrap.Button
          onClick={props.onToggle}
          className="minimal collapse-button"
        >
          <Icon
            icon={props.open ? Solid.faChevronDown : Solid.faChevronRight}
            fixedWidth
          />
          <span>{props.heading}</span>
          {/* **Every section carries the mark's icon, because every section is this
              plugin's.** The sidebar is Stash's, and its own sections sit in the
              same column with the same look; a reader who has not just read the
              README has no way to tell which of the fourteen headings came from a
              plugin. The icon is the one the covers already wear, so the answer is
              a thing they have seen rather than a new vocabulary — and it is
              dimmed, because it is a label on the heading and not a control.
              A span rather than the entry file's MangaIcon for the same reason as
              the steaks above: the rule is in the stylesheet. */}
          <span
            className="manga-tools-manga-icon manga-tools-sidebar-mark"
            aria-hidden="true"
          />
        </Bootstrap.Button>
      </div>

      {/* Outside the collapse, like Stash's own sections: what is selected stays
          visible even when the list of choices is folded away. */}
      {props.chosenItems.length ? (
        <ul className="selected-list">{props.chosenItems}</ul>
      ) : null}
      {props.excludedItems.length ? (
        <ul className="selected-list excluded-list">{props.excludedItems}</ul>
      ) : null}

      <Bootstrap.Collapse in={props.open} mountOnEnter unmountOnExit>
        <div>
          <div className="queryable-candidate-list">{props.children}</div>
        </div>
      </Bootstrap.Collapse>
    </div>
  );
}

/** The chess icon for a censorship value, drawn where a language row draws its flag */
function censorshipLeading(value: string): ReactElement | null {
  const Icon = PluginApi.components.Icon;
  const icon = NS.censorshipIcon(value);
  return icon ? <Icon className="fa-fw" icon={icon} /> : null;
}

/** The censorship field's two values as options, in the order censorship.tsx lists them */
function censorshipOptions(intl: MangaToolsIntl): MangaToolsOption[] {
  return NS.CENSORSHIP_VALUES.map((value) => ({
    value,
    label: NS.censorshipLabel(intl, value),
    // No flag: the row draws a chess piece instead, via censorshipLeading.
    flag: null,
  }));
}

/**
 * A section for one of the three valued fields: language, censorship, group.
 *
 * They are the same section — (Any)/(None), an include list, an exclude list, a
 * search over the candidates, and the same four click handlers — because they are
 * the same kind of question: which of a list of values. What differs is data; see
 * VALUED_SECTIONS below.
 *
 * A **custom hook that is called, not a component that is rendered**, for the two
 * reasons usePresenceSection gives: it reads the section's open state and repairs
 * the tag row, so it must be a hook; and being called rather than rendered keeps
 * the element tree flat, which is what the section tests navigate.
 *
 * Two things are always set up and only sometimes drawn, which is the rule hooks
 * live by: the search box's state and its ref exist for every field, because a
 * hook cannot be called conditionally, and only the fields whose values are worth
 * searching draw the box. With no box the ref is null, so the focus that follows
 * every change is a no-op rather than a special case.
 */
type ValuedSectionProps = {
  filter: MangaToolsFilterModel;
  /** The field filtered on — see the table in filter-model.ts */
  fieldKey: string;
  stateKey: string;
  heading: (intl: MangaToolsIntl) => string;
  /** The word for the Bootstrap-missing message: "language", "censorship", … */
  what: string;
  read: (filter: MangaToolsFilterModel) => MangaToolsLanguageSelection;
  apply: (
    filter: MangaToolsFilterModel,
    history: MangaToolsHistory,
    selection: MangaToolsLanguageSelection
  ) => void;
  relabel: (labels: string[]) => void;
  options: (
    intl: MangaToolsIntl,
    selection: MangaToolsLanguageSelection
  ) => MangaToolsOption[];
  /** A chess icon where a flag would go, for the field whose values are not languages */
  leading?: (option: MangaToolsOption) => ReactElement | null;
  /** Whether the candidates are searchable — true where the list is long enough to type at */
  search?: boolean;
  /** A repair to the criterion Stash owns, which only the language field needs */
  adopt?: (filter: MangaToolsFilterModel) => void;
  /**
   * Whether a *candidate* row carries nothing before its label.
   *
   * The translation group's does not, and **this one is a rule rather than a
   * difference**: its list is answering "which group", while the flag a group
   * could carry is its galleries' usual language — a suggestion about a different
   * field, and the two other valued lists are the ones that draw a flag.
   *
   * Nothing is drawn either way today, because translationGroupOptions sets no
   * flag on its options; what this says is that the row would not draw one if it
   * had. 06-sidebar.js asserts the absence, which is where the rule is checked.
   */
  plainCandidates?: boolean;
};

/** What a row draws before its label: a flag, or the field's own leading mark */
function decoration(
  field: ValuedSectionProps,
  option: MangaToolsOption
): { leading?: ReactElement | null; flag?: string | null } {
  return field.leading
    ? { leading: field.leading(option) }
    : { flag: flagOf(option) };
}

function useValuedSection(props: ValuedSectionProps) {
  const { intl, history, open, toggleOpen } = useSidebarSection(props.stateKey);

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  /** The search box, so focus can be put back into it after a change */
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const selection = props.read(props.filter);

  // This field's tags, re-worded as this plugin words them. Its own conditions
  // rather than the criterion as a whole: the fields share one criterion, so a
  // filter with a censorship in it too is the same criterion with another
  // condition on it, and the two tags are worded independently.
  const tagLabelsFor = fieldTagLabels(intl, props.filter, props.fieldKey);

  // Both of the repairs to the filter Stash owns happen here, in the one surface
  // that is mounted for as long as the list is: the criterion is handed over to
  // Stash's controls (see adoptLanguageCriterion) and its tag is re-worded (see
  // relabelTags). Every change to the filter decodes into fresh criterion objects,
  // so both are repeated on each commit.
  React.useLayoutEffect(() => {
    if (props.adopt) props.adopt(props.filter);
    if (tagLabelsFor) props.relabel(tagLabelsFor);
  });

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;

  function update(next: MangaToolsLanguageSelection) {
    props.apply(props.filter, history, next);

    // Every change funnels through here, which is this component's equivalent of
    // Stash's selectHook and unselectHook both ending in setInputFocus(): the
    // cursor stays in the box so a second value can be typed straight away.
    if (!isTouchDevice() && searchRef.current) {
      searchRef.current.focus();
    }
  }

  // Thin wrappers around the shared operations, which are what actually define
  // what a click means — the dialog's card uses the same ones, so the two
  // surfaces cannot drift apart.
  function toggleInclude(value: string) {
    update(toggleIncluded(selection, value));
  }

  function toggleExclude(value: string) {
    update(toggleExcluded(selection, value));
  }

  // Two actions, not one, exactly as Stash has them: picking a modifier entry sets
  // it (its onSelect), and clicking the same entry once it sits in the chosen list
  // takes it back to the default (its onUnselect — which sets the modifier back
  // rather than toggling, so it cannot be reached from here).
  function setModifier(modifier: "any" | "none") {
    update(withModifier(selection, modifier));
  }

  function clearModifier() {
    update(withoutModifier(selection));
  }

  // A row's own click: take the value in, and get out of the reader's way. The box
  // is emptied so a second value can be typed straight away, which is the same
  // convenience the focus above is for; a field with no box has nothing to empty,
  // so this is one behaviour rather than two.
  function pick(value: string) {
    toggleInclude(value);
    setQuery("");
  }

  function unpick(value: string) {
    toggleExclude(value);
    setQuery("");
  }

  const options = props.options(intl, selection);

  // Nothing is selectable while (Any) or (None) is set — there is no particular
  // value to pick in those states, and Stash's own useCandidates returns an empty
  // list for IsNull and NotNull, which is why choosing (None) in its studio filter
  // makes the studios disappear. Every valued field follows that, or two sections
  // would behave differently for no reason the reader can see.
  //
  // It answers all three lists rather than only the candidates, which is what the
  // language section always did: a modifier is a statement that no particular
  // value is being asked for, so a value shown *beside* it would contradict it.
  // (Only a hand-built criterion can hold both — the four operations here cannot
  // produce one — which is why this has never been visible.)
  const listed = selectableOptions(selection, options);
  const chosen = listed.filter(
    (o) => selection.included.indexOf(o.value) !== -1
  );
  const excludedChosen = listed.filter(
    (o) => selection.excluded.indexOf(o.value) !== -1
  );
  const candidates = listed.filter(
    (o) =>
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matchesQuery(o, query)
  );

  // (Any) and (None) are the two states a valued field can be in before any
  // particular value is chosen, so Stash offers them only while nothing is chosen
  // — confirmed against a real section, where choosing two studios and excluding a
  // third left just the one hierarchical entry and neither of these. Once one is
  // picked it shows above, in the chosen list.
  const showModifiers = isEmptySelection(selection);

  // The section above the fold-away list: whatever is being asked for, in the same
  // "selected-object" shape as a chosen studio. The modifier entries are shown in
  // parentheses, exactly as Stash labels its own.
  const chosenItems: ReactElement[] = [];
  if (selection.modifier) {
    chosenItems.push(
      <li className="selected-object modifier-object" key="modifier">
        <a tabIndex={0} onClick={clearModifier}>
          <div className="label-group">
            <Icon className="fa-fw include-button" icon={Solid.faCheckCircle} />
            <span className="TruncatedText inline selected-object-label">
              {"(" +
                message(
                  intl,
                  "criterion_modifier_values." + selection.modifier,
                  selection.modifier === "any" ? "Any" : "None"
                ) +
                ")"}
            </span>
          </div>
        </a>
      </li>
    );
  }
  chosen.forEach((o) => {
    chosenItems.push(
      <LanguageRow
        variant="sidebar"
        key={"in-" + o.value}
        label={o.label}
        {...decoration(props, o)}
        state="included"
        onClick={() => {
          toggleInclude(o.value);
        }}
      />
    );
  });

  const excludedItems = excludedChosen.map((o) => (
    <LanguageRow
      variant="sidebar"
      key={"ex-" + o.value}
      label={o.label}
      {...decoration(props, o)}
      state="excluded"
      onClick={() => {
        toggleExclude(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={props.heading(intl)}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={excludedItems}
      what={props.what}
    >
      {props.search ? (
        /* Stash searches its candidates server-side and debounces the input;
           these are already in memory, so filtering is immediate. */
        <div className="clearable-input-group">
          <input
            ref={searchRef}
            className="clearable-text-field form-control"
            value={query}
            placeholder={message(intl, "actions.search", "Search") + "…"}
            onChange={(e: { target: { value: string } }) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e: { key?: string }) => {
              // Enter takes the one candidate the search has narrowed to, as
              // Stash's onEnter does. Deliberately the candidates rather than the
              // modifier entries listed above them, which is what Stash does too.
              if (e.key !== "Enter" || candidates.length !== 1) return;
              toggleInclude(candidates[0].value);
              setQuery("");
            }}
          />
          {query && Bootstrap ? (
            <Bootstrap.Button
              // "secondary", not the react-bootstrap default of "primary":
              // Stash's ClearableInput asks for secondary, and the primary button
              // paints this one with a solid blue background that Stash's own
              // .clearable-text-field-clear does not undo.
              variant="secondary"
              className="clearable-text-field-clear"
              title={message(intl, "actions.clear", "Clear")}
              onClick={() => {
                setQuery("");
              }}
            >
              <Icon icon={Solid.faTimes} />
            </Bootstrap.Button>
          ) : null}
        </div>
      ) : null}
      <ul>
        {showModifiers ? (
          <LanguageRow
            variant="sidebar"
            label={
              "(" + message(intl, "criterion_modifier_values.any", "Any") + ")"
            }
            state="candidate"
            modifier
            canExclude={false}
            onClick={() => {
              setModifier("any");
            }}
          />
        ) : null}
        {showModifiers ? (
          <LanguageRow
            variant="sidebar"
            label={
              "(" +
              message(intl, "criterion_modifier_values.none", "None") +
              ")"
            }
            state="candidate"
            modifier
            canExclude={false}
            onClick={() => {
              setModifier("none");
            }}
          />
        ) : null}
        {candidates.map((o) => (
          <LanguageRow
            variant="sidebar"
            key={o.value}
            label={o.label}
            {...(props.plainCandidates ? {} : decoration(props, o))}
            state="candidate"
            canExclude
            onClick={() => {
              pick(o.value);
            }}
            onExclude={() => {
              unpick(o.value);
            }}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

/**
 * The three valued sections, as data — everything the hook above needs to draw
 * one of them, which is what makes the components below a few lines apiece.
 */
const VALUED_SECTIONS: { [name: string]: Omit<ValuedSectionProps, "filter"> } =
  {
    language: {
      fieldKey: NS.FIELD_NAME,
      stateKey: SECTION_STATE_KEY,
      heading: fieldLabel,
      what: "language",
      read: readLanguageFilter,
      apply: applyLanguage,
      relabel: relabelTags,
      options: visibleOptions,
      search: true,
      adopt: adoptLanguageCriterion,
    },
    censorship: {
      fieldKey: NS.CENSORSHIP_FIELD_NAME,
      stateKey: CENSORSHIP_SECTION_STATE_KEY,
      heading: censorshipHeading,
      what: "censorship",
      read: readCensorshipFilter,
      apply: applyCensorship,
      relabel: relabelCensorshipTags,
      options: (intl) => censorshipOptions(intl),
      leading: (o) => censorshipLeading(o.value),
    },
    translationGroup: {
      fieldKey: NS.TRANSLATION_GROUP_FIELD_NAME,
      stateKey: GROUP_SECTION_STATE_KEY,
      heading: translationGroupHeading,
      what: "translation group",
      read: readGroupFilter,
      apply: applyGroup,
      relabel: relabelGroupTags,
      options: (_intl, selection) => translationGroupOptions(selection),
      search: true,
      plainCandidates: true,
    },
  };

/**
 * The gallery list's language filter, one of the sections Stash's sidebar
 * renders through its own patch container.
 *
 * Reads the current selection from the filter model it is handed — published by
 * the entry file from `FilteredGalleryList`'s output, since the container is
 * handed nothing but children — and reports changes by rewriting the URL, which
 * is the route in (see applyLanguage).
 *
 * It is also the one section that repairs the criterion Stash owns, handing it
 * over to Stash's own controls (see adoptLanguageCriterion) so that the filter it
 * sets shows as this plugin's card rather than as a generic custom field.
 */
export function SidebarLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  return useValuedSection({
    ...VALUED_SECTIONS.language,
    filter: props.filter,
  });
}

/**
 * The gallery list's censorship filter: one of the three valued sections, over
 * two fixed values.
 *
 * No search box — two values need none — and a chess piece where the others draw
 * a flag. See censorshipOptions and censorshipLeading.
 */
export function SidebarCensorshipFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  return useValuedSection({
    ...VALUED_SECTIONS.censorship,
    filter: props.filter,
  });
}

/**
 * A section for one of the two presence fields: the mark and the raw one.
 *
 * They are the same section — two values, one of which may be chosen, and
 * choosing the chosen one takes it back — because they are the same kind of
 * question. Single-select, no include/exclude, no search box: a presence has
 * nothing to list and nothing to search. What differs between the two is data;
 * see PRESENCE_SECTIONS.
 *
 * The two values are Stash's own words for a boolean criterion — 是/否 in
 * Chinese, 有効/無効 in Japanese — so this reads exactly like its own "organized"
 * section; English has no such message in Stash's catalogs, so the fallback is
 * what shows there. **A field's own vocabulary is its heading and its tag, never
 * its values**: putting 生肉/熟肉 on both sides of the question would ask it with
 * the same word twice.
 *
 * A **custom hook that is called, not a component that is rendered**, and both
 * halves of that are deliberate. It has to be a hook — it reads the section's
 * open state and repairs the tag row — and the lint rule that insists on it is
 * right: called from anywhere but a component or a hook, those calls are a bug.
 * It is *called* rather than rendered for the reason languageChip gives in
 * fields-ui.tsx: the element tree is what the section tests navigate, and a
 * component boundary here would be one more level between a section and the
 * shell it draws.
 */
type PresenceSectionProps = {
  filter: MangaToolsFilterModel;
  /** The field filtered on — see the table in filter-model.ts */
  fieldKey: string;
  stateKey: string;
  heading: (intl: MangaToolsIntl) => string;
  /** The word for the Bootstrap-missing message: "manga", "raw" */
  what: string;
  read: (filter: MangaToolsFilterModel) => MangaToolsMangaState;
  apply: (
    filter: MangaToolsFilterModel,
    history: MangaToolsHistory,
    state: MangaToolsMangaState
  ) => void;
  relabel: (labels: string[]) => void;
};

function usePresenceSection(props: PresenceSectionProps) {
  const { intl, history, open, toggleOpen } = useSidebarSection(props.stateKey);

  const state = props.read(props.filter);

  const tagLabelsFor = fieldTagLabels(intl, props.filter, props.fieldKey);

  React.useLayoutEffect(() => {
    if (tagLabelsFor) props.relabel(tagLabelsFor);
  });

  const options: { value: MangaToolsMangaState; label: string }[] = [
    { value: "marked", label: message(intl, "true", "Yes") },
    { value: "unmarked", label: message(intl, "false", "No") },
  ];

  // Choosing the chosen value clears it; choosing the other moves the filter.
  function choose(value: MangaToolsMangaState) {
    props.apply(props.filter, history, state === value ? "" : value);
  }

  // Stash's boolean filter shows the chosen value above the fold and the other
  // below it, so the two trade places rather than both sitting in one list.
  const chosen = options.filter((o) => o.value === state);
  const candidates = options.filter((o) => o.value !== state);

  const chosenItems = chosen.map((o) => (
    <LanguageRow
      variant="sidebar"
      key={o.value}
      label={o.label}
      state="included"
      canExclude={false}
      onClick={() => {
        choose(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={props.heading(intl)}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={[]}
      what={props.what}
    >
      <ul>
        {candidates.map((o) => (
          <LanguageRow
            variant="sidebar"
            key={o.value}
            label={o.label}
            state="candidate"
            canExclude={false}
            singleValue
            onClick={() => {
              choose(o.value);
            }}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

/**
 * The two presence sections, as data — everything the shell above needs to
 * draw one of them, which is what makes the components below one line apiece.
 */
const PRESENCE_SECTIONS: {
  [name: string]: Omit<PresenceSectionProps, "filter">;
} = {
  manga: {
    fieldKey: NS.MANGA_FIELD_NAME,
    stateKey: MANGA_SECTION_STATE_KEY,
    heading: (intl) => t(intl, "mangaTools.manga.isManga"),
    what: "manga",
    read: readMangaFilter,
    apply: applyManga,
    relabel: relabelMangaTags,
  },
  original: {
    fieldKey: NS.ORIGINAL_FIELD_NAME,
    stateKey: ORIGINAL_SECTION_STATE_KEY,
    heading: (intl) => t(intl, "mangaTools.filter.original.isOriginal"),
    what: "raw",
    read: readOriginalFilter,
    apply: applyOriginal,
    relabel: relabelOriginalTags,
  },
};

/**
 * The gallery list's manga filter — a boolean section like Stash's organised.
 *
 * Two values, one of which may be chosen. The mark is a presence, so "marked"
 * is NOT_NULL and "unmarked" is IS_NULL.
 */
export function SidebarMangaFilter(props: { filter: MangaToolsFilterModel }) {
  return usePresenceSection({
    ...PRESENCE_SECTIONS.manga,
    filter: props.filter,
  });
}

/**
 * The gallery list's raw filter: the mark's section, on the other field that is
 * a presence rather than a value.
 *
 * 生肉/熟肉 is what this field is *called* everywhere else in the plugin, so it is
 * what the heading and the tag say; a filter whose words differed from the button
 * that sets the same thing would be two vocabularies for one field. The values
 * stay Stash's own two, as the shell says.
 */
export function SidebarOriginalFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  return usePresenceSection({
    ...PRESENCE_SECTIONS.original,
    filter: props.filter,
  });
}

/**
 * The translation group's options: the names the library holds, and nothing else.
 *
 * **No flags**, unlike the language list beside it: the flag a group could carry is
 * its galleries' usual language, which is a *suggestion* about a different field —
 * it belongs where it is a suggestion, which is the edit page's menu and the bulk
 * dialog's row, and in a list whose job is "which group" it is one more thing to
 * read past. The names are the whole of the answer here.
 *
 * A name the filter already asks for is kept even when no gallery carries it any
 * more, for the reason the language list keeps a disabled code (see
 * visibleOptions): a filter showing a value that is not in its own list is a filter
 * nobody can read.
 */
function translationGroupOptions(
  selection: MangaToolsLanguageSelection
): MangaToolsOption[] {
  const options: MangaToolsOption[] = NS.translationGroups().map((name) => ({
    value: name,
    label: name,
    flag: null,
  }));

  const known: { [value: string]: true } = {};
  options.forEach((o) => {
    known[o.value] = true;
  });

  const asked = selection.included.concat(selection.excluded);
  asked.forEach((name) => {
    if (known[name]) return;
    known[name] = true;
    options.push({ value: name, label: name, flag: null });
  });

  return options;
}

/**
 * The gallery list's translation group filter: one of the three valued sections,
 * over names the library defines rather than a table this plugin ships.
 *
 * A group is free text nobody curates, and that is what makes it different: it is
 * offered only while some gallery carries it, and a name the filter holds keeps
 * its row regardless — see translationGroupOptions.
 */
export function SidebarTranslationGroupFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  return useValuedSection({
    ...VALUED_SECTIONS.translationGroup,
    filter: props.filter,
  });
}

// Published on the namespace so the smoke tests can exercise the tag re-wording
// without rendering a section.
NS.relabelTags = relabelTags;
NS.relabelCensorshipTags = relabelCensorshipTags;
NS.relabelMangaTags = relabelMangaTags;
NS.relabelGroupTags = relabelGroupTags;
NS.relabelOriginalTags = relabelOriginalTags;
