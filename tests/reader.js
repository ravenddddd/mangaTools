const {
  assert,
  dom,
  failures,
  runSection,
  settle,
  NR,
} = require("./reader/harness.js");

/** 01: the pairing rules and the stored settings they read */
const pairing = require("./reader/01-pairing.js");
const namespace = require("./reader/02-namespace.js");
const lightbox = require("./reader/03-lightbox.js");
const screens = require("./reader/04-screens.js");
const input = require("./reader/05-input.js");
const fade = require("./reader/06-fade.js");
const reader_settings = require("./reader/07-reader-settings.js");
const defensive = require("./reader/08-defensive.js");
const chapters = require("./reader/09-chapters.js");
const menus = require("./reader/10-menus.js");
const wheel = require("./reader/11-wheel.js");
const column = require("./reader/12-column.js");
const progress = require("./reader/13-progress.js");
const claiming = require("./reader/14-claiming.js");
const chapters_tab = require("./reader/15-chapters-tab.js");
const diagnostics = require("./reader/16-diagnostics.js");

// ── Sections ───────────────────────────────────────────────────────

async function main() {
  // The tools half's gallery map is fetched as the bundle loads, and it is what tells
  // the reader which galleries are manga — so nothing here is marked until its answer
  // lands, which is a promise and therefore after a turn.
  await settle();

  await runSection("the plugin loads and watches for a lightbox", () => {
    assert.ok(NR, "the bundle should publish window.MangaReader");
    assert.strictEqual(typeof NR.layout, "function");
    assert.strictEqual(
      dom.observerCount(),
      1,
      "one observer on the document, which is how the lightbox is found"
    );
    assert.strictEqual(
      (dom.window.listeners.keydown || []).length,
      1,
      "and one key listener, on the window, so it runs before Stash's own"
    );
  });
  await namespace();

  // 01: the pairing rules and the stored settings they read
  await pairing();
  await lightbox();
  await screens();
  await input();
  await fade();
  await reader_settings();
  await defensive();
  await chapters();
  await menus();
  await wheel();
  await column();
  await progress();
  await claiming();
  await chapters_tab();
  await diagnostics();
  // ── The tally ────────────────────────────────────────────────────

  if (failures.length === 0) {
    console.log("\nAll mangaReader smoke tests passed");
  } else {
    console.error(
      `\n${failures.length} section(s) failed: ${failures.join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("the smoke test itself failed:", e);
  process.exitCode = 1;
});
