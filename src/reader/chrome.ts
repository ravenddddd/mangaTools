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
import { numbered, stringFor } from "../i18n";
import { NR } from "./namespace";
import type { MangaReaderChapter, MangaReaderPlacedChapter } from "./chapters";
import type { MangaReaderSettings } from "./namespace";
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
/** The chapter menu's heading, and the list under it — the list is what scrolls */
const CLASS_MENU_HEAD = "manga-reader-menu-head";
const CLASS_MENU_HEADING = "manga-reader-menu-heading";
const CLASS_MENU_COUNT = "manga-reader-menu-count";
const CLASS_MENU_LIST = "manga-reader-chapter-list";
/** A row in that list: the name, and the range of pages it covers */
const CLASS_CHAPTER_NAME = "manga-reader-chapter-name";
const CLASS_CHAPTER_RANGE = "manga-reader-chapter-range";
/**
 * A group in the options panel, and the little heading over it.
 *
 * Deliberately this plugin's own, and its own look: Stash has no grouped options
 * panel to copy — its own is a flat list of controls — so a heading and a rule
 * between one set and the next is a thing this plugin decides rather than borrows.
 */
const CLASS_GROUP = "manga-reader-group";
const CLASS_GROUP_LABEL = "manga-reader-group-label";
const CLASS_DIVIDER = "manga-reader-divider";
/** One row of the panel: a label, and the control that belongs to it */
const CLASS_ROW = "manga-reader-row";
const CLASS_ROW_LABEL = "manga-reader-row-label";
/**
 * The single-page/double-page pair.
 *
 * A track with two buttons in it — this plugin's own arrangement, out of Stash's
 * own parts: the track is its `$textfield-bg` (what its inputs are filled with) and
 * the chosen half is lifted by the very `rgba(138, 155, 168, .3)` its own toolbar
 * buttons use when they are the chosen one. The alternative was a checkbox, which
 * says "on" rather than "one of these two", and Stash's button *group*, which does
 * not show at all inside a popover: the group's fill is the same colour as the
 * popover's.
 */
const CLASS_PAGES = "manga-reader-pages";
const CLASS_SEGMENT = "manga-reader-segment";

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
  /** The pairing shift, which is a reading preference like the rest of them */
  onOffset(next: boolean): void;
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

    // A menu is closed by anything that is not it. Stash's own options popover closes
    // this way — `rootClose` — and a menu that only closes by pressing its own button
    // again is a menu a reader ends up reading past.
    //
    // On the lightbox rather than on the document: one listener per header, taken away
    // with the lightbox it belongs to, and no chance of it outliving one.
    lightbox.addEventListener("click", onLightboxClick);
  }

  chromeNode = chrome;
  update(chrome, state);
  return chrome;
}

/** Takes the header away, with the lightbox it belonged to */
export function removeChrome(lightbox: Element): void {
  const chrome = lightbox.querySelector("." + CLASS_CHROME);
  if (chrome) chrome.remove();
  lightbox.removeEventListener("click", onLightboxClick);
  if (chrome === chromeNode) chromeNode = null;
}

/**
 * A click anywhere in the lightbox, which puts away whichever menu is open — unless
 * the click was inside the header, where the menus and their buttons are.
 */
function onLightboxClick(event: Event): void {
  if (openMenu === null) return;
  if (chromeNode?.contains(event.target as Node)) return;

  openMenu = null;
  redraw();
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

/**
 * The nodes a pass shows and hides, kept by name.
 *
 * The same reason as `labels`: the panel is built once, so the pass that follows has
 * to reach the boxes it means to put away, and rebuilding them to ask would be a
 * change per pass.
 */
const parts: { [key: string]: HTMLElement } = {};

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

  // Then, if one of them is open, out of the edges of the window. After the drawing
  // rather than before it: what is measured is what the stylesheet did with the panel,
  // and that is only true once the panel is drawn and shown.
  if (openMenu === "chapters") fitMenu(chapterPanel);
  else if (openMenu === "settings") fitMenu(settingsPanel);
}

