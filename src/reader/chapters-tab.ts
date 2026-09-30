/**
 * The gallery page's Chapters tab, rendered from this plugin's chapters.
 *
 * Stash's own tab lists its own rows — a title and an `image_index`, a position in
 * path order — and its Create and Edit buttons write them. This plugin lists *its*
 * chapters there instead, and offers the one write it has: an **import**, which
 * copies Stash's rows into this plugin's field as image ids. That field is the one
 * that can say which images a chapter holds, and it is the one the reader hands to
 * the lightbox. Editing this plugin's own list is still to come. **Stash's rows are
 * never written**, here or anywhere else: they are read for as long as they are the
 * only thing that knows where a chapter is, and after that they are left exactly as
 * they are.
 *
 * A DOM takeover, because there is nothing else to patch: Stash's panel and its
 * chapter entries are plain exports with no `PatchComponent` wrapper, so the way in
 * is the markup — the tab's own container, found by the button that sits before it,
 * emptied and filled with this plugin's rows.
 *
 * The rows are Stash's shape, deliberately: the same `btn btn-link` in a `.row`
 * after an `<hr>`, so the tab looks like itself. What is missing is the Edit button,
 * which belongs to Stash's rows and not to this plugin's — what is under the rows
 * instead is the **import**: one button that copies Stash's chapters into this
 * plugin's field, converted from positions into image ids. Editing this plugin's own
 * list — making a chapter, renaming one, taking one out — is still to come, and it
 * will write the same field this button does.
 *
 * Clicking a row opens the lightbox at that chapter, which is what Stash's own rows
 * do: the same errand, by a different road. Stash's way is a function this plugin
 * cannot call, so the lightbox is opened through the bridge — with this plugin's
 * images and chapters, at the index the chapter begins at. Which also means the
 * lightbox a chapter opens is the one the reader will be drawing in.
 */
import { stringFor } from "../i18n";
import { NS } from "../tools/fields";
import { bridged, takeOver } from "./bridge";
import {
  type MangaReaderChapter,
  type MangaReaderPlacedChapter,
  chaptersFromStash,
  parseChapters,
  placeChapters,
  serializeChapters,
} from "./chapters";
import {
  type LightboxImage,
  fetchGallery,
  galleryIdFromPath,
} from "./stash-lightbox";

/** The button Stash renders above its list, which is also how the list is found */
// One class rather than `div.container`, so the same string works against the test
// world's elements — which match a single class, an id or a tag, and refuse to guess
// at anything else. The button check below is what keeps the match specific.
const SEL_PANEL = ".container";
/** Marks a node as Stash's, so it is hidden once and found again on the next pass */
const HIDDEN = "data-manga-reader-hidden";
/** The import control, found again by this id when the page is drawn over */
const IMPORT_ID = "manga-reader-chapters-import";

/** What was rendered, so a pass over the document only rebuilds when it differs */
let renderedFor = "";
/** The gallery whose chapters are in hand, and what they are */
let inHand: {
  id: string;
  images: LightboxImage[];
  chapters: MangaReaderPlacedChapter[];
  /** What Stash's own rows translate to — what an import would write */
  importable: MangaReaderChapter[];
  /** Whether this gallery already has a list of this plugin's own */
  own: boolean;
  /** The interface language, for the control's wording */
  locale: string | null;
} | null = null;

/** The import control, kept between passes, and what it was last built as */
let control: HTMLElement | null = null;
let controlState: "offer" | "confirm" | "busy" | null = null;
/** What that button would import, as of the last pass that drew it */
let controlFor: {
  id: string;
  importable: MangaReaderChapter[];
  own: boolean;
} | null = null;
/** A write is in flight: the button says so and refuses a second click */
let busy = false;
/**
 * A re-import has been asked for and not yet confirmed.
 *
 * A second click, not a dialog: this is a DOM takeover with no React of its own to
 * render one into (Stash's own confirm is a react-bootstrap `Modal`, and the reader
 * test world does not render). Two steps in one control, which is the shape the
 * tools half's modal replaced — and it is affordable here because the render key
 * already carries the state, so a pass cannot draw the wrong half of it.
 */
let confirming = false;

/**
 * One pass over the document: is a Chapters tab on screen, and does it say what
 * this plugin's chapters are?
 *
 * Called from the same observer as the reader, which sees every change in the page.
 * Everything expensive is behind the two cheap tests below — a query for the panel
 * and a string compare — and the fetch happens once per gallery.
 */
