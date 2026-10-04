/**
 * The manga block on Stash's gallery edit form.
 *
 * Stash's edit form is the only place a mark can be put on a gallery that is not
 * manga yet, so this block is the way in: it replaces the plugin's own field rows
 * with one fold holding the language, the censorship, the translation group and the
 * original-text mark, and it writes every one of them through the plugin's own
 * custom fields — never through Stash's.
 *
 * It is kept whole here rather than split: the block, the group-priority memory it
 * owns, and the option it offers are one feature, and the pieces that are *not* —
 * the flag, the option formatter, the class-name reader — are in fields-ui.tsx,
 * where the bulk dialog can reach them as well.
 *
 * See index.tsx for the CustomFieldsInput patch that renders it, and for why that
 * patch is what publishes the open form rather than this block.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import {
  Flag,
  formatGroupOption,
  formatLanguageOption,
  readNativeFieldClasses,
  resolveSelect,
} from "./fields-ui";
import { formatCensorshipOption } from "./censorship";
import { fieldLabel } from "./filter-model";
import { SteakIcon } from "./icons";
import { EDIT_ANCHOR, ensureFieldHost } from "./hosts";
import {
  CENSORSHIP_FIELD_NAME,
  FIELD_NAME,
  ORIGINAL_FIELD_NAME,
  TRANSLATION_GROUP_FIELD_NAME,
  censorshipOf,
  currentGalleryId,
  isGalleryContext,
  knownTranslationGroups,
  pickLanguage,
  refreshForSuggestions,
  store,
  useGlobalVersion,
} from "./core";
import { requirePluginApi } from "../plugin-api";
import type { CustomFieldsMap } from "./core";
import type { MangaToolsGroupOption } from "./fields-ui";
import type { MangaToolsOption } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. This module calls React.*
// as well, so the linter sees the use and no suppression is needed — unlike
// fields-ui.tsx, settings-page.tsx and censorship.tsx, where the JSX is the only use.
const React = PluginApi.React;

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
export function MangaFieldBlock(props: {
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
          // the row in the details block: the state's name rather than an empty box.
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
  // It draws a steak rather than a word: raw by default, cooked once the gallery is
  // declared the original. A picture rather than a name is the point — the fandom's
  // words for the two states are slang, and slang that only reads in one language.
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
