/**
 * Registering a patch, and the two once-only logs that say what it did.
 *
 * Both logs exist for the same reason and cover the two halves of it. A patch
 * whose target Stash does not have raises nothing — the callback is pushed onto a
 * list nobody reads — so `noteFired` is the only evidence that a patch took
 * effect at all. A guard that decides not to draw something is silent by
 * construction, so `noteOnce` is the only place that can say why a row is missing.
 *
 * They are here rather than in the entry file because a surface calls them: the
 * bulk rows report a mount point they could not place. Everything else that
 * registers a patch is in index.tsx, and reads these from here.
 */
import { requirePluginApi } from "../plugin-api";
import type { MangaToolsPatchFn } from "../plugin-api";

const PluginApi = requirePluginApi();

/** Registers a patch, and keeps one failing to register from taking the rest of
 *  the plugin with it.
 *
 * A patch whose *target does not exist* is not what this guards: Stash only
 * pushes the callback onto a list, so a name it has never heard of registers
 * happily and simply never fires — which is what `noteFired`'s log is for.
 *
 * What it guards is the API surface itself. index.tsx runs top to bottom at load
 * time, so a `PluginApi.patch` that is missing or renamed — a Stash older or
 * newer than this plugin expects — would throw where it stands and stop that
 * module, and every patch *below* it would silently never register. A half-working
 * plugin with no error is the worst of both outcomes; this turns it into one line
 * on the console naming the target that did not make it.
 */
export function registerPatch(
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

/** The targets and keys already logged, so each of the two below speaks once. */
const firedOnce: { [target: string]: boolean } = {};
const notedOnce: { [key: string]: boolean } = {};

/**
 * Records the first time a patch is actually invoked.
 *
 * Patching a component name that does not exist does not raise an error — it
 * simply never runs, leaving no trace to debug from. (This really happened:
 * CustomField looks like a patchable component but is a plain React.FC.)
 * This log is direct evidence that a patch took effect; it fires once per
 * target.
 */
export function noteFired(target: string): void {
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
export function noteOnce(key: string, message: string): void {
  if (notedOnce[key]) return;
  notedOnce[key] = true;
  console.warn("[mangaTools] " + message);
}
