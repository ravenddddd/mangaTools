/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  container,
  drawn,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * The wheel, and the press and drag: Stash's two ways of looking closer, which
   * this half had lost with the images it replaced. Stash's zoom acts on the image
   * inside its carousel — the carousel this half hides — so a reader who zooms a
   * page in Stash's lightbox expects the same wheel here, and the same hand.
   *
   * The arithmetic is pinned on its own, by calling it (see the section after this
   * one). What is pinned here is that the two gestures reach it, and what they leave
   * on the screen — including the one thing that must *not* happen: a drag ending in
   * a click, which would turn the page for the trouble of moving it.
   */
  await runSection(
    "the wheel turns, ctrl+wheel zooms, and the drag pans",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const spread = container();
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const transform = () => spread.style.transform;
      const zoomButton = () => chrome.querySelector(".manga-reader-zoom");
      const offered = () =>
        zoomButton().getAttribute("data-manga-reader-hidden") === null;
      const wheel = (deltaY, init) =>
        spread.dispatch(
          "wheel",
          dom.makeEvent("wheel", Object.assign({ deltaY }, init))
        );

      // What the browser would report for a page, which is what says which half of it
      // a click landed on. The test world has no layout, so a test that means to click
      // a page has to say how wide it is.
      const laidOut = () => {
        for (const page of spread.children) {
          page.children[0].offsetWidth = 500;
          page.children[0].offsetHeight = 800;
        }
      };

      laidOut();
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(1)",
        "the pages are drawn fitted and centred"
      );
      assert.strictEqual(
        spread.children[0].children[0].draggable,
        false,
        "and each page says it is not draggable: a browser's own drag of an image is " +
          "a drag of the file, and it swallows the moves a pan is made of"
      );
      assert.strictEqual(offered(), false, "so there is no zoom to reset");

      // Turning, first, because that is what this wheel does now. One notch is one
      // screen: a mouse reports about a hundred pixels for one, and the reader is on
      // the cover of a two-page gallery.
      const opened = drawn();
      wheel(120);
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "a wheel towards the reader turns a screen — the gesture a hand on a wheel in " +
          "front of a book makes"
      );
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(1)",
        "and it is a turn, not a zoom: the pages are still the size they were"
      );

      // A trackpad sends a burst of small events for one flick, so what the wheel has
      // travelled is added up: part of a notch does nothing, and the rest of it is kept.
      // The first notch left a fifth of itself behind, and these three are one notch
      // back the long way round.
      const turned = drawn();
      wheel(-40);
      wheel(-40);
      assert.deepStrictEqual(
        drawn(),
        turned,
        "two thirds of a notch is not a screen"
      );
      wheel(-40);
      assert.deepStrictEqual(
        drawn(),
        opened,
        "…and what was left of the first notch makes the third of it one: a notch is " +
          "a screen, and no more"
      );

      // Forgotten once the wheel has been still — a wheel that drifted for a while
      // should not turn a page on a flick nobody made.
      await new Promise((resolve) =>
        setTimeout(resolve, NR.WHEEL_REST_MS + 40)
      );
      wheel(-80);
      assert.deepStrictEqual(
        drawn(),
        opened,
        "and what it had travelled is forgotten once the wheel stops, so a slow drift " +
          "never adds up to a turn"
      );

      // Ctrl, and a browser's own page zoom lives on the same chord.
      wheel(-100, { ctrlKey: true });
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(1.1)",
        "ctrl+wheel away from the reader zooms in — Stash's own 10% a notch"
      );
      assert.deepStrictEqual(drawn(), opened, "…and a zoom is not a turn");
      assert.strictEqual(
        offered(),
        true,
        "and the header offers to put it back"
      );

      wheel(100, { ctrlKey: true });
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(1)",
        "a notch back lands exactly on the fitted size, not near it"
      );

      for (let i = 0; i < 30; i++) wheel(100, { ctrlKey: true });
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(0.1)",
        "and zooming out stops at a tenth rather than at nothing"
      );

      for (let i = 0; i < 60; i++) wheel(-100, { ctrlKey: true });
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(8)",
        "while zooming in stops at eight — a ceiling Stash has not got, because " +
          "past it there is no reading and no way back"
      );

      // One notch in from the ceiling, and then the drag. Read off the transform
      // rather than assumed: what the wheel did is this test's subject too.
      wheel(100, { ctrlKey: true });
      const scale = /scale\((.*)\)$/.exec(transform())[1];
      // A press on the *space* around the pages, which is not a press on them: Stash's
      // own drag is the image's handler, and this one is on the whole picture area, so
      // it used to move the book from the letterbox too. Dispatched on the container,
      // which is what a press beside the pages lands on.
      spread.dispatch(
        "mousedown",
        dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
      );
      dom.document.dispatch(
        "mousemove",
        dom.makeEvent("mousemove", { clientX: 140, clientY: 100 })
      );
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(" + scale + ")",
        "a drag begun on the letterbox moves nothing"
      );
      dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));

      // And a press on a page, which is the drag Stash has: on the image, and bubbling
      // up to the container the way a real event does.
      spread.children[0].children[0].dispatchEvent(
        dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
      );
      dom.document.dispatch(
        "mousemove",
        dom.makeEvent("mousemove", { clientX: 140, clientY: 100 })
      );
      assert.strictEqual(
        transform(),
        "translate(40px, 0px) scale(" + scale + ")",
        "a drag on a page moves the pages by as much as the pointer moved"
      );

      // And on, past the edge of the screen: Stash's own image follows the pointer
      // wherever it goes, and what brings it back is the next image rather than a stop
      // at the border.
      dom.document.dispatch(
        "mousemove",
        dom.makeEvent("mousemove", { clientX: 5000, clientY: 100 })
      );
      assert.strictEqual(
        transform(),
        "translate(4900px, 0px) scale(" + scale + ")",
        "a drag carries on past the edge of the screen, as Stash's own does"
      );

      dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
      const before = drawn();
      dom.click(spread.children[0].children[0], { offsetX: 400 });
      assert.deepStrictEqual(
        drawn(),
        before,
        "the release that ends a drag is not a click: the page does not turn"
      );
      assert.strictEqual(
        transform(),
        "translate(4900px, 0px) scale(" + scale + ")",
        "and the pages stay where they were dragged to"
      );

      // A press that stayed put but lasted: also not a click. Stash's own other half
      // of the test, and the reason a reader who pressed and thought better of it is
      // not sent a page on.
      spread.children[0].children[0].dispatchEvent(
        dom.makeEvent("mousedown", {
          button: 0,
          clientX: 100,
          clientY: 100,
          timeStamp: 0,
        })
      );
      dom.document.dispatch(
        "mouseup",
        dom.makeEvent("mouseup", { timeStamp: NR.VIEW_CLICK_MS + 1 })
      );
      dom.click(spread.children[0].children[0], { offsetX: 400 });
      assert.deepStrictEqual(
        drawn(),
        before,
        "a press that lasted longer than a click is not one, even if the pointer " +
          "never moved"
      );

      // Shift+wheel scrolls the page rather than turning it, which is Stash's own
      // meaning for that chord and worth keeping: looking at a tall page without
      // turning away from it.
      const onShow = drawn();
      const wasAt = transform();
      wheel(120, { shiftKey: true });
      assert.notStrictEqual(
        transform(),
        wasAt,
        "shift+wheel scrolls the pages instead"
      );
      assert.deepStrictEqual(
        drawn(),
        onShow,
        "…and scrolls rather than turns: the screen on show is the one it was"
      );

      laidOut();
      dom.click(spread.children[0].children[0], { offsetX: 400 });
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "a click with no drag in front of it still turns the page"
      );
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(" + scale + ")",
        "and the next screen arrives centred, at the zoom the reader was reading at"
      );

      dom.click(zoomButton());
      assert.strictEqual(
        transform(),
        "translate(0px, 0px) scale(1)",
        "the header's reset puts the pages back to the fitted size"
      );
      assert.strictEqual(offered(), false, "and takes itself away again");

      stopReader(box);
    }
  );

  /**
   * The same zoom, with no DOM in the way.
   *
   * Read off Stash's own source rather than invented: the tenth of a step, the floor
   * at a tenth of the fit, and the snap to 1 that keeps a wheel that went out and
   * came back from leaving a hair of zoom behind — which the header would then offer
   * to reset, for a zoom nobody can see.
   */
  await runSection("the zoom's arithmetic, called on its own", () => {
    assert.deepStrictEqual(
      NR.fitView(),
      { zoom: 1, x: 0, y: 0 },
      "fitted is one, and the middle of the screen"
    );
    assert.deepStrictEqual(
      NR.centred({ zoom: 2, x: 30, y: -40 }),
      { zoom: 2, x: 0, y: 0 },
      "a turn takes the pan away and keeps the zoom"
    );
    assert.strictEqual(NR.isZoomed(NR.fitView()), false);
    assert.strictEqual(NR.isZoomed({ zoom: 1.1, x: 0, y: 0 }), true);

    assert.strictEqual(
      NR.zoomed(NR.fitView(), 1 + 0.01).zoom,
      1,
      "a hair off the fitted size is the fitted size"
    );
    assert.strictEqual(NR.zoomed(NR.fitView(), 1.1).zoom, 1.1);
    assert.strictEqual(NR.zoomed(NR.fitView(), 0.0001).zoom, NR.VIEW_MIN_ZOOM);
    assert.strictEqual(NR.zoomed(NR.fitView(), 1e6).zoom, NR.VIEW_MAX_ZOOM);

    // The pan is where the pointer took the pages and nothing else: no bounds, in
    // either direction, at the fitted size or past the edge. Stash's own drag is the
    // same, and the next screen is what puts them back in the middle.
    assert.deepStrictEqual(
      NR.panned(NR.fitView(), 100, 100),
      { zoom: 1, x: 100, y: 100 },
      "a fitted page follows the pointer as readily as a zoomed one does"
    );
    assert.deepStrictEqual(
      NR.panned({ zoom: 2, x: 40, y: 0 }, -30, 25),
      { zoom: 2, x: 10, y: 25 },
      "and from wherever it already was"
    );
    assert.deepStrictEqual(
      NR.panned({ zoom: 2, x: 0, y: 0 }, 9999, -9999),
      { zoom: 2, x: 9999, y: -9999 },
      "however far that is: past the edge of the screen is still somewhere a " +
        "reader meant to go, and Stash does not stop them either"
    );
  });

  /**
   * The bar's arithmetic, called on its own.
   *
   * The snapping is the whole feel of the thing and the least visible in a DOM test:
   * a page is a mark, and the boundary between two marks is halfway between them.
   */
  await runSection("the progress bar's arithmetic", () => {
    // Eight pages, so the marks are at 0, 1/8, 2/8 … and the boundaries at the
    // halves: 3.4 in page terms lands on 3, 3.5 on 4.
    assert.strictEqual(NR.pageAtFraction(3.4 / 8, 8), 3);
    assert.strictEqual(NR.pageAtFraction(3.5 / 8, 8), 4);
    assert.strictEqual(NR.pageAtFraction(3.6 / 8, 8), 4);
    assert.strictEqual(
      NR.pageAtFraction(1, 8),
      7,
      "the far end is the last page, not one past it"
    );
    assert.strictEqual(NR.pageAtFraction(-0.5, 8), 0);
    assert.strictEqual(NR.pageAtFraction(0.99, 8), 7);

    assert.strictEqual(NR.fractionOfPage(0, 40), 0);
    assert.strictEqual(NR.fractionOfPage(3, 40), 3 / 40);
    assert.strictEqual(
      NR.fractionOfPage(39, 40),
      39 / 40,
      "the last page is a mark short of the end, like every other page"
    );
    assert.strictEqual(NR.fractionOfPage(999, 40), 39 / 40);

    // A gallery with one page has no fractions to speak of, and no bar.
    assert.strictEqual(NR.fractionOfPage(0, 1), 0);
    assert.strictEqual(NR.pageAtFraction(0.7, 1), 0);

    // Ticks: one per chapter, where each begins, and two on one page are one tick.
    assert.deepStrictEqual(
      NR.progressNodes(
        [
          { title: "開幕", at: 0, to: 1, images: [] },
          { title: "中盤", at: 4, to: 5, images: [] },
          { title: "同名", at: 4, to: 4, images: [] },
          { title: "越界", at: 99, to: 99, images: [] },
        ],
        20,
        "zh-Hans"
      ),
      [
        { name: "開幕", at: 0, fraction: 0 },
        { name: "中盤", at: 4, fraction: 4 / 20 },
      ],
      "at the page each chapter begins on, and once"
    );

    // A chapter with no name is named by its place, in the reader's own language, by
    // the one helper the header's menu names it with — the two must not be able to
    // disagree about what a chapter is called.
    assert.deepStrictEqual(
      NR.progressNodes(
        [{ title: "", at: 2, to: 3, images: [] }],
        20,
        "zh-Hans"
      ),
      [{ name: "第 1 章", at: 2, fraction: 2 / 20 }],
      "an unnamed chapter is numbered in the interface's own words"
    );
    assert.deepStrictEqual(
      NR.progressNodes([{ title: "", at: 2, to: 3, images: [] }], 20, "en"),
      [{ name: "Chapter 1", at: 2, fraction: 2 / 20 }],
      "…which is the same number in a different place in English"
    );
  });
};
