/**
 * 16: the four shops — recognising a link, reading its code, and the icon head
 * the edit form's URL rows get.
 *
 * The parsing is pure and driven directly; the decoration is DOM work, and is
 * driven against a small form built here. The real thing is Stash's own markup:
 * the row is identified by its scrape button, and every write is guarded so the
 * observer cannot answer itself.
 */

const assert = require("node:assert");
const { NS, makeEl, observed, runSection, state } = require("../helpers.js");

module.exports = () => {
  runSection(
    "16 the four shops are recognised by host, and their codes read",
    () => {
      const cases = [
        [
          "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html",
          "dlsite",
          "BJ03044888",
        ],
        [
          "https://www.dlsite.com/maniax/work/=/product_id/RJ01668994.html",
          "dlsite",
          "RJ01668994",
        ],
        // The `product_id=RJ…` spelling the same regex reads.
        [
          "https://www.dlsite.com/maniax/work/=/product_id=RJ01668994.html",
          "dlsite",
          "RJ01668994",
        ],
        // A dotted-FQDN host: the trailing dot is the same site to a browser,
        // and WHATWG's URL keeps it.
        [
          "https://www.dlsite.com./books/work/=/product_id/BJ03044888.html",
          "dlsite",
          "BJ03044888",
        ],
        // Case and a default port are already normalised by the URL parser; the
        // table says so rather than assuming it.
        [
          "HTTPS://WWW.DLsite.com:443/maniax/work/=/product_id/RJ01668994.html",
          "dlsite",
          "RJ01668994",
        ],
        [
          "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/",
          "fanza",
          "d_790745",
        ],
        // The book shape, which is on a different subdomain and has no `cid=`.
        [
          "https://book.dmm.co.jp/product/6300672/b915awnmg04612/",
          "fanza",
          "b915awnmg04612",
        ],
        // A subdomain is still the shop; a shape this build does not know keeps
        // the shop and loses only the code.
        ["https://book.dmm.co.jp/product/123456/", "fanza", ""],
        [
          "https://ec.toranoana.jp/tora_r/ec/item/040030474993/",
          "toranoana",
          "040030474993",
        ],
        [
          "https://www.melonbooks.co.jp/detail/detail.php?product_id=2500562",
          "melonbooks",
          "2500562",
        ],
      ];

      cases.forEach(([url, key, code]) => {
        const found = NS.shopOf(url);
        assert.ok(found, url + " should be recognised");
        assert.strictEqual(found.shop.key, key, url + " is " + key);
        assert.strictEqual(found.code, code, url + " code");
      });

      // The lookalike host matters: endsWith on the bare domain would accept it.
      assert.strictEqual(
        NS.shopOf("https://notdlsite.com/x"),
        null,
        "a host that merely contains the domain is not the shop"
      );
      assert.strictEqual(
        NS.shopOf("https://www.pixiv.net/artworks/1"),
        null,
        "and neither is any other host"
      );
      assert.strictEqual(NS.shopOf("not a url"), null, "nor junk");
      assert.strictEqual(
        NS.shopOf("ftp://www.dlsite.com/x"),
        null,
        "nor a scheme a link cannot be opened from"
      );
    }
  );

  runSection("16 the badges come from the urls, in their own order", () => {
    const links = NS.shopsIn([
      "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html",
      "https://www.pixiv.net/artworks/12345678",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/",
      // The same URL twice is one badge.
      "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html",
    ]);

    assert.deepStrictEqual(
      links.map((link) => link.shop.key + ":" + link.code),
      ["dlsite:BJ03044888", "fanza:d_790745"],
      "the recognised links, in the gallery's order, each once"
    );
  });

  runSection(
    "16 a link row gets a head only while its link is recognised",
    () => {
      const form = makeEl("form");
      // The stub's elements answer querySelectorAll with nothing; this test gives
      // the form a walker for the one class the decorator asks for.
      const all = (selector) => {
        const out = [];
        const name = selector.slice(1);
        const walk = (node) => {
          node.children.forEach((child) => {
            if (child.classList.contains(name)) out.push(child);
            walk(child);
          });
        };
        walk(form);
        return out;
      };
      form.querySelectorAll = all;

      const group = makeEl("div");
      group.className = "input-group";
      const input = makeEl("input");
      input.value =
        "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html";
      const append = makeEl("div");
      append.className = "input-group-append";
      const scrape = makeEl("button");
      scrape.className = "scrape-url-button";
      append.appendChild(scrape);
      group.appendChild(input);
      group.appendChild(append);
      form.appendChild(group);

      NS.shopLinks = true;
      NS.decorateShopUrls(form);

      const head = all(".manga-tools-shop-prefix")[0];
      assert.ok(head, "the recognised row gets a head");
      assert.strictEqual(
        head.getAttribute("data-shop"),
        "dlsite",
        "…carrying the shop it recognised"
      );
      // **No icon in this world, and that is the contract.** `assetBase` is
      // unknown here (the real plugin logs it), so `shopIconUrl` is ""; the head
      // still names the shop and the code, and an `<img src="">` — which resolves
      // to the document and draws a broken icon — is exactly what must not be
      // made.
      assert.strictEqual(
        head.querySelector("img"),
        null,
        "…with no image when the asset base is unknown"
      );
      assert.strictEqual(
        head.querySelector(".input-group-text").getAttribute("title"),
        "DLsite · BJ03044888",
        "…but with the shop and the code still named"
      );
      assert.strictEqual(
        group.children[0],
        head,
        "…at the very front of the input group"
      );

      // Running again must not add a second one: the observer will run this on
      // the mutation our own insertion caused.
      NS.decorateShopUrls(form);
      assert.strictEqual(
        all(".manga-tools-shop-prefix").length,
        1,
        "a second pass writes nothing"
      );

      // **The same shop, another product.** `data-shop` does not change, so a
      // guard keyed on the shop alone would skip the title — and the title
      // carries the code the reader hovers for.
      input.value =
        "https://www.dlsite.com/books/work/=/product_id/RJ01668994.html";
      NS.decorateShopUrls(form);
      assert.strictEqual(
        head.getAttribute("data-shop"),
        "dlsite",
        "the shop is unchanged"
      );
      assert.strictEqual(
        head.querySelector(".input-group-text").getAttribute("title"),
        "DLsite · RJ01668994",
        "…and the code in the head follows the link anyway"
      );

      // The same row, another shop: the head is updated, not duplicated.
      input.value = "https://ec.toranoana.jp/tora_r/ec/item/040030474993/";
      NS.decorateShopUrls(form);
      assert.strictEqual(
        head.getAttribute("data-shop"),
        "toranoana",
        "changing the link changes the head in place"
      );
      assert.strictEqual(
        head.querySelector(".input-group-text").getAttribute("title"),
        "虎穴 · 040030474993",
        "…title and all"
      );
      assert.strictEqual(
        all(".manga-tools-shop-prefix").length,
        1,
        "…without a second one"
      );

      // A link that is not a shop: the head goes.
      input.value = "https://www.pixiv.net/artworks/1";
      NS.decorateShopUrls(form);
      assert.strictEqual(
        all(".manga-tools-shop-prefix").length,
        0,
        "an unrecognised link takes the head away"
      );

      NS.shopLinks = false;
    }
  );

  /**
   * A row whose value React rewrote in place is decorated again.
   *
   * This is the drag-reorder case: Stash's `StringListInput` keys its rows by
   * index, so dragging one swaps two inputs' values without adding or removing a
   * node and without a native `input` event. `dragend` and `drop` are the only
   * signals, and the observer + listeners are installed by `watchShopUrls`, not
   * by the decorator — so what this drives is the installation itself.
   */
  runSection("16 a row React rewrote in place is decorated again", () => {
    const form = makeEl("form");
    const all = (selector) => {
      const out = [];
      const name = selector.slice(1);
      const walk = (node) => {
        node.children.forEach((child) => {
          if (child.classList.contains(name)) out.push(child);
          walk(child);
        });
      };
      walk(form);
      return out;
    };
    form.querySelectorAll = all;

    const group = makeEl("div");
    group.className = "input-group";
    const input = makeEl("input");
    input.value =
      "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html";
    const append = makeEl("div");
    append.className = "input-group-append";
    const scrape = makeEl("button");
    scrape.className = "scrape-url-button";
    append.appendChild(scrape);
    group.appendChild(input);
    group.appendChild(append);
    form.appendChild(group);

    NS.shopLinks = true;
    const run = () => NS.decorateShopUrls(form);
    run();
    const stop = NS.watchShopUrls(form, run);

    const head = () => all(".manga-tools-shop-prefix")[0];

    // The drag path: the value is rewritten in place, then the drag ends.
    assert.strictEqual(
      typeof form.listeners.dragend,
      "function",
      "a drag-reorder is watched — it is neither a mutation nor an input event"
    );
    input.value = "https://ec.toranoana.jp/tora_r/ec/item/040030474993/";
    form.listeners.dragend();
    assert.strictEqual(
      head().getAttribute("data-shop"),
      "toranoana",
      "dragend re-decorates the row React rewrote"
    );

    // A rewrite that lands on blur: `change` is the other rewrite signal.
    input.value = "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/";
    form.listeners.change();
    assert.strictEqual(
      head().getAttribute("data-shop"),
      "fanza",
      "change does too"
    );

    // Rows added or removed are the observer's business.
    input.value =
      "https://www.melonbooks.co.jp/detail/detail.php?product_id=2500562";
    observed[observed.length - 1].callback();
    assert.strictEqual(
      head().getAttribute("data-shop"),
      "melonbooks",
      "and the observer still watches the form"
    );

    stop();
    assert.strictEqual(
      form.listeners.dragend,
      undefined,
      "the cleanup removes every listener it installed"
    );

    NS.shopLinks = false;
  });

  runSection("16 a Stash gallery save refreshes the store", () => {
    // The shop row reads the gallery's urls from the store, so a save from Stash's
    // own edit form has to reach it. The wrapper on the client recognises the
    // generated `GalleryUpdate` and refreshes; the count is the store's own query,
    // which is the refresh. A timer because the wrapper waits for the mutation's
    // promise, and this section runs before the tally's timer.
    const before = state.galleryQueryCount;
    const client = global.window.PluginApi.utils.StashService.getClient();

    client.mutate({
      mutation: { definitions: [{ name: { value: "GalleryUpdate" } }] },
      variables: { input: { id: "1" } },
    });

    setTimeout(() => {
      assert.ok(
        state.galleryQueryCount > before,
        "a gallery save asks the store for its galleries again"
      );
    }, 0);

    // **The wrapper's decision, on its own.** The live count above proves the
    // success path is wired; it cannot reliably prove the other two branches,
    // because a refresh deferred from an earlier section lands in the same
    // window. The names are Stash's generated ones — a Stash bump is the one
    // thing this test cannot see — and the settings document is the plugin's own
    // (`saveSettings`), which must never cost a store query.
    assert.strictEqual(
      NS.refreshesStoreAfter("GalleryUpdate"),
      true,
      "a single-gallery save refreshes the store"
    );
    assert.strictEqual(
      NS.refreshesStoreAfter("GalleriesUpdate"),
      true,
      "and so does a bulk one"
    );
    assert.strictEqual(
      NS.refreshesStoreAfter("MangaToolsSettings"),
      false,
      "the plugin's own settings write does not"
    );
    assert.strictEqual(
      NS.refreshesStoreAfter(null),
      false,
      "and a document with no operation name never does"
    );
  });
};
