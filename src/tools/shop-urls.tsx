/**
 * The shop icon at the head of a link row in Stash's edit form.
 *
 * The URL field is Stash's own and is **not a patchable component** (URLField /
 * StringListInput carry no PatchComponent), so this is DOM work: a hidden node
 * mounted inside the form, from which the effect finds the form and decorates
 * its `.input-group` rows. Rows are identified by Stash's scrape button — the
 * one thing a URL row has that a plain text row does not.
 *
 * Two events matter and they are different:
 *   - rows are added and removed by React (the add-link button), which is a DOM
 *     mutation — hence the observer;
 *   - the input's *value* changes without a mutation (React writes the property),
 *     hence the capture `input` listener.
 *
 * Every write is guarded by a comparison, the same discipline as every other DOM
 * pass in this plugin: an insertion that the observer sees must not insert again,
 * or the two answer each other forever. Removing is guarded too.
 *
 * The head is **always the favicon** (a 38px square slot); the icon-style setting
 * is about the badges in the manga info block, where a wordmark fits.
 */
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import { shopOf, shopIconUrl } from "./shops";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding — and the hooks below use
// it explicitly, so the linter can see it too.
const React = PluginApi.React;

const PREFIX = "manga-tools-shop-prefix";

/** The prefix that is this group's own direct child, if there is one. */
function ownPrefix(group: HTMLElement): HTMLElement | null {
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i] as HTMLElement;
    if (child.classList?.contains(PREFIX)) return child;
  }
  return null;
}

/** The head, as it should be for one row, or null when there should be none. */
function headFor(input: HTMLInputElement): {
  key: string;
  src: string;
  title: string;
} | null {
  const found = shopOf(input.value || "");
  if (!found) return null;

  return {
    key: found.shop.key,
    src: shopIconUrl(found.shop),
    title: found.shop.name + (found.code ? " · " + found.code : ""),
  };
}

/**
 * Decorates every recognised URL row in a form. Idempotent: with the right head
 * already in place it writes nothing.
 *
 * Exported for the smoke test, which can drive it against the DOM stub.
 */
export function decorateShopUrls(form: Element): void {
  if (!NS.shopLinks) return;

  const groups = form.querySelectorAll(".input-group");
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i] as HTMLElement;
    if (!group.querySelector(".scrape-url-button")) continue;

    const input = group.querySelector("input") as HTMLInputElement | null;
    if (!input) continue;

    const want = headFor(input);
    const current = ownPrefix(group);

    if (!want) {
      if (current) current.remove();
      continue;
    }

    if (current) {
      // **The whole head's state is compared, not the shop alone.** The title
      // carries the product code, so a link changed to another product of the
      // same shop changes nothing in `data-shop` and everything the reader sees
      // on hover. The early `continue` this replaced left that code stale.
      current.setAttribute("data-shop", want.key);
      const text = current.querySelector(".input-group-text");
      if (text && text.getAttribute("title") !== want.title) {
        text.setAttribute("title", want.title);
      }

      let img = current.querySelector("img") as HTMLImageElement | null;
      if (want.src) {
        if (!img) {
          img = iconFor(want.src, want.title);
          text?.appendChild(img);
        } else {
          if (img.getAttribute("src") !== want.src) img.src = want.src;
          if (img.alt !== want.title) img.alt = want.title;
        }
      } else if (img) {
        // The asset base is unknown: `shopIconUrl`'s contract is no image rather
        // than a broken one, and `src=""` resolves to the document itself.
        img.remove();
      }
      continue;
    }

    const prepend = document.createElement("div");
    prepend.className = "input-group-prepend " + PREFIX;
    prepend.setAttribute("data-shop", want.key);

    const text = document.createElement("span");
    text.className = "input-group-text";
    text.setAttribute("title", want.title);
    // Only when there is somewhere to point it: an empty `src` is an image
    // pointing at the page, which is a broken icon rather than no icon.
    if (want.src) text.appendChild(iconFor(want.src, want.title));
    prepend.appendChild(text);
    group.insertBefore(prepend, group.children[0] || null);
  }
}

/** The head's icon, with the shop and code as its alternative text */
function iconFor(src: string, title: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = title;
  return img;
}

/**
 * Watches a form for the three ways its link rows can change, and calls `run`.
 *
 * - rows added or removed: React, a child-list mutation — the observer;
 * - the input's value rewritten in place: React writes the property, which
 *   dispatches no native event — the capture `input` (and `change`, for a
 *   rewrite that lands on blur);
 * - **a drag-reorder**: Stash's `StringListInput` keys its rows by index, so a
 *   dragged row swaps its input's value with its neighbour's, in place. That is
 *   neither a child-list mutation nor an `input` event — `dragend`/`drop` are
 *   what bring the decorator back. Without them both rows keep the head of the
 *   URL that used to be there.
 *
 * Published for the test; `ShopUrlHeads` is the only production caller.
 */
export function watchShopUrls(form: Element, run: () => void): () => void {
  const observer =
    typeof MutationObserver === "function" ? new MutationObserver(run) : null;
  observer?.observe(form, { childList: true, subtree: true });

  const events = ["input", "change", "drop", "dragend"];
  for (const name of events) form.addEventListener(name, run, true);

  return () => {
    observer?.disconnect();
    for (const name of events) form.removeEventListener(name, run, true);
  };
}

/**
 * Mounts the decorator for the form it is rendered into.
 *
 * Rendered inside Stash's edit form (from the CustomFieldsInput patch), whatever
 * the four fields are set to: the shop setting is its own feature.
 */
export function ShopUrlHeads() {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    if (!NS.shopLinks || !ref.current) return;
    const form = ref.current.closest("form");
    if (!form) return;

    const run = () => decorateShopUrls(form);
    run();

    const stop = watchShopUrls(form, run);

    return () => {
      stop();
      // The form is going away with us; taking our heads out keeps a form that
      // somehow outlives the block from carrying stale icons.
      const heads = form.querySelectorAll("." + PREFIX);
      for (let i = 0; i < heads.length; i++) heads[i].remove();
    };
  }, []);

  return <span ref={ref} hidden />;
}

// Published for the smoke test, which drives them against the DOM stub.
NS.decorateShopUrls = decorateShopUrls;
NS.watchShopUrls = watchShopUrls;
