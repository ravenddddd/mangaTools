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
import { requirePluginApi } from "../plugin-api";
import { stringFor } from "../i18n";
import type { MangaReaderChapter, MangaReaderPlacedChapter } from "./chapters";
import type { MangaReaderSettings } from "./namespace";
import { FADE_MAX_MS } from "./settings";
import type { LightboxImage } from "./stash-lightbox";

/** This plugin's own header, and the menus inside it */
export const CLASS_CHROME = "manga-reader-chrome";
/** The chapter the reader is in, in the indicator's first span */
export const CLASS_CHAPTER = "manga-reader-chapter";
export const CLASS_COUNTER = "manga-reader-counter";
/** Stash's own class for the box the gear sits in, which is where its options sit */
export const CLASS_OPTIONS_ICON = "Lightbox-header-options-icon";
/** This plugin's own name for that same box, which it also anchors its popover to */
export const CLASS_OPTIONS_ANCHOR = "manga-reader-options-anchor";
/** The cross at the end of the header */
export const CLASS_CLOSE = "manga-reader-close";
/** The fullscreen toggle, which Stash draws between the gear and the cross */
export const CLASS_FULLSCREEN = "manga-reader-fullscreen";
/** The zoom reset, which Stash draws only while its image is zoomed */
export const CLASS_ZOOM = "manga-reader-zoom";
/** The chapter menu's wrapper, which is what goes when there are no chapters */
export const CLASS_CHAPTER_MENU = "manga-reader-chapter-menu";
/**
 * The attribute that hides what this plugin stands in for, and the one thing the
 * stylesheet knows about any of it: see the rule in mangaReader.css. The same
 * attribute the chapters tab marks Stash's own Create button with.
 */
const HIDDEN = "data-manga-reader-hidden";
export const CLASS_MENU_BUTTON = "manga-reader-menu-button";
export const CLASS_MENU_PANEL = "manga-reader-menu-panel";
export const CLASS_MENU_ITEM = "manga-reader-menu-item";
export const CLASS_SETTINGS = "manga-reader-settings";
/** Each menu's panel, by class: a selector the tests' DOM stub understands too */
const CLASS_MENU_CHAPTERS = "manga-reader-menu-chapters";
const CLASS_MENU_SETTINGS = "manga-reader-menu-settings";

/**
 * What Stash's own header puts on each of the three buttons it has, copied from it
 * rather than approximated: the look is in these. Its chapter button is a
 * `Dropdown.Toggle`, which react-bootstrap renders as a `minimal` `dropdown-toggle
 * btn btn-primary`; its gear and its cross are the `btn btn-link`s it draws its
 * other buttons with. A class of this plugin's own would be a look of its own.
 */
const CLASS_CHAPTER_TOGGLE =
  "minimal Lightbox-header-chapter-button dropdown-toggle btn btn-primary";
const CLASS_ICON_BUTTON = "btn btn-link";

/** The two menus this header has */
type Menu = "chapters" | "settings";

/** What the header shows, and what its buttons do */
export interface ChromeHandlers {
  /** The chapter the reader asked for, by its place in the gallery's pages */
  onChapter(at: number): void;
  /** A setting changed — written by the caller, which owns them */
  onSetting(next: Partial<MangaReaderSettings>): void;
  /** The pairing shift, which belongs to the gallery rather than to the reader */
  onOffset(next: 0 | 1): void;
  /** Back to the fitted size, from whatever the pages have been zoomed to */
  onResetZoom(): void;
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
  /** Whether the pages are zoomed, which is when there is a zoom to reset */
  zoomed: boolean;
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
    // Stash's own classes, so its own stylesheet is what this looks like: the header
    // is `Lightbox-header`, the menus are its dropdown and its popover, and the
    // buttons are its `minimal` ones. Nothing here invents a look.
    chrome.className = "Lightbox-header " + CLASS_CHROME;

    // Where Stash's own header is, so the row is in the same place on the screen: the
    // carousel above it, the footer below it. Appending would have put ours under the
    // footer, which is a header at the bottom of the lightbox.
    const stash = lightbox.querySelector(
      ".Lightbox-header:not(." + CLASS_CHROME + ")"
    );
    if (stash?.parentNode) stash.parentNode.insertBefore(chrome, stash);
    else lightbox.appendChild(chrome);

