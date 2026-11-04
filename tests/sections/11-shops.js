/**
 * 16: the shops — recognising a link, reading its code, and the icon head the
 * edit form's URL rows get. The list is configured now; the four presets are
 * what an untouched library has, and the model's own rules are at the end.
 *
 * The parsing is pure and driven directly; the decoration is DOM work, and is
 * driven against a small form built here. The real thing is Stash's own markup:
 * the row is identified by its scrape button, and every write is guarded so the
 * observer cannot answer itself.
 */

const assert = require("node:assert");
const {
  NS,
  asManga,
  globalListeners,
  find,
  hasText,
  makeEl,
  observed,
  runSection,
  state,
  call,
} = require("../helpers.js");

module.exports = () => {
  runSection(
    "16 the four shops are recognised by host, and their codes read",
    () => {
      const cases = [
        [
          "https://www.dlsite.com/books/work/=/product_id/BJ03044888.html",
          "DLsite",
          "BJ03044888",
        ],
        [
          "https://www.dlsite.com/maniax/work/=/product_id/RJ01668994.html",
          "DLsite",
          "RJ01668994",
        ],
        // The `product_id=RJ…` spelling the same regex reads.
        [
          "https://www.dlsite.com/maniax/work/=/product_id=RJ01668994.html",
          "DLsite",
          "RJ01668994",
        ],
        // A dotted-FQDN host: the trailing dot is the same site to a browser,
        // and WHATWG's URL keeps it.
        [
          "https://www.dlsite.com./books/work/=/product_id/BJ03044888.html",
          "DLsite",
          "BJ03044888",
        ],
        // Case and a default port are already normalised by the URL parser; the
        // table says so rather than assuming it.
        [
          "HTTPS://WWW.DLsite.com:443/maniax/work/=/product_id/RJ01668994.html",
          "DLsite",
          "RJ01668994",
        ],
        [
          "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/",
          "FANZA",
          "d_790745",
        ],
        // The book shape, which is on a different subdomain and has no `cid=`.
        [
          "https://book.dmm.co.jp/product/6300672/b915awnmg04612/",
          "FANZA",
          "b915awnmg04612",
        ],
        // A subdomain is still the shop; a shape this build does not know keeps
        // the shop and loses only the code.
        ["https://book.dmm.co.jp/product/123456/", "FANZA", ""],
        [
          "https://ec.toranoana.jp/tora_r/ec/item/040030474993/",
          "虎穴",
          "040030474993",
        ],
        [
          "https://www.melonbooks.co.jp/detail/detail.php?product_id=2500562",
          "Melonbooks",
          "2500562",
        ],
      ];

      cases.forEach(([url, name, code]) => {
        const found = NS.shopOf(url);
        assert.ok(found, url + " should be recognised");
        assert.strictEqual(found.shop.name, name, url + " is " + name);
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
      links.map((link) => link.shop.name + ":" + link.code),
      ["DLsite:BJ03044888", "FANZA:d_790745"],
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
        "DLsite",
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
        "DLsite",
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
        "虎穴",
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
      "虎穴",
      "dragend re-decorates the row React rewrote"
    );

    // A rewrite that lands on blur: `change` is the other rewrite signal.
    input.value = "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/";
    form.listeners.change();
    assert.strictEqual(
      head().getAttribute("data-shop"),
      "FANZA",
      "change does too"
    );

    // Rows added or removed are the observer's business.
    input.value =
      "https://www.melonbooks.co.jp/detail/detail.php?product_id=2500562";
    observed[observed.length - 1].callback();
    assert.strictEqual(
      head().getAttribute("data-shop"),
      "Melonbooks",
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

  /**
   * **Where the heads are mounted.** The decorator itself takes a form and works
   * on it; this is the gate above it. `CustomFieldsInput` is Stash's shared
   * custom-fields component — every entity's edit form renders it — so the plugin
   * has to ask two questions before mounting: is this a gallery's form, and is
   * that gallery manga. Reported on a scene page (2026-10-28), where the FANZA
   * icon appeared on the scene's own link row.
   *
   * The mount's gate is a render decision, so what is read here is the returned
   * element tree: the mount component itself (`NS.shopUrlHeads`, published for
   * this) is present or it is not. The DOM stub has no refs, so the decorator's
   * own effect never runs in this world; that is the section above's job.
   */
  runSection(
    "16 the shop head is mounted only on a manga gallery's form",
    () => {
      const mounted = (node) => {
        if (!node || typeof node !== "object") return false;
        if (Array.isArray(node)) return node.some(mounted);
        if (node.type === NS.shopUrlHeads) return true;
        return mounted(node.props?.children);
      };
      const nav = (pathname) =>
        globalListeners["stash:location"]({
          detail: { data: { location: { pathname } } },
        });
      const render = (values) =>
        call("CustomFieldsInput", { values, onChange: () => {} });

      // A scene's form, whatever its custom fields happen to carry: the route is
      // what says this is not a gallery.
      nav("/scenes/10269");
      assert.strictEqual(
        mounted(render(asManga({}))),
        false,
        "a scene's edit form is Stash's own"
      );

      nav("/performers/3");
      assert.strictEqual(
        mounted(render(asManga({}))),
        false,
        "…and so is a performer's"
      );

      // A gallery Stash knows, but the plugin has not marked. (The store has not
      // been read yet in this part of the run, so the values are the answer —
      // see isMarkedNow.)
      nav("/galleries/999");
      assert.strictEqual(
        mounted(render({})),
        false,
        "an unmarked gallery's link rows are left alone too"
      );

      nav("/galleries/1");
      assert.strictEqual(
        mounted(render(asManga({}))),
        true,
        "a manga gallery's form is the one that gets the heads"
      );
    }
  );

  /**
   * The list itself: what the settings string means, and the rules the editor
   * checks.
   *
   * Everything here is pure — a value in, a list out — so it is driven directly.
   * The four presets are what the parsing falls back to, which is why every test
   * above still reads as it did: those are the shops an untouched library has.
   */
  runSection("16 the shop list parses, and falls back to the presets", () => {
    const names = (list) => list.map((shop) => shop.name);
    const presets = ["DLsite", "FANZA", "虎穴", "Melonbooks"];

    assert.deepStrictEqual(
      names(NS.shopsFromJson(null)),
      presets,
      "absent reads as the presets — a library that never opened the editor"
    );
    assert.deepStrictEqual(
      names(NS.shopsFromJson("{not json")),
      presets,
      "so does a value that does not parse"
    );
    assert.deepStrictEqual(
      names(NS.shopsFromJson('{"a":1}')),
      presets,
      "and so does the wrong shape"
    );
    assert.deepStrictEqual(
      NS.shopsFromJson("[]"),
      [],
      "an empty list is a value, not an absence: removing every shop keeps none"
    );

    const parsed = NS.shopsFromJson(
      JSON.stringify([
        {
          name: "  Example  ",
          icon: "",
          domains: ["WWW.Example.com", "m.example.com/"],
          regexes: ["/x/(\\d+)"],
        },
        { name: "", domains: ["nope.com"] },
        { name: "NoDomains", domains: [] },
        { name: "NoPatterns", domains: ["plain.test"] },
      ])
    );

    assert.deepStrictEqual(
      parsed,
      [
        {
          name: "Example",
          icon: "",
          domains: ["example.com", "m.example.com"],
          regexes: ["/x/(\\d+)"],
        },
        { name: "NoPatterns", icon: "", domains: ["plain.test"], regexes: [] },
      ],
      "usable entries are kept and their domains normalised; the rest are dropped"
    );
    assert.deepStrictEqual(
      NS.shopsFromJson(NS.shopsToJson(parsed)),
      parsed,
      "and the list round-trips through the settings string unchanged"
    );
  });

  runSection(
    "16 a configured shop is matched, and its first pattern wins",
    () => {
      const presets = NS.shops;
      NS.shops = NS.shopsFromJson(
        JSON.stringify([
          {
            name: "Example",
            icon: "",
            domains: ["example.com"],
            regexes: ["/a/([A-Z]+)", "/b/([0-9]+)"],
          },
        ])
      );

      try {
        const found = NS.shopOf("https://sub.example.com/b/42?x=/a/ZZ");
        assert.ok(found, "a subdomain is the shop");
        assert.strictEqual(
          found.shop.name,
          "Example",
          "…and it is the configured one"
        );
        assert.strictEqual(
          found.code,
          "ZZ",
          "the first pattern that matches wins"
        );
        assert.strictEqual(
          NS.shopOf("https://www.dlsite.com/x"),
          null,
          "a preset that is not in the list is not recognised"
        );
      } finally {
        NS.shops = presets;
      }

      assert.deepStrictEqual(
        NS.shops.map((shop) => shop.name),
        ["DLsite", "FANZA", "虎穴", "Melonbooks"],
        "the list in force is put back for the sections after this one"
      );
    }
  );

  runSection("16 the editor's rules: domains, patterns, names", () => {
    assert.strictEqual(
      NS.normalizeDomain(" HTTPS://WWW.DLsite.com:443/a/b?c "),
      "dlsite.com",
      "scheme, case, port, path, `www.` and space all collapse"
    );
    assert.strictEqual(
      NS.normalizeDomain("dlsite.com."),
      "dlsite.com",
      "a trailing dot is the same host"
    );
    assert.strictEqual(
      NS.normalizeDomain("user@www.dlsite.com"),
      "dlsite.com",
      "and a user part is not part of the host"
    );

    const literal = NS.compilePattern("/g/(\\d+)/gi");
    assert.ok(literal, "a JavaScript literal is accepted");
    assert.deepStrictEqual(
      [literal.exec("/g/12/")[1], literal.exec("/g/12/")[1]],
      ["12", "12"],
      "the g flag is dropped, so one pattern answers the same way every time"
    );
    assert.strictEqual(
      NS.compilePattern("([a-z"),
      null,
      "a pattern that does not compile is null, not a throw"
    );
    assert.strictEqual(NS.compilePattern(""), null, "and so is an empty one");

    const list = NS.shopsFromJson(
      JSON.stringify([
        { name: "One", domains: ["one.test"] },
        { name: "Two", domains: ["Two.test"] },
      ])
    );
    assert.strictEqual(
      NS.nameTaken(list, " one ", -1),
      true,
      "names ignore case and space"
    );
    assert.strictEqual(
      NS.nameTaken(list, " One ", 0),
      false,
      "a row is not a duplicate of itself"
    );
    assert.strictEqual(
      NS.domainOwner(list, "www.TWO.test", -1).name,
      "Two",
      "domains are compared as the matcher compares them"
    );
    assert.strictEqual(
      NS.domainOwner(list, "free.test", -1),
      null,
      "a free domain has no owner"
    );

    const broken = [
      { name: "", icon: "", domains: [], regexes: ["([a-z"] },
      { name: "Two", icon: "", domains: ["one.test"], regexes: [] },
    ];
    const issues = NS.shopIssues(broken, 0, "en");
    assert.match(issues.name, /required/);
    assert.match(issues.domains, /At least one domain/);
    assert.match(issues.regexAt[0], /regular expression/);

    const duplicated = [
      { name: "One", icon: "", domains: ["a.test"], regexes: [] },
      { name: "one", icon: "", domains: ["www.A.test"], regexes: [] },
    ];
    const both = NS.shopIssues(duplicated, 1, "en");
    assert.strictEqual(both.name, "Another shop already has this name");
    assert.strictEqual(both.domainAt[0], "Already used by One");
    assert.strictEqual(
      both.regexAt.length,
      0,
      "a shop with no patterns has no pattern errors — the icon alone is valid"
    );
  });

  /** An uploaded icon is the bytes, and needs no asset base to draw. */
  runSection("16 an uploaded icon is drawn straight from the settings", () => {
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
    input.value = "https://example.test/item/7";
    const append = makeEl("div");
    append.className = "input-group-append";
    const scrape = makeEl("button");
    scrape.className = "scrape-url-button";
    append.appendChild(scrape);
    group.appendChild(input);
    group.appendChild(append);
    form.appendChild(group);

    const before = NS.shops;
    NS.shops = [
      {
        name: "Example",
        icon: "data:image/png;base64,AA==",
        domains: ["example.test"],
        regexes: ["/item/(\\d+)"],
      },
    ];
    NS.shopLinks = true;

    try {
      NS.decorateShopUrls(form);
      const head = all(".manga-tools-shop-prefix")[0];
      assert.ok(head, "the configured shop's row gets a head");
      assert.strictEqual(
        head.querySelector("img").src,
        "data:image/png;base64,AA==",
        "the uploaded image is the icon — it needs no asset base"
      );
      assert.strictEqual(
        head.querySelector(".input-group-text").getAttribute("title"),
        "Example · 7",
        "and the code is read by the configured pattern"
      );
    } finally {
      NS.shops = before;
      NS.shopLinks = false;
    }
  });

  /**
   * The dialog draws the list it was handed, and the way in to adding one.
   *
   * The stub's `useState` is inert, so this is the state a dialog opens in: every
   * row folded, the add button, and the footer. What it pins is that the tree
   * renders at all with the components Stash hands a plugin — the parts a real
   * Stash would draw, without a browser to draw them in.
   */
  runSection("16 the shop editor draws the list, folded", () => {
    const tree = NS.shopDialog({ onClose: () => {}, onSave: () => {} });

    assert.ok(tree, "the dialog renders");
    assert.ok(hasText(tree, "DLsite"), "every shop in the list has a row");
    assert.ok(hasText(tree, "FANZA"), "…including the presets");
    assert.ok(hasText(tree, "虎穴"), "…all of them");
    assert.ok(hasText(tree, "Melonbooks"), "…in the order they are matched in");
    assert.ok(
      !hasText(tree, "Product code patterns"),
      "no form is open until a row is clicked"
    );
  });

  /** The row that opens the editor: one line, and the list's own length. */
  runSection("16 the settings row names the list and how long it is", () => {
    const row = NS.shopsSetting({ persist: () => {} });
    assert.ok(
      find(row, (node) => node.type === "h3"),
      "the row draws a heading"
    );
    assert.ok(
      hasText(
        row,
        NS.stringFor(
          state.currentLocale,
          "mangaTools.settings.shops.count"
        ).replace("{n}", String(NS.shops.length))
      ),
      "and counts the shops in the list"
    );
  });
};
