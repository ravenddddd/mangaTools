/**
 * Manga Tools — a toolbox that adapts Stash galleries to manga/comic management.
 *
 * Everything goes through the UI plugin API; no Stash core code is modified, so
 * Stash upgrades never produce merge conflicts.
 *
 * The language attribute lives in one of the Gallery's custom fields,
 * `plugin.mangaTools.language`. What is stored is the canonical code, not the
 * display name, and the name is looked up only when rendering — the same
 * approach Stash takes for performer nationality. It surfaces in five places:
 *
 *   - a flag badge on the bottom of the gallery card cover
 *   - a dropdown on the gallery edit page, so you never type a code by hand
 *   - the same dropdown in the bulk edit dialog, gated by the manga mark and
 *     riding along with Apply
 *   - a collapsible block in the details tab, where the raw code would be — the
 *     language as its flag and localised name, the censorship mark beside it
 *   - a filter section in the gallery list's sidebar (sidebar-filter.tsx),
 *     which narrows the list to one language
 *
 * A second attribute, the censorship mark, works the same way and lives in
 * `plugin.mangaTools.censorship`. It is a two-valued field rather than a boolean:
 * "not marked" is the absence of the key, which is what the selector's own clear
 * button produces. It surfaces in three places:
 *
 *   - a selector on the gallery edit page, beside the language one
 *   - a row in the details tab's block, as icon and word
 *   - a selector in the bulk edit dialog, gated the same way
 *
 * A third field decides whether any of it applies. A gallery carrying
 * `plugin.mangaTools.manga` is manga; one that does not is an ordinary Stash
 * gallery, and the only thing of this plugin's on it is the switch that sets the
 * mark. Everything above is drawn only on the first kind — and the card carries
 * that same mark's icon at the end of its popover row, which is what says which
 * kind a card is without opening anything.
 *
 * `languages.ts` holds the codes and their flags, `censorship.tsx` the
 * censorship vocabulary and its icons, `fields.ts` the field names and the
 * generic read/write helpers. Filtering is spread across four modules —
 * `filter-model.ts` the criterion read/write logic, `filter-ui.tsx` the rows
 * both surfaces share, `sidebar-filter.tsx` the three sidebar sections, and
 * `dialog-filter.tsx` the dialog's language card. Everything else is below.
 *
 * New features should keep the same shape: patches that hand anything they do
 * not own straight back to the original component, and shared data in a module
 * rather than on the window.
 *
 * The plugin is one bundled file. The modules imported below are inlined into
 * it, so Stash loads exactly the one file ui.javascript names in mangaTools.yml
 * and there is no load order left to get wrong.
 */
import "./fields";
import { CensorshipIcon, formatCensorshipOption } from "./censorship";
import { NS } from "../languages";
import { t } from "../i18n";
import { gqlDoc, requirePluginApi } from "../plugin-api";
import { DialogLanguageFilter } from "./dialog-filter";
import { registerLanguageCriterionOption } from "./filter-model";
import {
  SidebarCensorshipFilter,
  SidebarLanguageFilter,
  SidebarMangaFilter,
  SidebarOriginalFilter,
  SidebarTranslationGroupFilter,
  currentSidebarFilter,
  publishSidebarFilter,
} from "./sidebar-filter";
import type { ReactNode } from "react";
import type { MangaToolsFilterModel } from "../plugin-api";
import type {
  MangaToolsApolloClient,
  MangaToolsApolloOperation,
  MangaToolsCustomFields,
  MangaToolsDescription,
  MangaToolsIntl,
  MangaToolsOption,
  MangaToolsPatchFn,
  MangaToolsUsualLanguageMap,
} from "../plugin-api";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

const FIELD_NAME = NS.FIELD_NAME;
const CENSORSHIP_FIELD_NAME = NS.CENSORSHIP_FIELD_NAME;
const MANGA_FIELD_NAME = NS.MANGA_FIELD_NAME;
const TRANSLATION_GROUP_FIELD_NAME = NS.TRANSLATION_GROUP_FIELD_NAME;
const ORIGINAL_FIELD_NAME = NS.ORIGINAL_FIELD_NAME;
const CHAPTER_FIELD_NAME = NS.CHAPTER_FIELD_NAME;

const PLUGIN_ID = "mangaTools";

/**
 * Anchors for the two places a language field is inserted.
 *
 * Both are rows Stash itself tags with data-field, so the anchor survives
 * markup changes:
 *   - the gallery edit panel uses renderField, which tags the studio row
 *     `studio_id`
 *   - the bulk edit dialog uses BulkUpdateFormGroup, which tags it `studio`
 *
 * They are deliberately different strings, so the two lookups can never
 * match each other's row.
 */
const EDIT_ANCHOR = '.form-group[data-field="studio_id"]';

/**
 * The studio row inside a bulk dialog, named by `BulkUpdateFormGroup` — and **not**
 * unique to it: the scrape dialog's studio row carries the same attribute, which is
 * why finding it means searching inside the dialog's form rather than the document.
 * See bulkAnchor.
 */
const BULK_ANCHOR = '[data-field="studio"]';

/**
 * What identifies a bulk dialog: the row `BulkUpdateFormGroup name="rating"` emits,
 * and which nothing else in Stash emits at all — the edit pages do not name a
 * rating row that way, and the gallery scrape dialog has no rating row.
 *
 * It identifies *a* bulk dialog rather than the galleries one; the route guard is
 * what makes it the galleries one, since this plugin draws nothing on the scene,
 * image or performer pages those other bulk dialogs belong to.
 */
const BULK_DIALOG_MARK = '[data-field="rating"]';

const REFRESH_MS = 60000;

/** The Gallery custom_fields map as it comes back from GraphQL */
type CustomFieldsMap = MangaToolsCustomFields;

/** Column class names copied off a native form row */
type NativeFieldClasses = { group: string; label: string; control: string };

/**
 * Pulls the original component out of a patch.instead callback's arguments.
 *
 * The official example writes `(props, _, original)`, but the number of
 * arguments passed depends on whether React supplies the legacy context, so a
 * hard-coded index can come back undefined. The last argument is always the
 * original component — reading it that way is safe either way.
 */
// biome-ignore lint/suspicious/noExplicitAny: the component a patch is handed // has no nameable type — its props differ per target, and it is used as JSX.
function originalFrom(args: unknown[]): any {
  return args[args.length - 1];
}

/**
 * Pulls the rendered result out of a patch.after callback's arguments.
 *
 * `after` is the one patch kind whose last argument is not a component: Stash
 * appends what everything before it produced — the original component's output,
 * or an `instead` function's — and the callback returns what should be rendered
 * in its place. Two accessors rather than one index for that reason: they look
 * interchangeable and are not, and mixing them up yields a component rendered as
 * a child rather than a crash.
 */
function resultFrom(args: unknown[]): ReactNode {
  return args[args.length - 1] as ReactNode;
}

/**
 * The filter model out of a rendered element tree, or null if it is not there.
 *
 * Whatever Stash hands the model to carries it as a `filter` prop, and a list
 * page has exactly one model, so the first one found is it. The shape is checked
 * rather than trusted: `filter` is a common enough prop name that a tree could
 * hold something else by it, and handing that to the sidebar's sections would
 * fail in a way that says nothing about the cause.
 */
function findFilter(node: ReactNode): MangaToolsFilterModel | null {
  if (node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFilter(child);
      if (found) return found;
    }
    return null;
  }

  const props = (node as { props?: { children?: ReactNode; filter?: unknown } })
    .props;
  if (!props) return null;
  if (Array.isArray(props.filter)) return null;
  const filter = props.filter as MangaToolsFilterModel | undefined;
  if (filter && Array.isArray(filter.criteria)) return filter;

  return findFilter(props.children);
}

/** Whether this Stash has the sidebar patch container the sections mount through */
function hasSidebarSectionsContainer(): boolean {
  const components = PluginApi.components as { [name: string]: unknown };
  return !!components && !!components["FilteredGalleryList.SidebarSections"];
}

/** Whether the missing-sidebar-container error has been logged already */
let warnedMissingSidebarContainer = false;

/** Registers a patch, and keeps one failing to register from taking the rest of
 *  the plugin with it.
 *
 * A patch whose *target does not exist* is not what this guards: Stash only
 * pushes the callback onto a list, so a name it has never heard of registers
 * happily and simply never fires — which is what `noteFired`'s log is for.
 *
 * What it guards is the API surface itself. This file runs top to bottom at load
 * time, so a `PluginApi.patch` that is missing or renamed — a Stash older or
 * newer than this plugin expects — would throw here and stop the module, and
 * every patch *below* that point would silently never register. A half-working
 * plugin with no error is the worst of both outcomes; this turns it into one
 * line on the console naming the target that did not make it.
 */
function registerPatch(
  kind: "before" | "instead" | "after",
  target: string,
  fn: MangaToolsPatchFn
): void {
  try {
    PluginApi.patch[kind](target, fn);
  } catch (e) {
    console.error(
      "[mangaTools] could not register the " + target + " patch:",
      e
    );
  }
}

/**
 * Records the first time a patch is actually invoked.
 *
 * Patching a component name that does not exist does not raise an error — it
 * simply never runs, leaving no trace to debug from. (This really happened:
 * CustomField looks like a patchable component but is a plain React.FC.)
 * This log is direct evidence that a patch took effect; it fires once per
 * target.
 */
const firedOnce: { [target: string]: boolean } = {};

function noteFired(target: string): void {
  if (firedOnce[target]) return;
  firedOnce[target] = true;
  console.info("[mangaTools] patch active: " + target);
}

/**
 * Records the first time a *condition* worth reporting is met, and says so once.
 *
 * The same discipline as `noteFired`, for the other half of the same problem: a
 * patch that never runs leaves no trace, and neither does a guard that decides not
 * to draw something. Both are silent by construction — that is what a guard is —
 * so the one place that can tell the difference is the plugin itself, at the
 * moment it decides. Once per key per page, because these run on every render.
 */
const notedOnce: { [key: string]: boolean } = {};

function noteOnce(key: string, message: string): void {
  if (notedOnce[key]) return;
  notedOnce[key] = true;
  console.warn("[mangaTools] " + message);
}

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
let store: Map<string, CustomFieldsMap> | null = null;

/** Subscribers: re-render when the store or the route changes */
const listeners: Set<() => void> = new Set();

let inFlight: Promise<unknown> | null = null;
let started = false;
let lastLoggedSize = -1;

/** Whether the `stash:location` listener got registered — see start(), and diag */
let locationListener = false;

/** How many times the bulk rows have rendered — see diag */
let bulkRenders = 0;

/**
 * The path the plugin was last *told* it is on, by `stash:location`.
 *
 * Nothing decides anything by this any more — see pathNow, which reads the URL. It
 * is kept because it is the other half of a question worth being able to ask: when
 * the plugin acts on the wrong page, the first thing to know is whether the URL and
 * the last announcement agree. MangaTools.diag() reports both.
 */
let currentPath = window.location.pathname || "";

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
function pathNow(): string {
  return window.location.pathname || "";
}

