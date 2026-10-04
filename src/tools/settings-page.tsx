/**
 * The plugin's settings UI, rendered in place of the stock per-setting input
 * (see the PluginSettings patch in index.tsx).
 *
 * The stock UI can only render STRING/NUMBER/BOOLEAN settings one input each,
 * so "which languages are enabled" would otherwise be a comma-separated text
 * box. This renders a multiselect of flag + localised name instead, writing
 * the same comma-separated value.
 *
 * It reads NS.enabledLanguages (kept fresh by refreshSettings) and writes it
 * back through configurePlugin, which replaces the plugin's whole settings
 * map — with a single setting, that map is just { enabledLanguages }.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { emit, saveSettings, useGlobalVersion } from "./core";
import { formatLanguageOption, languageChip, resolveSelect } from "./fields-ui";
import { fieldLabel } from "./filter-model";
import { MangaIcon } from "./icons";
import { requirePluginApi } from "../plugin-api";
import type { ReactNode } from "react";
import type { MangaToolsFieldName, MangaToolsOption } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. Every use of it in this
// module is the JSX below, so the linter cannot see it — it reads as unused even
// though the transform emits a reference to it, and renaming it to `_React` (which
// is what the linter's own fix does) makes the emitted JSX look for a global.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

/**
 * A remark inside a setting's description — the one place this page says "not
 * here": the lightbox's own settings are changed on the lightbox.
 *
 * It is part of the description rather than a row of its own, because it is one
 * of the two things that sentence is saying, and it is boxed and tinted rather
 * than written in the same grey, because a line of grey prose under a longer line
 * of grey prose is a line nobody reads. The tint is the plugin's own; Stash's
 * settings page has no callout of its own to copy.
 *
 * The icon is decorative, so when the library has no glyph for it the box is drawn
 * without one rather than with a stand-in letter — unlike the "?" that opens a help
 * panel, where the glyph *is* the affordance.
 */
function SettingsNote(props: { children: ReactNode }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const icon = Solid.faInfoCircle || null;

  return (
    <span className="manga-tools-settings-note">
      {icon ? <Icon icon={icon} /> : null}
      <span>{props.children}</span>
    </span>
  );
}

/**
 * Which of this plugin's filters the gallery list's sidebar offers.
 *
 * The same control the enabled-languages setting uses — a multiselect over a
 * fixed list, written to a comma-separated string — because it is the same kind of
 * question: which of these do you want.
 *
 * **The list holds only filters whose fields are on**, and that is the whole of how
 * the two settings are allowed to disagree: a filter for a field this plugin does
 * not manage has nothing to ask about, so it is not offered here either. It is
 * deliberately *not* remembered while it is hidden — see filterShowing — so turning
 * a field off and on again brings its filter back on, at the default, rather than
 * at whatever it happened to be. That is why the write below adds the hidden names
 * back **as ticked**: what the reader cannot see, they cannot choose, and a state
 * kept in secret is worse than one that starts fresh.
 */
