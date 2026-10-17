/**
 * A cached gallery whose pages change under it.
 *
 * The page list is kept for the session — a gallery is opened and closed again and
 * again while it is being read — and nothing tells this half that an image was
 * deleted on the details page. So a cached gallery is revalidated when it is
 * opened: the count is asked, and the pages are read again only when it disagrees.
 * These sections are the reported bug (a deleted page still drawn) and the two
 * rules that keep a same-length list from costing a second read.
 */
const {
  assert,
  runSection,
  settle,
  state,
  startReader,
  stopReader,
  imageQueries,
  countQueries,
  drawn,
} = require("./harness.js");

module.exports = async () => {
  await runSection(
    "a page deleted between two openings is gone when the reader is opened again",
    async () => {
      const { box: first } = await startReader({
        galleryId: "71",
        on: false,
        at: 2,
        total: 3,
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/802/image"],
        "the first opening reads the gallery and draws the page it was opened on"
      );
      stopReader(first);

      // What the details page did while the lightbox was closed. Stash's own list
      // is what the next lightbox opens with, so the carousel is given the new one.
      state.galleries["71"].images.splice(1, 1);

      const before = imageQueries().length;
      const counted = countQueries().length;
      const { box: second } = await startReader({
        galleryId: "71",
        on: false,
        at: 2,
        total: 2,
        ids: ["801", "803"],
      });

      assert.strictEqual(
        countQueries().length,
        counted + 1,
        "opening a cached gallery asks how many images it has now"
      );
      assert.deepStrictEqual(
        imageQueries()
          .slice(before)
          .map((q) => q.variables.sort),
        ["path"],
        "…and reads the pages again because the count moved"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/803/image"],
        "the page the reader is on is still the one the lightbox is showing"
      );

      stopReader(second);
    }
  );

  await runSection(
    "a page deleted while the reader is on it leaves the reader where it was",
    async () => {
      const { box: first } = await startReader({
        galleryId: "72",
        on: false,
        at: 1,
        total: 3,
      });
      stopReader(first);

      // Hold the count question open, so the deletion can happen while it is out.
      state.holdCount = true;
      const { box: again } = await startReader({
        galleryId: "72",
        on: false,
        at: 2,
        total: 3,
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/812/image"],
        "the cached list draws at once, as it did before the change"
      );
      assert.strictEqual(
        typeof state.holdCount,
        "function",
        "with the count still out"
      );

      // The page the reader is on is the one that goes.
      state.galleries["72"].images.splice(1, 1);
      state.holdCount();
      state.holdCount = null;
      await settle();

      assert.deepStrictEqual(
        drawn(),
        ["/image/813/image"],
        "and the page that took its place is drawn, at the position it held"
      );

      stopReader(again);
    }
  );

  await runSection(
    "a cached gallery whose count still matches is not read again",
    async () => {
      const { box: first } = await startReader({ galleryId: "73", on: false });
      stopReader(first);

      const before = imageQueries().length;
      const counted = countQueries().length;
      const { box: again } = await startReader({ galleryId: "73", on: false });

      assert.strictEqual(
        countQueries().length,
        counted + 1,
        "the count is asked on every opening of a cached gallery"
      );
      assert.strictEqual(
        imageQueries().length,
        before,
        "…and an unchanged gallery is not read again"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/821/image"],
        "the pages in hand are what is drawn"
      );

      stopReader(again);
    }
  );
};
