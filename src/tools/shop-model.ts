/**
 * The shop list as data: its shape, the presets it starts as, and the rules that
 * read it.
 *
 * Split from `shops.tsx` for one reason — **this half knows nothing about the
 * plugin.** `core.ts` parses the settings before any UI module has loaded, and a
 * model that imported `assetBase` from `core.ts` would be a cycle: core would ask
 * this module for a default while this module was still waiting for core. Here
 * there is no import at all, so the settings reader can use it directly and the
 * React side (icons, badges, matching against `NS.shops`) stays in shops.tsx.
 *
 * **A shop has no id.** Its name is what it is called and how it is told apart:
 * two entries may not share a name, nor a domain, and that pair of rules is all
 * the identity the list needs. The editor's greyed-out built-ins ask the same two
 * questions (`nameTaken`, `domainOwner`), so "already added" is a consequence of
 * the rules rather than a third kind of state.
 */

/** One shop, as the settings store it. */
export interface Shop {
  /** The shop's own name — its identity in the list, and the badge's hover text. */
  name: string;
  /**
   * How to draw it, as one string:
   *   - `builtin:<key>` — one of the icons shipped in `assets/shops/`;
   *   - `data:image/…` — an image the user uploaded, kept in the settings as a
   *     data URI (the plugin has no files of its own it can write);
   *   - `""` — no icon: the badge shows the code alone.
   */
  icon: string;
  /**
   * Registered domains a link has to be on, or under. At least one; no domain may
   * appear under two shops in the list.
   */
  domains: string[];
  /**
   * Product-code patterns, tried top to bottom; capture group 1 is the code. May be
   * empty — a shop that is recognised but whose links carry no code.
   */
  regexes: string[];
}

/** One of the icons the plugin ships with, for `icon`: "builtin:<key>". */
export const BUILTIN_ICONS = ["dlsite", "fanza", "toranoana", "melonbooks"];

/**
 * The presets the list starts as, and that "add a built-in shop" copies back.
 *
 * A preset with an edited name or domains no longer matches its built-in — that is
 * the point: identity is the content, so renaming DLsite to something else frees
 * the DLsite preset to be added again, and a rename that keeps the domain does not
 * (the domain is still taken).
 */
export const BUILTIN_SHOPS: Shop[] = [
  {
    name: "DLsite",
    icon: "builtin:dlsite",
    domains: ["dlsite.com"],
    // /books/work/=/product_id/BJ03044888.html, and the older product_id=RJ…
    regexes: ["product_id[=/]([A-Za-z]{2}\\d+)"],
  },
  {
    name: "FANZA",
    icon: "builtin:fanza",
    // The doujin pages live on dmm.co.jp, not on a fanza host.
    domains: ["dmm.co.jp"],
    // /dc/doujin/-/detail/=/cid=d_790745/ — and the book shape,
    // /product/6300672/b915awnmg04612/
    regexes: ["[?&/]cid=([A-Za-z0-9_]+)", "/product/\\d+/([A-Za-z0-9]+)"],
  },
  {
    name: "虎穴",
    icon: "builtin:toranoana",
    domains: ["toranoana.jp"],
    // /tora_r/ec/item/040030474993/
    regexes: ["/ec/item/(\\d+)"],
  },
  {
    name: "Melonbooks",
    icon: "builtin:melonbooks",
    domains: ["melonbooks.co.jp"],
    // /detail/detail.php?product_id=2500562
    regexes: ["[?&]product_id=(\\d+)"],
  },
];

/** A fresh copy of the presets — the list may be edited, the presets may not. */
export function builtinShops(): Shop[] {
  return BUILTIN_SHOPS.map((shop) => ({
    name: shop.name,
    icon: shop.icon,
    domains: shop.domains.slice(),
    regexes: shop.regexes.slice(),
  }));
}

/**
 * A domain as this module compares them: lower case, no scheme, no path, no
 * port, no user, no `www.`, no trailing dot.
 *
 * Every spelling of the same host has to collapse to one string, or the editor's
 * duplicate check would let `DLsite.com` and `dlsite.com` both in and the matcher
 * would then have to pick one. `www.` goes because `www.dlsite.com` and
 * `dlsite.com` are the same shop to anyone typing them — the matcher would accept
 * both spellings anyway (`*.<domain>`), and only the duplicate check would be
 * fooled.
 */
