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
  call,
  patched,
  patchedBefore,
  physicalImage,
  runSection,
  state,
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
    searchTerm: "",
    criteria: [],
  },
  // What this Stash actually passes. `totalCount` is not among ImageList's props
  // in v0.31.1; it is kept only as a fallback for a build that does pass it.
  pageCount: 2,
  totalCount: 3,
  selectedIds: new Set(["1001"]),
  images: [],
  onSelectChange: () => {},
  ...over,
});

module.exports = () => {
  runSection("15 the physical page plan keeps Stash's page count", () => {
    assert.deepStrictEqual(
      NS.physicalPagePlan(4, 100, 316),
      { pages: 4, perPage: 100 },
      "a few duplicates change neither the page size nor the count"
    );
    assert.deepStrictEqual(
      NS.physicalPagePlan(4, 100, 511),
      { pages: 4, perPage: 100 },
      "the chosen page size is kept; the last page takes the remainder"
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

  runSection("15 a page size of one still divides the files", () => {
    // The bug this pins: the plan used to be derived from `totalCount`, which this
    // Stash does not pass to ImageList — the count became 1, every file landed on
    // one page, and `perPage=1` did nothing.
    const page = NS.expandPhysicalPage(
      listProps({
        filter: {
          sortBy: "path",
          sortDirection: "ASC",
          currentPage: 1,
          itemsPerPage: 1,
        },
        pageCount: 3,
        // Exactly what this Stash passes: no total at all.
        totalCount: undefined,
      }),
      GRID
    );

    assert.ok(page, "the list is expanded");
    assert.strictEqual(page.perPage, 1, "the chosen page size is kept");
    assert.deepStrictEqual(
      page.images.map((image) => image.id),
      ["1001::p1"],
      "…so one file on the first page, not all four"
    );
    assert.strictEqual(page.pages, 3, "and Stash's three pages");

    const last = NS.expandPhysicalPage(
      listProps({
        filter: {
          sortBy: "path",
          sortDirection: "ASC",
          currentPage: 3,
          itemsPerPage: 1,
          searchTerm: "",
          criteria: [],
        },
        pageCount: 3,
        totalCount: undefined,
      }),
      GRID
    );
    assert.deepStrictEqual(
      last.images.map((image) => image.id),
      ["1001::p3", "1003::p4"],
      "the last page takes the remainder"
    );
  });

  runSection("15 a filtered or searched list keeps Stash's results", () => {
    assert.strictEqual(
      NS.expandPhysicalPage(
        listProps({
          filter: { ...listProps().filter, searchTerm: "RJ01133881_003" },
        }),
        GRID
      ),
      null,
      "a search is Stash's own list — expanding it would show files it excluded"
    );
    assert.strictEqual(
      NS.expandPhysicalPage(
        listProps({
          filter: { ...listProps().filter, criteria: [{ type: "tags" }] },
        }),
        GRID
      ),
      null,
      "…and so is any criterion"
    );
  });

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

  runSection("15 the physical mode belongs to the lightbox takeover", () => {
    NS.physicalPages = true;
    NS.readerTakeover = false;
    assert.strictEqual(
      NS.physicalPageMode(),
      false,
      "with Stash's own lightbox there is nowhere for occurrence pages to be read"
    );

    NS.readerTakeover = true;
    assert.strictEqual(NS.physicalPageMode(), true, "both on is the mode");

    NS.physicalPages = false;
    assert.strictEqual(
      NS.physicalPageMode(),
      false,
      "and the setting alone is off"
    );

    NS.readerTakeover = true;
  });

  /**
   * The expansion is memoised on the values it reads — and three of them are the
   * filter's. Missing them is invisible to this world (the stub runs a memo on
   * every call) and a frozen list in a browser: React keeps the answer from before
   * the search, so a search is ignored, and a cleared search stays ignored.
   *
   * Read out of the dependency array rather than through a re-render, for that
   * reason. Distinct values, so an `includes` cannot pass on a coincidence.
   */
  runSection("15 the expansion's memo names the filter it reads", () => {
    call(
      "ImageList",
      listProps({
        filter: {
          sortBy: "path",
          sortDirection: "ASC",
          currentPage: 1,
          itemsPerPage: 2,
          searchTerm: "RJ01133881_003",
          criteria: [{}, {}, {}],
        },
        pageCount: 7,
        totalCount: 11,
      })
    );

    const deps = state.lastMemoDeps;
    assert.ok(Array.isArray(deps), "the list memoises its expansion");
    assert.ok(
      deps.includes("RJ01133881_003"),
      "the search term is a dependency: a filtered list is Stash's own"
    );
    assert.ok(
      deps.includes(3),
      "so is the number of criteria, for the same reason"
    );
    assert.ok(
      deps.includes(7),
      "and the page count the expansion plans its pages with"
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
