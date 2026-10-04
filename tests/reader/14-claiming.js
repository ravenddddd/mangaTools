/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  state,
  shown,
  loggedErrors,
  runSection,
  settle,
  errorsSince,
  mountBridge,
  container,
  drawn,
  CHAPTERS_VIEW,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * Paging past what the lightbox has loaded makes it fetch, and while it fetches it
   * shows a spinner *instead of* its header and its carousel. That is not a lightbox
   * this plugin cannot read — it is one that is busy — and reading it as the former is
   * how a reader ended up watching a spinner with the spread view switched off behind
   * it.
   */
  /**
   * The lightbox is claimed before the gallery has answered.
   *
   * Stash opens it wearing its own chrome, and the query that says what to draw
   * instead takes a round trip: without this the reader watches Stash's own counter
   * and Stash's own page for the length of it, and then watches them be replaced.
   */
  await runSection(
    "the lightbox is claimed before its pages are read",
    async () => {
      state.holdGallery = true;

      const { box } = await startReader({
        galleryId: "53",
        on: true,
        total: 8,
        ids: CHAPTERS_VIEW.map(String),
        expectSwitch: false,
      });

      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-takeover"),
        true,
        "the lightbox is taken over the moment it is one of this gallery's, before " +
          "there is anything to draw in it"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "and its own carousel is out of the way with it, rather than showing a page " +
          "the reader is not going to be shown"
      );

      // Let it answer, so nothing is left in flight for the sections after this one.
      const release = state.holdGallery;
      state.holdGallery = null;
      release();
      await settle();
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-spread") !== null,
        true,
        "and once it has answered, the pages are drawn as usual"
      );
      stopReader(box);
    }
  );

  await runSection(
    "a busy lightbox is waited out, not given up on",
    async () => {
      const { box } = await startReader({
        galleryId: "8",
        on: true,
        search: "?sortby=title&perPage=500",
      });
      const wasDrawn = drawn();
      const at = loggedErrors.length;

      box.loading(true);
      dom.flush();
      await settle();

      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "a lightbox fetching its next page is not a fault to report"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "and the reader is still on: Stash's spinner is what is on screen, which is " +
          "Stash's business, and the spread view has not switched itself off behind it"
      );

      // Back, and drawing again — the screen the reader was on, redrawn.
      box.loading(false);
      dom.flush();
      await settle();
      assert.deepStrictEqual(drawn(), wasDrawn, "and it picks up where it was");

      stopReader(box);
    }
  );

  await runSection(
    "a gallery that is not manga gets nothing of ours",
    async () => {
      shown.length = 0;
      mountBridge();
      const at = loggedErrors.length;

      // The switch on, Stash's own chapters on the gallery, and pages to spare:
      // everything this plugin could do here, it does not — because the gallery is not
      // marked manga, which is the whole of what makes one this plugin's business.
      const { box } = await startReader({
        galleryId: "61",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
        expectSwitch: false,
      });
      await settle();

      assert.strictEqual(
        (box.popover
          ? box.popover.querySelector(".manga-reader-options")
          : null) === null,
        true,
        "no switch of this plugin's in its options menu"
      );
      assert.strictEqual(container() === null, true, "nothing drawn over it");
      assert.deepStrictEqual(shown, [], "and nothing handed to its lightbox");
      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "and it is not even read, so nothing is reported about it either"
      );

      stopReader(box);
    }
  );
};
