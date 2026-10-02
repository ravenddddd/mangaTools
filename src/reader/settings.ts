/**
 * What the reader remembers, between sessions.
 *
 * **Per browser, not per Stash install, and that is deliberate.** These are
 * reading preferences, and the switches they sit beside in the lightbox's own
 * options menu (fit, zoom, scroll mode) are stored the same way — Stash keeps them
 * in its per-browser interface settings, not in the server's configuration. A
 * plugin that put its switches in the server config would make the one menu they
 * all live in behave in two different ways.
 *
 * `localStorage` rather than Stash's own store, which is localForage behind a hook
 * this plugin cannot reach. A separate key means nothing here can corrupt the
 * settings Stash owns, and nothing Stash does can drop ours.
 *
 * The keys carry the plugin's own prefix, `plugin.mangaTools`, the way its custom
 * fields do: everything this plugin leaves in a browser or in a library is
 * findable by that one string, and the prefix says whose it is in a place where
 * something else could have written. They were `mangaReader.*` when the reader was
 * its own plugin, and `storedValue` still reads those — see below.
 */
import { NR, type MangaReaderSettings } from "./namespace";

const STORAGE_KEY = "plugin.mangaTools.settings";
/** The key this half wrote before it was bundled with the tools half */
const LEGACY_STORAGE_KEY = "mangaReader.settings";

/**
 * A stored value, from the key this plugin writes or from the one it used to.
 *
 * The old key is **copied, not moved**: the standalone Manga Reader can still be
 * installed beside this plugin — it is until it is uninstalled — and taking its
 * key away would take its settings with it. The copy is what makes the next
 * version free to drop the fallback.
 */
function storedValue(key: string, legacyKey: string): string | null {
  const current = window.localStorage.getItem(key);
  if (current !== null) return current;

  const legacy = window.localStorage.getItem(legacyKey);
  if (legacy !== null) window.localStorage.setItem(key, legacy);

  return legacy;
}

/**
 * How long a screen takes to arrive, in milliseconds.
 *
 * A constant rather than a setting: the length was a slider, and the two answers a
 * reader actually wanted were "yes" and "no" — the ones in between were a reader
 * looking for the length that would stop it being noticeable, which is what this
 * number is. Long enough to read as arriving rather than appearing; short enough that
 * a reader turning pages quickly is never waiting for it.
 */
export const FADE_MS = 200;

/**
 * The settings a browser that has never been asked reads as.
 *
 * The mode itself is **off**. The lightbox is used for every kind of image in
 * Stash, so a plugin that rearranged all of them by default would be changing
 * something the reader never asked for; the other three describe how *spreads* are
 * put together once the mode is on, so they start in the position that suits a
 * manga.
 */
export const DEFAULT_SETTINGS: MangaReaderSettings = {
  doublePage: false,
  coverAlone: true,
  detectSpreads: true,
  fade: true,
  offset: false,
};

/**
 * Reads settings out of stored JSON, taking only what is recognised.
 *
 * A hand-edited or half-written value must not leave the reader with a setting
 * that is neither true nor false, so every field is checked rather than trusted —
 * and an absent field falls back to its default, which is what makes adding one
 * later harmless for a browser that already has a stored object.
 */
export function parseSettings(raw: string | null): MangaReaderSettings {
  const stored = ((): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Not JSON: someone edited it by hand, or storage is holding another
      // plugin's value. Defaults are the only safe reading.
      return {};
    }
  })();

  const flag = (key: keyof MangaReaderSettings): boolean =>
    typeof stored[key] === "boolean"
      ? (stored[key] as boolean)
      : (DEFAULT_SETTINGS[key] as boolean);

  /**
   * Whether a screen fades in — read from the pair of buttons, or from the slider it
   * used to be.
   *
   * That slider was a length in milliseconds, and the two answers a reader wanted out
   * of it were "yes" and "no", so a stored length becomes one of those: nought meant
   * no fading and was the one value a reader chose deliberately, and anything else
   * was fading at some length of their choosing that this plugin no longer offers.
   * Read once and never written back — the first turn of the new switch writes the
   * shape this build understands.
   */
  const fade = (): boolean => {
    if (typeof stored.fade === "boolean") return stored.fade;
    if (typeof stored.fadeMs === "number") return stored.fadeMs > 0;
    return DEFAULT_SETTINGS.fade;
  };

  return {
    doublePage: flag("doublePage"),
    coverAlone: flag("coverAlone"),
    detectSpreads: flag("detectSpreads"),
    fade: fade(),
    offset: flag("offset"),
  };
}

/** What this browser is set to. Read fresh each time: it is cheap and always current. */
export function readSettings(): MangaReaderSettings {
  try {
    return parseSettings(storedValue(STORAGE_KEY, LEGACY_STORAGE_KEY));
  } catch (e) {
    // Storage can be unavailable (a browser with it switched off, a sandboxed
    // frame). That is not a reason to stop reading — the defaults are a working
    // configuration, just not a remembered one.
    console.error(
      "[mangaReader] settings are not readable, using defaults:",
      e
    );
    return { ...DEFAULT_SETTINGS };
  }
}

/** Remembers the settings, and returns what was written. */
export function writeSettings(
  next: Partial<MangaReaderSettings>
): MangaReaderSettings {
  const merged = { ...readSettings(), ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.error("[mangaReader] settings are not writable:", e);
  }

  return merged;
}

NR.parseSettings = parseSettings;
NR.readSettings = readSettings;
NR.FADE_MS = FADE_MS;
