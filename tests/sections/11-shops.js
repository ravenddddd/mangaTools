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
const { NS, makeEl, runSection } = require("../helpers.js");

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
        [
          "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_790745/",
          "fanza",
          "d_790745",
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
        NS.shopOf("https://dlsite.com.evil.example/x"),
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
      assert.ok(head.querySelector("img"), "…with the icon");
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

      // The same row, another shop: the head is updated, not duplicated.
      input.value = "https://ec.toranoana.jp/tora_r/ec/item/040030474993/";
      NS.decorateShopUrls(form);
      assert.strictEqual(
        head.getAttribute("data-shop"),
        "toranoana",
        "changing the link changes the head in place"
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
};
