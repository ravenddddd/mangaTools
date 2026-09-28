/**
 * The lightbox's own furniture, for a gallery this plugin is reading: the header, its
 * two menus, and nothing else of Stash's.
 *
 * **Why the reader draws its own.** Borrowing Stash's lightbox meant borrowing its
 * opinions with it — a chapter number that counts in path order, a counter that counts
 * the page Stash happens to have loaded, a header that names the last chapter that
 * began before this image rather than saying that this image is in none. None of those
 * are wrong; they are Stash's, and this plugin's chapters are not. So the mode draws
 * its own, and Stash's are hidden by the class on the lightbox rather than removed:
 * whatever the reader closes or reopens, React can put its own header back unchanged.
 *
 * What is left of Stash's lightbox while the mode is on is the shell: the overlay, the
 * entry points that open it, and the display the pages sit in. Everything the reader
 * reads from it is a *position* — which image is showing — and everything it shows is
 * its own.
 *
 * The menus are the same two the reader has always had, moved: the switches it used to
 * inject into Stash's options popover (they cannot stay there — that popover is inside
 * the header this hides), and a chapter menu of its own, which is where the numbering
 * and the "in no chapter" answer finally say what this plugin means by them.
 */
import { stringFor } from "../i18n";
import type { MangaReaderChapter, MangaReaderPlacedChapter } from "./chapters";
import type { MangaReaderSettings } from "./namespace";
import { FADE_MAX_MS } from "./settings";
import type { LightboxImage } from "./stash-lightbox";

/** This plugin's own header, and the menus inside it */
export const CLASS_CHROME = "manga-reader-chrome";
export const CLASS_TITLE = "manga-reader-title";
export const CLASS_COUNTER = "manga-reader-counter";
export const CLASS_MENU = "manga-reader-menu";
export const CLASS_MENU_BUTTON = "manga-reader-menu-button";
export const CLASS_MENU_PANEL = "manga-reader-menu-panel";
export const CLASS_MENU_ITEM = "manga-reader-menu-item";
export const CLASS_SETTINGS = "manga-reader-settings";
/** Each menu's panel, by class: a selector the tests' DOM stub understands too */
const CLASS_MENU_CHAPTERS = "manga-reader-menu-chapters";
const CLASS_MENU_SETTINGS = "manga-reader-menu-settings";

/** What the header shows, and what its buttons do */
export interface ChromeHandlers {
  /** The chapter the reader asked for, by its place in the gallery's pages */
  onChapter(at: number): void;
  /** A setting changed — written by the caller, which owns them */
  onSetting(next: Partial<MangaReaderSettings>): void;
  /** The pairing shift, which belongs to the gallery rather than to the reader */
  onOffset(next: 0 | 1): void;
  /** Close, by Stash's own path */
  onClose(): void;
}

/** Everything the header draws from, gathered once per pass */
export interface ChromeState {
  /** The image being shown, or null before any is */
  image: LightboxImage | null;
  /** Where it sits in the gallery's pages, and how many there are — both one-based */
  number: number;
  total: number;
  /** The chapter this image is in, or null when it is in none */
  chapter: MangaReaderPlacedChapter | null;
  chapters: MangaReaderChapter[];
  placed: MangaReaderPlacedChapter[];
  settings: MangaReaderSettings;
  /** The pairing shift for this gallery: 0, or 1 to pair everything one page over */
  offset: 0 | 1;
  locale: string | null;
  handlers: ChromeHandlers;
}

/**
 * The header, once per lightbox, and then kept up to date.
 *
 * Built on demand and updated in place, because this runs inside a MutationObserver:
 * everything it writes is conditional on the value differing, or a write would be a
 * change that causes a change.
 */
export function ensureChrome(
  lightbox: Element,
  state: ChromeState
): HTMLElement {
  latest = state;
  let chrome = lightbox.querySelector("." + CLASS_CHROME) as HTMLElement | null;

  if (!chrome) {
    chrome = document.createElement("div");
    chrome.className = CLASS_CHROME;
    lightbox.appendChild(chrome);

    chrome.appendChild(menuButton("chapters", "☰"));
    chrome.appendChild(text(CLASS_TITLE));
    chrome.appendChild(text(CLASS_COUNTER));
    chrome.appendChild(menuButton("settings", "⚙"));

    chrome.appendChild(panel("chapters"));
    chrome.appendChild(panel("settings"));
    chrome.appendChild(closeButton());
  }

  update(chrome, state);
  return chrome;
}

