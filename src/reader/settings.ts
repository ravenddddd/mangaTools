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
 * The longest a screen may take to arrive, in milliseconds.
 *
 * The same number the slider in the options menu stops at. Its job is as much
 * diagnostic as aesthetic: a reader who cannot see a 140 ms fade has to be able to
 * push it somewhere unmistakable to find out whether it is working at all.
 */
export const FADE_MAX_MS = 1000;

/**
 * The settings a browser that has never been asked reads as.
 *
 * The mode itself is **off**. The lightbox is used for every kind of image in
 * Stash, so a plugin that rearranged all of them by default would be changing
 * something the reader never asked for; the other two describe how *spreads* are
 * put together once the mode is on, so they start in the position that suits a
 * manga.
 */
export const DEFAULT_SETTINGS: MangaReaderSettings = {
  doublePage: false,
  coverAlone: true,
  detectSpreads: true,
  fadeMs: 140,
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

  // Clamped rather than taken as written: the value ends up in a Web Animation, and
  // a hand-edited negative or absurd one would be a screen that never appears.
  const duration = (key: keyof MangaReaderSettings): number => {
    const value = stored[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_SETTINGS[key] as number;
    }

    return Math.min(FADE_MAX_MS, Math.max(0, Math.round(value)));
  };

  return {
    doublePage: flag("doublePage"),
    coverAlone: flag("coverAlone"),
    detectSpreads: flag("detectSpreads"),
    fadeMs: duration("fadeMs"),
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

/**
 * Where the per-gallery offsets are kept — the pairing shift of a gallery whose
 * pages are grouped wrongly.
 *
 * Per gallery, because that is what it belongs to: one scan's pages need shifting
 * and the gallery beside it does not. In this browser rather than in the gallery's
 * own custom fields, because it is a reading preference and not a fact about the
 * manga — and because a custom field of ours would show up as a raw row in Stash's
 * edit form, which lifts out only the fields it knows about.
 *
 * One object under one key: a gallery id is short and there is one of these per
 * gallery that needed it, so this stays small however long a library is.
 */
const OFFSET_KEY = "plugin.mangaTools.offsets";
/** The key this half wrote before it was bundled with the tools half */
const LEGACY_OFFSET_KEY = "mangaReader.offsets";

/** Reads the stored offsets, ignoring anything that is not a gallery id and a shift */
export function parseOffsets(raw: string | null): {
  [galleryId: string]: 0 | 1;
} {
  const stored = ((): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Hand-edited, or another plugin's value under our key. No offset is a
      // working answer for every gallery.
      return {};
    }
  })();

  const offsets: { [galleryId: string]: 0 | 1 } = {};
  for (const [id, value] of Object.entries(stored)) {
    if (value === 1) offsets[id] = 1;
  }

  return offsets;
}

/** The shift remembered for a gallery, or 0 when none was. */
export function readOffset(galleryId: string): 0 | 1 {
  try {
    return (
      parseOffsets(storedValue(OFFSET_KEY, LEGACY_OFFSET_KEY))[galleryId] || 0
    );
  } catch (e) {
    console.error("[mangaReader] offsets are not readable:", e);
    return 0;
  }
}

/** Remembers a gallery's shift, dropping the entry when it is back to none. */
export function writeOffset(galleryId: string, offset: 0 | 1): void {
  try {
    // Through storedValue, not the key directly: this is a merge, so reading the
    // new key alone on the first write after the rename would write a map holding
    // this one gallery and silently drop every shift the old key still carries.
    const offsets = parseOffsets(storedValue(OFFSET_KEY, LEGACY_OFFSET_KEY));
    if (offset === 1) offsets[galleryId] = 1;
    else delete offsets[galleryId];

    window.localStorage.setItem(OFFSET_KEY, JSON.stringify(offsets));
  } catch (e) {
    console.error("[mangaReader] offsets are not writable:", e);
  }
}

NR.parseSettings = parseSettings;
NR.parseOffsets = parseOffsets;
NR.readSettings = readSettings;
NR.readOffset = readOffset;
NR.FADE_MAX_MS = FADE_MAX_MS;
