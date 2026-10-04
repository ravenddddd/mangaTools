/**
 * What this half makes of the page it is on, for a console.
 *
 * `MangaTools.diag()` — nothing in the plugin reads it, and that is the whole of
 * what it is for: everything else in this half is drawn or written, and this is
 * the one thing that only answers questions. It exists because this plugin keeps
 * meeting one shape of failure — a row that should be on the page is not, and the
 * console says nothing at all — because the two things that decide it, a patch
 * onto a component name Stash may not have and a guard reading a route the plugin
 * may never have learned, are both silent by construction. `noteFired` in
 * patches.ts covers the first; this covers the rest, by reporting the inputs those
 * guards read rather than the conclusion they reached:
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
 *
 * A module of its own rather than a neighbour of the logging it completes: it
 * reads what three modules hold — the core's state, the hosts' mount points, the
 * bulk dialog's render count — and bulk.tsx imports patches.ts for noteOnce, so a
 * diagnostic kept there would make this half's one-way dependency a cycle.
 */
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import {
  currentGalleryId,
  currentPath,
  isGalleryContext,
  locationListener,
  pathNow,
  started,
} from "./core";
import { bulkAnchor, fieldHosts } from "./hosts";
import { bulkRenders } from "./bulk";

const PluginApi = requirePluginApi();

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