/** Takes the header away, with the lightbox it belonged to */
export function removeChrome(lightbox: Element): void {
  const chrome = lightbox.querySelector("." + CLASS_CHROME);
  if (chrome) chrome.remove();
}

/** The state the buttons read when they are pressed, which is the last one drawn */
let latest: ChromeState | null = null;

/**
 * The labels, kept by reference.
 *
 * They were looked up by `[for=…]`, which is a selector the tests' DOM stub does not
 * understand — so the lookup returned null, the label was never rewritten, and a
 * section about the wording passed for the wrong reason: nothing was being written
 * either way.
 */
const labels: { [key: string]: HTMLElement } = {};

/** Whether the header's menus are open, and which */
let openMenu: "chapters" | "settings" | null = null;

/**
 * A pass over the whole thing: the words, the numbers, the two lists.
 *
 * Every write is guarded by a comparison — see ensureChrome. The lists are rebuilt
 * only when the chapters themselves differ, since a gallery's chapters do not change
 * while it is open.
 */
function update(chrome: HTMLElement, state: ChromeState): void {
  const title = chrome.querySelector("." + CLASS_TITLE) as HTMLElement;
  const counter = chrome.querySelector("." + CLASS_COUNTER) as HTMLElement;

  const name = imageName(state.image);
  if (title.textContent !== name) title.textContent = name;

  const count = state.number + " / " + state.total;
  if (counter.textContent !== count) counter.textContent = count;

  const chapterPanel = chrome.querySelector(
    "." + CLASS_MENU_CHAPTERS
  ) as HTMLElement;
  const settingsPanel = chrome.querySelector(
    "." + CLASS_MENU_SETTINGS
  ) as HTMLElement;
  if (!chapterPanel || !settingsPanel) return;

  for (const button of chrome.querySelectorAll("." + CLASS_MENU_BUTTON)) {
    const which = button.getAttribute("data-opens");
    button.setAttribute("aria-expanded", which === openMenu ? "true" : "false");
  }

  chapterPanel.classList.toggle("show", openMenu === "chapters");
  settingsPanel.classList.toggle("show", openMenu === "settings");

  drawChapters(chapterPanel, state);
  drawSettings(settingsPanel, state);
}

/** The chapter menu, and the mark on the one the reader is in */
function drawChapters(panel: HTMLElement, state: ChromeState): void {
  const key = state.placed.map((c) => c.at + ":" + c.title).join("|");
  if (panel.getAttribute("data-drawn") !== key) {
    panel.setAttribute("data-drawn", key);
    panel.textContent = "";

    for (const chapter of state.placed) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = CLASS_MENU_ITEM;
      item.dataset.at = String(chapter.at);
      // A chapter with no name is named by its place, which is what the reader sees in
      // the list — the same number the jump goes to.
      item.textContent =
        chapter.title || "#" + (state.placed.indexOf(chapter) + 1);
      item.addEventListener("click", () => {
        openMenu = null;
        state.handlers.onChapter(chapter.at);
      });
      panel.appendChild(item);
    }
  }

  for (const item of panel.querySelectorAll("." + CLASS_MENU_ITEM)) {
    const mine =
      item.getAttribute("data-at") === String(state.chapter?.at ?? -1);
    item.classList.toggle("active", mine);
  }
}

/**
 * The switches, which used to live in Stash's options popover.
 *
 * They are the same three settings, drawn the same way they were — a `form-check` and
 * a range input, in Stash's own markup, so they read as the settings they are. What is
 * different is whose menu they are in.
 */
