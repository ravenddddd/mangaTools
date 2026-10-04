/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  globalListeners,
  runSection,
  settle,
  turn,
  container,
  drawn,
  press,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * The arrows move the *reader* now, not the lightbox: a press is a screen, and
   * nothing is sent anywhere. That is what taking the lightbox over bought — the old
   * shape was a press aimed at Stash's index, waiting for its header to say the press
   * had landed and retrying if it did not, with the whole errand to hold it together.
   */
  await runSection(
    "the arrows move by screen, and drive nothing else",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });

      // What the plugin sends the lightbox, as opposed to what it consumes. It dispatches
      // nothing at all now; this is the listener that would see it if it did.
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const forwards = press("ArrowRight");
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "a press moves by a screen, not by a page"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "and the lightbox is not driven to get there: its pages are this plugin's"
      );
      assert.strictEqual(
        forwards.defaultPrevented,
        true,
        "and the press is consumed, so Stash's own handler does not take it too"
      );
      assert.strictEqual(forwards.propagationStopped, true);

      sent.length = 0;
      press("ArrowLeft");
      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "backwards is a screen too, back to the cover"
      );
      assert.deepStrictEqual(sent, [], "and still nothing is sent");

      // The end of the book is left to Stash, which does nothing with it either:
      // consuming the press would only be a lie about having moved.
      turn(box, 3);
      sent.length = 0;
      const pastTheEnd = press("ArrowRight");
      assert.deepStrictEqual(sent, [], "nothing to move on to");
      assert.strictEqual(pastTheEnd.defaultPrevented, false);

      // A key press this plugin did not make passes straight through to the lightbox —
      // if its own handler took these, every step would double.
      sent.length = 0;
      dom.document.dispatchEvent(
        dom.makeEvent("keydown", { key: "ArrowRight", isTrusted: false })
      );
      assert.deepStrictEqual(
        sent,
        ["ArrowRight"],
        "an untrusted press is not ours"
      );

      stopReader(box);
    }
  );

  await runSection("a change elsewhere does not restart the wait", async () => {
    // Held from before anything is drawn, which is when the two questions differ:
    // with no previous screen to keep, the container is empty while the first one
    // is on its way — and "empty" and "nothing drawn yet" are not the same thing.
    dom.holdImages();
    const { box } = await startReader({ on: true });

    const before = dom.imagesAskedFor();
    // Stash keeps changing the page while the screen is on its way: its counter is
    // rewritten, its slides swap, the menu that was just open closes. Any of those
    // is a DOM change, and each used to be read as "nothing has been drawn".
    dom.flush();
    dom.flush();
    await settle();

    assert.strictEqual(
      dom.imagesAskedFor() - before,
      0,
      "the screen is asked for once, however much the page changes while it loads"
    );

    dom.settleImages();
    await settle();
    assert.deepStrictEqual(
      drawn(),
      ["/image/101/image"],
      "and it goes up when its image is there"
    );

    stopReader(box);
  });

  await runSection(
    "a focused field does not take the arrows from the reader",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const keyTo = (target, key) =>
        dom.dispatchTo(
          target,
          dom.makeEvent("keydown", { key, isTrusted: true })
        );

      // The options menu is open and the focus is on a switch the reader just clicked
      // in it — a checkbox. The arrows do nothing to a checkbox (space toggles it), so
      // a press here is still the reader's. Treating every `<input>` as a field that
      // owns the arrows meant these went past the reader to Stash's own handler, a page
      // at a time: "it only happens while the menu is open".
      //
      // The switch, rather than the pairing beside it: the pairing is a pair of
      // buttons now, and a button is not an `<input>` — this section is about the rule
      // that has to tell an input that owns its arrows from one that does not.
      const input = box.lightbox.querySelector("#manga-reader-cover-alone");
      assert.ok(input, "the panel has switches in it to put the focus on");

      turn(box);
      sent.length = 0;
      const onSwitch = keyTo(input, "ArrowRight");
      assert.strictEqual(
        onSwitch.defaultPrevented,
        true,
        "a press with the switch focused is the reader's"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/404/image", "/image/405/image"],
        "…and it turns the reader by a screen like any other"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…without sending anything to the lightbox, since nothing needs it to move"
      );

      // A text field is a different matter: the arrows are its own, and the plugin
      // must not take them from it.
      const field = dom.makeElement("input");
      field.type = "text";
      const inField = keyTo(field, "ArrowRight");
      assert.strictEqual(
        inField.defaultPrevented,
        false,
        "a text field keeps its own arrow keys"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…and nothing is sent for it either: the lightbox is not what moves"
      );

      stopReader(box);
    }
  );

  await runSection(
    "Stash's own chevrons turn a screen, not a page",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      // The pair 402+403 is the second screen, so a click on Stash's chevron is a turn
      // — where Stash's own handler would move one page, which is the same screen and
      // would look like nothing happening.
      sent.length = 0;
      const click = dom.click(box.navRight);
      assert.strictEqual(
        click.defaultPrevented,
        true,
        "the click is the reader's"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "…and Stash's own button never sees it"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "and it turned a screen, not a page"
      );
      assert.deepStrictEqual(
        sent,
        [],
        "…without driving the lightbox to do it"
      );

      sent.length = 0;
      const back = dom.click(box.navLeft);
      assert.strictEqual(
        back.propagationStopped,
        true,
        "the other chevron is the same"
      );
      assert.deepStrictEqual(sent, [], "and it drives nothing either");

      stopReader(box);
    }
  );

  await runSection(
    "a click on a page turns it, as Stash's own does",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const sent = [];
      dom.document.addEventListener("keydown", (event) => sent.push(event.key));

      const page = () => container().children[0].children[0];
      // As the browser would report it: the width of the image on screen, which is
      // what tells the two halves apart. Set per draw, because a draw replaces the
      // images.
      const laidOut = () => {
        page().offsetWidth = 100;
      };

      laidOut();
      sent.length = 0;
      const forward = dom.click(page(), { offsetX: 80 });
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "the right half of a page goes forward, like Stash's own image click"
      );
      assert.strictEqual(forward.propagationStopped, true);
      assert.deepStrictEqual(
        sent,
        [],
        "and the lightbox is not driven to do it"
      );

      laidOut();
      sent.length = 0;
      dom.click(page(), { offsetX: 10 });
      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "and the left half goes back"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the space around the pages still closes the lightbox",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const keys = [];
      dom.document.addEventListener("keydown", (event) => keys.push(event.key));

      // Stash closes its lightbox when a click reaches the slide the pages sit in
      // (Lightbox.tsx's handleClose), and every bit of that slide is behind this
      // plugin's container — so the click is turned back into what Stash would have
      // done with it, which is Escape. What the harness can see is the ask: its
      // lightbox has no Escape of its own to act on it.
      const click = dom.click(container());
      assert.deepStrictEqual(
        keys,
        ["Escape"],
        "a click on the letterbox asks Stash to close"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "and nothing else sees it"
      );

      // A press and a release here first, which is not a press on a page: the drag it
      // might have begun moves nothing, so the click that follows is still a click —
      // and it has to be, because this is the click that closes the lightbox. Which is
      // also why the press forgets what the *last* one was: a press that is not on a
      // page leaves nothing behind, not even "the pointer was held a moment ago".
      const letterbox = container();
      letterbox.dispatch(
        "mousedown",
        dom.makeEvent("mousedown", { button: 0, clientX: 100, clientY: 100 })
      );
      dom.document.dispatch(
        "mousemove",
        dom.makeEvent("mousemove", { clientX: 104, clientY: 100 })
      );
      dom.document.dispatch("mouseup", dom.makeEvent("mouseup", {}));

      keys.length = 0;
      dom.click(letterbox);
      assert.deepStrictEqual(
        keys,
        ["Escape"],
        "and a press beside the pages does not turn the click after it into a drag"
      );

      stopReader(box);
    }
  );

  /**
   * In fullscreen, a click on the space around the pages does nothing.
   *
   * The click that closes the lightbox everywhere else is a click on the margin of a
   * book, and a reader who has filled the screen with one and then clicks its margin
   * has asked for nothing — being handed their browser back is not nothing. Leaving
   * fullscreen is the header's button, or Escape: deliberately not the thing a reader
   * hits while reading.
   */
  await runSection(
    "while fullscreen, a click on the space around the pages does nothing",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const keys = [];
      dom.document.addEventListener("keydown", (event) => keys.push(event.key));

      dom.click(box.lightbox.querySelector(".manga-reader-fullscreen"));
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "the header's button fills the screen with the lightbox"
      );

      // The letterbox: the container itself, not a page inside it.
      const click = dom.click(container());
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "and a click on the space around the pages leaves the screen as it is"
      );
      assert.deepStrictEqual(
        keys,
        [],
        "and closes nothing either: it is the margin of a book, not a way out of one"
      );
      assert.strictEqual(
        click.propagationStopped,
        true,
        "and nothing else sees it"
      );

      dom.click(container());
      assert.strictEqual(
        dom.document.fullscreenElement,
        box.lightbox,
        "the next one is no different — leaving fullscreen is the button, or Escape"
      );

      // Out of fullscreen, the same click is the click it has always been.
      dom.click(box.lightbox.querySelector(".manga-reader-fullscreen"));
      assert.strictEqual(
        dom.document.fullscreenElement,
        null,
        "the button gives the screen back"
      );
      dom.click(container());
      assert.deepStrictEqual(
        keys,
        ["Escape"],
        "and with the screen given back, the letterbox closes the lightbox as it did"
      );

      stopReader(box);
    }
  );

  /**
   * Back closes the lightbox.
   *
   * Stash's lightbox lives in its own state and not in the route: nothing about a
   * page change takes it away, so pressing Back leaves the reader looking at the
   * pages of a gallery they are no longer on. What the route does give is the event
   * that says the page changed, and a page change under an open lightbox is that
   * lightbox's cue to close — through the same Escape everything else closes it by.
   */
  await runSection("Back closes the lightbox", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });
    const keys = [];
    dom.document.addEventListener("keydown", (event) => keys.push(event.key));

    const relocate = (pathname) => {
      for (const fn of globalListeners["stash:location"] || []) {
        fn({ detail: { data: { location: { pathname } } } });
      }
    };

    relocate("/galleries/8");
    assert.deepStrictEqual(
      keys,
      [],
      "the page as it already stands is not a move — Stash reports it on mount too"
    );

    relocate("/galleries/8");
    assert.deepStrictEqual(
      keys,
      [],
      "and neither is a list re-sorted behind the lightbox, which is a change of " +
        "query rather than of page"
    );

    relocate("/galleries");
    assert.deepStrictEqual(
      keys,
      ["Escape"],
      "while leaving the page closes the lightbox, the way Escape does"
    );

    stopReader(box);
  });
};
