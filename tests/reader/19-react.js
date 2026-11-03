/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const { assert, dom, runSection, NR } = require("./harness.js");

module.exports = async () => {
  /**
   * **Which renderer the icons go through.** Stash 0.32 moved to React 18: it
   * draws its own tree with `createRoot` and hands plugins `ReactDOMClient` as well
   * as the legacy `ReactDOM`. The reader draws its controls' icons by handing
   * Stash's own `Icon` to a renderer, and a host is re-rendered whenever the header
   * is rebuilt — so `createRoot` has to be made once per host, not once per draw
   * (calling it twice on one container is an error). 0.31.1 has no
   * `react-dom/client` at all, and its renderer is still the one to use.
   *
   * Both paths are asserted here because both Stashes are still in the field, and
   * the choice is invisible in the DOM: the icon looks the same either way.
   */
  await runSection(
    "the icon painter uses React 18's root where Stash offers one",
    () => {
      const api = dom.window.PluginApi;
      const before = {
        Icon: api.components.Icon,
        solid: api.libraries.FontAwesomeSolid,
        render: api.ReactDOM.render,
        client: api.ReactDOMClient,
      };

      const legacy = [];
      const roots = [];
      api.components.Icon = "Icon";
      api.libraries.FontAwesomeSolid = { faPlus: "faPlus" };
      api.ReactDOM.render = (element, host) => legacy.push({ element, host });

      try {
        // 0.31.1: no react-dom/client, so the legacy renderer is the only one.
        delete api.ReactDOMClient;
        const legacyHost = dom.document.createElement("span");
        NR.drawIcon(legacyHost, "faPlus");
        NR.drawIcon(legacyHost, "faPlus");

        // 0.32: React 18. One root per host, rendered into again.
        api.ReactDOMClient = {
          createRoot(container) {
            const root = {
              container,
              rendered: [],
              render(node) {
                this.rendered.push(node);
              },
              unmount() {},
            };
            roots.push(root);
            return root;
          },
        };
        const first = dom.document.createElement("span");
        const second = dom.document.createElement("span");
        NR.drawIcon(first, "faPlus");
        NR.drawIcon(first, "faPlus");
        NR.drawIcon(second, "faPlus");
      } finally {
        api.components.Icon = before.Icon;
        api.libraries.FontAwesomeSolid = before.solid;
        api.ReactDOM.render = before.render;
        if (before.client === undefined) delete api.ReactDOMClient;
        else api.ReactDOMClient = before.client;
      }

      assert.strictEqual(
        legacy.length,
        2,
        "without react-dom/client the legacy renderer draws, once per call"
      );
      assert.strictEqual(
        roots.length,
        2,
        "with it, one root per host — not one per draw"
      );
      assert.strictEqual(
        roots[0].container !== roots[1].container,
        true,
        "…each made on the host it draws into"
      );
      assert.strictEqual(
        roots[0].rendered.length,
        2,
        "the same host's root is rendered into again"
      );
      assert.strictEqual(
        roots[1].rendered.length,
        1,
        "…and a second host gets a root of its own"
      );
      assert.strictEqual(
        legacy.length,
        2,
        "the legacy renderer is not used once the client is there"
      );
    }
  );
};
