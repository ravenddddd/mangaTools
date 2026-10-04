/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  imageQueries,
  runSection,
  settle,
  turn,
  container,
  drawn,
  CHAPTERS_VIEW,
  CHAPTERS_PATH,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  await runSection(
    "turning it on draws the pages the lightbox is showing",
    async () => {
      // Read whether or not the mode is on — the chapters go to the lightbox either
      // way — so by the time this section runs the gallery has been read already, and
      // what is worth pinning is that turning the mode on does not ask again.
      const before = imageQueries().length;
      const { box } = await startReader({ on: true });

      assert.deepStrictEqual(
        imageQueries().slice(before),
        [],
        "a gallery already read is not asked for again when the mode is turned on"
      );
      assert.strictEqual(
        imageQueries()[0].fetchPolicy,
        "no-cache",
        "…and what was read is not written into Apollo's cache, where the lightbox's " +
          "own query lives"
      );

      const drawnBox = container();
      assert.ok(drawnBox, "and a container to draw them in");
      assert.strictEqual(
        drawnBox.parentNode === box.display,
        true,
        "inside the display area"
      );
      assert.ok(
        box.display.children.indexOf(drawnBox) >
          box.display.children.indexOf(box.carousel),
        "beside Stash's carousel rather than in place of it — which is what keeps " +
          "React free to re-render its own subtree without ours going with it. " +
          "Compared by position rather than by an index into markup this plugin " +
          "does not own, since Stash's chevrons sit in that row too"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "with the class that hides the carousel"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the cover alone, because that is the screen page 1 is on"
      );
      assert.ok(
        dom.preloaded.includes("/image/102/image"),
        "and the pages of the next screen are warmed, so a turn does not wait"
      );

      // Every way of turning ends in the same place: this is a click on Stash's own
      // chevron, and the reader's own position is what moves.
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "page 2 stands alone: its neighbour is the spread, and one page is not the " +
          "left half of a screen"
      );

      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/103/image"],
        "the spread takes a screen of its own"
      );

      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "and the pairing carries on after it — in reading order, which the " +
          "stylesheet reverses for a right-to-left book"
      );

      stopReader(box);
    }
  );

  await runSection(
    "a screen goes up when both of its images are there",
    async () => {
      const { box } = await startReader({ on: true });
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "precondition: the cover is up"
      );

      // Held from here: the next turn's images are coming, and are not here.
      dom.holdImages();
      turn(box, 3);
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the reader keeps the screen it has rather than showing one page of the next — " +
          "two images that arrive apart read as a flicker, not as a page"
      );

      dom.settleImages();
      await settle();
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "and the pair goes up together once both are ready"
      );

      stopReader(box);
    }
  );

  await runSection(
    "a slow image does not hold the screen forever",
    async () => {
      const { box } = await startReader({ on: true });
      dom.holdImages();
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "precondition: waiting, with the previous screen still up"
      );

      // The budget is the plugin's own, published for this: the wait ends when it
      // runs out, not when the bytes turn up. A page that never arrives must not be
      // able to leave the reader on a page they have already turned.
      await new Promise((resolve) =>
        setTimeout(resolve, NR.REVEAL_BUDGET_MS + 50)
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "past the budget, whatever has arrived is shown"
      );

      dom.settleImages();
      stopReader(box);
    }
  );

  await runSection(
    "a screen the reader has left is never shown late",
    async () => {
      const { box } = await startReader({ on: true });

      dom.holdImages();
      turn(box);
      turn(box);
      turn(box);

      dom.settleImages();
      await settle();
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "only the screen the reader is on: the one they turned past does not land on " +
          "top of it when its images finally arrive"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the images are asked for the way Stash asks for them",
    async () => {
      const { box } = await startReader({
        galleryId: "13",
        on: true,
        total: 2,
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/501/image?t=1700000001"],
        "the relative path with the version stamp the API published — which is what " +
          "makes it the same cache entry Stash's own lightbox fills, rather than a " +
          "second fetch of an image the browser already has"
      );
      assert.ok(
        dom.preloaded.includes("/image/502/image?t=1700000002"),
        "and the page being warmed is asked for with its own stamp"
      );

      stopReader(box);
    }
  );

  /**
   * The order is guessed from the URL, and the URL is not always right — Stash's
   * gallery page keeps its inner tabs in component state, so a lightbox opened
   * from the Chapters tab is path-ordered while the address bar still says
   * `?sortby=title` from the Images tab. A wrong guess pairs the wrong pages, so
   * it is checked against the image actually on screen and thrown away if it does
   * not match.
   */
  /**
   * The place is found by *which image* is showing, not by counting or by trusting the
   * order a URL named. The same image is the same image in any order, so this is the
   * one thing that cannot be wrong — and the reason nothing here has to agree with
   * Stash about how a gallery is sorted.
   */
  await runSection("the place is found by which image is showing", async () => {
    const before = imageQueries().length;
    const { box } = await startReader({
      galleryId: "41",
      on: true,
      total: 8,
      // The URL names title order while the carousel is showing path order — the case
      // that used to cost a second fetch, and now costs nothing, because where the
      // reader is has nothing to do with either order.
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_PATH.map(String),
    });

    assert.deepStrictEqual(
      imageQueries()
        .slice(before)
        .map((q) => q.variables.sort),
      ["title"],
      "the list is fetched in the order the URL names, and that is all it is used for"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "and what is drawn is the screen around the image the lightbox is showing"
    );
    stopReader(box);

    // The same gallery, the other way round: the pages drawn follow the carousel.
    const again = await startReader({
      galleryId: "42",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    assert.deepStrictEqual(
      drawn(),
      ["/image/701/image"],
      "whichever image it is showing is the one whose screen is drawn"
    );
    stopReader(again.box);
  });
};
