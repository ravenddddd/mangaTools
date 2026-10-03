/**
 * What the reader remembers, and where it remembers it.
 *
 * **With the library rather than with the browser**, which is a departure from Stash
 * itself: the switches in the lightbox's own options menu (fit, zoom, scroll mode) are
 * per-browser interface settings, and these are not. The reason is that this plugin's
 * settings are one set — the managing half's and the reading half's — and they all live
 * in the plugin's configuration, where every browser reads the same thing. The cost is
 * real and worth stating: one menu now holds two kinds of setting, and the ones this
 * plugin put there follow the reader to another machine.
 *
 * There is no migration and nothing is read from this browser: a library with no
 * settings in it reads as the defaults, and the first change writes the whole of them.
 * Doing more than that — carrying each browser's old value up, once — is a branch and a
 * write nobody asked for, to spare one click in each browser that had chosen something.
 */
import { NR, type MangaReaderSettings } from "./namespace";
import {
  PROGRESS_HOLD_MS,
  PROGRESS_IDLE_MAX_MS,
  PROGRESS_IDLE_MS,
  PROGRESS_NEVER,
} from "./progress";
import { NS } from "../languages";

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
 *
 * The two the bar answers are **on**, for the same reason read the other way round:
 * this plugin's own furniture has always been there, and a switch that arrives with a
 * new version is not the place to change what a reader already has. Off is what the
 * reader asks for.
 */
export const DEFAULT_SETTINGS: MangaReaderSettings = {
  readingMode: "single",
  coverAlone: true,
  detectSpreads: true,
  fade: true,
  offset: false,
  showProgress: true,
  showChapterMarks: true,
  progressIdleMs: PROGRESS_IDLE_MS,
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
   * How long the bar stays, in milliseconds — with the two ends of it that are not lengths
   * of time: PROGRESS_HOLD_MS and PROGRESS_NEVER.
   *
   * A number the slider cannot produce is not a setting: a hand-edited configuration reads
   * as the default, and so does a length past the top of the range, which is clamped rather
   * than refused (a reader who edited the file by hand meant "as long as possible" and not
   * "the default"). Only a value that is not a number at all falls back.
   */
  const idleMs = (): number => {
    const value = stored.progressIdleMs;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_SETTINGS.progressIdleMs;
    }

    if (value === PROGRESS_NEVER || value === PROGRESS_HOLD_MS) return value;

    return Math.min(
      Math.max(Math.round(value), PROGRESS_HOLD_MS),
      PROGRESS_IDLE_MAX_MS
    );
  };

  /**
   * Which of the three ways the pages are laid out.
   *
   * A value of the wrong shape — a hand-edited configuration, a mode some later build
   * knows and this one does not — is not a setting, and the default stands. The two
   * shapes this replaced are not read: they were written by older builds into a
   * browser, and a browser is not where these settings live any more.
   */
  const readingMode = (): MangaReaderSettings["readingMode"] => {
    const value = stored.readingMode;

    return value === "single" || value === "double" || value === "scroll"
      ? value
      : DEFAULT_SETTINGS.readingMode;
  };

  return {
    readingMode: readingMode(),
    progressIdleMs: idleMs(),
    coverAlone: flag("coverAlone"),
    detectSpreads: flag("detectSpreads"),
    fade: flag("fade"),
    offset: flag("offset"),
    showProgress: flag("showProgress"),
    showChapterMarks: flag("showChapterMarks"),
  };
}

/**
 * What this plugin is set to. Read fresh each time: it is cheap and always current.
 *
 * Out of the library's copy, and out of nothing else. `NS.readerSettingsRaw` is null
 * until Stash has answered — and for a library nobody has written to — which reads as
 * the defaults, the same way any other value of the wrong shape does.
 */
export function readSettings(): MangaReaderSettings {
  try {
    return parseSettings(NS.readerSettingsRaw);
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

/**
 * Remembers the settings, and returns what was written.
 *
 * The whole of them, every time: saving plugin settings means writing the plugin's
 * whole settings map, so a write carrying only what changed would take the rest of the
 * map with it. Applied to the answer at once — `readSettings` reads the value these
 * lines just wrote — so the change is in force before the network has been asked, and
 * the settings half of a gallery that is already on screen re-lays on the next pass.
 *
 * Tolerated missing: the reader runs in the lightbox whatever the managing half is
 * doing, and a bundle whose tools half failed to start has nowhere to write but still
 * has to read.
 */
export function writeSettings(
  next: Partial<MangaReaderSettings>
): MangaReaderSettings {
  const merged = { ...readSettings(), ...next };

  try {
    NS.writeReaderSettings?.(JSON.stringify(merged));
  } catch (e) {
    console.error("[mangaReader] settings are not writable:", e);
  }

  return merged;
}

NR.parseSettings = parseSettings;
NR.readSettings = readSettings;
NR.FADE_MS = FADE_MS;
