/**
 * Manga Tools — the censorship attribute
 *
 * What values it takes, and how one is drawn. The counterpart of languages.ts,
 * which does the same for the language attribute; the *name* of the field they
 * live in stays in fields.ts with the other two, because the list of names is the
 * one thing that has to agree everywhere.
 *
 * The split is deliberate and is the one this plugin makes: an attribute owns its
 * vocabulary and its presentation, and the surfaces own where things go. A
 * surface — the details block, the edit block — renders more than one attribute,
 * so an attribute does not own a surface; what it owns is how to draw *a value of
 * it*, wherever that value is being shown.
 *
 * The three states are two values and an absence, which is why there is a third
 * icon here at all. Absence means "nobody has said", and a selector expresses it
 * with its own clear button — the same arrangement the language dropdown has.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { SlotIcon } from "./icons";
import { requirePluginApi } from "../plugin-api";
import type { MangaToolsIntl } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. This module uses JSX
// without a direct `React.*` call, so the linter cannot see the use — it reads as
// unused even though the transform emits a reference to it. fields-ui.tsx is the
// other module in the same position.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

/**
 * The values the field takes, in the order the selector lists them.
 *
 * Both lower case, and matching is case-insensitive like everything else. Note
 * that a boolean would not do: a key that is absent, a key set to "false", and a
 * key holding junk would then have to be told apart, and only the first is a state
 * the reader chose.
 */
NS.CENSORSHIP_VALUES = ["censored", "uncensored"];

/**
 * Normalises a stored value to one of CENSORSHIP_VALUES, or "" when it is not one
 * of them.
 *
 * Unlike NS.normalize for languages, an unrecognised value is *not* echoed back:
 * with exactly two values and no aliases there is nothing it could mean, and the
 * selector has no way to draw it. It reads as "not marked" instead, and stays in
 * the gallery until something writes over it — the plugin never rewrites data it
 * did not put there.
 */
NS.normalizeCensorship = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toLowerCase();
  if (s === "") return "";

  const values = NS.CENSORSHIP_VALUES;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === s) return values[i];
  }
  return "";
};

/**
 * The state's icon, or nothing at all.
 *
 * Drawn from the settings' `censored` / `uncensored` slots — the same two icons
 * the dialog offers, on every surface that shows a state: the details row, the
 * selector's menu, the sidebar's filter. An unknown value draws nothing rather
 * than guessing: the value is what the reader stored, and the two states are the
 * only ones this field has.
 */
export function CensorshipIcon(props: { value: string }) {
  const slot =
    props.value === "censored"
      ? "censored"
      : props.value === "uncensored"
        ? "uncensored"
        : null;

  return slot ? (
    <SlotIcon slot={slot} className="manga-tools-censorship-icon" />
  ) : null;
}

/** The plugin's own word for a state, for a tooltip or a label */
NS.censorshipLabel = (intl: MangaToolsIntl, value: string): string => {
  if (value === "censored") return t(intl, "mangaTools.censorship.censored");
  if (value === "uncensored")
    return t(intl, "mangaTools.censorship.uncensored");
  return t(intl, "mangaTools.censorship.unset");
};

/**
 * One option of the selector: the state's icon, then its name.
 *
 * react-select draws this for the menu item and for the value in the box, so the
 * two always agree — the same arrangement as the language dropdown's flag.
 * `.manga-tools-option` is the class that spaces the two apart.
 */
export function formatCensorshipOption(option: {
  value: string;
  label: string;
}) {
  return (
    <span className="manga-tools-option">
      <CensorshipIcon value={option.value} />
      {option.label}
    </span>
  );
}

export { NS };
