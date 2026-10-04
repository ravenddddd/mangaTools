/**
 * The plugin's own strings, in the reader's Stash language.
 *
 * Only the strings this plugin writes itself live here. Everything else it puts on
 * screen comes from Stash's own messages — the field label, the modifier words, a
 * tag's wording, the search placeholder — and follows the UI language for free,
 * because those ids are resolved by Stash's own provider.
 *
 * WHY A LOOKUP RATHER THAN A NESTED PROVIDER. The usual way to do this in a plugin
 * is to wrap its components in a second `IntlProvider` holding these catalogs,
 * because Stash's provider only knows its own ids. This plugin does not need that:
 * every component here already has `intl` in hand, and the module already asks
 * Stash for its messages the same way (see `message` in filter-model.ts), so
 * one more lookup beside it is smaller than a provider — and it has one fewer way
 * to go wrong, since a component rendered outside such a wrapper would silently
 * show the fallback text instead of its translation.
 *
 * The catalog is chosen per key, not per file: a locale that translates three of
 * these strings keeps English for the rest rather than showing ids.
 */
import { NS } from "./languages";
import en from "./messages/en.json";
import zhHans from "./messages/zh-Hans.json";
import zhHant from "./messages/zh-Hant.json";
import type { MangaToolsIntl } from "./plugin-api";

/** Message id -> text, per locale. `en` is the one every id must exist in. */
type MangaToolsCatalog = { [id: string]: string };

const CATALOGS: { [locale: string]: MangaToolsCatalog } = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

/**
 * Locales whose own tag no catalog uses, mapped to the one that covers them.
 *
 * Chinese needs the whole list, because Stash reports a *region* while what this
 * plugin has is a *script*: `zh-TW` is a tag no catalog is named for, and letting
 * the subtag-dropping below finish the job would land it on `zh` — which is
 * simplified for a Taiwanese reader, in every string this plugin writes. That was
 * the behaviour of the tools half alone until the reader half's own table was
 * merged in here; the reader had it right, because reading in the wrong script is
 * unmissable there.
 *
 * A bare `zh` means simplified — the same reading this plugin gives a bare value
 * in the language field, and the same one its own docs describe.
 */
const ALIASES: { [locale: string]: string } = {
  zh: "zh-Hans",
  "zh-CN": "zh-Hans",
  "zh-SG": "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-TW": "zh-Hant",
  "zh-HK": "zh-Hant",
  "zh-MO": "zh-Hant",
  "zh-Hant": "zh-Hant",
};

/**
 * The catalog to read a locale from.
 *
 * Subtags are dropped one at a time, so `zh-Hant-TW` reads the `zh-Hant` catalog
 * and `de-AT` would read a `de` one — the ordinary BCP 47 fallback. Anything that
 * matches nothing, and every locale this plugin has not been translated into,
 * reads English.
 */
/** Every catalog, by tag. For the smoke test, which checks they agree on keys. */
export function catalogs(): { [locale: string]: MangaToolsCatalog } {
  return CATALOGS;
}

export function catalogFor(locale: string): MangaToolsCatalog {
  const parts = String(locale || "")
    .replace("_", "-")
    .split("-");

  while (parts.length > 0) {
    const tag = parts.join("-");
    const catalog = CATALOGS[ALIASES[tag] || tag];
    if (catalog) return catalog;

    parts.pop();
  }

  return CATALOGS.en;
}

/**
 * One of this plugin's own strings, in the reader's language.
 *
 * The id names a message in `src/messages/*.json`; a locale that has not
 * translated it reads the English one.
 */
export function t(intl: MangaToolsIntl, id: string): string {
  return stringFor(intl.locale, id);
}

/**
 * The same lookup from a bare locale, for the half that has no `intl` to hand.
 *
 * The reader draws outside React — it is DOM work beside Stash's carousel — so
 * what it has is the locale Stash's configuration reports, not the object the
 * tools half's components are rendered with. Two entry points, one lookup: the
 * alternative was a second catalog table for three strings, which is how the two
 * halves came to disagree about `zh-TW` in the first place.
 */
export function stringFor(
  locale: string | null | undefined,
  id: string
): string {
  return catalogFor(locale ?? "")[id] ?? CATALOGS.en[id] ?? id;
}

/**
 * One of this plugin's own strings with its `{n}` filled in.
 *
 * The catalogs are a lookup rather than a formatter, and nothing in either half
 * needed a number *inside* a string until the reader had to name a chapter that has
 * no name: a numbered name and "Chapter 6" put the number in a different place, so the
 * whole string has to come from the catalog. One token with one replacement, rather
 * than a placeholder syntax with no translator to serve.
 *
 * Shared rather than written twice, because the two things that name a chapter —
 * the header's menu and the progress bar's bubble — must not be able to disagree
 * about what an unnamed one is called.
 */
export function numbered(
  locale: string | null | undefined,
  id: string,
  n: number
): string {
  return stringFor(locale, id).replace("{n}", String(n));
}

// Published on the namespace alongside the rest of the plugin's pure logic, so
// the smoke tests can exercise the fallback chain without rendering anything.
NS.t = t;
NS.stringFor = stringFor;
NS.catalogFor = catalogFor;
NS.catalogs = catalogs;
