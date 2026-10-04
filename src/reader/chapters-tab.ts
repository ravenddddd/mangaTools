/**
 * The gallery page's Chapters tab, rendered from this plugin's chapters.
 *
 * Stash's own tab lists its own rows — a title and an `image_index`, a position in
 * path order — and its Create and Edit buttons write them. This plugin lists *its*
 * chapters there instead, and its Create and Edit buttons **write this plugin's own
 * field**: the one that can say which images a chapter holds, and the one the reader
 * hands to the lightbox. The form is Stash's, down to the two fields and the three
 * buttons, because that is the shape somebody using this tab already knows — what
 * changed is only where the answer is kept.
 *
 * **Stash's rows are never written**, here or anywhere else: they are read for as
 * long as they are the only thing that knows where a chapter is, and after that they
 * are left exactly as they are. There is also an **import** button under the list,
 * which is the other direction: it copies Stash's rows into this plugin's field, for
 * a gallery whose chapters have never been edited here.
 *
 * A DOM takeover, because there is nothing else to patch: Stash's panel and its
 * chapter entries are plain exports with no `PatchComponent` wrapper, so the way in
 * is the markup — the tab's own container, found by the button that sits before it,
 * emptied and filled with this plugin's rows.
 *
 * The rows are Stash's shape too: the same `btn btn-link` in a `.row` after an
 * `<hr>`, and — the half that used to be missing — the same Edit link beside it,
 * which is what opens the form on that chapter. The number in a row is a *position
 * in path order* because that is what the form's second field asks for, and the two
 * have to agree: they are the same number the reader is looking at.
 *
 * Clicking a row opens the lightbox at that chapter, which is what Stash's own rows
 * do: the same errand, by a different road. Stash's way is a function this plugin
 * cannot call, so the lightbox is opened through the bridge — with this plugin's
 * images and chapters, at the index the chapter begins at. Which also means the
 * lightbox a chapter opens is the one the reader will be drawing in.
 */
import { numbered, stringFor } from "../i18n";
import { NS } from "../tools/fields";
import { bridged, takeOver } from "./bridge";
import { drawIcon } from "./chrome";
import {
  type MangaReaderChapter,
  type MangaReaderPlacedChapter,
  addChapterAt,
  addChaptersAt,
  chaptersFromStash,
  moveChapterStart,
  parseChapterList,
  parseChapters,
  placeChapters,
  removeChapterAt,
  renameChapterAt,
  serializeChapters,
} from "./chapters";
import { watchChapters, writeChapters } from "./chapters-edit";
import { NR } from "./namespace";
import type { MangaReaderPage } from "./spreads";
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
/** The class the per-row Edit link carries, so a test can find it */
const CLASS_EDIT = "manga-reader-chapter-edit";
/** Marks Stash's own button as one this plugin has already taken over */
const TAKEN = "data-manga-reader-taken";
/** On Stash's Create button while this plugin's chapter form is open */
const CLASS_EDITING = "manga-reader-chapters-editing";

/** What was rendered, so a pass over the document only rebuilds when it differs */
let renderedFor = "";
/** The tab's container, while it is on screen — what a redraw draws into */
let panelInHand: HTMLElement | null = null;
/** The gallery whose chapters are in hand, and what they are */
interface ChaptersInHand {
  id: string;
  images: LightboxImage[];
  /** The pages as they were fetched, which is the order the numbers count in */
  pages: MangaReaderPage[];
  /**
   * The list as it is stored, which is what an edit changes — *not* the placed list
   * the rows are drawn from. Placing drops a chapter with nothing on screen, and an
   * edit that started from the placed list would drop it for good.
   */
  stored: MangaReaderChapter[];
  /** The same list placed in the order the pages came in — what the rows show */
  chapters: MangaReaderPlacedChapter[];
  /** What Stash's own rows translate to — what an import would write */
  importable: MangaReaderChapter[];
  /** Whether this gallery already has a list of this plugin's own */
  own: boolean;
  /** The interface language, for the wording */
  locale: string | null;
}

/** The gallery the tab is drawing, or null when it has never read one */
let inHand: ChaptersInHand | null = null;

/**
 * The form, while one is open, and what its fields started as.
 *
 * The *draft* is not here: what somebody has typed lives in the input, and is read
 * when Save is pressed. Keeping it here would put it in the render key, and a key
 * that changes on every keystroke is a form that is rebuilt under the cursor —
 * which is the one thing this shape of UI gets wrong if nobody stops it.
 */