    const left = document.createElement("div");
    left.className = "Lightbox-header-left-spacer";
    // Stash's chapter menu is a `Dropdown`, which renders a `div.dropdown` holding the
    // toggle and the menu — and a `dropdown-menu` is positioned against that wrapper.
    // Without one the menu is positioned against the header, which is where it landed.
    const chapters = document.createElement("div");
    chapters.className = "dropdown " + CLASS_CHAPTER_MENU;
    chapters.appendChild(
      menuButton("chapters", CLASS_CHAPTER_TOGGLE, "faBars")
    );
    chapters.appendChild(
      panel("chapters", "dropdown-menu Lightbox-header-chapters")
    );
    left.appendChild(chapters);
    chrome.appendChild(left);

    const indicator = document.createElement("div");
    indicator.className = "Lightbox-header-indicator";
    indicator.appendChild(text(CLASS_CHAPTER));
    indicator.appendChild(text(CLASS_COUNTER, "b"));
    chrome.appendChild(indicator);

    const right = document.createElement("div");
    right.className = "Lightbox-header-right";
    const options = document.createElement("div");
    options.className = "Lightbox-header-options";
    // Stash's own box for the gear, and the one thing this header adds to it: a
    // position. Stash renders its options popover into the lightbox and places it
    // with a library, which is a library this header has not got — so the popover
    // is measured from this box instead, and the box has to be what it is measured
    // from. Without that it is measured from the page, and lands off the bottom of
    // it. See the popover rule in mangaReader.css.
    const anchor = document.createElement("div");
    anchor.className = CLASS_OPTIONS_ICON + " " + CLASS_OPTIONS_ANCHOR;
    anchor.appendChild(menuButton("settings", CLASS_ICON_BUTTON, "faCog"));
    anchor.appendChild(panel("settings", "popover"));
    options.appendChild(anchor);
    right.appendChild(options);
    // The zoom reset, drawn only while there is a zoom to reset — Stash's own
    // condition, and its own button, in the place it puts it.
    right.appendChild(zoomButton());
    // Fullscreen, if this browser has it at all — which is the condition Stash draws
    // its own under. It is asked for of the lightbox, so the pages are what fills the
    // screen, exactly as its button does.
    if (document.fullscreenEnabled) {
      right.appendChild(fullscreenButton(lightbox));
    }
    // Inside the right-hand group rather than after it, which is where Stash puts
    // its own: that group is what holds the end of the row.
    right.appendChild(closeButton());
    chrome.appendChild(right);
  }

  chromeNode = chrome;
  update(chrome, state);
  return chrome;
}

/** Takes the header away, with the lightbox it belonged to */
export function removeChrome(lightbox: Element): void {
  const chrome = lightbox.querySelector("." + CLASS_CHROME);
  if (chrome) chrome.remove();
  if (chrome === chromeNode) chromeNode = null;
}

/** The state the buttons read when they are pressed, which is the last one drawn */
let latest: ChromeState | null = null;

/**
 * The header itself, so a button can redraw it.
 *
 * A menu opening is a change to what is drawn and to nothing else — no setting, no
 * page, nothing the rest of the plugin has an opinion about — so the button that
 * opens it has to say so itself. Without this the state changed and nothing redrew:
 * the buttons looked dead, because to the reader they were.
 */
let chromeNode: HTMLElement | null = null;

