/**
 * 15: the gallery's Images tab, read by physical files.
 *
 * The list patch is asynchronous — it fetches the gallery's files and redraws —
 * and this world has no timer in which to let it run, so what is pinned here is
 * the part the patch delegates to: the page plan and the expansion. Those are the
 * two places a page could go missing or a card could lose its image. The patches
 * themselves are checked for registration, and the reader suite covers the same
 * pages through the lightbox.
 */

const assert = require("node:assert");
const {
  PHYSICAL_FILES,
  NS,
  patched,
  patchedBefore,
  physicalImage,
  runSection,
} = require("../helpers.js");

/** The four files as the shared module hands them to the grid. */
const GRID = {
  total: 4,
  files: PHYSICAL_FILES.map((file) => ({
    fileId: file.id,
    imageId: file.imageId,
    path: file.path,
    basename: file.basename,
    width: 1000,
    height: 1500,
    title: "Image " + file.imageId,
    imageUrl: "/image/" + file.imageId + "/image",
    thumbnail: "/thumb/" + file.imageId,
    preview: "/preview/" + file.imageId,
    parentFolderId: null,
    zipFileId: "9001",
    image: physicalImage(file.imageId),
  })),
};

const listProps = (over = {}) => ({
  filter: {
    sortBy: "path",
    sortDirection: "ASC",
    currentPage: 1,
    itemsPerPage: 2,
  },
  totalCount: 3,
  selectedIds: new Set(["1001"]),
  images: [],
  onSelectChange: () => {},
  ...over,
});

module.exports = () => {
  runSection("15 the physical page plan keeps Stash's page count", () => {
    assert.deepStrictEqual(
      NS.physicalPagePlan(311, 100, 316),
      { pages: 4, perPage: 100 },
      "a few duplicates change neither the page size nor the count"
    );
    assert.deepStrictEqual(
      NS.physicalPagePlan(311, 100, 511),
      { pages: 4, perPage: 128 },
      "a dense gallery widens one page rather than adding pages past the clamp"
    );
  });

  runSection(
    "15 one page is one slice of the files, at the file positions",
    () => {
      const page = NS.expandPhysicalPage(listProps(), GRID);

      assert.ok(page, "a path-ordered list is expanded");
      assert.deepStrictEqual(
        page.images.map((image) => image.id),
        ["1001::p1", "1002::p2"],
        "the first page is the first two files, in path order — occurrence ids unique"
      );
      assert.strictEqual(
        page.images[0].paths.image,
        "/image/1001/image#p1",
        "the slide's URL carries the occurrence, so Stash's keys and the reader agree"
      );
      assert.strictEqual(
        page.images[0].visual_files[0].path,
        "/zip/001.jpg",
        "and the card's name is the occurrence's own file"
      );
      assert.deepStrictEqual(
        [...page.selectedIds],
        ["1001::p1"],
        "selecting the image selects its occurrence on this page"
      );

      let changed = null;
      const withSelect = NS.expandPhysicalPage(
        listProps({
          onSelectChange: (id, selected, shiftKey) => {
            changed = [id, selected, shiftKey];
          },
        }),
        GRID
      );
      withSelect.onSelectChange("1001::p3", true, false);
      assert.deepStrictEqual(
        changed,
        ["1001", true, false],
        "and choosing an occurrence chooses the image Stash knows"
      );
    }
  );

  runSection("15 only a path-ascending list is expanded", () => {
    assert.strictEqual(
      NS.expandPhysicalPage(
        listProps({ filter: { ...listProps().filter, sortBy: "title" } }),
        GRID
      ),
      null,
      "a title sort has no physical positions to count"
    );
    assert.strictEqual(
      NS.expandPhysicalPage(
        listProps({
          filter: { ...listProps().filter, sortDirection: "DESC" },
        }),
        GRID
      ),
      null,
      "…nor does the same order read backwards"
    );
    assert.deepStrictEqual(
      NS.expandPhysicalPage(listProps(), { files: [], total: 0 }),
      null,
      "and a gallery with no files keeps Stash's list"
    );
  });

  runSection("15 the patches are registered", () => {
    assert.strictEqual(
      typeof patched.ImageList,
      "function",
      "the list both display modes render from"
    );
    assert.strictEqual(
      typeof patchedBefore.ImageCard,
      "function",
      "the card, which puts the real image id back in its link"
    );
    // The pagination components are deliberately *not* patched: the store that
    // rewrote their numbers was an update loop in Stash's own list (React #185).
    // The toolbar count therefore keeps Stash's deduplicated number for now.
    assert.strictEqual(
      patched.Pagination,
      undefined,
      "the pagination is Stash's own"
    );
    assert.strictEqual(
      NS.physicalPages,
      false,
      "with the setting off, none of them changes anything"
    );
  });
};