let form: {
  /** The page the chapter being edited begins at, or null when making a new one */
  startPageId: string | null;
  /** What the fields said when the form opened, which is what "changed" means */
  initialTitle: string;
  initialIndex: string;
} | null = null;
/** What was wrong with the last Save, or "" — read only when a form is drawn */
let formError = "";

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

/** The entry to the bulk editor, kept between passes so the panel's neighbours stay put */
let bulkButton: HTMLButtonElement | null = null;

/**
 * Whether the bulk editor is up, in place of the rows.
 *
 * What has been pasted and typed is *not* here: the list lives in the textarea and
 * the pages live in the table's inputs, and both are read when Create is pressed —
 * the rule the single-chapter form already follows, and for the same reason. A key
 * that changes on a keystroke is a table rebuilt under the cursor.
 */
let bulk = false;

/**
 * The pages typed into the bulk table, by row.
 *
 * Module state rather than something the drawing closes over, because the rows are
 * rebuilt whenever the *list* changes (see drawBulk) and the numbers must survive
 * that: a reader who pastes, numbers six rows and then fixes a typo in the paste box
 * should not lose the six numbers. Written by the table's own listeners and never put
 * in the render key, so it cannot rebuild anything by itself.
 */
let bulkPages: string[] = [];

/** The tallest pasted list this editor will take — see drawBulk */
const BULK_LIMIT = 64;

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
  // Management turned off puts Stash's own tab back: whatever this half drew there is
  // forgotten, which is the same errand as leaving a page with no gallery on it.
  if (!id || !NS.manageChapters) {
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
          pages: answer.pages,
          stored: own.chapters,
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
    if (isStashButton(stashButtonBefore(panel))) return panel;
  }

  return null;
}

/**
 * Stash's Create button above a panel, stepping over this plugin's own button.
 *
 * The bulk editor's entry sits **to the right of** Stash's, which puts it between that
 * button and the panel — and the panel is found by the button above it, so a walk that
 * stopped at the first node would find ours, refuse it, and lose the tab on every
 * later pass. Ours carries an id, and that is what this steps over.
 */
function stashButtonBefore(panel: HTMLElement): Element | null {
  let at = panel.previousElementSibling;
  while (at && at.id === BULK_ID) at = at.previousElementSibling;
  return at;
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
function render(panel: HTMLElement, gallery: ChaptersInHand): void {
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
    bulk
      ? "bulk"
      : form
        ? "form:" + (form.startPageId ?? "new") + (formError ? ":bad" : "")
        : "list",
    ...gallery.chapters.map((c) => c.title + "@" + c.at),
  ].join("|");
  if (key === renderedFor && panel.childElementCount > 0) return;
  renderedFor = key;
  panelInHand = panel;

  takeOverCreate(panel);
  ensureBulkButton(panel);
  toggleCreate(panel, !form && !bulk);

  // **Cleared only when there is something to clear**, and that is what keeps a pass
  // from being a change the observer answers with another pass. `textContent = ""` is
  // not a no-op: it removes the children and appends an empty *text node*, which is a
  // mutation — and `childElementCount` counts elements, so a panel holding nothing but
  // that text node still reads as empty and the early return above never applies. The
  // result is a pass that draws nothing, changes something, and comes round again: a
  // frozen page. See the guarded writes in ensureBulkButton for the same rule.
  if (panel.children.length > 0) panel.textContent = "";
  if (bulk) {
    drawBulk(panel, gallery);
  } else if (form) {
    drawForm(panel, gallery);
  } else {
    for (const chapter of gallery.chapters) {
      panel.appendChild(row(gallery, chapter));
    }
  }

  // The import is about the list, and both editors are on top of it.
  if (form || bulk) hideImport();
  else drawImport(panel, gallery);
}

/**
 * Takes over Stash's own Create button, which is what opens the form.
 *
 * **Stopped in the capture phase**, because Stash's handler is React's: React listens
 * at the root and in the bubbling phase, so a listener on the button that stops the
 * event on its way *down* never reaches it. The button then does exactly what this
 * plugin says and nothing else — the same way the footer's image link is kept from
 * navigating to the page the plugin has moved on from.
 *
 * The button is *not* hidden, which is a change from what this tab used to do: the
 * button is now the way in rather than something in the way, and leaving it visible
 * is also what keeps `findPanel` able to find this panel on every pass — it
 * recognises the panel by the button before it, and a hidden button is one it
 * refuses.
 */
