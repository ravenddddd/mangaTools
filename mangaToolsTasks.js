/**
 * The plugin's server-side task: remove the fields this plugin wrote to galleries.
 *
 * **Why this is a task and not a loop in the settings page.** A library-wide write
 * is hundreds of mutations, and doing them from the page means a tab that has to
 * stay open, a browser holding the whole job in memory, and nothing to look at if
 * it is closed halfway. Stash's plugin tasks run in its own job queue instead:
 * progress and log lines go where every other job's do, the task can be cancelled
 * from the Tasks page, and closing the browser does not stop it. The settings page
 * only asks the questions (which fields, dry run) and queues it.
 *
 * It runs in Stash's own JavaScript engine (goja), not in Node or a browser, so it
 * is written for that: no `fetch`, no modules, no JSON import. The globals come
 * from `pkg/plugin/js.go` — `gql.Do(query, variables)`, `log.Info` / `log.Error`,
 * `log.Progress(0..1)`, and `input.Args` from the task's arguments.
 *
 * **Two steps, and the counts come out of the first one.** Galleries are found by
 * asking Stash for the ones that carry each field (`NOT_NULL`), then the union is
 * what gets cleared — a gallery with a stray language value but no mark is exactly
 * what an uninstall has to catch. The dry run stops after that step and says what
 * it would have done.
 */

/** This plugin's custom-field keys, by the names it writes them under */
const FIELDS = [
  "plugin.mangaTools.manga",
  "plugin.mangaTools.language",
  "plugin.mangaTools.censorship",
  "plugin.mangaTools.original",
  "plugin.mangaTools.translationGroup",
  "plugin.mangaTools.chapters",
];

/**
 * How many galleries one request carries.
 *
 * The server answers `bulkGalleryUpdate` with one row per gallery it touched, so
 * the response grows with the batch; a few hundred keeps both the request and the
 * answer small, and the queue's progress still moves in visible steps.
 */
const CHUNK = 200;

const FIND_QUERY =
  "query($f: [CustomFieldCriterionInput!]) {" +
  "  findGalleries(gallery_filter: { custom_fields: $f }, filter: { per_page: -1 }) {" +
  "    count" +
  "    galleries { id }" +
  "  }" +
  "}";

const CLEAR_MUTATION =
  "mutation($input: BulkGalleryUpdateInput!) {" +
  "  bulkGalleryUpdate(input: $input) {" +
  "    id" +
  "  }" +
  "}";

/** A string argument, trimmed, or "" */
function argString(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/^\s+|\s+$/g, "");
}

/** Whether an argument that means "yes" says yes — the settings page sends strings */
function argTrue(value) {
  if (value === true) return true;
  const text = argString(value).toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

/**
 * The fields this run is for.
 *
 * `all` (or nothing) is every one of them; anything else is a comma-separated
 * list, and a name this plugin does not write is dropped rather than guessed at —
 * a typo must not become a second, invented key on every gallery in the library.
 */
function chosenFields(raw) {
  const wanted = argString(raw).toLowerCase();
  if (wanted === "" || wanted === "all") return FIELDS.slice();

  const parts = wanted.split(",");
  const chosen = [];
  for (const part of parts) {
    const name = argString(part);
    for (const field of FIELDS) {
      if (field.toLowerCase() === name) chosen.push(field);
    }
  }
  return chosen;
}

/** The galleries carrying one field, as ids */
function galleriesWith(field) {
  const result = gql.Do(FIND_QUERY, {
    f: [{ field: field, modifier: "NOT_NULL" }],
  });
  if (!result) return [];
  const page = result.findGalleries;
  if (!page) return [];
  const found = page.galleries || [];
  return found.map((gallery) => gallery.id);
}

/** Clears the chosen fields from one batch of galleries */
function clearBatch(ids, fields) {
  gql.Do(CLEAR_MUTATION, {
    input: {
      ids: ids,
      custom_fields: { remove: fields },
    },
  });
}

function main() {
  const args = input.Args ? input.Args : {};
  const fields = chosenFields(args.fields);
  const dryRun = argTrue(args.dryRun);

  if (!fields.length) {
    return { Error: "no fields selected: " + argString(args.fields) };
  }

  // One query per field, and the counts are logged before anything is written:
  // they are the only answer to "what is about to go" that a dry run can give. One
  // line rather than one per field — the job log is read, not scanned, and the
  // dialog already shows the same numbers beside each switch.
  const seen = {};
  const ids = [];
  const parts = [];
  for (const field of fields) {
    const found = galleriesWith(field);
    for (const id of found) {
      const key = String(id);
      if (seen[key] === true) continue;
      seen[key] = true;
      ids.push(key);
    }
    parts.push(field.replace("plugin.mangaTools.", "") + " " + found.length);
  }

  log.Info(
    "Galleries with any of these fields: " +
      ids.length +
      " (" +
      parts.join(", ") +
      ")"
  );

  if (dryRun) {
    log.Info("Dry run complete; nothing was removed.");
    log.Progress(1);
    return {
      Output: "dry run: " + ids.length + " gallery(ies) would be cleared",
    };
  }

  let failed = 0;
  let cleared = 0;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const batch = ids.slice(start, start + CHUNK);
    try {
      clearBatch(batch, fields);
      cleared += batch.length;
    } catch (e) {
      failed += batch.length;
      log.Error(
        "could not clear galleries " +
          start +
          "-" +
          (start + batch.length - 1) +
          ": " +
          e
      );
    }
    log.Progress(ids.length ? (start + batch.length) / ids.length : 1);
  }

  log.Progress(1);
  log.Info("Done: " + cleared + " cleared, " + failed + " failed");
  if (failed > 0) {
    return {
      Error:
        cleared + " galleries cleared, " + failed + " failed — see the log",
    };
  }

  return { Output: "cleared " + cleared + " gallery(ies)" };
}

main();
