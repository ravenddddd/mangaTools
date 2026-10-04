/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  fs,
  path,
  runSection,
  NR,
} = require("./harness.js");

module.exports = async () => {
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
        path.join(__dirname, "..", "..", "src", "reader", "namespace.ts"),
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

  /**
   * A gallery of five ordinary pages: screens are [1] [2+3] [4+5], so a pair is
   * something the arrows and the offset can be seen against. Gallery 8 in these
   * fixtures has a spread in it, which changes what the pairing does.
   */
  /** Closes the lightbox and lets the reader notice */

  /** Puts the chapters tab away, the way leaving the page would */
};
