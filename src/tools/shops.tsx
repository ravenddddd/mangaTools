/**
 * The shops a gallery's links can point at, matched against the configured list.
 *
 * A gallery's links live in **Stash's own `urls`** — plain strings, no label —
 * and this module derives everything from them: which shop a link belongs to, the
 * product code inside it, and the icon. Nothing is stored and nothing is written:
 * change the link and the badge follows (at the next store refresh), with no
 * second copy to migrate.
 *
 * The list itself is data — its shape and rules are in shop-model.ts, and the
 * settings page edits it. This module is the half that knows the running plugin:
 * where a built-in icon is served from, and the list currently in force
 * (`NS.shops`, which `refreshSettings` keeps fresh).
 *
 * **Recognition is by registered domain**, not by matching the whole URL: a
 * `book.dmm.co.jp` link is FANZA, and a shop may move its pages around without
 * changing its host. The code is then read by the shop's own patterns, tried in
 * the order entered — the first one that captures wins. A link on the right host
 * whose shape no pattern knows keeps its icon and shows no code; guessing a code
 * would be worse than showing none.
 */
import { assetBase } from "./core";
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import {
  BUILTIN_ICONS,
  BUILTIN_SHOPS,
  builtinShops,
  codeOf,
  compilePattern,
  domainOwner,
  isValidDomain,
  nameTaken,
  normalizeDomain,
  patternsOf,
  type Shop,
  shopsFromJson,
  shopsToJson,
} from "./shop-model";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

export type { Shop };
export {
  BUILTIN_ICONS,
  BUILTIN_SHOPS,
  builtinShops,
  compilePattern,
  domainOwner,
  isValidDomain,
  nameTaken,
  normalizeDomain,
  shopsFromJson,
  shopsToJson,
};

/** One recognised link: the shop, the code ("" when unparsed), and the URL. */
export interface ShopLink {
  shop: Shop;
  code: string;
  url: string;
}

/** The shop a link belongs to, and its code, or null for any other link. */
export function shopOf(raw: string): ShopLink | null {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // A trailing dot is the dotted-FQDN spelling of the same host, and WHATWG's
  // URL keeps it: `www.dlsite.com.` is the same site to a browser. Left on, it
  // fails both the equality and the `.dlsite.com` test below.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  for (const shop of NS.shops) {
    const matched = shop.domains.some(
      (domain) => host === domain || host.endsWith("." + domain)
    );
    if (!matched) continue;

    return {
      shop,
      code: codeOf(patternsOf(shop), String(raw)),
      url: String(raw),
    };
  }
  return null;
}

/** The recognised links among a gallery's `urls`, in their own order. */
export function shopsIn(urls: string[]): ShopLink[] {
  const out: ShopLink[] = [];
  const seen = new Set<string>();

  urls.forEach((raw) => {
    const found = shopOf(raw);
    if (!found || seen.has(found.url)) return;
    seen.add(found.url);
    out.push(found);
  });

  return out;
}

/**
 * Where a shop's icon is served from.
 *
 * `assetBase` is the plugin's own asset root, known once the half has started;
 * before that a built-in icon is "" and callers draw no image rather than a broken
 * one. An uploaded icon is a data URI and needs no base at all — the plugin has no
 * files of its own it can write, so an image the user picks is kept in the
 * settings as one.
 */
export function shopIconUrl(shop: Shop): string {
  const icon = shop.icon || "";
  if (icon.startsWith("data:image/")) return icon;

  const prefix = "builtin:";
  if (!icon.startsWith(prefix)) return "";
  const key = icon.slice(prefix.length);
  if (BUILTIN_ICONS.indexOf(key) === -1) return "";
  if (!assetBase) return "";
  return assetBase + "assets/shops/favicon-" + key + ".ico";
}

/**
 * A stand-in icon for a shop that has none: its first character, on a colour
 * derived from its name.
 *
 * The colour is the name's hash rather than a stored value, so the same shop is
 * the same block everywhere it is drawn — badges, link heads, the editor — and
 * on every browser, with nothing to keep in step. 45% saturation keeps every hue
 * readable under white type; 38% lightness keeps it dark enough for Stash's dark
 * theme.
 */
export interface ShopLetter {
  letter: string;
  color: string;
}

export function shopLetter(shop: Shop): ShopLetter | null {
  if (shopIconUrl(shop)) return null;

  const name = shop.name.trim();
  if (!name) return null;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }

  return {
    letter: Array.from(name)[0].toUpperCase(),
    color: "hsl(" + (hash % 360) + ", 45%, 38%)",
  };
}

/**
 * The badges in the manga info block: icon and code, each one a link.
 *
 * No shop name: the icon says which shop, and the code is what a reader actually
 * needs to find the work there. The name lives in the `title`.
 */
export function ShopBadges(props: { links: ShopLink[] }) {
  return (
    <span className="manga-tools-shop-badges">
      {props.links.map((link) => {
        const src = shopIconUrl(link.shop);
        const letter = src ? null : shopLetter(link.shop);
        const title = link.shop.name + (link.code ? " · " + link.code : "");

        return (
          <a
            key={link.url}
            className="manga-tools-shop-badge"
            href={link.url}
            title={title}
            target="_blank"
            rel="noreferrer"
          >
            {src ? (
              <img className="is-favicon" src={src} alt={link.shop.name} />
            ) : letter ? (
              <span
                className="manga-tools-shop-letter"
                aria-hidden="true"
                style={{ backgroundColor: letter.color }}
              >
                {letter.letter}
              </span>
            ) : null}
            {link.code ? (
              <span className="manga-tools-shop-code">{link.code}</span>
            ) : null}
          </a>
        );
      })}
    </span>
  );
}

// Published for the smoke test, which reaches them through the window — see the
// note on the namespace in plugin-api.ts.
NS.SHOPS = BUILTIN_SHOPS;
NS.shopOf = shopOf;
NS.shopsIn = shopsIn;
NS.shopsFromJson = shopsFromJson;
NS.shopsToJson = shopsToJson;
NS.builtinShops = builtinShops;
NS.normalizeDomain = normalizeDomain;
NS.isValidDomain = isValidDomain;
NS.compilePattern = compilePattern;
NS.nameTaken = nameTaken;
NS.domainOwner = domainOwner;
NS.shopLetter = shopLetter;