/** How close to the edge of the window a menu is allowed to land, in pixels */
const MENU_MARGIN = 8;

/**
 * Whether a menu would hang off the right of the lightbox, and by how much.
 *
 * The style sheet places both menus with an anchor and an edge — the chapter menu
 * under the chapter button's left, the options panel under the gear's right — and an
 * anchor is a position, not a promise: the gear is three buttons from the edge of the
 * window, and the window is as narrow as the reader made it. So what the stylesheet
 * lands outside is nudged back in, by this much.
 *
 * A pure number in, a pure number out, because the tests' DOM has no layout at all:
 * there is nothing to measure in it, so the arithmetic has to be callable on its own.
 * A shift is negative when the menu has to go left, positive when it has to go right.
 */
export function fitShift(
  left: number,
  width: number,
  viewport: number,
  margin: number
): number {
  const over = left + width + margin - viewport;
  if (over > 0) {
    // Leftwards, but never past the left margin. A menu narrower than the window can
    // always be made to fit on one side or the other, so the interesting case is the
    // one that cannot: sliding it further would only choose which end is cut off, and
    // the left end is the one with the words in it.
    return Math.max(-over, margin - left);
  }

  if (left < margin) return margin - left;
  return 0;
}

/**
 * The open menu, moved back inside the window when it hangs off an edge.
 *
 * Stash's own popover gets this from a library — react-overlays measures it and flips
 * it, slides it, or pins it to the window until it fits. That library is on the page
 * (react-bootstrap is, and the tools half renders Stash's own controls with it), but
 * this header is DOM work with no React of its own, and the pass that keeps it up to
 * date is a MutationObserver that rewrites it in place: a React tree rendered into it
 * would be fighting that pass rather than living in it. So the placement stays in the
 * stylesheet and the shifting is this — the same answer, arrived at in the half's own
 * terms.
 *
 * Measured, and only while a menu is open: the panel is one box on one screen, and
 * `getBoundingClientRect` is the only thing that knows where the stylesheet actually
 * put it. Written only when it differs, because a write here is a change the observer
 * would hear.
 */
function fitMenu(panel: HTMLElement): void {
  if (typeof panel.getBoundingClientRect !== "function") return;
  const viewport = window.innerWidth;
  if (!viewport) return;

  const rect = panel.getBoundingClientRect();
  if (!rect.width) return;

  // Where it would be with no shift of its own: the rect is where the panel *is*, and
  // the question is what the stylesheet alone would have done with it.
  const had = Number(panel.dataset.shift || 0);
  const shift = fitShift(rect.left - had, rect.width, viewport, MENU_MARGIN);
  if (shift === had) return;

  panel.dataset.shift = String(shift);
  panel.style.transform = shift === 0 ? "" : "translateX(" + shift + "px)";
}

/**
 * The chapter menu: what is in the book, and which of them the reader is in.
 *
 * A heading, then one row per chapter — its name on the left, the pages it covers
 * on the right, and a bar down the side of the one being read. The heading is what
 * the list is scrolled past: the list is the part that scrolls, so the heading stays
 * where it is without any of the sticky positioning that would have been needed if
 * the two had shared one scrolling box.
 */
