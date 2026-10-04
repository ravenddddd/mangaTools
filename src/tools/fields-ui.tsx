/**
 * The small pieces the field surfaces share.
 *
 * A flag, the badge chip drawn from a described language, the resolver that finds
 * react-select in Stash's libraries, and the option formatter that draws a flag
 * beside a localised name. None of them decides anything; all of them are drawn
 * by more than one surface — the edit page, the bulk dialog and the settings page
 * each draw at least three of the four — and that is exactly why they are here
 * rather than in the entry file, which none of those modules may import.
 *
 * Down, never sideways: these read `NS` and Stash's libraries and nothing else of
 * this plugin's. See core.ts for the rule the tools half's modules are arranged by.
 */
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import type { MangaToolsDescription, MangaToolsOption } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. Every use of it in this
// module is the JSX below, so the linter cannot see it — it reads as unused even
// though the transform emits a reference to it. See censorship.tsx, which says
// the same thing.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

/**
 * A regional flag.
 *
 * flag-icons' CSS is loaded globally by Stash (index.scss imports
 * `flag-icons/css/flag-icons.min.css`), so emitting `<span class="fi fi-jp">`
 * is all that is needed — no assets to ship.
 *
 * These are CSS-drawn flags, not emoji: Windows' Segoe UI Emoji has no flag
 * glyphs, so a flag emoji degrades into a pair of boxed letters there.
 */
export function Flag(props: { flag: string; className?: string }) {
  return (
    <span
      className={
        "fi fi-" + props.flag + (props.className ? " " + props.className : "")
      }
    />
  );
}

/**
 * The badge itself, from an already-described value.
 *
 * Split out of LanguageBadge so that the example in the settings page's help
 * panel is drawn by this same code: an example built from its own copy of these
 * three cases is an example that can quietly stop being true, and this one is
 * looked at to decide what a setting does.
 *
 * A plain function rather than a component, so that nothing new appears in the
 * element tree between LanguageBadge and the div it draws — the tests read that
 * tree to reach the flag, and a component boundary there would be a level they
 * have to know about. It has no hooks of its own to lose by being called
 * directly, and `NS.showFlags` is read at the moment it is drawn either way.
 */
export function languageChip(info: MangaToolsDescription, className?: string) {
  // Appended to whichever of the three chips below is drawn, so that the help
  // panel can ring the badge itself: the ring has to be on the absolutely
  // positioned chip, not on a wrapper of it, which would be a box in the flow.
  const extra = className ? " " + className : "";

  // No flag to show, for one of two reasons — and they are not the same chip:
  //
  //   unrecognised  arbitrary data, so it is bounded and ellipsised; a long junk
  //                 value must not end up covering the cover
  //   flags off     a real language name, so it is shown whole — clipping
  //                 "印度尼西亚语" or "Traditional Chinese" to a few characters
  //                 would make the setting hard to use
  //
  // The look is identical; what differs is whether the text may run its length.
  if (!info.known) {
    return (
      <div className={"manga-tools-badge is-unknown" + extra}>{info.name}</div>
    );
  }
  if (!NS.showFlags) {
    return (
      <div className={"manga-tools-badge is-name" + extra}>{info.name}</div>
    );
  }

  return (
    <div className={"manga-tools-badge" + extra} aria-label={info.name}>
      <Flag flag={info.flag as string} />
    </div>
  );
}

/**
 * react-select is a namespace import on PluginApi.libraries, and the component
 * is its default export. It is looked up at runtime, so there is no static
 * type to give it.
 */
// biome-ignore lint/suspicious/noExplicitAny: react-select is reached through a namespace import at runtime, so its component has no static type.
let SELECT: any = null;

// biome-ignore lint/suspicious/noExplicitAny: as above — the component itself.
export function resolveSelect(): any {
  if (SELECT) return SELECT;

  const RS = PluginApi.libraries.ReactSelect;
  if (!RS) {
    console.error("[mangaTools] react-select not available");
    return null;
  }

  SELECT = RS.default || RS.Select || RS;
  return SELECT;
}

/**
 * Renders a dropdown option: flag plus localised name.
 * react-select calls this for both the menu item and the selected value, so
 * the two always look the same.
 */
export function formatLanguageOption(option: MangaToolsOption) {
  return (
    <span className="manga-tools-option">
      {NS.showFlags && option.flag ? (
        <Flag flag={option.flag} className="manga-tools-flag" />
      ) : null}
      <span>{option.label}</span>
    </span>
  );
}

// ────────── The edit page's own pieces, drawn by the bulk row too ──────────
//
// A group option is not a MangaToolsOption: that type carries a flag, which is a
// fact about a language, and a group has no such thing. `createLabel` says instead
// that this entry is text somebody typed, offered so that choosing it is how a new
// group gets set. The class names are read off a native form row at render time, so
// a row this plugin draws lines up with Stash's own in whatever theme is on.
export type NativeFieldClasses = {
  group: string;
  label: string;
  control: string;
};

export type MangaToolsGroupOption = {
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
export function formatGroupOption(
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
export function readNativeFieldClasses(
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