/** Draws the header again from the last state it was given */
function redraw(): void {
  if (chromeNode && latest) update(chromeNode, latest);
}

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
  const chapter = chrome.querySelector("." + CLASS_CHAPTER) as HTMLElement;
  const counter = chrome.querySelector("." + CLASS_COUNTER) as HTMLElement;

  // What Stash's indicator holds: the chapter this image is in, and where the reader
  // is — in the order it is being read, which is this plugin's own numbering.
  const name = state.chapter?.title || "";
  if (chapter.textContent !== name) chapter.textContent = name;

  const count = state.number + " / " + state.total;
  if (counter.textContent !== count) counter.textContent = count;

  const chapterPanel = chrome.querySelector(
    "." + CLASS_MENU_CHAPTERS
  ) as HTMLElement;
  const settingsPanel = chrome.querySelector(
    "." + CLASS_MENU_SETTINGS
  ) as HTMLElement;
  if (!chapterPanel || !settingsPanel) return;

  for (const node of chrome.querySelectorAll("." + CLASS_MENU_BUTTON)) {
    const button = node as HTMLElement;
    const which = button.dataset.opens as Menu;
    const open = which === openMenu;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // Stash's own chapter button turns into a cross while its menu is open, and
    // the gear does not turn into anything.
    setIcon(button, iconFor(which, open));
  }

  chapterPanel.classList.toggle("show", openMenu === "chapters");
  settingsPanel.classList.toggle("show", openMenu === "settings");

  // Two things this header draws only sometimes: the zoom reset, while there is a
  // zoom to reset, and the chapter menu, while there are chapters to put in it. A
  // gallery in no chapters has nothing for that menu to be, so it has no menu and no
  // button — which is Stash's own rule, and the reason its own header is empty of
  // them on such a gallery.
  showWhen(chrome.querySelector("." + CLASS_ZOOM), state.zoomed);
  showWhen(
    chrome.querySelector("." + CLASS_CHAPTER_MENU),
    state.placed.length > 0
  );

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
      // Stash's own class for an entry in its chapter menu, plus this plugin's so the
      // tests can find them.
      item.className = "dropdown-item " + CLASS_MENU_ITEM;
      item.dataset.at = String(chapter.at);
      // A chapter with no name is named by its place, which is what the reader sees in
      // the list — the same number the jump goes to.
      item.textContent =
        chapter.title || "#" + (state.placed.indexOf(chapter) + 1);
      item.addEventListener("click", () => {
        openMenu = null;
        // The jump lays a screen out, and the pass after it draws the header again —
        // so this one only has to say what it wants.
        state.handlers.onChapter(chapter.at);
      });
      panel.appendChild(item);
    }
  }

  for (const item of panel.querySelectorAll("." + CLASS_MENU_ITEM)) {
    // Read back the way it was written: `dataset` is the same attribute as
    // `data-at`, and a read that spells it differently is a read that only the
    // browser's own leniency makes work — the tests' DOM is not lenient.
    const mine =
      (item as HTMLElement).dataset.at === String(state.chapter?.at ?? -1);
    item.classList.toggle("active", mine);
  }
}

/**
 * The switches, which used to live in Stash's options popover.
 *
 * They are the same three settings, drawn the same way they were — a `form-check`, a
 * range input, and Stash's own `form-group` between one control and the next. What is
 * different is whose menu they are in, and that this panel is built by hand rather
 * than by react-bootstrap: Stash's popover gets its heading and its padding from
 * `Popover.Title` and `Popover.Content`, and a `popover` without those two has its
 * contents against the border with nothing between them.
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

    const heading = document.createElement("div");
    heading.className = "popover-header";
    labels.options = heading;
    panel.appendChild(heading);

    const body = document.createElement("div");
    body.className = "popover-body";
    panel.appendChild(body);

    // A `form-group` per control, which is what holds one off the next: Stash wraps
    // each of its own in one, and `.form-group` is where the gap comes from.
    const pageGroup = document.createElement("div");
    pageGroup.className = "form-group";
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
    pageGroup.appendChild(wrap);
    body.appendChild(pageGroup);

    // The pairing shift, which is not a reading preference like the two above it: it
    // is about this gallery's pages, so it is remembered for the gallery.
    const shiftGroup = document.createElement("div");
    shiftGroup.className = "form-group";
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
    shiftGroup.appendChild(shift);
    body.appendChild(shiftGroup);

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
    body.appendChild(fade);
  }

  const heading = label("mangaReader.options");
  if (labels.options && labels.options.textContent !== heading) {
    labels.options.textContent = heading;
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

function text(className: string, tag = "span"): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * One of the header's menu buttons.
 *
 * The classes come from the caller, which passes the ones Stash's own header uses
 * for that button — see CLASS_CHAPTER_TOGGLE and CLASS_ICON_BUTTON. The icon is
 * Stash's own too, drawn by Stash's own React component: the same three bars and the
 * same cog its header uses, so the header reads as itself.
 */
function menuButton(opens: Menu, classes: string, icon: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = classes + " " + CLASS_MENU_BUTTON;
  button.dataset.opens = opens;
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  setIcon(button, icon);
  button.addEventListener("click", () => {
    openMenu = openMenu === opens ? null : opens;
    redraw();
  });
  return button;
}

