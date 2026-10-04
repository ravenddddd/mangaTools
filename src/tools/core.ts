/**
 * The tools half's own state — the spine the surfaces hang off.
 *
 * What lives here is everything the rest of the half *reads* rather than draws:
 * the gallery store and the poll behind it, the field values lifted out of a
 * custom_fields map, the settings read out of Stash's plugin config, the route
 * the plugin believes it is on, and the subscription every surface redraws off.
 * Nothing here renders a single element.
 *
 * **The rule this module exists to keep**: a surface imports from here, never from
 * another surface. index.tsx holds the patches and draws the rows; the sidebar,
 * the dialog and the details tab are modules of their own; and each of them
 * reaches down to this file instead of sideways into one another, so the
 * dependency has one direction and there is no cycle to be surprised by. That was
 * the reason the split could not start with a screen: every screen already
 * reached into this state, so this had to come out first.
 *
 * The plugin's own facts live here too — the six field names, the plugin id, the
 * poll interval, and the map type the GraphQL answers come back as — because both
 * this file and every surface name them, and one declaration is what keeps two
 * spellings from drifting apart.
 */
import "./fields";
import { NS } from "../languages";
import { gqlDoc, requirePluginApi } from "../plugin-api";
import type {
  MangaToolsApolloClient,
  MangaToolsCustomFields,
} from "../plugin-api";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// The classic JSX transform compiles every element to React.createElement, which
// resolves to this binding — and useGlobalVersion is a hook, so this file needs
// the same binding the .tsx files do.
const React = PluginApi.React;

// ─────────────────────── The plugin's own facts ───────────────────────

export const FIELD_NAME = NS.FIELD_NAME;
export const CENSORSHIP_FIELD_NAME = NS.CENSORSHIP_FIELD_NAME;
export const MANGA_FIELD_NAME = NS.MANGA_FIELD_NAME;
export const TRANSLATION_GROUP_FIELD_NAME = NS.TRANSLATION_GROUP_FIELD_NAME;
export const ORIGINAL_FIELD_NAME = NS.ORIGINAL_FIELD_NAME;
export const CHAPTER_FIELD_NAME = NS.CHAPTER_FIELD_NAME;

export const PLUGIN_ID = "mangaTools";

const REFRESH_MS = 60000;

/** The Gallery custom_fields map as it comes back from GraphQL */
export type CustomFieldsMap = MangaToolsCustomFields;

// ───────────────────────────── State ─────────────────────────────

/**
 * galleryId -> that gallery's custom fields, or null before the first answer.
 *
 * The whole map is kept rather than the values this plugin reads, because the
 * query fetches it whole anyway (a single key cannot be projected out of the
 * GraphQL Map scalar) and because a second field would otherwise mean a second
 * store. What is in here is only ever from a gallery that carries one of the
 * plugin's fields — see refresh().
 *
 * Null and empty are different answers, and telling them apart is the whole
 * reason this is nullable rather than starting as an empty map: a gallery
 * *missing* from a filled store is one the server does not consider manga, while
 * an empty store means the question has not been asked yet. See isMarkedNow. The
 * map is replaced wholesale by a successful fetch, and a refresh that fails
 * leaves the previous one standing — the last answer keeps working, and this only
 * ever goes from null to a map.
 *
 * Which is why the writes read it with `?.`: a click that arrives before the
 * first answer has no map to put the change in, and fabricating one would be
 * answering the question with a guess — an empty map says "nothing is manga",
 * which would take the badge off every other gallery on the page. Such a click
 * still writes to the server and to the edit form; the answer arrives with the
 * refresh that follows it (refreshAfterWrite), and the switch follows then.
 */
export let store: Map<string, CustomFieldsMap> | null = null;

/** Subscribers: re-render when the store or the route changes */
const listeners: Set<() => void> = new Set();

let inFlight: Promise<unknown> | null = null;
export let started = false;
let lastLoggedSize = -1;