function takeOverCreate(panel: HTMLElement): void {
  const button = stashButtonBefore(panel);
  if (!isStashButton(button)) return;
  if (button.getAttribute(TAKEN) !== null) return;

  button.setAttribute(TAKEN, "");
  button.addEventListener(
    "click",
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      openForm(null);
    },
    true
  );
}

/** The id the entry button carries, so a test can find it */
const BULK_ID = "manga-reader-chapters-bulk";
/** …and the one the Create button carries, for the same reason */
const BULK_CREATE_ID = "manga-reader-bulk-create";

/**
 * The way into the bulk editor: a button of this plugin's own beside Stash's Create.
 *
 * Inserted **before** Stash's button rather than after the panel, which is where the
 * import control went. `findPanel` knows a panel by the button immediately above it,
 * so a node between the two would be taken for Stash's own and would hide the panel
 * from the next pass; before it, both lookups keep working and the two buttons sit
 * together, which is what the mock asked for.
 *
 * It is put away while either editor is up, for the same reason the import is: an
 * editor on top of the rows is not a place to offer another way to write them.
 */
function ensureBulkButton(panel: HTMLElement): void {
  const owner = panel.previousElementSibling;
  if (!isStashButton(owner)) return;

  if (!bulkButton) {
    bulkButton = document.createElement("button");
    bulkButton.type = "button";
    bulkButton.id = BULK_ID;
    bulkButton.className = "btn btn-secondary btn-sm";
    bulkButton.addEventListener("click", (event: Event) => {
      event.preventDefault();
      openBulk();
    });
  }

  // **Copied off Stash's own button** rather than written out: it has to look like the
  // Create beside it, and a class list taken from the thing itself cannot drift from
  // it. The same reasoning as readNativeFieldClasses in the tools half.
  if (bulkButton.className !== owner.className) {
    bulkButton.className = owner.className;
  }

  if (owner.nextElementSibling !== bulkButton) {
    owner.parentNode?.insertBefore(bulkButton, owner.nextElementSibling);
  }

  // **Written only when it changes**, and that is not tidiness: this runs inside a
  // pass over the document, and every write here is a change the observer sees and
  // answers with another pass. Assigning the same string to `textContent` is not a
  // no-op — it replaces the text node — so an unconditional write, on a page whose
  // panel draws nothing (no chapters and no form: `render`'s early return needs a
  // non-empty panel, so those passes come round again) is an endless loop, and an
  // endless loop is a frozen page. See manageDialogTags in dialog-filter.ts, where
  // the same rule is written down for the same reason.
  const wording = stringFor(inHand?.locale, "mangaReader.chaptersFromList");
  if (bulkButton.textContent !== wording) bulkButton.textContent = wording;

  const away = bulk || form !== null;
  if (bulkButton.hidden !== away) bulkButton.hidden = away;
}

/** Opens the bulk editor on an empty paste box */
function openBulk(): void {
  if (!inHand) return;
  bulk = true;
  bulkPages = [];
  redraw();
}

/** Closes it without writing anything */
function closeBulk(): void {
  bulk = false;
  bulkPages = [];
  redraw();
}

/**
 * The bulk editor, in place of the rows.
 *
 * **The list is parsed as it is typed, and the table is rebuilt under it** — but the
 * paste box is never touched by that rebuild, so the caret stays where it was, and the
 * numbers already in the table are kept in `bulkPages` and put back. What none of it
 * does is re-render the panel: the key does not carry the list or the numbers, so no
 * pass can rebuild the box under the cursor.
 *
 * The validity column, and the Create button's count and disabled state, are updated
 * by the inputs' own listeners (`validate`) rather than by the render, which is the
 * shape the single-chapter form already uses for its Save button, and the reason the
 * reader can type a page number and watch the row go green without anything moving.
 *
 * The delete button is `btn-danger`, as Stash's own Delete in that form is, and it
 * removes the *row* — a row that is wrong is deleted, which is how the heading line
 * and any prose that came with the paste are got rid of.
 */