export function syncChaptersTab(): void {
  const id = galleryIdFromPath(window.location.pathname);
  if (!id) {
    forgetChaptersTab();
    return;
  }

  // Manga only, and told by the store rather than by a query: a tab on any other
  // gallery is Stash's, untouched and unasked about.
  if (NS.markedInStore(id) !== true) return;

  const panel = findPanel();
  if (!panel) return;

  // Nothing to say without a way to open the lightbox: a takeover that listed
  // chapters nobody could click would be worse than Stash's own rows, which at
  // least go somewhere.
  if (!bridged()) return;

  if (inHand?.id === id) {
    render(panel, inHand);
    return;
  }

  if (inHand?.id !== id) {
    inHand = null;
    renderedFor = "";
    fetchGallery(id, { sort: "path", direction: "ASC" })
      .then((answer) => {
        // Another gallery, or another page, while that was in flight.
        if (galleryIdFromPath(window.location.pathname) !== id) return;

        const pageIds = answer.pages.map((page) => page.id);
        const own = chaptersOf(answer);

        inHand = {
          id,
          images: answer.images,
          chapters: placeChapters(own.chapters, answer.pages),
          // The list an import would write, which is the same translation the tab
          // is showing for a gallery that has no list of this plugin's own.
          // Computed from the rows rather than from what is on screen: it is what
          // would be *written*, so it cannot depend on how the screen is ordered.
          importable: chaptersFromStash(answer.stashChapters, pageIds),
          own: own.own,
          locale: answer.language,
        };
        syncChaptersTab();
      })
      .catch((e) => {
        console.error(
          "[mangaReader] could not read this gallery's chapters, so its tab is " +
            "left as Stash drew it:",
          e
        );
      });
  }
}

/**
 * The gallery's chapters, from this plugin's list or from Stash's own rows.
 *
 * The same rule the reader uses, and the same reason: a gallery with no list of its
 * own is read from Stash's numbers, translated against path order. Which here is
 * the order that was fetched, so the translation costs nothing extra.
 */
function chaptersOf(answer: {
  customFields: unknown;
  stashChapters: { title?: string; image_index?: number }[];
  pages: { id: string }[];
}): { chapters: MangaReaderChapter[]; own: boolean } {
  const own = parseChapters(
    NS.pickField(answer.customFields, NS.CHAPTER_FIELD_NAME) || null
  );

  // A list this plugin wrote may be empty on purpose — an empty array is a gallery
  // whose chapters were cleared — and it wins over Stash's rows exactly as a full
  // one does. Only *null* (no field, or a value this build cannot read) falls
  // through to Stash's numbers.
  if (own) return { chapters: own, own: true };

  return {
    chapters: chaptersFromStash(
      answer.stashChapters,
      answer.pages.map((page) => page.id)
    ),
    own: false,
  };
}

/**
 * Stash's panel, or null when it is not on screen.
 *
 * Found by the shape rather than by a class of its own: Stash's chapters panel is a
 * button and a `div.container` beside it, which is a shape nothing else in a
 * gallery page has. A tab this plugin cannot find is a tab it leaves alone.
 */
function findPanel(): HTMLElement | null {
  const panels = document.querySelectorAll(SEL_PANEL);
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i] as HTMLElement;
    if (isStashButton(panel.previousElementSibling)) return panel;
  }

  return null;
}

/**
 * Whether a node is the button Stash renders above its list.
 *
 * Read by tag and class rather than by `matches`, and by attribute rather than by
 * `hasAttribute`, so that the same code runs against the test world's elements —
 * which have the shapes this plugin uses and not a selector engine.
 */
function isStashButton(node: Element | null): node is HTMLElement {
  return (
    !!node &&
    node.tagName === "BUTTON" &&
    node.classList.contains("btn") &&
    node.getAttribute(HIDDEN) === null
  );
}

/**
 * Draws the rows, once per gallery and per change of the list.
 *
 * Idempotent by construction: the key is the whole of what is rendered, and a pass
 * that finds it unchanged does nothing. This runs inside a MutationObserver, so an
 * unconditional write would be a change that causes a change.
 */
