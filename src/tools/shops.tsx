/**
 * The four shops a gallery's links can point at.
 *
 * A gallery's links live in **Stash's own `urls`** — plain strings, no label —
 * and this module derives everything from them: which shop a link belongs to, the
 * product code inside it, and the icon. Nothing is stored and nothing is written:
 * change the link and the badge follows (at the next store refresh), with no
 * second copy to migrate.
 *
 * The four are a fixed, deliberate set (see the design notes in the README):
 * the long tail of stores is left to Stash's own link list.
 *
 * **Recognition is by registered domain**, not by matching the whole URL: a
 * `book.dmm.co.jp` link is FANZA, and a shop may move its pages around without
 * changing its host. The code is then read by each shop's own URL shape. A link
 * on the right host with a shape this module does not know keeps its icon and
 * shows no code — guessing a code would be worse than showing none.
 */
import { assetBase } from "./core";
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

export type ShopKey = "dlsite" | "fanza" | "toranoana" | "melonbooks";

export interface Shop {
  key: ShopKey;
  /** The shop's own name, for a tooltip. The badge itself shows the code only. */
  name: string;
  /** The registered domain a link has to be on, or under. */
  domain: string;
  /** The product code in a link, or "" when the shape is not one this knows. */
  code(raw: string): string;
}

/**
 * The first pattern that names a code wins; none means no code.
 *
 * More than one because a shop does not keep one URL shape forever — FANZA alone
 * has the doujin `cid=` page and the book `product/<id>/<code>/` page — and a
 * shape learned later is one entry here rather than a new branch.
 */
const codeIn =
  (...patterns: RegExp[]) =>
  (raw: string): string => {
    for (const pattern of patterns) {
      const code = pattern.exec(raw)?.[1];
      if (code) return code;
    }
    return "";
  };

export const SHOPS: Shop[] = [
  {
    key: "dlsite",
    name: "DLsite",
    domain: "dlsite.com",
    // /books/work/=/product_id/BJ03044888.html, and the older product_id=RJ…
    code: codeIn(/product_id[=/]([A-Za-z]{2}\d+)/),
  },
  {
    key: "fanza",
    name: "FANZA",
    // The doujin pages live on dmm.co.jp, not on a fanza host.
    domain: "dmm.co.jp",
    // /dc/doujin/-/detail/=/cid=d_790745/ — and the book shape,
    // /product/6300672/b915awnmg04612/
    code: codeIn(/[?&/]cid=([A-Za-z0-9_]+)/, /\/product\/\d+\/([A-Za-z0-9]+)/),
  },
  {
    key: "toranoana",
    name: "虎穴",
    domain: "toranoana.jp",
    // /tora_r/ec/item/040030474993/
    code: codeIn(/\/ec\/item\/(\d+)/),
  },
  {
    key: "melonbooks",
    name: "Melonbooks",
    domain: "melonbooks.co.jp",
    // /detail/detail.php?product_id=2500562
    code: codeIn(/[?&]product_id=(\d+)/),
  },
];

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
  const shop = SHOPS.find(
    (candidate) =>
      host === candidate.domain || host.endsWith("." + candidate.domain)
  );
  if (!shop) return null;

  return { shop, code: shop.code(String(raw)), url: String(raw) };
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
 * Where a shop's favicon is served from.
 *
 * `assetBase` is the plugin's own asset root, known once the half has started;
 * before that this is "" and callers draw no image rather than a broken one.
 * **One icon per shop**, used both at the head of the edit form's link row and in
 * the manga-info badges: a square favicon is the shape both places can take, and
 * the wordmarks the earlier design also shipped were dropped — two icon families
 * for one shop is a choice nobody needs to make.
 */
export function shopIconUrl(shop: Shop): string {
  if (!assetBase) return "";
  return assetBase + "assets/shops/favicon-" + shop.key + ".ico";
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
NS.SHOPS = SHOPS;
NS.shopOf = shopOf;
NS.shopsIn = shopsIn;