export function normalizeDomain(raw: string): string {
  let host = String(raw || "")
    .trim()
    .toLowerCase();
  const scheme = host.indexOf("://");
  if (scheme !== -1) host = host.slice(scheme + 3);
  const at = host.indexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  const slash = host.indexOf("/");
  if (slash !== -1) host = host.slice(0, slash);
  const colon = host.indexOf(":");
  if (colon !== -1) host = host.slice(0, colon);
  host = host.replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * A pattern as a regular expression, or null when it does not compile.
 *
 * Both spellings are accepted: a bare source (`product_id[=/](…)`, which is what
 * the built-ins are written as) and the JavaScript literal a reader may copy from
 * a console (`/product_id[=/](…)/`). The `g` and `y` flags are dropped — `exec`
 * on a pattern that carries either remembers where it stopped, so the same pattern
 * would find one code and then miss the next link.
 */
export function compilePattern(source: string): RegExp | null {
  const text = String(source || "").trim();
  if (!text) return null;

  const literal = /^\/([\s\S]*)\/([a-z]*)$/.exec(text);
  try {
    return literal
      ? new RegExp(literal[1], literal[2].replace(/[gy]/g, ""))
      : new RegExp(text);
  } catch {
    return null;
  }
}

/** Every pattern of one shop that compiles, in the order entered */
export function patternsOf(shop: Shop): RegExp[] {
  const out: RegExp[] = [];
  for (const source of shop.regexes) {
    const pattern = compilePattern(source);
    if (pattern) out.push(pattern);
  }
  return out;
}

/** The product code in a link, or "" when no pattern captures one. */
export function codeOf(patterns: RegExp[], raw: string): string {
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match?.[1]) return match[1];
  }
  return "";
}

/**
 * The unit of the settings value: one JSON string, parsed leniently.
 *
 * Absent, unreadable or the wrong shape reads as the four built-ins — the same
 * reading every other setting gives a value this build does not know. An **empty
 * list** is a value, not an absence: a user who removed every shop gets none back.
 * Entries that cannot be used (no name, no usable domain) are dropped rather than
 * carried, because the rest of the module assumes every entry can be matched.
 */
export function shopsFromJson(raw: unknown): Shop[] {
  if (typeof raw !== "string" || raw.trim() === "") return builtinShops();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return builtinShops();
  }
  if (!Array.isArray(parsed)) return builtinShops();

  const shops: Shop[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { [key: string]: unknown };
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const domains = (Array.isArray(record.domains) ? record.domains : [])
      .map((domain) => normalizeDomain(String(domain || "")))
      .filter((domain) => domain !== "");
    if (!name || domains.length === 0) continue;

    shops.push({
      name,
      icon: typeof record.icon === "string" ? record.icon : "",
      domains,
      regexes: (Array.isArray(record.regexes) ? record.regexes : [])
        .map((source) => String(source || "").trim())
        .filter((source) => source !== ""),
    });
  }
  return shops;
}

/** The settings value, from the list in force. */
export function shopsToJson(shops: Shop[]): string {
  return JSON.stringify(
    shops.map((shop) => ({
      name: shop.name,
      icon: shop.icon,
      domains: shop.domains,
      regexes: shop.regexes,
    }))
  );
}

/**
 * Whether a name is already used, ignoring case and surrounding space.
 *
 * `except` is the index doing the asking — the row being edited is not a duplicate
 * of itself. Pass -1 when asking about a shop that is not in the list yet.
 */
export function nameTaken(
  shops: Shop[],
  name: string,
  except: number
): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  return shops.some(
    (shop, index) =>
      index !== except && shop.name.trim().toLowerCase() === wanted
  );
}

/** The shop already using a domain, ignoring case and `www.`, or null. */
export function domainOwner(
  shops: Shop[],
  domain: string,
  except: number
): Shop | null {
  const wanted = normalizeDomain(domain);
  if (!wanted) return null;

  for (let index = 0; index < shops.length; index++) {
    if (index === except) continue;
    if (shops[index].domains.indexOf(wanted) !== -1) return shops[index];
  }
  return null;
}
