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
    src: shopIconUrl(found.shop, "favicon"),
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
      if (current.getAttribute("data-shop") === want.key) continue;
      const img = current.querySelector("img") as HTMLImageElement | null;
      if (img && img.getAttribute("src") !== want.src) img.src = want.src;
      if (img && img.alt !== want.title) img.alt = want.title;
      current.setAttribute("data-shop", want.key);
      const text = current.querySelector(".input-group-text");
      if (text && text.getAttribute("title") !== want.title) {
        text.setAttribute("title", want.title);
      }
      continue;
    }

    const prepend = document.createElement("div");
    prepend.className = "input-group-prepend " + PREFIX;
    prepend.setAttribute("data-shop", want.key);

    const text = document.createElement("span");
    text.className = "input-group-text";
    text.setAttribute("title", want.title);

    const img = document.createElement("img");
    img.src = want.src;
    img.alt = want.title;
    text.appendChild(img);
    prepend.appendChild(text);
    group.insertBefore(prepend, group.children[0] || null);
  }
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

    const observer =
      typeof MutationObserver === "function" ? new MutationObserver(run) : null;
    observer?.observe(form, { childList: true, subtree: true });
    form.addEventListener("input", run, true);

    return () => {
      observer?.disconnect();
      form.removeEventListener("input", run, true);
      // The form is going away with us; taking our heads out keeps a form that
      // somehow outlives the block from carrying stale icons.
      const heads = form.querySelectorAll("." + PREFIX);
      for (let i = 0; i < heads.length; i++) heads[i].remove();
    };
  }, []);

  return <span ref={ref} hidden />;
}

// Published for the smoke test, which drives it against the DOM stub.
NS.decorateShopUrls = decorateShopUrls;
