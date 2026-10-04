/**
 * The pairing rules, and the settings they are asked about: which pages form a
 * spread, where a screen starts, how far a turn moves, and how a stored setting is
 * read back. Pure functions, called directly — no lightbox, no DOM.
 *
 * The first area lifted out of `tests/reader.js`; the world it borrows is in
 * `harness.js`, and the file is otherwise the sections as they were.
 */
const {
  assert,
  runSection,
  page,
  wide,
  shape,
  pagesOf,
  storedSettings,
  settingsWith,
  NR,
} = require("./harness.js");

module.exports = async () => {
  await runSection("settings are parsed defensively", () => {
    const defaults = settingsWith();

    assert.deepStrictEqual(
      NR.parseSettings(null),
      defaults,
      "a library nobody has written to gets the defaults — the mode off"
    );
    assert.deepStrictEqual(
      NR.parseSettings("not json"),
      defaults,
      "nor is something else's value under our key"
    );
    const legacy = () =>
      NR.parseSettings(
        JSON.stringify({
          readingMode: "double",
          coverAlone: false,
          fade: false,
        })
      );

    // **The set is the mode's own.** The whole of what a section writes below is one set per
    // way of reading, and what is read back is the one for the mode in hand — which is the
    // whole point of the shape: the same object read in two modes is two different settings.
    assert.deepStrictEqual(
      [
        NR.parseSettings(storedSettings()).wheel,
        NR.parseSettings(storedSettings({ readingMode: "scroll" })).wheel,
      ],
      [
        { plain: "turn", shift: "scroll", ctrl: "zoom" },
        { plain: "scroll", shift: "turn", ctrl: "zoom" },
      ],
      "the same settings read in two ways of reading are two different sets of them"
    );
    assert.deepStrictEqual(
      NR.parseSettings(
        storedSettings({ profiles: { double: { coverAlone: false } } })
      ),
      defaults,
      "…and the set that is not the one in hand is not read: this is the single-page one"
    );
    assert.strictEqual(
      NR.parseSettings(
        storedSettings({
          readingMode: "double",
          profiles: { double: { coverAlone: false } },
        })
      ).coverAlone,
      false,
      "while the same object read in double page is the set that was written for it"
    );

    // A field that is absent inside a set, or of the wrong type, falls back to that mode's
    // default — which is what makes adding one later harmless for a library that already has
    // a stored object.
    const at = (profile, mode = "single") =>
      NR.parseSettings(storedSettings({ profiles: { [mode]: profile } }));
    assert.strictEqual(
      at({ coverAlone: false }).coverAlone,
      false,
      "a stored no is a no"
    );
    assert.strictEqual(
      at({ fade: false }).fade,
      false,
      "and a stored yes is a yes"
    );
    assert.strictEqual(
      at({ fade: false }).coverAlone,
      true,
      "and a field the stored set does not mention is its default"
    );
    assert.strictEqual(
      at({ coverAlone: "yes" }).coverAlone,
      true,
      "while a value of the wrong type is not a setting at all"
    );

    // How the pages are laid out: one of three, and a value of the wrong shape — a mode this
    // build has never heard of, or one written by a build that has more — is not a setting.
    const mode = (raw) => NR.parseSettings(raw).readingMode;
    assert.strictEqual(
      mode(storedSettings({ readingMode: "scroll" })),
      "scroll",
      "each mode reads"
    );
    assert.strictEqual(
      mode(storedSettings({ readingMode: "double" })),
      "double",
      "as itself"
    );
    assert.strictEqual(
      NR.parseSettings('{"readingMode":"scroll"}').readingMode,
      "scroll",
      "…and the mode is at the top of the object, where the shape has always had it"
    );
    assert.strictEqual(
      mode(storedSettings({ readingMode: "sideways" })),
      "single",
      "while a mode this build has never heard of is the default, not a guess"
    );

    // **Nothing flat is read at all.** This is the shape this build wrote until now — the
    // settings themselves at the top of the object — and a library that has one reads as the
    // defaults rather than as a mixture of the two. There is no migration: see settings.ts.
    assert.deepStrictEqual(
      legacy().readingMode,
      "double",
      "the mode is at the top of the object, which is where it has always been"
    );
    assert.deepStrictEqual(
      { ...legacy(), readingMode: "single" },
      defaults,
      "…and nothing else of it is read: a settings object an older build wrote — flat, the " +
        "way this one used to be — is not migrated, so those settings are worth setting once " +
        "more"
    );

    // The wheel: three chords, each checked on its own, so that one bad value is not three.
    const wheel = (bindings, inMode = "single") =>
      NR.parseSettings(
        storedSettings({
          readingMode: inMode,
          profiles: { [inMode]: { wheel: bindings } },
        })
      ).wheel;
    assert.deepStrictEqual(
      wheel({ plain: "zoom", shift: "off", ctrl: "turn" }),
      { plain: "zoom", shift: "off", ctrl: "turn" },
      "each binding reads as itself"
    );
    assert.deepStrictEqual(
      wheel({ plain: "sideways" }),
      { plain: "turn", shift: "scroll", ctrl: "zoom" },
      "…and one that is not one of the four leaves that chord's default standing"
    );
    assert.deepStrictEqual(
      wheel({}, "scroll"),
      { plain: "scroll", shift: "turn", ctrl: "zoom" },
      "with the default being the one for the way of reading in hand"
    );

    // The bar's clock: a length in milliseconds, with the two values of it that are not
    // lengths at all — the ends of the slider that sets it.
    const idle = (value) => at({ progressIdleMs: value }).progressIdleMs;
    assert.strictEqual(
      idle(3000),
      3000,
      "a length the reader chose is read back as itself"
    );
    assert.strictEqual(
      idle(NR.PROGRESS_NEVER),
      NR.PROGRESS_NEVER,
      "…and so is the setting that never hides"
    );
    assert.strictEqual(
      idle(NR.PROGRESS_HOLD_MS),
      NR.PROGRESS_HOLD_MS,
      "…and the one where the pointer is the whole of the bar's visibility"
    );
    assert.strictEqual(
      idle("long"),
      NR.PROGRESS_IDLE_MS,
      "while something that is not a number is not a setting, so the default stands"
    );
    assert.strictEqual(
      idle(900000),
      NR.PROGRESS_IDLE_MAX_MS,
      "and a length past the top of the slider is clamped rather than refused: a hand-" +
        "edited file means 'as long as possible', which is what the top of it is"
    );
  });

  await runSection("the lightbox header is read as a position", () => {
    assert.deepStrictEqual(NR.parseIndicator("3 / 12"), {
      current: 3,
      total: 12,
    });
    assert.deepStrictEqual(
      NR.parseIndicator(" 1 / 2 "),
      { current: 1, total: 2 },
      "whitespace is not part of the number"
    );
    assert.strictEqual(NR.parseIndicator(""), null, "no counter at all");
    assert.strictEqual(NR.parseIndicator("Chapter 3"), null);
    assert.strictEqual(
      NR.parseIndicator("0 / 12"),
      null,
      "a page number out of range is not a position to draw from"
    );
    assert.strictEqual(NR.parseIndicator("13 / 12"), null);
  });

  await runSection("the gallery is read out of the path", () => {
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7"), "7");
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7/images"), "7");
    assert.strictEqual(
      NR.galleryIdFromPath("/galleries"),
      null,
      "the gallery list is not one gallery"
    );
    assert.strictEqual(NR.galleryIdFromPath("/scenes/7"), null);
    assert.strictEqual(
      NR.galleryIdFromPath("/images/7"),
      null,
      "an image's own page has no gallery to pair"
    );
  });

  await runSection(
    "the gallery is read out of the page when the path cannot",
    () => {
      // A scene's Galleries tab draws each of the scene's galleries as a card with
      // that gallery's images under it, so the lightbox opened from one of those is a
      // gallery's lightbox — and `/scenes/{id}` says nothing about which. The way
      // back is the image: it is one of the ones in that card.
      //
      // The lightbox's own <img> carries the same URL and is in no card, so it is put
      // in first: an implementation that answered with the *first* match would come
      // back empty here and pass a test written the other way round.
      const stray = document.createElement("img");
      stray.setAttribute("src", "http://nas.local:9998/image/366517/image?t=1");
      document.body.appendChild(stray);

      const card = document.createElement("div");
      card.className = "gallery-card";
      const header = document.createElement("a");
      header.setAttribute("href", "/galleries/3813");
      card.appendChild(header);
      const image = document.createElement("img");
      image.setAttribute(
        "src",
        "http://nas.local:9998/image/366517/thumbnail?t=1"
      );
      card.appendChild(image);
      document.body.appendChild(card);

      assert.strictEqual(
        NR.galleryIdFromImage("366517"),
        "3813",
        "the card the image is in names the gallery"
      );
      assert.strictEqual(
        NR.galleryIdFromImage("999"),
        null,
        "an image that is in no card names no gallery"
      );

      // A card whose link is not a gallery's — a performer's, say — names none either.
      header.setAttribute("href", "/performers/565");
      assert.strictEqual(NR.galleryIdFromImage("366517"), null);
      header.setAttribute("href", "/galleries/3813");

      stray.remove();
      card.remove();
    }
  );

  await runSection("what counts as a spread", () => {
    assert.strictEqual(NR.isWideSpreadPage(page("tall")), false);
    assert.strictEqual(NR.isWideSpreadPage(wide("w")), true);
    assert.strictEqual(
      NR.isWideSpreadPage(page("square", 1000, 1000)),
      false,
      "the ratio is strictly greater than one"
    );
    assert.strictEqual(
      NR.isWideSpreadPage(page("unknown", 0, 0)),
      false,
      "a page with no size reported is not evidence of a spread"
    );
  });

  await runSection("the cover, and the pairs that follow it", () => {
    assert.deepStrictEqual(NR.layout([]), []);

    assert.deepStrictEqual(shape(NR.layout(pagesOf("a"))), ["a"]);

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"))),
      ["a", "b+c", "d+e"],
      "the cover stands alone and the rest pair up"
    );

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"), { coverAlone: false })),
      ["a+b", "c+d", "e"],
      "without a cover to respect, the odd page is the last one"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout(pagesOf("a", "b", "c", "d", "e"), {
          coverAlone: true,
          offset: 1,
        })
      ),
      ["a", "b", "c+d", "e"],
      "the offset strands one more page, which puts a wrongly-grouped gallery's " +
        "pairs back"
    );

    // The layout must not touch what it was given: the page list is a fetched
    // answer that is kept for the rest of the session.
    const pages = pagesOf("a", "b");
    const before = JSON.stringify(pages);
    NR.layout(pages);
    assert.strictEqual(JSON.stringify(pages), before, "and it is not mutated");
  });

  await runSection("a page that spans two of them", () => {
    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c"), page("d")], {
          coverAlone: false,
        })
      ),
      ["a+b", "w", "c+d"],
      "a spread takes a screen of its own, and the pairing carries on after it"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), wide("w"), page("b"), page("c")], {
          coverAlone: false,
        })
      ),
      ["a", "w", "b+c"],
      "a page whose neighbour is a spread stands alone — the case that leaves a " +
        "single page in the middle of a book. If the pairing after it is then " +
        "wrong for a book, the offset is what puts it right"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c")], {
          coverAlone: false,
          detectSpreads: false,
        })
      ),
      ["a+b", "w+c"],
      "with the detection off a wide page is just a page"
    );

    assert.deepStrictEqual(
      shape(NR.layout([wide("x"), wide("y")], { coverAlone: false })),
      ["x", "y"],
      "two spreads in a row are two screens"
    );
  });

  await runSection("where a screen starts, and how far to move", () => {
    const screens = NR.layout(pagesOf("a", "b", "c", "d", "e"));

    screens.forEach((screen, at) => {
      screen.pages.forEach((_page, offset) => {
        assert.strictEqual(NR.screenAt(screens, screen.start + offset), at);
      });
    });
    assert.deepStrictEqual(
      screens.flatMap((s) => s.pages.map((p) => p.id)),
      ["a", "b", "c", "d", "e"],
      "every page is on exactly one screen, in order"
    );
    assert.strictEqual(NR.screenAt(screens, 99), -1);
    assert.strictEqual(NR.screenAt([], 0), -1);

    assert.strictEqual(NR.stepsToAdjacent(screens, 0, 1), 1);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 1, 1),
      2,
      "forward from the first page of a pair skips both its pages"
    );
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 2, 1),
      1,
      "and from the second page of one only moves on by that one"
    );
    assert.strictEqual(NR.stepsToAdjacent(screens, 0, -1), 0);
    assert.strictEqual(NR.stepsToAdjacent(screens, 4, 1), 0);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 4, -1),
      -3,
      "backwards lands on the first page of the screen behind, which from the " +
        "last pair is three pages away"
    );
  });
};
