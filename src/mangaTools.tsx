/**
 * Manga Tools — one plugin, two halves.
 *
 * **The tools half** (`src/tools`) *manages* a manga library: the manga mark and
 * the three fields that go with it (language, censorship, translation group) as
 * Stash custom fields, the controls for them on the edit page and in the bulk
 * dialog, the sidebar filters, the cover badges, the details panel. Its own
 * header — the top of `src/tools/index.tsx` — describes it in full.
 *
 * **The reader half** (`src/reader`) *reads* one: a two-page spread view for
 * Stash's lightbox, drawn beside Stash's carousel rather than in place of it, with
 * the pages paired the way a manga is printed. Its header is the top of
 * `src/reader/takeover.ts`.
 *
 * They are one plugin and one bundle because they keep arriving at the same
 * questions — which image is this, what order are the pages in, what does this
 * gallery say about itself — and two answers to those is the bug that takes
 * longest to find. What the two halves keep is separate: the tools half's settings
 * are Stash configuration, because they describe a library; the reader half's are
 * this browser's, because they describe how somebody likes to read (see
 * `src/reader/settings.ts`).
 *
 * **One bundle means one load, so each half is installed inside its own guard.** A
 * Stash that cannot start the tools half — an API it does not have, a target that
 * has moved — costs the tools and not the reader, and reading is where a mistake
 * is most annoying. That guard cannot catch anything evaluated in a module *body*,
 * which is why neither half resolves Stash's API there: see `guardedBlock` in
 * `src/tools/index.tsx`.
 */
import { requirePluginApi } from "./plugin-api";
import { install as installReader } from "./reader/takeover";
import { install as installTools } from "./tools";

// Throws if Stash has not injected its API, and that one is worth being loud
// about: it is the only failure both halves share, and a plugin that quietly did
// nothing would look like a plugin that failed to load.
requirePluginApi();

/**
 * Starts one half, and keeps a failure in it from taking the other down.
 *
 * Two entries rather than one wrapped call, because the reader is the half that
 * has to survive: whatever else is wrong with the page, a reader can still read.
 */
function isolate(half: string, install: () => void): void {
  try {
    install();
  } catch (e) {
    console.error(
      `[mangaTools] the ${half} could not be started, so it is not on the ` +
        "page. The other half is unaffected.",
      e
    );
  }
}

isolate("tools half", installTools);
isolate("reader half", installReader);
