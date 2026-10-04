/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  chapterMenu,
  savedReaderSettings,
  turn,
  container,
  drawn,
  press,
  CHAPTERS_VIEW,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * The bar's own two switches, and what each of them stops.
   *
   * The bar is this plugin's furniture rather than Stash's, so a reader who does not want
   * it is the one reader nothing was offering a say to. Two switches, in a group of their
   * own in the options menu: the bar, and the marks it draws where each chapter begins —
   * a question about the bar, which is why they are one group and why the second goes
   * when the first does.
   *
   * What is asserted is not that the setting is *written* but that the drawing stops:
   * both are drawn by the reader half, on the far side of the panel that switches them,
   * and a switch that writes a setting nobody reads is a switch that does nothing.
   */
  await runSection("the progress bar has switches of its own", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const panel = box.lightbox.querySelector(".manga-reader-menu-settings");
    const control = (id) => panel.querySelector(id);
    const flip = (id) => {
      const box2 = control(id);
      box2.checked = !box2.checked;
      box2.dispatch("change");
    };
    const bar = () => box.lightbox.querySelector(".manga-reader-progress");
    const ticks = () =>
      bar() ? bar().querySelectorAll(".manga-reader-progress-node").length : 0;
    const away = (node) =>
      node.getAttribute("data-manga-reader-hidden") !== null;
    // The row something sits in, found the way the panel's own pass finds it: what is
    // hidden and shown is the *row*, and what a test can name is something inside it — a
    // control, or the readout of the panel's one slider.
    const rowOf = (selector) => {
      let at = panel.querySelector(selector);
      while (at && !at.classList?.contains("manga-reader-row")) {
        at = at.parentNode;
      }
      return at;
    };
    const chaptersDrawn = () => chapterMenu(box);

    // Both on, which is what this plugin did before either switch existed: a library
    // that has never been asked reads as the defaults.
    assert.strictEqual(
      control("#manga-reader-show-progress").checked,
      true,
      "the bar is drawn by default"
    );
    assert.strictEqual(
      control("#manga-reader-show-marks").checked,
      true,
      "…and so are its chapter marks"
    );
    assert.ok(bar(), "which is a bar on the page");
    assert.ok(
      ticks() > 0,
      "with a mark on it for every chapter that begins inside the book"
    );
    assert.deepStrictEqual(
      chaptersDrawn(),
      ["開幕", "中盤"],
      "and the chapters themselves, which the header's own menu lists"
    );

    // Marks off: the ticks go, and only the ticks do.
    flip("#manga-reader-show-marks");
    assert.strictEqual(ticks(), 0, "the ticks are gone");
    assert.ok(
      bar(),
      "while the bar they were marks on is still there, which is the setting's own " +
        "question and not this one's"
    );
    assert.deepStrictEqual(
      chaptersDrawn(),
      ["開幕", "中盤"],
      "and the chapters are still the book's chapters: what was turned off is where the " +
        "bar says they begin, not whether this half knows about them"
    );
    assert.strictEqual(
      savedReaderSettings().showChapterMarks,
      false,
      "and the setting is with the library, like every other one"
    );

    // …and on again, which is what makes it a switch rather than a one-way door.
    flip("#manga-reader-show-marks");
    assert.ok(ticks() > 0, "and they come back");

    // The bar itself off: there is no bar, and the row that would put marks on one has
    // nothing to be about — see the panel's own pass, which hides it.
    flip("#manga-reader-show-progress");
    // Compared as a boolean rather than against `null`: what a failed assertion prints
    // is its two values, and a stub element prints its own parent and children — a
    // cycle, which Node's inspector walks until the heap gives out. The failure then
    // arrives as a RangeError from printing it, and the assertion's own message is
    // nowhere in the output. See the same shape in the one-page gallery's section.
    assert.strictEqual(
      bar() === null,
      true,
      "the bar is taken off the page rather than hidden: an element still in the " +
        "lightbox is an element still taking pointers"
    );
    assert.strictEqual(
      savedReaderSettings().showProgress,
      false,
      "its setting is written the same way"
    );
    assert.strictEqual(
      away(rowOf("#manga-reader-show-marks")),
      true,
      "and the marks row goes with it, since a mark on a bar that is not drawn is a " +
        "setting with nothing to say"
    );
    assert.strictEqual(
      away(rowOf(".manga-reader-readout")),
      true,
      "…and so does the row that says how long it stays, for the same reason"
    );
    assert.strictEqual(
      away(control("#manga-reader-idle")),
      true,
      "…with the slider under it, which is the row's control but not inside the row"
    );

    // And back, so the sections after this one read a panel in the state they expect.
    flip("#manga-reader-show-progress");
    assert.ok(bar(), "and the bar comes back");
    assert.strictEqual(
      away(rowOf("#manga-reader-show-marks")),
      false,
      "with its marks row"
    );
    assert.strictEqual(
      away(rowOf(".manga-reader-readout")),
      false,
      "…and with the row that winds its clock"
    );
    assert.strictEqual(
      away(control("#manga-reader-idle")),
      false,
      "…slider and all"
    );

    // In the column the bar is also the room the pages leave for it, so turning it off
    // gives that room back — which is a measurement of the bar, and a bar that is not
    // there measures nothing. See refitIfReserveChanged: nothing here is a resize or a
    // zoom, only the pass the switch itself causes.
    dom.click(box.lightbox.querySelector("#manga-reader-scroll"));
    const container = box.lightbox.querySelector(".manga-reader-spread");
    const rows = [...container.querySelectorAll(".manga-reader-scroll-page")];
    const bar2 = box.lightbox.querySelector(".manga-reader-progress");
    bar2.rect = { left: 874, top: 0, width: 16, height: 600 };
    container.rect = { left: 0, top: 0, width: 900, height: 1600 };
    dom.window.dispatchEvent(dom.makeEvent("resize", {}));
    assert.strictEqual(
      rows[0].style.width,
      "828px",
      "in the column the pages leave the bar its corner, as they always did"
    );

    flip("#manga-reader-show-progress");
    assert.strictEqual(
      rows[0].style.width,
      "900px",
      "and a reader who takes the bar away gets the whole width back, with no window " +
        "resized and nothing zoomed"
    );

    // Put back: the bar, and the mode — both are the reader's settings, and a section
    // that left either changed would be deciding for every section after it.
    flip("#manga-reader-show-progress");
    dom.click(box.lightbox.querySelector("#manga-reader-double-page"));

    stopReader(box);
  });

  /**
   * The bar's clock, wound by the reader.
   *
   * How long it stays was a constant — two seconds, which is a good answer and was the only
   * one there was. It is a slider now, and the two ends of that slider are not lengths of
   * time but settings of their own: at 0 the bar is there only while the pointer is on it,
   * which is the one setting under which a *turn* does not bring it out at all (there would
   * be nobody pointing at it to read it), and at the top it comes out and never goes away.
   *
   * The clock is the test's, as it is in the sections about sleeping: the timers the plugin
   * sets are collected, and what is asserted is what it asked for.
   */
  await runSection("the bar's clock is the reader's", async () => {
    const real = dom.window.setTimeout;
    const timers = [];
    dom.window.setTimeout = (fn, ms) => {
      timers.push({ fn, ms });
      return real(fn, ms);
    };

    try {
      // Eight pages rather than five: this section wakes the bar by turning pages, three
      // times over, and running out of book in the middle of it is a test that fails for
      // the wrong reason.
      const { box } = await startReader({
        galleryId: "31",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");
      const bar = box.lightbox.querySelector(".manga-reader-progress");
      const track = bar.querySelector(".manga-reader-progress-track");
      const slider = panel.querySelector("#manga-reader-idle");
      const readout = () =>
        panel.querySelector(".manga-reader-readout").textContent;
      const asleep = () => bar.classList.contains("is-idle");

      /** The bar's own clock, told apart from the drag's throttle by its length */
      const clocks = () => timers.filter((timer) => timer.ms >= 500);

      const slide = (step) => {
        slider.value = String(step);
        slider.dispatch("input");
      };

      // The pages as laid out, since a bar with nothing measured stays out of the way
      // however much is asked of it.
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();

      // The row: a slider, and what it is set to said in seconds.
      assert.ok(slider, "the panel has the slider this section is about");
      assert.strictEqual(slider.type, "range", "which is a slider");
      assert.strictEqual(
        slider.value,
        String(NR.PROGRESS_IDLE_MS / 500),
        "which starts on the length the constant was"
      );
      assert.strictEqual(readout(), "2 s", "said beside it in seconds");

      // The top of the slider: out, and out it stays. No clock at all — and the assertion
      // is that none was set, because a clock set to a very long time would pass a test
      // that only waited.
      slide(NR.PROGRESS_IDLE_MAX_MS / 500 + 1);
      assert.strictEqual(
        savedReaderSettings().progressIdleMs,
        NR.PROGRESS_NEVER,
        "the top step is not a length of time: it is the setting that never hides"
      );
      assert.strictEqual(readout(), "Never", "which the readout says in words");

      const before = timers.length;
      dom.click(box.navRight);
      assert.strictEqual(asleep(), false, "a turn brings the bar out");

      // …and nothing it asked for can put the bar away again, whatever length that clock
      // was: every callback it set is run, and the bar is still there. Run rather than
      // counted, because the way this goes wrong is a clock scheduled with the *setting*
      // as its length — and -1 as a length fires at once. A test that waited out a long
      // clock instead would pass with the setting not honoured at all.
      for (const timer of timers.slice(before)) timer.fn();
      assert.strictEqual(
        asleep(),
        false,
        "and there is nothing to put it away again: 'never' means never, not 'not yet'"
      );

      // The bottom of it: only the pointer has the bar.
      slide(0);
      assert.strictEqual(
        savedReaderSettings().progressIdleMs,
        0,
        "the bottom step is the other setting that is not a length of time"
      );
      assert.strictEqual(readout(), "0 s", "which reads as no time at all");

      dom.click(box.navRight);
      assert.strictEqual(
        asleep(),
        true,
        "a turn does not bring it out — there is nobody pointing at it to read it"
      );
      track.dispatch("mousemove", dom.makeEvent("mousemove", {}));
      assert.strictEqual(asleep(), false, "the pointer reaching it does");
      track.dispatch("mouseleave", dom.makeEvent("mouseleave", {}));
      assert.strictEqual(
        asleep(),
        true,
        "and leaving takes it with it, with no waiting at all"
      );

      // And in between: a length of time, which is what the clock is set to.
      slide(6);
      assert.strictEqual(
        savedReaderSettings().progressIdleMs,
        3000,
        "three seconds is three thousand milliseconds"
      );
      assert.strictEqual(readout(), "3 s", "which is what the readout says");

      timers.length = 0;
      dom.click(box.navRight);
      assert.strictEqual(asleep(), false, "a turn brings it out");
      const clock = clocks().pop();
      assert.ok(clock, "and sets a clock to put it away by");
      assert.strictEqual(clock.ms, 3000, "as long as the reader asked for");
      clock.fn();
      assert.strictEqual(asleep(), true, "and it goes when that runs out");

      // And a lightbox opened with that setting has the bar from the start. Not because a
      // bar that comes out on its own is wanted — a lightbox that has just opened has said
      // nothing yet — but because a reader who asked for a bar that never goes away asked
      // for a bar, and one that is never dismissed is not one to be dismissed before the
      // picture can be read either.
      slide(NR.PROGRESS_IDLE_MAX_MS / 500 + 1);
      stopReader(box);

      const again = await startReader({ galleryId: "8", on: true });
      const againBar = again.box.lightbox.querySelector(
        ".manga-reader-progress"
      );
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();
      assert.strictEqual(
        againBar.classList.contains("is-idle"),
        false,
        "and a lightbox opened with it has the bar as soon as its pages are measured, " +
          "with nothing turned and no pointer near it"
      );

      // Put back through *this* lightbox's own slider — the one the section has been
      // dragging belongs to the lightbox it stopped — so that the sections after this one
      // find a bar that behaves as they expect.
      const againSlider =
        again.box.lightbox.querySelector("#manga-reader-idle");
      againSlider.value = String(NR.PROGRESS_IDLE_MS / 500);
      againSlider.dispatch("input");
      assert.strictEqual(
        again.box.lightbox.querySelector(".manga-reader-readout").textContent,
        "2 s",
        "which the slider says again"
      );
      assert.strictEqual(
        savedReaderSettings().progressIdleMs,
        NR.PROGRESS_IDLE_MS,
        "the default is written back, so the sections after this one find a bar that " +
          "behaves as they expect"
      );

      stopReader(again.box);
    } finally {
      dom.window.setTimeout = real;
    }
  });

  /**
   * A width does not survive a change of layout.
   *
   * The bar holds the width of the last screen that measured one, so that a page still on
   * its way does not shrink it. Right, for a turn: the screen before is the same kind of
   * thing as the screen now. Not right across a change of layout, where the screen before
   * is a *different* kind of thing — out of the column, what is in the picture area is the
   * column's own rows, a page as wide as the picture area — and the bar came out at very
   * nearly its full length for the moment before the new screen had been measured. Which
   * is what a reader saw.
   *
   * So the pass that re-cuts the pages reports no width and forgets the one it was holding,
   * and the bar does what it does for the first screen of a gallery: out of the way until
   * there is something measured to be about, and back out on the wake it was owed.
   */
  await runSection(
    "the bar carries no width across a change of layout",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const bar = () => box.lightbox.querySelector(".manga-reader-progress");
      const track = () => bar().querySelector(".manga-reader-progress-track");
      const asleep = () => bar().classList.contains("is-idle");
      const width = () => track().style.width || null;

      /** Where the images in the picture area are, which is what the bar measures */
      const measured = (boxes) =>
        [...container().querySelectorAll("img")].forEach((image, at) => {
          image.offsetLeft = boxes[at][0];
          image.offsetWidth = boxes[at][1];
        });

      // One page, measured: the bar is as wide as it.
      measured([[0, 500]]);
      dom.flush();
      assert.strictEqual(
        width(),
        "500px",
        "the bar is as wide as the page it is standing for"
      );

      // Into the column, where a page is as wide as the picture area is and the bar is
      // measured by nobody — its length is the area's, which the stylesheet says.
      dom.click(box.lightbox.querySelector("#manga-reader-scroll"));
      const rows = [
        ...container().querySelectorAll(".manga-reader-scroll-page"),
      ];
      rows.forEach((row) => {
        const image = row.querySelector("img");
        image.offsetLeft = 0;
        image.offsetWidth = 900;
      });
      dom.flush();
      assert.strictEqual(
        width(),
        null,
        "and the column's bar holds no width of its own, since nothing measures it"
      );

      // And out again. What is in the picture area *now* is still the column's rows at
      // 900px a page: measuring them is measuring the layout that has just been left, and
      // 900px is nearly the whole picture area — which is where the flash came from.
      dom.click(box.lightbox.querySelector("#manga-reader-double-page"));
      assert.strictEqual(
        width(),
        null,
        "so the bar leaves the column holding nothing rather than the column's page width"
      );
      assert.strictEqual(
        asleep(),
        true,
        "…and stays out of the way, as it does for the first screen of a gallery, until " +
          "the screen it is about has been measured"
      );

      // A page on, so that the screen in front of the reader is a *pair* — the first
      // screen of this gallery is its cover, on a page of its own, in every mode.
      press("ArrowRight");
      assert.strictEqual(
        width(),
        null,
        "a turn holds what it was holding, which is nothing here, since the new screen " +
          "has not been measured either"
      );

      // Which is what the pages arriving is, and the wake it was owed comes with them.
      measured([
        [0, 500],
        [520, 500],
      ]);
      dom.flush();
      assert.strictEqual(
        width(),
        "1020px",
        "and then it is as wide as the screen the reader is looking at"
      );
      assert.strictEqual(asleep(), false, "which is when it comes back out");

      // What the container holds on the way from one layout to another is the other
      // layout's, and in a browser that lasts as long as the new screen's images take to
      // arrive — several frames. A column's row measured as though it were a page of the
      // screen is a page as wide as the whole picture area, which is what made the bar
      // (and the pages that were still the column's) so large for that moment. Built here
      // by hand, since this DOM draws a screen the moment it is asked to and a browser
      // does not.
      const stale = dom.makeElement("div");
      stale.className = "manga-reader-scroll-page";
      const staleImage = dom.makeElement("img");
      staleImage.offsetLeft = 0;
      // Wider than the pair it is standing in for on purpose: what is being asserted is
      // that it is not measured at all, and a row that happened to measure the same as
      // the screen would pass whether it was measured or not.
      staleImage.offsetWidth = 1800;
      stale.appendChild(staleImage);
      container().appendChild(stale);
      dom.flush();
      assert.strictEqual(
        width(),
        "1020px",
        "a column's row left in the picture area is not a page on show and does not " +
          "widen the bar — the pages of the screen are what it is as wide as"
      );
      stale.remove();

      // And the same across a change of layout that never goes near the column: back to a
      // single page. What is in the picture area is the pair that has just been left, and
      // the bar's own inline width is still the pair's — a length left standing is the old
      // screen's drawn as the new one's, which is the other half of the same mistake.
      dom.click(box.lightbox.querySelector("#manga-reader-single-page"));
      assert.strictEqual(
        width(),
        null,
        "a re-cut leaves nothing behind it, inline style and all"
      );

      stopReader(box);
    }
  );

  await runSection("the progress bar shows the way, and moves it", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const bar = box.lightbox.querySelector(".manga-reader-progress");
    assert.ok(bar, "a gallery with pages has a bar");
    assert.strictEqual(
      bar.getAttribute("data-manga-reader-hidden"),
      null,
      "and it is on the screen"
    );

    // Its own row in the lightbox's column, between the picture and the footer: not a
    // layer over the pages, which is what it was and what it must not be again.
    const kids = [...box.lightbox.children];
    const rowOf = (name) =>
      kids.findIndex((node) => node.className.includes(name));
    assert.ok(
      rowOf("Lightbox-display") < rowOf("manga-reader-progress") &&
        rowOf("manga-reader-progress") < rowOf("Lightbox-footer"),
      "the bar is a row between the picture and the footer, not a layer over the pages"
    );

    const track = bar.querySelector(".manga-reader-progress-track");
    const read = bar.querySelector(".manga-reader-progress-read");
    const thumb = bar.querySelector(".manga-reader-progress-thumb");
    const label = bar.querySelector(".manga-reader-progress-label");
    const ticks = () => [
      ...bar.querySelectorAll(".manga-reader-progress-node"),
    ];

    // The track as the browser would measure it, since a pointer's x is only a
    // fraction of something; and the pages, which are what the bar is as wide as.
    // Layout boxes, which the zoom's transform does not touch.
    const laidOut = () => {
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
    };

    track.rect = { left: 0, top: 0, width: 800, height: 4 };
    laidOut();
    dom.flush();

    assert.strictEqual(
      track.style.width,
      "500px",
      "the bar is as wide as the pages on show — the cover, which stands alone"
    );

    // An image that has not loaded measures nothing at all, and that is what collapsed
    // the bar to a point: nothing measures zero, the width stands, and the pass that
    // an image's own `load` asks for is what takes the real one.
    [...container().querySelectorAll("img")].forEach((image) => {
      image.offsetLeft = 0;
      image.offsetWidth = 0;
    });
    dom.flush();
    assert.strictEqual(
      track.style.width,
      "500px",
      "and a page that has not arrived yet does not make it a point"
    );
    laidOut();
    dom.flush();
    assert.strictEqual(track.style.width, "500px");

    // The changes that are nobody's DOM mutation: a window resized, and the lightbox
    // filling the screen or giving it back. What the pages are fitted to has changed,
    // so what the bar measures has changed, and no pass would come for it.
    [...container().querySelectorAll("img")].forEach((image, at) => {
      image.offsetLeft = at * 720;
      image.offsetWidth = 700;
    });
    dom.document.dispatch(
      "fullscreenchange",
      dom.makeEvent("fullscreenchange", {})
    );
    assert.strictEqual(
      track.style.width,
      "700px",
      "going fullscreen re-measures at once rather than at the next drag"
    );

    [...container().querySelectorAll("img")].forEach((image) => {
      image.offsetLeft = 0;
      image.offsetWidth = 500;
    });
    dom.window.dispatchEvent(dom.makeEvent("resize", {}));
    assert.strictEqual(
      track.style.width,
      "500px",
      "and so does the window being resized, which changes the same thing"
    );

    assert.strictEqual(read.style.width, "0.000%", "the book opens unread");
    assert.strictEqual(thumb.style.left, "0.000%");

    assert.strictEqual(ticks().length, 2, "one tick per chapter");
    assert.deepStrictEqual(
      ticks().map((tick) => tick.style.left),
      ["25.000%", "50.000%"],
      "at the page each begins on, which is 2 of 8 and 4 of 8"
    );

    // The name comes from the plugin's own bubble, at once, rather than from a
    // browser tooltip that waits a second before saying anything at all. The pointer
    // is found by the bar, which is the only thing that can say a tick is no longer
    // under it: a tick redrawn under a stationary pointer cannot tell anyone.
    const bubbleLine = (which) =>
      label.querySelector(".manga-reader-progress-" + which).textContent;
    track.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { target: ticks()[1] })
    );
    assert.strictEqual(
      bubbleLine("chapter"),
      "中盤",
      "and the pointer on a tick names that chapter"
    );
    const labelAt = label.style.left;
    assert.strictEqual(
      bubbleLine("page"),
      "",
      "in a bubble of its own with no page number in it"
    );
    assert.strictEqual(bar.classList.contains("is-showing"), true);
    assert.strictEqual(
      label.parentNode === track,
      true,
      "which is measured against the track it belongs to, not against the lightbox"
    );

    // Off the tick but still on the bar: nothing is named any more.
    track.dispatch("mousemove", dom.makeEvent("mousemove", { target: track }));
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      false,
      "and moving off the tick takes the bubble down"
    );
    assert.strictEqual(
      bubbleLine("chapter"),
      "中盤",
      "leaving it the words it had: emptying it first shows something else in the " +
        "last tenth of a second, which is the flash it used to give"
    );
    assert.strictEqual(
      label.style.left,
      labelAt,
      "and the place it had, so it does not slide to the handle on its way out"
    );

    // And the book moving under a pointer that has not: the bar's width changes with
    // the screen, so a named tick can be gone with no mouse event to say so. The pass
    // has to take the bubble down itself.
    track.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { target: ticks()[1] })
    );
    assert.strictEqual(bar.classList.contains("is-showing"), true);
    dom.click(box.navRight);
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      false,
      "a page turn takes it down as well: it was naming a tick that may be gone"
    );
    // Back to the cover, so the rest of this section starts where it did.
    dom.click(box.navLeft);

    // A turn: the bar follows the reader.
    dom.click(box.navRight);
    assert.deepStrictEqual(drawn(), ["/image/702/image", "/image/703/image"]);
    assert.strictEqual(
      read.style.width,
      "12.500%",
      "a screen later, the fill ends where the reader is: page 2 of 8"
    );

    // And the width follows the pages: a screen of one page is a narrower bar than a
    // screen of two, which is what makes it read as the book's own edge.
    laidOut();
    dom.flush();
    assert.strictEqual(
      track.style.width,
      "1020px",
      "the pair is still two pages wide"
    );

    // A drag: the handle follows the pointer on every event — to the pixel, with no
    // snapping — while the jump that costs a fetch is held back.
    const still = container().style.transform;
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 700 })
    );
    assert.strictEqual(
      thumb.style.left,
      "87.500%",
      "the handle is where the pointer is, not on the nearest page"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "and the jump behind it went to the screen holding page 8"
    );
    assert.strictEqual(
      track.style.width,
      "1020px",
      "and the bar keeps the width it had under the hand: page 8 stands alone, and a " +
        "bar that narrowed here would move the pages out from under the pointer " +
        "choosing them"
    );

    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 100 })
    );
    assert.strictEqual(
      thumb.style.left,
      "12.500%",
      "the next pointer event moves the handle again, just as immediately"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "while the jump waits its turn — two pictures a millisecond apart would be " +
        "one fetch and one decode each, which is what the wait is for"
    );

    // Let go before the wait is up: the release lands where the pointer left off,
    // whatever the jump it was owed — a reader who has stopped dragging has stopped
    // asking, and waiting out a timer they cannot see is the bar arguing with them.
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "letting go lands on what the pointer asked for, without waiting its turn"
    );

    await new Promise((resolve) =>
      setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "and the jump it was owed never comes: a reader who has let go of the bar is " +
        "not carried back to where they were dragging"
    );

    // A second drag, this time with the wait allowed to run out: the handle moves at
    // once, the jump lands when its turn comes, and the release asks for nothing new.
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 400 })
    );
    assert.strictEqual(
      thumb.style.left,
      "50.000%",
      "halfway along is page 4 of 8"
    );
    assert.deepStrictEqual(
      [bubbleLine("page"), bubbleLine("chapter")],
      ["5 / 8", "中盤"],
      "and the bubble says where the drag is on one line and the chapter on another"
    );

    // Crossing a tick while dragging is no reason to change what the drag is saying:
    // its bubble is the drag's, and the row keeps out of it.
    track.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { target: ticks()[1] })
    );
    assert.deepStrictEqual(
      [bubbleLine("page"), bubbleLine("chapter")],
      ["5 / 8", "中盤"],
      "and dragging over a chapter's tick does not turn the bubble into its name"
    );

    // And it holds it even when the pointer leaves the line: a drag is still a drag.
    track.dispatch("mouseleave", dom.makeEvent("mouseleave", {}));
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      true,
      "a drag holds its bubble when the pointer leaves the line"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "which is the screen holding it"
    );

    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 100 })
    );
    assert.strictEqual(thumb.style.left, "12.500%");
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "a second jump this soon is held back, so the picture is still behind"
    );

    // The pointer comes to rest with the button still down, and the jump it is owed
    // lands. That is the book moving — and the pass that notices must leave the drag's
    // bubble alone, or the bubble goes the moment a reader stops to look at it.
    await new Promise((resolve) =>
      setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/702/image", "/image/703/image"],
      "and the picture follows the handle when the wait runs out"
    );
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      true,
      "as the pointer rests with the button down, a jump landing does not take the " +
        "bubble away: the drag is still the thing it is saying"
    );

    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      false,
      "letting go takes the bubble down with the drag: what it was saying was where " +
        "the drag was going, and the reader has arrived"
    );

    // A drag that ends inside the screen it started on — page 2 of the pair already
    // on show — is the case the pass cannot clean up, because nothing about the screen
    // has changed for it to notice.
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 100 })
    );
    assert.strictEqual(bar.classList.contains("is-showing"), true);
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      false,
      "and a drag that lands where the reader already was takes it down too"
    );

    // A press on the bar is not a press on the pages: the bar is their sibling, so
    // nothing the reader does to it can pan them or turn them.
    assert.strictEqual(
      container().style.transform,
      still,
      "dragging the bar pans nothing"
    );
    const keys = [];
    dom.document.addEventListener("keydown", (event) => keys.push(event.key));
    const click = dom.click(track);
    assert.notStrictEqual(
      click.propagationStopped,
      true,
      "and the click it ends with is an ordinary one: it reaches the lightbox, which " +
        "is what puts a menu away"
    );
    assert.deepStrictEqual(
      keys,
      [],
      "and Stash's own close does not fire for it — what it closes on is its own slide, " +
        "not this plugin's bar"
    );

    // The width a drag was holding arrives when the drag is let go of — so the drag
    // ends on the page that stands alone, and the bar takes its width.
    const held = track.style.width;
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 700 })
    );
    assert.strictEqual(
      track.style.width,
      held,
      "the bar is the width it was when the hand landed on it"
    );

    // The jump is owed a wait, and the screen it lands on is a narrower one: the width
    // still stands, because the hand is still on the bar.
    await new Promise((resolve) =>
      setTimeout(resolve, NR.PROGRESS_SCRUB_MS + 40)
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/708/image"],
      "page 8, which stands alone"
    );
    // Laid out as the browser would lay out the screen that just arrived — page 8,
    // 500 wide — and the bar still holds the width the hand landed on.
    laidOut();
    dom.flush();
    assert.strictEqual(
      track.style.width,
      held,
      "and it does not narrow under the hand that is choosing pages on it, even once " +
        "the page it landed on has been measured"
    );
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.strictEqual(
      track.style.width,
      "500px",
      "and takes page 8's own width once the hand is off it"
    );

    // A tick is that chapter, on the press — the same rule as a press anywhere else on
    // the line, which goes to where it landed — and the drag that follows starts from
    // there rather than from the page under the pointer.
    const beforeTick = track.style.width;
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", {
        button: 0,
        clientX: 400,
        target: ticks()[1],
      })
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/704/image", "/image/705/image"],
      "pressing a chapter's tick opens the book at that chapter"
    );
    assert.strictEqual(
      track.style.width,
      beforeTick,
      "and the bar keeps the width it had, the hand being on it"
    );

    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    laidOut();
    dom.flush();
    assert.strictEqual(
      track.style.width,
      "1020px",
      "taking the pair's own width once the hand is off it"
    );

    // A press that arrived without a hover: a finger never hovers, and a press on a
    // tick is that chapter whether or not the pointer ever rested on it.
    track.dispatch("mouseleave", dom.makeEvent("mouseleave", {}));
    assert.strictEqual(bar.classList.contains("is-showing"), false);
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", {
        button: 0,
        clientX: 400,
        target: ticks()[1],
      })
    );
    // The bubble comes up for it as well, which is what makes this a test at all: a
    // bubble that was taken down keeps the words it had while it fades, so the words
    // alone would read the same if the press had said nothing.
    assert.strictEqual(
      bar.classList.contains("is-showing"),
      true,
      "and the bubble comes back up for it, though no hover ever put it up"
    );
    assert.strictEqual(
      bubbleLine("chapter"),
      "中盤",
      "and it says which chapter it is all the same"
    );
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));

    // B: and the drag it started does not outlive the lightbox. Left in flight, its
    // move and its release are on the *document*, which outlives the element that
    // put them there — and a release arriving while the next lightbox is open would
    // seek into *it*, at a page nobody chose.
    track.dispatch(
      "mousedown",
      dom.makeEvent("mousedown", { button: 0, clientX: 400 })
    );
    stopReader(box);
    assert.strictEqual(
      box.lightbox.querySelector(".manga-reader-progress") === null,
      true,
      "and the bar goes with the lightbox"
    );

    const next = await startReader({ galleryId: "8", on: true });
    const nextBar = next.box.lightbox.querySelector(".manga-reader-progress");
    const nextTrack = nextBar.querySelector(".manga-reader-progress-track");
    [...container().querySelectorAll("img")].forEach((image, at) => {
      image.offsetLeft = at * 520;
      image.offsetWidth = 500;
    });
    dom.flush();
    assert.strictEqual(
      nextTrack.style.width,
      "500px",
      "the bar of the next lightbox takes its width, having no hand held over it"
    );

    // And nothing of that drag is still listening on the document it was made on:
    // the hand that was down when the last lightbox went is not a hand on this one.
    const beforeRelease = drawn();
    dom.document.dispatch(
      "mousemove",
      dom.makeEvent("mousemove", { clientX: 700 })
    );
    dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));
    assert.deepStrictEqual(
      drawn(),
      beforeRelease,
      "and a release from the drag that ended in the last lightbox seeks nothing in " +
        "this one"
    );
    stopReader(next.box);
  });

  /**
   * Half a pair is not the width of a pair.
   *
   * This is the shape of what a reader saw in double-page mode: the two images of a
   * screen arrive one at a time, the first to land is measured on its own, and the bar
   * narrows to that one page — reading as the bar collapsing — until the second one
   * arrives. It cannot happen on a single page, where the one image landing *is* the
   * whole measurement, which is why it was only ever seen with two.
   *
   * So a measurement with a page missing is no measurement, and the bar holds the
   * width it had — the same answer the bar already gives for a screen that measures
   * nothing at all.
   */
  await runSection(
    "a page that has not arrived does not shrink the bar",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const track = box.lightbox.querySelector(".manga-reader-progress-track");

      // Laid out as a browser lays out a page that has arrived. This DOM has no layout
      // of its own: every box is zero-sized until a section says otherwise, which is
      // also exactly what a page that has not loaded measures.
      const laidOut = () => {
        [...container().querySelectorAll("img")].forEach((image, at) => {
          image.offsetLeft = at * 520;
          image.offsetWidth = 500;
        });
        dom.flush();
      };
      const measured = () => track.style.width;

      laidOut();
      assert.strictEqual(measured(), "500px", "the cover, which stands alone");

      // The pair on the next screen, both of its pages arrived.
      turn(box);
      laidOut();
      assert.strictEqual(
        measured(),
        "1020px",
        "then a pair, measuring as the pair"
      );

      const pair = [...container().querySelectorAll("img")];
      assert.strictEqual(pair.length, 2, "two images on the screen");

      // The first of the two has arrived and the second has not. What the first one
      // measures is a real measurement of a real image — that is what makes this
      // different from a screen with nothing on it — and it is still not the width of
      // what the reader is looking at.
      pair[0].offsetLeft = 0;
      pair[0].offsetWidth = 500;
      pair[1].offsetLeft = 520;
      pair[1].offsetWidth = 0;
      dom.flush();
      assert.strictEqual(
        measured(),
        "1020px",
        "and the second one still on its way does not shrink the bar to the first"
      );

      // And when it lands, the measurement is the one that was being held: the bar has
      // not moved, and does not move.
      laidOut();
      assert.strictEqual(
        measured(),
        "1020px",
        "…and the pair measures as the pair again"
      );

      stopReader(box);
    }
  );

  /**
   * The bar sleeps when nothing is happening, and wakes when something is.
   *
   * The clock is the test's: waiting two and a half seconds to see a bar go away is
   * a test nobody would keep. The timers the plugin sets are the plugin's own — it
   * is the callback that is run by hand here.
   */
  await runSection("the progress bar sleeps, and wakes", async () => {
    const real = dom.window.setTimeout;
    const timers = [];
    dom.window.setTimeout = (fn, ms) => {
      timers.push({ fn, ms });
      return real(fn, ms);
    };

    try {
      const { box } = await startReader({ galleryId: "8", on: true });
      const bar = box.lightbox.querySelector(".manga-reader-progress");
      const track = bar.querySelector(".manga-reader-progress-track");
      const asleep = () => bar.classList.contains("is-idle");

      // The pages as laid out, since a bar with nothing measured stays out of the way
      // however much a pointer moves over it.
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();

      // Nothing to put away and nothing yet to say: a lightbox that has just opened,
      // with a bar over it, is a bar that has to be got rid of before the picture can
      // be read.
      assert.strictEqual(
        asleep(),
        true,
        "a bar that has just been drawn is asleep"
      );
      assert.strictEqual(
        timers.filter((timer) => timer.ms === NR.PROGRESS_IDLE_MS).length,
        0,
        "and it has set itself no clock, since there is nothing to put away"
      );

      dom.click(box.navRight);
      assert.strictEqual(
        asleep(),
        false,
        "turning a page wakes it: the bar has something new to say"
      );

      const latestSleep = () =>
        timers.filter((timer) => timer.ms === NR.PROGRESS_IDLE_MS).pop();
      assert.ok(latestSleep(), "and it sets itself a clock to go to sleep by");

      latestSleep().fn();
      assert.strictEqual(
        asleep(),
        true,
        "which, when it runs out, puts it away"
      );

      // The pointer reaching the bar is what brings it back, and nothing else: a bar
      // that appeared whenever the pointer moved anywhere would bring the eye to the
      // bottom of the picture for nothing.
      box.lightbox.dispatch("mousemove", dom.makeEvent("mousemove", {}));
      assert.strictEqual(
        asleep(),
        true,
        "moving anywhere in the lightbox does not wake it"
      );

      // The row the bar sits in, which is the full width of the lightbox and taller
      // than the line: a pointer moving along it is nowhere near the bar, and a bar
      // that answered to it would stay awake for everything along the bottom of the
      // window — which is what "it takes far longer than two seconds" was.
      bar.dispatch("mousemove", dom.makeEvent("mousemove", {}));
      assert.strictEqual(
        asleep(),
        true,
        "and neither does moving along the row it sits in"
      );

      track.dispatch("mousemove", dom.makeEvent("mousemove", {}));
      assert.strictEqual(asleep(), false, "the pointer reaching the line does");

      latestSleep().fn();
      dom.click(box.navRight);
      assert.strictEqual(
        asleep(),
        false,
        "as does turning a page: the bar has something new to say, and the width of " +
          "the screen before it to say it at"
      );
      assert.strictEqual(
        track.style.width,
        "500px",
        "which is the width it keeps while the new pages are on their way"
      );

      // The pages arriving do not move it: a screen whose pictures measure nothing
      // leaves the width alone, and their own `load` is what asks for this pass.
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();
      assert.strictEqual(asleep(), false);

      stopReader(box);
    } finally {
      dom.window.setTimeout = real;
    }
  });

  /**
   * A wake the bar owes is paid inside the lightbox that owes it.
   *
   * A bar with nothing measured cannot be drawn — a bar a point wide says nothing — so
   * a turn that arrives before the pages have does not drop the asking: it is *kept*
   * (the `owed` flag in progress.ts) and answered by the pass the pictures' own `load`
   * asks for. Both halves are here, because the second is what makes keeping it safe.
   */
  await runSection(
    "a wake that was owed is paid when the pages arrive",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const bar = box.lightbox.querySelector(".manga-reader-progress");
      const asleep = () => bar.classList.contains("is-idle");

      assert.strictEqual(
        asleep(),
        true,
        "the bar opens asleep, as every lightbox's does"
      );

      // A turn with nothing measured yet: the bar has something new to say and no width
      // to say it at, so the asking waits rather than being thrown away — and the bar
      // stays where it is rather than coming out a point wide.
      dom.click(box.navRight);
      assert.strictEqual(
        asleep(),
        true,
        "a turn before the pages have measured leaves it asleep, with the wake owed"
      );

      // And what the asking was waiting for. Nothing else asks for this pass: a picture
      // arriving is not a change to the document for the observer to see.
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();
      assert.strictEqual(
        asleep(),
        false,
        "and the wake it was owed comes when the pages land"
      );

      stopReader(box);
    }
  );

  /**
   * …and the debt does not outlive that lightbox.
   *
   * What is owed is a *screen* mid-turn: a page the reader asked for and has not been
   * shown. A lightbox opened afterwards has said nothing at all, which is the one state
   * this bar is asleep in the first place for — so both what is owed and the width it
   * would be paid at belong to the lightbox that ran up the debt, and closing one takes
   * them with it. The window is the first moments of a lightbox, before any page of the
   * session has been measured; the reader who opens a second gallery in it is the one
   * who sees the difference.
   */
  await runSection(
    "a wake owed to one lightbox is not spent in the next",
    async () => {
      const first = await startReader({ galleryId: "8", on: true });
      const firstBar = first.box.lightbox.querySelector(
        ".manga-reader-progress"
      );

      dom.click(first.box.navRight);
      assert.strictEqual(
        firstBar.classList.contains("is-idle"),
        true,
        "a turn with nothing measured leaves the first lightbox owing itself a wake"
      );
      stopReader(first.box);

      const second = await startReader({ galleryId: "8", on: true });
      const secondBar = second.box.lightbox.querySelector(
        ".manga-reader-progress"
      );
      [...container().querySelectorAll("img")].forEach((image, at) => {
        image.offsetLeft = at * 520;
        image.offsetWidth = 500;
      });
      dom.flush();

      assert.strictEqual(
        secondBar.classList.contains("is-idle"),
        true,
        "and the next lightbox keeps its bar asleep: a wake the last one owed is not " +
          "the new one's to spend, and neither is the width it was owed at"
      );

      stopReader(second.box);
    }
  );

  /**
   * A gallery of one page gets no bar.
   *
   * There is no progress to show through a single picture, and a bar across the foot
   * of one would be furniture with nothing to say — the same reason Stash draws its
   * own counter only for a lightbox of more than one image.
   */
  await runSection("a gallery of one page gets no bar", async () => {
    const { box } = await startReader({
      galleryId: "12",
      on: true,
      total: 1,
    });

    assert.strictEqual(
      box.lightbox.querySelector(".manga-reader-progress") === null,
      true,
      "the one-page gallery has no bar at all — not a hidden one"
    );

    stopReader(box);
  });
};
