/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  savedReaderSettings,
  turn,
  container,
  drawn,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  await runSection("a screen arrives rather than snapping in", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    const spread = container();
    assert.strictEqual(
      spread.animations.length,
      1,
      "the first screen fades in as it arrives"
    );
    assert.deepStrictEqual(
      spread.animations[0].keyframes,
      [{ opacity: 0 }, { opacity: 1 }],
      "…from nothing to what it is: a fade, not a slide or a scale"
    );

    // Counted, not compared against one: the animations are the container's own
    // history, and the container outlives the screens drawn into it.
    const before = spread.animations.length;
    turn(box);
    assert.strictEqual(
      spread.animations.length,
      before + 1,
      "and every screen after it does the same"
    );

    // A reader who has asked their system for less motion gets the page, not the
    // dissolve — decoration does not get to overrule that.
    dom.prefersReducedMotion(true);
    const quiet = spread.animations.length;
    turn(box, 2);
    dom.flush();
    assert.strictEqual(
      spread.animations.length,
      quiet,
      "nothing is animated when reduced motion is on"
    );
    assert.deepStrictEqual(
      drawn(),
      ["/image/404/image", "/image/405/image"],
      "…though the screen itself is still drawn"
    );
    dom.prefersReducedMotion(false);

    stopReader(box);
  });

  /**
   * The fade, which is a pair of buttons rather than a choice of lengths.
   *
   * It was a slider, and what a reader did with it was look for the length that
   * stopped being noticeable — which is what FADE_MS is. So the length is the
   * plugin's and the choice is yes or no.
   */
  await runSection(
    "the fade is a pair of buttons, and a length nobody picks",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");

      const off = panel.querySelector("#manga-reader-fade-off");
      const on = panel.querySelector("#manga-reader-fade-on");
      assert.ok(off && on, "the panel offers the fade as two buttons");
      assert.deepStrictEqual(
        [off.textContent, on.textContent],
        ["None", "Fade in"],
        "named for what they do, one of which is nothing"
      );
      assert.strictEqual(
        on.classList.contains("is-on"),
        true,
        "fading is what a screen does by default"
      );
      assert.strictEqual(
        off.classList.contains("is-on"),
        false,
        "…and the other half is not chosen"
      );

      // Which is connected to the pages: a turn fades, for as long as the constant says.
      const before = container().animations.length;
      turn(box);

      const animations = container().animations;
      assert.strictEqual(
        animations.length,
        before + 1,
        "a turn fades as it arrives"
      );
      assert.strictEqual(
        animations[animations.length - 1].options.duration,
        NR.FADE_MS,
        "for a length that is the plugin's rather than the reader's — there is one, and " +
          "it is not on this panel"
      );

      // And the other half means what it says: the screen arrives at once.
      dom.click(off);
      assert.strictEqual(
        off.classList.contains("is-on") && !on.classList.contains("is-on"),
        true,
        "choosing no fading moves the mark to that half"
      );

      box.move(4);
      dom.flush();
      assert.strictEqual(
        container().animations.length,
        before + 1,
        "and a screen after it is drawn with no animation at all"
      );

      // Put back: the setting is the library's, and one left off would be changing what
      // every section after this one reads.
      dom.click(on);
      assert.strictEqual(
        savedReaderSettings().fade,
        true,
        "and the choice is written where the settings live — the plugin's own settings, " +
          "which go to Stash with the rest of them"
      );

      stopReader(box);
    }
  );
};
