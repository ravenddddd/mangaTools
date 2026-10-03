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
 * **And per way of reading.** Everything in the options panel but the choice of mode itself
 * is kept three times over — one set for single pages, one for double, one for the column —
 * because the same switch does not mean the same thing in all three: a wheel that turns a
 * page is what a reader wants in front of a screen and is a jump in a column, where the plain
 * wheel is how the column is scrolled. So the stored object is the mode and a table of three
 * sets, and what the rest of the plugin reads is the set for the mode in hand — flat, one
 * value per name, because everything that reads a setting reads `settings.fade` and has no
 * business knowing there are three of each.
 *
 * There is no migration: a library with no settings in it reads as the defaults, the first
 * change writes the whole of them, and a settings object written by an older build — flat,
 * the way this one used to be — is not read at all. Doing more than that is a branch and a
 * write nobody asked for, to spare a few clicks in an install that had chosen something.
 */
import {
  NR,
  type MangaReaderProfile,
  type MangaReaderProfiles,
  type MangaReaderReadingMode,
  type MangaReaderSettings,
  type MangaReaderWheelBindings,
} from "./namespace";
import {
  PROGRESS_HOLD_MS,
  PROGRESS_IDLE_MAX_MS,
  PROGRESS_IDLE_MS,
  PROGRESS_NEVER,
} from "./progress";
import {
  READING_MODES,
  WHEEL_GESTURES,
  defaultWheel,
  isWheelAction,
} from "./wheel";
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
 * Everything one way of reading is set to, as a reader who has never touched it has it.
 *
 * The mode itself is not in here — it is the thing that chooses between these — and neither
 * is the reading half's own on/off, which belongs to the managing half. What is here is what
 * the options panel holds: how the pages are paired, how a screen arrives, what the progress
 * bar does, and what the wheel's chords are bound to.
 *
 * The three that are **on**, and the mode itself, are what this plugin has always done: a
 * switch that arrives with a new version is not the place to change what a reader already
 * has. Off is what the reader asks for.
 */
export function defaultProfile(
  mode: MangaReaderReadingMode
): MangaReaderProfile {
  return {
    coverAlone: true,
    detectSpreads: true,
    offset: false,
    fade: true,
    showProgress: true,
    showChapterMarks: true,
    progressIdleMs: PROGRESS_IDLE_MS,
    wheel: defaultWheel(mode),
  };
}

/** The settings a reader who has never been asked reads as, in the mode that opens first */
export const DEFAULT_SETTINGS: MangaReaderSettings = {
  readingMode: "single",
  ...defaultProfile("single"),
};

/** The keys a way of reading keeps, in the order the shape below is written */
const PROFILE_KEYS: (keyof MangaReaderProfile)[] = [
  "coverAlone",
  "detectSpreads",
  "offset",
  "fade",
  "showProgress",
  "showChapterMarks",
  "progressIdleMs",
  "wheel",
];

/** Stored JSON as an object, or an empty one when it is anything else at all */
function settingsObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Not JSON: someone edited it by hand, or storage is holding another plugin's value.
    // Defaults are the only safe reading.
    return {};
  }
}

/** Whether a value out of stored JSON is a plain object rather than anything else */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Which of the three ways the pages are laid out, out of stored JSON */
function readMode(stored: Record<string, unknown>): MangaReaderReadingMode {
  const value = stored.readingMode;

  return value === "single" || value === "double" || value === "scroll"
    ? value
    : DEFAULT_SETTINGS.readingMode;
}

/**
 * One way of reading, out of stored JSON.
 *
 * A hand-edited or half-written value must not leave the reader with a setting that is
 * neither true nor false, so every field is checked rather than trusted — and a field that
 * is absent, or of a shape this build does not know, falls back to that mode's default, which
 * is what makes adding one later harmless for a library that already has a stored object.
 */