/** Whether the `stash:location` listener got registered — see start(), and diag */
export let locationListener = false;

/**
 * The path the plugin was last *told* it is on, by `stash:location`.
 *
 * Nothing decides anything by this any more — see pathNow, which reads the URL. It
 * is kept because it is the other half of a question worth being able to ask: when
 * the plugin acts on the wrong page, the first thing to know is whether the URL and
 * the last announcement agree. MangaTools.diag() reports both.
 */
export let currentPath = window.location.pathname || "";

/**
 * The path to act on: the browser's, which is always the current one.
 *
 * **This is read live rather than taken from the remembered `currentPath`**, and
 * that is the difference between the plugin knowing where it is and merely having
 * been told once. Everything path-gated in this half — the bulk dialog's rows, the
 * edit page's block, every write's gallery id — hangs off this answer. Trusting
 * the remembered value makes all of it depend on one listener having been
 * registered and every event having arrived; reading the URL makes the worst case
 * "the answer is right but nothing redrew", which a route change fixes on its own
 * because a navigation redraws the page anyway.
 *
 * **There is deliberately no fallback to `currentPath`.** One stood here for a day,
 * for an empty pathname that no browser produces — and it was the one way a stale
 * remembered path could still be acted on, which is the thing reading live is meant
 * to end. An answer of "" is not a gallery, which is the safe direction: the plugin
 * does nothing rather than something to the wrong gallery.
 *
 * A Stash whose routes lived after a `#` would answer "/" for the same reason, and
 * would be inert rather than wrong. MangaTools.diag() reports that as a plain
 * disagreement between the URL and the last path Stash announced.
 */
export function pathNow(): string {
  return window.location.pathname || "";
}

