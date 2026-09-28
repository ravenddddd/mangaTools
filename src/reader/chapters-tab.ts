/**
 * The gallery page's Chapters tab, rendered from this plugin's chapters.
 *
 * Stash's own tab lists its own rows — a title and an `image_index`, a position in
 * path order — and its Create and Edit buttons write them. This plugin lists *its*
 * chapters there instead, and in time will edit those: the plugin's field is the
 * one that can say which images a chapter holds, and it is the one the reader hands
 * to the lightbox. **Stash's rows are never written**, here or anywhere else: they
 * are read for as long as they are the only thing that knows where a chapter is,
 * and after that they are left exactly as they are.
 *
 * A DOM takeover, because there is nothing else to patch: Stash's panel and its
 * chapter entries are plain exports with no `PatchComponent` wrapper, so the way in
 * is the markup — the tab's own container, found by the button that sits before it,
 * emptied and filled with this plugin's rows.
 *
 * The rows are Stash's shape, deliberately: the same `btn btn-link` in a `.row`
 * after an `<hr>`, so the tab looks like itself. What is missing is the Edit button,
 * which belongs to Stash's rows and not to this plugin's — editing comes later, and
 * it will write the plugin's field.
 *
 * Clicking a row opens the lightbox at that chapter, which is what Stash's own rows
 * do: the same errand, by a different road. Stash's way is a function this plugin
 * cannot call, so the lightbox is opened through the bridge — with this plugin's
 * images and chapters, at the index the chapter begins at. Which also means the
 * lightbox a chapter opens is the one the reader will be drawing in.
 */
import { NS } from "../tools/fields";
import { bridged, takeOver } from "./bridge";
import {
  type MangaReaderPlacedChapter,
  chaptersFromStash,
  parseChapters,
  placeChapters,
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

/** What was rendered, so a pass over the document only rebuilds when it differs */
let renderedFor = "";
/** The gallery whose chapters are in hand, and what they are */
let inHand: {
  id: string;
  images: LightboxImage[];
  chapters: MangaReaderPlacedChapter[];
} | null = null;

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

        const chapters = placeChapters(chaptersOf(answer), answer.pages);
        inHand = { id, images: answer.images, chapters };
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
}): { title: string; images: string[] }[] {
  const own = parseChapters(
    NS.pickField(answer.customFields, NS.CHAPTER_FIELD_NAME) || null
  );
  if (own) return own;

  return chaptersFromStash(
    answer.stashChapters,
    answer.pages.map((page) => page.id)
  );
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
  }
): void {
  const key = [
    gallery.id,
    ...gallery.chapters.map((c) => c.title + "@" + c.at),
  ].join("|");
  if (key === renderedFor && panel.childElementCount > 0) return;
  renderedFor = key;

  // Stash's own button goes, rather than being disabled: this plugin is what edits
  // chapters now, and its editing is not here yet.
  const button = panel.previousElementSibling;
  if (button) button.setAttribute(HIDDEN, "");

  panel.textContent = "";
  for (const chapter of gallery.chapters) {
    panel.appendChild(row(gallery, chapter));
  }
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
}
