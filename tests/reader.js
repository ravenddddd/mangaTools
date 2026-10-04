const {
  assert,
  fs,
  path,
  BUNDLE,
  dom,
  state,
  mutations,
  settingsWrites,
  imageQueries,
  shown,
  globalListeners,
  loggedErrors,
  failures,
  runSection,
  settle,
  errorsSince,
  page,
  buildLightbox,
  mountBridge,
  buildChaptersTab,
  chapterMenu,
  chapterRanges,
  savedReaderSettings,
  storedSettings,
  settingsWith,
  drawnRows,
  turn,
  container,
  drawn,
  press,
  CHAPTERS_VIEW,
  CHAPTERS_PATH,
  numbered,
  NR,
  NS,
} = require("./reader/harness.js");
/** 01: the pairing rules and the stored settings they read — see reader/01-pairing.js */
const pairing = require("./reader/01-pairing.js");

// ── Sections ───────────────────────────────────────────────────────

async function main() {
  // The tools half's gallery map is fetched as the bundle loads, and it is what tells
  // the reader which galleries are manga — so nothing here is marked until its answer
  // lands, which is a promise and therefore after a turn.
  await settle();

  await runSection("the plugin loads and watches for a lightbox", () => {
    assert.ok(NR, "the bundle should publish window.MangaReader");
    assert.strictEqual(typeof NR.layout, "function");
    assert.strictEqual(
      dom.observerCount(),
      1,
      "one observer on the document, which is how the lightbox is found"
    );
    assert.strictEqual(
      (dom.window.listeners.keydown || []).length,
      1,
      "and one key listener, on the window, so it runs before Stash's own"
    );
  });

  /**
   * The namespace document and what the bundle publishes are the same list.
   *
   * `MangaReaderNamespace` in src/reader/namespace.ts is the whole API the sections
   * below are written against: it is what says `NR.pageAtTop` is there, and takes the
   * rows and an edge. Nothing compared it with the runtime, though — a type declaration
   * is not a promise an implementation has to keep, since the module that publishes is
   * not the module that declares — so a member that was renamed, or dropped, or never
   * written at all, left a document that reads as an inventory and is not one.
   * `readStrip` was in it for months, published by nothing.
   *
   * Names, and not the shapes of them: an implementation that grows a parameter the
   * declaration has not is the drift this cannot see, and it is the one this repo has
   * actually had. What that one has instead is a caller — the three-argument call to
   * `columnFitted` in the column's own section, which is what pins the *behaviour* the
   * declaration was a sentence about.
   */
  await runSection(
    "the namespace declares exactly what the bundle publishes",
    () => {
      const source = fs.readFileSync(
        path.join(__dirname, "..", "src", "reader", "namespace.ts"),
        "utf8"
      );
      const body = source
        .slice(source.indexOf("export interface MangaReaderNamespace {"))
        // Comments stripped first, as the stylesheet checks do: a member's own note
        // names it, and a check that reads prose is a check that passes for the wrong
        // reason.
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const declared = [
        ...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/gm),
      ].map((match) => match[1]);
      const published = Object.keys(NR);

      assert.ok(
        declared.length > 20,
        "the document should have been read at all, before it is compared"
      );
      assert.deepStrictEqual(
        declared.filter((name) => !published.includes(name)),
        [],
        "every member the namespace declares should be published by the reader: one " +
          "that is not is a member nothing can call, described as though it could"
      );
      assert.deepStrictEqual(
        published.filter((name) => !declared.includes(name)),
        [],
        "…and everything the reader publishes should be declared, or the tests are " +
          "calling something the document does not know about"
      );
    }
  );

  await pairing();
  // ── The reader itself ────────────────────────────────────────────
  //
  // Every section below puts the page back to a known state before it does
  // anything, and that is not tidiness: one failing assertion would otherwise leave
  // a lightbox behind with the mode still on, and every section after it would be
  // testing that instead of what it says. A test that fails should fail alone.

  /**
   * A lightbox on a gallery page, with this plugin's switch set where the section
   * needs it, and the pages fetched.
   *
   * The mode is set by *using the switch*, which is the only way to change it from
   * outside the bundle — the plugin's copy of the settings is module state, and
   * writing localStorage behind its back would be testing a state it never reads.
   */
  async function startReader(options) {
    const {
      galleryId = "7",
      at = 1,
      total = 5,
      on = true,
      language = null,
      counterText,
      search = "",
      ids = null,
      mode = null,
      // A page with no gallery, or a gallery this plugin does not touch, has no
      // switch of ours — and a section about that would be asking for the wrong thing.
      expectSwitch = true,
    } = options || {};

    for (const child of dom.body.children.slice()) child.remove();
    dom.window.location.pathname = galleryId ? `/galleries/${galleryId}` : "/";
    // Cleared every time, not left as the last test set it: the order is read from
    // the URL as the gallery is fetched, so a leftover would be a section reading
    // another section's sort.
    dom.window.location.search = search;
    state.language = language;
    dom.flush();

    // What the carousel is showing, unless the section says otherwise: the gallery's
    // own images, which is what Stash would have loaded. The reader finds its place by
    // matching that image against its list, so any order of the same images does.
    const showing =
      ids ||
      (state.galleries[galleryId]
        ? (
            state.galleries[galleryId].pathImages ||
            state.galleries[galleryId].images ||
            []
          ).map((i) => String(i.id))
        : null);

    const box = buildLightbox(at, total, showing);
    // Some lightboxes have no counter at all — Stash draws it only for more than one
    // image — and that has to be true before the mode is turned on, not after.
    if (counterText !== undefined) box.counter.textContent = counterText;
    const popover = box.openPopover();
    dom.flush();

    // The pairing is the reader's own now, in its own header — see chrome.ts. It is
    // there for a marked gallery whether or not a pair is on, because the mode is not
    // what puts the reader on a gallery: the mark is.
    await settle();
    // Which of the three ways the pages are laid out. `on` still says whether they are
    // paired, because that is what most of the suite means by it; the mode is named
    // when a section wants the column, which cannot be reached through `on` at all.
    const wanted = {
      single: "#manga-reader-single-page",
      double: "#manga-reader-double-page",
      scroll: "#manga-reader-scroll",
    }[mode || (on ? "double" : "single")];
    const input = box.lightbox.querySelector(wanted);
    if (expectSwitch) {
      assert.ok(
        input,
        "the pairing should be in the lightbox's own options menu"
      );
    }

    // Whether to press it, read off the control: a press on the half already chosen
    // says nothing at all, so doing it unconditionally would be a section turning the
    // mode on twice and calling the second one a change.
    if (input && !input.classList.contains("is-on")) dom.click(input);
    await settle();

    return { box, input, popover };
  }

  /**
   * A gallery of five ordinary pages: screens are [1] [2+3] [4+5], so a pair is
   * something the arrows and the offset can be seen against. Gallery 8 in these
   * fixtures has a spread in it, which changes what the pairing does.
   */
  /** Closes the lightbox and lets the reader notice */
  function stopReader(box) {
    box.close();
    dom.flush();
  }

  /** Puts the chapters tab away, the way leaving the page would */
  function stopTab(tab) {
    tab.close();
    dom.window.location.pathname = "/";
    dom.flush();
  }

  /**
   * The switch is one page or two now, not draw or not. What decides whether a gallery
   * is this plugin's to draw is the mark on the gallery — see markedInStore — so a
   * reader with the switch off gets single pages rather than Stash's lightbox.
   */
  await runSection(
    "a marked gallery is drawn with the switch off too",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: false });

      assert.deepStrictEqual(
        drawn(),
        ["/image/401/image"],
        "one page at a time, since the pairing is off"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "and the reader is drawing in the lightbox either way"
      );

      stopReader(box);
    }
  );

  /**
   * The one switch that turns *this half* off.
   *
   * Reading a gallery is the whole of what this half does, and off means Stash's own
   * lightbox — drawn by Stash, with nothing of this half's added to it — while the
   * mark, the fields, the panels and the badges all stay exactly as they were. The
   * setting belongs to the managing half and is written from the plugin's settings
   * page, which is why it is set here by hand rather than through the reader's own
   * JSON: the reader only ever reads it.
   */
  await runSection(
    "the takeover switch, which is the whole of this half",
    async () => {
      NS.readerTakeover = false;
      const { box } = await startReader({ on: true, expectSwitch: false });

      assert.strictEqual(
        container(),
        null,
        "nothing of ours is drawn beside the carousel"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        false,
        "and the lightbox is not marked as one of ours"
      );
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-chrome"),
        null,
        "…nor does it carry any of our chrome"
      );

      NS.readerTakeover = true;
      const { box: back } = await startReader({ on: true });
      assert.notStrictEqual(
        container(),
        null,
        "and turning it back on gives the lightbox to the plugin again"
      );

      // The same switch, turned off while the lightbox is being read. Whatever is
      // ours comes back out where it stands rather than being left on screen by a
      // pass that only stops drawing: the container, our chrome and the two classes
      // that hide Stash's own. `step` is what notices, and any change to the page
      // runs it — the flush is the test's way of standing in for one.
      NS.readerTakeover = false;
      dom.flush();
      await settle();
      assert.strictEqual(
        container(),
        null,
        "turned off mid-read, the container comes away"
      );
      assert.strictEqual(
        back.lightbox.classList.contains("manga-reader-active"),
        false,
        "…and Stash's own lightbox is what is left"
      );

      NS.readerTakeover = true;
      stopReader(back);
    }
  );

  await runSection("the switches are in the reader's own header", async () => {
    const { box, input } = await startReader({ on: false });

    // The single half is the chosen one when the mode is off — the control shows the
    // state, it does not set it.
    assert.strictEqual(
      input.classList.contains("manga-reader-segment"),
      true,
      "the pairing is one of the panel's two segments"
    );
    assert.strictEqual(
      input.classList.contains("is-on"),
      true,
      "and the single page is the chosen half, because the mode is off"
    );
    assert.strictEqual(
      box.lightbox
        .querySelector("#manga-reader-double-page")
        .classList.contains("is-on"),
      false,
      "…while the other half is not"
    );

    // In the reader's own header, which is the only home it has: the one that used
    // to be injected into Stash's options popover was inside the very header the
    // reader hides, so a reader could turn the reader off from a menu it could not
    // see it had.
    const inChrome = (node) => {
      for (let at = node; at; at = at.parentNode) {
        if (at.classList?.contains("manga-reader-chrome")) {
          return true;
        }
      }
      return false;
    };
    assert.strictEqual(
      inChrome(input),
      true,
      "in the reader's own header, not in somebody else's menu"
    );
    // The two halves are Stash's own `minimal` buttons — what its lightbox header
    // draws its own buttons with — and the track they sit in is this plugin's, so
    // that the chosen one can be seen at all against a popover of the same colour.
    assert.strictEqual(
      input.classList.contains("btn") && input.classList.contains("minimal"),
      true,
      "and in Stash's own button markup, so it reads as one of its own"
    );
    assert.strictEqual(
      box.lightbox.querySelector(".custom-switch .custom-control-input") !==
        null,
      true,
      "beside switches in Bootstrap's own markup, which is what Stash's toggles are"
    );

    stopReader(box);
  });

  await runSection(
    "the switch speaks the interface language once it is known",
    async () => {
      // The language comes from Stash's answer to the gallery query, so the wording
      // is right from the *second* time the menu is opened — which is all it can be,
      // and worth saying out loud. A gallery no earlier section has opened, since a
      // gallery already read is remembered and would not be asked about again.
      const { box } = await startReader({
        galleryId: "51",
        total: 2,
        on: true,
        language: "zh-TW",
      });

      const label = box.lightbox.querySelector(
        ".manga-reader-chrome .manga-reader-row-label"
      );
      assert.strictEqual(
        label.textContent,
        "封面單獨一頁",
        "a traditional-Chinese interface reads the traditional wording"
      );

      stopReader(box);
    }
  );

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

  await runSection("a screen arrives rather than snapping in", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    const spread = container();
    assert.strictEqual(
      spread.animations.length,
      1,
      "the first screen fades in as it arrives"
    );
    assert.deepStrictEqual(
      spread.animations[0].keyframes,
      [{ opacity: 0 }, { opacity: 1 }],
      "…from nothing to what it is: a fade, not a slide or a scale"
    );

    // Counted, not compared against one: the animations are the container's own
    // history, and the container outlives the screens drawn into it.
    const before = spread.animations.length;
    turn(box);
    assert.strictEqual(
      spread.animations.length,
      before + 1,
      "and every screen after it does the same"
    );

    // A reader who has asked their system for less motion gets the page, not the
    // dissolve — decoration does not get to overrule that.
    dom.prefersReducedMotion(true);
    const quiet = spread.animations.length;
    turn(box, 2);
    dom.flush();
    assert.strictEqual(
      spread.animations.length,
      quiet,
      "nothing is animated when reduced motion is on"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/404/image", "/image/405/image"],
      "…though the screen itself is still drawn"
    );
    dom.prefersReducedMotion(false);

    stopReader(box);
  });

  /**
   * The fade, which is a pair of buttons rather than a choice of lengths.
   *
   * It was a slider, and what a reader did with it was look for the length that
   * stopped being noticeable — which is what FADE_MS is. So the length is the
   * plugin's and the choice is yes or no.
   */
  await runSection(
    "the fade is a pair of buttons, and a length nobody picks",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");

      const off = panel.querySelector("#manga-reader-fade-off");
      const on = panel.querySelector("#manga-reader-fade-on");
      assert.ok(off && on, "the panel offers the fade as two buttons");
      assert.deepStrictEqual(
        [off.textContent, on.textContent],
        ["None", "Fade in"],
        "named for what they do, one of which is nothing"
      );
      assert.strictEqual(
        on.classList.contains("is-on"),
        true,
        "fading is what a screen does by default"
      );
      assert.strictEqual(
        off.classList.contains("is-on"),
        false,
        "…and the other half is not chosen"
      );

      // Which is connected to the pages: a turn fades, for as long as the constant says.
      const before = container().animations.length;
      turn(box);

      const animations = container().animations;
      assert.strictEqual(
        animations.length,
        before + 1,
        "a turn fades as it arrives"
      );
      assert.strictEqual(
        animations[animations.length - 1].options.duration,
        NR.FADE_MS,
        "for a length that is the plugin's rather than the reader's — there is one, and " +
          "it is not on this panel"
      );

      // And the other half means what it says: the screen arrives at once.
      dom.click(off);
      assert.strictEqual(
        off.classList.contains("is-on") && !on.classList.contains("is-on"),
        true,
        "choosing no fading moves the mark to that half"
      );

      box.move(4);
      dom.flush();
      assert.strictEqual(
        container().animations.length,
        before + 1,
        "and a screen after it is drawn with no animation at all"
      );

      // Put back: the setting is the library's, and one left off would be changing what
      // every section after this one reads.
      dom.click(on);
      assert.strictEqual(
        savedReaderSettings().fade,
        true,
        "and the choice is written where the settings live — the plugin's own settings, " +
          "which go to Stash with the rest of them"
      );

      stopReader(box);
    }
  );

  await runSection("the offset key re-pairs the gallery", async () => {
    const { box } = await startReader({ galleryId: "36", on: true });

    // On the second screen, which is where the two layouts differ: without the offset
    // its screen is 2+3, and with it page 2 stands alone.
    turn(box);
    const before = drawn();
    assert.deepStrictEqual(before, ["/image/402/image", "/image/403/image"]);

    press("o");
    assert.deepStrictEqual(
      drawn(),
      ["/image/402/image"],
      "O shifts the pairing by one page and redraws — the escape hatch for a page " +
        "that was taken for a spread and was not one"
    );
    assert.strictEqual(
      box.lightbox.querySelector("#manga-reader-offset").checked,
      true,
      "and the switch in the options menu says so, because both routes go through " +
        "the one place that sets it"
    );

    press("o");
    assert.deepStrictEqual(drawn(), before, "and shifts it back");

    stopReader(box);
  });

  /**
   * The pairing shift: a setting of the browser's, like the rest of them.
   *
   * It was remembered per gallery — a map from gallery id to shift — on the argument
   * that a gallery whose pages are grouped wrongly is a gallery, not a reader. It is
   * the other way round: a reader whose scans are grouped wrongly is reading scans,
   * and being made to set the same switch on each of them is the feature failing at
   * its one job.
   */
  await runSection(
    "the pairing shift is a setting, and re-pairs at once",
    async () => {
      const { box } = await startReader({ galleryId: "36", on: true });

      const offsetSwitch = box.lightbox.querySelector("#manga-reader-offset");
      assert.ok(offsetSwitch, "the options panel offers the shift");
      assert.strictEqual(
        offsetSwitch.checked,
        false,
        "and it starts unshifted"
      );

      turn(box);
      offsetSwitch.checked = true;
      offsetSwitch.dispatch("change");

      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "turning it on re-pairs the gallery there and then"
      );

      assert.strictEqual(
        savedReaderSettings().offset,
        true,
        "and it is written where the settings live, like every other switch"
      );
      assert.strictEqual(
        dom.window.localStorage.getItem("plugin.mangaTools.offsets"),
        null,
        "…rather than into a map of galleries, which is what it used to be"
      );

      stopReader(box);

      // A fresh lightbox — and a *different* gallery, which is the part that changed:
      // this is the browser's setting, so the next gallery the reader opens is shifted
      // too, without being asked again.
      const again = await startReader({ galleryId: "8", on: true });
      assert.strictEqual(
        again.box.lightbox.querySelector("#manga-reader-offset").checked,
        true,
        "a gallery opened afterwards has the shift the reader chose"
      );

      turn(again.box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "and is paired with it"
      );

      // Put back: the setting is the browser's, so a section that left it on would be
      // deciding for every section after it — which is exactly what it did when this
      // was written per gallery and a failing section could not turn it off.
      const back = again.box.lightbox.querySelector("#manga-reader-offset");
      back.checked = false;
      back.dispatch("change");
      assert.strictEqual(
        savedReaderSettings().offset,
        false,
        "and the section puts it back"
      );

      stopReader(again.box);
    }
  );

  await runSection(
    "turning the pairing off leaves one page a screen",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image", "/image/403/image"],
        "drawing pairs first"
      );

      // The other half of the pair, pressed. A press on the half already chosen says
      // nothing at all — see the next section — which is why this one has to be the
      // half that is not.
      dom.click(box.lightbox.querySelector("#manga-reader-single-page"));

      assert.deepStrictEqual(
        drawn(),
        ["/image/402/image"],
        "and with the pairing off the page the reader is in stands alone"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "in the same lightbox, still drawn by this plugin"
      );

      stopReader(box);
    }
  );

  /**
   * A press on the half that is already chosen says nothing.
   *
   * The reader re-lays the pages whenever it hears this setting, and re-laying them
   * for a press that chose what was already true is a screen redrawn for nothing —
   * a flicker, for a reader who pressed a button that was already on.
   */
  await runSection(
    "a press on the half already chosen says nothing",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });

      // What a re-lay looks like from outside: the screen is drawn again, and being
      // drawn is what the fade is. Nothing else about this press would show.
      const before = container().animations.length;
      dom.click(box.lightbox.querySelector("#manga-reader-double-page"));
      assert.strictEqual(
        container().animations.length,
        before,
        "pressing the half that is already chosen draws nothing again"
      );

      dom.click(box.lightbox.querySelector("#manga-reader-single-page"));
      assert.notStrictEqual(
        container().animations.length,
        before,
        "…while pressing the other half draws the screen again, because that is a change"
      );

      stopReader(box);
    }
  );

  /**
   * The two switches that have been stored since the pairing was written and had no
   * control until now.
   *
   * `coverAlone` and `detectSpreads` were read by the layout and written by nothing:
   * settings a reader could neither see nor change. Both are in the panel now, and
   * what matters is not that they are drawn but that they reach the pages — a switch
   * that writes a setting the screen does not obey is worse than no switch.
   */
  await runSection(
    "the two switches that had no control reach the pairing",
    async () => {
      // Gallery 7: 101 | 102 | 103(wide) | 104+105 — a cover, an ordinary page, a page
      // that is two pages wide, and a pair. Each of the two switches has something in
      // this gallery to change.
      const { box } = await startReader({ galleryId: "7", on: true, total: 5 });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");
      const flip = (id) => {
        const input = panel.querySelector(id);
        input.checked = !input.checked;
        input.dispatch("change");
        dom.flush();
      };

      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the cover stands alone by default"
      );
      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "and the wide page after it stands alone, so nothing pairs with it"
      );

      flip("#manga-reader-detect-spreads");
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image", "/image/103/image"],
        "turning the detection off lets the wide page pair with its neighbour"
      );

      flip("#manga-reader-cover-alone");
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image", "/image/102/image"],
        "and turning the cover off pairs it, which moves the page being read into " +
          "that pair"
      );

      // Put back, both of them: these are the browser's settings rather than this
      // gallery's, so a section that left them flipped would be deciding for every
      // section after it.
      flip("#manga-reader-cover-alone");
      flip("#manga-reader-detect-spreads");
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "with both back, the reader is on the page they were on, alone again"
      );
      assert.deepStrictEqual(
        savedReaderSettings(),
        settingsWith({ readingMode: "double" }),
        "and the settings are where they were found — this section flipped two of " +
          "them and put both back, which is where they started"
      );

      stopReader(box);
    }
  );

  /**
   * The settings live with the library, and the library's copy is the one that is read.
   *
   * Which is the whole of where they come from now: this browser holds nothing, and
   * what an older build left in one is not read — a library with no settings in it reads
   * as the defaults, and the first change writes the lot. See the note at the top of
   * settings.ts for why carrying each browser's old value up was not worth the branch.
   *
   * **What is checked here is the reading half's side of it.** Getting the value into
   * `NS.readerSettingsRaw` is the managing half's job — it is the half that reads the
   * plugin's configuration and tells everybody when it has — and the settings sections
   * of the smoke suite are where that is checked.
   */
  await runSection(
    "the library's copy of the settings is what is read",
    async () => {
      // What an older build left in this browser, which nothing reads any more.
      dom.window.localStorage.setItem(
        "plugin.mangaTools.settings",
        JSON.stringify({
          readingMode: "scroll",
          coverAlone: false,
          detectSpreads: false,
          fade: false,
          offset: true,
        })
      );

      NS.readerSettingsRaw = null;
      assert.deepStrictEqual(
        NR.readSettings(),
        settingsWith(),
        "a library with nothing in it reads as the defaults, and not as what this " +
          "browser happens to remember"
      );

      // The shape a library has: the way of reading, and a set for each way. Two of the three
      // sets say something, and which one is read is the mode the object names — which is the
      // whole of what the shape is for.
      NS.readerSettingsRaw = storedSettings({
        readingMode: "double",
        profiles: {
          double: { coverAlone: false, detectSpreads: false, fade: false },
          scroll: { offset: true, showProgress: false },
        },
      });
      assert.deepStrictEqual(
        NR.readSettings(),
        settingsWith({
          readingMode: "double",
          coverAlone: false,
          detectSpreads: false,
          fade: false,
        }),
        "and with something in the library, that is what is read — every one of them, " +
          "not only the ones a section happened to set"
      );
      assert.strictEqual(
        NR.parseSettings(
          storedSettings({
            readingMode: "scroll",
            profiles: {
              double: { coverAlone: false, detectSpreads: false, fade: false },
              scroll: { offset: true, showProgress: false },
            },
          })
        ).offset,
        true,
        "…and the set for the column is read when the column is what is being read: the " +
          "two sets are kept apart, and neither is the other's fallback"
      );

      // Put back: this browser's leftovers, so the sections after this one start from the
      // state they expect.
      NS.readerSettingsRaw = null;
      dom.window.localStorage.removeItem("plugin.mangaTools.settings");
    }
  );

  await runSection("the mode is remembered for the next session", async () => {
    // Off first, so turning it on is a change — which is what a switch reports, and
    // what makes it write anything at all.
    const off = await startReader({ galleryId: "8", on: false });
    stopReader(off.box);

    const { box } = await startReader({ galleryId: "8", on: false });
    assert.ok(container(), "drawing either way");

    // Pressed back: the same setting, the other way, which is a change again.
    dom.click(box.lightbox.querySelector("#manga-reader-double-page"));

    assert.deepStrictEqual(
      savedReaderSettings(),
      settingsWith({ readingMode: "double" }),
      "the pairing writes the setting it changed and leaves the rest alone — the whole " +
        "settings map, the managing half's on it too"
    );
    assert.deepStrictEqual(
      Object.keys(settingsWrites[settingsWrites.length - 1]).sort(),
      [
        "confirmUnmark",
        "coverIcon",
        "deleteOnUnmark",
        "enabledLanguages",
        "fieldCensorship",
        "fieldLanguage",
        "fieldOriginal",
        "fieldTranslationGroup",
        "fields",
        "hidePerformers",
        "manageChapters",
        "openDetailsBlock",
        "openEditBlock",
        "readerSettings",
        "readerTakeover",
        "showCoverBadge",
        "showDisabledFields",
        "showFlags",
        "sidebarFilters",
      ],
      "…and it is the whole map: saving the reader's settings cannot take the " +
        "managing half's with it, because there is one place that builds all of it"
    );

    stopReader(box);
  });

  await runSection(
    "a gallery Stash cannot answer for is not drawn",
    async () => {
      state.failing = true;
      const at = loggedErrors.length;

      const { box } = await startReader({
        galleryId: "9",
        on: true,
        expectSwitch: false,
      });

      assert.strictEqual(container() === null, true, "nothing is drawn");
      assert.ok(
        errorsSince(at).some((line) =>
          /could not read this gallery's pages/.test(line)
        ),
        "and the failure is reported rather than passed over"
      );

      state.failing = false;
      stopReader(box);
    }
  );

  /**
   * The header used to be how the reader knew where it was, so one it could not read
   * was a lightbox it must not draw over. The place comes from *which image is
   * showing* now, and the header is not read at all — so a header this plugin cannot
   * make sense of is nothing to it.
   */
  await runSection(
    "a header this plugin cannot read is not its business",
    async () => {
      const at = loggedErrors.length;
      const { box } = await startReader({ galleryId: "11", on: true });

      // A header with no counter in it: several pages, and nothing that says "N / M".
      box.counter.textContent = "1";
      dom.flush();

      assert.deepStrictEqual(
        drawn(),
        ["/image/201/image"],
        "the pages are drawn all the same"
      );
      assert.deepStrictEqual(
        errorsSince(at),
        [],
        "and nothing is reported: the counter is not what the reader reads"
      );

      stopReader(box);
    }
  );

  /**
   * A gallery of one page: nothing to pair, and nothing wrong with it either. The
   * header's counter is drawn only when there is more than one image, which is what
   * used to make this look like markup that had changed — it is drawn now by this
   * plugin, and the page count is its own.
   */
  await runSection("a one-page gallery is drawn, and is quiet", async () => {
    const at = loggedErrors.length;
    const { box } = await startReader({
      galleryId: "12",
      counterText: "",
      on: true,
    });

    assert.deepStrictEqual(
      drawn(),
      ["/image/301/image"],
      "the one page is drawn"
    );
    assert.deepStrictEqual(
      errorsSince(at),
      [],
      "and nothing is reported: one page is not a fault"
    );

    stopReader(box);
  });

  // ── Chapters ──────────────────────────────────────────────────────

  /**
   * The rules, called directly. What a chapter is here is a name and the images
   * that are in it, and every one of these is about keeping that rather than a
   * position — Stash's own shape is the opposite, and the reason this plugin keeps
   * a list of its own at all.
   */
  await runSection(
    "what a stored chapter list is, and what it is not",
    async () => {
      const chapters = (value) => NR.parseChapters(JSON.stringify(value));

      assert.deepStrictEqual(
        chapters({
          v: 1,
          chapters: [
            { title: "開幕", images: ["703", "701"] },
            { title: "中盤", images: [705] },
          ],
        }),
        [
          { title: "開幕", images: ["703", "701"] },
          { title: "中盤", images: ["705"] },
        ],
        "a list this plugin wrote is read back, ids as strings either way they were written"
      );
      assert.deepStrictEqual(
        chapters({ v: 1, chapters: [] }),
        [],
        "an empty list is a gallery whose chapters were cleared, and draws nothing"
      );
      assert.strictEqual(
        chapters({ v: 2, chapters: [{ images: ["1"] }] }),
        null,
        "a version this build does not know is unreadable, not best-effort"
      );
      assert.strictEqual(
        NR.parseChapters(null),
        null,
        "no field at all is null"
      );
      assert.strictEqual(NR.parseChapters(""), null, "and so is an empty one");
      assert.strictEqual(
        NR.parseChapters("not json"),
        null,
        "a hand-edited value is unreadable rather than a guess"
      );
      assert.deepStrictEqual(
        chapters({
          v: 1,
          chapters: [
            { title: "x" },
            { title: "kept", images: [] },
            { title: "mixed", images: ["9", null, "10"] },
            "nonsense",
            null,
          ],
        }),
        [
          { title: "kept", images: [] },
          { title: "mixed", images: ["9", "10"] },
        ],
        "a chapter is kept as far as it can be read, and one that is not a chapter is not"
      );

      // Stash's own numbers, expanded against the order they count in. Stash gives
      // each chapter a start and nothing else, so a chapter's images are the run
      // from its own start up to the next one's — written out once, here, so that
      // one rule can serve both sources.
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [
            { title: "二", image_index: 5 },
            { title: "一", image_index: 1 },
          ],
          ["708", "707", "706", "705", "704", "703", "702", "701"]
        ),
        [
          { title: "一", images: ["708", "707", "706", "705"] },
          { title: "二", images: ["704", "703", "702", "701"] },
        ],
        "a chapter index counts from one, and its images run to the next chapter's"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [{ title: "only", image_index: 3 }],
          ["a", "b", "c", "d"]
        ),
        [{ title: "only", images: ["c", "d"] }],
        "and the last chapter runs to the end"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(
          [{ title: "gone", image_index: 99 }],
          ["1", "2", "3"]
        ),
        [],
        "a chapter pointing past the end is dropped rather than clamped"
      );
      assert.deepStrictEqual(
        NR.chaptersFromStash(null, ["1"]),
        [],
        "and a gallery with none translates to none"
      );

      // Where they fall on screen: at the chapter's earliest page in this order.
      const pages = numbered(CHAPTERS_VIEW).map((i) => page(String(i.id)));
      const placed = NR.placeChapters(
        [
          // Written out of order on purpose: the array is a set, so which id is
          // first in it means nothing.
          { title: "開幕", images: ["704", "702"] },
          { title: "中盤", images: ["708", "705", "706"] },
          { title: "not here", images: ["999"] },
          { title: "empty", images: [] },
        ],
        pages
      );
      assert.deepStrictEqual(
        placed.map((c) => [c.title, c.at]),
        [
          ["開幕", 1],
          ["中盤", 4],
        ],
        "each chapter at its earliest page in this order, and one with nothing here is not placed"
      );
      assert.deepStrictEqual(
        NR.placeChapters(
          [
            { title: "後", images: ["705"] },
            { title: "前", images: ["701"] },
          ],
          pages
        ).map((c) => c.title),
        ["前", "後"],
        "the list's own order does not decide — the screen does"
      );

      // What a chapter is placed at is the earliest page it lists, which is the
      // page a jump to it should land on.
      assert.strictEqual(placed[0].at, 1, "placed at its earliest page");
      assert.deepStrictEqual(
        placed[0].images,
        ["704", "702"],
        "…keeping the images it was given, in the order they were written"
      );

      // And how far it runs, which is the other end of what the menu shows. Its own
      // last page rather than the page before the next chapter begins: those agree
      // for every list this plugin writes and every Stash list it imports — both are
      // runs — and part company the moment a chapter in the middle is deleted, when
      // the pages between the two are in no chapter at all.
      assert.deepStrictEqual(
        placed.map((c) => [c.at, c.to]),
        [
          [1, 3],
          [4, 7],
        ],
        "each placed with its own last page, read on screen"
      );

      // The pair, from the writing side. What is written has to be what reading it
      // back gives — and note the *fixed point* as well as the round trip. Parsing
      // is the tolerant half: it turns numbers into strings and drops rows that
      // cannot be ids, so a serialiser emitting something the parser then
      // normalises would still round-trip canonical input while quietly changing
      // the value on a second write. The fixed point is the law that catches that.
      const list = [
        { title: "開幕", images: ["703", "701"] },
        { title: "中盤", images: ["705"] },
      ];
      assert.strictEqual(
        NR.serializeChapters(list),
        '{"v":1,"chapters":[{"title":"開幕","images":["703","701"]},' +
          '{"title":"中盤","images":["705"]}]}',
        "a list is written as the field's own JSON, in a literal key order"
      );
      assert.deepStrictEqual(
        NR.parseChapters(NR.serializeChapters(list)),
        list,
        "and reading back what was written gives the same list"
      );
      assert.strictEqual(
        NR.serializeChapters(NR.parseChapters(NR.serializeChapters(list))),
        NR.serializeChapters(list),
        "writing after reading writes the same bytes, which is what makes a second " +
          "edit of the same gallery a no-op rather than a rewrite"
      );

      // A cleared list is still a list: the version is what makes it readable, and
      // a gallery somebody emptied must not fall back to Stash's rows.
      assert.strictEqual(
        NR.serializeChapters([]),
        '{"v":1,"chapters":[]}',
        "and an empty list is written as an empty list, not as nothing"
      );
    }
  );

  /**
   * The four edits, called directly.
   *
   * Everything the chapter form does is one of these: a page id and the order the
   * pages are in, never an index into a list — the tab reads path order and the
   * lightbox reads whatever the reader sorted by, so a position is the one thing
   * that would mean two different pages on the two surfaces.
   */
  await runSection("editing a chapter list, as arithmetic", () => {
    /** Ten pages, and a list covering them in three runs */
    const order = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const list = () => [
      { title: "A", images: ["1", "2", "3"] },
      { title: "B", images: ["4", "5", "6"] },
      { title: "C", images: ["7", "8", "9", "10"] },
    ];
    const shape = (chapters) =>
      chapters.map((c) => c.title + ":" + c.images.join(","));

    assert.deepStrictEqual(
      shape(NR.addChapterAt(list(), order, "5", "new")),
      ["A:1,2,3", "B:4", "new:5,6", "C:7,8,9,10"],
      "a new chapter takes the run from its page to the next chapter's start, out " +
        "of the chapter that held it"
    );
    assert.deepStrictEqual(
      shape(NR.addChapterAt(list(), order, "8", "new")),
      ["A:1,2,3", "B:4,5,6", "C:7", "new:8,9,10"],
      "…and a chapter that begins near the end runs to the end of the gallery, " +
        "there being no next chapter to stop it"
    );
    assert.strictEqual(
      NR.addChapterAt(list(), order, "4", "new"),
      null,
      "a page a chapter already begins at is nothing to create"
    );
    assert.strictEqual(
      NR.addChapterAt(list(), order, "99", "new"),
      null,
      "and neither is a page this gallery does not have"
    );

    // A page nobody owns is a start too — the cover before the first chapter, or
    // the run a delete released.
    const gapped = [
      { title: "A", images: ["1", "2", "3"] },
      { title: "C", images: ["7", "8", "9", "10"] },
    ];
    assert.deepStrictEqual(
      shape(NR.addChapterAt(gapped, order, "5", "new")),
      ["A:1,2,3", "new:5,6", "C:7,8,9,10"],
      "a chapter can begin on pages nobody owns, and takes only the run that follows"
    );

    assert.deepStrictEqual(
      shape(NR.renameChapterAt(list(), order, "7", "renamed")),
      ["A:1,2,3", "B:4,5,6", "renamed:7,8,9,10"],
      "renaming finds the chapter by where it begins"
    );
    assert.strictEqual(
      NR.renameChapterAt(list(), order, "5", "renamed"),
      null,
      "and there is nothing to rename where no chapter begins"
    );
    assert.deepStrictEqual(
      // A chapter whose pages are not a run — which only an odd import or a
      // hand-edited field can make. Renaming is not a reason to re-cut it.
      NR.renameChapterAt(
        [{ title: "odd", images: ["1", "3", "4"] }],
        order,
        "1",
        "x"
      ),
      [{ title: "x", images: ["1", "3", "4"] }],
      "renaming touches the title and nothing else"
    );

    assert.deepStrictEqual(
      shape(NR.moveChapterStart(list(), order, "4", "6")),
      ["A:1,2,3,4,5", "B:6", "C:7,8,9,10"],
      "moving a start later gives the pages it gives up to the chapter before it"
    );
    assert.deepStrictEqual(
      shape(NR.moveChapterStart(list(), order, "7", "5")),
      ["A:1,2,3", "B:4", "C:5,6,7,8,9,10"],
      "and moving one earlier takes its first pages back out of that chapter"
    );
    assert.strictEqual(
      NR.moveChapterStart(list(), order, "4", "7"),
      null,
      "moving onto another chapter's start is refused: one of the two would hold nothing"
    );
    assert.strictEqual(NR.moveChapterStart(list(), order, "5", "6"), null);
    assert.strictEqual(
      NR.moveChapterStart(list(), order, "4", "99"),
      null,
      "and a page this gallery does not have is nowhere to move to"
    );

    const removed = NR.removeChapterAt(list(), order, "5");
    assert.deepStrictEqual(
      shape(removed),
      ["A:1,2,3", "C:7,8,9,10"],
      "removing takes the chapter away"
    );
    assert.strictEqual(
      removed.some((chapter) => chapter.images.includes("5")),
      false,
      "…and its pages are in no chapter at all afterwards, rather than joining the " +
        "chapter before: deleting a chapter is not moving a boundary"
    );
    assert.strictEqual(
      NR.removeChapterAt(list(), order, "99"),
      null,
      "a page this gallery does not have is nothing to remove"
    );
    assert.strictEqual(
      NR.removeChapterAt(gapped, order, "5"),
      null,
      "and neither is a page in no chapter at all"
    );

    // The one thing no edit may do: throw away a chapter it was not asked to.
    const stranded = [
      { title: "here", images: ["1", "2"] },
      { title: "gone", images: ["901", "902"] },
    ];
    const survived = (chapters) =>
      chapters ? chapters.map((c) => c.title) : null;

    assert.deepStrictEqual(
      survived(NR.addChapterAt(stranded, order, "2", "new")),
      ["here", "new", "gone"],
      "a chapter whose pages this gallery no longer has survives an edit — last, " +
        "where the order cannot place it"
    );
    assert.deepStrictEqual(
      survived(NR.moveChapterStart(stranded, order, "1", "2")),
      ["here", "gone"],
      "and survives one that re-cuts everything else"
    );
    assert.deepStrictEqual(
      survived(NR.renameChapterAt(stranded, order, "1", "x")),
      ["x", "gone"],
      "and one that only renames"
    );
  });

  /**
   * The write, what it announces, and the one change it keeps to take back.
   *
   * Called directly: the surfaces above it — the tab's form and the lightbox — are
   * what call this, and what they draw is their own sections' business.
   */
  await runSection("writing chapters, and saying so", async () => {
    const list = [{ title: "A", images: ["1", "2"] }];
    const next = [
      { title: "A", images: ["1"] },
      { title: "B", images: ["2"] },
    ];
    const written = (at) =>
      mutations[at].variables.input.custom_fields.partial[
        "plugin.mangaTools.chapters"
      ];

    const heard = [];
    const stop = NR.watchChapters((id) => heard.push(id));

    const at = mutations.length;
    await NR.writeChapters("901", next);

    assert.strictEqual(mutations.length - at, 1, "the write goes out, once");
    assert.strictEqual(
      written(at),
      '{"v":1,"chapters":[{"title":"A","images":["1"]},{"title":"B","images":["2"]}]}',
      "as the list it was handed, serialised"
    );
    assert.deepStrictEqual(
      heard,
      ["901"],
      "and everyone listening hears which gallery changed"
    );
    // What is asserted about a listener that has stopped listening: the write still
    // happens, and it is only the listening that stopped.
    const stopHeard = heard.length;
    const beforeStop = mutations.length;
    stop();
    await NR.writeChapters("901", list);
    assert.strictEqual(
      mutations.length - beforeStop,
      1,
      "the write still happens after a listener stops listening"
    );
    assert.strictEqual(
      heard.length,
      stopHeard,
      "…and only the listening stopped, which is what the tab asks for when the page " +
        "it was drawing into has gone"
    );
  });
  await runSection(
    "the lightbox is handed this plugin's own chapters",
    async () => {
      mountBridge();
      const { box } = await startReader({
        galleryId: "31",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.strictEqual(
        shown.length,
        1,
        "the lightbox was handed a list, once"
      );
      const { props } = shown[0];

      assert.strictEqual(
        props.images.length,
        8,
        "the images are the ones the reader drew"
      );
      assert.deepStrictEqual(
        props.images.map((i) => i.id),
        CHAPTERS_VIEW.map(String),
        "in the order it drew them"
      );
      assert.ok(
        typeof props.images[0].paths.image === "string" &&
          props.images[0].visual_files[0].width === 1000,
        "each in the shape Stash's lightbox reads: a picture URL and a native size"
      );
      assert.strictEqual(props.totalCount, 8, "counted as the lightbox counts");
      assert.strictEqual(
        props.pageSize,
        8,
        "one page of everything, so it never asks for another"
      );

      assert.deepStrictEqual(
        chapterMenu(box),
        ["開幕", "中盤"],
        "and the chapters, in the order they begin on screen"
      );

      // Each row says which pages its chapter covers — the chapter's own first and
      // last page on screen, one-based. The first two pages of this gallery are in no
      // chapter at all, which is why the first range starts at 3: the range is what
      // the chapter holds, not what follows its beginning.
      assert.deepStrictEqual(
        chapterRanges(box),
        ["3–4", "5–8"],
        "with the range of pages each one covers"
      );

      // The chapter being read, marked down its side — and the menu's own jump, which
      // is how this section gets the reader into a chapter to have something to mark.
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const chapterToggle = [
        ...chrome.querySelectorAll(".manga-reader-menu-button"),
      ].find((button) => button.dataset.opens === "chapters");
      const marked = () =>
        [...box.lightbox.querySelectorAll(".manga-reader-menu-item")]
          .filter((item) => item.classList.contains("is-current"))
          .map(
            (item) =>
              item.querySelector(".manga-reader-chapter-name").textContent
          );

      assert.deepStrictEqual(
        marked(),
        [],
        "nothing is marked before anything is read"
      );

      dom.click(chapterToggle);
      const rows = [
        ...box.lightbox.querySelectorAll(".manga-reader-menu-item"),
      ];
      dom.click(rows[1]);
      dom.flush();

      assert.deepStrictEqual(
        drawn(),
        ["/image/704/image", "/image/705/image"],
        "the second row jumps to the screen the second chapter begins on — page 5 of " +
          "8, which the cover being on its own pairs with the page before it"
      );
      // Which row is marked is the header's own answer, and this is the assertion
      // that says the two cannot disagree: the header names the chapter of the page
      // its screen *starts* on, and the jump asked for a page inside it — so here it
      // is 開幕, because page 5 of 8 pairs with the page before it, which is the last
      // page of the chapter before.
      assert.strictEqual(
        chrome.querySelector(".manga-reader-chapter").textContent,
        "開幕",
        "the header names the chapter of the page the screen begins on"
      );
      assert.deepStrictEqual(
        marked(),
        ["開幕"],
        "and the menu marks the same one, once"
      );

      // Marked with this plugin's own class, not Bootstrap's: `active` is a solid blue
      // slab across the row, and in a header of white icons it was the loudest thing
      // on the screen for a mark that only says where the reader is.
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-menu-item.active"),
        null,
        "with this plugin's own class rather than Bootstrap's"
      );

      // And it is handed over again the next time the lightbox is opened. A reader
      // opens one, closes it, opens it again — and the *second* lightbox is the one
      // where the footer's gallery link was reported missing, so this is the case to
      // pin rather than assume.
      stopReader(box);
      const again = await startReader({
        galleryId: "31",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });
      assert.strictEqual(
        shown.length,
        2,
        "opening the lightbox a second time hands the list over again"
      );
      assert.deepStrictEqual(
        shown[1].props.images.map((i) => i.id),
        CHAPTERS_VIEW.map(String),
        "with the same images in the same order"
      );
      stopReader(again.box);
    }
  );

  await runSection(
    "Stash's own chapters are handed over in the order on screen",
    async () => {
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "32",
        on: true,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.deepStrictEqual(
        chapterMenu(box),
        ["第二話", "第一話"],
        "a gallery still on Stash's numbers is listed in the order it is read"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the images carry what Stash names them by, and it does the naming",
    async () => {
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "51",
        on: true,
        total: 2,
        search: "?sortby=title&perPage=500",
      });

      const [first, second] = shown[0].props.images;
      assert.strictEqual(
        first.title,
        "第二話",
        "a title comes through as it is"
      );
      assert.strictEqual(
        first.visual_files[0].path,
        "/manga/author/002.jpg",
        "…and so does the file it is"
      );
      assert.deepStrictEqual(
        first.galleries,
        [{ id: "51", title: "Gallery 51", folder: null }],
        "and the gallery it is in, which is what Stash's own footer links back to: an " +
          "image that belongs to none is an image whose lightbox shows no such link"
      );
      assert.strictEqual(second.title, "", "an image with no title has none");
      assert.strictEqual(
        second.visual_files[0].path,
        "/manga/author/003.jpg",
        "…and still says which file it is, which is what Stash shows instead"
      );

      stopReader(box);
    }
  );

  /**
   * The footer names the page the reader is on.
   *
   * Stash renders its footer from *its* place in the lightbox, and this half never
   * moves that place: a turn is the reader's own arithmetic, and the carousel is left
   * where the lightbox opened, hidden, holding the index it mounted with. So the
   * footer named the image the reader opened on — right on the first page and never
   * again. What is corrected is the image link, in place; see footer.ts.
   */
  await runSection("the footer names the page the reader is on", async () => {
    const { box } = await startReader({
      galleryId: "51",
      on: true,
      total: 2,
      search: "?sortby=title&perPage=500",
    });

    const center = box.lightbox.querySelector(".Lightbox-footer-center");
    const link = center.querySelector(".image-link");
    const gallery = center.querySelector(".image-gallery-link");

    assert.strictEqual(
      link.textContent,
      "第二話",
      "the page the lightbox opened on is the one the footer names"
    );
    assert.strictEqual(link.getAttribute("href"), "/images/901");

    // Stash's own gallery link, left alone: one gallery behind the lightbox, and the
    // reader never leaves it — so there is nothing there to correct.
    assert.strictEqual(
      gallery.textContent,
      "Gallery",
      "and the gallery link is Stash's own, untouched"
    );

    // A turn, and the name follows it — the title where there is one, and the file's
    // name where there is not, which is the rule Stash's own footer names a page by.
    dom.click(box.navRight);
    assert.deepStrictEqual(drawn(), ["/image/902/image?t=17000000902"]);
    assert.strictEqual(
      link.textContent,
      "003.jpg",
      "the next page is named by its file, since it has no title"
    );
    assert.strictEqual(link.getAttribute("href"), "/images/902");

    // And the click: a router link goes where it was *rendered* to go, so the
    // corrected href would mean nothing if the router still heard the click.
    const click = dom.click(link);
    assert.strictEqual(
      click.propagationStopped,
      true,
      "a click on the footer's link is kept from the router, so the browser follows " +
        "the corrected href rather than the one Stash rendered"
    );

    stopReader(box);
  });

  await runSection(
    "a carousel showing images this plugin never read",
    async () => {
      shown.length = 0;
      mountBridge();
      const at = loggedErrors.length;

      // A carousel showing some other gallery's images. Finding its place by identity
      // is the one thing this plugin does to know where it is, so an image it never
      // read is a lightbox it cannot follow — and it says so rather than drawing
      // whatever happens to sit at that number.
      const { box } = await startReader({
        galleryId: "33",
        on: true,
        expectSwitch: false,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: ["901", "902", "903", "904", "905", "906", "907", "908"],
      });
      await settle();

      assert.strictEqual(container() === null, true, "nothing is drawn");
      assert.deepStrictEqual(
        shown,
        [],
        "and nothing is handed over, so Stash's own menu — or none — stands"
      );
      assert.ok(
        errorsSince(at).some((line) =>
          /not among the pages this plugin read/.test(line)
        ),
        "and the reader says what it could not find"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the chapters go to the lightbox with the mode off",
    async () => {
      // Twice, and the first one is what makes the second mean anything: startReader
      // turns the switch off *after* it has built a lightbox, so its own flush happens
      // with the mode still on from the section before — and a read already begun
      // finishes whatever the mode says by then.
      const first = await startReader({ galleryId: "33", on: false, total: 8 });
      stopReader(first.box);

      // A gallery neither call has read, so the read in this one happens with the mode
      // already off — which is the whole question.
      shown.length = 0;
      mountBridge();
      const { box } = await startReader({
        galleryId: "34",
        on: false,
        total: 8,
        search: "?sortby=title&perPage=500",
        ids: CHAPTERS_VIEW.map(String),
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/701/image"],
        "one page at a time: the pairing is off, and the mark is what decides the rest"
      );
      assert.strictEqual(
        shown.length,
        1,
        "and the lightbox has the chapters anyway, since a reader who never turns the " +
          "spread view on still wants them"
      );
      assert.deepStrictEqual(
        chapterMenu(box),
        ["開幕", "中盤"],
        "…the gallery's chapters, in the order on screen"
      );

      stopReader(box);
    }
  );

  /**
   * The gallery page's own Chapters tab, which this plugin renders from its own
   * chapters. Stash's rows are read for as long as they are all that knows where a
   * chapter is, and are never written — the point of taking the tab over is that
   * the plugin's field becomes the one that says where chapters are.
   */
  /**
   * The two menus in the reader's own header. Nothing else asserts that they open —
   * which is how they shipped dead: the state changed on a click and nothing redrew,
   * so a reader pressing either of them saw nothing at all.
   */
  await runSection("the header's two menus open and close", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const menu = (which) => chrome.querySelector(".manga-reader-menu-" + which);
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );

    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "the chapter menu starts closed"
    );

    dom.click(toggle("chapters"));
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      true,
      "and the button in the header opens it"
    );
    assert.deepStrictEqual(
      [...menu("chapters").querySelectorAll(".manga-reader-menu-item")].map(
        (item) => item.querySelector(".manga-reader-chapter-name").textContent
      ),
      ["開幕", "中盤"],
      "onto the gallery's chapters"
    );
    assert.strictEqual(
      menu("chapters").querySelector(".manga-reader-menu-head") !== null,
      true,
      "under a heading of its own, which is what a list this long needs"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      true,
      "the other button opens the settings"
    );
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "and only one menu is open at a time"
    );
    assert.ok(
      menu("settings").querySelector("#manga-reader-double-page"),
      "which holds the switches"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      false,
      "and pressing it again puts the menu away"
    );

    // Anything that is not the menu closes it — Stash's own options popover closes
    // this way, and a menu that only its own button can put away is one a reader ends
    // up reading past.
    // The footer, which is Stash's own markup with no handler of its own: a click
    // there reaches the lightbox and nothing else, which is the case this is about.
    // (A click on a page reaches it too, and turns the page on the way.)
    dom.click(toggle("chapters"));
    assert.strictEqual(menu("chapters").classList.contains("show"), true);
    dom.click(box.lightbox.querySelector(".Lightbox-footer"));
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "and a click anywhere else in the lightbox puts it away"
    );
    assert.strictEqual(
      toggle("chapters").getAttribute("aria-expanded"),
      "false",
      "with the button saying so"
    );

    stopReader(box);
  });

  /**
   * What this header looks like is Stash's stylesheet's business, which means the
   * markup has to be Stash's own: every class asserted here is one its own lightbox
   * header puts on the same element, read off its `LightboxHeader`. A class of this
   * plugin's own would be styled by nothing and would read as a plugin's header,
   * which is the one thing this half exists not to be.
   *
   * The icon names are asserted for the same reason: the stub has no Font Awesome
   * to draw with, so the name the button asks for is the whole of what a test can
   * see — and it is also the part that was wrong, when the header drew its own
   * three bars and its own cross out of characters.
   */
  await runSection("the header is Stash's own markup", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );
    const owns = (el, ...names) =>
      names.every((name) => el.classList.contains(name));

    const chapterButton = toggle("chapters");
    assert.ok(
      owns(
        chapterButton,
        "minimal",
        "Lightbox-header-chapter-button",
        "dropdown-toggle",
        "btn",
        "btn-primary"
      ),
      "the chapter button is the Dropdown.Toggle Stash's own header draws"
    );
    const dropdown = chrome.querySelector(".dropdown");
    assert.ok(
      dropdown.contains(chapterButton),
      "inside the wrapper a dropdown menu is positioned against — without it the " +
        "menu is positioned against the page, and opens off the bottom of it"
    );
    assert.ok(
      dropdown.contains(chrome.querySelector(".Lightbox-header-chapters")),
      "and the menu is in that same wrapper, which is what positions it"
    );

    assert.strictEqual(
      chrome
        .querySelector(".manga-reader-chapter-menu")
        .getAttribute("data-manga-reader-hidden"),
      null,
      "and a gallery that has chapters is offered the menu to read them in"
    );

    const gear = toggle("settings");
    assert.ok(
      owns(gear, "btn", "btn-link"),
      "the gear is one of the link buttons Stash draws the rest of its header with"
    );
    const anchor = chrome.querySelector(".Lightbox-header-options-icon");
    assert.ok(
      anchor.contains(gear) &&
        anchor.contains(chrome.querySelector(".popover")),
      "and it sits in the options box its popover is measured from"
    );
    assert.strictEqual(
      chrome.querySelector(".manga-reader-options-anchor") === anchor,
      true,
      "which this plugin also names, because the measuring is the one thing it adds"
    );

    const close = chrome.querySelector(".manga-reader-close");
    assert.strictEqual(close.tagName, "BUTTON");
    assert.ok(owns(close, "btn", "btn-link"), "the cross is one too");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(close),
      "at the end of the group that ends the row"
    );
    assert.strictEqual(
      close.title,
      "Close Lightbox",
      "and says what Stash's own says"
    );

    // Fullscreen, which Stash offers where the browser has it and this header has
    // to offer the same way — including asking for it of the lightbox, since that
    // is what fills the screen rather than the browser's own chrome coming back.
    const full = chrome.querySelector(".manga-reader-fullscreen");
    assert.ok(
      full,
      "the header should draw a fullscreen button where the browser has one"
    );
    assert.ok(
      owns(full, "btn", "btn-link"),
      "the fullscreen button is one of the link buttons too"
    );
    assert.strictEqual(full.dataset.icon, "faExpand");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(full),
      "drawn in the group that ends the row, where Stash draws its own"
    );
    assert.strictEqual(dom.document.fullscreenElement, null);
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      box.lightbox,
      "pressing it fills the screen with the lightbox"
    );
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      null,
      "and pressing it again gives the screen back — read at the click, so leaving " +
        "fullscreen with Esc does not leave the button pointing the wrong way"
    );

    // The settings panel, which is a `popover` because that is what Stash's own
    // options menu is: a heading, a body, and a `form-group` around each control.
    // Without the body the controls sit against the border, with no gap between
    // them and none to the edge.
    const settings = chrome.querySelector(".manga-reader-menu-settings");
    assert.ok(
      settings.classList.contains("popover") &&
        settings.classList.contains("manga-reader-settings"),
      "the settings are a popover"
    );
    const header = settings.querySelector(".popover-header");
    assert.ok(
      header,
      "the panel should have a heading, as Stash's own options popover does"
    );
    assert.strictEqual(
      header.textContent,
      "Reading options",
      "its own words, because this panel is this plugin's own — Stash's says " +
        '"Options" over a flat list of controls, and this one has three groups'
    );
    const body = settings.querySelector(".popover-body");
    assert.ok(body, "and a body, which is where its padding comes from");
    for (const id of [
      "#manga-reader-single-page",
      "#manga-reader-double-page",
      "#manga-reader-cover-alone",
      "#manga-reader-detect-spreads",
      "#manga-reader-offset",
      "#manga-reader-fade-off",
      "#manga-reader-fade-on",
      "#manga-reader-show-progress",
      "#manga-reader-show-marks",
      "#manga-reader-wheel",
      "#manga-reader-shift-wheel",
      "#manga-reader-ctrl-wheel",
    ]) {
      const control = settings.querySelector(id);
      assert.ok(control, `${id} should be in the panel`);
      assert.ok(
        body.contains(control),
        `${id} should be inside the body rather than beside it`
      );
      assert.ok(
        [...body.querySelectorAll(".form-group")].some((group) =>
          group.contains(control)
        ),
        `${id} should have a form-group of its own — that is where the gap between ` +
          "one control and the next comes from"
      );
    }

    // Four groups, each with its own heading: how the pages are paired, whether a screen
    // fades in as it arrives, what is drawn over the pages while they are read, and what the
    // wheel does. Stash's own panel is one flat list, so this is the arrangement this plugin
    // chose. The shift used to be a group of its own, named for a gallery — it is remembered
    // for the browser now, and belongs with the other pairing settings.
    assert.deepStrictEqual(
      [...body.querySelectorAll(".manga-reader-group")].map(
        (group) => group.querySelector(".manga-reader-group-label").textContent
      ),
      ["Reading", "Animation", "Progress", "Wheel"],
      "in four groups, each named"
    );
    assert.strictEqual(
      body.querySelectorAll(".manga-reader-divider").length,
      3,
      "with a rule between each pair of them, and none around the outside"
    );

    // **The one note in this panel**, and the one thing a reader cannot work out from the
    // panel itself: that every row below the way-of-reading chooser belongs to that way of
    // reading, and that the settings live on the server rather than in this browser. It hangs
    // off the Reading group's own heading, and it opens on hover — see the stylesheet — which
    // is what the settings page's "?" does and for the same reason: nothing about it is state.
    // Found from the document rather than from the panel this section is holding: the menus
    // are drawn into the lightbox's own header, and a section that kept a panel element from
    // before a re-draw would be asking the wrong tree.
    const help = dom.body.querySelector(".manga-reader-help");
    assert.ok(help, "the Reading group carries a note");
    assert.strictEqual(
      help.parentNode.classList.contains("manga-reader-heading-line"),
      true,
      "…on the heading of the group that chooses the way of reading, and not on a row"
    );
    assert.strictEqual(
      help.parentNode.parentNode.querySelector(".manga-reader-group-label")
        .textContent,
      "Reading",
      "…which is the Reading group's own heading"
    );
    // And it survives a pass. The words it sits beside are written by every pass — that is
    // what `say` does — and writing text into an element takes its children with it, which is
    // exactly how this note came to be built and then wiped out on the very next pass.
    dom.flush();
    assert.strictEqual(
      dom.body.querySelector(".manga-reader-help") === null,
      false,
      "…and it is still there after a pass has written the words beside it"
    );
    const note = help.querySelector(".manga-reader-help-panel").textContent;
    assert.strictEqual(
      note,
      "The settings are stored on the server. Each way of reading has a set of its own, " +
        "and they do not affect one another.",
      "…and it says both things: which set these rows are, and where the settings are kept"
    );
    const helpButton = help.querySelector(".manga-reader-help-button");
    assert.strictEqual(
      helpButton.getAttribute("aria-label"),
      note,
      "which is also what the button is called for a reader who cannot see it"
    );
    // And it *says* something. A wrapper, a note, and nothing in the button between them is a
    // note no reader can open — which is what this was, and why the "?" could not be found on
    // the page. The glyph is Stash's own icon where the plugin API can draw one; this DOM
    // cannot, so what is read here is the character that stands in for it, the same fallback
    // the settings page's "?" has.
    assert.strictEqual(
      helpButton.textContent,
      "?",
      "…and the button wears a glyph, or there is nothing to hover"
    );

    // No descriptions: a row is its label and its control, and there is nothing under
    // either. A quiet line under a switch is Stash's own shape for one, and this panel
    // has decided against it for now.
    assert.strictEqual(
      body.querySelector(".form-text"),
      null,
      "and no hint under any row"
    );

    // The two settings that had no control until now: stored and obeyed since the
    // pairing was written, and reachable from nothing.
    for (const id of [
      "#manga-reader-cover-alone",
      "#manga-reader-detect-spreads",
    ]) {
      const control = settings.querySelector(id);
      assert.strictEqual(
        control.classList.contains("custom-control-input"),
        true,
        `${id} should be a switch in Bootstrap's own markup`
      );
      assert.strictEqual(
        control.checked,
        true,
        `${id} should start on, which is what this plugin has always read it as`
      );
    }

    // The fade is two buttons rather than a slider — the class it used to wear was
    // Bootstrap *5*'s name for one, against an app built on 4. The panel does have one
    // slider now, and it is the bar's clock: read off the inputs by hand, because the
    // stub answers ids, classes and tags and nothing else. `input[type=range]` matches
    // *nothing* here — which is how this check came to pass for as long as it did while
    // proving nothing at all.
    const ranges = [...settings.querySelectorAll("input")].filter(
      (input) => input.type === "range"
    );
    assert.deepStrictEqual(
      ranges.map((input) => input.id),
      ["manga-reader-idle"],
      "the panel's one slider is the bar's clock, and the fade is not a slider"
    );

    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "the chapter button asks for bars while the chapters are away"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faTimes",
      "and for a cross while they are open, as Stash's own does"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "and for bars again once they are put away"
    );
    assert.strictEqual(gear.dataset.icon, "faCog", "the gear is always a cog");
    assert.strictEqual(
      close.dataset.icon,
      "faTimes",
      "and the cross is always a cross"
    );

    stopReader(box);
  });

  /**
   * A menu is placed by the stylesheet and nudged back inside the window.
   *
   * The stylesheet anchors both menus to a button, and a button is a place rather than
   * a promise: the gear is three buttons from the edge of the window, and the window is
   * as narrow as the reader made it. Stash's own popover gets this from react-overlays,
   * which measures it and flips or slides it until it fits; this header is DOM work
   * with no React in it, so it measures and slides the panel itself.
   *
   * The arithmetic first, on its own, because the DOM these tests draw with has no
   * layout at all — every box is zero-sized and nothing can be measured — so a
   * placement is a number a section has to be able to ask for directly. A negative
   * shift is leftwards, a positive one rightwards.
   */
  await runSection(
    "a menu that lands off an edge is moved back inside the window",
    async () => {
      assert.strictEqual(
        NR.fitShift(100, 276, 1200, 8),
        0,
        "a menu with room on both sides is left where the stylesheet put it"
      );
      assert.strictEqual(
        NR.fitShift(1100, 276, 1200, 8),
        -184,
        "one hanging off the right is slid left, as far as the margin and no further"
      );
      assert.strictEqual(
        NR.fitShift(-168, 348, 380, 8),
        176,
        "and one hanging off the left, on a narrow window, is slid back the other way"
      );
      assert.strictEqual(
        NR.fitShift(0, 600, 380, 8),
        8,
        "a menu wider than the window keeps its left margin and loses its right — at " +
          "that width, sliding it further would only choose which end is cut off"
      );

      // And the wiring. Where the panel *landed* is a thing this section has to state,
      // because nothing in this DOM can lay anything out: the stub reports the box it
      // was handed, as a browser would — which is to say including whatever shift has
      // already been applied to it.
      const { box } = await startReader({ galleryId: "8", on: true });
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const toggle = [
        ...chrome.querySelectorAll(".manga-reader-menu-button"),
      ].find((button) => button.dataset.opens === "settings");
      const panel = chrome.querySelector(".manga-reader-menu-settings");

      dom.window.innerWidth = 380;
      panel.getBoundingClientRect = () => ({
        left: -168 + Number(panel.dataset.shift || 0),
        width: 348,
      });
      dom.click(toggle);

      assert.strictEqual(
        panel.style.transform,
        "translateX(176px)",
        "a panel that landed off the left of the window is moved back into it"
      );

      // Opened again on the same screen: the same answer — and *nothing written* to
      // say so, because this is where the panel already is. The pass that keeps this
      // header up to date runs on every change the lightbox makes, and a write per
      // pass is the shape of change that makes a change: the observer hears its own
      // write and runs again. Counting the writes, not comparing the value, since a
      // second write of the same transform leaves the same transform behind.
      dom.click(toggle);
      const applied = panel.style.transform;
      let writes = 0;
      Object.defineProperty(panel.style, "transform", {
        configurable: true,
        get: () => applied,
        set: () => {
          writes++;
        },
      });

      dom.click(toggle);
      assert.strictEqual(
        writes,
        0,
        "and opening it again on the same screen writes nothing at all"
      );
      assert.strictEqual(
        panel.style.transform,
        applied,
        "…leaving it exactly where it already was, because there was nothing to fix"
      );

      // **And downwards, which is a height rather than a shift.** A panel taller than the room
      // beneath it has nowhere to be moved to, so it is given the room that is left and a
      // scrollbar of its own — the same thing Stash's own menu does, at a flat 300px. The two
      // numbers here are a real pair, measured on a laptop: a 710px panel whose top is 46px
      // down a 698px window, which is 58px of it below the screen.
      let capped = 0;
      let maxHeight = "";
      Object.defineProperty(panel.style, "maxHeight", {
        configurable: true,
        get: () => maxHeight,
        set: (value) => {
          capped++;
          maxHeight = value;
        },
      });
      dom.window.innerHeight = 698;
      panel.getBoundingClientRect = () => ({
        left: 0,
        top: 46,
        width: 348,
        height: 710,
      });

      // A pass rather than a click: the menu is open and stays open — and a pass is what a
      // window that changed size asks for.
      dom.flush();
      assert.strictEqual(
        panel.style.maxHeight,
        "644px",
        "a panel with more under it than the window has room for is given that room: " +
          "698 − 46 − the margin"
      );

      // The same pass again on the same window: nothing written, and nothing to write. A cap
      // written per pass would be a change per pass, and the observer hears its own writes.
      capped = 0;
      dom.flush();
      assert.strictEqual(capped, 0, "…and the next pass writes nothing at all");

      // A window with almost no room still leaves a menu a few rows and a scrollbar, rather
      // than one row: the floor under the answer.
      dom.window.innerHeight = 100;
      dom.flush();
      assert.strictEqual(
        panel.style.maxHeight,
        "180px",
        "and a window too short for anything leaves the floor"
      );

      // And the chapter menu is left alone, which is the other half of that answer: it is a
      // list that scrolls inside itself, and a cap of this kind on it would be a second
      // scrollbar around the first.
      const chapters = chrome.querySelector(".manga-reader-menu-chapters");
      chapters.getBoundingClientRect = () => ({
        left: 0,
        top: 46,
        width: 348,
        height: 710,
      });
      dom.window.innerHeight = 698;
      dom.click(
        [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
          (button) => button.dataset.opens === "chapters"
        )
      );
      dom.flush();
      assert.strictEqual(
        chapters.style.maxHeight,
        undefined,
        "the chapter menu is not capped: its own list is what scrolls"
      );

      dom.window.innerHeight = 0;
      stopReader(box);
    }
  );

  /**
   * The settings that only mean something about a *pair* go away with the pairing.
   *
   * "Cover on a page of its own" and "detect spreads" describe how two pages are put
   * together, and the shift moves that pairing by a page: a reader reading one page at
   * a time has no use for any of them, and a switch that changes nothing is worse than
   * no switch. They are put away rather than removed — this panel is built once and
   * updated in place, which is the same rule as the zoom button's.
   */
  await runSection(
    "the pairing's own settings go with the pairing",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");

      /** The row a control sits in — the stub has no `closest`, so the walk is ours */
      const rowAt = (id) => {
        for (
          let at = panel.querySelector(id);
          at && at !== panel;
          at = at.parentNode
        ) {
          if (at.classList?.contains("manga-reader-row")) return at;
        }
        return null;
      };
      const away = (node) =>
        node.getAttribute("data-manga-reader-hidden") !== null;

      const pairedRows = [
        "#manga-reader-cover-alone",
        "#manga-reader-detect-spreads",
        "#manga-reader-offset",
      ];
      for (const id of pairedRows) {
        assert.strictEqual(
          away(rowAt(id)),
          false,
          `${id} is there to be set while there is a pairing`
        );
      }
      assert.strictEqual(
        away(panel.querySelector(".manga-reader-divider")),
        false,
        "and the one rule between the two groups is where it was"
      );

      // One page at a time: all three go — the shift included, which moves a pairing by
      // a page — and the rule between the groups that remain stays.
      dom.click(panel.querySelector("#manga-reader-single-page"));

      for (const id of pairedRows) {
        assert.strictEqual(
          away(rowAt(id)),
          true,
          `${id} is put away when the pages are read one at a time`
        );
      }
      assert.strictEqual(
        away(panel.querySelector(".manga-reader-divider")),
        false,
        "with the rule between the groups left in place"
      );

      // And back, since the pairing is the browser's setting rather than this section's.
      dom.click(panel.querySelector("#manga-reader-double-page"));
      assert.strictEqual(
        away(rowAt("#manga-reader-cover-alone")),
        false,
        "and choosing two pages brings them back"
      );

      stopReader(box);
    }
  );

  /**
   * A gallery in no chapters has no chapter menu: no menu, and no button to open one.
   *
   * Stash's own header is empty of them on such a gallery — it renders its chapter
   * menu only when it has chapters to put in it — and a button that opens nothing is
   * worse than no button at all: it says there are chapters, and then shows none.
   */
  await runSection(
    "a gallery in no chapters gets no chapter button",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const menu = chrome.querySelector(".manga-reader-chapter-menu");

      assert.ok(menu, "the header is built with a place for the chapter menu");
      assert.notStrictEqual(
        menu.getAttribute("data-manga-reader-hidden"),
        null,
        "and the place is hidden, because this gallery has no chapters to put in it"
      );

      stopReader(box);
    }
  );

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
        "translate(40px, 0px) scale(" + scale + ")",
        "a drag moves the pages by as much as the pointer moved"
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
      spread.dispatch(
        "mousedown",
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

  await runSection(
    "the chapters tab is drawn from this plugin's chapters",
    async () => {
      mountBridge();
      const at = mutations.length;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      // It used to be hidden — the button was something in the way of rows this
      // plugin drew. It is the way *in* now: it opens this plugin's form, and it
      // stays visible, which is also what keeps `findPanel` able to find this panel
      // on every pass after this one.
      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-hidden"),
        null,
        "Stash's own button stays where it is — attributes seen: " +
          JSON.stringify(tab.button.attributes)
      );
      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-taken"),
        "",
        "marked as one this plugin has taken over, since it has"
      );
      assert.deepStrictEqual(
        drawnRows(tab.container),
        ["第一話 - #1", "第二話 - #5"],
        "and the rows are Stash's chapters, counted in path order — the order this " +
          "tab has always counted in, and the order it is listed in"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "reading a gallery's chapters does not write anything, least of all Stash's rows"
      );

      stopTab(tab);
    }
  );

  /**
   * The other switch this half reads, and the second thing it does: the Chapters tab.
   *
   * Off, the tab is Stash's — its own button opens its own editor, and nothing of this
   * plugin's is drawn among the rows. What this half drew there is forgotten, which is
   * the same errand as leaving a page with no gallery on it; a tab already on screen
   * when the setting goes is put back by the next pass over the document, and the
   * setting is changed from the settings page rather than from here in the first
   * place.
   */
  await runSection(
    "with the tab's editing off, it is Stash's tab",
    async () => {
      mountBridge();
      dom.window.location.pathname = "/galleries/32";
      NS.manageChapters = false;
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-taken"),
        null,
        "Stash's own button is left alone, so its own editor is what it opens"
      );
      assert.strictEqual(
        tab.container.querySelector(".manga-reader-chapter-edit"),
        null,
        "and none of our rows are drawn over its own"
      );
      assert.strictEqual(
        tab.container.nextElementSibling,
        null,
        "…nor is the import control added under them"
      );

      NS.manageChapters = true;
      stopTab(tab);
    }
  );

  /**
   * The import: Stash's chapters copied into this plugin's own field.
   *
   * The field the reader prefers and nothing has ever written, and this is the only
   * thing that fills it. It lives in the tab because the tab is where the chapters
   * are read — and because the fetch it already makes is the translation's own
   * input: it asks for *path* order, so the ids Stash's numbers count against are
   * the ones in hand, at no extra cost.
   */
  await runSection(
    "the chapters tab offers Stash's chapters for import",
    async () => {
      mountBridge();
      const at = mutations.length;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      const control = dom.body.querySelector("#manga-reader-chapters-import");
      assert.ok(control, "a gallery on Stash's own rows is offered the import");
      assert.strictEqual(
        control.previousElementSibling === tab.container,
        true,
        "and the offer sits after the list, not in it and not between it and " +
          "Stash's own button"
      );
      assert.strictEqual(
        tab.container.previousElementSibling === tab.button,
        true,
        "which is the shape the panel is found by, so it has to still hold"
      );

      const offer = control.children[0];
      assert.strictEqual(offer.tagName, "BUTTON");
      assert.strictEqual(
        offer.type,
        "button",
        "a button in Stash's own form that does not say so is a button that submits it"
      );
      assert.strictEqual(
        offer.textContent,
        "Import Stash's chapters",
        "and it says what it would do"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "offering is not doing: nothing is written until it is clicked"
      );

      dom.click(offer);
      await settle();

      assert.strictEqual(mutations.length - at, 1, "clicking imports, once");
      assert.deepStrictEqual(
        mutations[at].variables,
        {
          input: {
            id: "32",
            custom_fields: {
              partial: {
                "plugin.mangaTools.chapters":
                  '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705"]},' +
                  '{"title":"第二話","images":["704","703","702","701"]}]}',
              },
            },
          },
        },
        "Stash's numbers, expanded against path order and written as this plugin's " +
          "own list — ids rather than indices, which is the whole point of the move"
      );
      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import").children[0]
          .textContent,
        "Re-import Stash's chapters",
        "and the offer changes: this gallery has a list of this plugin's own now, " +
          "so writing over it is a different thing to ask for"
      );

      stopTab(tab);
    }
  );

  await runSection(
    "and offers nothing when there is nothing to bring over",
    async () => {
      mountBridge();

      // A gallery reading from its own list already, with no rows of Stash's to bring
      // over: there is nothing an import would write.
      dom.window.location.pathname = "/galleries/31";
      const own = buildChaptersTab([]);
      dom.flush();
      await settle();

      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import") === null,
        true,
        "a gallery with no rows of Stash's is offered nothing"
      );
      stopTab(own);

      // A cleared list is a list. It says re-import — the same as any other gallery
      // that has one of this plugin's own — and never "import", which would be an
      // offer to write over an answer without saying so.
      dom.window.location.pathname = "/galleries/35";
      const cleared = buildChaptersTab([{ title: "第一話", image_index: 1 }]);
      dom.flush();
      await settle();

      const control = dom.body.querySelector("#manga-reader-chapters-import");
      assert.ok(control, "a gallery whose own list is empty still has one");
      assert.strictEqual(
        control.children[0].textContent,
        "Re-import Stash's chapters",
        "and it is the re-import offer: an empty list is a gallery whose chapters " +
          "were cleared, not one that has none"
      );
      stopTab(cleared);

      // Rows that all point past the end of the gallery: Stash has a chapter, and this
      // gallery can use none of it, so there is nothing to write.
      dom.window.location.pathname = "/galleries/37";
      const past = buildChaptersTab([{ title: "gone", image_index: 99 }]);
      dom.flush();
      await settle();

      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import") === null,
        true,
        "and neither is one offered an import of nothing, which would write an empty " +
          "list over whatever it had"
      );
      stopTab(past);
    }
  );

  /**
   * The form: Stash's own two fields and three buttons, writing this plugin's field.
   *
   * Driven the way somebody drives it — click the button, type in the fields, press
   * Save — because what is being tested is exactly that: that the shape a reader
   * already knows does what they expect, to the field this plugin keeps instead.
   *
   * Every write is asserted as the *whole* JSON that goes out, because that is the
   * value the reader will read back, and a chapter list that is right on screen and
   * wrong in the field is the failure this whole feature exists to avoid.
   */
  await runSection("the form creates, renames, moves and deletes", async () => {
    mountBridge();

    /** The form's two fields and its buttons, as the tab drew them */
    const formIn = (container) => {
      const form = container.querySelector("form");
      const fields = [...form.querySelectorAll(".form-control")];
      return {
        form,
        fields,
        save: form.querySelector(".btn-primary"),
        cancel: form.querySelector(".btn-secondary"),
        remove: form.querySelector(".btn-danger"),
      };
    };
    const written = (at) =>
      mutations[at].variables.input.custom_fields.partial[
        "plugin.mangaTools.chapters"
      ];

    // ── create, on a gallery that has only Stash's rows ──────────────────────
    dom.window.location.pathname = "/galleries/32";
    const fresh = buildChaptersTab([
      { title: "第一話", image_index: 1 },
      { title: "第二話", image_index: 5 },
    ]);
    dom.flush();
    await settle();

    assert.strictEqual(
      dom.click(fresh.button).propagationStopped,
      true,
      "Stash's own button opens this plugin's form — stopped on the way down, so " +
        "Stash's own handler never sees it"
    );
    await settle();

    const creating = formIn(fresh.container);
    assert.ok(
      creating.form,
      "and the form is what the panel holds instead of rows"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.previousElementSibling.textContent,
      "Title",
      "the first field is the title, labelled the way Stash's own form is"
    );
    assert.strictEqual(
      creating.fields[1].parentNode.previousElementSibling.textContent,
      "Image #",
      "and the second is the index of the page the chapter begins at"
    );
    assert.strictEqual(
      creating.fields[1].value,
      "1",
      "which opens at the first page when nobody is reading this gallery"
    );
    assert.strictEqual(
      creating.remove === null,
      true,
      "with nothing to delete: there is no chapter yet"
    );

    // Stash's own form, markup for markup: the ids and the `for` that tie each label
    // to its input, the class lists in Stash's order, the placeholder that is the
    // label again, and the empty place an error goes.
    assert.strictEqual(
      creating.form.getAttribute("novalidate"),
      "",
      "the form is novalidate, because it says what is wrong itself"
    );
    assert.strictEqual(
      creating.form.children[0].className,
      "form-container px-3",
      "the fields are in the padded container Stash puts them in"
    );
    assert.strictEqual(
      creating.form.children[1].className,
      "buttons-container px-3",
      "and the buttons in theirs"
    );
    assert.strictEqual(
      creating.form.children[1].children[0].className,
      "d-flex",
      "inside the flex row that lays them out"
    );
    assert.strictEqual(
      creating.fields[0].getAttribute("id") +
        " / " +
        creating.fields[0].getAttribute("name"),
      "title / title",
      "the title field is Stash's own"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.previousElementSibling.getAttribute("for"),
      "title",
      "and its label points at it, which is what a label does"
    );
    assert.strictEqual(
      creating.fields[1].getAttribute("id"),
      "image_index",
      "the index field too"
    );
    assert.strictEqual(
      creating.fields[0].className,
      "text-input form-control",
      "the class list is Stash's, in Stash's order"
    );
    assert.strictEqual(
      creating.fields[0].placeholder,
      "Title",
      "and the placeholder is the label again, as Stash's own form has it"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.children[1].className,
      "invalid-feedback",
      "with the empty place Bootstrap puts an error in"
    );
    assert.strictEqual(
      creating.save.className,
      "btn btn-primary",
      "Save is Stash's primary button"
    );
    assert.strictEqual(
      creating.cancel.className,
      "ml-2 btn btn-secondary",
      "and Cancel is its secondary one, with `ml-2` where Stash has it"
    );
    assert.strictEqual(
      fresh.button.className.includes("manga-reader-chapters-editing"),
      true,
      "and Stash's own Create button is out of sight while the form is open — its own " +
        "panel takes the button away with the rows"
    );

    const at = mutations.length;
    creating.fields[0].value = "new";
    creating.fields[1].value = "3";
    dom.click(creating.save);
    await settle();

    assert.strictEqual(mutations.length - at, 1, "Save writes once");
    assert.strictEqual(
      written(at),
      '{"v":1,"chapters":[{"title":"第一話","images":["708","707"]},' +
        '{"title":"new","images":["706","705"]},' +
        '{"title":"第二話","images":["704","703","702","701"]}]}',
      "the new chapter takes the pages from page 3 to the next chapter's start — " +
        "out of 第一話, which keeps the ones before it"
    );
    assert.strictEqual(
      dom.body.querySelector("form") === null,
      true,
      "and the form closes on what was written"
    );
    assert.strictEqual(
      fresh.button.className.includes("manga-reader-chapters-editing"),
      false,
      "which brings Stash's own button back"
    );
    assert.deepStrictEqual(
      drawnRows(fresh.container),
      ["第一話 - #1", "new - #3", "第二話 - #5"],
      "the rows are the new list — drawn from what was written rather than fetched " +
        "back, the news having carried it"
    );

    // A refusal is shown *on the field it is about* rather than as a line of its own:
    // Bootstrap's own two halves, which is also the only way this form says anything.
    dom.click(fresh.button);
    await settle();
    const again = formIn(fresh.container);
    again.fields[0].value = "again";
    again.fields[1].value = "1";
    const beforeRefusal = mutations.length;
    dom.click(again.save);
    await settle();

    assert.strictEqual(
      mutations.length,
      beforeRefusal,
      "a refused save writes nothing"
    );

    // Read again: a refusal is drawn by *rebuilding* the form — the field carries the
    // mark and the words under it — so the nodes this started with are not the ones
    // on screen.
    const refused = formIn(fresh.container);
    assert.strictEqual(
      refused.fields[1].classList.contains("is-invalid"),
      true,
      "the field it is about is marked, as Bootstrap marks one"
    );
    assert.strictEqual(
      refused.fields[1].parentNode.children[1].textContent,
      "A chapter already begins here",
      "and the reason is under it"
    );

    stopTab(fresh);

    // ── rename and delete, on a gallery with a list of its own ──────────────
    dom.window.location.pathname = "/galleries/38";
    const own = buildChaptersTab([]);
    dom.flush();
    await settle();

    // 中盤 begins at page 1 and 開幕 at page 5, so that is the order the rows are in.
    assert.deepStrictEqual(
      drawnRows(own.container),
      ["中盤 - #1", "開幕 - #5"],
      "the rows are the list in path order, as they always were"
    );
    assert.strictEqual(
      own.container.children[0].children[1].children[1].className.includes(
        "manga-reader-chapter-edit"
      ),
      true,
      "with an Edit link after the jump link in each — Stash's own row has one there"
    );

    dom.click(own.container.children[0].children[1].children[1]);
    await settle();

    const renaming = formIn(own.container);
    assert.ok(renaming.form, "which opens the form on that chapter");
    assert.strictEqual(
      renaming.fields[0].value,
      "中盤",
      "with its title in the first field"
    );
    assert.strictEqual(
      renaming.fields[1].value,
      "1",
      "and where it begins in the second"
    );
    assert.ok(
      renaming.remove,
      "and a way to delete it, which a new chapter has not"
    );

    const beforeRename = mutations.length;
    renaming.fields[0].value = "renamed";
    dom.click(renaming.save);
    await settle();

    assert.strictEqual(
      written(beforeRename),
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703"]},' +
        '{"title":"renamed","images":["708","705","706","707"]}]}',
      "saving the new title writes the list with only that changed"
    );

    // Moving its start: the pages it gives up go to the chapter before it, which is
    // what a chapter's pages mean. Here it is the *first* chapter, so there is none
    // before it and those pages are owned by nobody.
    dom.click(own.container.children[0].children[1].children[1]);
    await settle();
    const moving = formIn(own.container);
    moving.fields[1].value = "3";
    const beforeMove = mutations.length;
    dom.click(moving.save);
    await settle();

    assert.strictEqual(
      written(beforeMove),
      '{"v":1,"chapters":[{"title":"renamed","images":["706","705"]},' +
        '{"title":"開幕","images":["704","703","702","701"]}]}',
      "moving the start re-cuts the chapters as the runs between their starts"
    );

    dom.click(own.container.children[0].children[1].children[1]);
    await settle();
    const removing = formIn(own.container);
    const beforeDelete = mutations.length;
    dom.click(removing.remove);
    await settle();

    assert.strictEqual(
      written(beforeDelete),
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703","702","701"]}]}',
      "deleting takes the chapter away and gives its pages to nobody"
    );
    assert.strictEqual(
      dom.body.querySelector("form") === null,
      true,
      "and closes the form"
    );

    stopTab(own);
  });

  /**
   * Re-importing asks first — twice over, in one control.
   *
   * There is no dialog to put this in: the tab is a DOM takeover, and Stash's own
   * confirm is a react-bootstrap `Modal` the reader test world cannot render. So the
   * control becomes the question. What makes that affordable is the render key: the
   * confirmation is part of the state this tab is drawn from, so no pass can draw
   * the offer while the question is up, or the question while the offer is.
   *
   * It has to be asked, and this is why: the field is hidden from Stash's own
   * custom-field editor, so the list about to be written over is visible in exactly
   * one place — this tab — and nowhere else to go and look at it.
   */
  /**
   * The same import for the whole library, which is what a library that has been
   * on Stash's own rows all along actually needs: the same job once per gallery is
   * the tab's business, and this is the one visit that does all of them.
   *
   * It lives in the reader half because the format does, and is asked for by the
   * tools half's settings panel through the namespace — so what these sections
   * exercise is the job itself, called the way the panel calls it.
   */
  await runSection("the whole library can be planned for import", async () => {
    mountBridge();

    // The fixture is put back before the plan is asked for: the sections above have
    // imported gallery 32 from its tab, the client now applies what is written — as a
    // server does — and the plan counts exactly that. A section that writes is a
    // section that changed the world, and this one is about the whole world.
    delete state.galleries["32"].gallery.custom_fields[
      "plugin.mangaTools.chapters"
    ];

    const plan = await NR.planChapterImports();

    // Gallery 32 is on Stash's own rows, 35 has an (empty) list of this plugin's
    // own and rows of Stash's, and 37's only chapter points past the end of it.
    // The plan cannot tell 37 from a real one — it carries no images — which is
    // why the run checks again before writing.
    assert.deepStrictEqual(
      plan.toImport.slice().sort(),
      ["32", "37"],
      "every gallery with rows of Stash's and no list of ours is to be imported"
    );
    assert.deepStrictEqual(
      plan.owned,
      ["35"],
      "and one that already has a list of ours is only counted, so that a run can " +
        "leave it alone unless it was asked not to"
    );

    const marked = Object.keys(state.galleries).filter(
      (id) => state.galleries[id].manga !== false
    ).length;
    assert.strictEqual(
      plan.considered,
      marked,
      "and everything marked was looked at, including the galleries with nothing " +
        "to bring over"
    );

    // The one thing about this job the suite cannot test. The client these tests
    // run against answers whatever it is asked, so a query a real Stash *rejects*
    // passes every assertion in this file — and the first version of this one did
    // exactly that: the settings panel's button did nothing at all on a real
    // instance, and only the browser said so.
    //
    // So the text is pinned to the shape a real Stash accepted on 2026-09-30: the
    // criterion is a *list* of objects, each carrying a `field`, and `value` is a
    // list of `Any` — which is why the mark is a variable of that type rather than
    // a `String!`. An edit here fails this assertion, and that is the reminder to
    // run the new query against something that can refuse it.
    assert.ok(
      /custom_fields: \[\{ field: \$field, modifier: EQUALS, value: \[\$mark\] \}\]/.test(
        NR.CHAPTERS_QUERY_TEXT
      ),
      "the plan asks with the criterion Stash's schema accepts: " +
        NR.CHAPTERS_QUERY_TEXT
    );
    assert.ok(
      /\$field: String!, \$mark: Any!, \$perPage: Int!/.test(
        NR.CHAPTERS_QUERY_TEXT
      ),
      "declaring each variable as the position it is used in expects"
    );
  });

  await runSection(
    "importing the library writes each gallery once",
    async () => {
      mountBridge();
      const at = mutations.length;
      const plan = await NR.planChapterImports();
      const run = await NR.runChapterImports(plan);

      assert.deepStrictEqual(
        run.written.slice().sort(),
        ["32"],
        "a gallery that can be imported is"
      );
      assert.deepStrictEqual(
        run.skippedEmpty,
        ["37"],
        "and one whose rows all point past the end of its images is not: writing " +
          "the translation of nothing would be clearing its chapters, not importing"
      );
      assert.deepStrictEqual(run.failed, [], "nothing failed");

      assert.strictEqual(
        mutations.length - at,
        1,
        "which is one write per gallery imported, and none for the ones left alone"
      );
      assert.deepStrictEqual(
        mutations[at].variables,
        {
          input: {
            id: "32",
            custom_fields: {
              partial: {
                "plugin.mangaTools.chapters":
                  '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705"]},' +
                  '{"title":"第二話","images":["704","703","702","701"]}]}',
              },
            },
          },
        },
        "each written as the list Stash's own rows translate to, in path order"
      );

      // Asked for, it does write over a gallery that already has one — which is the
      // same import, and the reason the panel asks before running it this way.
      const beforeReimport = mutations.length;
      const again = await NR.runChapterImports(plan, { reimport: true });

      assert.deepStrictEqual(
        again.written.slice().sort(),
        ["32", "35"],
        "a re-import counts the galleries that already had a list of ours"
      );
      assert.strictEqual(
        mutations.length - beforeReimport,
        2,
        "and writes them"
      );
    }
  );

  await runSection(
    "and a library import says which gallery it could not write",
    async () => {
      mountBridge();

      // Put back what the run above wrote: the client applies a write, as a server
      // does, and this section counts which galleries still have no list of their own.
      delete state.galleries["32"].gallery.custom_fields[
        "plugin.mangaTools.chapters"
      ];

      const at = mutations.length;
      const plan = await NR.planChapterImports();

      // The tools half owns the write, and a reader installed without it has no such
      // function — which is a gallery that failed rather than a run that stopped.
      const write = NS.writeChapters;
      delete NS.writeChapters;
      const run = await NR.runChapterImports(plan);
      NS.writeChapters = write;

      assert.deepStrictEqual(run.written, [], "nothing was written");
      assert.deepStrictEqual(
        run.failed.map((f) => f.id),
        ["32"],
        "the gallery that could have been written is reported, with its own error"
      );
      assert.ok(
        /tools half is not running/.test(String(run.failed[0].error)),
        "and the error names what was missing rather than being a bare failure"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "and none of it reached Stash"
      );
    }
  );

  await runSection("re-importing asks first", async () => {
    mountBridge();
    const at = mutations.length;
    dom.window.location.pathname = "/galleries/35";
    const tab = buildChaptersTab([{ title: "第一話", image_index: 1 }]);

    dom.flush();
    await settle();

    const control = () =>
      dom.body.querySelector("#manga-reader-chapters-import");
    const offer = () => control().children[control().children.length - 1];

    dom.click(control().children[0]);
    await settle();

    assert.deepStrictEqual(
      mutations.slice(at),
      [],
      "asking is not doing: the first click writes nothing"
    );
    assert.strictEqual(
      control().children.length,
      3,
      "and the control becomes the question — a warning and two answers"
    );
    assert.ok(
      /overwritten/.test(control().children[0].textContent),
      "which say what is about to be overwritten"
    );
    assert.strictEqual(
      control().children[1].textContent,
      "Replace",
      "the answer that writes, worded as what it does"
    );
    assert.strictEqual(
      control().children[2].textContent,
      "Cancel",
      "and the answer that does not"
    );

    dom.click(control().children[2]);
    await settle();

    assert.deepStrictEqual(
      mutations.slice(at),
      [],
      "and cancelling writes nothing"
    );
    assert.strictEqual(
      control().children.length,
      1,
      "the question goes, and the offer is back"
    );
    assert.strictEqual(
      offer().textContent,
      "Re-import Stash's chapters",
      "saying what it said before it was asked"
    );

    dom.click(offer());
    await settle();
    dom.click(control().children[1]);
    await settle();

    assert.strictEqual(
      mutations.length - at,
      1,
      "and confirming is the write, once"
    );
    assert.deepStrictEqual(
      mutations[at].variables,
      {
        input: {
          id: "35",
          custom_fields: {
            partial: {
              "plugin.mangaTools.chapters":
                '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705","704","703","702","701"]}]}',
            },
          },
        },
      },
      "with Stash's rows, expanded against path order, replacing the empty list " +
        "this gallery was keeping"
    );

    stopTab(tab);
  });

  await runSection(
    "a chapter in the tab opens the lightbox there",
    async () => {
      mountBridge();
      shown.length = 0;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);
      dom.flush();
      await settle();

      // The second row is 第二話, which begins at path position 4 — the tab lists
      // path order, so that is both what the row says and where the click goes.
      dom.click(tab.container.children[1].children[1].children[0]);

      assert.strictEqual(shown.length, 1, "the lightbox was asked to open");
      assert.strictEqual(
        shown[0].props.initialIndex,
        4,
        "at the page that chapter begins on"
      );
      assert.strictEqual(
        shown[0].props.images.length,
        8,
        "with the gallery's images, so the reader and the lightbox agree"
      );
      // Nothing else is handed over: the chapters are the reader's own menu, drawn
      // from the moment it draws. What the stub records as empty is what the bridge
      // was asked for, which is images and a place.
      assert.deepStrictEqual(shown[0].chapters, []);

      stopTab(tab);
    }
  );

  /**
   * Last on purpose: it empties this browser's settings and puts the *old* keys
   * back, which every section above depends on being absent. What it checks is
   * the one thing the migration promises — a reader who had both switches set
   * before the halves were bundled still has them after — and the one thing it
   * must not do, which is take the old value away from the standalone Manga
   * Reader that may still be installed beside this plugin.
   */
  /**
   * Also last, and for a related reason: it loads the bundle a *second* time, in
   * a world where the tools half cannot start, to see the one promise the merge
   * makes. The halves share a bundle, so a throw during either one's startup
   * would otherwise take both down — the entry starts them one at a time, each
   * inside its own guard, and this is what that is for.
   *
   * A missing `setInterval` because it is one of the few things the tools half
   * reaches for *while starting* and cannot guard against itself: it is where the
   * poll behind its store begins. What the reader half has to show for it is that
   * it is still there — still watching the document, still taking the arrow keys.
   *
   * Take the guard out of the entry and this section is not what fails: the bundle
   * throws at the first load, near the top of this file, and the run dies there.
   * Both are red, which is what matters — but the message here is the readable one,
   * and it is only readable because the guard is doing its job.
   */
  await runSection("an edit reaches the lightbox open on it", async () => {
    mountBridge();
    dom.window.location.pathname = "/galleries/38";
    const { box } = await startReader({
      galleryId: "39",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });
    const tab = buildChaptersTab([]);
    dom.flush();
    await settle();

    // By title: 701 first, so 開幕 (which holds 703 and 704) comes before 中盤.
    assert.deepStrictEqual(
      chapterMenu(box),
      ["開幕", "中盤"],
      "the lightbox's own menu is the list read in its own order"
    );

    // The reader is on the first page of *its* order, which is the last of the
    // tab's — so a new chapter's index is 8 here, not 1: the two count the same
    // pages in different orders, and the form asks in the order the rows are in.
    assert.strictEqual(
      NR.readingPageIdNow("39"),
      "701",
      "and the reader says which page it is on, by id"
    );

    dom.click(tab.button);
    await settle();

    const form = tab.container.querySelector("form");
    assert.strictEqual(
      form.querySelectorAll(".form-control")[1].value,
      "8",
      "so a chapter made while reading opens at the page being read, counted in " +
        "path order — the order the rows and the row numbers are in"
    );

    // Now rename a chapter from the tab, with the lightbox open on it.
    dom.click(form.querySelector(".btn-secondary"));
    await settle();
    dom.click(tab.container.children[0].children[1].children[1]);
    await settle();

    const renaming = tab.container.querySelector("form");
    renaming.querySelectorAll(".form-control")[0].value = "renamed";

    const heard = [];
    const stopHeard = NR.watchChapters((id, chapters) =>
      heard.push([id, chapters.map((chapter) => chapter.title)])
    );

    const at = mutations.length;
    dom.click(renaming.querySelector(".btn-primary"));
    await settle();
    stopHeard();

    console.error(
      "DEBUG before the rename the menu is",
      JSON.stringify(chapterMenu(box))
    );
    assert.strictEqual(
      mutations[at].variables.input.custom_fields.partial[
        "plugin.mangaTools.chapters"
      ],
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703"]},' +
        '{"title":"renamed","images":["708","705","706","707"]}]}',
      "the tab wrote the list"
    );
    console.error(
      "DEBUG after the rename the menu is",
      JSON.stringify(chapterMenu(box))
    );
    await NR.writeChapters(
      "33",
      [{ title: "direct", images: ["704", "703"] }],
      null
    );
    await settle();
    console.error(
      "DEBUG after a direct write the menu is",
      JSON.stringify(chapterMenu(box))
    );
    console.error(
      "DEBUG fixture field:",
      String(
        state.galleries["39"].gallery.custom_fields[
          "plugin.mangaTools.chapters"
        ]
      ).slice(0, 80),
      "| mutation id:",
      mutations[at].variables.input.id
    );
    // And everyone drawing this gallery is told — with the list itself, not only
    // which gallery changed. Asserted by listening rather than by reading the
    // lightbox's menu, and that is a limit of this world rather than a choice: a
    // lightbox left open across a write is one whose cached gallery the suite can
    // reload underneath it (the cache is shared between sections and evicts), so the
    // menu is a draw of something no single section owns. The reader registers the
    // same listener, and it is what draws — the contract is the thing to pin.
    assert.deepStrictEqual(
      heard,
      [["39", ["開幕", "renamed"]]],
      "so a surface that was drawing the old list is told the new one, by id and in full"
    );

    stopTab(tab);
    stopReader(box);
  });

  await runSection(
    "a tools half that cannot start leaves the reader readable",
    async () => {
      const window = dom.window;
      const realSetInterval = window.setInterval;
      const errorsAt = loggedErrors.length;
      const keysAt = (window.listeners.keydown || []).length;

      window.setInterval = undefined;
      delete require.cache[require.resolve(BUNDLE)];
      require(BUNDLE);
      window.setInterval = realSetInterval;

      assert.ok(
        errorsSince(errorsAt).some((line) =>
          /tools half could not be started/.test(line)
        ),
        "the half that failed says which one it was"
      );
      assert.ok(
        (window.listeners.keydown || []).length > keysAt,
        "and the reader half is running anyway"
      );
    }
  );

  await runSection(
    "a Stash with no location event is reported, not silently survived",
    async () => {
      const window = dom.window;
      const eventApi = window.PluginApi.Event;
      const errorsAt = loggedErrors.length;

      // A plugin API with no event target. The path checks read the URL (see
      // pathNow), so the tools half still knows where it is — what it loses is
      // *noticing* a navigation on its own, which is the shape of half-working
      // that has to be said out loud: the symptom otherwise is a row that appears
      // a page late or not at all, and a console with nothing in it.
      delete window.PluginApi.Event;
      delete require.cache[require.resolve(BUNDLE)];
      require(BUNDLE);
      // Read before the API is put back: `eventApi` is a live reading of Stash's
      // API, `locationListener` is what this load actually managed to do.
      const diag = window.MangaTools.diag();
      window.PluginApi.Event = eventApi;

      assert.ok(
        errorsSince(errorsAt).some((line) =>
          /no stash:location event/.test(line)
        ),
        "a plugin that cannot hear about navigation says so"
      );
      assert.strictEqual(
        diag.eventApi,
        false,
        "and diag() reports it, for the case where nobody was watching the console"
      );
      assert.strictEqual(
        diag.locationListener,
        false,
        "…along with whether the listener got onto it"
      );
    }
  );

  /**
   * The test world's own rules, which every other section in this file reads through.
   *
   * A stub that answers differently from a browser is worse than no stub at all: it
   * decides what every assertion above it means. Two of its rules are pinned here for
   * that reason, both of them things this suite got wrong before.
   */
  await runSection(
    "the test world answers the way a browser does",
    async () => {
      // A descendant selector whose first part is the element the query is asked of.
      // The browser asks the document and narrows the answer to what is below that
      // element, so the element itself may be the ancestor the first part names — the
      // search here used to look only *below* it and missed this case entirely.
      const outer = dom.makeElement("div");
      outer.className = "a";
      const inner = dom.makeElement("div");
      inner.className = "b";
      outer.appendChild(inner);

      assert.strictEqual(
        outer.querySelector(".a .b") === inner,
        true,
        "a query asked of the element its first part names finds what is below it"
      );

      const root = dom.makeElement("div");
      const deeper = dom.makeElement("div");
      deeper.className = "a";
      root.appendChild(deeper);
      const leaf = dom.makeElement("div");
      leaf.className = "b";
      deeper.appendChild(leaf);

      assert.strictEqual(
        root.querySelector(".a .b") === leaf,
        true,
        "and from above, a descendant two levels down"
      );

      // A query with nothing to find is the one that used to cost the most: the search
      // walked the subtree below every node the first part matched, once for the rest of
      // the selector and once for the whole of it. This says it comes back at all.
      for (let depth = 0; depth < 40; depth += 1) {
        const child = dom.makeElement("div");
        child.className = "a";
        deeper.appendChild(child);
      }
      assert.strictEqual(
        root.querySelector(".a .nothing") === null,
        true,
        "and one that is not there is null, rather than a walk that does not end"
      );

      // One callback registered twice is one listener, as it is in the DOM — which is
      // what lets the plugin put a move and a release on the document on every press
      // of the progress bar and take them off once, without the pile growing.
      const node = dom.makeElement("div");
      const once = () => {};
      const again = () => {};
      node.addEventListener("mousemove", once);
      node.addEventListener("mousemove", once);
      node.addEventListener("mousemove", again);
      assert.strictEqual(
        node.listeners.mousemove.length,
        2,
        "the same callback twice is one listener, and a second callback is two"
      );

      node.removeEventListener("mousemove", once);
      assert.strictEqual(node.listeners.mousemove.length, 1);
      assert.strictEqual(node.listeners.mousemove[0], again);
    }
  );

  // ── The tally ────────────────────────────────────────────────────

  if (failures.length === 0) {
    console.log("\nAll mangaReader smoke tests passed");
  } else {
    console.error(
      `\n${failures.length} section(s) failed: ${failures.join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("the smoke test itself failed:", e);
  process.exitCode = 1;
});