function readProfile(
  stored: Record<string, unknown>,
  mode: MangaReaderReadingMode
): MangaReaderProfile {
  const fallback = defaultProfile(mode);
  const at = asObject(asObject(stored.profiles)[mode]);

  const flag = (key: keyof MangaReaderProfile): boolean =>
    typeof at[key] === "boolean"
      ? (at[key] as boolean)
      : (fallback[key] as boolean);

  /**
   * How long the bar stays, in milliseconds — with the two ends of it that are not lengths of
   * time: PROGRESS_HOLD_MS and PROGRESS_NEVER.
   *
   * A length past the top of the range is clamped rather than refused: a reader who edited
   * the file by hand meant "as long as possible" and not "the default". Only a value that is
   * not a number at all falls back.
   */
  const idleMs = (): number => {
    const value = at.progressIdleMs;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback.progressIdleMs;
    }

    if (value === PROGRESS_NEVER || value === PROGRESS_HOLD_MS) return value;

    return Math.min(
      Math.max(Math.round(value), PROGRESS_HOLD_MS),
      PROGRESS_IDLE_MAX_MS
    );
  };

  /** The three chords, each one checked on its own: one bad value is not three */
  const wheel = (): MangaReaderWheelBindings => {
    const bindings = asObject(at.wheel);
    const chords = { ...fallback.wheel };

    for (const gesture of WHEEL_GESTURES) {
      const value = bindings[gesture];
      if (isWheelAction(value)) chords[gesture] = value;
    }

    return chords;
  };

  return {
    coverAlone: flag("coverAlone"),
    detectSpreads: flag("detectSpreads"),
    offset: flag("offset"),
    fade: flag("fade"),
    showProgress: flag("showProgress"),
    showChapterMarks: flag("showChapterMarks"),
    progressIdleMs: idleMs(),
    wheel: wheel(),
  };
}

/** The three sets as they are stored, every field and cell filled from the defaults */
function storedProfiles(raw: string | null): MangaReaderProfiles {
  const stored = settingsObject(raw);
  const profiles = {} as MangaReaderProfiles;

  for (const mode of READING_MODES) profiles[mode] = readProfile(stored, mode);

  return profiles;
}

/**
 * Reads settings out of stored JSON, taking only what is recognised.
 *
 * The mode in hand, and the set that belongs to it — which is what every other module means
 * by "the settings": a flat object with one value per name. See the note at the top of this
 * file for why there are three of each of them and only one of this.
 */
export function parseSettings(raw: string | null): MangaReaderSettings {
  const stored = settingsObject(raw);
  const readingMode = readMode(stored);

  return { readingMode, ...readProfile(stored, readingMode) };
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
 * The whole of them, every time: saving plugin settings means writing the plugin's whole
 * settings map, so a write carrying only what changed would take the rest of the map with it.
 * Applied to the answer at once — `readSettings` reads the value these lines just wrote — so
 * the change is in force before the network has been asked.
 *
 * **Only what the caller named goes into the mode in hand.** That is the one subtlety of the
 * three sets: what a caller passes alongside a new `readingMode` is the *old* mode's values —
 * they came out of the settings it read — and writing the lot would copy one set over the
 * other. So the mode in hand is written cell by cell from the fields the caller asked for,
 * and the other seven cells of it are carried over untouched.
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
    const profiles = storedProfiles(NS.readerSettingsRaw);
    const mode = merged.readingMode;
    const profile: MangaReaderProfile = { ...profiles[mode] };

    for (const key of PROFILE_KEYS) {
      if (key in next) {
        // One key at a time, and the types line up by construction: PROFILE_KEYS is exactly
        // the set of fields a profile has and a MangaReaderSettings carries.
        (profile[key] as MangaReaderProfile[typeof key]) = merged[key];
      }
    }

    profiles[mode] = profile;
    NS.writeReaderSettings?.(JSON.stringify({ readingMode: mode, profiles }));

    // What the caller gets back is the set for the mode the settings are *now* in, which is
    // not the one that was read at the top of this function when the write was a change of
    // mode. Returning `merged` there would hand the reader the settings of the way of reading
    // they have just left — every one of them, since the merge started from the old set.
    return { readingMode: mode, ...profile };
  } catch (e) {
    console.error("[mangaReader] settings are not writable:", e);
  }

  return merged;
}

NR.parseSettings = parseSettings;
NR.readSettings = readSettings;
// The defaults for a way of reading, published for the tests: a section that writes a stored
// settings object out of its own hand should not have to know what this build's defaults are
// — that is the thing under test, not the thing a fixture should spell out.
NR.defaultProfile = defaultProfile;
NR.FADE_MS = FADE_MS;
