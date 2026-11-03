/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const { assert, dom, runSection, NR, startReader, stopReader, settle } =
  require("./harness.js");

/** A pointer event, as the browser sends one for a finger */
const touch = (type, id, x, y, at, extra) =>
  dom.makeEvent(type, {
    pointerType: "touch",
    pointerId: id,
    clientX: x,
    clientY: y,
    timeStamp: at,
    ...(extra || {}),
  });

module.exports = async () => {
  /**
   * **The decisions, before the wiring.** What a finger's movement means is pure
   * arithmetic, and it is the part that can be wrong in a way no DOM test notices:
   * how far a tap may wander, how far a swipe must travel, which third a tap landed
   * in, when two taps are one, and how far a pinch has taken the zoom.
   */
  await runSection("touch decisions", () => {
    assert.strictEqual(
      NR.touchGesture(3, 4, 120),
      "tap",
      "a thumb on glass wanders a little, and that is still a tap"
    );
    assert.strictEqual(
      NR.touchGesture(0, 0, 900),
      "none",
      "a finger that rested is a reader looking, not asking for the next page"
    );
    assert.strictEqual(
      NR.touchGesture(80, 5, 300),
      "forward",
      "a swipe to the right is forwards — the paper book is turned that way"
    );
    assert.strictEqual(
      NR.touchGesture(-80, 5, 300),
      "back",
      "…and the other way"
    );
    assert.strictEqual(
      NR.touchGesture(60, 55, 300),
      "none",
      "a thumb travelling diagonally is nobody's page turn"
    );

    assert.strictEqual(NR.tapZone(10, 0, 900), -1, "the left third goes back");
    assert.strictEqual(
      NR.tapZone(450, 0, 900),
      0,
      "the middle third does nothing"
    );
    assert.strictEqual(NR.tapZone(890, 0, 900), 1, "the right third goes on");
    assert.strictEqual(
      NR.tapZone(450, 0, 0),
      0,
      "a box that cannot be measured is the middle: nothing is the honest answer"
    );

    assert.strictEqual(
      NR.isDoubleTap({ x: 10, y: 10, at: 1000 }, { x: 12, y: 11, at: 1200 }),
      true,
      "two taps close in time and place are one double tap"
    );
    assert.strictEqual(
      NR.isDoubleTap({ x: 10, y: 10, at: 1000 }, { x: 200, y: 10, at: 1200 }),
      false,
      "…but a second tap across the screen is a new gesture"
    );
    assert.strictEqual(
      NR.isDoubleTap({ x: 10, y: 10, at: 1000 }, { x: 10, y: 10, at: 2000 }),
      false,
      "…and one a second later is just the next tap"
    );

    assert.strictEqual(
      NR.pinched(1, 100, 200),
      2,
      "a pinch doubles the zoom when the fingers double their distance"
    );
    assert.strictEqual(
      NR.pinched(1, 100, 100),
      1,
      "…and leaves it alone when they do not move"
    );
    assert.strictEqual(
      NR.pinched(1, 100, 100000),
      NR.pinched(1, 100, 100000),
      "the ceiling is a ceiling"
    );
    assert.ok(
      NR.pinched(1, 100, 100000) <= 8,
      "and it is the same ceiling the wheel has"
    );
    assert.strictEqual(
      NR.pinched(1, 100, 101),
      1,
      "a pinch that comes back is the fit again, not a zoom nobody can see"
    );
  });

  /**
   * **The wiring.** A tap's thirds, a swipe's direction, and the click the browser
   * sends after every touch: it must not turn a second page.
   */
  await runSection("a tap turns one page, and its click does not", async () => {
    const { box } = await startReader({ galleryId: "8", on: false });
    const view = box.lightbox.querySelector(".manga-reader-spread");
    const counter = () =>
      box.lightbox.querySelector(".manga-reader-counter").textContent;
    view.rect = { left: 0, top: 0, width: 900, height: 600 };

    view.dispatch("pointerdown", touch("pointerdown", 1, 800, 300, 1000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 800, 300, 1080));
    assert.strictEqual(counter(), "2 / 5", "a tap on the right third turns on");

    // What the browser sends next: a click on the page it was over, whose right half
    // would turn forward again. It has already been answered for.
    const page = view.children[0].children[0];
    page.offsetWidth = 900;
    dom.click(page, { offsetX: 800, timeStamp: 1100 });
    assert.strictEqual(
      counter(),
      "2 / 5",
      "…and the click that follows it is swallowed: one touch, one page"
    );

    view.dispatch("pointerdown", touch("pointerdown", 1, 100, 300, 2000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 100, 300, 2050));
    assert.strictEqual(counter(), "1 / 5", "the left third goes back");

    // The middle is a reader touching the page: a thumb lands there.
    view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 3000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 3050));
    assert.strictEqual(
      counter(),
      "1 / 5",
      "the middle third does nothing at all"
    );

    stopReader(box);
  });

  await runSection("a swipe turns, rightwards forwards", async () => {
    const { box } = await startReader({ galleryId: "8", on: false });
    const view = box.lightbox.querySelector(".manga-reader-spread");
    const counter = () =>
      box.lightbox.querySelector(".manga-reader-counter").textContent;
    view.rect = { left: 0, top: 0, width: 900, height: 600 };

    view.dispatch("pointerdown", touch("pointerdown", 1, 400, 300, 4000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 600, 300, 4100));
    assert.strictEqual(counter(), "2 / 5", "a swipe to the right turns on");

    view.dispatch("pointerdown", touch("pointerdown", 1, 600, 300, 5000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 400, 300, 5100));
    assert.strictEqual(counter(), "1 / 5", "…and to the left turns back");

    stopReader(box);
  });

  /**
   * **Zoom, the way a hand on glass asks for it.** A double tap is a place; a pinch
   * is the point between two fingers; and a drag while zoomed moves the pages rather
   * than turning them.
   */
  await runSection("a double tap zooms, and again puts it back", async () => {
    const { box } = await startReader({ galleryId: "8", on: false });
    const view = box.lightbox.querySelector(".manga-reader-spread");
    view.rect = { left: 0, top: 0, width: 900, height: 600 };

    // The middle: a single tap there does nothing, which is what makes the second
    // one a double tap rather than a page turn.
    view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 6000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 6050));
    view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 6100));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 6150));

    const zoomed = /scale\(([\d.]+)\)/.exec(view.style.transform || "");
    assert.ok(zoomed, "a double tap zooms the pages");
    assert.strictEqual(
      Number(zoomed[1]),
      NR.TOUCH_ZOOM,
      "…to the one zoom a gesture has, about the place tapped"
    );

    view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 7000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 7050));
    view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 7100));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 7150));
    assert.ok(
      /scale\(1\)/.test(view.style.transform || ""),
      "and a second double tap puts the pages back at the fit"
    );

    stopReader(box);
  });

  await runSection(
    "a pinch zooms about the point between the fingers",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: false });
      const view = box.lightbox.querySelector(".manga-reader-spread");
      view.rect = { left: 0, top: 0, width: 900, height: 600 };

      view.dispatch("pointerdown", touch("pointerdown", 1, 400, 300, 8000));
      view.dispatch("pointerdown", touch("pointerdown", 2, 500, 300, 8000));
      dom.document.dispatch(
        "pointermove",
        touch("pointermove", 1, 300, 300, 8100)
      );
      dom.document.dispatch("pointerup", touch("pointerup", 1, 300, 300, 8200));
      dom.document.dispatch("pointerup", touch("pointerup", 2, 500, 300, 8250));

      const scale = /scale\(([\d.]+)\)/.exec(view.style.transform || "");
      assert.ok(scale, "two fingers zoom the pages");
      assert.strictEqual(
        Number(scale[1]),
        2,
        "…by the ratio the fingers spread, exactly as a pinch means"
      );

      stopReader(box);
    }
  );

  await runSection(
    "a drag on a zoomed page pans it, and does not turn",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: false });
      const view = box.lightbox.querySelector(".manga-reader-spread");
      const counter = () =>
        box.lightbox.querySelector(".manga-reader-counter").textContent;
      view.rect = { left: 0, top: 0, width: 900, height: 600 };

      // Zoom first, with a double tap, so there is something to pan.
      view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 9000));
      dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 9050));
      view.dispatch("pointerdown", touch("pointerdown", 1, 450, 300, 9100));
      dom.document.dispatch("pointerup", touch("pointerup", 1, 450, 300, 9150));

      const before = counter();
      view.dispatch("pointerdown", touch("pointerdown", 1, 400, 300, 9200));
      dom.document.dispatch(
        "pointermove",
        touch("pointermove", 1, 460, 340, 9250)
      );
      dom.document.dispatch("pointerup", touch("pointerup", 1, 460, 340, 9300));

      assert.ok(
        /translate\(60px, 40px\)/.test(view.style.transform || ""),
        "the pages follow the finger, as they follow a mouse"
      );
      assert.strictEqual(
        counter(),
        before,
        "and the release is a pan, not a page turn — even though it was far enough " +
          "to be a swipe"
      );

      stopReader(box);
    }
  );

  /**
   * **The column takes a pinch too**, and it is the wheel's own path: the pages are
   * drawn wider rather than transformed, and the reader keeps their place by
   * proportion (see zoomColumnTo). The mode is turned off and on again with the box
   * measured, which is how the column gets a plan to draw a window from — the stub
   * has no layout.
   */
  await runSection("a pinch zooms the column", async () => {
    const { box } = await startReader({
      galleryId: "81",
      at: 1,
      total: 30,
      mode: "scroll",
    });
    const view = box.lightbox.querySelector(".manga-reader-spread");

    view.rect = { left: 0, top: 0, width: 800, height: 600 };
    dom.click(box.lightbox.querySelector("#manga-reader-single-page"));
    await settle();
    dom.click(box.lightbox.querySelector("#manga-reader-scroll"));
    await settle();

    const row = () => view.querySelector(".manga-reader-scroll-page");
    const wide = parseFloat(row().style.width);

    view.dispatch("pointerdown", touch("pointerdown", 1, 400, 300, 10000));
    view.dispatch("pointerdown", touch("pointerdown", 2, 500, 300, 10000));
    dom.document.dispatch(
      "pointermove",
      touch("pointermove", 1, 300, 300, 10100)
    );
    dom.document.dispatch("pointerup", touch("pointerup", 1, 300, 300, 10200));
    dom.document.dispatch("pointerup", touch("pointerup", 2, 500, 300, 10250));

    assert.ok(
      Math.abs(NR.columnZoom() - 2) < 0.001,
      "the column's zoom is the ratio the fingers spread"
    );
    assert.ok(
      Math.abs(parseFloat(row().style.width) - wide * 2) < 0.01,
      "…and the pages are drawn wider, which is what zooming a scroll box means"
    );

    stopReader(box);
  });

  /**
   * **The bar is dragged with a finger.** Its own press and drag are pointer events
   * for anything that is not a mouse; a mouse is left to the three listeners it has
   * always had, so the sections above keep working.
   */
  await runSection("the bar takes a finger", async () => {
    const { box } = await startReader({ galleryId: "8", on: false });
    const bar = box.lightbox.querySelector(".manga-reader-progress");
    const track = bar.querySelector(".manga-reader-progress-track");
    const counter = () =>
      box.lightbox.querySelector(".manga-reader-counter").textContent;
    track.rect = { left: 0, top: 0, width: 800, height: 16 };

    track.dispatch("pointerdown", touch("pointerdown", 1, 400, 0, 11000));
    dom.document.dispatch("pointerup", touch("pointerup", 1, 400, 0, 11050));

    assert.strictEqual(
      counter(),
      "4 / 5",
      "a finger on the middle of the line is a jump to the page there"
    );

    stopReader(box);
  });
};
