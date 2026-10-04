/**
 * Manga Tools — the gallery list's filter sections, in the sidebar.
 *
 * Three sections — language, censorship and manga — drawn as pinned sidebar
 * filters like Stash's own studio section. They share the read/write logic in
 * filter-model.ts and the rows in filter-ui.ts; what they also share, and what
 * lives here, is the section shell: a collapsible heading, the chosen values
 * shown above the fold, and the candidate list below it.
 *
 * The three sections used to write that shell out three times. Once the manga
 * section arrived there were three callers of the same boilerplate, so it is
 * one `SidebarSection` component plus one `useSidebarSection` hook for the
 * open/closed state that goes with it.
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
  withModifier,
  withoutModifier,
} from "./filter-model";
import {
  LanguageRow,
  TAG_MARK,
  TAG_SELECTOR,
  flagOf,
  isFieldTag,
  isLanguageTag,
  matchesQuery,
  selectableOptions,
  tagText,
  visibleOptions,
} from "./filter-ui";
import type { ReactElement, ReactNode } from "react";
import type {
  MangaToolsFilterModel,
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

/** The same mark, per field: one attribute each, so a re-worded tag stays recognisable. */
const CENSORSHIP_TAG_MARK = "data-manga-tools-censorship";
const MANGA_TAG_MARK = "data-manga-tools-manga";
const GROUP_TAG_MARK = "data-manga-tools-group";
const ORIGINAL_TAG_MARK = "data-manga-tools-original";

/** Is this tag Stash's tag for the censorship criterion? */
function isCensorshipTag(tag: Element): boolean {
  return isFieldTag(tag, NS.CENSORSHIP_FIELD_NAME, CENSORSHIP_TAG_MARK);
}

/** Is this tag Stash's tag for the manga criterion? */
function isMangaTag(tag: Element): boolean {
  return isFieldTag(tag, NS.MANGA_FIELD_NAME, MANGA_TAG_MARK);
}

/** …and for the translation group's and the raw field's */
function isGroupTag(tag: Element): boolean {
  return isFieldTag(tag, NS.TRANSLATION_GROUP_FIELD_NAME, GROUP_TAG_MARK);
}