function drawBulk(panel: HTMLElement, gallery: ChaptersInHand): void {
  const node = document.createElement("form");
  node.setAttribute("novalidate", "");
  node.addEventListener("submit", (event: Event) => event.preventDefault());

  const container = document.createElement("div");
  // No `px-3`, unlike the single-chapter form: this editor is a table, and its rows
  // want the panel's whole width.
  container.className = "form-container";

  const label = document.createElement("label");
  label.className = "form-label";
  label.setAttribute("for", "chapter_list");
  label.textContent = stringFor(gallery.locale, "mangaReader.bulkPaste");
  container.appendChild(label);

  const area = document.createElement("textarea");
  area.id = "chapter_list";
  area.className = "text-input form-control";
  area.rows = 8;
  container.appendChild(area);

  const table = document.createElement("table");
  table.className = "manga-reader-bulk-table";
  container.appendChild(table);

  const create = document.createElement("button");
  create.type = "button";
  create.id = BULK_CREATE_ID;
  create.className = "btn btn-primary";

  /**
   * The rows as built, in the order they are shown.
   *
   * Held here rather than looked up in the table again: it is this module's own
   * markup, and a walk of it to find the same three nodes on every keystroke is work
   * with nothing behind it. (It is also the plainest DOM — this file builds every
   * other node with `createElement`, and a table is no different.)
   */
  let built: Array<{
    tr: HTMLTableRowElement;
    mark: HTMLSpanElement;
    title: HTMLInputElement;
    page: HTMLInputElement;
  }> = [];

  /** What the table says, one entry per row */
  const rows = (): Array<{ title: string; page: string }> =>
    built.map((row) => ({
      title: row.title.value.trim(),
      page: row.page.value.trim(),
    }));

  /** What is wrong with one row, as a message id, or "" when nothing is */
  const wrongWith = (
    row: { title: string; page: string },
    all: Array<{ title: string; page: string }>,
    at: number
  ): string => {
    if (!row.title) return "mangaReader.bulkNoTitle";
    if (!row.page) return "mangaReader.bulkNoPage";

    const page = Number(row.page);
    if (!Number.isFinite(page) || page < 1 || page > gallery.pages.length) {
      return "mangaReader.bulkPageRange";
    }
    for (let i = 0; i < all.length; i++) {
      if (i !== at && all[i].page === row.page)
        return "mangaReader.bulkPageTwice";
    }
    if (gallery.chapters.some((c) => c.at === page - 1)) {
      return "mangaReader.bulkPageTaken";
    }
    return "";
  };

  /**
   * Re-reads the table and says what it makes of it: the marks, the reasons, and
   * whether Create can be pressed.
   */
  const validate = (): void => {
    const all = rows();
    let good = 0;
    const lined: string[] = [];

    for (let i = 0; i < all.length; i++) {
      lined[i] = all[i].page;
      const wrong = wrongWith(all[i], all, i);
      const mark = built[i]?.mark;
      if (mark) {
        mark.textContent = wrong ? "\u2715" : "\u2713";
        mark.className = wrong
          ? "manga-reader-bulk-bad"
          : "manga-reader-bulk-ok";
        // **Not `title`**: the reason is shown by this plugin's own bubble, drawn from
        // this attribute by the stylesheet (see .manga-reader-bulk-bad). A `title`
        // would put the browser's bubble *beside* ours.
        if (wrong)
          mark.setAttribute("data-why", stringFor(gallery.locale, wrong));
        else mark.removeAttribute("data-why");
      }
      if (!wrong) good++;
    }

    bulkPages = lined;
    // Nothing to show before there is a list: the box says what it is for, and an
    // empty table with an empty placeholder under it says nothing twice.
    table.hidden = all.length === 0;
    create.disabled = all.length === 0 || good !== all.length;
    create.textContent = numbered(
      gallery.locale,
      "mangaReader.bulkCreate",
      all.length
    );
  };

  /** The table, from the list in the box and the pages already typed */
  const build = (): void => {
    const titles = parseChapterList(area.value);
    table.textContent = "";

    if (titles.length > BULK_LIMIT) {
      // A table is a thing a person edits by hand; past this it wants cutting up.
      const over = document.createElement("div");
      over.className = "manga-reader-bulk-empty";
      over.textContent = stringFor(gallery.locale, "mangaReader.bulkTooMany");
      container.insertBefore(over, table);
      return;
    }

    const head = document.createElement("tr");
    head.setAttribute("data-head", "");
    ["", "mangaReader.bulkTitle", "mangaReader.bulkPage", ""].forEach(
      (key, at) => {
        const th = document.createElement("th");
        if (key) th.textContent = stringFor(gallery.locale, key);
        if (at === 2) th.className = "manga-reader-bulk-page";
        head.appendChild(th);
      }
    );
    table.appendChild(head);

    built = [];

    titles.forEach((title, at) => {
      const tr = document.createElement("tr");

      const valid = document.createElement("td");
      valid.className = "manga-reader-bulk-valid";
      const mark = document.createElement("span");
      valid.appendChild(mark);
      tr.appendChild(valid);

      const titleCell = document.createElement("td");
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "text-input form-control";
      titleInput.value = title;
      titleInput.addEventListener("input", validate);
      titleCell.appendChild(titleInput);
      tr.appendChild(titleCell);

      const pageCell = document.createElement("td");
      pageCell.className = "manga-reader-bulk-page";
      const pageInput = document.createElement("input");
      pageInput.type = "number";
      pageInput.className = "text-input form-control";
      pageInput.value = bulkPages[at] ?? "";
      pageInput.addEventListener("input", validate);
      pageCell.appendChild(pageInput);
      tr.appendChild(pageCell);

      const goneCell = document.createElement("td");
      const gone = document.createElement("button");
      gone.type = "button";
      gone.className = "btn btn-danger btn-sm";
      // A glyph rather than the word: the row is four columns wide and the word does
      // not fit in the last of them. The name rides on `aria-label` and the tooltip,
      // so the button is not silent to anybody who cannot see the icon.
      gone.setAttribute(
        "aria-label",
        stringFor(gallery.locale, "mangaReader.bulkRemove")
      );
      gone.setAttribute(
        "title",
        stringFor(gallery.locale, "mangaReader.bulkRemove")
      );
      // Stash's own icon component, drawn by the same helper the lightbox chrome uses:
      // a text glyph would be a different font at a different size.
      drawIcon(gone, "faTrash");
      gone.addEventListener("click", () => {
        bulkPages.splice(at, 1);
        const goneAt = built.findIndex((shown) => shown.tr === tr);
        if (goneAt >= 0) built.splice(goneAt, 1);
        tr.remove();
        // The box is what the table is built from, so a row taken out here has to go
        // out of the list too — otherwise the next keystroke in the box puts it back.
        area.value = titles.filter((_, i) => i !== at).join("\n");
        titles.splice(at, 1);
        validate();
      });
      goneCell.appendChild(gone);
      tr.appendChild(goneCell);

      table.appendChild(tr);
      built.push({ tr, mark, title: titleInput, page: pageInput });
    });
  };

  area.addEventListener("input", () => {
    build();
    validate();
  });

  const buttons = document.createElement("div");
  // `mt-3` rather than a rule of this plugin's own: the gap above the buttons is the
  // one Stash's own forms put there.
  buttons.className = "buttons-container mt-3";
  const row = document.createElement("div");
  row.className = "d-flex";

  create.addEventListener("click", () => {
    const all = rows();
    if (all.some((r, i) => wrongWith(r, all, i))) return;
    createFromList(
      gallery,
      all.map((r) => ({ title: r.title, page: Number(r.page) }))
    );
  });
  row.appendChild(create);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ml-2 btn btn-secondary";
  cancel.textContent = stringFor(gallery.locale, "mangaReader.cancel");
  cancel.addEventListener("click", closeBulk);
  row.appendChild(cancel);

  buttons.appendChild(row);
  node.appendChild(container);
  node.appendChild(buttons);
  panel.appendChild(node);

  build();
  validate();
}

