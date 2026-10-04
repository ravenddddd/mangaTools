/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  settle,
  container,
  drawn,
  NS,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
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
};
