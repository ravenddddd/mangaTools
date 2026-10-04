/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  savedReaderSettings,
  container,
  press,
  CHAPTERS_VIEW,
  NR,
  NS,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * The bar itself: drawn where the reader is, dragged to somewhere else.
   *
   * Two speeds are the point of it — the handle follows the pointer, the jump is
   * throttled — and both are pinned here, including the half that must not happen:
   * a drag that turns the page, or a press on the bar that pans it.
   */
  /**
   * The third mode: the whole gallery as one column, scrolled rather than turned.
   *
   * A second *renderer* rather than a third setting — a screen at a time is discrete
   * and a column is not — and what the two have in common is the reader's place: a
   * page. That is what lets the header, the counter, the chapter menu and the bar go
   * on meaning the same thing in all three modes, and it is what this section is
   * about.
   */
  await runSection(
    "the third mode lays the gallery out as a column",
    async () => {
      // The decision first, on its own: which page of a column the reader is looking at
      // is arithmetic over where the rows are, and this DOM cannot lay anything out.
      const box01 = (top, bottom) => ({ top, bottom });
      assert.strictEqual(
        NR.pageAtTop([box01(0, 500), box01(500, 1000), box01(1000, 1500)], 0),
        0,
        "the first row is the page at the top of an unscrolled column"
      );
      assert.strictEqual(
        NR.pageAtTop([box01(-1000, -500), box01(-500, 0), box01(0, 500)], 0),
        2,
        "…and after two pages of scrolling it is the third"
      );
      assert.strictEqual(
        NR.pageAtTop([box01(0, 500), box01(500, 1000)], 499),
        0,
        "a row still below the top edge is the page the reader is looking into"
      );
      assert.strictEqual(
        NR.pageAtTop([box01(-900, -400)], 0),
        0,
        "scrolled past the end, they are on the last page rather than on none"
      );
      assert.strictEqual(
        NR.pageAtTop([], 0),
        -1,
        "and an empty column has no answer"
      );

      const { box } = await startReader({ galleryId: "8", on: true });
      const counter = () =>
        box.lightbox.querySelector(".manga-reader-counter").textContent;

      const scroll = box.lightbox.querySelector("#manga-reader-scroll");
      assert.ok(
        scroll,
        "the options panel offers a third way to lay the pages out"
      );
      dom.click(scroll);

      const container = box.lightbox.querySelector(".manga-reader-spread");
      assert.strictEqual(
        container.classList.contains("is-scroll"),
        true,
        "the container a screen would go in becomes a scroll box"
      );

      const rows = [...container.querySelectorAll(".manga-reader-scroll-page")];
      assert.strictEqual(
        rows.length,
        5,
        "with a row for every page of the gallery"
      );
      assert.deepStrictEqual(
        rows.map((row) => row.querySelector("img").src),
        [
          "/image/401/image",
          "/image/402/image",
          "/image/403/image",
          "/image/404/image",
          "/image/405/image",
        ],
        "in reading order — the order both other modes read in, not path order"
      );
      assert.strictEqual(
        rows[0].style.aspectRatio,
        "1000 / 1500",
        "each row reserving the height its page asks for, so the column does not move " +
          "as the pictures arrive"
      );
      assert.strictEqual(
        rows[0].style.maxWidth,
        "1000px",
        "and no page drawn wider than the page it is"
      );
      assert.strictEqual(
        rows[0].querySelector("img").loading,
        "lazy",
        "with the browser left to fetch what the reader is coming to"
      );
      assert.strictEqual(
        counter(),
        "1 / 5",
        "the reader begins where they already were"
      );

      // The panel, in this mode: the pairing's own settings have nothing to say and the
      // fade has nothing to arrive — the column has no screen. What is left is the
      // selector that got the reader here.
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");
      const away = (node) =>
        node.getAttribute("data-manga-reader-hidden") !== null;
      assert.deepStrictEqual(
        [
          "#manga-reader-cover-alone",
          "#manga-reader-detect-spreads",
          "#manga-reader-offset",
        ].map((id) => {
          let at = panel.querySelector(id);
          while (at && !at.classList?.contains("manga-reader-row"))
            at = at.parentNode;
          return away(at);
        }),
        [true, true, true],
        "the pairing's settings are put away, as they are for a single page"
      );
      const groups = [...panel.querySelectorAll(".manga-reader-group")];
      assert.strictEqual(groups.length, 4, "the panel keeps its four groups");
      assert.strictEqual(
        away(groups[1]),
        true,
        "and the animation group is put away as well: the column has no screen to arrive"
      );
      assert.strictEqual(
        away(groups[0]),
        false,
        "while the group holding the selector stays, which is the one that got here"
      );
      // And the progress group stays too, which is the point of its being a group of its
      // own: the bar is drawn in all three modes — down the side of the picture in this
      // one — so it is the one group nothing here puts away.
      assert.strictEqual(
        away(groups[2]),
        false,
        "…and neither does the bar's, which is drawn in every mode there is"
      );
      assert.strictEqual(
        away(groups[3]),
        false,
        "…nor the wheel's, which is about a gesture rather than about a screen — and " +
          "whose rows say different things in this mode, since the wheel does"
      );

      // A turn in the column is a page and not a screenful: a screenful is however much
      // fits, which is a measurement, and a different answer on every window.
      rows.forEach((row, index) => {
        row.offsetTop = index * 500;
      });
      press("ArrowRight");
      assert.strictEqual(
        container.scrollTop,
        500,
        "a turn scrolls to the next page's row rather than drawing a screen"
      );
      assert.strictEqual(counter(), "2 / 5", "and the reader is on it");

      // The reader's own scrolling is the same thing from the other end. Where the rows
      // are on screen is what says which page is at the top, and nothing here lays
      // anything out, so the section says where they are — two pages scrolled past.
      container.rect = { left: 0, top: 0, width: 800, height: 600 };
      rows.forEach((row, index) => {
        row.rect = {
          left: 0,
          top: (index - 2) * 500,
          bottom: (index - 1) * 500,
          width: 800,
          height: 500,
        };
      });
      container.dispatch("scroll");
      assert.strictEqual(
        counter(),
        "3 / 5",
        "and scrolling to a page is being on that page"
      );

      // The wheel belongs to the browser here, which is the point of the mode: no
      // preventDefault, no ctrl chord of this plugin's, and no turn.
      const wheel = dom.makeEvent("wheel", { deltaY: 120 });
      container.dispatch("wheel", wheel);
      assert.strictEqual(
        wheel.defaultPrevented,
        false,
        "the wheel is left alone: scrolling is reading in the column"
      );
      assert.strictEqual(counter(), "3 / 5", "…and turns nothing");

      // Ctrl is the exception, and deliberately: that chord is the browser's *page*
      // zoom — the whole interface rather than the pages — and both screen modes take
      // it. Taken here too, so a reader does not zoom Stash itself by accident.
      const zooming = dom.makeEvent("wheel", { deltaY: -120, ctrlKey: true });
      container.dispatch("wheel", zooming);
      assert.strictEqual(
        zooming.defaultPrevented,
        true,
        "while ctrl+wheel is taken rather than passed to the browser's own zoom"
      );
      assert.strictEqual(counter(), "3 / 5", "…and zooms nothing either");

      // A page is not something to turn either: there is no page on either side of it,
      // only more of the same column.
      dom.click(rows[2].querySelector("img"));
      assert.strictEqual(counter(), "3 / 5", "a click on a page does nothing");

      // And the lightbox says the mode is on, which is what the stylesheet asks to know
      // about Stash's own next-page chevron — the one that sits where this bar is.
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-position-scrolling"),
        true,
        "the lightbox is marked while the column is up"
      );

      // What a *measured* box does, which is the whole of the fit — the smoke DOM has no
      // layout, so the sizes above are the fallback and a zeroed rect is what it takes
      // to stay on it. The zoom is put back to the fit first, because it is the
      // reader's rather than the column's and a section before this one left it a notch
      // in, so the numbers below are the fit's own and nothing else's.
      const bar = box.lightbox.querySelector(".manga-reader-progress");

      // Landscape: wider than it is tall, so the height is the fit. The bar's rect is
      // zeroed for this one, since this is about the cap rather than about the bar.
      bar.rect = { left: 0, top: 0, width: 0, height: 0 };
      container.rect = { left: 0, top: 0, width: 1600, height: 900 };
      dom.click(box.lightbox.querySelector(".manga-reader-zoom"));
      assert.strictEqual(
        rows[0].style.width,
        "900px",
        "landscape: a page is drawn as wide as the window is tall, not as wide as it is " +
          "— and the zoom's own reset puts the fit back on the way"
      );
      assert.strictEqual(
        rows[0].style.maxWidth,
        "900px",
        "…and the page's own pixels only matter under that"
      );

      // Portrait: the width is the smaller side, so the page fills it — less the corner
      // the reader's progress bar stands on, off *each* side, because the pages are
      // centred. A bar whose near edge is 26px from the area's right (its 10px of air
      // plus its 16px of track) and whose far side mirrors that 10px is 36px: 900 − 72.
      // Which is the whole point of measuring it rather than writing a number down — the
      // 10px is the stylesheet's, read back.
      bar.rect = { left: 874, top: 0, width: 16, height: 600 };
      container.rect = { left: 0, top: 0, width: 900, height: 1600 };
      dom.window.dispatchEvent(dom.makeEvent("resize", {}));
      assert.strictEqual(
        rows[0].style.width,
        "828px",
        "portrait: the page fills the width, less the bar's corner on both sides"
      );
      assert.strictEqual(
        container.style.paddingRight,
        undefined,
        "…by making the page smaller, not by moving it: the pages stay centred, so " +
          "nothing is padded and the reader finds the middle where it was"
      );

      // And a bar that is not drawn — the panel's own state, or a gallery with one
      // page — takes nothing off it.
      bar.rect = { left: 0, top: 0, width: 0, height: 0 };
      dom.window.dispatchEvent(dom.makeEvent("resize", {}));
      assert.strictEqual(
        rows[0].style.width,
        "900px",
        "an unmeasured bar costs the pages nothing"
      );

      // And a bar that arrives *after* the column was fitted is its own case, because the
      // fit is a measurement of it: the first pass of a lightbox can fit the column before
      // there is a bar in the picture area at all — one whose footer has not rendered, a
      // gallery whose pages are still being read — and that fit is the full width, with
      // the page's edge under a bar that was supposed to have room reserved for it.
      // Nothing here re-fits anything: no resize, no zoom, no reset, only the pass the
      // bar's own drawing comes with.
      bar.rect = { left: 874, top: 0, width: 16, height: 600 };
      dom.flush();
      assert.strictEqual(
        rows[0].style.width,
        "828px",
        "a bar measured after the column was fitted takes its room off it on a pass"
      );

      // Back to the unmeasured bar, so that the fit counted just below has a change to
      // make.
      bar.rect = { left: 0, top: 0, width: 0, height: 0 };
      dom.window.dispatchEvent(dom.makeEvent("resize", {}));

      // And a fit that would change nothing writes nothing. Not readable off the DOM —
      // a width written twice reads the same both times — so the rows' own style objects
      // are counted: the plugin writes through `style.width`, and every one of those
      // lands in these accessors. The pair of assertions is the point of it, since a
      // count that never moved would pass this whichever way the code was written.
      let writes = 0;
      const kept = rows.map((row) => {
        const values = { width: row.style.width, maxWidth: row.style.maxWidth };
        for (const name of ["width", "maxWidth"]) {
          Object.defineProperty(row.style, name, {
            configurable: true,
            get: () => values[name],
            set: (next) => {
              writes += 1;
              values[name] = next;
            },
          });
        }
        return values;
      });

      // The fit the resize above took off, put back on: the bar is measured again, so
      // there is a change to make.
      bar.rect = { left: 874, top: 0, width: 16, height: 600 };
      dom.window.dispatchEvent(dom.makeEvent("resize", {}));
      assert.ok(writes > 0, "a fit that changes the width writes it");
      assert.strictEqual(
        kept[0].width,
        "828px",
        "…and it is the same fit as before, seen through the counted styles"
      );

      writes = 0;
      dom.window.dispatchEvent(dom.makeEvent("resize", {}));
      assert.strictEqual(
        writes,
        0,
        "while a fit that changes nothing writes nothing: the rows are every page of " +
          "the gallery, and a resize drag re-fits them on every event of it"
      );

      // Put back: the mode is the browser's setting, and a section that left the reader
      // in the column would be choosing it for every section after this one.
      dom.click(box.lightbox.querySelector("#manga-reader-double-page"));
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-position-scrolling"),
        false,
        "and unmarked the moment the reader goes back to screens"
      );

      stopReader(box);
    }
  );

  /**
   * A column is built for the lightbox it is shown in, not just for the gallery.
   *
   * What was wrong: the column remembered the *gallery* it had been built for, and a
   * lightbox that closes takes its container with it — the next one is given a new one
   * by `ensureContainer`. So the second lightbox on the same gallery found a column it
   * believed was already there and built nothing, and the reader got an empty picture
   * area. Switching the mode back and forth inside that lightbox hid the bug rather
   * than showing it: that path goes through `removeColumn`, which is what clears the
   * memory.
   */
  await runSection(
    "a column is built again for a lightbox that opens after one",
    async () => {
      const pages = [
        "/image/401/image",
        "/image/402/image",
        "/image/403/image",
        "/image/404/image",
        "/image/405/image",
      ];
      const rowsIn = (box) => [
        ...box.lightbox.querySelectorAll(".manga-reader-scroll-page"),
      ];

      const first = await startReader({
        galleryId: "8",
        on: true,
        mode: "scroll",
      });
      assert.strictEqual(
        rowsIn(first.box).length,
        5,
        "a column of the gallery's pages"
      );
      stopReader(first.box);

      // The same gallery again, in the same mode: this is the lightbox that came up
      // empty.
      const again = await startReader({
        galleryId: "8",
        on: true,
        mode: "scroll",
      });
      assert.strictEqual(
        again.box.lightbox
          .querySelector(".manga-reader-spread")
          .classList.contains("is-scroll"),
        true,
        "the lightbox opens in the column"
      );
      assert.strictEqual(
        rowsIn(again.box).length,
        5,
        "with its pages in it rather than an empty picture area"
      );
      assert.deepStrictEqual(
        rowsIn(again.box).map((row) => row.querySelector("img").src),
        pages,
        "…the gallery's own pages, in reading order"
      );

      // Put back: the mode is the browser's setting, and a section that left the reader
      // in the column would be choosing it for every section after this one.
      dom.click(again.box.lightbox.querySelector("#manga-reader-double-page"));

      stopReader(again.box);
    }
  );

  /**
   * Ctrl+wheel in the column: the same gesture, the same numbers, another mechanism.
   *
   * The two screen modes zoom a transform over pages that are *fitted* to the screen,
   * with slack in both directions to zoom into. A page in the column is already as wide
   * as the picture area, so what zooms is the page itself — a transform on a scroll box
   * would leave the scroll range behind and put the edges of a zoomed page out of
   * reach. Which is also why the drag here is a drag of the *scroll position*: a
   * zoomed column is wider than the area, and the pointer is how a reader moves around
   * in it.
   */
  await runSection("the column zooms, and the drag scrolls it", async () => {
    // The arithmetic on its own first, which is where the range and the step live.
    assert.strictEqual(
      NR.zoomedBy(1, 1.1),
      1.1,
      "a notch is a tenth, as it is there"
    );
    assert.strictEqual(
      NR.zoomedBy(NR.VIEW_MAX_ZOOM, 1.1),
      NR.VIEW_MAX_ZOOM,
      "…clamped at the top of the same range"
    );
    assert.strictEqual(
      NR.zoomedBy(NR.VIEW_MIN_ZOOM, 1 / 1.1),
      NR.VIEW_MIN_ZOOM,
      "…and at the bottom"
    );

    // What a page is fitted to, which is where "too big in landscape" was: the wider of
    // the two is not the answer, the *smaller* is.
    assert.strictEqual(
      NR.columnFitted(1600, 900),
      900,
      "a window wider than it is tall fits a page to its height, so a page is never " +
        "drawn three screenfuls tall"
    );
    assert.strictEqual(
      NR.columnFitted(900, 1600),
      900,
      "a window taller than it is wide fills: the width is already the smaller one"
    );
    assert.strictEqual(
      NR.columnFitted(900, 900),
      900,
      "and a square is the same either way"
    );
    assert.strictEqual(
      NR.columnFitted(0, 900),
      0,
      "an unmeasured box is answered as zero, which is the caller's cue to fill it"
    );
    assert.strictEqual(
      NR.columnFitted(undefined, undefined),
      0,
      "…however it is unmeasured, since the smoke tests' DOM has no layout at all"
    );
    assert.strictEqual(
      NR.columnFitted(900, 1600, 26),
      848,
      "and the room the progress bar stands on comes off the width — twice, because " +
        "the pages are centred and each side gives it up"
    );
    assert.strictEqual(
      NR.columnFitted(1600, 900, 26),
      900,
      "…only off the width: the bar is down the side, and a page capped by its height " +
        "is already clear of it"
    );

    const { box } = await startReader({ galleryId: "8", on: true });
    dom.click(box.lightbox.querySelector("#manga-reader-scroll"));

    const container = box.lightbox.querySelector(".manga-reader-spread");
    const rows = [...container.querySelectorAll(".manga-reader-scroll-page")];
    rows.forEach((row, index) => {
      row.offsetTop = index * 500;
    });
    const zoomButton = () => box.lightbox.querySelector(".manga-reader-zoom");
    const offered = () =>
      zoomButton().getAttribute("data-manga-reader-hidden") === null;

    assert.strictEqual(
      rows[0].style.width,
      "100%",
      "a page fills the picture area"
    );
    assert.strictEqual(
      rows[0].style.maxWidth,
      "1000px",
      "…up to its own pixels"
    );
    assert.strictEqual(offered(), false, "with no zoom to reset");

    // A notch in. The page is *drawn* wider — that is the zoom here — and the cap
    // follows it, so a page is still never drawn wider than it was.
    const inwards = dom.makeEvent("wheel", { deltaY: -120, ctrlKey: true });
    container.dispatch("wheel", inwards);
    assert.strictEqual(
      inwards.defaultPrevented,
      true,
      "ctrl+wheel is taken, as it is in the other two modes"
    );
    assert.strictEqual(
      rows[0].style.width,
      "110.00000000000001%",
      "and one notch draws every page a tenth wider than the area"
    );
    assert.strictEqual(
      rows[0].style.maxWidth,
      "1100px",
      "with the cap at its own pixels, scaled the same way"
    );
    assert.strictEqual(offered(), true, "and the header offers a way back");

    // And the reader stays on the page they were reading. Every row is a different
    // height at a different zoom, so the position *in the column* does not survive the
    // change — the page does, which is what this half keeps and why.
    press("ArrowRight");
    press("ArrowRight");
    assert.strictEqual(
      container.scrollTop,
      1000,
      "two pages on, two rows down"
    );

    // Reading *into* that page rather than at its top — which is where this went wrong:
    // the reader was thrown back to the beginning of the page they were in the middle
    // of. Every row's height is its width times its own ratio, so a zoom multiplies them
    // all by the same factor, and the position that keeps the same words under the
    // reader's eyes is the old position times that same factor.
    container.scrollTop = 1250;
    rows.forEach((row, index) => {
      row.offsetTop = index * 550;
    });

    container.dispatch(
      "wheel",
      dom.makeEvent("wheel", { deltaY: -120, ctrlKey: true })
    );
    assert.strictEqual(
      container.scrollTop,
      Math.round(1250 * 1.1),
      "and zooming keeps them where they were reading, not at the top of the page"
    );

    // Out again, past where it started, to the bottom of the range: a page narrower
    // than the area, which never needs to be moved sideways.
    for (let i = 0; i < 60; i++) {
      container.dispatch(
        "wheel",
        dom.makeEvent("wheel", { deltaY: 120, ctrlKey: true })
      );
    }
    assert.strictEqual(
      rows[0].style.width,
      NR.VIEW_MIN_ZOOM * 100 + "%",
      "and outwards it stops at the same floor the screen modes do"
    );

    // Back to the size it fits at, from the header's own button — which is the same
    // button the screen modes put there, doing the same thing to a different zoom.
    dom.click(zoomButton());
    assert.strictEqual(
      rows[0].style.width,
      "100%",
      "the reset puts the column back"
    );
    assert.strictEqual(offered(), false, "and takes itself away again");

    // The drag: a scroll the pointer makes. Left and up scroll the box right and down,
    // which is what a hand on a page means — the same movement the wheel makes, on the
    // same box.
    rows[0].style.width = "200%";
    container.scrollLeft = 0;
    container.scrollTop = 0;

    // A press on the *margin* first — the box, which is what a press beside a page
    // lands on. Stash's own drag is the image's, so this does nothing there, and it
    // scrolled the column here until the press started asking what it landed on.
    container.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
    );
    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 40, clientY: 60 })
    );
    assert.strictEqual(
      container.scrollLeft,
      0,
      "a drag begun beside the pages scrolls nothing"
    );
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));

    // And the drag itself, on a page: dispatched on the image, bubbling to the box.
    rows[0]
      .querySelector("img")
      .dispatchEvent(
        dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
      );
    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 40, clientY: 60 })
    );
    assert.strictEqual(
      container.scrollLeft,
      60,
      "dragging left scrolls the box right"
    );
    assert.strictEqual(
      container.scrollTop,
      40,
      "and dragging up scrolls it down"
    );

    // And letting go does not turn a page: in this mode a click does nothing anyway,
    // and a drag is not a click anywhere.
    const before = container.scrollTop;
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.strictEqual(
      container.scrollTop,
      before,
      "the box stays where the hand left it"
    );

    // Put back: the mode is the browser's setting, and a section that left the reader
    // in the column would be choosing it for every section after this one.
    dom.click(box.lightbox.querySelector("#manga-reader-double-page"));

    stopReader(box);
  });

  /**
   * The bar, down the side — and the same bar.
   *
   * One axis swapped, so what is worth pinning is that it is the same bar: the same
   * ticks, the same drag, the same length rule, and every one of them written in the
   * other property.
   */
  await runSection(
    "the bar turns down the side, and drags the same way",
    async () => {
      // A gallery with chapters in it, since the ticks are half of what is being asked
      // about here.
      const { box } = await startReader({
        galleryId: "31",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });
      const counter = () =>
        box.lightbox.querySelector(".manga-reader-counter").textContent;

      dom.click(box.lightbox.querySelector("#manga-reader-scroll"));

      const container = box.lightbox.querySelector(".manga-reader-spread");
      const rows = [...container.querySelectorAll(".manga-reader-scroll-page")];
      rows.forEach((row, index) => {
        row.offsetTop = index * 500;
      });
      // A turn, so that there is a position worth reading off the bar: the reader starts
      // on the first page of the gallery, every time.
      press("ArrowRight");
      press("ArrowRight");

      const bar = box.lightbox.querySelector(".manga-reader-progress");
      assert.strictEqual(
        bar.classList.contains("is-vertical"),
        true,
        "the bar knows which way it runs"
      );
      assert.strictEqual(
        bar.parentNode.classList.contains("Lightbox-display"),
        true,
        "and is drawn over the picture area rather than in a row of its own"
      );

      const track = bar.querySelector(".manga-reader-progress-track");
      const read = bar.querySelector(".manga-reader-progress-read");
      const tick = bar.querySelector(".manga-reader-progress-node");

      // Two pages of eight gone: a quarter of the way down.
      assert.strictEqual(
        read.style.height,
        "25.000%",
        "the fill runs down the bar"
      );
      assert.strictEqual(
        Boolean(read.style.width),
        false,
        "…and not across it, which is the other arrangement's property — cleared rather " +
          "than left behind, because an inline style outranks the stylesheet"
      );
      assert.strictEqual(
        Boolean(track.style.height),
        false,
        "the bar is as long as the picture area, which the stylesheet says and no " +
          "measurement does"
      );
      assert.strictEqual(
        Boolean(tick.style.left),
        false,
        "and a tick sits down the bar"
      );
      assert.strictEqual(
        typeof tick.style.top,
        "string",
        "…at the fraction its chapter begins at"
      );

      // The drag, along the other axis: a pointer four fifths of the way down asks for
      // the page four fifths of the way in.
      track.rect = { left: 0, top: 0, width: 16, height: 500 };
      track.dispatch(
        "mousedown",
        dom.makeEvent("mousedown", { button: 0, clientY: 400 })
      );
      dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
      assert.strictEqual(
        counter(),
        "7 / 8",
        "a drag down the bar seeks along the book, in the column's own coordinates"
      );

      // And then outlast the throttle, which is the *reader's* clock rather than this
      // section's: a drag leaves it hot, and the next section's drag would be held back
      // by it and land a moment late. The sections that drag the bar already wait this
      // long to see where a drag arrives.
      await new Promise((resolve) =>
        setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
      );

      // Put back: the mode is the browser's setting, and a section that left the reader
      // in the column would be choosing it for every section after this one.
      dom.click(box.lightbox.querySelector("#manga-reader-double-page"));

      stopReader(box);
    }
  );

  /**
   * The wheel's three chords, and what a reader may bind them to.
   *
   * Three dropdowns in the options panel, one per chord, each offering the same four
   * answers: off, turn a page, zoom, scroll — and *any* of them may be bound to the same
   * thing, because a reader who wants one gesture everywhere is not making a mistake. What
   * a binding means depends on the mode, which is why the panel shows the action rather
   * than the word it has stored: an untouched install has "auto", which is not one of the
   * four and is not a word a reader could have picked.
   */
  await runSection("the wheel is the reader's to bind", async () => {
    // Eight pages, and one page a screen on purpose: this section turns pages four times,
    // and how many screens there are is a *setting* — a reader left pairing two pages at a
    // time by the section before this one has half as many, and a turn that runs out of book
    // is a failure that says nothing about the wheel.
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });
    const startedIn = savedReaderSettings()?.readingMode || "single";
    dom.click(box.lightbox.querySelector("#manga-reader-single-page"));

    const panel = box.lightbox.querySelector(".manga-reader-menu-settings");
    const spread = container();
    const counter = () =>
      box.lightbox.querySelector(".manga-reader-counter").textContent;
    const transform = () => spread.style.transform || "";

    // Outlast the wheel's own clock before rolling anything. What the wheel has travelled is
    // added up across events and forgotten once it has been still for WHEEL_REST_MS — a
    // section's own rolls are fine, but the *remainder* an earlier section left behind is
    // not, and a turn that comes up a few pixels short is a turn that does not happen.
    await new Promise((resolve) => setTimeout(resolve, NR.WHEEL_REST_MS + 40));

    const bind = (id, action) => {
      const select = panel.querySelector(id);
      select.value = action;
      select.dispatch("change");
    };
    const roll = (deltaY, keys = {}) => {
      const wheel = dom.makeEvent("wheel", { deltaY, ...keys });
      spread.dispatch("wheel", wheel);
      return wheel;
    };
    /**
     * The library as a reader who has never bound anything has it: every set back to its own
     * defaults, the mode in hand's as much as the other two's.
     *
     * Written through the managing half rather than through the dropdowns for the reason the
     * settings themselves are: a section putting the world back as it found it should say what
     * it means, and the defaults are the plugin's to spell rather than a section's.
     */
    const unbind = () => {
      const profiles = {};
      for (const which of ["single", "double", "scroll"]) {
        profiles[which] = NR.defaultProfile(which);
      }
      NS.writeReaderSettings(
        JSON.stringify({
          readingMode: NR.parseSettings(NS.readerSettingsRaw).readingMode,
          profiles,
        })
      );
    };

    // The three rows, and what they show before anything is bound: the defaults for the way
    // of reading in hand, which is what this plugin has always done there.
    for (const [id, chosen] of [
      ["#manga-reader-wheel", "turn"],
      ["#manga-reader-shift-wheel", "scroll"],
      ["#manga-reader-ctrl-wheel", "zoom"],
    ]) {
      const select = panel.querySelector(id);
      assert.strictEqual(select.tagName, "SELECT", `${id} is a dropdown`);
      // **Stash's own classes**, measured off its lightbox select: the field, and the fill.
      // Not Bootstrap's `.custom-select`, which is a differently drawn control — that is what
      // "looks like another application's" was.
      assert.deepStrictEqual(
        select.className.split(" ").sort(),
        ["btn-secondary", "form-control", "manga-reader-select"],
        "…wearing what Stash's own lightbox select wears, so that it is drawn like one"
      );
      assert.deepStrictEqual(
        [...select.children].map((option) => option.value),
        ["off", "turn", "zoom", "scroll"],
        "…offering the same four, in the same order"
      );
      assert.strictEqual(
        select.value,
        chosen,
        "…and showing the binding this way of reading has"
      );
    }

    // The wheel zooming, which is Stash's own arrangement and the one thing a reader who
    // does not like this plugin's wheel would ask for first.
    bind("#manga-reader-wheel", "zoom");
    assert.strictEqual(
      savedReaderSettings().wheel.plain,
      "zoom",
      "which is written"
    );
    const wasAt = counter();
    const unzoomed = transform();
    const zoomed = roll(-120);
    assert.strictEqual(zoomed.defaultPrevented, true, "the wheel is taken");
    assert.notStrictEqual(
      transform(),
      unzoomed,
      "and a wheel bound to zooming moves the view rather than turning the page"
    );
    assert.strictEqual(counter(), wasAt, "…without turning away from the page");

    // Back to the action this chord has always had, and the same chord turns again.
    bind("#manga-reader-wheel", "turn");
    assert.strictEqual(
      savedReaderSettings().wheel.plain,
      "turn",
      "which is written"
    );
    // Rolled the *other* way on purpose: the screen before the first one is not a screen,
    // and a wheel rolled up on the first page of a book has nothing to turn to.
    roll(120);
    assert.notStrictEqual(counter(), wasAt, "and the wheel turns a page again");

    // …whichever axis the event carries its travel on. Some browsers put a wheel's movement
    // on `deltaX` when shift is held — scrolling sideways is their own meaning for that
    // chord — and a chord the reader has bound should not care how the browser spells it.
    const sideways = counter();
    roll(0, { deltaX: 120 });
    assert.notStrictEqual(
      counter(),
      sideways,
      "a wheel whose travel is on deltaX turns a page too"
    );

    // Shift bound to turning: the chord keeps its modifier and loses its own meaning.
    bind("#manga-reader-shift-wheel", "turn");
    assert.strictEqual(
      savedReaderSettings().wheel.shift,
      "turn",
      "shift is written"
    );
    const before = counter();
    roll(120, { shiftKey: true });
    assert.notStrictEqual(
      counter(),
      before,
      "and shift+wheel turns a page too"
    );

    // Ctrl bound to off: the chord does nothing at all — and is *still* taken, because that
    // is where a browser puts its own page zoom, and a reader who unbound the chord did not
    // ask for the whole interface to zoom instead.
    bind("#manga-reader-ctrl-wheel", "off");
    assert.strictEqual(
      savedReaderSettings().wheel.ctrl,
      "off",
      "off is written"
    );
    const still = { at: counter(), view: transform() };
    const dead = roll(-120, { ctrlKey: true });
    assert.strictEqual(dead.defaultPrevented, true, "the chord is still taken");
    assert.strictEqual(counter(), still.at, "and does nothing: no turn");
    assert.strictEqual(transform(), still.view, "…and no zoom either");

    // And all three bound to the same thing, which the panel allows because it is a
    // perfectly reasonable thing to want: every gesture zooms.
    for (const id of [
      "#manga-reader-wheel",
      "#manga-reader-shift-wheel",
      "#manga-reader-ctrl-wheel",
    ]) {
      bind(id, "zoom");
    }
    assert.deepStrictEqual(
      [
        savedReaderSettings().wheel.plain,
        savedReaderSettings().wheel.shift,
        savedReaderSettings().wheel.ctrl,
      ],
      ["zoom", "zoom", "zoom"],
      "three chords, one answer, and nothing in the settings says a chord is used once"
    );
    const flat = transform();
    roll(120, { shiftKey: true });
    assert.notStrictEqual(transform(), flat, "…so shift+wheel zooms");
    const flat2 = transform();
    roll(-120);
    assert.notStrictEqual(transform(), flat2, "…and so does the wheel");

    // **And the column has a set of its own.** Same panel, same three rows, different
    // bindings: the wheel scrolls — in a column, scrolling *is* reading — and the chord a
    // reader holds down is the one that goes a page at a time.
    //
    // And what has just been bound belongs to *single pages*: the three chords were all
    // bound to zooming a moment ago, and the column has not heard about any of it. That is
    // the whole point of the sets being kept apart — and it is what a reader complained
    // about when they were not, a wheel that jumped a page at a time in a column because of
    // a binding they had made in front of a screen.
    dom.click(box.lightbox.querySelector("#manga-reader-scroll"));
    const shown = () => [
      panel.querySelector("#manga-reader-wheel").value,
      panel.querySelector("#manga-reader-shift-wheel").value,
      panel.querySelector("#manga-reader-ctrl-wheel").value,
    ];
    assert.deepStrictEqual(
      shown(),
      ["scroll", "turn", "zoom"],
      "the column has bindings of its own, untouched by the ones just made for single pages"
    );

    // Unbound through the managing half, which is also how the reader hears about a change
    // made somewhere other than this panel: every set back to its own defaults.
    unbind();
    assert.deepStrictEqual(
      shown(),
      ["scroll", "turn", "zoom"],
      "which is where the column already was"
    );

    const column = container();
    const at = () =>
      box.lightbox.querySelector(".manga-reader-counter").textContent;
    const rolled = (deltaY, keys = {}) => {
      const wheel = dom.makeEvent("wheel", { deltaY, ...keys });
      column.dispatch("wheel", wheel);
      return wheel;
    };

    // The browser's own, untouched: the column scrolls, and this plugin stays out of it.
    assert.strictEqual(
      rolled(120).defaultPrevented,
      false,
      "the wheel in the column is the browser's, which is what an untouched install has"
    );

    // A page at a time is what shift is bound to here, and that is this plugin's own turn —
    // the same one the arrow keys make — so the browser is not left to scroll as well.
    const here = at();
    const turning = rolled(120, { shiftKey: true });
    assert.strictEqual(
      turning.defaultPrevented,
      true,
      "a chord bound to turning is taken rather than handed to the browser"
    );
    assert.notStrictEqual(
      at(),
      here,
      "…and turns a page rather than scrolling freely"
    );

    // And the same chord bound in the other direction is the other page. The wheel is given
    // its rest first: what it has travelled is added up and kept, and a roll the other way
    // that is smaller than the remainder is still travel in the same direction.
    await new Promise((resolve) => setTimeout(resolve, NR.WHEEL_REST_MS + 40));
    const back = at();
    rolled(-120, { shiftKey: true });
    assert.notStrictEqual(
      at(),
      back,
      "…and the other way round is the page before it"
    );

    // And off is off in every mode, which is the promise the word makes: the column does
    // not scroll either.
    bind("#manga-reader-wheel", "off");
    column.scrollTop = 0;
    const off = rolled(120);
    assert.strictEqual(
      off.defaultPrevented,
      true,
      "off is taken rather than handed over"
    );
    assert.strictEqual(column.scrollTop, 0, "…and nothing scrolls");

    // Put back: the three chords, and the mode the section *found* — a reader who came in
    // pairing two pages at a time is still pairing them.
    unbind();
    dom.click(
      box.lightbox.querySelector(
        startedIn === "scroll"
          ? "#manga-reader-scroll"
          : startedIn === "double"
            ? "#manga-reader-double-page"
            : "#manga-reader-single-page"
      )
    );

    stopReader(box);
  });
};