function render(
  panel: HTMLElement,
  gallery: {
    id: string;
    images: LightboxImage[];
    chapters: MangaReaderPlacedChapter[];
    importable: MangaReaderChapter[];
    own: boolean;
    locale: string | null;
  }
): void {
  // Everything the render reads is in the key, the import's state included. The rows
  // alone would not be enough: an import writes the *translation* of Stash's own
  // rows, so the rows before it and after it are identical, and a key made of them
  // would match and return early with the button still offering the import that has
  // just happened. What forces that pass today is `busy`, which flips on the way
  // through a write; `own` is here so that the key says what this render actually
  // depends on rather than only what happens to change.
  const key = [
    gallery.id,
    gallery.own ? "own" : "none",
    String(gallery.importable.length),
    busy ? "busy" : confirming ? "confirm" : "idle",
    ...gallery.chapters.map((c) => c.title + "@" + c.at),
  ].join("|");
  if (key === renderedFor && panel.childElementCount > 0) return;
  renderedFor = key;

  // Stash's own button goes, rather than being disabled: this plugin is where a
  // gallery's chapters are kept now — it can import them, and it will be able to
  // edit them — and Stash's own button writes Stash's rows, which nothing here
  // touches.
  const button = panel.previousElementSibling;
  if (button) button.setAttribute(HIDDEN, "");

  panel.textContent = "";
  for (const chapter of gallery.chapters) {
    panel.appendChild(row(gallery, chapter));
  }

  drawImport(panel, gallery);
}

/**
 * The import control: a box of this plugin's own under the list, and the button in
 * it.
 *
 * It sits **after** Stash's container rather than inside it or between it and
 * Stash's own button, and both of those other places are spoken for: `findPanel`
 * knows the panel by the button immediately before it, so a control there would be
 * taken for Stash's own and hidden by the next pass; and the panel's children are
 * its rows, so a control in there would be drawn as one and read as one. After it,
 * neither lookup has anything to say about it.
 *
 * The button is built once and updated after, and what it would import lives in
 * `controlFor` rather than in the click handler's closure: the control outlives the
 * pass that made it, and a handler closed over that pass's gallery would offer to
 * import the previous gallery's chapters.
 */
function drawImport(
  panel: HTMLElement,
  gallery: {
    id: string;
    importable: MangaReaderChapter[];
    own: boolean;
    locale: string | null;
  }
): void {
  // Nothing to bring over: a gallery Stash has no chapters for, or one whose rows
  // all point past the end of its images. Either way an import would write nothing,
  // and a write to no purpose is worse than no button.
  if (gallery.importable.length === 0) {
    control?.remove();
    control = null;
    controlState = null;
    controlFor = null;
    confirming = false;
    return;
  }

  // Another gallery: whatever was being confirmed was about a different list, and
  // confirming it here would be a write nobody asked for.
  if (controlFor?.id !== gallery.id) confirming = false;

  controlFor = {
    id: gallery.id,
    importable: gallery.importable,
    own: gallery.own,
  };

  if (!control) {
    control = document.createElement("div");
    control.id = IMPORT_ID;
    control.className = "manga-reader-chapters-import";
  }

  const place = panel.parentNode;
  if (place && control.parentNode !== place) {
    place.insertBefore(control, panel.nextElementSibling);
  }

  const state = busy ? "busy" : confirming ? "confirm" : "offer";
  if (state !== controlState) {
    controlState = state;
    control.textContent = "";
    buildControl(control, gallery.locale, state);
  }
}

/**
 * Puts the control's own contents up, for the state it is in.
 *
 * Rebuilt on a change of state rather than updated in place, because the states
 * differ in *shape* — one button, or a warning and two — and an update that had to
 * reconcile those would be the thing that goes wrong. What the buttons do is read
 * from module state rather than closed over, for the reason `controlFor` is: the
 * control outlives the pass that built it.
 */
function buildControl(
  box: HTMLElement,
  locale: string | null,
  state: "offer" | "confirm" | "busy"
): void {
  if (state === "confirm") {
    const warning = document.createElement("div");
    warning.className = "manga-reader-chapters-import-warning";
    warning.textContent = stringFor(locale, "mangaReader.reimportWarning");
    box.appendChild(warning);

    box.appendChild(
      button("btn btn-danger btn-sm", "mangaReader.reimportReplace", () => {
        confirming = false;
        importChapters();
      })
    );
    box.appendChild(
      button("btn btn-secondary btn-sm", "mangaReader.reimportCancel", () => {
        confirming = false;
        redraw();
      })
    );
    return;
  }

  const wording =
    state === "busy"
      ? "mangaReader.importingChapters"
      : controlFor?.own
        ? "mangaReader.reimportChapters"
        : "mangaReader.importChapters";

  const offer = button("btn btn-secondary btn-sm", wording, askToImport);
  offer.disabled = state === "busy";
  box.appendChild(offer);
}