function isOriginalTag(tag: Element): boolean {
  return isFieldTag(tag, NS.ORIGINAL_FIELD_NAME, ORIGINAL_TAG_MARK);
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

/** The language tags in the list's own row */
function listLanguageTags(): Element[] {
  return listFieldTags(isLanguageTag);
}

/** The censorship tags in the list's own row */
function listCensorshipTags(): Element[] {
  return listFieldTags(isCensorshipTag);
}

/** The manga tags in the list's own row */
function listMangaTags(): Element[] {
  return listFieldTags(isMangaTag);
}

/** The translation group's and the raw field's, likewise */
function listGroupTags(): Element[] {
  return listFieldTags(isGroupTag);
}

function listOriginalTags(): Element[] {
  return listFieldTags(isOriginalTag);
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
  writeTagLabels(listLanguageTags(), labels, TAG_MARK);
}

/** Re-words the censorship tags in the list's row. See relabelTags. */
function relabelCensorshipTags(labels: string[]): void {
  writeTagLabels(listCensorshipTags(), labels, CENSORSHIP_TAG_MARK);
}

/** Re-words the manga tags in the list's row. See relabelTags. */
function relabelMangaTags(labels: string[]): void {
  writeTagLabels(listMangaTags(), labels, MANGA_TAG_MARK);
}

/** Re-words the translation group tags in the list's row. See relabelTags. */
function relabelGroupTags(labels: string[]): void {
  writeTagLabels(listGroupTags(), labels, GROUP_TAG_MARK);
}

/** Re-words the raw tags in the list's row. See relabelTags. */
function relabelOriginalTags(labels: string[]): void {
  writeTagLabels(listOriginalTags(), labels, ORIGINAL_TAG_MARK);
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

/**
 * The two steaks, drawn where a language row draws its flag.
 *
 * By class rather than by the entry file's `SteakIcon`, which this module cannot
 * reach: the artwork's rules live in the stylesheet (`.manga-tools-raw-icon` and
 * `.manga-tools-cooked-icon` set the mask and take the colour from `currentColor`),
 * so a span wearing one is the same drawing. `fa-fw` is FontAwesome's fixed width,
 * which is what the row's leading slot is sized by — the censorship section's chess
 * piece wears it for the same reason.
 */
function steakLeading(raw: boolean): ReactElement {
  return (
    <span
      className={
        "fa-fw " + (raw ? "manga-tools-raw-icon" : "manga-tools-cooked-icon")
      }
      aria-hidden="true"
    />
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
 * The gallery list's language filter, one of the sections Stash's sidebar
 * renders through its own patch container.
 *
 * Reads the current selection from the filter model it is handed — published by
 * the entry file from `FilteredGalleryList`'s output, since the container is
 * handed nothing but children — and reports changes by rewriting the URL, which
 * is the route in (see applyLanguage).
 *
 * It also repairs the two things about the filter that belong to Stash and that
 * this plugin has to make say what they mean: the criterion's identity and its
 * tag. Both are in a layout effect below.
 */
export function SidebarLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  const { intl, history, open, toggleOpen } =
    useSidebarSection(SECTION_STATE_KEY);

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  /** The search box, so focus can be put back into it after a change */
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const selection = readLanguageFilter(props.filter);

  // This field's tags, re-worded as this plugin words them. Its own conditions
  // rather than the criterion as a whole: the three fields share one criterion,
  // so a filter with a censorship in it too is the same criterion with another
  // condition on it, and the two tags are worded independently.
  const tagLabelsFor = fieldTagLabels(intl, props.filter, NS.FIELD_NAME);

  // Both of the repairs to the filter Stash owns live here, in the one surface
  // that is mounted for as long as the list is: the criterion is handed over to
  // Stash's controls (see adoptLanguageCriterion) and its tag is re-worded (see
  // relabelTags). Every change to the filter decodes into fresh criterion
  // objects, so both are repeated on each commit.
  React.useLayoutEffect(() => {
    adoptLanguageCriterion(props.filter);
    if (tagLabelsFor) relabelTags(tagLabelsFor);
  });

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;

  function update(next: MangaToolsLanguageSelection) {
    applyLanguage(props.filter, history, next);

    // Every change funnels through here, which is this component's equivalent of
    // Stash's selectHook and unselectHook both ending in setInputFocus(): the
    // cursor stays in the box so a second language can be typed straight away.
    if (!isTouchDevice() && searchRef.current) {
      searchRef.current.focus();
    }
  }

  // Thin wrappers around the shared operations, which are what actually define
  // what a click means — the dialog's card uses the same ones, so the two
  // surfaces cannot drift apart.
  function toggleInclude(code: string) {
    update(toggleIncluded(selection, code));
  }

  function toggleExclude(code: string) {
    update(toggleExcluded(selection, code));
  }

  // Two actions, not one, exactly as Stash has them: picking a modifier entry
  // sets it (its onSelect), and clicking the same entry once it sits in the
  // chosen list takes it back to the default (its onUnselect — which sets the
  // modifier back rather than toggling, so it cannot be reached from here).
  function setModifier(modifier: "any" | "none") {
    update(withModifier(selection, modifier));
  }

  function clearModifier() {
    update(withoutModifier(selection));
  }

  // The same "enabled languages" setting that limits the edit dropdown limits
  // what can be filtered on, so the two never disagree about which languages
  // this library uses. A value already in use stays visible even if it has since
  // been disabled, since otherwise the list would be filtered by something
  // invisible.
  const options = visibleOptions(intl, selection);
  const selectable = selectableOptions(selection, options);

  const chosen = selectable.filter(
    (o) => selection.included.indexOf(o.value) !== -1
  );
  const excludedChosen = selectable.filter(
    (o) => selection.excluded.indexOf(o.value) !== -1
  );
  const candidates = selectable.filter(
    (o) =>
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matchesQuery(o, query)
  );

  // (Any) and (None) are the two states a language field can be in before any
  // particular language is chosen, so Stash offers them only while nothing is
  // chosen — confirmed against a real section, where choosing two studios and
  // excluding a third left just the one hierarchical entry and neither of
  // these. Once one is picked it shows above, in the chosen list.
  const showModifiers = isEmptySelection(selection);

  // The section above the fold-away list: whatever is being asked for, in the
  // same "selected-object" shape as a chosen studio. The modifier entries are
  // shown in parentheses, exactly as Stash labels its own.
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
        flag={flagOf(o)}
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
      flag={flagOf(o)}
      state="excluded"
      onClick={() => {
        toggleExclude(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={fieldLabel(intl)}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={excludedItems}
      what="language"
    >
      {/* Stash searches its candidates server-side and debounces the input;
          these fourteen are already in memory, so filtering is immediate. */}
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
            // Enter takes the one candidate the search has narrowed to,
            // as Stash's onEnter does. Deliberately the candidates rather
            // than the modifier entries listed above them, which is what
            // Stash does too.
            if (e.key !== "Enter" || candidates.length !== 1) return;
            toggleInclude(candidates[0].value);
            setQuery("");
          }}
        />
        {query && Bootstrap ? (
          <Bootstrap.Button
            // "secondary", not the react-bootstrap default of "primary":
            // Stash's ClearableInput asks for secondary, and the primary
            // button paints this one with a solid blue background that
            // Stash's own .clearable-text-field-clear does not undo.
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
            flag={flagOf(o)}
            state="candidate"
            canExclude
            onClick={() => {
              toggleInclude(o.value);
              setQuery("");
            }}
            onExclude={() => {
              toggleExclude(o.value);
              setQuery("");
            }}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

/**
 * The gallery list's censorship filter — the language section's shape, on two
 * fixed values.
 *
 * Same mechanism as the language section (read the filter, write the URL, repair
 * the tag), minus the search box and the flag: two values need no search, and a
 * chess piece stands in for the flag.
 */
export function SidebarCensorshipFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  const { intl, history, open, toggleOpen } = useSidebarSection(
    CENSORSHIP_SECTION_STATE_KEY
  );

  const selection = readCensorshipFilter(props.filter);

  const tagLabelsFor = fieldTagLabels(
    intl,
    props.filter,
    NS.CENSORSHIP_FIELD_NAME
  );

  React.useLayoutEffect(() => {
    if (tagLabelsFor) relabelCensorshipTags(tagLabelsFor);
  });

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  function update(next: MangaToolsLanguageSelection) {
    applyCensorship(props.filter, history, next);
  }

  // The same shared operations as the language section — the meaning of a click
  // is defined there, so the two sections cannot drift apart.
  function toggleInclude(value: string) {
    update(toggleIncluded(selection, value));
  }
  function toggleExclude(value: string) {
    update(toggleExcluded(selection, value));
  }
  function setModifier(modifier: "any" | "none") {
    update(withModifier(selection, modifier));
  }
  function clearModifier() {
    update(withoutModifier(selection));
  }

  const options = censorshipOptions(intl);
  const chosen = options.filter(
    (o) => selection.included.indexOf(o.value) !== -1
  );
  const excludedChosen = options.filter(
    (o) => selection.excluded.indexOf(o.value) !== -1
  );
  // Nothing is selectable while (Any) or (None) is set — there is no particular
  // value to pick in those states — so the two values step aside the moment a
  // modifier is chosen. The same rule the language section follows, from the same
  // place: see selectableOptions.
  const candidates = selectableOptions(selection, options).filter(
    (o) =>
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1
  );

  const showModifiers = isEmptySelection(selection);

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
        leading={censorshipLeading(o.value)}
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
      leading={censorshipLeading(o.value)}
      state="excluded"
      onClick={() => {
        toggleExclude(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={censorshipHeading(intl)}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={excludedItems}
      what="censorship"
    >
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
            leading={censorshipLeading(o.value)}
            state="candidate"
            canExclude
            onClick={() => {
              toggleInclude(o.value);
            }}
            onExclude={() => {
              toggleExclude(o.value);
            }}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

/**
 * The gallery list's manga filter — a boolean section like Stash's organised.
 *
 * Two values, one of which may be chosen. The chosen one sits above the fold and
 * the other below it, and choosing one clears the other: single-select, no
 * include/exclude, no search box. The mark is a presence, so "marked" is NOT_NULL
 * and "unmarked" is IS_NULL.
 */
export function SidebarMangaFilter(props: { filter: MangaToolsFilterModel }) {
  const { intl, history, open, toggleOpen } = useSidebarSection(
    MANGA_SECTION_STATE_KEY
  );

  const state = readMangaFilter(props.filter);

  const tagLabelsFor = fieldTagLabels(intl, props.filter, NS.MANGA_FIELD_NAME);

  React.useLayoutEffect(() => {
    if (tagLabelsFor) relabelMangaTags(tagLabelsFor);
  });

  // Stash's own two words for a boolean criterion, so this reads exactly like its
  // own "organized" section — 是/否 in Chinese, 有効/無効 in Japanese. English has
  // no such message in Stash's catalogs, so the fallback is what shows there.
  const options: { value: MangaToolsMangaState; label: string }[] = [
    { value: "marked", label: message(intl, "true", "Yes") },
    { value: "unmarked", label: message(intl, "false", "No") },
  ];

  // Choosing the chosen value clears it; choosing the other moves the mark.
  function choose(value: MangaToolsMangaState) {
    applyManga(props.filter, history, state === value ? "" : value);
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
      heading={t(intl, "mangaTools.manga.isManga")}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={[]}
      what="manga"
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
 * The gallery list's raw filter: the mark's section, on the other field that is a
 * presence rather than a value.
 *
 * Raw is one thing or the other — a gallery is the original text or it is not —
 * so the filter is a choice among two plus "neither asked for", and the rows carry
 * the two steaks the edit page's button draws. The words are this plugin's rather
 * than Stash's 是/否 that the mark's section uses, because 生肉/熟肉 is what the
 * field is *called* everywhere else in the plugin, and a filter whose words differ
 * from the button that sets the same thing is two vocabularies for one field.
 */
export function SidebarOriginalFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  const { intl, history, open, toggleOpen } = useSidebarSection(
    ORIGINAL_SECTION_STATE_KEY
  );

  const state = readOriginalFilter(props.filter);

  const tagLabelsFor = fieldTagLabels(
    intl,
    props.filter,
    NS.ORIGINAL_FIELD_NAME
  );

  React.useLayoutEffect(() => {
    if (tagLabelsFor) relabelOriginalTags(tagLabelsFor);
  });

  // The two states, in the order the bulk row's cycle puts them: raw first, since
  // that is the one the field is named for.
  const options: {
    value: MangaToolsMangaState;
    label: string;
    raw: boolean;
  }[] = [
    {
      value: "marked",
      label: t(intl, "mangaTools.filter.original.raw"),
      raw: true,
    },
    {
      value: "unmarked",
      label: t(intl, "mangaTools.filter.original.cooked"),
      raw: false,
    },
  ];

  // Choosing the chosen value clears it; choosing the other moves the filter —
  // exactly the mark's rule, because it is the same kind of question.
  function choose(value: MangaToolsMangaState) {
    applyOriginal(props.filter, history, state === value ? "" : value);
  }

  const chosen = options.filter((o) => o.value === state);
  const candidates = options.filter((o) => o.value !== state);

  const chosenItems = chosen.map((o) => (
    <LanguageRow
      variant="sidebar"
      key={o.value}
      label={o.label}
      leading={steakLeading(o.raw)}
      state="included"
      canExclude={false}
      onClick={() => {
        choose(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={t(intl, "mangaTools.translationGroup.original")}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={[]}
      what="raw"
    >
      <ul>
        {candidates.map((o) => (
          <LanguageRow
            variant="sidebar"
            key={o.value}
            label={o.label}
            leading={steakLeading(o.raw)}
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
 * The translation group's options: the names the library holds, each carrying the
 * flag of its galleries' usual language — the same glyph the edit page's menu and
 * the bulk dialog's row put beside a group, from the same walk of the same store.
 *
 * A name the filter already asks for is kept even when no gallery carries it any
 * more, for the reason the language list keeps a disabled code (see
 * visibleOptions): a filter showing a value that is not in its own list is a filter
 * nobody can read. Those come in with no flag, since the store has nothing to say
 * about a group it does not hold.
 */
function translationGroupOptions(
  intl: MangaToolsIntl,
  selection: MangaToolsLanguageSelection
): MangaToolsOption[] {
  const usual = NS.usualLanguages();
  const options: MangaToolsOption[] = NS.translationGroups().map((name) => {
    const language = usual[NS.groupKey(name)];
    const described = language ? NS.describe(language.code, intl.locale) : null;
    return {
      value: name,
      label: name,
      flag: described ? described.flag : null,
    };
  });

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
 * The gallery list's translation group filter: the language section's shape, over
 * names the library defines rather than a table this plugin ships.
 *
 * Same modifier entries, same include/exclude lists, same search box — the list is
 * short enough to show and long enough that typing beats scrolling (the measured
 * library has around twenty-five groups, most of them used once or twice), and the
 * one difference that matters is that a value here is free text nobody curates. So
 * a group is offered only while some gallery carries it, and a name the filter
 * holds keeps its row regardless — see translationGroupOptions.
 */
export function SidebarTranslationGroupFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  const { intl, history, open, toggleOpen } = useSidebarSection(
    GROUP_SECTION_STATE_KEY
  );

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const selection = readGroupFilter(props.filter);

  const tagLabelsFor = fieldTagLabels(
    intl,
    props.filter,
    NS.TRANSLATION_GROUP_FIELD_NAME
  );

  React.useLayoutEffect(() => {
    if (tagLabelsFor) relabelGroupTags(tagLabelsFor);
  });

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;

  function update(next: MangaToolsLanguageSelection) {
    applyGroup(props.filter, history, next);

    if (!isTouchDevice() && searchRef.current) {
      searchRef.current.focus();
    }
  }

  function toggleInclude(name: string) {
    update(toggleIncluded(selection, name));
  }

  function toggleExclude(name: string) {
    update(toggleExcluded(selection, name));
  }

  function setModifier(modifier: "any" | "none") {
    update(withModifier(selection, modifier));
  }

  function clearModifier() {
    update(withoutModifier(selection));
  }

  const options = translationGroupOptions(intl, selection);

  // The same three lists the language section keeps: chosen, excluded, and the
  // candidates the search has not narrowed away.
  const chosen = options.filter(
    (o) => selection.included.indexOf(o.value) !== -1
  );
  const excludedChosen = options.filter(
    (o) => selection.excluded.indexOf(o.value) !== -1
  );
  const candidates = options.filter(
    (o) =>
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matchesQuery(o, query)
  );

  const showModifiers = isEmptySelection(selection);

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
        flag={flagOf(o)}
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
      flag={flagOf(o)}
      state="excluded"
      onClick={() => {
        toggleExclude(o.value);
      }}
    />
  ));

  return (
    <SidebarSection
      heading={t(intl, "mangaTools.translationGroup.heading")}
      open={open}
      onToggle={toggleOpen}
      chosenItems={chosenItems}
      excludedItems={excludedItems}
      what="translation group"
    >
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
            if (e.key !== "Enter" || candidates.length !== 1) return;
            toggleInclude(candidates[0].value);
            setQuery("");
          }}
        />
        {query && Bootstrap ? (
          <Bootstrap.Button
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
      <ul>
        {showModifiers ? (
          <LanguageRow
            variant="sidebar"
            label={t(intl, "mangaTools.filter.group.any")}
            state="candidate"
            canExclude={false}
            modifier
            onClick={() => {
              setModifier("any");
            }}
          />
        ) : null}
        {showModifiers ? (
          <LanguageRow
            variant="sidebar"
            label={t(intl, "mangaTools.filter.group.none")}
            state="candidate"
            canExclude={false}
            modifier
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
            flag={flagOf(o)}
            state="candidate"
            onClick={() => {
              toggleInclude(o.value);
            }}
            onExclude={() => {
              toggleExclude(o.value);
            }}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

// Published on the namespace so the smoke tests can exercise the tag re-wording
// without rendering a section.
NS.relabelTags = relabelTags;
NS.relabelCensorshipTags = relabelCensorshipTags;
NS.relabelMangaTags = relabelMangaTags;
NS.relabelGroupTags = relabelGroupTags;
NS.relabelOriginalTags = relabelOriginalTags;
