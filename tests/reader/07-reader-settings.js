/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  settingsWrites,
  runSection,
  savedReaderSettings,
  storedSettings,
  settingsWith,
  turn,
  container,
  drawn,
  press,
  NR,
  NS,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
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
};
