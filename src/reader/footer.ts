/**
 * The footer's name for the image, and its link to it.
 *
 * Stash's footer is its own render of *its* place in the lightbox: the image's name,
 * a link to the image, a link back to the gallery. This half does not move that
 * place — a turn is the reader's own arithmetic, and Stash's carousel is left where
 * the reader opened it, hidden, still holding the index it mounted with. So the
 * footer named the image the reader opened on, for as long as the lightbox stayed
 * open: correct on the first page and never again.
 *
 * The gallery link needs nothing. There is one gallery behind all of this, the reader
 * never leaves it, and Stash renders that link from the gallery the image belongs to
 * rather than from the page in front of the reader. What is corrected is the image
 * link, which names a page: its text, and where it points.
 *
 * Corrected in place rather than drawn again. Stash's own markup is what makes the
 * footer look like a footer, and a node this plugin inserted into a tree React owns
 * is a node React is free to remove again. Both writes are guarded by a comparison,
 * because this runs on every pass over the document.
 *
 * One thing cannot be fixed in place: a router link navigates by the destination it
 * was *rendered* with, not by the href in the document, so a corrected href would
 * still take the reader to the image they opened on. The click is stopped before the
 * router hears it and the browser follows the href instead — a page load where
 * Stash's own link is a router navigation, which is the one difference a plugin
 * cannot help having: it has no router of its own to ask.
 */
import type { LightboxImage } from "./stash-lightbox";

/** Marks Stash's own image link as one this plugin has claimed */
const CLAIMED = "data-manga-reader-link";

/**
 * Keeps the footer's image link on the image the reader is looking at.
 *
 * Called with the image at the front of the screen on show, which is the page the
 * lightbox's own counter would be counting if it were counting this half's position.
 * A screen with no image at all — a lightbox this plugin cannot read — leaves the
 * footer exactly as Stash drew it.
 */
export function syncFooter(
  lightbox: Element,
  image: LightboxImage | null
): void {
  const link = lightbox.querySelector(".Lightbox-footer-center .image-link");
  if (!link || !image) return;

  const name = titleOf(image);
  if (link.textContent !== name) link.textContent = name;

  const href = "/images/" + image.id;
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);

  if (link.getAttribute(CLAIMED) === null) {
    link.setAttribute(CLAIMED, "");
    // In the capture phase, so the router's own handler — which listens on the root
    // of Stash's React tree, on the way back up — never sees the click. Nothing is
    // prevented: the browser following the href is exactly what should happen.
    link.addEventListener("click", (event) => event.stopPropagation(), true);
  }
}

/**
 * What Stash's own footer would call this image: its title, or the file's name.
 *
 * Stash's `imageTitle`, which a plugin cannot call and does not have to — a title if
 * there is one, the last part of the path if there is not, and nothing when the API
 * never said either. The same rule, so the footer names a page the way it always did.
 */
function titleOf(image: LightboxImage): string {
  if (image.title) return image.title;

  const path = image.paths?.image || image.visual_files?.[0]?.path || "";
  return path.split("/").pop() || "";
}
