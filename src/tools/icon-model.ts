/**
 * The plugin's icons as data: five slots, what each one may hold, and the rules
 * that read the value.
 *
 * Five, because those are the five things the plugin draws that *mean* something
 * about a gallery: the mark that makes it manga, the two states of the original
 * text, and the two of censorship. Everything else the plugin draws is a control
 * whose meaning is fixed by the button it sits on, and stays in the code.
 *
 * A slot's value is one string:
 *   - `""` — no icon: the slot draws nothing (the mark may not be empty);
 *   - `data:image/svg+xml…` — an SVG the reader uploaded, kept in the settings as
 *     a data URI and drawn as a **mask** (its shape in the surrounding colour, no
 *     colours of its own — which is also why it cannot carry script or fetch
 *     anything);
 *   - `faName` / `regular:faName` — one of the Font Awesome icons Stash ships,
 *     solid by default and `regular:` for the outlined set.
 *
 * Absent reads as the default, so a library that never opens the settings draws
 * what it always drew; `""` is a choice, not an absence, and survives a restart.
 */

/** The five slots, in the order the dialog lists them. */
export const ICON_SLOTS = [
  "mark",
  "raw",
  "cooked",
  "censored",
  "uncensored",
] as const;

export type IconSlot = (typeof ICON_SLOTS)[number];

/** One value per slot; `""` means "draw nothing". */
export type IconChoices = { [slot in IconSlot]: string };

/**
 * What a library that never touched the setting gets.
 *
 * The mark is the letter `M` — the plugin's own name, and a shape that survives
 * any size. The original-text pair is `A` and `A` with a character from another
 * script: the text as written, and the text with a translation. Censorship is the
 * mosaic and the same tile without it: a checkered square, and an empty one.
 */
export const DEFAULT_ICONS: IconChoices = {
  mark: "faM",
  raw: "faFont",
  cooked: "faLanguage",
  censored: "faChessBoard",
  uncensored: "regular:faSquare",
};

/** The recommended names the editor offers per slot, the default first. */
export const ICON_SUGGESTIONS: { [slot in IconSlot]: string[] } = {
  mark: ["faM", "faToriiGate", "faBookOpen"],
  raw: ["faFont", "faHouse", "faCrow"],
  cooked: ["faLanguage", "faEarthAsia", "faDrumstickBite"],
  censored: ["faChessBoard", "faMask", "faChessKnight"],
  uncensored: ["regular:faSquare", "faFaceSmile", "faChessPawn"],
};

/** Whether a slot's value is an uploaded SVG rather than a Font Awesome name. */
export function isUpload(value: string): boolean {
  return value.startsWith("data:image/");
}

/**
 * A Font Awesome name and the style it belongs to, or null for anything else.
 *
 * `regular:` is the only prefix there is: the plugin draws marks, and a brand's
 * logo is not a mark — allowing `brands:` would be three lookups and a fourth
 * kind of disagreement for something nobody asked for.
 */
export function parseChoice(
  value: string
): { style: "solid" | "regular"; name: string } | null {
  if (!value || isUpload(value)) return null;

  if (value.startsWith("regular:")) {
    const name = value.slice("regular:".length).trim();
    return name ? { style: "regular", name } : null;
  }
  if (value.startsWith("solid:")) {
    const name = value.slice("solid:".length).trim();
    return name ? { style: "solid", name } : null;
  }
  return { style: "solid", name: value.trim() };
}

/** The settings value as the dialog shows it: one line, already a name. */
export function choiceLabel(value: string): string {
  return isUpload(value) ? "data:image/svg+xml" : value;
}

/**
 * The list, out of the one JSON string the settings store it as.
 *
 * Absent or unreadable reads as the defaults — the same reading every other
 * setting gives a value this build does not know. A slot the string does not
 * mention keeps its default too; only a written `""` means "nothing".
 */
export function iconsFromJson(raw: unknown): IconChoices {
  const icons: IconChoices = { ...DEFAULT_ICONS };
  if (typeof raw !== "string" || raw.trim() === "") return icons;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return icons;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return icons;
  }

  const record = parsed as { [key: string]: unknown };
  for (const slot of ICON_SLOTS) {
    const value = record[slot];
    if (typeof value === "string") icons[slot] = value.trim();
  }
  return icons;
}

/** The settings value: every slot written, so `""` survives the round trip. */
export function iconsToJson(icons: IconChoices): string {
  const out: { [key: string]: string } = {};
  for (const slot of ICON_SLOTS) out[slot] = icons[slot] || "";
  return JSON.stringify(out);
}
