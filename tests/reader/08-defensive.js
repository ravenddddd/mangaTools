/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  state,
  loggedErrors,
  runSection,
  errorsSince,
  container,
  drawn,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
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
};
