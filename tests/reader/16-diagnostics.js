/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  BUNDLE,
  dom,
  loggedErrors,
  runSection,
  errorsSince,
} = require("./harness.js");

module.exports = async () => {
  await runSection(
    "a tools half that cannot start leaves the reader readable",
    async () => {
      const window = dom.window;
      const realSetInterval = window.setInterval;
      const errorsAt = loggedErrors.length;
      const keysAt = (window.listeners.keydown || []).length;

      window.setInterval = undefined;
      delete require.cache[require.resolve(BUNDLE)];
      require(BUNDLE);
      window.setInterval = realSetInterval;

      assert.ok(
        errorsSince(errorsAt).some((line) =>
          /tools half could not be started/.test(line)
        ),
        "the half that failed says which one it was"
      );
      assert.ok(
        (window.listeners.keydown || []).length > keysAt,
        "and the reader half is running anyway"
      );
    }
  );

  await runSection(
    "a Stash with no location event is reported, not silently survived",
    async () => {
      const window = dom.window;
      const eventApi = window.PluginApi.Event;
      const errorsAt = loggedErrors.length;

      // A plugin API with no event target. The path checks read the URL (see
      // pathNow), so the tools half still knows where it is — what it loses is
      // *noticing* a navigation on its own, which is the shape of half-working
      // that has to be said out loud: the symptom otherwise is a row that appears
      // a page late or not at all, and a console with nothing in it.
      delete window.PluginApi.Event;
      delete require.cache[require.resolve(BUNDLE)];
      require(BUNDLE);
      // Read before the API is put back: `eventApi` is a live reading of Stash's
      // API, `locationListener` is what this load actually managed to do.
      const diag = window.MangaTools.diag();
      window.PluginApi.Event = eventApi;

      assert.ok(
        errorsSince(errorsAt).some((line) =>
          /no stash:location event/.test(line)
        ),
        "a plugin that cannot hear about navigation says so"
      );
      assert.strictEqual(
        diag.eventApi,
        false,
        "and diag() reports it, for the case where nobody was watching the console"
      );
      assert.strictEqual(
        diag.locationListener,
        false,
        "…along with whether the listener got onto it"
      );
    }
  );

  /**
   * The test world's own rules, which every other section in this file reads through.
   *
   * A stub that answers differently from a browser is worse than no stub at all: it
   * decides what every assertion above it means. Two of its rules are pinned here for
   * that reason, both of them things this suite got wrong before.
   */
  await runSection(
    "the test world answers the way a browser does",
    async () => {
      // A descendant selector whose first part is the element the query is asked of.
      // The browser asks the document and narrows the answer to what is below that
      // element, so the element itself may be the ancestor the first part names — the
      // search here used to look only *below* it and missed this case entirely.
      const outer = dom.makeElement("div");
      outer.className = "a";
      const inner = dom.makeElement("div");
      inner.className = "b";
      outer.appendChild(inner);

      assert.strictEqual(
        outer.querySelector(".a .b") === inner,
        true,
        "a query asked of the element its first part names finds what is below it"
      );

      const root = dom.makeElement("div");
      const deeper = dom.makeElement("div");
      deeper.className = "a";
      root.appendChild(deeper);
      const leaf = dom.makeElement("div");
      leaf.className = "b";
      deeper.appendChild(leaf);

      assert.strictEqual(
        root.querySelector(".a .b") === leaf,
        true,
        "and from above, a descendant two levels down"
      );

      // A query with nothing to find is the one that used to cost the most: the search
      // walked the subtree below every node the first part matched, once for the rest of
      // the selector and once for the whole of it. This says it comes back at all.
      for (let depth = 0; depth < 40; depth += 1) {
        const child = dom.makeElement("div");
        child.className = "a";
        deeper.appendChild(child);
      }
      assert.strictEqual(
        root.querySelector(".a .nothing") === null,
        true,
        "and one that is not there is null, rather than a walk that does not end"
      );

      // One callback registered twice is one listener, as it is in the DOM — which is
      // what lets the plugin put a move and a release on the document on every press
      // of the progress bar and take them off once, without the pile growing.
      const node = dom.makeElement("div");
      const once = () => {};
      const again = () => {};
      node.addEventListener("mousemove", once);
      node.addEventListener("mousemove", once);
      node.addEventListener("mousemove", again);
      assert.strictEqual(
        node.listeners.mousemove.length,
        2,
        "the same callback twice is one listener, and a second callback is two"
      );

      node.removeEventListener("mousemove", once);
      assert.strictEqual(node.listeners.mousemove.length, 1);
      assert.strictEqual(node.listeners.mousemove[0], again);
    }
  );
};
