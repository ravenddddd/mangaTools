/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  NR,
  assert,
  dom,
  runSection,
  settle,
  state,
  buildLightbox,
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
  await runSection(
    "the gallery behind an image is the server's answer, not the page's",
    async () => {
      // A scene's, a performer's or a tag's page opens the lightbox over one of
      // *its* galleries, and the path names the entity rather than the gallery. The
      // page's own markup was the first answer tried and does not hold on a real
      // one — see galleryIdOfImage — so the plugin asks, and only a marked gallery
      // is its business: an image can be in several.
      assert.strictEqual(
        await NR.galleryIdOfImage("101"),
        "7",
        "the image's gallery, as the server has it"
      );
      assert.strictEqual(
        await NR.galleryIdOfImage("999"),
        null,
        "an image in no gallery of ours names none"
      );

      // A gallery that holds the image and is not this plugin's is passed over —
      // and "2" sorts before "7", so an implementation that took the first gallery
      // the server named would answer with the wrong one.
      state.galleries["2"] = {
        manga: false,
        images: [{ id: "101", width: 1000, height: 1500 }],
      };
      assert.strictEqual(
        await NR.galleryIdOfImage("101"),
        "7",
        "a gallery the plugin does not manage is not the answer"
      );
      delete state.galleries["2"];

      // The query is Stash's, and it is pinned here: the client in this world
      // answers whatever it is asked, so only the text says whether the real server
      // would have taken it. `id: ID`, not `ID!` — the schema takes it nullable.
      const asked = state.queries.filter((q) => q.variables?.id !== undefined);
      assert.ok(asked.length >= 3, "the image's galleries were asked for");
      assert.strictEqual(asked[0].variables.id, "101");
      assert.strictEqual(asked[0].fetchPolicy, "no-cache");
      // Pinned as text, because what goes over the wire is a parsed document and
      // the client here answers whatever it is asked — see the chapters query, and
      // the memory of a query a real Stash refused while every test passed.
      assert.ok(
        NR.IMAGE_GALLERIES_QUERY_TEXT.indexOf("findImage(id: $id)") !== -1 &&
          NR.IMAGE_GALLERIES_QUERY_TEXT.indexOf("galleries {") !== -1,
        "…with a query naming the image and its galleries"
      );
    }
  );
  await runSection(
    "a click inside a card answers before the server is asked",
    async () => {
      // The takeover has to happen in the same `step` that first sees the lightbox,
      // or Stash's own is drawn for a frame first — which is exactly what the user
      // saw once the lookup became a query. The click that opened it is what makes
      // that possible: the element it landed on is in hand, so its card, and the
      // gallery that card links to, need no matching and no round trip.
      dom.window.location.pathname = "/scenes/11593";
      for (const child of dom.body.children.slice()) child.remove();

      const card = dom.makeElement("div");
      card.className = "gallery-card";
      const header = dom.makeElement("a");
      header.setAttribute("href", "/galleries/7");
      card.appendChild(header);
      const thumb = dom.makeElement("img");
      thumb.setAttribute(
        "src",
        "http://nas.local:9998/image/101/thumbnail?t=1"
      );
      card.appendChild(thumb);
      dom.body.appendChild(card);

      const askedForImages = () =>
        state.queries.filter((q) => q.variables?.id !== undefined).length;
      const before = askedForImages();

      dom.click(thumb);
      const box = buildLightbox(1, 5, ["101", "102", "103", "104", "105"]);
      dom.flush();
      await settle();

      assert.strictEqual(
        askedForImages(),
        before,
        "the card the click was in answers, so the server is never asked"
      );
      assert.ok(
        container(),
        "and the lightbox is this plugin's from the first frame"
      );

      stopReader(box);
      dom.window.location.pathname = "/";
    }
  );
};
