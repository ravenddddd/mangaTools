/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  mutations,
  shown,
  loggedErrors,
  runSection,
  settle,
  errorsSince,
  page,
  mountBridge,
  chapterMenu,
  chapterRanges,
  container,
  drawn,
  CHAPTERS_VIEW,
  numbered,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
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
      // is the first chapter's name, because page 5 of 8 pairs with the page
      // before it, which is the last
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
};