function drawChapters(panel: HTMLElement, state: ChromeState): void {
  const rows = state.placed.map((chapter, index) => ({
    chapter,
    // A chapter with no name is named by its place, which is what the reader sees in
    // the list — the same number the jump goes to.
    name:
      chapter.title ||
      numbered(state.locale, "mangaReader.chapterNumber", index + 1),
    range: chapter.at + 1 + "–" + (chapter.to + 1),
  }));

  // The heading and the count are this plugin's own strings, so the language is part
  // of what the panel was drawn from: a reader who changes Stash's language gets a
  // header in it rather than the one the first pass happened to be drawn in.
  const key = [
    state.locale ?? "",
    String(rows.length),
    ...rows.map((row) => row.chapter.at + ":" + row.name + ":" + row.range),
  ].join("|");

  if (panel.getAttribute("data-drawn") !== key) {
    panel.setAttribute("data-drawn", key);
    panel.textContent = "";

    const head = text(CLASS_MENU_HEAD);
    const heading = text(CLASS_MENU_HEADING);
    heading.textContent = stringFor(state.locale, "mangaReader.chapters");
    const count = text(CLASS_MENU_COUNT);
    count.textContent = numbered(
      state.locale,
      "mangaReader.chapterCount",
      rows.length
    );
    head.appendChild(heading);
    head.appendChild(count);
    panel.appendChild(head);

    const list = text(CLASS_MENU_LIST, "div");
    for (const row of rows) {
      const item = document.createElement("button");
      item.type = "button";
      // Stash's own class for an entry in its chapter menu, plus this plugin's so the
      // tests can find them.
      item.className = "dropdown-item " + CLASS_MENU_ITEM;
      item.dataset.at = String(row.chapter.at);

      const name = text(CLASS_CHAPTER_NAME);
      name.textContent = row.name;
      const range = text(CLASS_CHAPTER_RANGE);
      range.textContent = row.range;
      item.appendChild(name);
      item.appendChild(range);

      item.addEventListener("click", () => {
        openMenu = null;
        // The jump lays a screen out, and the pass after it draws the header again —
        // so this one only has to say what it wants.
        state.handlers.onChapter(row.chapter.at);
      });
      list.appendChild(item);
    }
    panel.appendChild(list);
  }

  for (const item of panel.querySelectorAll("." + CLASS_MENU_ITEM)) {
    // Read back the way it was written: `dataset` is the same attribute as
    // `data-at`, and a read that spells it differently is a read that only the
    // browser's own leniency makes work — the tests' DOM is not lenient.
    const mine =
      (item as HTMLElement).dataset.at === String(state.chapter?.at ?? -1);
    // Not Stash's `active`: Bootstrap paints that one a solid blue, which in a
    // lightbox full of white icons is the loudest thing on the screen — for a mark
    // that only says "you are here". The stylesheet draws a bar instead.
    item.classList.toggle("is-current", mine);
  }
}

/**
 * The options panel: the switches, grouped by what they are about.
 *
 * Three groups, because the things in here are not the same kind of thing — how the
 * pages are paired, what is wrong with *this* gallery's pairing, and how long a turn
 * takes to arrive. Stash's own panel is one flat list of controls, so the grouping is
 * this plugin's decision; it is drawn out of Stash's own `form-group`s and its own
 * rule, so the parts are still borrowed even where the arrangement is not.
 *
 * Two of these switches have been stored since the mode was written and have never
 * had a control to reach them: `coverAlone` and `detectSpreads` were read by the
 * pairing and written by nothing. They are here now.
 *
 * Built once and updated after, like the chapter menu and for a sharper reason: a
 * rebuild per input event would replace the element under the pointer, and a slider
 * that is rebuilt mid-drag is a slider that stops following the drag.
 */