export function emit(): void {
  listeners.forEach((fn) => {
    fn();
  });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribes to global state (data or route) and re-renders on change. */
export function useGlobalVersion(): number {
  const state = React.useState(0);
  const version = state[0];
  const setVersion = state[1];

  React.useEffect(
    () =>
      subscribe(() => {
        setVersion((v) => v + 1);
      }),
    []
  );

  return version;
}

/**
 * Only show the language dropdown on gallery edit panels.
 *
 * CustomFieldsInput is shared by the scene, performer, studio, tag and image
 * edit panels. Without this check the language field would show up on every
 * one of them. A gallery detail page is /galleries/{id}, and the bulk edit
 * dialog opens over the gallery list at /galleries.
 */
export function isGalleryContext(): boolean {
  return pathNow().indexOf("/galleries") === 0;
}

/**
 * The gallery id in the current URL, or "" when this is not one gallery's page.
 *
 * The detail page's toolbar belongs to a component that cannot be patched and is
 * handed no id, so the URL is the only place to read it from. isGalleryContext
 * is the same test, one segment coarser: this one needs the id, that one only
 * needs to know the plugin is on a gallery page at all.
 */
export function currentGalleryId(): string {
  const m = /^\/galleries\/(\d+)(?:\/|$)/.exec(pathNow());
  return m ? m[1] : "";
}

// ───────────────────── Reading and writing custom fields ─────────────────────

/**
 * Reads the language value out of custom_fields.
 *
 * Two lines over the generic helper in fields.ts, so that the call sites below
 * say which field they mean rather than repeating its name.
 */
export function pickLanguage(customFields: unknown): string {
  return NS.pickField(customFields, FIELD_NAME);
}

/**
 * The censorship mark a gallery's custom fields carry.
 *
 * Through normalizeCensorship, so anything that is not one of the two known
 * values — including a key this plugin did not write — reads as "not marked"
 * rather than being shown or guessed at.
 */
export function censorshipOf(customFields: unknown): string {
  return NS.normalizeCensorship(
    NS.pickField(customFields, CENSORSHIP_FIELD_NAME)
  );
}

// ───────────────────────────── Fetching ─────────────────────────────

/**
 * The Apollo client this plugin reads and writes through, or null.
 *
 * Stash injects StashService itself, and `getClient` throws until the client
 * exists, so the failure is a real one and every caller wants the same thing
 * from it: a log they can grep, and no request. Consolidating it here keeps that
 * log one line rather than four copies that have to stay identical.
 */
export function stashClient(): MangaToolsApolloClient | null {
  try {
    return PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return null;
  }
}

/**
 * A Gallery's custom_fields is the GraphQL Map scalar, and a single key cannot
 * be projected out of it. So we filter for galleries that have this plugin's
 * field and fetch the whole map, then keep it in memory.
 *
 * **One query per field, and only one field is asked for.** The gallery set that
 * matters is the marked one — that is the set the store is a gate for — and a
 * marked gallery's custom_fields carries its language and its censorship as well,
 * so the one query answers all three questions (see refresh). Filtering on the
 * other fields would add galleries that are not manga, which is exactly what the
 * store must not hold.
 *
 * Two of these could not be combined anyway: `OR` is singular in the schema
 * (`OR: GalleryFilterType`), not an array, and several criteria inside the
 * custom_fields array are ANDed, so listing two fields would mean "has both".
 * The map is keyed by field name so that a second one can be added as its own
 * query, merged by gallery id — nothing does that today.
 *
 * The query spells its field name exactly. Asking for the case variants in one
 * query is impossible for the same reason, so one spelling per field is a hard
 * constraint, guaranteed by the dropdown that writes it. Reads and writes remain
 * case-insensitive (NS.pickField, NS.setField), so a key that has drifted in
 * case is still found and corrected on the next write — but a gallery whose key
 * drifted is not matched by this query, and so is missing from the map until
 * something writes it once.
 */
const QUERIES: { [field: string]: unknown } = {};

function getQuery(field: string): unknown {
  if (QUERIES[field]) return QUERIES[field];

  QUERIES[field] = gqlDoc(
    [
      "query MangaToolsMap {",
      "  findGalleries(",
      "    gallery_filter: {",
      '      custom_fields: [{ field: "' + field + '", modifier: NOT_NULL }]',
      "    }",
      "    filter: { per_page: -1 }",
      "  ) {",
      "    count",
      "    galleries {",
      "      id",
      "      custom_fields",
      "    }",
      "  }",
      "}",
    ].join("\n"),
    "build the query"
  );

  return QUERIES[field];
}

/** What one query above returns, as far as this plugin cares */
type GalleriesPayload = {
  galleries?: Array<{ id: string; custom_fields?: CustomFieldsMap }>;
};

/**
 * Refetches the map, and with it answers the question every reader asks. There
 * is one query (see QUERIES) and its result *replaces* the store rather than
 * being merged into it: a gallery the server no longer answers with is one that
 * stopped being manga, and it has to leave the map for that to be visible.
 *
 * Concurrent calls share one in-flight request.
 */
function refresh(): Promise<unknown> {
  if (inFlight) return inFlight;

  // One field, and deliberately not the two it used to be. What comes back is the
  // gallery's *whole* custom_fields map, so a gallery found by the mark gives
  // this plugin its language and its censorship value as well — and a gallery
  // without the mark is in nobody's answer, which is what makes the store itself
  // the gate: everything drawn from it appears only on galleries that are manga.
  const fields = [MANGA_FIELD_NAME];
  const queries = fields.map(getQuery);
  if (queries.some((q) => !q)) return Promise.resolve();

  // No client, no answer — and the store stays null, which is the honest thing
  // for it to say. The next refresh tries again.
  const client = stashClient();
  if (!client) return Promise.resolve();

  // no-cache rather than network-only, for the reason the settings query gives
  // (see refreshSettings): the answer would be written into Apollo's normalised
  // cache, and these are *Gallery* objects — so every refresh would push this
  // plugin's custom_fields into each marked gallery already in the cache. Stash's
  // edit form reinitialises itself whenever the gallery it was built from changes
  // (enableReinitialize in GalleryEditPanel), so that write lands as "the reader's
  // unsaved typing is thrown away". The store here is this plugin's own, and
  // nothing else reads that copy.
  inFlight = Promise.all(
    queries.map((query) =>
      client.query({ query: query, fetchPolicy: "no-cache" })
    )
  )
    .then((results) => {
      const next: Map<string, CustomFieldsMap> = new Map();
      results.forEach((res) => {
        const data = res?.data;
        const result = data
          ? (data.findGalleries as GalleriesPayload | undefined)
          : undefined;
        const galleries = result?.galleries || [];

        galleries.forEach((g) => {
          if (g.custom_fields) next.set(String(g.id), g.custom_fields);
        });
      });

      store = next;
      emit();

      // Only log when the count changes, so it does not spam every minute.
      // This line is the first thing to check when a badge does not show up: if it
      // says 0, the query worked but no gallery is marked as manga, so the problem
      // is the data rather than the plugin.
      if (next.size !== lastLoggedSize) {
        lastLoggedSize = next.size;
        console.info(
          "[mangaTools] loaded " + next.size + " gallery(ies) marked as manga"
        );
      }
    })
    .catch((e) => {
      // Deliberately do not clear what we already have — stale values beat
      // none, and the next refresh will try again. Query syntax errors land
      // here too (Apollo throws GraphQL errors), so this log has to be loud.
      console.error(
        "[mangaTools] failed to fetch custom fields, marks will not show. Raw error:",
        e
      );
    })
    .then(() => {
      inFlight = null;
    });

  // Assigned in the try above: every path through the catch has returned.
  return inFlight!;
}

/**
 * The plugin settings live in Stash's Configuration (Configuration.plugins,
 * keyed by plugin ID) and are read/written through GraphQL. The one setting
 * here, enabledLanguages, is a comma-separated list of canonical codes; an
 * empty value means "no restriction". See parseEnabledLanguages in
 * languages.ts.
 *
 * Only the `plugins` field is fetched — not the rest of Configuration, which
 * is a large object. This is the same minimal-query approach as getQuery().
 */
/**
 * Every switch that says whether the plugin does something at all: on.
 *
 * Which is what it always did — there was no way to turn any of it off — so an install
 * that has never been touched behaves just as it did, and these settings only ever take
 * something away. Declared here rather than down with the other defaults because the
 * values below read it: a constant used above its declaration is in its dead zone, and
 * the same trap is written down for the reader's own published constants.
 */
const FEATURE_ON_BY_DEFAULT = true;

/**
 * Every setting the managing half reads, live, before Stash has answered.
 *
 * The defaults, which are what the plugin did before any of this was configurable, so
 * a page drawn in the moment before the configuration arrives is drawn the way the
 * plugin has always drawn it rather than empty. `refreshSettings` overwrites them.
 */
NS.readerTakeover = FEATURE_ON_BY_DEFAULT;
NS.manageChapters = FEATURE_ON_BY_DEFAULT;
NS.fields = FEATURE_ON_BY_DEFAULT;
NS.fieldLanguage = FEATURE_ON_BY_DEFAULT;
NS.fieldCensorship = FEATURE_ON_BY_DEFAULT;
NS.fieldTranslationGroup = FEATURE_ON_BY_DEFAULT;
NS.fieldOriginal = FEATURE_ON_BY_DEFAULT;
NS.coverIcon = FEATURE_ON_BY_DEFAULT;
NS.confirmUnmark = FEATURE_ON_BY_DEFAULT;
NS.deleteOnUnmark = FEATURE_ON_BY_DEFAULT;

let SETTINGS_QUERY: unknown = null;

function getSettingsQuery(): unknown {
  if (SETTINGS_QUERY) return SETTINGS_QUERY;

  // plugins is the PluginConfigMap scalar, so it needs no sub-selection.
  SETTINGS_QUERY = gqlDoc(
    [
      "query MangaToolsSettings {",
      "  configuration {",
      "    plugins",
      "  }",
      "}",
    ].join("\n"),
    "read settings"
  );

  return SETTINGS_QUERY;
}

/** What the settings query returns, as far as this plugin cares */
type SettingsPayload = {
  configuration?: {
    plugins?: { [pluginID: string]: { [key: string]: unknown } };
  };
};

/**
 * Refetches the plugin settings and updates NS.enabledLanguages.
 *
 * Runs on startup and on every navigation, so a change made on the settings
 * page is picked up as soon as the user leaves it. (The settings UI also
 * updates the value directly when it saves, but navigation re-reads it from
 * the source of truth.)
 */
function refreshSettings(): void {
  const query = getSettingsQuery();
  if (!query) return;

  const client = stashClient();
  if (!client) return;

  client
    // no-cache rather than network-only: `configuration` is a singleton with no
    // id, and writing a result like that into Apollo's normalised cache is what
    // makes it complain that ConfigResult "either needs an ID or a custom merge
    // function" — on every page load, from a read this plugin does not want
    // cached in the first place. It is re-read on every navigation anyway.
    .query({ query: query, fetchPolicy: "no-cache" })
    .then((res) => {
      const data = res?.data as SettingsPayload | undefined;
      const plugins = data?.configuration?.plugins;
      const pluginCfg = plugins?.[PLUGIN_ID];
      NS.enabledLanguages = NS.parseEnabledLanguages(
        pluginCfg ? pluginCfg.enabledLanguages : null
      );
      // Absent means "every filter whose field is on", which is what the plugin did
      // before this setting existed.
      NS.sidebarFilters = NS.parseSidebarFilters(
        pluginCfg ? pluginCfg.sidebarFilters : null
      );
      // Absent reads as the default (on), so an install predating these
      // settings keeps its behaviour until the user turns something off.
      // The four features, and the four fields under their master.
      NS.readerTakeover = NS.parseFlag(
        pluginCfg ? pluginCfg.readerTakeover : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.manageChapters = NS.parseFlag(
        pluginCfg ? pluginCfg.manageChapters : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.fields = NS.parseFlag(
        pluginCfg ? pluginCfg.fields : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.fieldLanguage = NS.parseFlag(
        pluginCfg ? pluginCfg.fieldLanguage : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.fieldCensorship = NS.parseFlag(
        pluginCfg ? pluginCfg.fieldCensorship : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.fieldTranslationGroup = NS.parseFlag(
        pluginCfg ? pluginCfg.fieldTranslationGroup : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.fieldOriginal = NS.parseFlag(
        pluginCfg ? pluginCfg.fieldOriginal : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.coverIcon = NS.parseFlag(
        pluginCfg ? pluginCfg.coverIcon : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.confirmUnmark = NS.parseFlag(
        pluginCfg ? pluginCfg.confirmUnmark : null,
        FEATURE_ON_BY_DEFAULT
      );
      NS.deleteOnUnmark = NS.parseFlag(
        pluginCfg ? pluginCfg.deleteOnUnmark : null,
        FEATURE_ON_BY_DEFAULT
      );

      NS.showFlags = NS.parseFlag(pluginCfg ? pluginCfg.showFlags : null, true);
      NS.showCoverBadge = NS.parseFlag(
        pluginCfg ? pluginCfg.showCoverBadge : null,
        true
      );
      NS.openDetailsBlock = NS.parseFlag(
        pluginCfg ? pluginCfg.openDetailsBlock : null,
        DETAILS_OPEN_BY_DEFAULT
      );
      NS.openEditBlock = NS.parseFlag(
        pluginCfg ? pluginCfg.openEditBlock : null,
        EDIT_OPEN_BY_DEFAULT
      );
      NS.hidePerformers = NS.parseFlag(
        pluginCfg ? pluginCfg.hidePerformers : null,
        HIDE_PERFORMERS_BY_DEFAULT
      );
      NS.showDisabledFields = NS.parseFlag(
        pluginCfg ? pluginCfg.showDisabledFields : null,
        SHOW_DISABLED_FIELDS_BY_DEFAULT
      );
      // The reading half's own settings, kept as the string they arrived as. Null
      // rather than "" for a library that has none: absent is a state the reader reads
      // as "fall back to what this browser remembers", and an empty string is a value
      // it would have to special-case.
      NS.readerSettingsRaw =
        pluginCfg &&
        typeof pluginCfg.readerSettings === "string" &&
        pluginCfg.readerSettings
          ? pluginCfg.readerSettings
          : null;
      emit();
    })
    .catch((e) => {
      // Keep whatever was last read; a stale enabled set beats none.
      console.error("[mangaTools] failed to fetch plugin settings:", e);
    });
}

/** Shape of the payload of Stash's "stash:location" event */
type LocationEvent = {
  detail?: { data?: { location?: { pathname?: string } } };
};

/**
 * The URL this plugin's own files are served under, or "" when it cannot be found.
 *
 * A plugin cannot ask. `PluginApi` never says where its files live, and the ID is
 * not knowable from the source either — the yml file's name decides it, so the
 * installed copy may be `mangaToolsTest` while the code says `mangaTools`. The
 * tags Stash injects are the only self-reference on the page: `hooks/useScript`
 * appends a `<script src>` and `useCSS` a `<link>`, both pointing at this plugin.
 *
 * Both are checked, and neither by file name alone: what the backend puts in
 * those URLs is its own business. The last path segment is dropped and what is
 * left is the directory the plugin is served from, whatever it is called.
 */
function ownBaseUrl(): string {
  const tags: Element[] = [];
  const scripts = document.querySelectorAll("script[src]");
  for (let i = 0; i < scripts.length; i++) tags.push(scripts[i]);
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (let i = 0; i < links.length; i++) tags.push(links[i]);

  for (const tag of tags) {
    const url =
      (tag as HTMLScriptElement).src || (tag as HTMLLinkElement).href || "";
    if (/mangaTools/.test(url)) return url.replace(/[^/]*$/, "");
  }
  return "";
}

/** Every script and stylesheet URL on the page, for the log below */
function pageAssetUrls(): string[] {
  const urls: string[] = [];
  const tags = document.querySelectorAll("script[src], link[rel=stylesheet]");
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    urls.push(
      (tag as HTMLScriptElement).src || (tag as HTMLLinkElement).href || ""
    );
  }
  return urls;
}

/**
 * Where this plugin's files are served from, learned once at load.
 *
 * Empty when it could not be worked out, and the switch's icon then falls back to
 * the stylesheet's own relative URL — which is the same answer arrived at
 * differently, and is what the CSS carries by default.
 */
export let assetBase = "";

export function start(): void {
  if (started) return;
  started = true;

  // Silent when it works, which it does on the Stash this was written against —
  // the tag gives /plugin/<id>/ and the switch keeps its icon. It speaks only when
  // the lookup fails, and then prints the page's own URLs, because that is the
  // only way to see what shape they are on a Stash that answers differently.
  assetBase = ownBaseUrl();
  if (!assetBase) {
    console.error(
      "[mangaTools] could not tell where my own files are served from, so the " +
        "switch's icon falls back to the stylesheet's own relative URL. " +
        "Scripts and stylesheets on this page: " +
        pageAssetUrls().join(", ")
    );
  }

  // **The route listener goes on first**, before anything that can fail. It is what
  // a navigation is noticed by — every path-gated thing in this half redraws off
  // it — and it used to be the last statement here, behind two network calls. The
  // one failure that costs the most was therefore the one most easily reached.
  if (PluginApi.Event?.addEventListener) {
    locationListener = true;
    PluginApi.Event.addEventListener("stash:location", (e) => {
      const ev = e as LocationEvent;
      const loc = ev?.detail?.data?.location;
      currentPath = loc?.pathname || window.location.pathname || "";
      refresh();
      refreshSettings();
      // Tell subscribers to recompute isGalleryContext()
      emit();
    });
  } else {
    // Loud, because it is silent otherwise: with no event the plugin still reads
    // the right path (see pathNow), but it only *notices* a change when something
    // else redraws — so the symptom is a row that appears a page late or not at
    // all, which is exactly the symptom this guard used to hide.
    console.error(
      "[mangaTools] Stash has no stash:location event, so the plugin will not " +
        "hear about navigation on its own; rows it gates on the route may only " +
        "appear once something else redraws. MangaTools.diag() reports this."
    );
  }

  refresh();
  refreshSettings();

  // Saving an edit does not change the route, so a slow poll acts as a
  // backstop. The query only pulls id + custom_fields, so it is small.
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_MS);
}

/**
 * Refetches the gallery map, waiting for any fetch that is already in flight.
 *
 * Used after a write, and by the translation group's menu. Both halves matter:
 *   - calling refresh() directly would usually be **skipped**, because refresh()
 *     shares one in-flight request — so the badges would keep the old flag until
 *     the next poll or navigation.
 *   - simply clearing inFlight and starting a new fetch would let the older
 *     response land afterwards and put the previous language back, since that
 *     request was built before the write.
 */
export function refreshAfterWrite(): void {
  const pending = inFlight;
  if (pending) {
    // inFlight is cleared by this promise's own final handler, which runs
    // before this callback, so refresh() starts a genuinely new request.
    pending.then(() => {
      refresh();
    });
  } else {
    refresh();
  }
}

/**
 * Refetches the store for the translation group's menu, because it is about to be
 * read.
 *
 * The one thing a list of this Stash's groups has to be is *current*, and the
 * moment it changes is the moment somebody saves a gallery that used a new name:
 * the store is otherwise refetched on a minute's timer, so without this the menu
 * goes on offering to create the very name the gallery in front of it carries —
 * and offering a group that only this gallery ever used, now that it no longer
 * does.
 *
 * Once per opening of the menu, which is the same query the plugin already runs
 * on a timer and after every write. Nothing waits on it: the menu opens with what
 * is in hand and is redrawn when the answer lands. Two openings in the same moment
 * share the one request, since refresh() coalesces onto a fetch in flight.
 */
export function refreshForSuggestions(): void {
  refreshAfterWrite();
}

// ──────────────────────── Writing the settings ────────────────────────
//
// The read side is refreshSettings, above. This is the write side: one map built
// from the live `NS.*` values, one configurePlugin call that replaces the whole
// map, and the two bridges the reading half saves through — which are here rather
// than in the reader because saving plugin settings means writing the whole map,
// and half of that map is this half's.
/**
 * Saves every setting at once, which is what Stash's own mutation takes.
 *
 * `configurePlugin`'s input is the plugin's **whole** settings map, so a write that
 * carried only what changed would take the rest of it with them. Everything that saves
 * anything goes through here, and here is where the whole map is built — the one place
 * that knows it.
 */
function settingsInput(): { [key: string]: unknown } {
  return {
    enabledLanguages: NS.enabledLanguages
      ? NS.serializeEnabledLanguages(NS.enabledLanguages)
      : "",
    // An empty list serialises to "", which parses back as null ("every filter whose
    // field is on") — the same round trip enabledLanguages makes, with the opposite
    // default at the end of it: absence there means "no restriction", here it means
    // "all of them", and both are what an install that predates the setting did.
    sidebarFilters: NS.serializeSidebarFilters(
      NS.sidebarFilters || NS.SIDEBAR_FILTERS
    ),
    readerTakeover: NS.readerTakeover,
    manageChapters: NS.manageChapters,
    fields: NS.fields,
    fieldLanguage: NS.fieldLanguage,
    fieldCensorship: NS.fieldCensorship,
    fieldTranslationGroup: NS.fieldTranslationGroup,
    fieldOriginal: NS.fieldOriginal,
    coverIcon: NS.coverIcon,
    confirmUnmark: NS.confirmUnmark,
    deleteOnUnmark: NS.deleteOnUnmark,
    showFlags: NS.showFlags,
    showCoverBadge: NS.showCoverBadge,
    openDetailsBlock: NS.openDetailsBlock,
    openEditBlock: NS.openEditBlock,
    hidePerformers: NS.hidePerformers,
    showDisabledFields: NS.showDisabledFields,
    // Absent reads as a library that has never been written to, which is what puts the
    // browser's own remembered value back in force — see readSettings in the reader.
    readerSettings: NS.readerSettingsRaw ?? "",
  };
}

export function saveSettings(): void {
  const client = stashClient();
  if (!client) {
    console.error("[mangaTools] no Apollo client, the settings were not saved");
    return;
  }

  client
    .mutate({
      mutation: gqlDoc(
        [
          "mutation MangaToolsSettings($plugin_id: ID!, $input: Map!) {",
          "  configurePlugin(plugin_id: $plugin_id, input: $input)",
          "}",
        ].join("\n"),
        "write settings"
      ),
      variables: { plugin_id: PLUGIN_ID, input: settingsInput() },
    })
    .catch((e) => {
      console.error("[mangaTools] failed to save plugin settings:", e);
    });
}

/**
 * Writes the reading half's settings: kept here, and saved with everything else.
 *
 * The reader calls this rather than a client of its own, because saving plugin
 * settings means writing the whole map and half of that map is this half's. It is
 * applied to the answer first — so the reader's own next read sees it, with no round
 * trip in the way — and then saved.
 */
NS.writeReaderSettings = (raw: string): void => {
  if (NS.readerSettingsRaw === raw) return;

  NS.readerSettingsRaw = raw;
  saveSettings();
};

/** Runs `fn` when the settings are re-read, and returns the way to stop. */
NS.watchReaderSettings = (fn: () => void): (() => void) => subscribe(fn);

// ───────────────── The rest of the settings' defaults ─────────────────
//
// FEATURE_ON_BY_DEFAULT and its block of assignments are above, beside the
// settings query that overwrites them. These four belong with them: they are what
// refreshSettings falls back to when the plugin config does not say.

/**
 * The state each block opens in, and the defaults for the two settings that
 * decide it.
 *
 * The details one starts collapsed: that tab already has a lot on it, and the
 * heading is what says the section exists. The edit one starts open, because
 * there it is not a section of a page full of sections — it is a field, and the
 * dropdown inside it is the only way to set a language at all, so a fold that
 * starts closed would be a fold over the feature.
 *
 * Only the *initial* state, either way: a setting is about how a block opens, not
 * about whether it can be opened, so changing it does not reach into a block that
 * is already on screen. `NS.openDetailsBlock` / `NS.openEditBlock` hold the live
 * values, which `refreshSettings` overwrites from the plugin config.
 */
const DETAILS_OPEN_BY_DEFAULT = false;
const EDIT_OPEN_BY_DEFAULT = true;
/** A mark is what makes a gallery manga, so a manga gallery's edit page hides
 *  the performers field unless the reader asks for it back. See the CSS rule. */
const HIDE_PERFORMERS_BY_DEFAULT = true;

NS.openDetailsBlock = DETAILS_OPEN_BY_DEFAULT;

/**
 * Whether a field that is switched off is drawn by Stash instead of being hidden.
 *
 * **Off by default**, which is what this plugin has always done: a switch that arrives with a
 * new version is not the place to change what a reader already has. See the note on the row
 * itself, and `showDisabledFields` in plugin-api.ts for what it decides.
 */
const SHOW_DISABLED_FIELDS_BY_DEFAULT = false;
NS.openEditBlock = EDIT_OPEN_BY_DEFAULT;
NS.hidePerformers = HIDE_PERFORMERS_BY_DEFAULT;
