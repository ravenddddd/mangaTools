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