function drawSettings(panel: HTMLElement, state: ChromeState): void {
  const label = (id: string) => stringFor(state.locale, id);

  // Built once and updated after: a re-render per input event would replace the
  // element under the pointer, and a slider that is rebuilt mid-drag is a slider that
  // stops following the drag.
  if (panel.getAttribute("data-built") !== "yes") {
    panel.setAttribute("data-built", "yes");
    // Added, not assigned: the class that identifies this panel is how the pass finds
    // it again, and overwriting the class name once meant every later pass failed to
    // find it and gave up before syncing anything.
    panel.classList.add(CLASS_SETTINGS);
    panel.textContent = "";

    const wrap = document.createElement("div");
    wrap.className = "form-check";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = DOUBLE_PAGE_ID;
    input.addEventListener("change", () => {
      latest?.handlers.onSetting({ doublePage: input.checked });
    });

    const box = document.createElement("label");
    box.className = "form-check-label";
    box.htmlFor = DOUBLE_PAGE_ID;

    labels.doublePage = box;
    wrap.appendChild(input);
    wrap.appendChild(box);
    panel.appendChild(wrap);

    // The pairing shift, which is not a reading preference like the two above it: it
    // is about this gallery's pages, so it is remembered for the gallery.
    const shift = document.createElement("div");
    shift.className = "form-check";
    const shiftInput = document.createElement("input");
    shiftInput.type = "checkbox";
    shiftInput.className = "form-check-input";
    shiftInput.id = OFFSET_ID;
    shiftInput.addEventListener("change", () => {
      latest?.handlers.onOffset(shiftInput.checked ? 1 : 0);
    });
    const shiftLabel = document.createElement("label");
    shiftLabel.className = "form-check-label";
    shiftLabel.htmlFor = OFFSET_ID;
    labels.offset = shiftLabel;
    shift.appendChild(shiftInput);
    shift.appendChild(shiftLabel);
    panel.appendChild(shift);

    const fade = document.createElement("div");
    fade.className = "form-group";

    const fadeLabel = document.createElement("label");
    fadeLabel.htmlFor = FADE_ID;
    labels.fade = fadeLabel;

    const range = document.createElement("input");
    range.type = "range";
    range.className = "form-range";
    range.id = FADE_ID;
    range.min = "0";
    range.max = String(FADE_MAX_MS);
    range.step = "20";
    range.addEventListener("input", () => {
      latest?.handlers.onSetting({ fadeMs: Number(range.value) });
    });

    const readout = text("manga-reader-readout");

    fade.appendChild(fadeLabel);
    fade.appendChild(range);
    fade.appendChild(readout);
    panel.appendChild(fade);
  }

  const check = panel.querySelector(
    "#" + DOUBLE_PAGE_ID
  ) as HTMLInputElement | null;
  if (check && check.checked !== state.settings.doublePage) {
    check.checked = state.settings.doublePage;
  }
  const doubleName = label("mangaReader.doublePage");
  if (labels.doublePage && labels.doublePage.textContent !== doubleName) {
    labels.doublePage.textContent = doubleName;
  }

  const offset = panel.querySelector(
    "#" + OFFSET_ID
  ) as HTMLInputElement | null;
  if (offset && offset.checked !== (state.offset === 1)) {
    offset.checked = state.offset === 1;
  }
  const offsetName = label("mangaReader.offset");
  if (labels.offset && labels.offset.textContent !== offsetName) {
    labels.offset.textContent = offsetName;
  }

  const range = panel.querySelector("#" + FADE_ID) as HTMLInputElement | null;
  if (range && range.value !== String(state.settings.fadeMs)) {
    range.value = String(state.settings.fadeMs);
  }
  const readout = panel.querySelector(".manga-reader-readout");
  const shown = state.settings.fadeMs + " ms";
  if (readout && readout.textContent !== shown) readout.textContent = shown;
  const fadeName = label("mangaReader.fade");
  if (labels.fade && labels.fade.textContent !== fadeName) {
    labels.fade.textContent = fadeName;
  }
}

const DOUBLE_PAGE_ID = "manga-reader-double-page";
const OFFSET_ID = "manga-reader-offset";
const FADE_ID = "manga-reader-fade";

/** The file's own name, which is what an image with no title is called */
function imageName(image: LightboxImage | null): string {
  if (!image) return "";

  const path = image.visual_files?.[0]?.path || "";
  return image.title || path.replace(/^.*[\\/]/, "") || "";
}

function text(className: string): HTMLElement {
  const node = document.createElement("span");
  node.className = className;
  return node;
}

function menuButton(
  opens: "chapters" | "settings",
  glyph: string
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "minimal " + CLASS_MENU_BUTTON;
  button.dataset.opens = opens;
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.textContent = glyph;
  button.addEventListener("click", () => {
    openMenu = openMenu === opens ? null : opens;
  });
  return button;
}

function panel(opens: "chapters" | "settings"): HTMLElement {
  const node = document.createElement("div");
  node.className =
    CLASS_MENU_PANEL +
    " " +
    (opens === "chapters" ? CLASS_MENU_CHAPTERS : CLASS_MENU_SETTINGS);
  node.dataset.menu = opens;
  return node;
}

function closeButton(): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "minimal manga-reader-close";
  button.textContent = "✕";
  button.addEventListener("click", () => {
    openMenu = null;
    latest?.handlers.onClose();
  });
  return button;
}

/** Forgets an open menu, for when the lightbox goes away */
export function forgetOpenMenu(): void {
  openMenu = null;
}
