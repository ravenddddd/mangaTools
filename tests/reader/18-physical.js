/**
 * A gallery read by its **physical files**, and the chapter field that goes with it.
 *
 * The reader's own page list, the exact occurrence a lightbox opens on, the v1 →
 * file-identity conversion, and the rule that only a path-ascending list is
 * expanded. Everything here turns the setting on for its own section and off
 * again, so the rest of the suite reads the plugin as it always has.
 */
const {
  assert,
  dom,
  runSection,
  state,
  startReader,
  stopReader,
  drawn,
  turn,
  NR,
  NS,
} = require("./harness.js");

/** The four pages of the physical fixture, as file ids and image ids. */
const PAGES = [
  { id: "f1", imageId: "901", width: 1000, height: 1500 },
  { id: "f2", imageId: "902", width: 1000, height: 1500 },
  { id: "f3", imageId: "901", width: 1000, height: 1500 },
  { id: "f4", imageId: "903", width: 1000, height: 1500 },
];

module.exports = async () => {
  await runSection(
    "a gallery's pages are its files, and the occurrence on screen is found exactly",
    async () => {
      NS.readerTakeover = true;
      NS.physicalPages = true;

      const { box } = await startReader({
        galleryId: "74",
        on: false,
        at: 3,
        total: 4,
        // The occurrence list Stash's lightbox was handed: the third slide is the
        // second occurrence of image 901, marked with its file id.
        ids: ["901", "902", "901", "903"],
        fragments: [null, null, "f3", null],
      });

      assert.deepStrictEqual(
        drawn(),
        ["/image/901/image"],
        "the page the lightbox names by file id is the one drawn"
      );
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-counter").textContent,
        "3 / 4",
        "the reader counts four physical pages, not three images"
      );
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-chapter").textContent,
        "Second",
        "and a chapter stored by file id starts at the second occurrence"
      );

      turn(box);
      assert.deepStrictEqual(
        drawn(),
        ["/image/903/image"],
        "the next occurrence is a different page"
      );

      dom.click(box.navLeft);
      dom.flush();
      assert.deepStrictEqual(
        drawn(),
        ["/image/901/image"],
        "and going back lands on the same occurrence again"
      );

      stopReader(box);
      NS.physicalPages = false;
    }
  );

  await runSection(
    "an image-level chapter is read at the image's first occurrence",
    async () => {
      NS.readerTakeover = true;
      NS.physicalPages = true;

      const { box } = await startReader({
        galleryId: "75",
        on: false,
        at: 1,
        total: 3,
        ids: ["911", "912", "911"],
        fragments: ["g1", null, "g3"],
      });

      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-chapter").textContent,
        "First",
        "a v1 chapter converted to files lands where the image first appears"
      );

      turn(box);
      assert.strictEqual(
        box.lightbox.querySelector(".manga-reader-chapter").textContent,
        "",
        "and it does not claim the image's later occurrences"
      );

      stopReader(box);
      NS.physicalPages = false;
    }
  );

  await runSection(
    "a list sorted by something other than path is not expanded",
    async () => {
      NS.readerTakeover = true;
      NS.physicalPages = true;

      const before = state.queries.filter(
        (q) => q.variables && q.variables.fileFilter !== undefined
      ).length;

      const { box } = await startReader({
        galleryId: "76",
        on: false,
        at: 1,
        total: 3,
        search: "?sortby=title",
        ids: ["921", "922", "923"],
      });

      const after = state.queries.filter(
        (q) => q.variables && q.variables.fileFilter !== undefined
      ).length;
      assert.strictEqual(
        after,
        before,
        "no file list is read for an order that has no physical meaning"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/921/image"],
        "and the deduplicated list is drawn"
      );

      stopReader(box);
      NS.physicalPages = false;
    }
  );

  await runSection(
    "the chapter field's two identities convert, and v2 writes both",
    async () => {
      const v1 = JSON.stringify({
        v: 1,
        chapters: [{ title: "a", images: ["901", "903"] }],
      });

      assert.deepStrictEqual(
        NR.readChapters(v1, PAGES, true),
        [{ title: "a", images: ["f1", "f4"] }],
        "a v1 field read with physical pages on keeps each image's first file"
      );
      assert.deepStrictEqual(
        NR.readChapters(v1, PAGES, false),
        [{ title: "a", images: ["901", "903"] }],
        "…and is untouched with them off"
      );

      const v2 = NR.serializeChapters(
        [{ title: "b", images: ["f3", "f4"] }],
        true,
        PAGES
      );
      assert.strictEqual(
        v2,
        '{"v":2,"chapters":[{"title":"b","files":["f3","f4"],' +
          '"images":["901","903"]}]}',
        "v2 carries the file ids and the images derived from them"
      );
      assert.deepStrictEqual(
        NR.parseChapters(v2, true),
        [{ title: "b", images: ["f3", "f4"] }],
        "read with physical pages on, the files are the membership"
      );
      assert.deepStrictEqual(
        NR.parseChapters(v2, false),
        [{ title: "b", images: ["901", "903"] }],
        "read with them off, the images are"
      );

      assert.strictEqual(
        NR.serializeChapters([{ title: "c", images: ["901"] }], false, PAGES),
        '{"v":1,"chapters":[{"title":"c","images":["901"]}]}',
        "and a write with the setting off is still exactly v1"
      );
    }
  );
};