/** One of the control's buttons, worded and wired the same way */
function button(
  className: string,
  wording: string,
  onClick: () => void
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = stringFor(inHand?.locale, wording);
  node.addEventListener("click", onClick);
  return node;
}

/**
 * The import that was asked for: the write, or a second question first.
 *
 * A gallery with no list of this plugin's own has nothing to lose, so the import
 * goes. One that already has a list is about to have it written over, and — since
 * the field is hidden from Stash's own custom-field editor — that list is not
 * visible anywhere but here. So it is asked for twice.
 */
function askToImport(): void {
  if (!controlFor || busy) return;

  if (controlFor.own) {
    confirming = true;
    redraw();
    return;
  }

  importChapters();
}

/**
 * Writes Stash's chapters into this plugin's own field.
 *
 * The write is the tools half's — the same quiet mutation the mark uses, with the
 * store and Stash's own form told first — and this half hands over a *string*: the
 * format is its own, and the half that writes does not have to know what a chapter
 * is. Nothing is read back afterwards: what was written is the value in hand, so
 * this gallery has a list of its own from here on, which is a fact rather than a
 * guess. The server is asked again the next time the tab is opened, which is where
 * the list on screen was read from.
 */
function importChapters(): void {
  const target = controlFor;
  if (!target || busy) return;

  // The tools half publishes the write. It cannot be *hidden* for the case where
  // that half did not start: whether this gallery is manga comes from the same
  // half, so the tab this control is in would not exist either — the check is a
  // guard against the impossible, and it says so rather than throwing.
  if (typeof NS.importChapters !== "function") {
    console.error(
      "[mangaReader] the tools half is not running, so this gallery's chapters " +
        "cannot be written"
    );
    return;
  }

  busy = true;
  redraw();

  NS.importChapters(target.id, serializeChapters(target.importable)).then(
    () => {
      busy = false;
      if (inHand?.id === target.id) {
        inHand.own = true;
        inHand.importable = target.importable;
      }

      confirming = false;
      redraw();
    },
    (e: unknown) => {
      busy = false;
      confirming = false;
      console.error(
        "[mangaReader] could not import this gallery's chapters:",
        e
      );
      redraw();
    }
  );
}

/**
 * Draws the tab again from the gallery in hand.
 *
 * The panel is not looked up again, and cannot be: the first pass hides Stash's own
 * button, which is the shape `findPanel` recognises the panel by, so from then on
 * it refuses the panel it already knows. The control is a sibling of that panel, so
 * the panel is the element before it.
 */
function redraw(): void {
  if (!inHand) return;

  const panel = control?.previousElementSibling;
  if (panel) render(panel as HTMLElement, inHand);
}

/** One chapter, drawn the way Stash draws one */
function row(
  gallery: { images: LightboxImage[]; chapters: MangaReaderPlacedChapter[] },
  chapter: { title: string; at: number }
): HTMLElement {
  const wrap = document.createElement("div");

  const rule = document.createElement("hr");
  wrap.appendChild(rule);

  const line = document.createElement("div");
  line.className = "row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-link";

  const label = document.createElement("div");
  label.className = "row";
  // Stash's own wording for a row: the name, then where it starts, counted the way
  // it counts — one-based, in the order the list was fetched.
  label.textContent =
    (chapter.title.length > 0 ? chapter.title + " - #" : "#") +
    (chapter.at + 1);
  button.appendChild(label);

  button.addEventListener("click", () => {
    takeOver({
      images: gallery.images,
      totalCount: gallery.images.length,
      at: chapter.at,
    });
  });

  line.appendChild(button);
  wrap.appendChild(line);

  return wrap;
}

/** Forgets the gallery in hand, for when the page it belonged to is gone */
export function forgetChaptersTab(): void {
  inHand = null;
  renderedFor = "";
  control = null;
  controlState = null;
  controlFor = null;
  confirming = false;
}