function emit(): void {
  listeners.forEach((fn) => {
    fn();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribes to global state (data or route) and re-renders on change. */
function useGlobalVersion(): number {
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
function isGalleryContext(): boolean {
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
function currentGalleryId(): string {
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
function pickLanguage(customFields: unknown): string {
  return NS.pickField(customFields, FIELD_NAME);
}

/**
 * The censorship mark a gallery's custom fields carry.
 *
 * Through normalizeCensorship, so anything that is not one of the two known
 * values — including a key this plugin did not write — reads as "not marked"
 * rather than being shown or guessed at.
 */
function censorshipOf(customFields: unknown): string {
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
function stashClient(): MangaToolsApolloClient | null {
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
let assetBase = "";

function start(): void {
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
function refreshAfterWrite(): void {
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
function refreshForSuggestions(): void {
  refreshAfterWrite();
}

// ─────────────────────── UI locale and flags ───────────────────────

/**
 * Current Stash UI locale.
 *
 * Reads it through react-intl, exactly like CountryLabel does — the plugin
 * never guesses the user's language. This is a hook, so it must be called
 * inside a component body.
 */
function useLocale(): string {
  return PluginApi.libraries.Intl.useIntl().locale;
}

/**
 * A regional flag.
 *
 * flag-icons' CSS is loaded globally by Stash (index.scss imports
 * `flag-icons/css/flag-icons.min.css`), so emitting `<span class="fi fi-jp">`
 * is all that is needed — no assets to ship.
 *
 * These are CSS-drawn flags, not emoji: Windows' Segoe UI Emoji has no flag
 * glyphs, so a flag emoji degrades into a pair of boxed letters there.
 */
function Flag(props: { flag: string; className?: string }) {
  return (
    <span
      className={
        "fi fi-" + props.flag + (props.className ? " " + props.className : "")
      }
    />
  );
}

// ─────────────────────────── Cover badge ───────────────────────────

/**
 * The badge itself, from an already-described value.
 *
 * Split out of LanguageBadge so that the example in the settings page's help
 * panel is drawn by this same code: an example built from its own copy of these
 * three cases is an example that can quietly stop being true, and this one is
 * looked at to decide what a setting does.
 *
 * A plain function rather than a component, so that nothing new appears in the
 * element tree between LanguageBadge and the div it draws — the tests read that
 * tree to reach the flag, and a component boundary there would be a level they
 * have to know about. It has no hooks of its own to lose by being called
 * directly, and `NS.showFlags` is read at the moment it is drawn either way.
 */
function languageChip(info: MangaToolsDescription, className?: string) {
  // Appended to whichever of the three chips below is drawn, so that the help
  // panel can ring the badge itself: the ring has to be on the absolutely
  // positioned chip, not on a wrapper of it, which would be a box in the flow.
  const extra = className ? " " + className : "";

  // No flag to show, for one of two reasons — and they are not the same chip:
  //
  //   unrecognised  arbitrary data, so it is bounded and ellipsised; a long junk
  //                 value must not end up covering the cover
  //   flags off     a real language name, so it is shown whole — clipping
  //                 "印度尼西亚语" or "Traditional Chinese" to a few characters
  //                 would make the setting hard to use
  //
  // The look is identical; what differs is whether the text may run its length.
  if (!info.known) {
    return (
      <div className={"manga-tools-badge is-unknown" + extra}>{info.name}</div>
    );
  }
  if (!NS.showFlags) {
    return (
      <div className={"manga-tools-badge is-name" + extra}>{info.name}</div>
    );
  }

  return (
    <div className={"manga-tools-badge" + extra} aria-label={info.name}>
      <Flag flag={info.flag as string} />
    </div>
  );
}

/** Reads the in-memory store only; issues no requests. */
function LanguageBadge(props: { galleryId: string }) {
  useGlobalVersion();
  const locale = useLocale();

  const info = NS.describe(
    pickLanguage(store?.get(String(props.galleryId))),
    locale
  );
  if (!info) return null;

  return languageChip(info);
}

/** Class of the empty span kept beside Stash's popover row, one per card */
const POPOVER_ANCHOR_CLASS = "manga-tools-popover-anchor";
/** Class of the node inside that row that our button is portalled into */
const POPOVER_SLOT_CLASS = "manga-tools-popover-slot";
/** Marks a row this plugin had to make, because Stash drew none */
const POPOVER_ROW_CLASS = "manga-tools-popovers";

/**
 * Forces one more render once a component has mounted.
 *
 * Every mount point below is found by looking in the document, and the first
 * render of a page happens *before* React has committed any of it: a lookup at
 * that point sees the previous page's markup, which on a load is nothing at all.
 * Effects flush after the commit, so the extra render this asks for is the first
 * one that can see the toolbar. One bump and not a loop: the dependency list is
 * empty, so the effect never runs twice.
 *
 * A layout effect rather than a plain one, for the reason the other mount points
 * give: it runs after React has written the DOM but before the browser paints,
 * which is the only window in which the second render is invisible. A plain
 * effect would leave the button missing for a frame.
 *
 * The tests' React stub runs the callback immediately and its state setter is
 * inert, so under the stub this is a no-op — which is sound, because a test
 * builds the DOM it wants found *before* calling the component.
 */
function useAfterMount(): void {
  const bump = React.useState(0)[1];
  React.useLayoutEffect(() => {
    bump(1);
  }, []);
}

/**
 * Whether an element carries a class.
 *
 * Read off `className` rather than through `classList`: the smoke tests' DOM
 * stub has the former and not the latter, and a class name is all this needs.
 */
function hasClass(el: Element | null, name: string): boolean {
  return !!el && (el.className || "").split(/\s+/).indexOf(name) >= 0;
}

/**
 * Finds (creating if needed) the node to portal a card's mark into: the last
 * child of Stash's own `.card-popovers` row.
 *
 * Why a portal *into* Stash's row, rather than a second row of our own: the row
 * is a flex container, so anything rendered beside it lands on a line of its own
 * instead of being another button on this one.
 *
 * The anchor is the empty span the caller renders next to that row, carrying the
 * gallery id. Searching for *that* is what makes the row found the right one: a
 * gallery appears in exactly one card in Stash's list, so the id names one anchor
 * — where `.card-popovers` alone would match the first row on the page however
 * far down it this card is. If a gallery ever did appear twice, the mark would
 * go to the first of them and the second would go without.
 *
 * A card with no image count, no tags, no performers, no scenes and no organized
 * mark has no row at all. One is then created with the classes Stash uses, so it
 * is indistinguishable from the real thing — because there is no real thing to
 * be distinguished from.
 */
function ensurePopoverSlot(galleryId: string): HTMLElement | null {
  const anchor = document.querySelector(
    '[data-gallery="' + galleryId + '"]'
  ) as HTMLElement | null;
  if (!anchor?.parentNode) return null;

  const previous = anchor.previousElementSibling;
  let row: Element;

  if (
    hasClass(previous, "card-popovers") ||
    hasClass(previous, POPOVER_ROW_CLASS)
  ) {
    row = previous as Element;
  } else {
    row = document.createElement("div");
    row.className = "btn-group card-popovers " + POPOVER_ROW_CLASS;
    anchor.parentNode.insertBefore(row, anchor);
  }

  let slot: Element | null = null;
  for (let i = 0; i < row.children.length; i++) {
    if (hasClass(row.children[i], POPOVER_SLOT_CLASS)) {
      slot = row.children[i];
      break;
    }
  }

  if (slot) {
    // Stash re-renders its row and can leave ours in the middle of it; the mark
    // belongs after Stash's own buttons, which is where they still are.
    if (row.lastElementChild !== slot) row.appendChild(slot);
    return slot as HTMLElement;
  }

  slot = document.createElement("span");
  slot.className = POPOVER_SLOT_CLASS;
  row.appendChild(slot);
  return slot as HTMLElement;
}

/**
 * The manga icon at the end of a card's popover row, or null when the gallery is
 * not one the plugin manages.
 *
 * An anchor plus a portal rather than the button itself, because the row it
 * belongs in is Stash's and React does not own it — see ensurePopoverSlot. The
 * anchor is rendered on every pass so there is always exactly one to find; on
 * the pass that also has a slot to draw, the two go out together.
 *
 * `useAfterMount` is what turns the anchor of this render into the slot of the
 * next one, on a real page: the anchor is not in the document until this render
 * has been committed.
 */
function MangaPopoverMark(props: { galleryId: string }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const manga = storedIsManga(props.galleryId);
  const slot = manga ? ensurePopoverSlot(props.galleryId) : null;

  if (!manga || !NS.coverIcon) return null;

  return (
    <>
      <span className={POPOVER_ANCHOR_CLASS} data-gallery={props.galleryId} />
      {slot
        ? PluginApi.ReactDOM.createPortal(
            <button
              type="button"
              className="minimal btn btn-primary manga-tools-mark"
              title={t(intl, "mangaTools.manga.marked")}
            >
              <MangaIcon />
            </button>,
            slot
          )
        : null}
    </>
  );
}

// ────────────────────────── Gallery toolbar ──────────────────────────

/** Class of the mount point in the gallery toolbar */
const TOOLBAR_HOST_CLASS = "manga-tools-toolbar-host";

/**
 * Whether this Stash has the client the switch writes through.
 *
 * Both of the switch’s writes go through this plugin’s own mutation, so the
 * client is all it needs. Stash injects StashService itself (it is a namespace
 * import of `src/core/StashService`), so a version without `getClient` is the
 * only way the lookup fails, and on such a version the toolbar gets nothing
 * rather than a switch that cannot work.
 *
 * Read defensively, with a Stash that has no API at all in mind: this line is in
 * the module body, so it is evaluated while the bundle loads, and this half
 * shares a bundle with the reader's — which must not be taken down by anything
 * that happens here.
 */
const CAN_WRITE =
  typeof PluginApi.utils?.StashService?.getClient === "function";

if (!CAN_WRITE) {
  console.error(
    "[mangaTools] this Stash has no Apollo client, so the toolbar switch " +
      "cannot be shown. The rest of the plugin is unaffected."
  );
}

/** As with the other mount points, held at module scope so a re-render reuses
 *  the same node rather than making a new one every time. */
let toolbarHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point in the gallery detail page's
 * toolbar, directly after the span holding Stash's organized button.
 *
 * Why the DOM at all: the toolbar is rendered by `Gallery`, which is not a
 * registered component, so there is no patch to hang a React child off — the
 * same situation as the detail row (see ensureDetailHost).
 *
 * Why that button and not the group's two spans by position: the second span is
 * the operation menu, whose contents depend on the entity and on the user's
 * settings. The organized button is drawn for every gallery, on every version,
 * in a group of its own, which makes it the one stable handle in there.
 *
 * Scoped to `.gallery-toolbar`, so the bulk edit dialog's organized button —
 * same class, different place — is never mistaken for it.
 */
function ensureToolbarHost(): HTMLElement | null {
  const button = document.querySelector(".gallery-toolbar .organized-button");

  // The button is not always there, and its absence is not the toolbar's: Stash
  // renders a spinner in its place while its own save runs (OrganizedButton has a
  // `loading` branch), which is exactly what clicking organized does. Treating
  // that as "no toolbar" took this plugin's switch off the page — the reader saw
  // it vanish under their own cursor and stay gone until the next refresh.
  // Nothing about the button's absence says anything about the host.
  if (!button) return toolbarHost;

  const anchor = (button?.parentNode || null) as HTMLElement | null;
  if (!anchor?.parentNode) {
    toolbarHost = null;
    return null;
  }

  if (!toolbarHost) {
    toolbarHost = document.createElement("span");
    toolbarHost.className = TOOLBAR_HOST_CLASS;
  }

  // A React re-render may displace it; keep it directly after that span, which
  // puts it between the organized button and the operation menu.
  if (anchor.nextElementSibling !== toolbarHost) {
    anchor.parentNode.insertBefore(toolbarHost, anchor.nextElementSibling);
  }

  return toolbarHost;
}

/**
 * One of the SVG files this plugin ships, drawn as a mask.
 *
 * A span with a mask rather than an `<svg>`: the artwork is a file, shipped as
 * downloaded with its attribution comment intact, and a file cannot see the
 * page's `currentColor` — that only works for markup inlined into the page. A CSS
 * mask reads the shape and ignores the colour, so the file supplies one and
 * `background-color` supplies the other, and a state is a colour rule each. The
 * class names the icon: `.manga-tools-<name>-icon` carries the file, and the
 * declarations they all share are written once in mangaTools.css.
 */
function AssetIcon(props: { file: string; className: string }) {
  // The stylesheet carries a relative URL for this, and it is right whenever
  // plugin files sit under one path. This is the same answer reached from the
  // plugin's own tag instead, which does not depend on that being true — and it is
  // only known after start() has run.
  const style = assetBase
    ? ({
        "--manga-tools-icon": `url("${assetBase}assets/icons/${props.file}")`,
      } as React.CSSProperties)
    : undefined;

  return <span className={props.className} aria-hidden="true" style={style} />;
}

/** The mark's icon — the one that makes a gallery manga. */
function MangaIcon() {
  return <AssetIcon className="manga-tools-manga-icon" file="manga.svg" />;
}

/**
 * The two steaks: 生肉 is raw, and 熟肉 is what a translation makes of it.
 *
 * The joke is the Chinese fandom's — 生 and 熟 are how food is described, and a
 * gallery nobody has translated is 生肉, raw meat. It is worth keeping for a
 * reason beyond the joke: neither file says a word of anybody's language, so the
 * state of the field reads the same whatever Stash's UI is set to. The words go in
 * the button's name and its tooltip, where the reader's language does apply.
 */
function SteakIcon(props: { raw: boolean }) {
  return props.raw ? (
    <AssetIcon className="manga-tools-raw-icon" file="raw.svg" />
  ) : (
    <AssetIcon className="manga-tools-cooked-icon" file="cooked.svg" />
  );
}

/**
 * The translation groups already in use, in the order the edit field offers them.
 *
 * Out of this plugin's own store, which is the same set of galleries everything
 * else here is about: every marked gallery carries its whole custom_fields map,
 * so the values in use are in memory already and no query is needed for them.
 * Empty until the first answer, which is right — before that there is nothing to
 * suggest, and the field is a plain text box regardless.
 *
 * Recomputed on every call rather than cached. The field that asks writes on every
 * keystroke, so this does run once per character — but it walks the marked
 * galleries and sorts the *distinct* names, which is tens of entries, and a walk
 * of a few thousand maps is not worth an invariant that can go stale: the store is
 * both replaced by a refresh and written into in place, and a cache keyed on
 * either one would be quietly wrong about the other.
 *
 * Case is left alone. Two groups whose names differ only in case are two names as
 * far as this is concerned, and folding them here would mean deciding which
 * spelling to offer somebody who typed the other one.
 */
/**
 * The two things the sidebar's group filter needs from the store, published here
 * rather than reached for by name.
 *
 * The section renders in Stash's sidebar, one module away from the store, and the
 * store is module state on purpose: a second reader of it would be a second answer
 * to "which groups does this library hold", which is the class of bug this file has
 * paid for more than once (see fields.ts on why one list is asked by everything).
 * So the functions are published, not the map — and `usualLanguages` is the same
 * walk of the same store the edit page's menu and the bulk row already use.
 */
NS.translationGroups = (): string[] => knownTranslationGroups();

NS.usualLanguages = (): MangaToolsUsualLanguageMap =>
  NS.usualLanguagesOf(store);

function knownTranslationGroups(): string[] {
  if (!store) return [];

  const seen: { [name: string]: true } = {};
  store.forEach((fields) => {
    const name = NS.translationGroupOf(fields);
    if (name) seen[name] = true;
  });

  return Object.keys(seen).sort();
}

/**
 * Whether the store — a filled one — holds this gallery.
 *
 * Since the query asks for the mark, being in the map and being manga are the same
 * question, which is what makes the store a gate rather than a cache. This is the
 * one spelling of that question: isMarkedNow asks it here, so the cover badge, the
 * card's popover mark, the toolbar switch and the panels cannot come to different
 * conclusions about one gallery. They did once — membership here, and the map's
 * own value in the switch — and a gallery whose mark had been hand-set to an empty
 * string was manga to one and not to the other.
 */
function storedIsManga(galleryId: string): boolean {
  // `?? false` is the null store: something it cannot answer is not a yes.
  return store?.has(String(galleryId)) ?? false;
}

/**
 * Asks before a gallery stops being manga.
 *
 * Because unmarking is not a flag coming off: the plugin's fields go with it — a
 * gallery the plugin does not manage should not be left carrying half its data
 * (see the note on the toggle). That is worth a question, and Stash's own modal is
 * the way to ask it — the plugin has Bootstrap already.
 *
 * A modal rather than a second click on the switch: the switch has two states and
 * a two-step click would need a third, which is exactly the kind of state naming
 * this plugin went to some trouble to avoid.
 */
/**
 * A question, in a modal.
 *
 * The shell both of this plugin's confirmations use — taking the manga mark off,
 * and importing a library's chapters over the lists this plugin already has. Stash's
 * own Bootstrap, so it looks like the rest of the page; the two differ only in what
 * they say and in which of them is the dangerous answer.
 */
function ConfirmDialog(props: {
  children: unknown;
  confirmLabel: string;
  cancelLabel: string;
  variant: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Modal = Bootstrap?.Modal;
  const Button = Bootstrap?.Button;
  if (!Modal || !Button || !Modal.Body || !Modal.Footer) return null;

  return (
    <Modal show size="sm" onHide={props.onCancel}>
      <Modal.Body>{props.children}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
        <Button variant={props.variant} onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function ConfirmUnmark(props: {
  onCancel: () => void;
  onConfirm: () => void;
  /** Whether the edit form is holding unsaved changes the write will reset */
  resetsForm: boolean;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();

  return (
    <ConfirmDialog
      variant="danger"
      confirmLabel={t(intl, "mangaTools.manga.confirmOk")}
      cancelLabel={t(intl, "mangaTools.manga.confirmCancel")}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    >
      <div>{t(intl, "mangaTools.manga.confirm")}</div>
      {/* Taking the mark off removes the language and the censorship with it,
          which the details panel draws — so the cache has to follow, and Stash's
          edit form reinitialises itself when it does. Marking is the other way
          round and is written quietly, so this only ever applies here. */}
      {props.resetsForm ? (
        <div>{t(intl, "mangaTools.manga.confirmResetsForm")}</div>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * The edit form's custom-fields map and its setter, while the edit tab is open.
 *
 * Published by MangaFieldBlock, which is rendered inside that form and so has
 * both. Marking from the toolbar writes through this as well as to the server
 * (see `mark`), so the form's own copy of the map carries the mark and a later
 * Save — which sends the whole map back (`custom_fields: { full: … }`) — cannot
 * drop it. Cleared when the block unmounts: a setter left behind would write into
 * a form that is no longer there.
 */
let editForm: {
  /** The gallery the form is for — the form on screen is always the route's */
  galleryId: string;
  values: CustomFieldsMap;
  onChange: (values: CustomFieldsMap) => void;
} | null = null;

/** The published form, if it is the one for this gallery */
function editFormFor(galleryId: string): typeof editForm {
  return editForm && editForm.galleryId === galleryId ? editForm : null;
}

/**
 * The translation group the original-text mark took away, so that a mis-click can
 * be undone by clicking the same button again.
 *
 * Held here rather than left in the gallery, which is the tempting way to do it:
 * a raw gallery carrying a group would be answering "who translated this" twice,
 * and the answer would travel — Stash's own custom-field filters would match it,
 * and so would this plugin's rule about the language a group's galleries carry.
 * The value waits until the mark comes off, and is never written anywhere.
 *
 * One shot, and only for the gallery it was taken from: un-marking puts it back
 * once, and the memory is dropped either way, so a later mark starts from nothing
 * rather than from a name somebody has already given up on. It does not survive a
 * reload, which is the price of not keeping a second copy of the name in the data.
 */
let originalGroupTaken: { galleryId: string; group: string } | null = null;

/**
 * Whether this gallery is manga, as far as anything on screen is concerned.
 *
 * Once the store has an answer it *is* the answer, and a gallery missing from it
 * is one the server does not consider manga (see storedIsManga, which is where
 * the question is actually settled). That is not the same thing as the store
 * having nothing to say yet, which is the only case the values Stash passed in are
 * for — and telling the two apart is what the store being null is for. Reading a
 * missing gallery as "no answer" was wrong in a way that showed: the values come
 * out of Apollo's cache, which both of this plugin's writes leave alone on
 * purpose, so on a gallery the cache still held as marked, taking the mark off
 * left the switch saying it was still on.
 *
 * The store is otherwise the one to trust because the plugin's own writes keep it
 * in step (see `mark` and `write`) *and* it is refreshed from the server.
 * Everything that asks the question — the toolbar switch, the details panel, the
 * edit block — asks it here.
 *
 * The edit form is not consulted, which is worth spelling out: the form holds a
 * mark only when this plugin put one there, and it does that together with the
 * write, so the two agree by construction. A form the reader edited cannot hold
 * one at all — the mark has no control in that form.
 */
function isMarkedNow(
  galleryId: string | null | undefined,
  values?: CustomFieldsMap
): boolean {
  // No id means this is not one gallery's page — the list's bulk dialog is the
  // case that matters — so there is nothing to look up and the values are all
  // there is to go on. Before the first answer, likewise.
  if (store === null || !galleryId) return NS.isManga(values);
  return storedIsManga(galleryId);
}

/**
 * Whether this plugin's store holds a gallery — and, before it has answered, that it
 * does not know.
 *
 * The reader half's gate, and the reason asking costs nothing: the store is filled
 * from a query that filters on the manga mark *itself* (`refresh` below), so a
 * gallery in it is a gallery marked manga and a gallery without the mark is in
 * nobody's answer. Null is the third answer — before the first fetch — and it means
 * "not yet" rather than "no", which is what keeps a marked gallery from being drawn
 * on in the second before the answer arrives.
 */
NS.markedInStore = (galleryId: string | null | undefined): boolean | null =>
  store === null || !galleryId ? null : storedIsManga(galleryId);

/** Runs `fn` whenever the store is refreshed, and returns the way to stop. */
NS.watchStore = (fn: () => void): (() => void) => subscribe(fn);

/**
 * The reading half's settings, as the JSON string they are stored as.
 *
 * A string rather than an object, and deliberately: what this half does with them is
 * carry them to and from the plugin's configuration, and the reading half is the one
 * that knows what is in them — including how to read the shapes they used to be
 * written in. Parsing them here would be a second opinion about a format this half has
 * no business having.
 */
NS.readerSettingsRaw = null;

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

function saveSettings(): void {
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

/**
 * Whether Stash's edit form has changes that have not been saved.
 *
 * Read out of the DOM because that is the only place it shows. The panel's own
 * Save button is disabled while there is nothing to save — GalleryEditPanel
 * renders it with `disabled={!formik.dirty || …}` — and the panel exists only
 * while its tab is open, so no button means nothing to lose.
 */
function editFormIsDirty(): boolean {
  const save = document.querySelector(".edit-buttons-container .edit-button");
  return !!save && (save as HTMLButtonElement).disabled !== true;
}

/**
 * The mutation that marks a gallery.
 *
 * Its selection set is `id` and nothing else, which is the whole point: Apollo
 * writes what the mutation returns into the cache, so asking for no gallery
 * fields leaves the cached gallery exactly as it was — same object, same
 * custom_fields — and an edit form built from it does not reinitialise (see
 * refresh() for the same argument about the store's query).
 *
 * Stash's own `useGalleryUpdate` cannot be used here: its document asks for the
 * gallery, which is what we must not have.
 */
const MARK_QUERY_TEXT = [
  "mutation MangaToolsSetFields($input: GalleryUpdateInput!) {",
  "  galleryUpdate(input: $input) {",
  "    id",
  "  }",
  "}",
].join("\n");

/**
 * The same, as a document — through `gql`, the way every other operation here is
 * built.
 *
 * Handing Apollo the raw text does not work: what `client.mutate` expects is a
 * `DocumentNode`, and a string that Apollo declines to parse comes back as a
 * rejected promise with nothing useful in it. The tests cannot see the
 * difference (their `gql` is a stub that answers with what it was given), which
 * is how this got as far as a release: it was written as a template string and
 * every assertion still passed.
 */
let markUpdate: unknown = null;
function getMarkUpdate(): unknown {
  if (markUpdate) return markUpdate;

  markUpdate = gqlDoc(MARK_QUERY_TEXT, "build the mutation");
  return markUpdate;
}

/**
 * Writes fields, and leaves the page's cached gallery alone. See MARK_QUERY_TEXT.
 *
 * Rejects when there is nothing to write *with* — no document, or no client —
 * rather than resolving as though it had been sent. Both of the callers' paths
 * refresh, so the page comes out the same either way; what a rejection buys is
 * the line the caller logs, and without it this is the one failure of the pair
 * that leaves no trace at all: no request on the wire, nothing in the console,
 * and a click that looks exactly like a successful one. Apollo rejects for its
 * own reasons, so the callers already have that path — this only makes the two
 * failures this function can have take it too.
 */
function writeQuietly(
  galleryId: string,
  fields: Record<string, unknown>
): Promise<unknown> {
  const mutation = getMarkUpdate();
  if (!mutation) {
    return Promise.reject(
      new Error("[mangaTools] no mutation document, the write was not sent")
    );
  }

  const client = stashClient();
  if (!client) {
    return Promise.reject(
      new Error("[mangaTools] no Apollo client, the write was not sent")
    );
  }

  return client.mutate({
    mutation,
    variables: { input: { id: galleryId, custom_fields: fields } },
  });
}

/**
 * Writes a gallery's chapters into this plugin's own field.
 *
 * The value arrives **already serialised**, and that is the point: the shape is the
 * reader half's — it owns the format, its version, and the tolerant parsing of it —
 * and this half's job is to put a string where the reader says. It is also what
 * keeps the dependency between the halves pointing one way; nothing here has to
 * know what a chapter is.
 *
 * The same pairing the mark uses: the store and Stash's own form are told first, so
 * what is on screen follows the click rather than a round trip that may yet fail,
 * and the refresh either confirms it or puts it right. The form copy matters *more*
 * here than it does for the mark — this key is hidden from Stash's own custom-field
 * editor (it is one of ours, see ownField), so a Save that did not know about it is
 * the one way its value could vanish with nothing on screen to notice.
 *
 * Rejects when nothing could be sent, and passes that on: the batch importer counts
 * a gallery it could not write and carries on with the rest.
 */
NS.writeChapters = (galleryId: string, json: string): Promise<void> => {
  // Only when there is an entry to update: a gallery the store has never heard of
  // is one this half is not managing, and inventing an entry for it would be the
  // store saying it is marked.
  const current = store?.get(galleryId);
  if (current) {
    store?.set(galleryId, NS.setField(current, CHAPTER_FIELD_NAME, json));
  }

  const form = editFormFor(galleryId);
  if (form) {
    form.onChange(NS.setField(form.values, CHAPTER_FIELD_NAME, json));
  }

  emit();

  return writeQuietly(galleryId, {
    partial: { [CHAPTER_FIELD_NAME]: json },
  }).then(
    () => {
      refreshAfterWrite();
    },
    (e: unknown) => {
      console.error("[mangaTools] could not write this gallery's chapters:", e);
      refreshAfterWrite();
      throw e;
    }
  );
};

function GalleryToolbar(props: { galleryId: string; values: CustomFieldsMap }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const busyState = React.useState(false);
  const busy = busyState[0];
  const setBusy = busyState[1];
  const confirmState = React.useState(false);
  const confirming = confirmState[0];
  const setConfirming = confirmState[1];

  const host = ensureToolbarHost();
  if (!host) return null;

  // What the switch says comes from isMarkedNow: this plugin's store once it has
  // answered, and the values Stash handed in only before that — the write is
  // deliberately invisible to the Apollo cache those values come from, so they are
  // the last to know.
  //
  // The edit form is not consulted for the mark. It holds one only when this
  // plugin put it there, and it does that together with the write, so there is
  // nothing it could add. It *is* what a click writes through, though — see the
  // two write paths below, which look it up when the click happens rather than
  // capturing whatever was published on this render.
  const marked = isMarkedNow(props.galleryId, props.values);

  /**
   * Takes the mark off, and this plugin's fields with it.
   *
   * Semantically the gallery is no longer the plugin's: leaving `language` and
   * `censorship` behind would be leaving data that nothing displays and nothing
   * explains. Every key is removed by the spelling it actually has, so a key that
   * drifted in case goes too.
   *
   * (A setting for this — clear on unmark, or keep — is the obvious next thing;
   * for now clearing unconditionally, behind the question above, is the honest
   * default: the alternative silently keeps data the reader cannot see.)
   */
  const write = (fields: Record<string, unknown>) => {
    // Taking the mark off takes this plugin's fields with it, so the gallery
    // stops being one of its own: out of the store now, not after the round trip.
    // Everything drawn from it — the badge, the details panel, the switch — goes
    // with it. The panels are gated on the store rather than on Stash's values
    // (see isMarkedNow), which is what makes it safe to write this quietly: the
    // cache goes on holding fields that nothing on screen asks it for.
    store?.delete(props.galleryId);

    // Looked up now rather than captured on the render that drew the switch: the
    // click is what the form has to agree with, and the published form can have
    // changed since (the edit tab opening or closing).
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form's copy loses them too, and this is not symmetry for its own sake:
      // the map a Save sends back is the *whole* of the custom fields, so a form
      // still holding the mark puts it back the next time it is saved — and the
      // cache cannot be relied on to correct it, because this write does not
      // touch the cache at all.
      // The same fields, by the same spellings, as the `remove:` list the server
      // is given — NS.clearFields is the pair to fieldsToClear for that reason.
      form.onChange(NS.clearFields(form.values));
    }

    emit();

    setBusy(true);
    // Quiet, like the mark: through this plugin's own mutation rather than
    // Stash's, because changing the gallery's custom_fields in the cache is
    // exactly what reinitialises the edit form and throws away whatever the
    // reader has typed but not saved.
    writeQuietly(props.galleryId, fields).then(
      () => {
        setBusy(false);
        setConfirming(false);
        // The store is put right by the refresh, which drops a gallery the server
        // no longer answers with. Deferred, or a fetch built before the write
        // would land after it and put the gallery back.
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        setConfirming(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The store has been emptied and the page has been told, but the server
        // never heard: ask it what the truth is, exactly as marking does. Without
        // this the gallery stays missing from the map — so unmarked on screen —
        // until the next poll or navigation, while the server still holds it.
        refreshAfterWrite();
      }
    );
  };

  const onToggle = () => {
    if (!marked) {
      mark();
      return;
    }

    // Asked about, or done: the switch says which, and taking a mark off is the one
    // thing this plugin does that a reader might have meant to think about first.
    if (!NS.confirmUnmark) {
      onConfirmUnmark();
      return;
    }

    setConfirming(true);
  };

  /**
   * Marks the gallery: on the server, and in the edit form if it is open.
   *
   * Both, because each covers something the other cannot. The server write is
   * what the plugin's own store reads, so the switch, the card badges and the
   * bulk rows all follow. The form write is what keeps the form's copy of the
   * map — the one its Save sends back in full — from being a version without the
   * mark, which is what would silently drop it (see editForm).
   *
   * Nothing here reinitialises that form: the write is the quiet one, and the
   * form is told directly rather than through the cache. That is the whole reason
   * marking is safe to do with unsaved typing sitting in it, where taking the
   * mark off is not.
   */
  const mark = () => {
    // The two copies are each built on their own: the form's map is the reader's,
    // with whatever they have typed into it, and replacing it with the store's
    // would throw that away — which is the failure this whole change is about.
    //
    // Read at click time, not on the render that drew the switch, so the form
    // written to is the one on screen now.
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form gets the mark because the map its Save sends back is the *whole*
      // of it (`custom_fields: { full: … }`): a form that did not know about the
      // mark would drop it on the next save.
      form.onChange(NS.setField(form.values, MANGA_FIELD_NAME, NS.MANGA_VALUE));
    }

    // Marked here and now, so the switch, the details panel and the edit block —
    // all of which ask isMarkedNow — follow the click rather than waiting for a
    // server round trip that may yet fail. The write below either confirms this or,
    // on failure, is put right by the refresh that follows it.
    store?.set(
      props.galleryId,
      NS.setField(
        store?.get(props.galleryId) ?? props.values,
        MANGA_FIELD_NAME,
        NS.MANGA_VALUE
      )
    );

    emit();

    setBusy(true);
    writeQuietly(props.galleryId, {
      partial: { [MANGA_FIELD_NAME]: NS.MANGA_VALUE },
    }).then(
      () => {
        setBusy(false);
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The server never heard about it, so what is on screen is wrong: ask the
        // server what the truth is. Deferred like the other one, for the same
        // reason — a fetch started before this click would answer with the state
        // before it.
        refreshAfterWrite();
      }
    );
  };

  const onConfirmUnmark = () => {
    write({ remove: NS.fieldsToClear(props.values) });
  };

  return PluginApi.ReactDOM.createPortal(
    <>
      <button
        type="button"
        className={
          "minimal manga-tools-manga-toggle btn btn-secondary" +
          (marked ? " is-manga" : "")
        }
        title={t(
          intl,
          marked ? "mangaTools.manga.marked" : "mangaTools.manga.mark"
        )}
        aria-pressed={marked}
        disabled={busy}
        onClick={onToggle}
      >
        <MangaIcon />
      </button>
      {confirming ? (
        <ConfirmUnmark
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirmUnmark}
          /* Read here, as the question is drawn: a value captured on the render
             that drew the switch can be stale by the time it is shown. */
          resetsForm={editFormIsDirty()}
        />
      ) : null}
    </>,
    host
  );
}

// ─────────────────────────── Edit-page dropdown ───────────────────────────

/**
 * react-select is a namespace import on PluginApi.libraries, and the component
 * is its default export. It is looked up at runtime, so there is no static
 * type to give it.
 */
// biome-ignore lint/suspicious/noExplicitAny: react-select is reached through a namespace import at runtime, so its component has no static type.
let SELECT: any = null;

// biome-ignore lint/suspicious/noExplicitAny: as above — the component itself.
function resolveSelect(): any {
  if (SELECT) return SELECT;

  const RS = PluginApi.libraries.ReactSelect;
  if (!RS) {
    console.error("[mangaTools] react-select not available");
    return null;
  }

  SELECT = RS.default || RS.Select || RS;
  return SELECT;
}

/**
 * Renders a dropdown option: flag plus localised name.
 * react-select calls this for both the menu item and the selected value, so
 * the two always look the same.
 */
function formatLanguageOption(option: MangaToolsOption) {
  return (
    <span className="manga-tools-option">
      {NS.showFlags && option.flag ? (
        <Flag flag={option.flag} className="manga-tools-flag" />
      ) : null}
      <span>{option.label}</span>
    </span>
  );
}

/**
 * One entry in the translation group's menu.
 *
 * Not a MangaToolsOption: that type carries a flag, which is a fact about a
 * language this plugin knows the flag for, and a group has no such table behind
 * it. `createLabel` says instead that this entry is the text somebody is typing,
 * offered so that choosing it is how a new group gets set.
 */
type MangaToolsGroupOption = {
  value: string;
  label: string;
  /** The wording for the create entry, already localised — see below. */
  createLabel?: string;
  /**
   * The language this group's galleries usually carry, for the menu's hint, or
   * null when there is nothing to say about it. Both forms, because which one is
   * drawn is the "Show flags" setting's business and that is read while
   * react-select renders — see formatGroupOption.
   */
  hint?: { flag: string | null; name: string } | null;
};

/**
 * Renders a group option: the name, or — in the menu only — the offer to create it
 * and the language its galleries usually carry.
 *
 * The "value" context is the box itself, and there the text is simply the name: an
 * offer to create what is already selected would read as a question, and a hint
 * about the group's usual language is not something to draw twice — the language
 * row above says what the language is. In the menu it is prefixed, so the entry
 * nobody has used before is told apart from the groups that exist, and the hint
 * rides at its far end.
 *
 * The hint is a flag or a name, and which one is the "Show flags" setting's call —
 * the same call it makes for the badge and the detail row, where a language is
 * drawn as a flag or as its name. A name is much the longer of the two, so it is
 * the one that gives way when the row runs out of room (see .manga-tools-hint-text).
 *
 * Everything drawn here is carried on the option rather than looked up in this
 * function: it is called by react-select while it renders, and a component's worth
 * of hooks cannot be used in something invoked per option. The options are built
 * in MangaFieldBlock, which has the reader's `intl` in hand.
 */
function formatGroupOption(
  option: MangaToolsGroupOption,
  meta?: { context?: string }
) {
  if (meta?.context !== "menu") return option.label;

  const hint = option.hint ? (
    NS.showFlags && option.hint.flag ? (
      <Flag
        flag={option.hint.flag}
        className="manga-tools-flag manga-tools-hint"
      />
    ) : (
      <span className="manga-tools-hint-text">{option.hint.name}</span>
    )
  ) : null;

  if (!option.createLabel) {
    // Plain names get the hint, and nothing else. Deliberately not the shared
    // `.manga-tools-option`: that one spaces an icon off its label, and spreading
    // its children apart here would push this row's name and hint to opposite
    // ends of a menu the other two dropdowns also draw.
    if (!hint) return option.label;
    return (
      <span className="manga-tools-group-option">
        <span>{option.label}</span>
        {hint}
      </span>
    );
  }

  return <span className="manga-tools-option">{option.createLabel}</span>;
}

/**
 * Copies the class names for each layer off the studio field's DOM.
 *
 * Column widths are deliberately not hard-coded: renderField's defaults differ
 * between Stash versions — develop uses { sm: 3, xl: 2 } while the build
 * actually running only had { sm: 3 }. The extra col-xl-2 made our label
 * column narrower than the native ones on wide screens, so nothing lined up.
 * Copying the class names that are already there is correct regardless of
 * version or breakpoint.
 *
 * Returns null when nothing can be read, and the caller falls back to a
 * conservative default.
 */
function readNativeFieldClasses(
  anchor: Element | null
): NativeFieldClasses | null {
  if (!anchor) return null;

  const label = anchor.querySelector("label");
  const control = label?.nextElementSibling;
  if (!label || !control) return null;

  return {
    group: anchor.className,
    label: label.className,
    control: control.className,
  };
}

/**
 * The edit page's language field, rendered through a portal into the row
 * **right after the studio field**.
 *
 * Why an always-present field rather than replacing the existing language
 * input row: CustomFieldsInput only renders input rows for fields that already
 * exist, and a new gallery has no language row to replace. Typing the field
 * name and code by hand for every gallery would defeat the point of the
 * dropdown. The existing language row is suppressed by the CustomFieldInput
 * patch below, so there is never a duplicate.
 *
 * The structure mirrors Stash's renderField (utils/form.tsx) — see
 * readNativeFieldClasses for how the column widths are matched.
 */
function MangaFieldBlock(props: {
  values?: CustomFieldsMap;
  onChange?: (values: CustomFieldsMap) => void;
}) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const state = React.useState(NS.openEditBlock);
  const open = state[0];
  const setOpen = state[1];
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;

  // The mount point is read during render (same approach as the detail page).
  // ensureFieldHost is idempotent and returns null when the anchor is absent.
  const host = isGalleryContext() ? ensureFieldHost() : null;

  // A manga gallery rarely has performers, so the row Stash draws for them steps
  // aside when the setting asks it to — see .hide-performers in mangaTools.css.
  // Hidden rather than not rendered, because the row is Stash's: its value stays
  // in Stash's form, so a gallery that does have performers keeps them on save,
  // and nothing here can lose data. The class goes on this plugin's own node,
  // which React does not manage, so a re-render of Stash's form cannot undo it.
  //
  // Asked together with whether any field is drawn, because the two are the same
  // question: with all four fields turned off this block does not exist, and a page
  // the plugin draws nothing on is a page whose fields it should not be hiding
  // either. The setting itself is not forgotten — it is read again the moment one
  // field is back on.
  if (host) {
    host.classList.toggle(
      "hide-performers",
      NS.hidePerformers && NS.anyFieldShowing()
    );
  }

  const bump = React.useState(0)[1];

  // On first mount the studio row **has not been committed to the DOM yet**:
  // CustomFieldsInput sits at the very end of the edit form, so when it renders
  // React has only just built the elements and has not written them out. This
  // pass therefore cannot find the anchor. The effect runs after the commit,
  // when it can, and one extra render is all it takes.
  //
  // It only bumps when the mount point differs from the one used for this
  // render, so once things settle the condition is never true again and there
  // is no render loop.
  // A layout effect, so the extra pass is flushed after React writes the DOM but
  // before the browser paints, and this correction adds no visible step of its
  // own.
  React.useLayoutEffect(() => {
    if (isGalleryContext() && ensureFieldHost() !== host) {
      bump((v) => v + 1);
    }
  });

  // No fields drawn means no block. An empty fold whose heading opens onto nothing
  // is worse than no fold at all, and the edit page is then Stash's own — which is
  // exactly what a reader who turned all four off asked for.
  if (!isGalleryContext() || !Select || !host || !NS.anyFieldShowing()) {
    return null;
  }

  // One writer for both rows: Stash's form owns the values map, so each row
  // hands it a new map rather than writing anything itself. That is what makes
  // Save persist the language and the mark together, and Cancel discard both.
  const write = (name: string, value: string) => {
    if (props.onChange) {
      props.onChange(NS.setField(props.values, name, value));
    }
  };

  // Writing a group is two edits in one, and they have to leave in one onChange:
  // declaring a group ends "this is the original", which is the other answer to
  // the same question. Two calls to write would each be computed from the props
  // the other has just made stale, so the map is folded once and handed over.
  const writeGroup = (value: string) => {
    let next = NS.setField(props.values, TRANSLATION_GROUP_FIELD_NAME, value);
    if (value) next = NS.setField(next, ORIGINAL_FIELD_NAME, "");
    if (props.onChange) props.onChange(next);
  };

  // The other answer, declared rather than picked from the menu — see
  // ORIGINAL_FIELD_NAME for why it is not a value of the group field. Toggling it
  // on clears whatever group was set, for the same reason writing a group clears
  // it: a gallery holding both has answered one question twice.
  //
  // What it takes away it holds on to, because a button that destroys a name
  // somebody typed is a button that gets destroyed by a mis-click — see
  // originalGroupTaken for why it is held outside the gallery rather than in it.
  const isOriginal = NS.isOriginal(props.values);
  const toggleOriginal = () => {
    const galleryId = currentGalleryId();
    let next = props.values;

    if (isOriginal) {
      // Put the name back, if this is the gallery it was taken from — and drop it
      // either way, so a mark that found nothing to take does not restore
      // something else's.
      const taken = originalGroupTaken;
      originalGroupTaken = null;
      next = NS.setField(next, ORIGINAL_FIELD_NAME, "");
      if (taken && taken.galleryId === galleryId && taken.group) {
        next = NS.setField(next, TRANSLATION_GROUP_FIELD_NAME, taken.group);
      }
    } else {
      const group = NS.translationGroupOf(props.values);
      originalGroupTaken = group
        ? { galleryId: galleryId, group: group }
        : null;
      next = NS.setField(next, ORIGINAL_FIELD_NAME, NS.ORIGINAL_VALUE);
      next = NS.setField(next, TRANSLATION_GROUP_FIELD_NAME, "");
    }

    if (props.onChange) props.onChange(next);
  };

  // Whether this click would put a name back, which the tooltip says — the undo is
  // worth having, and worth being visible rather than a surprise.
  const restoresGroup =
    !!originalGroupTaken &&
    originalGroupTaken.galleryId === currentGalleryId() &&
    !!originalGroupTaken.group;

  const current = NS.describe(pickLanguage(props.values), intl.locale);
  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => {
      // NS.enabledLanguages is null for "no restriction", otherwise the
      // dropdown is limited to exactly these codes. Display (badge / detail
      // row) is not affected — it always uses the full table via describe().
      return !NS.enabledLanguages || NS.enabledLanguages.has(o.value);
    }
  );

  // Keep an unrecognised current value in the list, otherwise picking
  // something else would make it unreachable.
  if (current && !current.known) {
    // Spread rather than concat: concat infers the literal's `flag: null` as a
    // literal type, which then fails to match MangaToolsOption's `string | null`.
    options = [
      { value: current.code, label: current.name, flag: null },
      ...options,
    ];
  }

  const selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  // The language every group's galleries usually carry, in one walk of the store
  // — the group menu below has two dozen names to ask about, and asking per name
  // would walk a few thousand galleries two dozen times, once per keystroke in the
  // field. What it can and cannot answer is NS.usualLanguagesOf's business.
  //
  // Read here rather than beside the group row below because the language row,
  // which is drawn first, is where the button goes. The group name is
  // NS.translationGroupOf's either way, not a second opinion about the field.
  const usualLanguages = NS.usualLanguagesOf(store);
  const usual =
    usualLanguages[NS.groupKey(NS.translationGroupOf(props.values))];

  // What the rule cannot know, and this row can:
  //
  //   enabledLanguages  the dropdown offers only the reader's enabled languages,
  //                     so a button offering another would write a value this
  //                     field's own menu could not then show
  //   already equal     writing what is already there is furniture. `current` is
  //                     the described value, so this compares languages rather
  //                     than strings — the field tolerates any case
  const offered =
    usual &&
    (!NS.enabledLanguages || NS.enabledLanguages.has(usual.code)) &&
    (!current || current.code !== usual.code)
      ? usual
      : null;
  const offeredInfo = offered ? NS.describe(offered.code, intl.locale) : null;

  // Stash's own furniture for a small button that belongs to the field beside it:
  // the same secondary button the date field carries, with one glyph as its whole
  // content — no name, because the field next to it already names what the button
  // writes, and a second label would be the same word twice.
  //
  // The glyph follows the "Show flags" setting, which says the reader does not
  // want flags in their interface — and this button is part of the interface, not
  // a value. A wand stands in: this is a suggestion. The language's name would be
  // the other honest choice and the wrong one, long enough to squeeze the field it
  // shares its column with, and saying what that field already says.
  //
  // Same shape as the ✗ in dialog-filter.tsx and for the same reason: the name
  // differs between FontAwesome versions, and `Icon` throws *inside a render* on an
  // undefined icon, which would take the page rather than the glyph. So the chain
  // has two spellings of the wand, then a different glyph that is still true of
  // what the button writes, and only then the name — which always exists, and is
  // the one thing a missing icon may not turn into an empty button.
  //
  // type="button" is not decoration: it sits inside Stash's own <form>, where a
  // button without one submits the form and takes the unsaved edits with it.
  const chipIcon =
    Solid.faWandMagicSparkles || Solid.faMagic || Solid.faLanguage || null;
  const chipTitle =
    offered && offeredInfo
      ? t(intl, "mangaTools.translationGroup.fill") +
        " " +
        offeredInfo.name +
        " — " +
        t(intl, "mangaTools.translationGroup.suggestedLanguage") +
        " (" +
        offered.count +
        ")"
      : "";
  const languageChip =
    offered && offeredInfo ? (
      <button
        type="button"
        className="btn btn-secondary manga-tools-chip"
        aria-label={chipTitle}
        title={chipTitle}
        onClick={() => write(FIELD_NAME, offered.code)}
      >
        {NS.showFlags && offeredInfo.flag ? (
          <Flag flag={offeredInfo.flag} className="manga-tools-flag" />
        ) : chipIcon ? (
          <Icon icon={chipIcon} />
        ) : (
          <span>{offeredInfo.name}</span>
        )}
      </button>
    ) : null;

  // Column widths come from the native field; this is the fallback.
  const cls = readNativeFieldClasses(document.querySelector(EDIT_ANCHOR)) || {
    group: "form-group row",
    label: "form-label col-form-label col-sm-3",
    control: "col-sm-9",
  };

  const languageField = (
    // Plain div/label carrying the copied class names, rather than
    // Form.Group/Form.Label/Col: those components regenerate the width classes
    // from their own defaults, which is what broke the alignment before.
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div
        className={cls.control + (languageChip ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          placeholder={t(intl, "mangaTools.select.placeholder")}
          value={selected}
          options={options}
          // react-select draws a vertical rule between the clear and expand
          // icons by default, and none of Stash's own dropdowns have it — its
          // Select.tsx sets components: { IndicatorSeparator: () => null } in
          // its default props, and CountrySelect and FilterSelect each strip it
          // too. Follow suit, so this field wears the same furniture as the row
          // above it and the one below.
          components={{ IndicatorSeparator: () => null }}
          // Flags are drawn with CSS and cannot live inside a plain-text label,
          // so the option has to be rendered here.
          formatOptionLabel={formatLanguageOption}
          // An empty value deletes the field, matching the native
          // onChange("", "") semantics.
          onChange={(opt: MangaToolsOption | null) => {
            write(FIELD_NAME, opt ? opt.value : "");
          }}
        />
        {languageChip}
      </div>
    </div>
  );

  // The mark, as a two-option selector rather than the cycle the toolbar used to
  // carry. Two options and a clear button cover the three states exactly, and the
  // reason the old control needed a third icon — "not marked" — was that a cycle
  // has to name every state it can reach. A selector does not: not marked *is*
  // nothing selected.
  const mark = censorshipOf(props.values);
  const markOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];
  const markSelected = markOptions.find((o) => o.value === mark) || null;

  const markField = (
    <div className={cls.group} data-field="manga_tools_censorship">
      <label className={cls.label} htmlFor="manga_tools_censorship">
        {t(intl, "mangaTools.censorship.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_censorship"
          isClearable
          isSearchable={false}
          // The placeholder is the third state's name, so it reads the same as
          // the row in the details block: 未标注 rather than an empty box.
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={markSelected}
          options={markOptions}
          components={{ IndicatorSeparator: () => null }}
          // The same treatment the language options get: an icon cannot live
          // inside a plain-text label, so the option is drawn here.
          formatOptionLabel={formatCensorshipOption}
          onChange={(opt: { value: string } | null) => {
            write(CENSORSHIP_FIELD_NAME, opt ? opt.value : "");
          }}
        />
      </div>
    </div>
  );

  // The translation group, wearing the same Select as the two fields above it —
  // which is a costume, because react-select cannot be typed into. What makes it
  // work is that **the text in the box is the field's value**: every keystroke is
  // written to the map as it is typed, exactly as the plain text box did, and the
  // menu is then built from the value rather than from any state of react-select's.
  //
  // That is what keeps it honest. react-select is a control for choosing from a
  // list, and the usual way to make it accept new text is to keep the search text
  // in state, offer it as an extra option, and hope the reader selects it — where
  // typing and then leaving throws the text away. Here there is nothing to throw
  // away: the value is already saved, and the "create" entry is a way of saying
  // "this text, yes" rather than the only way of keeping it.
  //
  // Two of react-select's behaviours have to be worked with rather than around,
  // and both are visible in its source (Select.js, "renderPlaceholderOrValue" and
  // "setValue"):
  //
  //   - The value area draws **nothing** while the input has text in it, because
  //     the input is then assumed to be showing that text; and choosing an option
  //     hides the input (`opacity: 0`) for a single select. So `inputValue` is left
  //     to react-select: it holds what is being typed, the box shows that while
  //     typing and the chosen name as plain text afterwards, and the field ends up
  //     behaving exactly like the two above it. Controlling `inputValue` to the
  //     value instead blanks the box — text hidden and no label drawn.
  //   - `onInputChange` fires for reasons other than typing — selecting, closing
  //     the menu — and its text is then the option's label or nothing at all.
  //     Taking it would put the search text back over the value just chosen, or
  //     clear the field as the menu closed. Only "input-change" is written.
  const groupRaw = NS.pickField(props.values, TRANSLATION_GROUP_FIELD_NAME);
  const groupName = NS.translationGroupOf(props.values);

  const known = knownTranslationGroups();
  // Offered only when the text is not a group this Stash knows: otherwise the menu
  // would spell the same name twice, in whatever case it was typed.
  const namesANewGroup =
    !!groupName &&
    !known.some((name) => NS.sameTranslationGroup(name, groupName));

  // The groups whose usual language is this gallery's come first, and the rest
  // keep their name order behind them. Sorted rather than filtered: the others are
  // still what a reader picks when this gallery is the exception, and hiding them
  // would make the menu lie about what the library holds.
  //
  // Nothing moves until the language is set — with no language there is nothing to
  // match against, and a list that reordered itself for no visible reason would be
  // worse than one that did not.
  const usualOf = (name: string) => usualLanguages[NS.groupKey(name)];
  const matchesNow = (name: string) => {
    const usualHere = usualOf(name);
    return !!current && !!usualHere && usualHere.code === current.code;
  };
  const ordered = known
    .filter(matchesNow)
    .concat(known.filter((name) => !matchesNow(name)));

  const groupOptions: MangaToolsGroupOption[] = [
    ...(namesANewGroup
      ? [
          {
            value: groupName,
            label: groupName,
            // Composed here rather than in formatGroupOption, which runs inside
            // react-select's render and cannot use a hook. Quoted, because the
            // name is a name and reading "Create Lily Manga" makes the offer look
            // like the answer.
            createLabel:
              t(intl, "mangaTools.translationGroup.create") +
              ' "' +
              groupName +
              '"',
          },
        ]
      : []),
    ...ordered.map((name) => {
      const usualHere = usualOf(name);
      // Both forms are built here because this is where the reader's `intl` is:
      // formatGroupOption runs inside react-select's render and cannot use a hook,
      // which is also why the create entry's wording is composed up here.
      const described = usualHere
        ? NS.describe(usualHere.code, intl.locale)
        : null;
      const hint = described
        ? { flag: described.flag, name: described.name }
        : null;
      return { value: name, label: name, hint: hint };
    }),
  ];

  // The other answer to "who translated this", as a pressed-state button beside
  // the field it belongs to — always drawn, because a control that vanishes when
  // it is on is a control nobody can turn off.
  //
  // It draws a steak rather than a word: 熟肉 by default, 生肉 once the gallery is
  // declared the original. A picture of the state rather than its name is the point
  // — 生肉/熟肉 is a piece of slang, and one that only reads in one language.
  //
  // `manga-tools-chip` is the same hook the language row's button carries: it is
  // what the stylesheet stretches to the field's height. `active` is Bootstrap's
  // own pressed look, so the state needs no styling of its own beyond the shape.
  // aria-pressed is what says "toggle" to a screen reader, and the name and tooltip
  // are where the words go, since the button has none of its own.
  // The two fields the row below is built from, asked once. Raw and the
  // translation group are two answers to one question, which is why the chip that
  // declares one of them rides on the other's row rather than having a row of its
  // own — and that is only true while both are drawn. With the group turned off,
  // raw is a field like any other and gets what every other field on this form
  // has: a switch, on a row of its own.
  const showGroup = NS.fieldShowing("translationGroup");
  const showOriginal = NS.fieldShowing("original");

  // Whether the *group row* is disabled by the raw mark, which is a different
  // question from whether the gallery is raw: with the raw field turned off there is
  // no switch anywhere to turn it back on, and a box greyed out with no way out of
  // it is worse than one the reader can type into. The value itself is untouched
  // either way — it simply stops steering a row it no longer belongs to.
  const rawShown = showOriginal && isOriginal;

  const originalLabel = t(intl, "mangaTools.translationGroup.original");
  const originalChip = (
    <button
      type="button"
      className={
        "btn btn-secondary manga-tools-chip manga-tools-original" +
        (isOriginal ? " active" : "")
      }
      aria-pressed={isOriginal}
      aria-label={originalLabel}
      title={t(
        intl,
        isOriginal
          ? restoresGroup
            ? "mangaTools.translationGroup.originalOffRestore"
            : "mangaTools.translationGroup.originalOff"
          : "mangaTools.translationGroup.originalOn"
      )}
      onClick={toggleOriginal}
    >
      <SteakIcon raw={isOriginal} />
    </button>
  );

  // Raw on its own, for the one arrangement where the chip above has no row to sit
  // on. It is the same control every other field of this plugin has on Stash's edit
  // page — a switch in the control column, with the label in the column the two
  // selects beside it use — because on its own it *is* just another boolean field,
  // and the chip was only ever there to say "this is the other answer to the
  // question the box next to it asks".
  //
  // Markup rather than react-bootstrap's Form.Check, like the rows around it: the
  // classes are Bootstrap's own switch (`form-check form-switch` + a checkbox with
  // `role="switch"`), which is exactly what Form.Check with type="switch" renders.
  const originalRow = (
    <div className={cls.group} data-field="manga_tools_original">
      <label className={cls.label} htmlFor="manga_tools_original">
        {originalLabel}
      </label>
      <div className={cls.control}>
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            role="switch"
            id="manga_tools_original"
            checked={isOriginal}
            onChange={toggleOriginal}
          />
        </div>
      </div>
    </div>
  );

  const groupField = (
    <div className={cls.group} data-field="manga_tools_translation_group">
      <label className={cls.label} htmlFor="manga_tools_translation_group">
        {t(intl, "mangaTools.translationGroup.heading")}
      </label>
      <div
        className={cls.control + (showOriginal ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select manga-tools-group-select"
          classNamePrefix="react-select"
          inputId="manga_tools_translation_group"
          isClearable
          // Disabled while the gallery is the original, because there is no group
          // to enter and a live box would invite one. This is not the same state as
          // an empty field: empty means "nobody has said", and raw means "not
          // applicable" — so the box says which one it is rather than looking
          // unfilled.
          //
          // The field keeps its shape: the control stays where it is, greyed, and
          // the button beside it is what turns this back on. Replacing the box with
          // a line of text would say the same thing and leave the row a different
          // shape from the two above it, which is the property the column widths
          // here took the most work to get right.
          isDisabled={rawShown}
          placeholder={t(
            intl,
            rawShown
              ? "mangaTools.translationGroup.originalDetail"
              : "mangaTools.translationGroup.placeholder"
          )}
          value={groupRaw ? { value: groupRaw, label: groupName } : null}
          options={groupOptions}
          formatOptionLabel={formatGroupOption}
          // react-select draws a vertical rule between the clear button and the
          // arrow, and none of Stash's own dropdowns have it — its Select.tsx sets
          // this in its default props and strips it too. Follow suit, so this field
          // has the same furniture as the two above it.
          components={{ IndicatorSeparator: () => null }}
          // What is in the menu is the groups that exist *now*, and a save is the
          // moment that changes — the value just written becomes one of them, and
          // a name that was only ever used by this gallery stops being one. This
          // plugin's store is otherwise only refetched on a timer (a minute), so
          // without this the menu goes on offering to create the name the gallery
          // already carries.
          onMenuOpen={() => refreshForSuggestions()}
          onInputChange={(text: string, meta: { action?: string }) => {
            if (meta?.action !== "input-change") return;
            // A box holding only spaces means nothing, and nothing removes the
            // key rather than storing whitespace that reads as empty everywhere
            // else.
            writeGroup(text.trim() ? text : "");
          }}
          onChange={(opt: MangaToolsGroupOption | null) => {
            // A group picked from the list is written in *its* spelling, which is
            // how a name typed in another case is put right; the create entry
            // carries the text back unchanged.
            writeGroup(opt ? opt.value : "");
          }}
        />
        {showOriginal ? originalChip : null}
      </div>
    </div>
  );

  // The field row is not wrapped in the disclosure, it is *shown or not shown* by
  // it, and that is deliberate: wrapping it would put a box between the row and
  // the padded column its negative margins cancel against, which is the whole
  // reason the mount point above is `display: contents`. Folding this way costs
  // the height animation — the fold is instant — and keeps the columns lined up
  // with the native fields, which is the property that took the work.
  //
  // The header does need a row of its own, or it would sit outside the form's
  // column grid; it borrows the same column classes as the rows around it.
  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      <div className={cls.group}>
        <div className="col-12">
          <div className="collapse-header">
            {Button ? (
              <Button
                className="minimal collapse-button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <Icon
                  icon={open ? Solid.faChevronDown : Solid.faChevronRight}
                  fixedWidth
                />
                <span>{t(intl, "mangaTools.panel.heading")}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {open && NS.fieldShowing("censorship") ? markField : null}
      {open && NS.fieldShowing("language") ? languageField : null}
      {open && showGroup ? groupField : null}
      {/* Raw, as a row of its own, only where the group's row is not there to
          carry the chip. With both drawn the chip above is the whole of it, and
          with the field turned off there is nothing to draw. */}
      {open && showOriginal && !showGroup ? originalRow : null}
    </div>,
    host
  );
}

// ─────────────────────────── Settings page ───────────────────────────

/**
 * The plugin's settings UI, rendered in place of the stock per-setting input
 * (see the PluginSettings patch below).
 *
 * The stock UI can only render STRING/NUMBER/BOOLEAN settings one input each,
 * so "which languages are enabled" would otherwise be a comma-separated text
 * box. This renders a multiselect of flag + localised name instead, writing
 * the same comma-separated value.
 *
 * It reads NS.enabledLanguages (kept fresh by refreshSettings) and writes it
 * back through configurePlugin, which replaces the plugin's whole settings
 * map — with a single setting, that map is just { enabledLanguages }.
 */
/**
 * One on/off setting, laid out exactly like Stash's own BooleanSetting
 * (Settings/Inputs.tsx): a `.setting` row with the heading on the left and the
 * switch pushed to the right by Stash's own CSS.
 */
/**
 * A remark inside a setting's description — the one place this page says "not
 * here": the lightbox's own settings are changed on the lightbox.
 *
 * It is part of the description rather than a row of its own, because it is one
 * of the two things that sentence is saying, and it is boxed and tinted rather
 * than written in the same grey, because a line of grey prose under a longer line
 * of grey prose is a line nobody reads. The tint is the plugin's own; Stash's
 * settings page has no callout of its own to copy.
 *
 * The icon is decorative, so when the library has no glyph for it the box is drawn
 * without one rather than with a stand-in letter — unlike the "?" that opens a help
 * panel, where the glyph *is* the affordance.
 */
function SettingsNote(props: { children: ReactNode }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const icon = Solid.faInfoCircle || null;

  return (
    <span className="manga-tools-settings-note">
      {icon ? <Icon icon={icon} /> : null}
      <span>{props.children}</span>
    </span>
  );
}

/** Which part of the example card a setting's help panel is about */
type HelpExample = "badge" | "mark";

/**
 * The example a help panel holds: a gallery card, drawn with Stash's own markup
 * and class names so that Stash's stylesheet draws it.
 *
 * That is the whole point of it. "封面右下角那个徽章" is a sentence that has to
 * be believed; a card drawn with the plugin's own classes would be *the plugin's
 * idea of* where the badge goes, and would keep saying so after Stash moved it.
 * With `.gallery-card`, `.gallery-card-cover`, `.gallery-card-image`,
 * `.card-popovers` and the rest — every one of them a class Stash defines, and
 * `.gallery-card-image`'s height coming from the `zoom-N` class rather than from
 * anything here — the example is a card with the cover taken out.
 *
 * Three things are deliberately not Stash's:
 *
 *   the links  the cover and the title are links to a gallery on the list; here
 *              they are spans, because there is nowhere to go. Stash's rules for
 *              them are colour and text-decoration, and the title keeps both
 *              (`.card-section-title` sets its own colour).
 *   the image  there is no gallery behind this, so the cover is a div wearing
 *              `.gallery-card-image` and a caption instead of an img with a src.
 *   the badge and the mark  these are the plugin's own, and they are drawn by the
 *              code that draws them on a real card.
 *
 * The words — the caption, the title, the description — come from the message
 * catalogues, and the language on the badge is described by NS.describe in the
 * reader's locale. Nothing here is a Chinese string in an English UI.
 *
 * `aria-hidden` because it is a picture: the setting's own description says in
 * words what this says by showing it, and the "?" that opens it is named from
 * the same catalogue entry.
 */
/**
 * The language-table code for a Stash UI locale, or "" when the table has none.
 *
 * The two are not the same vocabulary. Stash's locales name a region — `zh-CN`,
 * `en-US`, `ja-JP` — and the language table holds canonical *language* codes:
 * `zh-Hans`, `en`, `ja`. So asking the table about `zh-CN` on its own gets
 * nothing, which drew an English flag in a Simplified Chinese UI.
 *
 * Dropping subtags is the right tolerance *here* and the wrong one for a stored
 * value: languages.ts maps no aliases on purpose, so that a value this plugin did
 * not write shows up as unrecognised rather than being quietly rewritten. Nothing
 * is stored in this direction — this is the example looking for a language the
 * reader will recognise, and a reader on `zh-CN` is a reader of Simplified
 * Chinese.
 *
 * Which is what the last step is for: `zh` is neither a table code nor a script
 * in the standard, so the script comes from the region. Traditional for the three
 * places that write it, Simplified everywhere else — and `zh-Hant-HK` never
 * reaches it, having already matched `zh-Hant` on the way down.
 */
function sampleLanguageCode(uiLocale: string): string {
  const parts = String(uiLocale || "").split(/[-_]/);

  for (let n = parts.length; n > 0; n--) {
    const canonical = NS.findCanonical(parts.slice(0, n).join("-"));
    if (canonical) return canonical;
  }

  if ((parts[0] || "").toLowerCase() === "zh") {
    const region = (parts[1] || "").toUpperCase();
    return region === "TW" || region === "HK" || region === "MO"
      ? "zh-Hant"
      : "zh-Hans";
  }

  return "";
}

function HelpExampleCard(props: { highlight: HelpExample }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  // The sample gallery is the reader's own language when the language table has
  // it — a flag and a name they recognise rather than a stranger's — and English
  // when it does not. `known` is the whole point of the check: an unknown value
  // describes itself as the raw code, so a UI in a language this plugin has no
  // entry for would draw its badge as `de-DE`, which is the chip for *bad data*.
  const locale = intl.locale;
  const code = sampleLanguageCode(locale);
  const sample =
    (code ? NS.describe(code, locale) : null) ||
    NS.describe("en", locale) ||
    undefined;

  // The badge and the mark are ringed, not spotlit: the card around them stays
  // readable, and "which of these two is it" is the question the panel answers.
  // No `position` in this: the badge is absolutely positioned in the cover's
  // corner, and saying otherwise would drop it into the flow.
  const lit = (which: HelpExample) =>
    props.highlight === which ? " manga-tools-help-lit" : "";

  // The counting buttons, with the box Stash wraps them in. `tabIndex={-1}`
  // because these are a picture of a row of buttons: they are inside an
  // `aria-hidden` box, and something focusable in there is a tab stop that leads
  // nowhere.
  const count = (cls: string, icon: unknown, n: number) => (
    <span className={cls}>
      <button type="button" tabIndex={-1} className="minimal btn btn-primary">
        {icon ? <Icon icon={icon} /> : null}
        <span>{n}</span>
      </button>
    </span>
  );

  return (
    <div className="manga-tools-help-card" aria-hidden="true">
      {/* The zoom class still gives the cover its height — that is Stash's own
          `zoom-1`, 240px — and the width is that same number, so the cover is
          square and the card is not stretched by a portrait one. The list's own
          zoom-1 card is wider than this (340) and therefore wider than it is
          tall; the example is deliberately the compact version of the same card,
          at the same cover height. */}
      <div
        className="gallery-card card grid-card zoom-1"
        style={{ width: 240 }}
      >
        <div className="thumbnail-section">
          <span className="gallery-card-header">
            <div className="gallery-card-cover">
              <div className="gallery-card-image manga-tools-help-cover">
                {t(intl, "mangaTools.settings.help.cover")}
              </div>
            </div>
          </span>
          {sample ? languageChip(sample, lit("badge").trim()) : null}
        </div>
        <div className="card-section">
          <h5 className="card-section-title flex-aligned">
            <div className="TruncatedText" style={{ WebkitLineClamp: 2 }}>
              {t(intl, "mangaTools.settings.help.card.title")}
            </div>
          </h5>
          {/* The date alone: a card whose gallery has no description draws
              exactly this, so leaving it out is not leaving anything out. */}
          <div className="gallery-card__details">
            <span className="gallery-card__date">
              {t(intl, "mangaTools.settings.help.card.date")}
            </span>
          </div>
        </div>
        <hr />
        <div role="group" className="card-popovers btn-group">
          {count("image-count", Solid.faImage || null, 32)}
          {count("tag-count", Solid.faTag || null, 11)}
          <span className={"manga-tools-popover-slot" + lit("mark")}>
            <button
              type="button"
              tabIndex={-1}
              className="minimal btn btn-primary manga-tools-mark"
            >
              <MangaIcon />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * A "?" beside a setting's heading, holding an example of what the setting is
 * about.
 *
 * The panel is opened by CSS — hover, or focus for a keyboard and a finger — so
 * nothing here is stateful: the question mark is a real <button> so that it can
 * be tabbed to and tapped, and everything else is in the stylesheet. That is
 * also what makes it testable, since the smoke tests' React stub has state
 * setters that do nothing.
 *
 * The wording is not gone, it is off the screen: it is the button's own name,
 * read out to anyone who cannot see the picture. The icon gets a wrapping
 * <button aria-label> rather than a title on the glyph, because Icon spreads what
 * it is given onto an <svg> and a title on an SVG is shown by some browsers and
 * not others. With no glyph to draw the "?" is written as text, so the panel is
 * never unreachable — the same reasoning as the wand button in MangaFieldBlock.
 */
function HelpIcon(props: { text: string; example: HelpExample }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const icon = Solid.faQuestionCircle || null;

  return (
    <span className="manga-tools-help">
      <button
        type="button"
        className="manga-tools-help-button"
        aria-label={props.text}
      >
        {icon ? <Icon icon={icon} /> : "?"}
      </button>
      <span className="manga-tools-help-panel">
        <HelpExampleCard highlight={props.example} />
      </span>
    </span>
  );
}

function BooleanSetting(props: {
  id: string;
  heading: string;
  /** The description — a string, or a string with a note set off inside it */
  subHeading?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * The "?" beside the heading: the wording it is named by, and which part of the
   * example card it opens. One prop rather than two, so that a help icon cannot
   * be drawn with nothing to show.
   */
  help?: { text: string; example: HelpExample };
  /**
   * Set when this row opens a group the reader can fold — see FoldIcon. Absent
   * for a row with nothing under it, which is what keeps the chevron off.
   */
  fold?: { folded: boolean; onToggle: () => void };
  /**
   * Set by SettingSwitch for every row it draws: this one is a section of the page
   * rather than one of a group's rows, which is what the stylesheet reads to decide
   * where a line goes (see mangaTools.css). A row that has no rows under it — the
   * lightbox and the chapters tab, since their notes moved into their descriptions —
   * is still a section.
   */
  head?: boolean;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot render the settings switches"
    );
    return null;
  }

  // A plain string when nothing hangs off it — see the note on the h3 below.
  const heading = props.help ? (
    <>
      {props.heading}
      <HelpIcon text={props.help.text} example={props.help.example} />
    </>
  ) : (
    props.heading
  );

  return (
    // `manga-tools-setting` is what the stylesheet needs to undo Stash's
    // `flex-wrap: wrap` on a plugin's rows, which puts a switch with a long
    // sub-heading on a line of its own — see the rule in mangaTools.css.
    <div
      className={
        "setting manga-tools-setting" +
        (props.head ? " manga-tools-setting-head" : "")
      }
    >
      {/* The heading and its description are one click target while there is a
          group to fold: the chevron alone is a small thing to hit, and clicking a
          heading to fold what is under it is what everyone tries. The switch's own
          column is a separate element, so it does not take part. */}
      <div
        className={props.fold ? "manga-tools-foldable" : undefined}
        onClick={props.fold ? props.fold.onToggle : undefined}
      >
        {/* The heading is a plain string when nothing hangs off it — a heading that
            is an array with a null in it is a different shape to every other one on
            the page, and to anything reading the text of one. */}
        {/* The chevron and the heading share a row of their own, and that row is what
            the chevron is positioned against — so it is centred on the heading's
            line and not on the box around it, which also holds the description. It is
            not inside the h3: that would make the heading an array with an element in
            front of the text, and a third shape for anything reading one. */}
        {props.fold ? (
          <div className="manga-tools-heading-line">
            <FoldIcon
              folded={props.fold.folded}
              onToggle={props.fold.onToggle}
            />
            <h3>{heading}</h3>
          </div>
        ) : (
          <h3>{heading}</h3>
        )}
        {props.subHeading ? (
          <div className="sub-heading">{props.subHeading}</div>
        ) : null}
      </div>
      <div>
        <Bootstrap.Form.Switch
          id={props.id}
          checked={props.checked}
          onChange={() => {
            props.onChange(!props.checked);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Which groups the reader has folded shut, by the id of the row that opens them.
 *
 * View state, and nothing else: it is not a setting, it never reaches Stash's
 * configuration, and a page that starts folded would be hiding settings that are
 * on. It lives out here rather than in React's state for the reason the settings
 * themselves do — this page is redrawn from `emit()` on every switch, and the
 * smoke tests' React stub has no working state setter, so anything held inside a
 * component would be either lost or untestable. `NS.*` is the pattern; this is the
 * same pattern with a set.
 */
const foldedGroups = new Set<string>();

function setGroupFolded(id: string, folded: boolean): void {
  if (folded) foldedGroups.add(id);
  else foldedGroups.delete(id);
  emit();
}

/** The "⌄/›" a row that opens a group carries, in the gutter before its heading */
function FoldIcon(props: { folded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={"manga-tools-fold" + (props.folded ? " is-folded" : "")}
      aria-expanded={!props.folded}
      onClick={(event) => {
        // The heading beside it toggles too (clicking a heading to fold what is
        // under it is the thing everyone tries), so this one stops there.
        event.stopPropagation();
        props.onToggle();
      }}
    >
      <span className="fa-icon" />
    </button>
  );
}

/**
 * A switch and the rows that only mean anything under it.
 *
 * The rows are *rendered* only while the switch is on — what a reader has not
 * turned on is not on the page — and that is deliberately the only thing the
 * switch does to them. Nothing here writes their values: a feature turned off and
 * on again comes back with the settings it had, which is the same promise the four
 * field switches make about the field values.
 *
 * They go in Stash's own `.setting-group`, which is the class whose styling makes
 * a row read as belonging to the one above it rather than as more of the page.
 * That is also why the rows that are *not* one thing's sub-settings — the mark's
 * three, the display rows — are not wrapped: they are siblings, and wrapping them
 * would say they were children.
 *
 * The chevron beside the heading is the reader's own fold, and it is only drawn
 * when there is something under the row to fold — a row whose rows are missing
 * because the feature is off has no chevron, so there is never a chevron that
 * opens nothing. Folding is not the switch: the switch says whether the plugin
 * does the thing, the chevron says whether you are looking at it.
 */
function SettingSwitch(props: {
  id: string;
  heading: string;
  subHeading?: ReactNode;
  help?: { text: string; example: HelpExample };
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The rows under it, drawn only while `checked` */
  children?: ReactNode;
}) {
  const rows = props.checked && props.children ? props.children : null;
  const folded = foldedGroups.has(props.id);
  const fold = rows
    ? { folded, onToggle: () => setGroupFolded(props.id, !folded) }
    : undefined;

  return (
    <>
      <BooleanSetting
        id={props.id}
        heading={props.heading}
        subHeading={props.subHeading}
        help={props.help}
        checked={props.checked}
        onChange={props.onChange}
        head
        fold={fold}
      />
      {rows && !folded ? (
        <div className="setting-group manga-tools-settings-group">{rows}</div>
      ) : null}
    </>
  );
}

/**
 * A heading that groups the rows under it without being a setting itself: the mark's
 * behaviour, and how the manga blocks are shown. Its rows are not one thing's
 * sub-settings — they are siblings, and there is no switch to own them — so the
 * heading is all there is to click, and the chevron is the only control it carries.
 *
 * The rows go in a plain wrapper rather than in Stash's `.setting-group`, and that
 * matters twice over. `.setting-group > .setting:not(:first-child)` would indent the
 * second row on and leave the first one out; and the wrapper is where the indent
 * comes from instead, as padding, so that these rows sit one level in from their
 * heading — like a group's rows do — and end at the same right edge as everything
 * else (see `.manga-tools-settings-body` in the stylesheet).
 */
function SettingsGroup(props: {
  /** Which fold this is, in `foldedGroups` — not a setting id */
  id: string;
  heading: string;
  subHeading?: string;
  children?: ReactNode;
}) {
  const folded = foldedGroups.has(props.id);

  return (
    <>
      <SettingsHeading
        heading={props.heading}
        subHeading={props.subHeading}
        fold={{
          folded,
          onToggle: () => setGroupFolded(props.id, !folded),
        }}
      />
      {folded ? null : (
        <div className="manga-tools-settings-body">{props.children}</div>
      )}
    </>
  );
}

function SettingsHeading(props: {
  heading: string;
  subHeading?: string;
  /** Set when the heading opens a group — see SettingsGroup, which is what uses it */
  fold?: { folded: boolean; onToggle: () => void };
}) {
  return (
    <div
      className={
        "manga-tools-settings-heading" +
        (props.fold ? " manga-tools-foldable" : "")
      }
      onClick={props.fold ? props.fold.onToggle : undefined}
    >
      {/* As in BooleanSetting: the chevron shares a row with the heading, and it is
          that row it is positioned against. */}
      {props.fold ? (
        <div className="manga-tools-heading-line">
          <FoldIcon folded={props.fold.folded} onToggle={props.fold.onToggle} />
          <h3>{props.heading}</h3>
        </div>
      ) : (
        <h3>{props.heading}</h3>
      )}
      {props.subHeading ? (
        <div className="sub-heading">{props.subHeading}</div>
      ) : null}
    </div>
  );
}

/** The ids `foldedGroups` holds the two headings' folds under — not setting ids */
const MARK_GROUP_ID = "mangaTools-markGroup";
const DISPLAY_GROUP_ID = "mangaTools-displayGroup";

function MangaToolsSettings() {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();

  /**
   * Writes every setting at once — see `saveSettings`, which is where the map is built
   * and which is also what the reading half's own writes go through. It is not the
   * settings *page*'s map: the reader's settings are on it too, and a page that saved
   * only its own would take them with it.
   */
  function persist() {
    saveSettings();
  }

  /**
   * What every switch on this page does: the new value into the live namespace
   * first — so the page, and every other surface reading it, redraws in the same
   * pass — and then the whole map to Stash.
   */
  function writeFlag(into: (next: boolean) => void) {
    return (next: boolean) => {
      into(next);
      emit();
      persist();
    };
  }

  const options: MangaToolsOption[] = NS.languageOptions(intl.locale);
  const enabled = NS.enabledLanguages;
  // null (no restriction) renders an empty box whose placeholder reads
  // "All languages", rather than filling the box with every tag. A non-empty
  // selection renders exactly those tags.
  const value = enabled ? options.filter((o) => enabled?.has(o.value)) : [];

  if (!Select) return null;

  // No description on a field's own switch: heading and switch is the whole of
  // what it has to say, and what turning one off does — including that the values
  // stay on the galleries — is said once, on the master switch above.
  const field = (
    id: string,
    heading: string,
    showing: () => boolean,
    set: (next: boolean) => void
  ) => (
    <BooleanSetting
      id={id}
      heading={heading}
      checked={showing()}
      onChange={writeFlag(set)}
    />
  );

  return (
    <>
      {/* ── The lightbox ─────────────────────────────────────────────────── */}
      {/* No children: where the lightbox's own settings live is not a sub-setting
          and not a row of its own — it is the second half of this row's
          description, set off as a note. See the lightbox's own note string, which
          says "not here" and would otherwise have been a line of grey prose. */}
      <SettingSwitch
        id="mangaTools-readerTakeover"
        heading={t(intl, "mangaTools.settings.readerTakeover.heading")}
        subHeading={
          <>
            {t(intl, "mangaTools.settings.readerTakeover.description")}
            <SettingsNote>
              {t(intl, "mangaTools.settings.readerTakeover.note")}
            </SettingsNote>
          </>
        }
        checked={NS.readerTakeover}
        onChange={writeFlag((next) => {
          NS.readerTakeover = next;
        })}
      />

      {/* ── The chapters tab ─────────────────────────────────────────────── */}
      {/* No children, and a boxed note inside the description — the same shape as
          the lightbox above, because it is the same kind of sentence: what this
          row is about, said in one more line. What it used to be was a row of its
          own under the switch, with `role="alert"` on it, which is a role for a
          message that appears in response to something rather than for a sentence
          that is always part of the row. */}
      <SettingSwitch
        id="mangaTools-manageChapters"
        heading={t(intl, "mangaTools.settings.manageChapters.heading")}
        subHeading={
          <>
            {t(intl, "mangaTools.settings.manageChapters.description")}
            <SettingsNote>
              {t(intl, "mangaTools.settings.manageChapters.note")}
            </SettingsNote>
          </>
        }
        checked={NS.manageChapters}
        onChange={writeFlag((next) => {
          NS.manageChapters = next;
        })}
      />

      {/* ── The four fields, and how what they hold is shown ─────────────── */}
      <SettingSwitch
        id="mangaTools-fields"
        heading={t(intl, "mangaTools.settings.fields.heading")}
        subHeading={t(intl, "mangaTools.settings.fields.description")}
        checked={NS.fields}
        onChange={writeFlag((next) => {
          NS.fields = next;
        })}
      >
        <SettingSwitch
          id="mangaTools-fieldLanguage"
          heading={fieldLabel(intl)}
          checked={NS.fieldLanguage}
          onChange={writeFlag((next) => {
            NS.fieldLanguage = next;
          })}
        >
          <div className="setting manga-tools-settings">
            <div className="manga-tools-settings-block">
              <h3>{t(intl, "mangaTools.settings.enabledLanguages.heading")}</h3>
              <div className="sub-heading">
                {t(intl, "mangaTools.settings.enabledLanguages.description")}
              </div>
              <div className="manga-tools-settings-control">
                <Select
                  className="manga-tools-settings-select"
                  classNamePrefix="react-select"
                  isMulti
                  isClearable
                  // Flip the menu above the control when there is not enough room
                  // below (the plugin is usually the last entry on the page).
                  menuPlacement="auto"
                  placeholder={t(
                    intl,
                    "mangaTools.settings.enabledLanguages.placeholder"
                  )}
                  value={value}
                  options={options}
                  formatOptionLabel={formatLanguageOption}
                  components={{ IndicatorSeparator: () => null }}
                  onChange={(selected: MangaToolsOption[] | null) => {
                    const codes = (selected || []).map((o) => o.value);

                    // Reflect the change immediately (the dropdown and this UI
                    // both read NS.enabledLanguages), then persist it.
                    NS.enabledLanguages = NS.parseEnabledLanguages(
                      NS.serializeEnabledLanguages(codes)
                    );
                    emit();
                    persist();
                  }}
                />
              </div>
            </div>
          </div>

          <BooleanSetting
            id="mangaTools-showFlags"
            heading={t(intl, "mangaTools.settings.showFlags.heading")}
            subHeading={t(intl, "mangaTools.settings.showFlags.description")}
            checked={NS.showFlags}
            onChange={writeFlag((next) => {
              NS.showFlags = next;
            })}
          />

          <BooleanSetting
            id="mangaTools-showCoverBadge"
            heading={t(intl, "mangaTools.settings.showCoverBadge.heading")}
            subHeading={t(
              intl,
              "mangaTools.settings.showCoverBadge.description"
            )}
            help={{
              text: t(intl, "mangaTools.settings.showCoverBadge.help"),
              example: "badge",
            }}
            checked={NS.showCoverBadge}
            onChange={writeFlag((next) => {
              NS.showCoverBadge = next;
            })}
          />
        </SettingSwitch>

        {field(
          "mangaTools-fieldCensorship",
          t(intl, "mangaTools.censorship.heading"),
          () => NS.fieldCensorship,
          (next) => {
            NS.fieldCensorship = next;
          }
        )}

        {field(
          "mangaTools-fieldTranslationGroup",
          t(intl, "mangaTools.translationGroup.heading"),
          () => NS.fieldTranslationGroup,
          (next) => {
            NS.fieldTranslationGroup = next;
          }
        )}

        {field(
          "mangaTools-fieldOriginal",
          t(intl, "mangaTools.translationGroup.original"),
          () => NS.fieldOriginal,
          (next) => {
            NS.fieldOriginal = next;
          }
        )}

        {/* Four rows that are not fields: they decide how the manga blocks are
            shown — and, for the last of them, what happens to a field that is off — so
            they belong to the feature rather than to any one field, and they get a
            heading instead of a switch to say so: a heading that folds, like the
            mark's, because it is the same kind of group.

            The first two have no description, which is not an oversight: the heading
            already says what the switch does ("start expanded", "start expanded"), and
            a sentence restating it was a line of grey prose under every row. The
            wording that *was* there — that this decides the state a block opens in and
            not whether it can be opened — is in the README, where a reader who wants
            to know it will look. */}
        <SettingsGroup
          id={DISPLAY_GROUP_ID}
          heading={t(intl, "mangaTools.settings.display.heading")}
        >
          <BooleanSetting
            id="mangaTools-openDetailsBlock"
            heading={t(intl, "mangaTools.settings.openDetailsBlock.heading")}
            checked={NS.openDetailsBlock}
            onChange={writeFlag((next) => {
              NS.openDetailsBlock = next;
            })}
          />
          <BooleanSetting
            id="mangaTools-openEditBlock"
            heading={t(intl, "mangaTools.settings.openEditBlock.heading")}
            checked={NS.openEditBlock}
            onChange={writeFlag((next) => {
              NS.openEditBlock = next;
            })}
          />
          <BooleanSetting
            id="mangaTools-hidePerformers"
            heading={t(intl, "mangaTools.settings.hidePerformers.heading")}
            subHeading={t(
              intl,
              "mangaTools.settings.hidePerformers.description"
            )}
            checked={NS.hidePerformers}
            onChange={writeFlag((next) => {
              NS.hidePerformers = next;
            })}
          />
          {/* The one row here whose subject is a field that is *off* — see
              showDisabledFields in plugin-api.ts, and the two patches where it decides
              whether a key is lifted out of Stash's own rows. Its note is the second
              half of that: this is about the disabled ones and nothing else. */}
          <BooleanSetting
            id="mangaTools-showDisabledFields"
            heading={t(intl, "mangaTools.settings.showDisabledFields.heading")}
            subHeading={
              <>
                {t(intl, "mangaTools.settings.showDisabledFields.description")}
                <SettingsNote>
                  {t(intl, "mangaTools.settings.showDisabledFields.note")}
                </SettingsNote>
              </>
            }
            checked={NS.showDisabledFields}
            onChange={writeFlag((next) => {
              NS.showDisabledFields = next;
            })}
          />
        </SettingsGroup>
      </SettingSwitch>

      {/* ── The mark itself ──────────────────────────────────────────────── */}
      {/* No switch: these three are not one feature, they are three answers about
          the mark, and they are deliberately siblings — the pair that is easy to
          mistake for a parent and its child especially.

          They are the one group whose fold is not drawn inside a SettingSwitch,
          because there is no switch to own it: see SettingsGroup, which owns the
          fold for this heading and for the display heading alike.

          Two of the three have no description: "ask before unmarking" and "the mark on
          a cover" are the whole of what their headings say, and the sentences that
          were under them said it again at length. Only the one that does something
          with the gallery's own values keeps a sentence — what it clears, and what it
          keeps. */}
      <SettingsGroup
        id={MARK_GROUP_ID}
        heading={t(intl, "mangaTools.settings.mark.heading")}
      >
        <BooleanSetting
          id="mangaTools-confirmUnmark"
          heading={t(intl, "mangaTools.settings.confirmUnmark.heading")}
          checked={NS.confirmUnmark}
          onChange={writeFlag((next) => {
            NS.confirmUnmark = next;
          })}
        />
        <BooleanSetting
          id="mangaTools-deleteOnUnmark"
          heading={t(intl, "mangaTools.settings.deleteOnUnmark.heading")}
          subHeading={t(intl, "mangaTools.settings.deleteOnUnmark.description")}
          checked={NS.deleteOnUnmark}
          onChange={writeFlag((next) => {
            NS.deleteOnUnmark = next;
          })}
        />
        <BooleanSetting
          id="mangaTools-coverIcon"
          heading={t(intl, "mangaTools.settings.coverIcon.heading")}
          help={{
            text: t(intl, "mangaTools.settings.coverIcon.help"),
            example: "mark",
          }}
          checked={NS.coverIcon}
          onChange={writeFlag((next) => {
            NS.coverIcon = next;
          })}
        />
      </SettingsGroup>
    </>
  );
}

// ─────────────────────────── Bulk edit dialog ───────────────────────────

/** What a bulk select is about to do to one of the two valued fields */
type BulkValuePending = { kind: "set"; value: string } | { kind: "remove" };

/**
 * What the bulk dialog is about to do to each of this plugin's fields.
 *
 * State the dialog itself does not know about, and cannot be given:
 * EditGalleriesDialog is a plain React.FC (not a PatchComponent) and keeps its
 * pending edits in its own useState, so there is no way to add a field to them.
 * The rows therefore live outside that state and their values are merged into
 * the outgoing mutation instead — see installBulkLink.
 *
 * `null` means "leave the field alone". A select's ✗ clears back to null; its
 * "remove" option is the only way to empty a field across a whole selection.
 * The two are deliberately distinct — "do not change" and "delete" are not the
 * same thing, and a bulk dialog that could only do the first would be unable to
 * strip a value Stash's own edit form can clear.
 *
 * `bulkManga` is the master. The mark is what makes a gallery the plugin's at
 * all, so the other two rows are only drawn while it is "mark"; and "unmark"
 * wins over whatever they hold, because a gallery that stops being manga also
 * stops carrying their values. See selectedMangaAggregate for the three states.
 *
 * All three are dropped once the mutation succeeds and when the dialog closes,
 * so a cancelled dialog leaves nothing behind.
 */
let bulkLanguage: BulkValuePending | null = null;
let bulkCensorship: BulkValuePending | null = null;
let bulkGroup: BulkValuePending | null = null;
let bulkManga: "mark" | "unmark" | null = null;

/**
 * The raw mark as this dialog means to write it, or null for "leave it alone".
 *
 * Not a `BulkValuePending`: an unset raw is the *absence* of the key, which is how
 * every other "no" in this plugin is spelled (the mark itself included), so there is
 * no third state to carry. It is also the one pending whose third state is not a
 * value but a *combination* — see cycleOriginal, where un-pressing hands the group
 * back.
 */
let bulkOriginal: "raw" | "notRaw" | null = null;

/**
 * What the group box was about to write when the raw mark took it away.
 *
 * The edit page keeps the same memory per gallery (`originalGroupTaken`) and puts
 * the *name* back. A dialog cannot, and the difference is worth the extra state: a
 * bulk selection may have no group at all, or may have one the reader has already
 * asked to remove — and in both of those cases "the name" is the wrong thing to
 * restore. What is restored is the pending itself, `null` included, so un-pressing
 * gives back exactly what the box was saying: a name, a removal, or nothing.
 *
 * Outer `null` means raw took nothing (the note is not there to undo); `pending:
 * null` means it took "no view", which un-pressing gives back with the box reading
 * the selection's own group again.
 */
let bulkGroupBeforeRaw: { pending: BulkValuePending | null } | null = null;

/** Ids currently selected in the gallery list, captured from GalleryList */
let selectedGalleryIds: string[] = [];

/**
 * Records which galleries are selected.
 *
 * The bulk dialog does not hand its selection to anything a plugin can patch,
 * so it is read from GalleryList instead — the one patchable component that
 * receives `selectedIds`, and the parent of all three display modes, so grid,
 * list and wall are all covered by this single hook.
 *
 * Deliberately does **not** emit(): this runs during GalleryList's render, and
 * notifying subscribers there would set state on a component while a different
 * one is rendering. Nothing needs it either — the selection cannot change while
 * the modal is open.
 */
function captureSelection(selectedIds: unknown): void {
  const next: string[] = [];
  if (
    selectedIds &&
    typeof (selectedIds as { forEach?: unknown }).forEach === "function"
  ) {
    (selectedIds as Set<string>).forEach((id) => {
      next.push(String(id));
    });
  }

  const unchanged =
    next.length === selectedGalleryIds.length &&
    next.every((id, i) => id === selectedGalleryIds[i]);

  if (!unchanged) selectedGalleryIds = next;
}

/**
 * The language every selected gallery shares, or null when they differ (or when
 * none of them carries one).
 *
 * Mirrors getAggregateStudioId in Stash's utils/bulkUpdate.ts — comparing the
 * whole selection and falling back to "nothing in common" is what makes the
 * studio field show a value only when every selected item agrees. The languages
 * come from the plugin's own store rather than from the dialog, because the
 * dialog is the one thing that cannot be read.
 */
function selectedLanguageAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = pickLanguage(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (pickLanguage(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * The censorship every selected gallery shares, or null when they differ (or
 * when none of them carries one). The counterpart of selectedLanguageAggregate
 * above, which this plugin's own three-valued field needs just as much as the
 * language field does.
 */
function selectedCensorshipAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = censorshipOf(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (censorshipOf(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * The translation group every selected gallery shares, or null when they differ
 * (or when none of them carries one).
 *
 * Compared with `sameTranslationGroup` rather than by string equality, because
 * these values are typed: two galleries reading `Lily` and `lily` are one group,
 * and a menu prefilled from one of them is not a disagreement.
 */
function selectedGroupAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = NS.translationGroupOf(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    const name = NS.translationGroupOf(store?.get(selectedGalleryIds[i]));
    if (!NS.sameTranslationGroup(name, first)) return null;
  }

  return first || null;
}

/**
 * Whether every selected gallery is raw, none of them is, or the two are mixed —
 * the same three states the manga mark has, for the other field that is a claim
 * about a whole selection rather than a value to type into.
 *
 * A gallery with no answer at all reads as "not raw", which is what the field
 * means when it is absent everywhere else in the plugin.
 */
function selectedOriginalAggregate(): "all" | "none" | "mixed" {
  if (!selectedGalleryIds.length) return "none";

  let anyRaw = false;
  let anyOther = false;
  for (let i = 0; i < selectedGalleryIds.length; i++) {
    if (NS.isOriginal(store?.get(selectedGalleryIds[i]))) anyRaw = true;
    else anyOther = true;
    if (anyRaw && anyOther) return "mixed";
  }

  return anyRaw ? "all" : "none";
}

/**
 * Whether every selected gallery is manga, none of them is, or the two are
 * mixed. The three states the manga mark's checkbox has to express — a checkbox
 * can be checked, unchecked, or indeterminate, and which of those it shows is
 * exactly this.
 */
function selectedMangaAggregate(): "all" | "none" | "mixed" {
  if (!selectedGalleryIds.length) return "none";

  let anyManga = false;
  let anyOther = false;
  for (let i = 0; i < selectedGalleryIds.length; i++) {
    if (NS.isManga(store?.get(selectedGalleryIds[i]))) anyManga = true;
    else anyOther = true;
    if (anyManga && anyOther) return "mixed";
  }

  return anyManga ? "all" : "none";
}

/** Set once, so the link chain is never wrapped twice */
let bulkLinkInstalled = false;

/**
 * Is this operation Stash's gallery bulk update?
 *
 * Matched on the **root field name from the schema** (`bulkGalleryUpdate`,
 * graphql/schema/schema.graphql) rather than on the operation name codegen
 * happens to give it, and not on the shape of the variables either: the scene
 * and image bulk updates also take an `ids` array, and writing a language onto
 * scenes is not this plugin's business.
 */
function isGalleryBulkUpdate(query: unknown): boolean {
  const defs = query
    ? (query as { definitions?: unknown[] }).definitions
    : null;
  if (!defs?.length) return false;

  const op = defs[0] as {
    kind?: string;
    selectionSet?: { selections?: Array<{ name?: { value?: string } }> };
  };
  if (op?.kind !== "OperationDefinition") return false;

  const selections = op.selectionSet?.selections;
  if (!selections?.length) return false;

  const first = selections[0];
  return !!(first?.name && first.name.value === "bulkGalleryUpdate");
}

/**
 * The keys an unmark removes, across everything the dialog has selected.
 *
 * **The same function the single-gallery unmark uses** — `NS.fieldsToClear` — so that
 * "unmark" means one thing wherever it is asked for. That is not a tidying: this path
 * used to carry its own hand-written list of canonical names, and the list was wrong in
 * two ways a list cannot help being wrong. It did not consult `deleteOnUnmark`, so the
 * dialog destroyed values the setting had promised to keep; and being canonical it could
 * not remove a key that had drifted in case, which is the very thing `fieldsToClear`
 * exists to get right (a gallery would keep showing a language it was supposed to have
 * forgotten). It also fell behind: the third and fourth fields were never added to it.
 *
 * A union rather than any one gallery's answer, because one mutation covers N galleries
 * and names one key list. Removing a key a gallery does not carry is a no-op on the
 * server, which is what makes a single list safe for all of them. Asking the store for a
 * gallery it does not hold is the ordinary case, not a gap: the store is a gate rather
 * than a cache (see storedIsManga), and a gallery missing from it is one this plugin does
 * not consider manga — `fieldsToClear` answers for that case with the canonical mark,
 * which is exactly what should go.
 */
function bulkUnmarkKeys(): string[] {
  const keys: string[] = [];
  const seen: { [key: string]: true } = {};

  for (const id of selectedGalleryIds) {
    for (const key of NS.fieldsToClear(store?.get(id))) {
      if (seen[key]) continue;
      seen[key] = true;
      keys.push(key);
    }
  }

  return keys.length ? keys : [MANGA_FIELD_NAME];
}

/**
 * Merges the pending fields into a bulk gallery update, in place.
 *
 * CustomFieldsInput is what makes this safe: `partial` updates just the named
 * keys, so the rest of every gallery's custom fields is left alone, and `remove`
 * deletes only the named keys. Both may appear at once — the two pendings that
 * can coexist are a "set" on one field and a "remove" on another, which the
 * schema allows in a single input.
 *
 * Nothing is merged when the user has not touched any field — a bulk edit of
 * photographers must go out exactly as Stash built it. `bulkManga` is the one
 * pending the others defer to: unmarking clears every field this plugin owns, so
 * when it is set the other two are ignored entirely; and only "mark" writes the
 * manga field itself, since a selection that is already all-manga must not be
 * rewritten.
 *
 * @returns true when the operation was modified
 */
function applyPendingFields(operation: MangaToolsApolloOperation): boolean {
  const partial: { [name: string]: string } = {};
  const remove: string[] = [];

  if (bulkManga === "unmark") {
    remove.push(...bulkUnmarkKeys());
  } else {
    if (bulkManga === "mark") partial[MANGA_FIELD_NAME] = NS.MANGA_VALUE;

    if (bulkLanguage?.kind === "set") partial[FIELD_NAME] = bulkLanguage.value;
    else if (bulkLanguage?.kind === "remove") remove.push(FIELD_NAME);

    if (bulkCensorship?.kind === "set")
      partial[CENSORSHIP_FIELD_NAME] = bulkCensorship.value;
    else if (bulkCensorship?.kind === "remove")
      remove.push(CENSORSHIP_FIELD_NAME);

    if (bulkGroup?.kind === "set")
      partial[TRANSLATION_GROUP_FIELD_NAME] = bulkGroup.value;
    else if (bulkGroup?.kind === "remove")
      remove.push(TRANSLATION_GROUP_FIELD_NAME);

    if (bulkOriginal === "raw")
      partial[ORIGINAL_FIELD_NAME] = NS.ORIGINAL_VALUE;
    else if (bulkOriginal === "notRaw") remove.push(ORIGINAL_FIELD_NAME);
  }

  if (!Object.keys(partial).length && !remove.length) return false;

  // The route is checked here as well as by the row's mount, so "these fields
  // are only ever written on a gallery page" is a stated constraint rather than
  // a consequence of where the row happens to render.
  if (!isGalleryContext()) return false;

  if (!isGalleryBulkUpdate(operation.query)) return false;

  const input = operation.variables
    ? (operation.variables.input as { ids?: unknown } | undefined)
    : undefined;
  if (!input || !Array.isArray(input.ids)) return false;

  const fields: { partial?: Record<string, string>; remove?: string[] } = {};
  if (Object.keys(partial).length) fields.partial = partial;
  if (remove.length) fields.remove = remove;

  operation.variables = Object.assign({}, operation.variables, {
    input: Object.assign({}, input, {
      custom_fields: Object.assign(
        {},
        (input as { custom_fields?: unknown }).custom_fields,
        fields
      ),
    }),
  });

  return true;
}

/**
 * Hooks Stash's Apollo link chain so the pending fields ride along with the
 * dialog's own Apply.
 *
 * Why a link rather than patching the dialog: the dialog builds its mutation
 * from private state, so the last point this plugin and the dialog are both
 * present is the outgoing GraphQL operation. `setLink` is Apollo's own API for
 * changing the chain after the client exists, and the existing chain is passed
 * through untouched, so nothing else about the client changes.
 *
 * Installed lazily, the first time the bulk row mounts, so a user who never
 * opens the bulk dialog never has their client touched at all.
 */
function installBulkLink(): void {
  if (bulkLinkInstalled) return;

  const Apollo = PluginApi.libraries.Apollo;
  const client = stashClient();
  if (!client) return;

  if (
    !Apollo?.ApolloLink ||
    typeof client.setLink !== "function" ||
    !client.link
  ) {
    console.error(
      "[mangaTools] ApolloLink/setLink unavailable — the manga fields cannot be set from the bulk edit dialog"
    );
    return;
  }

  // Replace the chain with ours in front of the existing one. setLink replaces
  // the whole chain, so the current link must be passed through explicitly.
  const previous = client.link;

  client.setLink(
    Apollo.ApolloLink.from([
      new Apollo.ApolloLink((operation, forward) => {
        if (!applyPendingFields(operation)) {
          return forward(operation);
        }

        console.info(
          "[mangaTools] bulk update: sending the manga fields with the dialog's own update"
        );

        // Cleared only once the update actually succeeded, so a failed Apply
        // can simply be retried with the row still filled in.
        return forward(operation).map((result) => {
          bulkLanguage = null;
          bulkCensorship = null;
          bulkManga = null;

          // The badges read the plugin's own store, which this update has just
          // invalidated. Without this the covers keep the old flag until the
          // next poll or navigation.
          refreshAfterWrite();
          emit();

          return result;
        });
      }),
      previous,
    ])
  );

  bulkLinkInstalled = true;
}

/** The "remove" option's value — cannot collide with a language code or a censorship value */
const BULK_REMOVE_VALUE = "__manga_tools_remove__";

/**
 * The bulk edit dialog's manga rows, rendered through a portal into a mount
 * point inserted between Stash's "studio" and "performers" rows.
 *
 * Three rows, gated by the first. The mark is a tri-state checkbox — the same
 * shape Stash's own "organized" field takes — because a selection can be all,
 * none, or a mix, and a checkbox is the one control that says all three. The
 * language and censorship selects are only drawn while the selection is being
 * kept or made manga: the mark is what makes a gallery this plugin's at all, so
 * offering those fields over a selection that is not manga would be writing
 * values onto galleries that would then not display them. Unchecking a mark
 * that exists shows a warning instead, and Apply is what actually removes it.
 *
 * The values are deliberately **not** applied as they are picked: they are
 * merged into the dialog's own bulk update when Apply is pressed, so Cancel
 * discards them exactly like every other field in that dialog.
 */
function BulkFieldsRow() {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  const host = isGalleryContext() ? ensureBulkFieldHost() : null;
  const bump = React.useState(0)[1];

  // Same first-render problem as LanguageRow: the dialog mounts this component
  // from its rating row, which renders **before** the studio row it has to
  // anchor on has been committed to the DOM. The effect runs after the commit,
  // and one extra render is all it takes.
  // As in LanguageRow: before paint, so this pass adds no step of its own.
  React.useLayoutEffect(() => {
    if (!isGalleryContext()) return;

    installBulkLink();

    if (ensureBulkFieldHost() !== host) {
      bump((v) => v + 1);
    } else if (!host && bulkDialogUp()) {
      // **After the commit, and only when there is a dialog to place rows in.**
      // Both readings have settled by now: the dialog's rows are in the DOM, and
      // the anchor has either been found or has not. A mount point that cannot be
      // placed at this point, with the dialog up, is the failure this line exists
      // for — the one where the dialog is on screen, the rows are not, and nothing
      // else on the console says why. Two things would make it cry wolf instead:
      // asking during the render (the studio row is not committed yet on the first
      // one — the same reason this effect exists at all), and asking without the
      // dialog being up (`BulkFieldsRow` renders wherever a RatingSystem does, and
      // most of those pages have no bulk dialog and are not broken).
      noteOnce(
        "bulk-no-host",
        "the bulk edit dialog's mount point could not be placed — " +
          BULK_ANCHOR +
          " was not found inside the dialog's own form. MangaTools.diag() " +
          "reports what it sees."
      );
    }
  });

  // Losing the row means the dialog closed, so the pending values are no longer
  // wanted. Checked against the DOM rather than unconditionally, so an
  // unrelated re-render cannot throw them away while the dialog is open.
  React.useEffect(
    () => () => {
      if (!bulkAnchor()) {
        bulkLanguage = null;
        bulkCensorship = null;
        bulkGroup = null;
        bulkOriginal = null;
        bulkGroupBeforeRaw = null;
        bulkManga = null;
      }
    },
    []
  );

  // Counted, not logged: whether this component ever ran is what tells a bug in
  // the dialog apart from a bug in whatever mounts it, and a count is the only
  // form of that answer which does not depend on watching the console at the
  // right moment. MangaTools.diag() reports it.
  bulkRenders += 1;

  // Drawing nothing is silent, and **nothing is said from here**. Both of the ways
  // this render can come up empty have a better place to be reported from:
  //
  //   - "not a gallery route" is the ordinary case, not a failure. The rating row
  //     this component is mounted from belongs to *a* bulk dialog, and galleries,
  //     images, scenes and groups all draw that same row — images and scenes down
  //     to `scene_code` and `photographer`. So `/images` with its dialog open looks
  //     exactly like a gallery page whose route the plugin got wrong, and a line
  //     here would cry wolf on every one of them.
  //   - "the mount point could not be placed" is only answerable *after* the commit:
  //     the dialog's studio row is not in the DOM yet on this first render, by
  //     design (see the layout effect above). Reported from here it would fire once
  //     on every dialog that opens perfectly well. It is reported from the effect,
  //     which is the first moment the question has a true answer — and where the
  //     bug it exists for would still be caught, because a mount point that cannot
  //     be placed cannot be placed then either.
  //
  // So this guard is quiet, and the two lines that were here are gone: one cried
  // wolf, one was said twice (resolveSelect already names a missing react-select).
  if (!isGalleryContext() || !Select || !host) {
    return null;
  }

  const cls = readNativeFieldClasses(bulkAnchor()) || {
    group: "row",
    label: "col-form-label col-3",
    control: "col-9",
  };

  // The mark, and the third state its checkbox has to express. `tri` is the
  // checkbox's state as a boolean *or* the indeterminate it shows for a mixed
  // selection — which is why it is not just `bulkManga !== "unmark"`.
  const aggregate = selectedMangaAggregate();
  const tri =
    bulkManga === "mark"
      ? true
      : bulkManga === "unmark"
        ? false
        : aggregate === "all"
          ? true
          : aggregate === "none"
            ? false
            : undefined;

  // React has no `indeterminate` prop, so it is set on the DOM node directly —
  // the same thing Stash's IndeterminateCheckbox does with its ref.
  const setIndeterminate = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = tri === undefined;
  };

  // The cycle depends on what the selection already is, so the "no change" rest
  // state is one click away in every case: all↔unmark, none↔mark, and for a
  // mix, keep→mark→unmark→keep. Marking first matches a checkbox the reader
  // has to confirm before it will ever remove a mark.
  const cycleManga = () => {
    if (aggregate === "all") {
      bulkManga = bulkManga === "unmark" ? null : "unmark";
    } else if (aggregate === "none") {
      bulkManga = bulkManga === "mark" ? null : "mark";
    } else {
      bulkManga =
        bulkManga === null ? "mark" : bulkManga === "mark" ? "unmark" : null;
    }
    emit();
  };

  // The mark is native organized-style markup — a form-group wrapping a
  // form-check, checkbox then label, no grid columns — so it sits in the dialog
  // exactly like Stash's "organized" field rather than in the label/control
  // column split the selects below use.
  const mangaRow = (
    <div className="form-group" data-field="manga_tools_manga">
      <div className="form-check">
        <input
          type="checkbox"
          className="form-check-input"
          id="manga_tools_manga"
          ref={setIndeterminate}
          checked={tri === true}
          onChange={cycleManga}
        />
        <label className="form-check-label" htmlFor="manga_tools_manga">
          {t(intl, "mangaTools.manga.isManga")}
        </label>
      </div>
    </div>
  );

  // The one option both selects share, and the way each draws it. It is a real
  // option rather than the clear button, because clearing already means "leave
  // this field alone" — the two must both be reachable, and they are opposites.
  const removeOption: MangaToolsOption = {
    value: BULK_REMOVE_VALUE,
    label: t(intl, "mangaTools.bulk.remove"),
    flag: null,
  };
  const banIcon = Solid.faBan || null;
  const removeLabel = (
    <span className="manga-tools-option">
      {banIcon ? <Icon icon={banIcon} /> : null}
      {removeOption.label}
    </span>
  );
  const formatLanguageWithRemove = (opt: MangaToolsOption) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatLanguageOption(opt);
  const formatCensorshipWithRemove = (opt: { value: string; label: string }) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatCensorshipOption(opt);

  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => !NS.enabledLanguages || NS.enabledLanguages.has(o.value)
  );

  // Show exactly what is about to happen: what the user picked, otherwise the
  // selection's shared language. A mixed selection shows the placeholder — the
  // same way the studio field behaves — and the remove option is its own state
  // rather than an empty box, because an empty box means "leave alone".
  const langShown =
    bulkLanguage?.kind === "set"
      ? bulkLanguage.value
      : bulkLanguage?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedLanguageAggregate() || "";

  const current =
    langShown && langShown !== BULK_REMOVE_VALUE
      ? NS.describe(langShown, intl.locale)
      : null;

  // A code that is not in the enabled list still has to be shown while it is
  // sitting in the row, or the selection would look like it was ignored.
  const currentCode = current ? current.code : "";
  if (current && !options.some((o) => o.value === currentCode)) {
    options = [
      { value: current.code, label: current.name, flag: current.flag },
      ...options,
    ];
  }

  const selected =
    langShown === BULK_REMOVE_VALUE
      ? removeOption
      : current
        ? { value: current.code, label: current.name, flag: current.flag }
        : null;

  // The group this dialog is about to write — the pending one if there is one, the
  // selection's if they agree, otherwise none. It is what the suggestion below is
  // read from, and why the suggestion follows what you picked rather than what the
  // galleries still say.
  const groupNow =
    bulkGroup?.kind === "set"
      ? bulkGroup.value
      : bulkGroup?.kind === "remove"
        ? ""
        : selectedGroupAggregate() || "";

  // The language that group's galleries usually carry, offered the way the edit
  // page offers it: only when it is a language this field's own menu can show, and
  // only when it is not already what the row says. Same three conditions as there,
  // for the same three reasons — see the edit page's `offered`.
  const usualForGroup = NS.usualLanguagesOf(store)[NS.groupKey(groupNow)];
  const offered =
    usualForGroup &&
    (!NS.enabledLanguages || NS.enabledLanguages.has(usualForGroup.code)) &&
    (!current || current.code !== usualForGroup.code)
      ? usualForGroup
      : null;
  const offeredInfo = offered ? NS.describe(offered.code, intl.locale) : null;

  // The wand the edit page draws beside its group field, doing the same thing here:
  // this is a suggestion, and the glyph says so rather than naming a language the
  // field beside it already names. The chain of spellings is the same one — `Icon`
  // throws inside a render on an undefined icon, and an empty button is the one
  // outcome a missing glyph may not have.
  const wandIcon =
    Solid.faWandMagicSparkles || Solid.faMagic || Solid.faLanguage || null;
  const languageChip =
    offered && offeredInfo ? (
      <button
        type="button"
        className="btn btn-secondary manga-tools-chip"
        aria-label={offeredInfo.name}
        title={
          t(intl, "mangaTools.translationGroup.fill") +
          " " +
          offeredInfo.name +
          " — " +
          t(intl, "mangaTools.translationGroup.suggestedLanguage") +
          " (" +
          offered.count +
          ")"
        }
        onClick={() => {
          bulkLanguage = { kind: "set", value: offered.code };
          emit();
        }}
      >
        {wandIcon ? <Icon icon={wandIcon} /> : null}
      </button>
    ) : null;

  const languageRow = (
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div
        className={cls.control + (languageChip ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          // The dialog is a scrolling modal, so the menu has to escape it.
          menuPortalTarget={document.body}
          placeholder={t(intl, "mangaTools.select.placeholder")}
          value={selected}
          options={[...options, removeOption]}
          formatOptionLabel={formatLanguageWithRemove}
          components={{ IndicatorSeparator: () => null }}
          // Clearing means "leave the language alone", exactly as clearing the
          // studio field means "leave the studio alone" — neither sends a value.
          onChange={(opt: MangaToolsOption | null) => {
            if (!opt) {
              bulkLanguage = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkLanguage = { kind: "remove" };
            } else {
              bulkLanguage = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
        {languageChip}
      </div>
    </div>
  );

  const censorshipOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];

  const censoredShown =
    bulkCensorship?.kind === "set"
      ? bulkCensorship.value
      : bulkCensorship?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedCensorshipAggregate() || "";

  const censoredSelected =
    censoredShown === BULK_REMOVE_VALUE
      ? removeOption
      : censoredShown
        ? {
            value: censoredShown,
            label: NS.censorshipLabel(intl, censoredShown),
          }
        : null;

  const censorshipRow = (
    <div className={cls.group} data-field="manga_tools_censorship">
      <label className={cls.label} htmlFor="manga_tools_censorship">
        {t(intl, "mangaTools.censorship.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_censorship"
          isClearable
          isSearchable={false}
          menuPortalTarget={document.body}
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={censoredSelected}
          options={[...censorshipOptions, removeOption]}
          formatOptionLabel={formatCensorshipWithRemove}
          components={{ IndicatorSeparator: () => null }}
          onChange={(opt: { value: string } | null) => {
            if (!opt) {
              bulkCensorship = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkCensorship = { kind: "remove" };
            } else {
              bulkCensorship = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
      </div>
    </div>
  );

  // ── The translation group, and the raw mark that is its other answer ──
  //
  // The same pair the edit page draws, in the same shape: a select, and the steak
  // beside it. What differs is that a selection can hold more than one answer, so
  // each of the two has a third state the edit page's field never has.
  //
  // `showOriginal` is asked here as the edit page asks it, because it decides two
  // things in both places: whether the chip is drawn at all, and whether the row
  // is a chip row (a select sharing its column with a button) or a plain one.
  const showOriginal = NS.fieldShowing("original");

  const groupShown =
    bulkGroup?.kind === "set"
      ? bulkGroup.value
      : bulkGroup?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedGroupAggregate() || "";

  // Raw is the reason there is no group to enter, so the box says which of the two
  // emptinesses this is — the edit page's `rawShown`, asked of what this dialog is
  // about to write rather than of one gallery's value.
  const rawState: "raw" | "notRaw" | "mixed" =
    bulkOriginal === "raw"
      ? "raw"
      : bulkOriginal === "notRaw"
        ? "notRaw"
        : selectedOriginalAggregate() === "all"
          ? "raw"
          : selectedOriginalAggregate() === "none"
            ? "notRaw"
            : "mixed";
  const rawShown = showOriginal && rawState === "raw";

  // Whether pressing again would put a group back — which the tooltip says, and it
  // is a question about *what would come back* rather than about whether raw took
  // something: a selection with no group of its own has nothing to restore, and
  // saying it would be a promise the click does not keep.
  const restoresGroup =
    !!bulkGroupBeforeRaw &&
    (bulkGroupBeforeRaw.pending
      ? bulkGroupBeforeRaw.pending.kind === "set"
      : !!selectedGroupAggregate());

  // The cycle, and **what it is keyed on is the whole of getting this right**: the
  // selection's own state, not the pending value's. Keyed on the pending value, a
  // selection where nothing is raw sat at "not raw", and the first press moved the
  // pending value to "no view" — which the aggregate then answered identically, so
  // the button did not change, and read as broken. The mark's checkbox was keyed on
  // its aggregate from the start and has the property this does now: **every press
  // changes what is drawn**, whichever state the selection is in.
  //
  // So: every gallery raw toggles raw↔not-raw, none raw toggles the other way, and a
  // mix walks keep → raw → not raw → keep. Pressing raw takes the group away, which
  // is what the field means — and remembering it is what makes the next press an
  // undo rather than a second guess, exactly as the edit page remembers the name it
  // took.
  const cycleOriginal = () => {
    const aggregate = selectedOriginalAggregate();
    const next: "raw" | "notRaw" | null =
      aggregate === "all"
        ? bulkOriginal === "notRaw"
          ? null
          : "notRaw"
        : aggregate === "none"
          ? bulkOriginal === "raw"
            ? null
            : "raw"
          : bulkOriginal === null
            ? "raw"
            : bulkOriginal === "raw"
              ? "notRaw"
              : null;

    if (next === "raw") {
      bulkGroupBeforeRaw = { pending: bulkGroup };
      bulkGroup = { kind: "remove" };
    } else if (bulkGroupBeforeRaw) {
      // Whatever raw took comes back exactly as it was — which for a selection with
      // no group of its own is "nothing pending", not a name this dialog would have
      // had to invent.
      bulkGroup = bulkGroupBeforeRaw.pending;
      bulkGroupBeforeRaw = null;
    }

    bulkOriginal = next;
    emit();
  };

  const groupValue = groupShown === BULK_REMOVE_VALUE ? "" : groupShown;
  const known = knownTranslationGroups();
  // The create entry, by the edit page's rule: only while the typed text is not a
  // group this Stash already knows, so the menu never spells one name twice.
  const namesANewGroup =
    !!groupValue &&
    !known.some((name) => NS.sameTranslationGroup(name, groupValue));

  // The grouping the edit page uses, applied to the selection's agreed language:
  // the groups whose galleries usually carry that language come first, the rest
  // keep their name order behind them. With no agreed language there is nothing to
  // sort by, and name order is what is left.
  const agreedLanguage =
    bulkLanguage?.kind === "set"
      ? bulkLanguage.value
      : bulkLanguage?.kind === "remove"
        ? ""
        : selectedLanguageAggregate() || "";
  const usualLanguages = NS.usualLanguagesOf(store);
  const usualOf = (name: string) => usualLanguages[NS.groupKey(name)];
  const matchesAgreed = (name: string) => {
    const usualHere = usualOf(name);
    return !!agreedLanguage && !!usualHere && usualHere.code === agreedLanguage;
  };
  const ordered = known
    .filter(matchesAgreed)
    .concat(known.filter((name) => !matchesAgreed(name)));

  const groupOptions: MangaToolsGroupOption[] = [
    ...(namesANewGroup
      ? [
          {
            value: groupValue,
            label: groupValue,
            createLabel:
              t(intl, "mangaTools.translationGroup.create") +
              ' "' +
              groupValue +
              '"',
          },
        ]
      : []),
    ...ordered.map((name): MangaToolsGroupOption => {
      const usualHere = usualOf(name);
      const described = usualHere
        ? NS.describe(usualHere.code, intl.locale)
        : null;
      return {
        value: name,
        label: name,
        hint: described ? { flag: described.flag, name: described.name } : null,
      };
    }),
  ];

  // The remove entry is this plugin's four-valued answer rather than the clear
  // button: clearing means "leave the group alone", and taking it off a gallery is
  // a different thing that has to be reachable — the two are opposites, exactly as
  // in the two rows above.
  const groupRemoveOption: MangaToolsGroupOption = {
    value: BULK_REMOVE_VALUE,
    label: t(intl, "mangaTools.bulk.remove"),
  };
  // The remove entry is drawn by this row, everything else by the edit page's own
  // formatter — `meta` is passed straight through, because which context a label is
  // being drawn in (the menu, or the box holding the chosen value) is what decides
  // whether the hint is there, and react-select is what knows it.
  const formatGroupWithRemove = (
    opt: MangaToolsGroupOption,
    meta?: { context?: string }
  ) =>
    opt.value === BULK_REMOVE_VALUE
      ? removeLabel
      : formatGroupOption(opt, meta);

  const steakIcon = <SteakIcon raw={rawState === "raw"} />;
  const originalChip = (
    <button
      type="button"
      className={
        "btn btn-secondary manga-tools-chip manga-tools-original" +
        (rawState === "raw" ? " active" : "") +
        (rawState === "mixed" ? " mixed" : "")
      }
      // A button's third state has a name in ARIA, and `mixed` is it — the same
      // thing the mark's checkbox says with `indeterminate`.
      aria-pressed={rawState === "mixed" ? "mixed" : rawState === "raw"}
      aria-label={t(intl, "mangaTools.translationGroup.original")}
      title={t(
        intl,
        rawState === "raw"
          ? restoresGroup
            ? "mangaTools.translationGroup.originalOffRestore"
            : "mangaTools.translationGroup.originalOff"
          : rawState === "mixed"
            ? "mangaTools.translationGroup.originalMixed"
            : "mangaTools.translationGroup.originalOn"
      )}
      onClick={cycleOriginal}
    >
      {steakIcon}
    </button>
  );

  const groupRow = (
    <div className={cls.group} data-field="manga_tools_translation_group">
      <label className={cls.label} htmlFor="manga_tools_translation_group">
        {t(intl, "mangaTools.translationGroup.heading")}
      </label>
      <div
        className={cls.control + (showOriginal ? " manga-tools-chip-row" : "")}
      >
        <Select
          className="manga-tools-select manga-tools-group-select"
          classNamePrefix="react-select"
          inputId="manga_tools_translation_group"
          isClearable
          isDisabled={rawShown}
          menuPortalTarget={document.body}
          placeholder={t(
            intl,
            rawShown
              ? "mangaTools.translationGroup.originalDetail"
              : "mangaTools.translationGroup.placeholder"
          )}
          value={
            groupShown === BULK_REMOVE_VALUE
              ? groupRemoveOption
              : groupValue
                ? { value: groupValue, label: groupValue }
                : null
          }
          options={[...groupOptions, groupRemoveOption]}
          formatOptionLabel={formatGroupWithRemove}
          components={{ IndicatorSeparator: () => null }}
          onInputChange={(text: string, meta: { action?: string }) => {
            if (meta?.action !== "input-change") return;
            const typed = text.trim();
            bulkGroup = typed ? { kind: "set", value: typed } : null;
            emit();
          }}
          onChange={(opt: MangaToolsGroupOption | null) => {
            if (!opt) {
              bulkGroup = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              // **Only the group.** The chip beside this box is how raw is said, and
              // taking a group off a gallery says nothing about whether it is one.
              bulkGroup = { kind: "remove" };
            } else {
              // A group picked is a gallery that was translated, which is the edit
              // page's rule: choosing a name is the other answer to "is this raw".
              bulkGroup = { kind: "set", value: opt.value };
              if (showOriginal) bulkOriginal = "notRaw";
            }
            emit();
          }}
        />
        {showOriginal ? originalChip : null}
      </div>
    </div>
  );

  // The gate in order: a warning while the reader is unmarking, the mark itself,
  // and only then the fields it guards — each of which is drawn only while its
  // own switch says so, and none of which takes another down with it. The mark
  // is not one of the four fields and is never gated on them: it is what makes a
  // gallery this plugin's at all, and a dialog that could not set it would leave
  // every gallery unmarked.
  return PluginApi.ReactDOM.createPortal(
    <>
      {tri === false && aggregate !== "none" ? (
        <div className="alert alert-warning" role="alert">
          {/* What an unmark will actually do, which is a question the settings
              answer — and the two answers are far enough apart to need two
              sentences rather than one that hedges. */}
          {t(
            intl,
            NS.deleteOnUnmark
              ? "mangaTools.bulk.unmarkWarning"
              : "mangaTools.bulk.unmarkWarningKeep"
          )}
        </div>
      ) : null}
      {mangaRow}
      {tri === true && NS.fieldShowing("language") ? languageRow : null}
      {tri === true && NS.fieldShowing("censorship") ? censorshipRow : null}
      {tri === true && NS.fieldShowing("translationGroup") ? groupRow : null}
    </>,
    host
  );
}

// ─────────────────────────── The manga panel ───────────────────────────
//
// The gallery's manga attributes, as a collapsible block in the details tab.
// A disclosure rather than a tab this plugin injects into Stash's tab bar: it
// owns its own open state and nothing else's, which is the entire difference —
// a tab would have to agree with react-bootstrap about which tab is active, and
// that is what made the first attempt at this too fragile to keep.
//

/**
 * Renders nothing rather than taking the page with it, and says so.
 *
 * For the block this plugin adds to the details tab, so that a mistake in it
 * costs one section rather than the whole page: React 17 answers a throw inside a
 * render by unmounting the tree, which is what left the app sitting on "Loading"
 * while this was being built. A boundary turns that into a log line naming the
 * block.
 *
 * Built on first use rather than where it is written, and that is about the
 * bundle rather than about React. A class body is evaluated where it stands, so
 * `extends React.Component` resolves the API *while the file loads* — and this
 * half shares a bundle with the reader's, whose half must not be taken down by
 * anything that happens during this one's load. Inside a render, a throw costs
 * one block; at load it costs both halves.
 */
type GuardedBlockProps = { name: string; children?: ReactNode };
type GuardedBlockState = { failed: boolean };

let guardedBlockClass: React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> | null = null;

/** The error boundary, made once and reused. Call it from inside a render. */
function guardedBlock(): React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> {
  if (guardedBlockClass) return guardedBlockClass;

  guardedBlockClass = class extends (
    React.Component<GuardedBlockProps, GuardedBlockState>
  ) {
    state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error: unknown) {
      console.error(
        "[mangaTools] the " +
          this.props.name +
          " threw while rendering, so it is " +
          "not on the page. Everything else the plugin does is unaffected.",
        error
      );
    }

    render() {
      return this.state.failed ? null : this.props.children;
    }
  };

  return guardedBlockClass;
}

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

/**
 * The gallery's manga attributes, as labelled rows.
 *
 * A row is drawn only when its value is set — an unset one is simply absent,
 * the same way the rest of the plugin keeps an unset value quiet. With no value
 * at all the whole panel is dropped, since a fold whose only content is its own
 * heading is not worth a line.
 */
function MangaDetailsPanel(props: { values: CustomFieldsMap }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const state = React.useState(NS.openDetailsBlock);
  const open = state[0];
  const setOpen = state[1];

  // Each value is read only if its field is drawn, so a field that is off cannot
  // reach the panel through the back door — a row whose value happens to be set on
  // the gallery is exactly what "turned off" has to hide. What it does not do is
  // touch the gallery: the values stay where they are, and turning the field back
  // on brings them back.
  const language = NS.fieldShowing("language")
    ? NS.describe(pickLanguage(props.values), intl.locale)
    : null;
  const mark = NS.fieldShowing("censorship") ? censorshipOf(props.values) : "";
  const group = NS.fieldShowing("translationGroup")
    ? NS.translationGroupOf(props.values)
    : "";
  const original = NS.fieldShowing("original") && NS.isOriginal(props.values);
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;
  const Collapse = PluginApi.libraries.Bootstrap?.Collapse;

  // Nothing set means nothing to say: with none of the four set the whole panel
  // is dropped, rather than left as an empty fold with only its heading. The same
  // test answers "are there any fields at all": with every one of them turned off
  // none of the four can be set, so the panel drops without a second question.
  if (!language && !mark && !group && !original) return null;

  // The same mount point the plain language row used: the end of .gallery-details,
  // which lands after "photographer" and before "details".
  const host = ensureDetailHost();
  if (!host) return null;

  // The flag and the space before the name are conditional, and both for the same
  // reason: an unknown value has no flag, and a row that always put a space there
  // would read "Language:  klingon".
  const showFlag = NS.showFlags && !!language?.flag;

  // Two <h6>s, exactly as the rows above and below are drawn — the pieces are
  // separate children rather than a label and a value in a wrapper, so the text
  // nodes come out the way Stash's own rows produce them. Each is drawn only
  // when its value is set.
  //
  // The censorship row comes first, then the language, then the group: the
  // censorship is about the copy in hand — what was or was not done to the scans —
  // and the other two are about where the text came from. The raw mark is not a
  // row at all: it rides on the language, when there is one.
  const body = (
    <div className="manga-tools-panel-body">
      {mark ? (
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.censorship.heading") + ": "}
          <CensorshipIcon value={mark} />
          {mark ? " " : null}
          {NS.censorshipLabel(intl, mark)}
        </h6>
      ) : null}
      {language ? (
        <h6 className="manga-tools-detail">
          {fieldLabel(intl) + ": "}
          {showFlag ? (
            <Flag flag={language.flag as string} className="manga-tools-flag" />
          ) : null}
          {showFlag ? " " : null}
          {language.name}
          {/*
            The raw mark rides on this row rather than having one of its own. It
            answers a question about the language — the text is in it, untranslated
            — and as a row of its own under the *group's* label it read like a group
            called "raw", which is the reading this field exists to avoid.

            The space in front of it is part of the string, not a text node of its
            own like the flag's: English wants one before a bracket and Chinese
            takes none, so the catalog is where that difference belongs.
          */}
          {original
            ? t(intl, "mangaTools.translationGroup.originalInline")
            : null}
        </h6>
      ) : null}
      {group ? (
        // No icon and no flag: a group's name is its own, and there is nothing
        // here to draw beside it. Drawn last, because it is the one row that is
        // the same shape on every gallery rather than picked from a list.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.heading") + ": "}
          {group}
        </h6>
      ) : null}
      {original && !language ? (
        // Raw with no language row to carry the mark, so it stands on its own —
        // and without the group's label, for the reason above. The wording carries
        // the rest: a bare "原文" under that label would read like a group called
        // that, which is why the string says what it does.
        //
        // "No language row" rather than "no language set": with the language field
        // turned off there is no row to ride on whatever the gallery holds, and a
        // raw mark with no way of being shown is worse than one shown plainly.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.originalDetail")}
        </h6>
      ) : null}
    </div>
  );

  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      {/*
        Stash's own collapsible section, reproduced rather than invented: the
        classes are `components/Shared/CollapseButton.tsx`'s, and its stylesheet is
        what makes this look like the rest of the page. `minimal` is the class
        that gives a button the page's text colour — without it a bare <button>
        keeps the browser's own, which is black whatever the theme.
      */}
      <div className="collapse-header">
        {Button ? (
          <Button
            className="minimal collapse-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              icon={open ? Solid.faChevronDown : Solid.faChevronRight}
              fixedWidth
            />
            <span>{t(intl, "mangaTools.panel.heading")}</span>
          </Button>
        ) : null}
      </div>

      {/* With no Bootstrap at all the body simply shows — degraded, not hidden. */}
      {Collapse ? <Collapse in={open}>{body}</Collapse> : body}
    </div>,
    host
  );
}

// ───────────────────────────── Patch registration ─────────────────────────────

// 1. The badge on the bottom of the gallery card cover.
//
//    `after`, not `instead`: nothing about Stash's own output is being changed,
//    only added to. That is what lets the original component be left alone —
//    GalleryCard.Overlays uses useMemo internally, so calling it directly (as the
//    official example does) is exactly the thing not to do, and `after` never
//    calls it at all.
registerPatch("after", "GalleryCard.Overlays", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Overlays");

  const id = props.gallery?.id;
  const value = id ? pickLanguage(store?.get(String(id))) : "";

  // Nothing to add: the gallery has no language, or the badge is turned off, or
  // the language field itself is. Asked here rather than inside the badge for the
  // reason every guard on this half is asked as early as it can be: a component
  // that is not rendered cannot draw anything by accident.
  if (!value || !NS.showCoverBadge || !NS.fieldShowing("language"))
    return result;

  return (
    <>
      {result}
      <LanguageBadge galleryId={id as string} />
    </>
  );
});

// 1b. The manga icon at the end of the same card's popover row.
//
//     Deliberately not another cover badge: the language badge is a flag, which
//     reads at a glance, while "this is one the plugin manages" is not a value you
//     scan for. The popover row is where Stash already puts this kind of thing
//     (organized, and the two counts), and it costs nothing on the many cards that
//     are not manga, which is most of them.
//
//     The gate is the store rather than a value: on a card there is nothing else to
//     ask, and the store holds exactly the galleries the query found — which, since
//     the query asks for the mark, is the same set as "is manga".
registerPatch("after", "GalleryCard.Popovers", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Popovers");

  const id = props.gallery?.id;
  if (!id || !storedIsManga(String(id))) return result;

  return (
    <>
      {result}
      <MangaPopoverMark galleryId={String(id)} />
    </>
  );
});

// 2. Edit page: render the language field (it portals itself after the studio
//    row, so it contributes nothing at this position).
registerPatch("instead", "CustomFieldsInput", (...args: unknown[]) => {
  const props = args[0] as {
    values?: CustomFieldsMap;
    onChange?: (values: CustomFieldsMap) => void;
  };
  const Original = originalFrom(args);
  noteFired("CustomFieldsInput");

  // Subscribed for the same reason as the details panel above: whether the edit
  // block is drawn is asked from the store now, and a mark made from the toolbar
  // changes that without touching anything Stash would re-render this for.
  useGlobalVersion();

  // This component *is* the gallery's edit form's custom-fields section: it is
  // rendered for every gallery, whether or not this plugin has marked it, and it
  // is handed both the form's map and the setter for it. Published for the
  // toolbar switch, which marks through the form as well as through the server —
  // publishing it from the edit block instead would cover only galleries that are
  // already manga, and marking a gallery that is not is exactly the case this is
  // for. Cleared when the form goes, so nothing writes into one that is not there.
  React.useEffect(() => {
    const galleryId = currentGalleryId();
    if (props.onChange && galleryId) {
      editForm = {
        galleryId,
        values: props.values ?? {},
        onChange: props.onChange,
      };
    }
    return () => {
      editForm = null;
    };
  });

  return (
    <>
      {/* Only on a gallery that is manga. An unmarked gallery's edit form is
          Stash's own, unchanged — the plugin is not there at all. */}
      {isMarkedNow(currentGalleryId(), props.values) ? (
        <MangaFieldBlock values={props.values} onChange={props.onChange} />
      ) : null}
      <Original {...props} />
    </>
  );
});

// 3. Edit page: stop rendering the input row of every field this plugin owns —
//    they are all handled above now. Every other field goes straight back to the
//    original component, so the plugin has zero effect on them.
//
//    isNew must pass through: that is the "new field" row, and the user may be
//    in the middle of typing a name that will turn out to be ours. Returning null
//    would make the whole row vanish mid-keystroke.
//
//    All three, not just the language: this patch is what stops a raw
//    `plugin.mangaTools.censorship` row appearing in the form, and it went
//    unnoticed that it only ever checked for the language one until the other two
//    fields existed.
/**
 * Whether this plugin takes over the row Stash would draw for one of its own keys.
 *
 * The two patches below are the two halves of one answer, which is why this is one function
 * rather than a condition written twice: the edit form *swallows* each of this plugin's rows,
 * and the details page *lifts* each of its keys out of the custom fields it hands to Stash.
 * Both of them are ways of taking the row over, and both have to give it up together or the
 * page says two different things about the same field.
 *
 * Taken over for every key this plugin recognises — unless the reader has asked for disabled
 * fields to be left to Stash (`showDisabledFields` in plugin-api.ts), in which case the row is
 * given back for a field that is off. A field that is *on* is always this plugin's: it draws a
 * nicer row than Stash's, whose label is the field's name.
 *
 * And the chapters key is never given back, whatever the reader has asked for: its value is
 * JSON, and the row Stash would draw for it is a blob in the edit form. See ownField in
 * fields.ts, where that key is recognised for exactly this reason — so that it cannot be left
 * behind in Stash's own rows.
 */
function takesOverFieldRow(key: unknown): boolean {
  if (!NS.ownField(key)) return false;

  // The chapters key is the one of ours with no name — see fieldNameOf — and it is never given
  // back: its value is JSON, and the row Stash would draw for it is a blob in the edit form.
  const name = NS.fieldNameOf(key);
  if (!name) return true;

  return !NS.showDisabledFields || NS.fieldShowing(name);
}

registerPatch("instead", "CustomFieldInput", (...args: unknown[]) => {
  const props = args[0] as { field?: string; isNew?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFieldInput");

  // `isNew` passes through whatever this says: that is the "new field" row, and the reader may
  // be in the middle of typing a name that will turn out to be one of ours.
  if (!props.isNew && takesOverFieldRow(props.field)) {
    return null;
  }

  return <Original {...props} />;
});

/** Class name of the detail row's mount point */
const DETAIL_HOST_CLASS = "manga-tools-detail-host";

/**
 * The mount point. Held at module scope so a React re-render that drops it
 * reuses the same node instead of creating a new one every render.
 */
let detailHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point for the detail-page language row.
 *
 * Why this touches the DOM: everything inside `.gallery-details` is a bare
 * <h6>. The only component there is PhotographerLink, and neither it nor its
 * parent GalleryDetailPanel is patchable, so React offers no insertion point.
 *
 * Appending to the end of `.gallery-details` puts the row after "photographer"
 * and before "details" — the latter belongs to renderDetails() in the next .row.
 */
function ensureDetailHost(): HTMLElement | null {
  const panel = document.querySelector(".gallery-details");
  if (!panel) {
    detailHost = null;
    return null;
  }

  if (!detailHost) {
    detailHost = document.createElement("div");
    detailHost.className = DETAIL_HOST_CLASS;
  }

  // A React re-render may push it earlier or drop it; keep it at the end.
  if (
    detailHost.parentNode !== panel ||
    panel.lastElementChild !== detailHost
  ) {
    panel.appendChild(detailHost);
  }

  return detailHost;
}

/** Class name of the edit field's mount point */
const FIELD_HOST_CLASS = "manga-tools-field-host";

/**
 * The bulk dialog's studio row, found **inside the dialog's own form**.
 *
 * A plain document query is not enough, and the reason is not hypothetical: the
 * scrape dialog's rows are `ScrapeDialogRow`s, and its studio row carries the very
 * `data-field="studio"` this looks for. The mount point is live whenever a gallery
 * page is on screen — it is mounted by RatingSystem, which the *page* renders, not
 * the dialog — so with a scrape dialog open the first match was the scraped row,
 * and the mark checkbox appeared under it.
 *
 * Scoping the search is what fixes that, and it is the right way round for an
 * insertion: the question asked is "is the bulk dialog up, and where is its studio
 * row", and when it cannot be answered nothing is drawn. The form is reached from
 * the rating row every bulk dialog has (see BULK_DIALOG_MARK); a dialog without one
 * has no form to search, so its rows are never in scope at all.
 *
 * **`closest` rather than a hand-walked parent chain, and that is the whole of what
 * went wrong here.** The walk compared `tagName === "form"`, which no browser ever
 * answers: `tagName` is upper case there ("FORM"). It is lower case only in the
 * stub this was tested against, so the lookup succeeded in the tests and returned
 * null in every real browser — the rows were never placed, and nothing said why.
 * The comment that stood here said `closest` was avoided so the tests' DOM would
 * not have to implement one more method: the stub's convenience decided the
 * production code, and the stub was the thing that was wrong.
 */
function bulkAnchor(): Element | null {
  const form = document.querySelector(BULK_DIALOG_MARK)?.closest("form");
  return form ? form.querySelector(BULK_ANCHOR) : null;
}

/**
 * Whether a bulk dialog is on the page at all — the rating row is the mark of it.
 *
 * The one question the mount point's diagnostic cannot answer by itself: an anchor
 * that cannot be found means "there is no dialog here" (an ordinary page) as well
 * as "there is a dialog and I cannot place the rows in it" (a bug). Only the second
 * is worth a line, and this is what tells them apart.
 */
function bulkDialogUp(): boolean {
  return !!document.querySelector(BULK_DIALOG_MARK);
}

/** As above, held at module scope so the same node is reused */
const fieldHosts: { [key: string]: HTMLElement | null } = {
  edit: null,
  bulk: null,
};

/**
 * Finds (creating if needed) the mount point for a language field row,
 * positioned **right after `anchor`**.
 *
 * Why not patch the component that renders that row: StudioSelect renders
 * inside a `<Col>`, so anything added there is nested inside that column and
 * the label column no longer lines up with the native fields. What is needed
 * is a sibling field row, so one has to be inserted into the DOM.
 *
 * Conveniently Stash leaves a data-field attribute on these rows (renderField
 * on the edit panel, BulkUpdateFormGroup in the bulk dialog), which makes a far
 * more stable anchor than walking the structure. Finding that anchor is the
 * callers' business: the edit panel's is a plain query, and the bulk dialog's has
 * to be scoped to the dialog (see bulkAnchor).
 *
 * `key` is per-anchor so the edit panel and the bulk dialog each keep their own
 * mount point; they are never on screen at the same time.
 */
function ensureHostAfter(
  anchor: Element | null,
  key: string
): HTMLElement | null {
  if (!anchor?.parentNode) {
    fieldHosts[key] = null;
    return null;
  }

  let host = fieldHosts[key];
  if (!host) {
    host = document.createElement("div");
    host.className = FIELD_HOST_CLASS;
    fieldHosts[key] = host;
  }

  // A React re-render may displace it; keep it directly after the studio row.
  // The reference node is nextElementSibling rather than nextSibling: it is
  // the same property the idempotency check above uses, and a stray whitespace
  // text node between the two does not change the position either way.
  if (
    host.parentNode !== anchor.parentNode ||
    anchor.nextElementSibling !== host
  ) {
    anchor.parentNode.insertBefore(host, anchor.nextElementSibling);
  }

  return host;
}

/** The gallery edit panel's mount point (see LanguageRow) */
function ensureFieldHost(): HTMLElement | null {
  return ensureHostAfter(document.querySelector(EDIT_ANCHOR), "edit");
}

/** The bulk edit dialog's mount point (see BulkFieldsRow) */
function ensureBulkFieldHost(): HTMLElement | null {
  return ensureHostAfter(bulkAnchor(), "bulk");
}

/**
 * What this half makes of the page it is on, for a console.
 *
 * `MangaTools.diag()` — nothing in the plugin reads it. It exists because this
 * file keeps meeting the same shape of failure: a row that should be on the page
 * is not, and the console says nothing at all, because the two things that decide
 * it — a patch onto a component name Stash may not have, and a guard reading a
 * route the plugin may never have learned — are both silent by construction.
 * `noteFired` covers the first. This covers the rest, by reporting the inputs
 * those guards read rather than the conclusion they reached:
 *
 *   url / path          the browser's path, the path checks' answer, and the last
 *                       one Stash announced. A disagreement here is the whole of
 *                       one entire class of bug (see pathNow)
 *   locationListener    whether the plugin hears about navigation at all
 *   bulkRenders         whether the bulk rows ever ran — 0 with a dialog open means
 *                       the RatingSystem patch did not fire, not that a guard said no
 *   bulkAnchor / hosts  where the rows would go, and whether that mount point is
 *                       actually on the page ("detached" is a node React has
 *                       dropped out of the document while the plugin still portals
 *                       into it)
 */
NS.diag = () => ({
  url: window.location.pathname || "",
  path: pathNow(),
  rememberedPath: currentPath,
  galleryContext: isGalleryContext(),
  galleryId: currentGalleryId(),
  started,
  locationListener,
  eventApi: !!PluginApi.Event?.addEventListener,
  bulkRenders,
  bulkAnchor: !!bulkAnchor(),
  hosts: Object.keys(fieldHosts).map((key): [string, string] => [
    key,
    fieldHosts[key]
      ? fieldHosts[key]?.parentNode
        ? "attached"
        : "detached"
      : "none",
  ]),
});

/**
 * Localised text for the "language" label.
 *
 * Reuses config.ui.language.heading straight out of Stash's own locale files.
 * It exists in **every** locale Stash ships (en-GB "Language", zh-CN "语言",
 * ja-JP "言語", …), so this gets all of Stash's UI languages for free instead
 * of maintaining a label table here.
 */
function fieldLabel(intl: MangaToolsIntl): string {
  return intl.formatMessage({
    id: "config.ui.language.heading",
    defaultMessage: "Language",
  });
}

// 4. Detail page: show the language as "flag + localised name", positioned
//    under "photographer", and hang the censorship button off the toolbar.
//
//    Note the target is CustomFields (plural, the container), not CustomField —
//    the latter is a plain React.FC with no PatchComponent wrapper, so patching
//    it reports no error and simply never runs.
//
//    Both of this plugin's fields are lifted out of `values`, so Stash does not
//    also draw them as raw custom-field rows; everything else is handed to the
//    original untouched. The panel portals itself under "photographer" and
//    draws the language entry there, and the censorship button portals itself
//    into the toolbar —
//    which is why this component is where it is rendered from. It is the one
//    patchable component on this page that has the gallery's custom fields in
//    hand, and the toolbar's own component is not patchable at all.
//
//    The button does not depend on those fields being there, only on this being
//    a gallery: `CustomFields` is rendered by the gallery detail panel whatever
//    a gallery carries, including nothing.
registerPatch("instead", "CustomFields", (...args: unknown[]) => {
  const props = args[0] as { values?: CustomFieldsMap; fullWidth?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFields");

  // Subscribed, because what this renders depends on this plugin's own state:
  // whether the gallery is marked, which is now answered from the store rather
  // than from the values Stash passed in (see isMarkedNow). Without this, marking
  // a gallery on this very page would not draw the panel — nothing here would
  // re-render, since the write deliberately leaves Apollo's cache alone.
  useGlobalVersion();

  const values = props.values;
  if (!values || typeof values !== "object") return <Original {...props} />;

  const rest = Object.assign({}, values) as CustomFieldsMap;
  let lifted = false;

  Object.keys(values).forEach((k) => {
    // A key that is *not* taken over stays in `rest`, and Stash draws its own row for it —
    // with the value untouched, which is the whole of what "given back" means here.
    if (!takesOverFieldRow(k)) return;
    lifted = true;
    delete rest[k];
  });

  // Empty on every entity's page but a gallery's, which is what keeps the
  // button off a scene's or a performer's detail page.
  const galleryId = currentGalleryId();

  // Made here rather than at module scope, for the reason on guardedBlock: one
  // class, made once, so the block below is not remounted on every render.
  const Guard = guardedBlock();

  // Nothing to lift out and no toolbar to put a button in: hand the original
  // component its own props object back, unwrapped. This is the common case on
  // every non-gallery entity.
  if (!lifted && !galleryId) return <Original {...props} />;

  return (
    <>
      {/* Stash passed `values`, and `rest` differs from it only when something
          of ours was lifted out; passing the original props object otherwise
          keeps the identity its own memoisation compares. */}
      <Original
        {...(lifted ? Object.assign({}, props, { values: rest }) : props)}
      />
      {/*
        The panel, in the details tab, where the plain language row used to be.
        Drawn for a manga gallery that carries a value; the panel itself drops
        out entirely when none of its three fields is set.
      */}
      {galleryId && isMarkedNow(galleryId, values) ? (
        <Guard name="manga panel">
          <MangaDetailsPanel values={values} />
        </Guard>
      ) : null}
      {/*
        Rendered whether or not this gallery carries the field yet, and that is
        the whole point: this button is the only way to set a mark, so gating it
        on a mark already existing would leave every gallery permanently
        unmarked. An absent key is simply the "not marked" state, and the first
        click writes the canonical spelling.
      */}
      {galleryId && CAN_WRITE ? (
        <GalleryToolbar galleryId={galleryId} values={values} />
      ) : null}
    </>
  );
});

// 5. Settings page: swap the stock per-setting input for the multiselect above,
//    but only for this plugin — every other plugin's settings go straight back
//    to the original component untouched.
registerPatch("instead", "PluginSettings", (...args: unknown[]) => {
  const props = args[0] as { pluginID?: string };
  const Original = originalFrom(args);
  noteFired("PluginSettings");

  // The ID is not handed down: the plugin's own is a constant here, and it is what
  // everything that writes settings uses — see settingsInput and saveSettings, which is
  // where the whole map is built and which owns the ID rather than taking it.
  if (props.pluginID === PLUGIN_ID) {
    return <MangaToolsSettings />;
  }

  return <Original {...props} />;
});

// 6. Bulk edit: records which galleries are selected. `before` only observes —
//    the props are handed straight back, so GalleryList renders exactly as it
//    would without the plugin. This is the only way to see the selection: the
//    dialog that uses it is not patchable.
registerPatch("before", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { selectedIds?: unknown };
  noteFired("GalleryList");
  captureSelection(props ? props.selectedIds : null);
  return args;
});

// 7. The gallery list's filter sections. Stash wraps its own sidebar filter
//    sections in a patch container, `FilteredGalleryList.SidebarSections`, and
//    that is where these go: pushed in front of Stash's own, they land where
//    they have always been — after the sidebar's saved-filters header, before
//    its studio filter. Nothing is inserted into the DOM for this, and nothing
//    has to be found again after a re-render.
//
//    Two things make it work, and both are why this is not done from the list
//    below. The container is handed nothing but its children, so the filter
//    model has to come from somewhere else: it is published from
//    `FilteredGalleryList`'s own output (see the patch above), which React
//    renders before the sidebar and so before this container — the sections read
//    it on the same pass. Publishing from `GalleryList` instead, whose props do
//    carry the model, does not work: that is the list of cards, rendered *after*
//    the sidebar, so the sections would read nothing on the first pass and only
//    appear a render later.
registerPatch("after", "FilteredGalleryList.SidebarSections", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList.SidebarSections");

  const filter = currentSidebarFilter();
  if (!filter) return result;

  return (
    <>
      {/* One section per field, each drawn only while its field is. The manga
          section is not one of them: the mark is what makes a gallery this
          plugin's at all, so it is offered whatever the four switches say — and
          it is first, because it is the one that is always there.

          The order is the fields' own: the two that describe what a gallery *is*
          (which language, whose translation), then the two that qualify the
          edition (censorship, and whether it is the original). */}
      <SidebarMangaFilter filter={filter} />
      {NS.fieldShowing("language") ? (
        <SidebarLanguageFilter filter={filter} />
      ) : null}
      {NS.fieldShowing("censorship") ? (
        <SidebarCensorshipFilter filter={filter} />
      ) : null}
      {NS.fieldShowing("translationGroup") ? (
        <SidebarTranslationGroupFilter filter={filter} />
      ) : null}
      {NS.fieldShowing("original") ? (
        <SidebarOriginalFilter filter={filter} />
      ) : null}
      {result}
    </>
  );
});

// 7b. Publishes the filter the sidebar's sections are built from.
//
//    `FilteredGalleryList` creates the model (`useFilteredItemList`) and passes
//    it down to everything that uses it; nothing above it has it, and the
//    sidebar's container is handed only children. An `after` patch sees the
//    component's output — the element tree, with the model on the props of the
//    elements that were given it — while still running *before* React descends
//    into that tree, which is exactly the window the sidebar needs.
//
//    The walk is recursive rather than a path through `SidebarPane`/`Sidebar`/
//    `SidebarContent`: that tree is Stash's, and one of those being renamed or
//    wrapped would silently leave the sections unbuilt.
registerPatch("after", "FilteredGalleryList", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList");

  // The container the sections are mounted through, checked here rather than at
  // load: components are registered as their module loads, and this one may not
  // exist yet when the plugin does. Rendering the list is the proof that its
  // module is loaded, and a Stash without it — it arrived in v0.31 — would
  // otherwise lose the three sections without a word.
  if (!warnedMissingSidebarContainer && !hasSidebarSectionsContainer()) {
    warnedMissingSidebarContainer = true;
    console.error(
      "[mangaTools] this Stash has no FilteredGalleryList.SidebarSections, so " +
        "the language, censorship and manga filter sections are unavailable. " +
        "Stash v0.31 added the patch container they are mounted through."
    );
  }

  publishSidebarFilter(findFilter(result));
  return result;
});

// 8. The filter dialog's card. Rendered from `GalleryList` because that is the
//    component with the model in hand on this page; the card portals itself into
//    the dialog through the DOM, since a dialog is not part of the list's tree.
registerPatch("instead", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { filter?: MangaToolsFilterModel };
  const Original = originalFrom(args);
  noteFired("GalleryList.filter");

  // The filter dialog builds its cards from a shared options array that the
  // model reaches. Registering here is the first moment that array is in hand;
  // the call is idempotent and the array is only ever pushed to once. Skipped
  // entirely while the language field is off: a card for a field this plugin does
  // not manage is a way into a filter nothing would then draw.
  if (props.filter && NS.fieldShowing("language")) {
    registerLanguageCriterionOption(props.filter);
  }

  return (
    <>
      {NS.fieldShowing("language") ? (
        <DialogLanguageFilter filter={props.filter as MangaToolsFilterModel} />
      ) : null}
      <Original {...props} />
    </>
  );
});

// 8. Bulk edit: mounts the manga rows into the bulk edit dialog. The dialog
//    itself is not a PatchComponent, so RatingSystem — the only patchable
//    component it renders — is used purely as a mount point; the rows are
//    positioned by the DOM anchor and their values reach the mutation through
//    installBulkLink, not through the dialog.
//
//    `after` for the same reason as the card, and one more: RatingSystem is
//    rendered by Stash's own scene and gallery pages with a rating system the
//    user chose, so leaving its output exactly as it was is worth more here than
//    anywhere else.
registerPatch("after", "RatingSystem", (...args: unknown[]) => {
  noteFired("RatingSystem");

  return (
    <>
      {resultFrom(args)}
      <BulkFieldsRow />
    </>
  );
});

/**
 * Brings the tools half up: the settings refresh, the store's first fetch, the
 * poll behind it, and the location listener.
 *
 * The patches above had no part in this — they registered themselves as the file
 * loaded, and each one is guarded on its own (see registerPatch), so none of them
 * can throw. This is the whole of what a caller has to *do*, and the caller is
 * the shared entry (`src/mangaTools.tsx`), which calls it inside its own guard:
 * a Stash this half cannot start on costs the tools and not the reader.
 *
 * Nothing calls it here. It used to be called from the bottom of this file, back
 * when this file was the entry — one bundle means one entry, and the load-time
 * work of both halves is now the shared one's to start.
 */
export function install(): void {
  start();
}