/**
 * The list as chapters: one write, so one undo.
 *
 * The pages are handed over as positions in the order the tab fetched them, which is
 * what the `#N` on every row counts in — the numbers the reader typed are one-based
 * and this is the only place they become ids.
 *
 * `addChaptersAt` writes nothing at all when any one of them cannot be cut, and the
 * table has already refused every case it can see; this is here for the one it
 * cannot — two surfaces changing the list between a keystroke and the click.
 */
function createFromList(
  gallery: ChaptersInHand,
  entries: Array<{ title: string; page: number }>
): void {
  const order = gallery.pages.map((page) => page.id);
  const next = addChaptersAt(
    gallery.stored,
    order,
    entries.map((e) => ({ pageId: order[e.page - 1], title: e.title }))
  );

  if (!next) {
    console.error(
      "[mangaReader] those chapters could not be cut, so none were written"
    );
    return;
  }

  bulk = false;
  bulkPages = [];
  applyEdit(gallery, next);
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
  if (typeof NS.writeChapters !== "function") {
    console.error(
      "[mangaReader] the tools half is not running, so this gallery's chapters " +
        "cannot be written"
    );
    return;
  }

  busy = true;
  redraw();

  NS.writeChapters(target.id, serializeChapters(target.importable)).then(
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
 * Stash's own Create button, out of the way while the form it opens is open.
 *
 * Stash replaces its whole panel with the form — button, rows and all — so while the
 * form is up there is no button to press. This half cannot take Stash's markup away:
 * it is React's, and the next render puts it back. So it is put out of *sight*, by a
 * class of this plugin's own, and not with the `data-manga-reader-hidden` attribute:
 * that one means "this is Stash's and has been dealt with", and it is exactly what
 * `findPanel` refuses a panel for.
 */
function toggleCreate(panel: HTMLElement, shown: boolean): void {
  const button = stashButtonBefore(panel);
  if (!isStashButton(button)) return;

  button.classList.toggle(CLASS_EDITING, !shown);
}

/**
 * Draws the tab again from the gallery in hand.
 *
 * Into the panel this module already drew into, rather than one it looks up: the
 * pass that finds panels belongs to the observer, and a click handler runs between
 * two of its passes. The panel is rememberable — Stash's button stays visible now,
 * so `findPanel` would find it again — but a redraw is not a reason to go looking.
 */
function redraw(): void {
  if (!inHand || !panelInHand) return;
  render(panelInHand, inHand);
}

/**
 * The form, in place of the rows.
 *
 * Stash's shape: two `form-group` rows with a label column and a field column, and a
 * buttons row under them. The column widths are written out rather than copied off a
 * native field row — this tab has none to copy from: the form's own rows are Stash's
 * edit page, which is on another tab and not in the document. `col-sm-3`/`col-sm-9`
 * is the split Stash's `renderInputField` uses, and the README records what happened
 * the last time one of these widths was guessed: it was a breakpoint Stash's build
 * did not have.
 *
 * Built fresh whenever the key changes, which is only ever on opening, saving,
 * cancelling or failing — never on a keystroke. That is what lets the fields keep
 * what was typed in them without a state of their own.
 */
function drawForm(panel: HTMLElement, gallery: ChaptersInHand): void {
  const editing = !!form?.startPageId;

  const node = document.createElement("form");
  node.setAttribute("novalidate", "");
  // Nothing here submits anything — the buttons are handled — but a form that could
  // reload the page is not a form to leave lying about.
  node.addEventListener("submit", (event: Event) => event.preventDefault());

  const container = document.createElement("div");
  container.className = "form-container px-3";

  const titleField = field(
    container,
    gallery.locale,
    "mangaReader.chapterTitle",
    "title",
    "text",
    form?.initialTitle ?? ""
  );
  const indexField = field(
    container,
    gallery.locale,
    "mangaReader.chapterIndex",
    "image_index",
    "number",
    form?.initialIndex ?? "1"
  );

  node.appendChild(container);

  // Every refusal this form can have is about where the chapter begins — a page that
  // already starts one, a page this gallery has not got, a chapter that is gone —
  // so they all land on that field, which is where the answer is wrong.
  if (formError) refuse(indexField.error, stringFor(gallery.locale, formError));

  const title = titleField.input;
  const index = indexField.input;

  const buttons = document.createElement("div");
  buttons.className = "buttons-container px-3";
  const buttonsRow = document.createElement("div");
  buttonsRow.className = "d-flex";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn-primary";
  save.textContent = stringFor(gallery.locale, "mangaReader.save");
  // Stash's own rule, and worth keeping: an edit is only worth saving once something
  // has changed. A *new* chapter is worth making with what the form already says.
  const settle = () => {
    const dirty =
      title.value !== form?.initialTitle || index.value !== form?.initialIndex;
    save.disabled = editing ? !dirty : false;
  };
  title.addEventListener("input", settle);
  index.addEventListener("input", settle);
  settle();
  save.addEventListener("click", () =>
    submitForm(title.value, Number(index.value))
  );
  buttonsRow.appendChild(save);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ml-2 btn btn-secondary";
  cancel.textContent = stringFor(gallery.locale, "mangaReader.cancel");
  cancel.addEventListener("click", closeForm);
  buttonsRow.appendChild(cancel);

  if (editing) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ml-auto btn btn-danger";
    remove.textContent = stringFor(gallery.locale, "mangaReader.delete");
    remove.addEventListener("click", deleteChapter);
    buttonsRow.appendChild(remove);
  }

  buttons.appendChild(buttonsRow);
  node.appendChild(buttons);
  panel.appendChild(node);
}

/**
 * One field, as Stash's own `renderInputField` renders one.
 *
 * Markup for markup, because a form that merely *looks* like Stash's is a form that
 * drifts from it: the label and the input point at each other by `for` and `id`, the
 * placeholder is the label again, the class list is `text-input form-control` in that
 * order, and the error is the empty `.invalid-feedback` Bootstrap shows when the
 * input carries `is-invalid`. Which is what the field's own form — the one on the
 * edit tab — comes out as, so the two are the same form to anything that reads them.
 *
 * The two ids are Stash's own (`title`, `image_index`). A page has one of these forms
 * at a time: the edit tab's is mounted on the edit tab, this one on the Chapters tab.
 */
function field(
  parent: HTMLElement,
  locale: string | null,
  labelId: string,
  name: string,
  type: string,
  value: string
): { input: HTMLInputElement; error: HTMLElement } {
  const group = document.createElement("div");
  group.className = "form-group row";
  group.setAttribute("data-field", name);

  const label = document.createElement("label");
  label.className = "form-label col-form-label col-sm-3";
  label.setAttribute("for", name);
  label.textContent = stringFor(locale, labelId);
  group.appendChild(label);

  const column = document.createElement("div");
  column.className = "col-sm-9";

  const input = document.createElement("input");
  input.className = "text-input form-control";
  input.setAttribute("name", name);
  input.setAttribute("id", name);
  input.type = type;
  input.placeholder = stringFor(locale, labelId);
  input.value = value;
  column.appendChild(input);

  const error = document.createElement("div");
  error.className = "invalid-feedback";
  column.appendChild(error);

  group.appendChild(column);
  parent.appendChild(group);

  return { input, error };
}

/**
 * What a refused save looks like: the field marked, and the reason under it.
 *
 * Both halves are Bootstrap's own: `is-invalid` on the input and the words in the
 * `.invalid-feedback` beside it. This is also why nothing else is drawn for it — an
 * error line of this plugin's own would be a second way for the same form to say the
 * same thing.
 */
function refuse(error: HTMLElement | null, message: string): void {
  const input = error?.parentNode?.children[0] as HTMLElement | undefined;
  if (!error || !input) return;

  input.classList.add("is-invalid");
  error.textContent = message;
}

/**
 * Save: one of the four edits, and a write.
 *
 * A new chapter is one of them; an edit is up to two — a title and a start are
 * different things and either may be what changed — applied one after the other to
 * the same list. What each of them refuses comes back as null, and a refusal is
 * shown in the form rather than written: "already a chapter there" is something the
 * reader can fix, and a field written with the value it already had is noise.
 */
function submitForm(title: string, index: number): void {
  const gallery = inHand;
  const current = form;
  if (!gallery || !current) return;

  if (!Number.isInteger(index) || index < 1 || index > gallery.pages.length) {
    formError = "mangaReader.chapterIndexRange";
    redraw();
    return;
  }

  const order = gallery.pages.map((page) => page.id);
  const pageId = gallery.pages[index - 1].id;

  if (current.startPageId === null) {
    const next = addChapterAt(gallery.stored, order, pageId, title);
    if (!next) {
      formError = "mangaReader.chapterStartTaken";
      redraw();
      return;
    }

    applyEdit(gallery, next);
    return;
  }

  let next: MangaReaderChapter[] | null = gallery.stored;
  if (title !== current.initialTitle) {
    next = renameChapterAt(next, order, current.startPageId, title);
  }
  if (next && index !== Number(current.initialIndex)) {
    next = moveChapterStart(next, order, current.startPageId, pageId);
  }

  if (!next) {
    formError = "mangaReader.chapterNoSuch";
    redraw();
    return;
  }

  if (next === gallery.stored) {
    // Nothing changed after all — the buttons say otherwise, but a form that wrote
    // the value it already had would be a write nobody asked for.
    closeForm();
    return;
  }

  applyEdit(gallery, next);
}

/** Delete, which takes the chapter away and leaves its pages owned by nobody */
function deleteChapter(): void {
  const gallery = inHand;
  const current = form;
  if (!gallery || !current?.startPageId) return;

  const next = removeChapterAt(
    gallery.stored,
    gallery.pages.map((page) => page.id),
    current.startPageId
  );

  if (!next) {
    formError = "mangaReader.chapterNoSuch";
    redraw();
    return;
  }

  applyEdit(gallery, next);
}

/**
 * Writes one change and closes the form.
 *
 * What comes back of it is not this function's business: the write announces itself,
 * and the announcement is what asks the server for the list again — for this surface
 * and for any other that was drawing the same gallery. So the tab does not patch its
 * own copy here. It did, while the only write was its own import; a list that two
 * surfaces can change is a list worth reading back.
 */
function applyEdit(gallery: ChaptersInHand, next: MangaReaderChapter[]): void {
  busy = true;
  redraw();

  writeChapters(gallery.id, next).then(
    () => {
      busy = false;
      closeForm();
    },
    (e: unknown) => {
      busy = false;
      console.error(
        "[mangaReader] could not write this gallery's chapters:",
        e
      );
      redraw();
    }
  );
}

/** Closes the form without writing anything */
function closeForm(): void {
  form = null;
  formError = "";
  redraw();
}

/** Puts the import control away while the form is on top of the list */
function hideImport(): void {
  control?.remove();
}

/**
 * A change to a gallery's chapters was written — by this tab, or by the reading half.
 *
 * The copy in hand came from the server, and a surface that keeps a copy of
 * something two surfaces can change has to ask again rather than patch it: what was
 * written may not be what this half would have written. Forgetting it is enough —
 * `findPanel` finds the panel on the next pass, because Stash's own button stays
 * visible, and the fetch is what the tab does when it has nothing in hand.
 */
watchChapters((galleryId, chapters) => {
  if (inHand?.id !== galleryId) return;

  // Drawn from what was written rather than fetched back: the news carries the list,
  // and a copy that is *known* is a copy nothing can go stale waiting for. What the
  // tab's import used to do — patch its own copy and hope — is now the same one line
  // for every write, whoever made it.
  inHand.stored = chapters;
  inHand.chapters = placeChapters(chapters, inHand.pages);
  inHand.own = true;
  renderedFor = "";
  redraw();
});

/** One chapter, drawn the way Stash draws one — its jump link and its Edit link */
function row(
  gallery: ChaptersInHand,
  chapter: MangaReaderPlacedChapter
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

  // Stash's own row has this, pushed right by `ml-auto`, and it is what a reader
  // already reaches for. It is the second child of the line on purpose: the jump
  // link stays the first, which is what everything that reads a row expects.
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-link ml-auto " + CLASS_EDIT;
  edit.textContent = stringFor(gallery.locale, "mangaReader.editChapter");
  edit.addEventListener("click", () => openForm(chapter));
  line.appendChild(edit);

  wrap.appendChild(line);

  return wrap;
}

/**
 * The form, opened on a chapter or on nothing.
 *
 * Stash's own form opens with the index at 1 whatever the reader was looking at.
 * This one opens on the page they are on, when they are on one of this gallery's
 * pages in the lightbox — the same two fields and the same three buttons, with the
 * one default that somebody reading a book can actually mean.
 */
function openForm(chapter: MangaReaderPlacedChapter | null): void {
  const gallery = inHand;
  if (!gallery) return;

  form = {
    startPageId: chapter ? (gallery.pages[chapter.at]?.id ?? null) : null,
    initialTitle: chapter?.title ?? "",
    // Both are one-based already: a chapter's index is where it begins counted from
    // one, and the reading page comes back that way too.
    initialIndex: chapter
      ? String(chapter.at + 1)
      : String(indexOfReadingPage(gallery)),
  };
  formError = "";
  redraw();
}

/** Where the reader is in this gallery, one-based, or 1 when they are not in it */
function indexOfReadingPage(gallery: ChaptersInHand): number {
  // Asked of the reading half rather than read from the page: the lightbox's own
  // counter is Stash's, and counts in whatever order the lightbox was opened with.
  const id = NR.readingPageIdNow?.(gallery.id);
  if (!id) return 1;

  const at = gallery.pages.findIndex((page) => page.id === id);
  return at < 0 ? 1 : at + 1;
}

/** Forgets the gallery in hand, for when the page it belonged to is gone */
export function forgetChaptersTab(): void {
  inHand = null;
  renderedFor = "";
  panelInHand = null;
  control = null;
  controlState = null;
  controlFor = null;
  confirming = false;
  form = null;
  formError = "";
}