function SidebarFiltersSetting(props: { persist: () => void }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const persist = props.persist;
  if (!Select) return null;

  // Drawn only while some field is showing, like the performers setting on the same
  // page and for the same reason: with all four off there is nothing for a sidebar
  // filter to be about, and an empty list of nothing to choose from is worse than
  // no row. The setting itself is not forgotten — it is read again the moment a
  // field is back on.
  if (!NS.anyFieldShowing()) return null;

  const available = NS.SIDEBAR_FILTERS.filter((name) =>
    NS.fieldShowing(name as MangaToolsFieldName)
  );

  const labelOf = (name: string): string => {
    if (name === "language") return fieldLabel(intl);
    if (name === "censorship") return t(intl, "mangaTools.censorship.heading");
    if (name === "translationGroup")
      return t(intl, "mangaTools.translationGroup.heading");
    return t(intl, "mangaTools.filter.original.isOriginal");
  };

  const options = available.map((name) => ({
    value: name,
    label: labelOf(name),
    flag: null,
  }));
  const value = options.filter(
    (o) => NS.sidebarFilters === null || NS.sidebarFilters.has(o.value)
  );

  return (
    <div className="setting manga-tools-settings">
      <div className="manga-tools-settings-block">
        <h3>{t(intl, "mangaTools.settings.sidebarFilters.heading")}</h3>
        <div className="sub-heading">
          {t(intl, "mangaTools.settings.sidebarFilters.description")}
        </div>
        <div className="manga-tools-settings-control">
          <Select
            className="manga-tools-settings-select"
            classNamePrefix="react-select"
            // An id, so the tests can find this box the way they find the switches
            // rather than by reading its placeholder in one locale.
            inputId="mangaTools-sidebarFilters"
            isMulti
            isClearable
            menuPlacement="auto"
            placeholder={t(
              intl,
              "mangaTools.settings.sidebarFilters.placeholder"
            )}
            value={value}
            options={options}
            components={{ IndicatorSeparator: () => null }}
            onChange={(selected: MangaToolsOption[] | null) => {
              const ticked = (selected || []).map((o) => o.value);
              // The hidden ones are written back as on: see the note above.
              const hidden = NS.SIDEBAR_FILTERS.filter(
                (name) => available.indexOf(name as MangaToolsFieldName) === -1
              );
              const all = ticked.concat(hidden as string[]);

              NS.sidebarFilters = NS.parseSidebarFilters(
                NS.serializeSidebarFilters(all)
              );
              emit();
              persist();
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Which part of the example card a setting's help panel is about */
type HelpExample = "badge" | "mark";

/**
 * The example a help panel holds: a gallery card, drawn with Stash's own markup
 * and class names so that Stash's stylesheet draws it.
 *
 * That is the whole point of it. A claim about where the badge goes has to be believed;
 * be believed; a card drawn with the plugin's own classes would be *the plugin's
 * idea of* where the badge goes, and would keep saying so after Stash moved it.
 * With `.gallery-card`, `.gallery-card-cover`, `.gallery-card-image`,
 * `.card-popovers` and the rest — every one of them a class Stash defines, and
 * `.gallery-card-image`'s height coming from the `zoom-N` class rather than from
 * anything here — the example is a card with the cover taken out.
 *
 * Three things are deliberately not Stash's:
 *
 *   the links  the cover and the title are links to a gallery on the list; here
 *              they are spans, because there is nowhere to go. Stash's rules for
 *              them are colour and text-decoration, and the title keeps both
 *              (`.card-section-title` sets its own colour).
 *   the image  there is no gallery behind this, so the cover is a div wearing
 *              `.gallery-card-image` and a caption instead of an img with a src.
 *   the badge and the mark  these are the plugin's own, and they are drawn by the
 *              code that draws them on a real card.
 *
 * The words — the caption, the title, the description — come from the message
 * catalogues, and the language on the badge is described by NS.describe in the
 * reader's locale. Nothing here is a Chinese string in an English UI.
 *
 * `aria-hidden` because it is a picture: the setting's own description says in
 * words what this says by showing it, and the "?" that opens it is named from
 * the same catalogue entry.
 */
/**
 * The language-table code for a Stash UI locale, or "" when the table has none.
 *
 * The two are not the same vocabulary. Stash's locales name a region — `zh-CN`,
 * `en-US`, `ja-JP` — and the language table holds canonical *language* codes:
 * `zh-Hans`, `en`, `ja`. So asking the table about `zh-CN` on its own gets
 * nothing, which drew an English flag in a Simplified Chinese UI.
 *
 * Dropping subtags is the right tolerance *here* and the wrong one for a stored
 * value: languages.ts maps no aliases on purpose, so that a value this plugin did
 * not write shows up as unrecognised rather than being quietly rewritten. Nothing
 * is stored in this direction — this is the example looking for a language the
 * reader will recognise, and a reader on `zh-CN` is a reader of Simplified
 * Chinese.
 *
 * Which is what the last step is for: `zh` is neither a table code nor a script
 * in the standard, so the script comes from the region. Traditional for the three
 * places that write it, Simplified everywhere else — and `zh-Hant-HK` never
 * reaches it, having already matched `zh-Hant` on the way down.
 */
function sampleLanguageCode(uiLocale: string): string {
  const parts = String(uiLocale || "").split(/[-_]/);

  for (let n = parts.length; n > 0; n--) {
    const canonical = NS.findCanonical(parts.slice(0, n).join("-"));
    if (canonical) return canonical;
  }

  if ((parts[0] || "").toLowerCase() === "zh") {
    const region = (parts[1] || "").toUpperCase();
    return region === "TW" || region === "HK" || region === "MO"
      ? "zh-Hant"
      : "zh-Hans";
  }

  return "";
}

function HelpExampleCard(props: { highlight: HelpExample }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  // The sample gallery is the reader's own language when the language table has
  // it — a flag and a name they recognise rather than a stranger's — and English
  // when it does not. `known` is the whole point of the check: an unknown value
  // describes itself as the raw code, so a UI in a language this plugin has no
  // entry for would draw its badge as `de-DE`, which is the chip for *bad data*.
  const locale = intl.locale;
  const code = sampleLanguageCode(locale);
  const sample =
    (code ? NS.describe(code, locale) : null) ||
    NS.describe("en", locale) ||
    undefined;

  // The badge and the mark are ringed, not spotlit: the card around them stays
  // readable, and "which of these two is it" is the question the panel answers.
  // No `position` in this: the badge is absolutely positioned in the cover's
  // corner, and saying otherwise would drop it into the flow.
  const lit = (which: HelpExample) =>
    props.highlight === which ? " manga-tools-help-lit" : "";

  // The counting buttons, with the box Stash wraps them in. `tabIndex={-1}`
  // because these are a picture of a row of buttons: they are inside an
  // `aria-hidden` box, and something focusable in there is a tab stop that leads
  // nowhere.
  const count = (cls: string, icon: unknown, n: number) => (
    <span className={cls}>
      <button type="button" tabIndex={-1} className="minimal btn btn-primary">
        {icon ? <Icon icon={icon} /> : null}
        <span>{n}</span>
      </button>
    </span>
  );

  return (
    <div className="manga-tools-help-card" aria-hidden="true">
      {/* The zoom class still gives the cover its height — that is Stash's own
          `zoom-1`, 240px — and the width is that same number, so the cover is
          square and the card is not stretched by a portrait one. The list's own
          zoom-1 card is wider than this (340) and therefore wider than it is
          tall; the example is deliberately the compact version of the same card,
          at the same cover height. */}
      <div
        className="gallery-card card grid-card zoom-1"
        style={{ width: 240 }}
      >
        <div className="thumbnail-section">
          <span className="gallery-card-header">
            <div className="gallery-card-cover">
              <div className="gallery-card-image manga-tools-help-cover">
                {t(intl, "mangaTools.settings.help.cover")}
              </div>
            </div>
          </span>
          {sample ? languageChip(sample, lit("badge").trim()) : null}
        </div>
        <div className="card-section">
          <h5 className="card-section-title flex-aligned">
            <div className="TruncatedText" style={{ WebkitLineClamp: 2 }}>
              {t(intl, "mangaTools.settings.help.card.title")}
            </div>
          </h5>
          {/* The date alone: a card whose gallery has no description draws
              exactly this, so leaving it out is not leaving anything out. */}
          <div className="gallery-card__details">
            <span className="gallery-card__date">
              {t(intl, "mangaTools.settings.help.card.date")}
            </span>
          </div>
        </div>
        <hr />
        <div role="group" className="card-popovers btn-group">
          {count("image-count", Solid.faImage || null, 32)}
          {count("tag-count", Solid.faTag || null, 11)}
          <span className={"manga-tools-popover-slot" + lit("mark")}>
            <button
              type="button"
              tabIndex={-1}
              className="minimal btn btn-primary manga-tools-mark"
            >
              <MangaIcon />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * A "?" beside a setting's heading, holding an example of what the setting is
 * about.
 *
 * The panel is opened by CSS — hover, or focus for a keyboard and a finger — so
 * nothing here is stateful: the question mark is a real <button> so that it can
 * be tabbed to and tapped, and everything else is in the stylesheet. That is
 * also what makes it testable, since the smoke tests' React stub has state
 * setters that do nothing.
 *
 * The wording is not gone, it is off the screen: it is the button's own name,
 * read out to anyone who cannot see the picture. The icon gets a wrapping
 * <button aria-label> rather than a title on the glyph, because Icon spreads what
 * it is given onto an <svg> and a title on an SVG is shown by some browsers and
 * not others. With no glyph to draw the "?" is written as text, so the panel is
 * never unreachable — the same reasoning as the wand button in MangaFieldBlock.
 */
function HelpIcon(props: { text: string; example: HelpExample }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const icon = Solid.faQuestionCircle || null;

  return (
    <span className="manga-tools-help">
      <button
        type="button"
        className="manga-tools-help-button"
        aria-label={props.text}
      >
        {icon ? <Icon icon={icon} /> : "?"}
      </button>
      <span className="manga-tools-help-panel">
        <HelpExampleCard highlight={props.example} />
      </span>
    </span>
  );
}

/**
 * One on/off setting, laid out exactly like Stash's own BooleanSetting
 * (Settings/Inputs.tsx): a `.setting` row with the heading on the left and the
 * switch pushed to the right by Stash's own CSS.
 */
function BooleanSetting(props: {
  id: string;
  heading: string;
  /** The description — a string, or a string with a note set off inside it */
  subHeading?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * The "?" beside the heading: the wording it is named by, and which part of the
   * example card it opens. One prop rather than two, so that a help icon cannot
   * be drawn with nothing to show.
   */
  help?: { text: string; example: HelpExample };
  /**
   * Set when this row opens a group the reader can fold — see FoldIcon. Absent
   * for a row with nothing under it, which is what keeps the chevron off.
   */
  fold?: { folded: boolean; onToggle: () => void };
  /**
   * Set by SettingSwitch for every row it draws: this one is a section of the page
   * rather than one of a group's rows, which is what the stylesheet reads to decide
   * where a line goes (see mangaTools.css). A row that has no rows under it — the
   * lightbox and the chapters tab, since their notes moved into their descriptions —
   * is still a section.
   */
  head?: boolean;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot render the settings switches"
    );
    return null;
  }

  // A plain string when nothing hangs off it — see the note on the h3 below.
  const heading = props.help ? (
    <>
      {props.heading}
      <HelpIcon text={props.help.text} example={props.help.example} />
    </>
  ) : (
    props.heading
  );

  return (
    // `manga-tools-setting` is what the stylesheet needs to undo Stash's
    // `flex-wrap: wrap` on a plugin's rows, which puts a switch with a long
    // sub-heading on a line of its own — see the rule in mangaTools.css.
    <div
      className={
        "setting manga-tools-setting" +
        (props.head ? " manga-tools-setting-head" : "")
      }
    >
      {/* The heading and its description are one click target while there is a
          group to fold: the chevron alone is a small thing to hit, and clicking a
          heading to fold what is under it is what everyone tries. The switch's own
          column is a separate element, so it does not take part. */}
      <div
        className={props.fold ? "manga-tools-foldable" : undefined}
        onClick={props.fold ? props.fold.onToggle : undefined}
      >
        {/* The heading is a plain string when nothing hangs off it — a heading that
            is an array with a null in it is a different shape to every other one on
            the page, and to anything reading the text of one. */}
        {/* The chevron and the heading share a row of their own, and that row is what
            the chevron is positioned against — so it is centred on the heading's
            line and not on the box around it, which also holds the description. It is
            not inside the h3: that would make the heading an array with an element in
            front of the text, and a third shape for anything reading one. */}
        {props.fold ? (
          <div className="manga-tools-heading-line">
            <FoldIcon
              folded={props.fold.folded}
              onToggle={props.fold.onToggle}
            />
            <h3>{heading}</h3>
          </div>
        ) : (
          <h3>{heading}</h3>
        )}
        {props.subHeading ? (
          <div className="sub-heading">{props.subHeading}</div>
        ) : null}
      </div>
      <div>
        <Bootstrap.Form.Switch
          id={props.id}
          checked={props.checked}
          onChange={() => {
            props.onChange(!props.checked);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Which groups the reader has folded shut, by the id of the row that opens them.
 *
 * View state, and nothing else: it is not a setting, it never reaches Stash's
 * configuration, and a page that starts folded would be hiding settings that are
 * on. It lives out here rather than in React's state for the reason the settings
 * themselves do — this page is redrawn from `emit()` on every switch, and the
 * smoke tests' React stub has no working state setter, so anything held inside a
 * component would be either lost or untestable. `NS.*` is the pattern; this is the
 * same pattern with a set.
 */
const foldedGroups = new Set<string>();

function setGroupFolded(id: string, folded: boolean): void {
  if (folded) foldedGroups.add(id);
  else foldedGroups.delete(id);
  emit();
}

/** The "⌄/›" a row that opens a group carries, in the gutter before its heading */
function FoldIcon(props: { folded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={"manga-tools-fold" + (props.folded ? " is-folded" : "")}
      aria-expanded={!props.folded}
      onClick={(event) => {
        // The heading beside it toggles too (clicking a heading to fold what is
        // under it is the thing everyone tries), so this one stops there.
        event.stopPropagation();
        props.onToggle();
      }}
    >
      <span className="fa-icon" />
    </button>
  );
}

/**
 * A switch and the rows that only mean anything under it.
 *
 * The rows are *rendered* only while the switch is on — what a reader has not
 * turned on is not on the page — and that is deliberately the only thing the
 * switch does to them. Nothing here writes their values: a feature turned off and
 * on again comes back with the settings it had, which is the same promise the four
 * field switches make about the field values.
 *
 * They go in Stash's own `.setting-group`, which is the class whose styling makes
 * a row read as belonging to the one above it rather than as more of the page.
 * That is also why the rows that are *not* one thing's sub-settings — the mark's
 * three, the display rows — are not wrapped: they are siblings, and wrapping them
 * would say they were children.
 *
 * The chevron beside the heading is the reader's own fold, and it is only drawn
 * when there is something under the row to fold — a row whose rows are missing
 * because the feature is off has no chevron, so there is never a chevron that
 * opens nothing. Folding is not the switch: the switch says whether the plugin
 * does the thing, the chevron says whether you are looking at it.
 */
function SettingSwitch(props: {
  id: string;
  heading: string;
  subHeading?: ReactNode;
  help?: { text: string; example: HelpExample };
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The rows under it, drawn only while `checked` */
  children?: ReactNode;
}) {
  const rows = props.checked && props.children ? props.children : null;
  const folded = foldedGroups.has(props.id);
  const fold = rows
    ? { folded, onToggle: () => setGroupFolded(props.id, !folded) }
    : undefined;

  return (
    <>
      <BooleanSetting
        id={props.id}
        heading={props.heading}
        subHeading={props.subHeading}
        help={props.help}
        checked={props.checked}
        onChange={props.onChange}
        head
        fold={fold}
      />
      {rows && !folded ? (
        <div className="setting-group manga-tools-settings-group">{rows}</div>
      ) : null}
    </>
  );
}

/**
 * A heading that groups the rows under it without being a setting itself: the mark's
 * behaviour, and how the manga blocks are shown. Its rows are not one thing's
 * sub-settings — they are siblings, and there is no switch to own them — so the
 * heading is all there is to click, and the chevron is the only control it carries.
 *
 * The rows go in a plain wrapper rather than in Stash's `.setting-group`, and that
 * matters twice over. `.setting-group > .setting:not(:first-child)` would indent the
 * second row on and leave the first one out; and the wrapper is where the indent
 * comes from instead, as padding, so that these rows sit one level in from their
 * heading — like a group's rows do — and end at the same right edge as everything
 * else (see `.manga-tools-settings-body` in the stylesheet).
 */
function SettingsGroup(props: {
  /** Which fold this is, in `foldedGroups` — not a setting id */
  id: string;
  heading: string;
  subHeading?: string;
  children?: ReactNode;
}) {
  const folded = foldedGroups.has(props.id);

  return (
    <>
      <SettingsHeading
        heading={props.heading}
        subHeading={props.subHeading}
        fold={{
          folded,
          onToggle: () => setGroupFolded(props.id, !folded),
        }}
      />
      {folded ? null : (
        <div className="manga-tools-settings-body">{props.children}</div>
      )}
    </>
  );
}

function SettingsHeading(props: {
  heading: string;
  subHeading?: string;
  /** Set when the heading opens a group — see SettingsGroup, which is what uses it */
  fold?: { folded: boolean; onToggle: () => void };
}) {
  return (
    <div
      className={
        "manga-tools-settings-heading" +
        (props.fold ? " manga-tools-foldable" : "")
      }
      onClick={props.fold ? props.fold.onToggle : undefined}
    >
      {/* As in BooleanSetting: the chevron shares a row with the heading, and it is
          that row it is positioned against. */}
      {props.fold ? (
        <div className="manga-tools-heading-line">
          <FoldIcon folded={props.fold.folded} onToggle={props.fold.onToggle} />
          <h3>{props.heading}</h3>
        </div>
      ) : (
        <h3>{props.heading}</h3>
      )}
      {props.subHeading ? (
        <div className="sub-heading">{props.subHeading}</div>
      ) : null}
    </div>
  );
}

/** The ids `foldedGroups` holds the two headings' folds under — not setting ids */
const MARK_GROUP_ID = "mangaTools-markGroup";
const DISPLAY_GROUP_ID = "mangaTools-displayGroup";

export function MangaToolsSettings() {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();

  /**
   * Writes every setting at once — see `saveSettings`, which is where the map is built
   * and which is also what the reading half's own writes go through. It is not the
   * settings *page*'s map: the reader's settings are on it too, and a page that saved
   * only its own would take them with it.
   */
  function persist() {
    saveSettings();
  }

  /**
   * What every switch on this page does: the new value into the live namespace
   * first — so the page, and every other surface reading it, redraws in the same
   * pass — and then the whole map to Stash.
   */
  function writeFlag(into: (next: boolean) => void) {
    return (next: boolean) => {
      into(next);
      emit();
      persist();
    };
  }

  const options: MangaToolsOption[] = NS.languageOptions(intl.locale);
  const enabled = NS.enabledLanguages;
  // null (no restriction) renders an empty box whose placeholder reads
  // "All languages", rather than filling the box with every tag. A non-empty
  // selection renders exactly those tags.
  const value = enabled ? options.filter((o) => enabled?.has(o.value)) : [];

  if (!Select) return null;

  // No description on a field's own switch: heading and switch is the whole of
  // what it has to say, and what turning one off does — including that the values
  // stay on the galleries — is said once, on the master switch above.
  const field = (
    id: string,
    heading: string,
    showing: () => boolean,
    set: (next: boolean) => void
  ) => (
    <BooleanSetting
      id={id}
      heading={heading}
      checked={showing()}
      onChange={writeFlag(set)}
    />
  );

  return (
    <>
      {/* ── The lightbox ─────────────────────────────────────────────────── */}
      {/* No children: where the lightbox's own settings live is not a sub-setting
          and not a row of its own — it is the second half of this row's
          description, set off as a note. See the lightbox's own note string, which
          says "not here" and would otherwise have been a line of grey prose. */}
      <SettingSwitch
        id="mangaTools-readerTakeover"
        heading={t(intl, "mangaTools.settings.readerTakeover.heading")}
        subHeading={
          <>
            {t(intl, "mangaTools.settings.readerTakeover.description")}
            <SettingsNote>
              {t(intl, "mangaTools.settings.readerTakeover.note")}
            </SettingsNote>
          </>
        }
        checked={NS.readerTakeover}
        onChange={writeFlag((next) => {
          NS.readerTakeover = next;
        })}
      />

      {/* ── The chapters tab ─────────────────────────────────────────────── */}
      {/* No children, and a boxed note inside the description — the same shape as
          the lightbox above, because it is the same kind of sentence: what this
          row is about, said in one more line. What it used to be was a row of its
          own under the switch, with `role="alert"` on it, which is a role for a
          message that appears in response to something rather than for a sentence
          that is always part of the row. */}
      <SettingSwitch
        id="mangaTools-manageChapters"
        heading={t(intl, "mangaTools.settings.manageChapters.heading")}
        subHeading={
          <>
            {t(intl, "mangaTools.settings.manageChapters.description")}
            <SettingsNote>
              {t(intl, "mangaTools.settings.manageChapters.note")}
            </SettingsNote>
          </>
        }
        checked={NS.manageChapters}
        onChange={writeFlag((next) => {
          NS.manageChapters = next;
        })}
      />

      {/* ── The four fields, and how what they hold is shown ─────────────── */}
      <SettingSwitch
        id="mangaTools-fields"
        heading={t(intl, "mangaTools.settings.fields.heading")}
        subHeading={t(intl, "mangaTools.settings.fields.description")}
        checked={NS.fields}
        onChange={writeFlag((next) => {
          NS.fields = next;
        })}
      >
        <SettingSwitch
          id="mangaTools-fieldLanguage"
          heading={fieldLabel(intl)}
          checked={NS.fieldLanguage}
          onChange={writeFlag((next) => {
            NS.fieldLanguage = next;
          })}
        >
          <div className="setting manga-tools-settings">
            <div className="manga-tools-settings-block">
              <h3>{t(intl, "mangaTools.settings.enabledLanguages.heading")}</h3>
              <div className="sub-heading">
                {t(intl, "mangaTools.settings.enabledLanguages.description")}
              </div>
              <div className="manga-tools-settings-control">
                <Select
                  className="manga-tools-settings-select"
                  classNamePrefix="react-select"
                  isMulti
                  isClearable
                  // Flip the menu above the control when there is not enough room
                  // below (the plugin is usually the last entry on the page).
                  menuPlacement="auto"
                  placeholder={t(
                    intl,
                    "mangaTools.settings.enabledLanguages.placeholder"
                  )}
                  value={value}
                  options={options}
                  formatOptionLabel={formatLanguageOption}
                  components={{ IndicatorSeparator: () => null }}
                  onChange={(selected: MangaToolsOption[] | null) => {
                    const codes = (selected || []).map((o) => o.value);

                    // Reflect the change immediately (the dropdown and this UI
                    // both read NS.enabledLanguages), then persist it.
                    NS.enabledLanguages = NS.parseEnabledLanguages(
                      NS.serializeEnabledLanguages(codes)
                    );
                    emit();
                    persist();
                  }}
                />
              </div>
            </div>
          </div>

          <BooleanSetting
            id="mangaTools-showFlags"
            heading={t(intl, "mangaTools.settings.showFlags.heading")}
            subHeading={t(intl, "mangaTools.settings.showFlags.description")}
            checked={NS.showFlags}
            onChange={writeFlag((next) => {
              NS.showFlags = next;
            })}
          />

          <BooleanSetting
            id="mangaTools-showCoverBadge"
            heading={t(intl, "mangaTools.settings.showCoverBadge.heading")}
            subHeading={t(
              intl,
              "mangaTools.settings.showCoverBadge.description"
            )}
            help={{
              text: t(intl, "mangaTools.settings.showCoverBadge.help"),
              example: "badge",
            }}
            checked={NS.showCoverBadge}
            onChange={writeFlag((next) => {
              NS.showCoverBadge = next;
            })}
          />
        </SettingSwitch>

        {field(
          "mangaTools-fieldCensorship",
          t(intl, "mangaTools.censorship.heading"),
          () => NS.fieldCensorship,
          (next) => {
            NS.fieldCensorship = next;
          }
        )}

        {field(
          "mangaTools-fieldTranslationGroup",
          t(intl, "mangaTools.translationGroup.heading"),
          () => NS.fieldTranslationGroup,
          (next) => {
            NS.fieldTranslationGroup = next;
          }
        )}

        {field(
          "mangaTools-fieldOriginal",
          t(intl, "mangaTools.translationGroup.original"),
          () => NS.fieldOriginal,
          (next) => {
            NS.fieldOriginal = next;
          }
        )}

        {/* Four rows that are not fields: they decide how the manga blocks are
            shown — and, for the last of them, what happens to a field that is off — so
            they belong to the feature rather than to any one field, and they get a
            heading instead of a switch to say so: a heading that folds, like the
            mark's, because it is the same kind of group.

            The first two have no description, which is not an oversight: the heading
            already says what the switch does ("start expanded", "start expanded"), and
            a sentence restating it was a line of grey prose under every row. The
            wording that *was* there — that this decides the state a block opens in and
            not whether it can be opened — is in the README, where a reader who wants
            to know it will look. */}
        <SettingsGroup
          id={DISPLAY_GROUP_ID}
          heading={t(intl, "mangaTools.settings.display.heading")}
        >
          <BooleanSetting
            id="mangaTools-openDetailsBlock"
            heading={t(intl, "mangaTools.settings.openDetailsBlock.heading")}
            checked={NS.openDetailsBlock}
            onChange={writeFlag((next) => {
              NS.openDetailsBlock = next;
            })}
          />
          <BooleanSetting
            id="mangaTools-openEditBlock"
            heading={t(intl, "mangaTools.settings.openEditBlock.heading")}
            checked={NS.openEditBlock}
            onChange={writeFlag((next) => {
              NS.openEditBlock = next;
            })}
          />
          <BooleanSetting
            id="mangaTools-hidePerformers"
            heading={t(intl, "mangaTools.settings.hidePerformers.heading")}
            subHeading={t(
              intl,
              "mangaTools.settings.hidePerformers.description"
            )}
            checked={NS.hidePerformers}
            onChange={writeFlag((next) => {
              NS.hidePerformers = next;
            })}
          />
          {/* The one row here whose subject is a field that is *off* — see
              showDisabledFields in plugin-api.ts, and the two patches where it decides
              whether a key is lifted out of Stash's own rows. Its note is the second
              half of that: this is about the disabled ones and nothing else. */}
          <BooleanSetting
            id="mangaTools-showDisabledFields"
            heading={t(intl, "mangaTools.settings.showDisabledFields.heading")}
            subHeading={
              <>
                {t(intl, "mangaTools.settings.showDisabledFields.description")}
                <SettingsNote>
                  {t(intl, "mangaTools.settings.showDisabledFields.note")}
                </SettingsNote>
              </>
            }
            checked={NS.showDisabledFields}
            onChange={writeFlag((next) => {
              NS.showDisabledFields = next;
            })}
          />

          <SidebarFiltersSetting persist={persist} />
        </SettingsGroup>
      </SettingSwitch>

      {/* ── The mark itself ──────────────────────────────────────────────── */}
      {/* No switch: these three are not one feature, they are three answers about
          the mark, and they are deliberately siblings — the pair that is easy to
          mistake for a parent and its child especially.

          They are the one group whose fold is not drawn inside a SettingSwitch,
          because there is no switch to own it: see SettingsGroup, which owns the
          fold for this heading and for the display heading alike.

          Two of the three have no description: "ask before unmarking" and "the mark on
          a cover" are the whole of what their headings say, and the sentences that
          were under them said it again at length. Only the one that does something
          with the gallery's own values keeps a sentence — what it clears, and what it
          keeps. */}
      <SettingsGroup
        id={MARK_GROUP_ID}
        heading={t(intl, "mangaTools.settings.mark.heading")}
      >
        <BooleanSetting
          id="mangaTools-confirmUnmark"
          heading={t(intl, "mangaTools.settings.confirmUnmark.heading")}
          checked={NS.confirmUnmark}
          onChange={writeFlag((next) => {
            NS.confirmUnmark = next;
          })}
        />
        <BooleanSetting
          id="mangaTools-deleteOnUnmark"
          heading={t(intl, "mangaTools.settings.deleteOnUnmark.heading")}
          subHeading={t(intl, "mangaTools.settings.deleteOnUnmark.description")}
          checked={NS.deleteOnUnmark}
          onChange={writeFlag((next) => {
            NS.deleteOnUnmark = next;
          })}
        />
        <BooleanSetting
          id="mangaTools-coverIcon"
          heading={t(intl, "mangaTools.settings.coverIcon.heading")}
          help={{
            text: t(intl, "mangaTools.settings.coverIcon.help"),
            example: "mark",
          }}
          checked={NS.coverIcon}
          onChange={writeFlag((next) => {
            NS.coverIcon = next;
          })}
        />
      </SettingsGroup>
    </>
  );
}
