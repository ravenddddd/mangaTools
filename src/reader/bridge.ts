/**
 * The bridge to Stash's lightbox: a component inside its tree, and a handle for
 * the reader half.
 *
 * **Why this has to be a React component.** The lightbox's images, its index and
 * its chapter list are React state in a context at the top of the app, and context
 * does not cross React roots — a component mounted in a root of this plugin's own
 * would see the context's *default* value and set nothing. So the way in is to be
 * rendered inside Stash's tree, which is what a patch gives us: `patch.after` on a
 * component wraps its output, and this component rides along beside it, rendering
 * nothing of its own.
 *
 * **What the handle is for.** The reader owns the pages it draws and knows which
 * images they are; handing that list to the lightbox — along with chapters whose
 * numbers count in it — is what turns Stash's own chapter menu into a menu of this
 * plugin's chapters, with the jump Stash already knows how to do. See takeOver in
 * takeover.ts for when it is done and why it is only done on a verified list.
 *
 * Everything here is inert until the reader asks for something: the component
 * renders null, so a Stash with a thousand galleries looks exactly as it did.
 */
import { requirePluginApi } from "../plugin-api";
import type { MangaReaderPlacedChapter } from "./chapters";
import type { LightboxImage } from "./stash-lightbox";

/** What the reader asks the lightbox to show. */
export interface LightboxTakeover {
  images: LightboxImage[];
  /**
   * The chapters, already placed in that list — `at` is the index each one begins
   * at, which is the only thing the lightbox needs to be told where it starts.
   */
  chapters: MangaReaderPlacedChapter[];
  totalCount: number;
  /**
   * Where to start, for opening a lightbox that is closed. Left out when handing a
   * list to one that is already up, where the reader is looking at something and
   * must go on looking at it.
   */
  at?: number;
}

/**
 * The handles the mounted components publish, newest first.
 *
 * More than one bridge is mounted at a time — a gallery's page has a header and an
 * images tab, and either can be on screen when the lightbox is wanted — and each
 * one is a different component in Stash's tree with the same context behind it. A
 * single variable would be cleared by whichever unmounted first, so the last one
 * mounted is the one asked, and every one of them cleans up only itself.
 */
const handles: { takeOver(request: LightboxTakeover): void }[] = [];

/**
 * Whether a bridge is mounted — which is the question the reader has to ask
 * *before* handing over a list, since handing it to nobody would look exactly like
 * handing it over and would leave the menu as Stash's own empty one.
 */
export function bridged(): boolean {
  return handles.length > 0;
}

/**
 * Asks the lightbox to show this plugin's list instead.
 *
 * Nothing happens when no bridge is mounted, which is the honest answer: on a page
 * with no list behind the lightbox there is nothing to replace, and Stash's own
 * chapters — the ones it was opened with — are already there and already right.
 */
export function takeOver(request: LightboxTakeover): void {
  handles[handles.length - 1]?.takeOver(request);
}

/**
 * The component, which renders nothing and exists for its hook.
 *
 * The chapters are the hook's *second argument*, so `show` can only ever send the
 * array that was in scope when it was made — and a component that re-rendered on
 * every change of chapters would be a component whose `show` is a different
 * function each time, for no gain. So there is one array, made once, and a handover
 * writes into it: the reference `show` holds is the same object, and what Stash
 * reads when the lightbox renders is what was written a moment before.
 *
 * The array is this plugin's own — nothing else holds it — and the lightbox only
 * ever reads it, so writing to it is a message rather than a mutation of somebody
 * else's data.
 */
function LightboxBridge(): null {
  const api = requirePluginApi();
  const React = api.React;
  const entries = React.useRef<Entry[]>([]).current;

  const show = api.hooks.useLightbox({}, entries);

  React.useEffect(() => {
    const mine = {
      takeOver(request: LightboxTakeover) {
        entries.splice(0, entries.length, ...entriesFor(request));
        show({
          images: request.images,
          // One page of everything, so the lightbox never asks for another: this
          // list is the whole gallery, and a page callback would be a second way of
          // saying which images it holds.
          pages: 1,
          pageSize: request.images.length,
          totalCount: request.totalCount,
          // Only read when the lightbox mounts, which is how a chapter clicked on
          // the gallery page opens one — see the chapters tab.
          initialIndex: request.at,
        });
      },
    };

    handles.push(mine);
    return () => {
      const at = handles.indexOf(mine);
      if (at !== -1) handles.splice(at, 1);
    };
  }, [entries, show, api]);

  return null;
}

/**
 * The list, as Stash's own chapter entries.
 *
 * The number is one-based and counts in the images handed over, because that is
 * what `gotoPage` does with it — so it is exactly what makes Stash's own jump land
 * on the page this plugin means. Only chapters that were placed are here at all:
 * one whose every image is off the current screen has no place to jump to, and the
 * menu can only offer what it can reach.
 */
type Entry = { id: string; title: string; image_index: number };

function entriesFor(request: LightboxTakeover): Entry[] {
  const entries: Entry[] = [];

  for (let i = 0; i < request.chapters.length; i++) {
    const chapter = request.chapters[i];

    entries.push({
      id: "plugin.mangaTools.chapter." + i,
      title: chapter.title,
      image_index: chapter.at + 1,
    });
  }

  return entries;
}

/**
 * Registers the bridge against a component Stash renders wherever a gallery's
 * images are.
 *
 * `ImageList` because it is the list a gallery lightbox is opened from — the one
 * place a reader can be looking at a gallery's images when the lightbox appears
 * over them. It is also a component the gallery page's Images tab, the Images
 * page and a gallery's own lightbox all pass through, so one patch covers them.
 *
 * `after`, so the original output is untouched: this adds a sibling that renders
 * nothing, and a component with hooks inside it cannot be broken by a patch that
 * never calls it.
 */
export function installBridge(): void {
  const api = requirePluginApi();
  const React = api.React;

  // Two places, because the two things that want a lightbox are not on the same
  // page: the images list is what a gallery's lightbox is opened from, and the
  // header is on every detail page — including the Chapters tab, where this plugin
  // renders the chapters and has to be able to open the lightbox itself.
  for (const target of ["ImageList", "HeaderImage"]) {
    installAgainst(api, React, target);
  }
}

function installAgainst(
  api: ReturnType<typeof requirePluginApi>,
  React: ReturnType<typeof requirePluginApi>["React"],
  target: string
): void {
  api.patch.after(target, (...args: unknown[]) => {
    // The rendered result of the component this wrapped — see the note on `after`
    // in plugin-api.ts for why it is the last argument rather than the first.
    const result = args[args.length - 1] as React.ReactNode;

    return React.createElement(
      React.Fragment,
      null,
      result,
      React.createElement(LightboxBridge)
    );
  });
}