function drawSettings(panel: HTMLElement, state: ChromeState): void {
  const label = (id: string) => stringFor(state.locale, id);

  if (panel.getAttribute("data-built") !== "yes") {
    panel.setAttribute("data-built", "yes");
    // Added, not assigned: the class that identifies this panel is how the pass finds
    // it again, and overwriting the class name once meant every later pass failed to
    // find it and gave up before syncing anything.
    panel.classList.add(CLASS_SETTINGS);
    panel.textContent = "";

    const heading = document.createElement("div");
    heading.className = "popover-header";
    labels["mangaReader.options"] = heading;
    panel.appendChild(heading);

    const body = document.createElement("div");
    body.className = "popover-body";
    panel.appendChild(body);

    /**
     * One group: a heading, and then the controls, all in a `form-group` — Stash's
     * own class for exactly this, one control held off the next, so the gap between
     * them comes from its stylesheet rather than from a margin written here.
     */
    const group = (labelId: string): HTMLElement => {
      const node = document.createElement("div");
      node.className = "form-group " + CLASS_GROUP;
      const title = text(CLASS_GROUP_LABEL);
      labels[labelId] = title;
      node.appendChild(title);
      body.appendChild(node);
      return node;
    };

    /** Stash's own rule between one group and the next, edge to edge. */
    const rule = (): HTMLElement => {
      const line = document.createElement("hr");
      line.className = CLASS_DIVIDER;
      body.appendChild(line);
      return line;
    };

    /**
     * One row: the words on the left, the control on the right — which is how Stash
     * lays out the settings on its own settings page.
     *
     * The words are their own label rather than a `form-check`'s, because the control
     * this label is for is not inside it: a hint under the words belongs to them, so
     * the two go in one column and the control in the other.
     */
    const row = (
      id: string,
      textId: string,
      control: HTMLElement
    ): HTMLElement => {
      const node = text(CLASS_ROW, "div");

      const name = document.createElement("label");
      name.className = CLASS_ROW_LABEL;
      name.htmlFor = id;
      labels[textId] = name;
      node.appendChild(name);
      node.appendChild(control);
      return node;
    };

    /**
     * A switch, in Bootstrap's own markup for one.
     *
     * `custom-switch` is what Stash's `Form.Switch` renders — the toggles on its
     * settings page — so this is that control, colours and all. The label is empty
     * because the words are the row's, on the other side: Bootstrap draws the switch
     * as two pseudo-elements of the label, so a label there has to be.
     */
    const switchAt = (
      id: string,
      onChange: (on: boolean) => void
    ): HTMLElement => {
      const wrap = document.createElement("div");
      wrap.className = "custom-control custom-switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "custom-control-input";
      input.id = id;
      input.addEventListener("change", () => {
        onChange(input.checked);
      });

      const empty = document.createElement("label");
      empty.className = "custom-control-label";
      empty.htmlFor = id;

      wrap.appendChild(input);
      wrap.appendChild(empty);
      return wrap;
    };

    // ── How the pages are paired ──────────────────────────────────────────
    const reading = group("mangaReader.groupReading");

    /**
     * A pair of buttons: one of two, rather than on or off, so not a switch.
     *
     * See CLASS_PAGES for why it is not Stash's own button group. `choose` is asked
     * which half was pressed, by its id, and says what to write.
     */
    const pair = (
      first: { id: string; textId: string },
      second: { id: string; textId: string },
      choose: (id: string) => void
    ): HTMLElement => {
      const track = text(CLASS_PAGES, "div");
      for (const half of [first, second]) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = half.id;
        // `minimal` is Stash's own class for a button with nothing behind it — what
        // its lightbox header draws its icons with.
        button.className = "btn minimal " + CLASS_SEGMENT;
        button.addEventListener("click", () => {
          // A press on the half already chosen says nothing: the reader re-lays the
          // pages whenever it hears this setting, and re-laying them for a press that
          // chose what was already true is a screen redrawn for nothing. The class is
          // the state — see the pass below, which is what writes it.
          if (button.classList.contains("is-on")) return;
          choose(half.id);
        });
        labels[half.textId] = button;
        track.appendChild(button);
      }

      return track;
    };

    reading.appendChild(
      pair(
        { id: SINGLE_PAGE_ID, textId: "mangaReader.singlePage" },
        { id: DOUBLE_PAGE_ID, textId: "mangaReader.doublePage" },
        (id) =>
          latest?.handlers.onSetting({ doublePage: id === DOUBLE_PAGE_ID })
      )
    );

    // Three settings that are questions about a *pair*, and are put away with the
    // pairing itself — see the pass below. The shift is one of them now: it was its
    // own group, named for a gallery, back when it was remembered per gallery.
    parts.coverRow = row(
      COVER_ID,
      "mangaReader.coverAlone",
      switchAt(COVER_ID, (on) => latest?.handlers.onSetting({ coverAlone: on }))
    );
    reading.appendChild(parts.coverRow);

    parts.spreadsRow = row(
      SPREAD_ID,
      "mangaReader.detectSpreads",
      switchAt(SPREAD_ID, (on) =>
        latest?.handlers.onSetting({ detectSpreads: on })
      )
    );
    reading.appendChild(parts.spreadsRow);

    parts.offsetRow = row(
      OFFSET_ID,
      "mangaReader.offset",
      switchAt(OFFSET_ID, (on) => latest?.handlers.onOffset(on))
    );
    reading.appendChild(parts.offsetRow);

    rule();

    // ── How a screen arrives ──────────────────────────────────────────────
    const animation = group("mangaReader.groupAnimation");
    animation.appendChild(
      pair(
        { id: FADE_OFF_ID, textId: "mangaReader.fadeOff" },
        { id: FADE_ON_ID, textId: "mangaReader.fade" },
        (id) => latest?.handlers.onSetting({ fade: id === FADE_ON_ID })
      )
    );
  }

  /**
   * One of this plugin's words, written only where it is not already there.
   *
   * The key is the message id itself, which is also how the pass that builds the
   * panel files each label. Two names for one thing is how this went wrong once
   * already: the build filed a label under its message id and the update looked it up
   * under a short name of the same setting, found nothing, and left every label in the
   * language the first pass happened to be drawn in.
   */
  const say = (id: string): void => {
    const node = labels[id];
    const words = label(id);
    if (node && node.textContent !== words) node.textContent = words;
  };

  /** A switch's state, written only where it differs — a write is a change */
  const set = (id: string, on: boolean): void => {
    const box = panel.querySelector("#" + id) as HTMLInputElement | null;
    if (box && box.checked !== on) box.checked = on;
  };

  say("mangaReader.options");
  say("mangaReader.groupReading");
  say("mangaReader.groupAnimation");

  say("mangaReader.singlePage");
  say("mangaReader.doublePage");
  say("mangaReader.fadeOff");
  say("mangaReader.fade");

  // Which half of a pair is the chosen one. `is-on` rather than Stash's `active`,
  // which is a solid blue: see drawChapters.
  const chosen = (id: string, on: boolean): void => {
    const half = panel.querySelector("#" + id);
    if (half) half.classList.toggle("is-on", on);
  };

  chosen(SINGLE_PAGE_ID, !state.settings.doublePage);
  chosen(DOUBLE_PAGE_ID, state.settings.doublePage);
  chosen(FADE_OFF_ID, !state.settings.fade);
  chosen(FADE_ON_ID, state.settings.fade);

  set(COVER_ID, state.settings.coverAlone);
  set(SPREAD_ID, state.settings.detectSpreads);
  set(OFFSET_ID, state.settings.offset);

  say("mangaReader.coverAlone");
  say("mangaReader.detectSpreads");
  say("mangaReader.offset");

  // Three of these settings are about a *pair*, and a reader reading one page at a
  // time has no use for any of them: "cover on a page of its own" and "detect
  // spreads" describe how two pages are put together, and the shift moves that
  // pairing by a page. So they go with the pairing — the switches, the group they
  // live in, and the rule that separates it, with the rule above it left in place so
  // the panel still has one between the two groups that remain.
  const paired = state.settings.doublePage;
  showWhen(parts.coverRow, paired);
  showWhen(parts.spreadsRow, paired);
  showWhen(parts.offsetRow, paired);
}

const SINGLE_PAGE_ID = "manga-reader-single-page";
const DOUBLE_PAGE_ID = "manga-reader-double-page";
const COVER_ID = "manga-reader-cover-alone";
const SPREAD_ID = "manga-reader-detect-spreads";
const OFFSET_ID = "manga-reader-offset";
const FADE_OFF_ID = "manga-reader-fade-off";
const FADE_ON_ID = "manga-reader-fade-on";

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

// Published for the tests, which reach the reader's own logic through the window —
// see the note on MangaReaderNamespace in plugin-api.ts.
NR.fitShift = fitShift;