/**
 * Shows or hides something by the attribute, and only when it differs.
 *
 * Only when it differs, because this pass runs on every change the lightbox makes,
 * and an attribute written with the value it already has is still a write — which is
 * the shape of change that makes a change. Once per button is not much to ask.
 */
function showWhen(node: Element | null, shown: boolean): void {
  if (!node) return;

  if ((node.getAttribute(HIDDEN) !== null) === shown) {
    if (shown) node.removeAttribute(HIDDEN);
    else node.setAttribute(HIDDEN, "");
  }
}

/** The icon a menu shows: the bars open into a cross, and the cog stays a cog */
function iconFor(opens: Menu, open: boolean): string {
  if (opens !== "chapters") return "faCog";
  return open ? "faTimes" : "faBars";
}

/**
 * Draws a button's icon, once.
 *
 * Once, because drawing one is a React render into the button, and the pass that
 * keeps this header up to date runs on every change the lightbox makes: a render per
 * pass would be a change per pass, which is the one thing a pass must not be. The
 * name is kept on the button for the same reason — it is what says whether the icon
 * on it is already the icon it should have.
 */
function setIcon(host: HTMLElement, name: string): void {
  if (host.dataset.icon === name) return;
  host.dataset.icon = name;
  drawIcon(host, name);
}

function panel(opens: Menu, extra: string): HTMLElement {
  const node = document.createElement("div");
  node.className = [
    extra,
    CLASS_MENU_PANEL,
    opens === "chapters" ? CLASS_MENU_CHAPTERS : CLASS_MENU_SETTINGS,
  ].join(" ");
  node.dataset.menu = opens;
  return node;
}

/**
 * Stash's FontAwesome icon, through Stash's own component.
 *
 * This half is DOM work and has no React of its own, but the plugin API hands both
 * React and ReactDOM over, and `components.Icon` is the one thing that draws an icon
 * the way every other icon on the page is drawn. A glyph typed as text would be a
 * different font in a different size, and would look like a plugin.
 */
function drawIcon(host: HTMLElement, name: string): void {
  const api = requirePluginApi();
  const Solid = api.libraries.FontAwesomeSolid || {};
  const Icon = api.components.Icon;
  const icon = Solid[name];
  const render = api.ReactDOM?.render;
  if (!Icon || !icon || !render) return;

  render(api.React.createElement(Icon, { icon }), host);
}

/**
 * Puts the pages back to the size they were drawn at.
 *
 * Drawn always and hidden by an attribute rather than added and removed: this header
 * is built once and updated in place, and a button that comes and goes would mean
 * two ways of building it. Stash's own appears and disappears with the zoom, which is
 * the same thing seen from the outside — see the hidden rule in mangaReader.css.
 */
function zoomButton(): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = CLASS_ICON_BUTTON + " " + CLASS_ZOOM;
  button.title = "Reset zoom";
  button.setAttribute(HIDDEN, "");
  setIcon(button, "faSearchMinus");
  button.addEventListener("click", () => {
    openMenu = null;
    latest?.handlers.onResetZoom();
  });
  return button;
}

/**
 * The fullscreen toggle, drawn only where the browser has fullscreen to offer.
 *
 * From the lightbox itself rather than the document, because that is what Stash asks
 * — and because asking it of the document would put the browser's chrome back over a
 * header that is trying to be the whole screen.
 */
function fullscreenButton(lightbox: Element): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = CLASS_ICON_BUTTON + " " + CLASS_FULLSCREEN;
  button.title = "Toggle Fullscreen";
  setIcon(button, "faExpand");
  button.addEventListener("click", () => {
    openMenu = null;
    // Read at the click rather than remembered: the reader can leave fullscreen with
    // Esc, and a button that thought it was still in it would only ever exit.
    if (document.fullscreenElement) document.exitFullscreen();
    else lightbox.requestFullscreen();
  });
  return button;
}

/**
 * The cross that closes the lightbox.
 *
 * Stash's own button, down to the icon and the tooltip: a `btn btn-link` with a
 * `faTimes` in it, which is what its header ends with. A typed "✕" was a different
 * glyph in a different font at a different size, and it sat a few pixels off the end
 * of the row.
 */
function closeButton(): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = CLASS_ICON_BUTTON + " " + CLASS_CLOSE;
  // Stash's own words for it, which are not translated there either.
  button.title = "Close Lightbox";
  setIcon(button, "faTimes");
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
