/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  runSection,
  CHAPTERS_VIEW,
  NR,
  startReader,
  stopReader,
} = require("./harness.js");

module.exports = async () => {
  /**
   * The gallery page's own Chapters tab, which this plugin renders from its own
   * chapters. Stash's rows are read for as long as they are all that knows where a
   * chapter is, and are never written — the point of taking the tab over is that
   * the plugin's field becomes the one that says where chapters are.
   */
  /**
   * The two menus in the reader's own header. Nothing else asserts that they open —
   * which is how they shipped dead: the state changed on a click and nothing redrew,
   * so a reader pressing either of them saw nothing at all.
   */
  await runSection("the header's two menus open and close", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const menu = (which) => chrome.querySelector(".manga-reader-menu-" + which);
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );

    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "the chapter menu starts closed"
    );

    dom.click(toggle("chapters"));
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      true,
      "and the button in the header opens it"
    );
    assert.deepStrictEqual(
      [...menu("chapters").querySelectorAll(".manga-reader-menu-item")].map(
        (item) => item.querySelector(".manga-reader-chapter-name").textContent
      ),
      ["開幕", "中盤"],
      "onto the gallery's chapters"
    );
    assert.strictEqual(
      menu("chapters").querySelector(".manga-reader-menu-head") !== null,
      true,
      "under a heading of its own, which is what a list this long needs"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      true,
      "the other button opens the settings"
    );
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "and only one menu is open at a time"
    );
    assert.ok(
      menu("settings").querySelector("#manga-reader-double-page"),
      "which holds the switches"
    );

    dom.click(toggle("settings"));
    assert.strictEqual(
      menu("settings").classList.contains("show"),
      false,
      "and pressing it again puts the menu away"
    );

    // Anything that is not the menu closes it — Stash's own options popover closes
    // this way, and a menu that only its own button can put away is one a reader ends
    // up reading past.
    // The footer, which is Stash's own markup with no handler of its own: a click
    // there reaches the lightbox and nothing else, which is the case this is about.
    // (A click on a page reaches it too, and turns the page on the way.)
    dom.click(toggle("chapters"));
    assert.strictEqual(menu("chapters").classList.contains("show"), true);
    dom.click(box.lightbox.querySelector(".Lightbox-footer"));
    assert.strictEqual(
      menu("chapters").classList.contains("show"),
      false,
      "and a click anywhere else in the lightbox puts it away"
    );
    assert.strictEqual(
      toggle("chapters").getAttribute("aria-expanded"),
      "false",
      "with the button saying so"
    );

    stopReader(box);
  });

  /**
   * What this header looks like is Stash's stylesheet's business, which means the
   * markup has to be Stash's own: every class asserted here is one its own lightbox
   * header puts on the same element, read off its `LightboxHeader`. A class of this
   * plugin's own would be styled by nothing and would read as a plugin's header,
   * which is the one thing this half exists not to be.
   *
   * The icon names are asserted for the same reason: the stub has no Font Awesome
   * to draw with, so the name the button asks for is the whole of what a test can
   * see — and it is also the part that was wrong, when the header drew its own
   * three bars and its own cross out of characters.
   */
  await runSection("the header is Stash's own markup", async () => {
    const { box } = await startReader({
      galleryId: "31",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });

    const chrome = box.lightbox.querySelector(".manga-reader-chrome");
    const toggle = (which) =>
      [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
        (button) => button.dataset.opens === which
      );
    const owns = (el, ...names) =>
      names.every((name) => el.classList.contains(name));

    const chapterButton = toggle("chapters");
    assert.ok(
      owns(
        chapterButton,
        "minimal",
        "Lightbox-header-chapter-button",
        "dropdown-toggle",
        "btn",
        "btn-primary"
      ),
      "the chapter button is the Dropdown.Toggle Stash's own header draws"
    );
    const dropdown = chrome.querySelector(".dropdown");
    assert.ok(
      dropdown.contains(chapterButton),
      "inside the wrapper a dropdown menu is positioned against — without it the " +
        "menu is positioned against the page, and opens off the bottom of it"
    );
    assert.ok(
      dropdown.contains(chrome.querySelector(".Lightbox-header-chapters")),
      "and the menu is in that same wrapper, which is what positions it"
    );

    assert.strictEqual(
      chrome
        .querySelector(".manga-reader-chapter-menu")
        .getAttribute("data-manga-reader-hidden"),
      null,
      "and a gallery that has chapters is offered the menu to read them in"
    );

    const gear = toggle("settings");
    assert.ok(
      owns(gear, "btn", "btn-link"),
      "the gear is one of the link buttons Stash draws the rest of its header with"
    );
    const anchor = chrome.querySelector(".Lightbox-header-options-icon");
    assert.ok(
      anchor.contains(gear) &&
        anchor.contains(chrome.querySelector(".popover")),
      "and it sits in the options box its popover is measured from"
    );
    assert.strictEqual(
      chrome.querySelector(".manga-reader-options-anchor") === anchor,
      true,
      "which this plugin also names, because the measuring is the one thing it adds"
    );

    const close = chrome.querySelector(".manga-reader-close");
    assert.strictEqual(close.tagName, "BUTTON");
    assert.ok(owns(close, "btn", "btn-link"), "the cross is one too");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(close),
      "at the end of the group that ends the row"
    );
    assert.strictEqual(
      close.title,
      "Close Lightbox",
      "and says what Stash's own says"
    );

    // Fullscreen, which Stash offers where the browser has it and this header has
    // to offer the same way — including asking for it of the lightbox, since that
    // is what fills the screen rather than the browser's own chrome coming back.
    const full = chrome.querySelector(".manga-reader-fullscreen");
    assert.ok(
      full,
      "the header should draw a fullscreen button where the browser has one"
    );
    assert.ok(
      owns(full, "btn", "btn-link"),
      "the fullscreen button is one of the link buttons too"
    );
    assert.strictEqual(full.dataset.icon, "faExpand");
    assert.ok(
      chrome.querySelector(".Lightbox-header-right").contains(full),
      "drawn in the group that ends the row, where Stash draws its own"
    );
    assert.strictEqual(dom.document.fullscreenElement, null);
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      box.lightbox,
      "pressing it fills the screen with the lightbox"
    );
    dom.click(full);
    assert.strictEqual(
      dom.document.fullscreenElement,
      null,
      "and pressing it again gives the screen back — read at the click, so leaving " +
        "fullscreen with Esc does not leave the button pointing the wrong way"
    );

    // The settings panel, which is a `popover` because that is what Stash's own
    // options menu is: a heading, a body, and a `form-group` around each control.
    // Without the body the controls sit against the border, with no gap between
    // them and none to the edge.
    const settings = chrome.querySelector(".manga-reader-menu-settings");
    assert.ok(
      settings.classList.contains("popover") &&
        settings.classList.contains("manga-reader-settings"),
      "the settings are a popover"
    );
    const header = settings.querySelector(".popover-header");
    assert.ok(
      header,
      "the panel should have a heading, as Stash's own options popover does"
    );
    assert.strictEqual(
      header.textContent,
      "Reading options",
      "its own words, because this panel is this plugin's own — Stash's says " +
        '"Options" over a flat list of controls, and this one has three groups'
    );
    const body = settings.querySelector(".popover-body");
    assert.ok(body, "and a body, which is where its padding comes from");
    for (const id of [
      "#manga-reader-single-page",
      "#manga-reader-double-page",
      "#manga-reader-cover-alone",
      "#manga-reader-detect-spreads",
      "#manga-reader-offset",
      "#manga-reader-fade-off",
      "#manga-reader-fade-on",
      "#manga-reader-show-progress",
      "#manga-reader-show-marks",
      "#manga-reader-wheel",
      "#manga-reader-shift-wheel",
      "#manga-reader-ctrl-wheel",
    ]) {
      const control = settings.querySelector(id);
      assert.ok(control, `${id} should be in the panel`);
      assert.ok(
        body.contains(control),
        `${id} should be inside the body rather than beside it`
      );
      assert.ok(
        [...body.querySelectorAll(".form-group")].some((group) =>
          group.contains(control)
        ),
        `${id} should have a form-group of its own — that is where the gap between ` +
          "one control and the next comes from"
      );
    }

    // Four groups, each with its own heading: how the pages are paired, whether a screen
    // fades in as it arrives, what is drawn over the pages while they are read, and what the
    // wheel does. Stash's own panel is one flat list, so this is the arrangement this plugin
    // chose. The shift used to be a group of its own, named for a gallery — it is remembered
    // for the browser now, and belongs with the other pairing settings.
    assert.deepStrictEqual(
      [...body.querySelectorAll(".manga-reader-group")].map(
        (group) => group.querySelector(".manga-reader-group-label").textContent
      ),
      ["Reading", "Animation", "Progress", "Wheel"],
      "in four groups, each named"
    );
    assert.strictEqual(
      body.querySelectorAll(".manga-reader-divider").length,
      3,
      "with a rule between each pair of them, and none around the outside"
    );

    // **The one note in this panel**, and the one thing a reader cannot work out from the
    // panel itself: that every row below the way-of-reading chooser belongs to that way of
    // reading, and that the settings live on the server rather than in this browser. It hangs
    // off the Reading group's own heading, and it opens on hover — see the stylesheet — which
    // is what the settings page's "?" does and for the same reason: nothing about it is state.
    // Found from the document rather than from the panel this section is holding: the menus
    // are drawn into the lightbox's own header, and a section that kept a panel element from
    // before a re-draw would be asking the wrong tree.
    const help = dom.body.querySelector(".manga-reader-help");
    assert.ok(help, "the Reading group carries a note");
    assert.strictEqual(
      help.parentNode.classList.contains("manga-reader-heading-line"),
      true,
      "…on the heading of the group that chooses the way of reading, and not on a row"
    );
    assert.strictEqual(
      help.parentNode.parentNode.querySelector(".manga-reader-group-label")
        .textContent,
      "Reading",
      "…which is the Reading group's own heading"
    );
    // And it survives a pass. The words it sits beside are written by every pass — that is
    // what `say` does — and writing text into an element takes its children with it, which is
    // exactly how this note came to be built and then wiped out on the very next pass.
    dom.flush();
    assert.strictEqual(
      dom.body.querySelector(".manga-reader-help") === null,
      false,
      "…and it is still there after a pass has written the words beside it"
    );
    const note = help.querySelector(".manga-reader-help-panel").textContent;
    assert.strictEqual(
      note,
      "The settings are stored on the server. Each way of reading has a set of its own, " +
        "and they do not affect one another.",
      "…and it says both things: which set these rows are, and where the settings are kept"
    );
    const helpButton = help.querySelector(".manga-reader-help-button");
    assert.strictEqual(
      helpButton.getAttribute("aria-label"),
      note,
      "which is also what the button is called for a reader who cannot see it"
    );
    // And it *says* something. A wrapper, a note, and nothing in the button between them is a
    // note no reader can open — which is what this was, and why the "?" could not be found on
    // the page. The glyph is Stash's own icon where the plugin API can draw one; this DOM
    // cannot, so what is read here is the character that stands in for it, the same fallback
    // the settings page's "?" has.
    assert.strictEqual(
      helpButton.textContent,
      "?",
      "…and the button wears a glyph, or there is nothing to hover"
    );

    // No descriptions: a row is its label and its control, and there is nothing under
    // either. A quiet line under a switch is Stash's own shape for one, and this panel
    // has decided against it for now.
    assert.strictEqual(
      body.querySelector(".form-text"),
      null,
      "and no hint under any row"
    );

    // The two settings that had no control until now: stored and obeyed since the
    // pairing was written, and reachable from nothing.
    for (const id of [
      "#manga-reader-cover-alone",
      "#manga-reader-detect-spreads",
    ]) {
      const control = settings.querySelector(id);
      assert.strictEqual(
        control.classList.contains("custom-control-input"),
        true,
        `${id} should be a switch in Bootstrap's own markup`
      );
      assert.strictEqual(
        control.checked,
        true,
        `${id} should start on, which is what this plugin has always read it as`
      );
    }

    // The fade is two buttons rather than a slider — the class it used to wear was
    // Bootstrap *5*'s name for one, against an app built on 4. The panel does have one
    // slider now, and it is the bar's clock: read off the inputs by hand, because the
    // stub answers ids, classes and tags and nothing else. `input[type=range]` matches
    // *nothing* here — which is how this check came to pass for as long as it did while
    // proving nothing at all.
    const ranges = [...settings.querySelectorAll("input")].filter(
      (input) => input.type === "range"
    );
    assert.deepStrictEqual(
      ranges.map((input) => input.id),
      ["manga-reader-idle"],
      "the panel's one slider is the bar's clock, and the fade is not a slider"
    );

    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "the chapter button asks for bars while the chapters are away"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faTimes",
      "and for a cross while they are open, as Stash's own does"
    );
    dom.click(chapterButton);
    assert.strictEqual(
      chapterButton.dataset.icon,
      "faBars",
      "and for bars again once they are put away"
    );
    assert.strictEqual(gear.dataset.icon, "faCog", "the gear is always a cog");
    assert.strictEqual(
      close.dataset.icon,
      "faTimes",
      "and the cross is always a cross"
    );

    stopReader(box);
  });

  /**
   * A menu is placed by the stylesheet and nudged back inside the window.
   *
   * The stylesheet anchors both menus to a button, and a button is a place rather than
   * a promise: the gear is three buttons from the edge of the window, and the window is
   * as narrow as the reader made it. Stash's own popover gets this from react-overlays,
   * which measures it and flips or slides it until it fits; this header is DOM work
   * with no React in it, so it measures and slides the panel itself.
   *
   * The arithmetic first, on its own, because the DOM these tests draw with has no
   * layout at all — every box is zero-sized and nothing can be measured — so a
   * placement is a number a section has to be able to ask for directly. A negative
   * shift is leftwards, a positive one rightwards.
   */
  await runSection(
    "a menu that lands off an edge is moved back inside the window",
    async () => {
      assert.strictEqual(
        NR.fitShift(100, 276, 1200, 8),
        0,
        "a menu with room on both sides is left where the stylesheet put it"
      );
      assert.strictEqual(
        NR.fitShift(1100, 276, 1200, 8),
        -184,
        "one hanging off the right is slid left, as far as the margin and no further"
      );
      assert.strictEqual(
        NR.fitShift(-168, 348, 380, 8),
        176,
        "and one hanging off the left, on a narrow window, is slid back the other way"
      );
      assert.strictEqual(
        NR.fitShift(0, 600, 380, 8),
        8,
        "a menu wider than the window keeps its left margin and loses its right — at " +
          "that width, sliding it further would only choose which end is cut off"
      );

      // And the wiring. Where the panel *landed* is a thing this section has to state,
      // because nothing in this DOM can lay anything out: the stub reports the box it
      // was handed, as a browser would — which is to say including whatever shift has
      // already been applied to it.
      const { box } = await startReader({ galleryId: "8", on: true });
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const toggle = [
        ...chrome.querySelectorAll(".manga-reader-menu-button"),
      ].find((button) => button.dataset.opens === "settings");
      const panel = chrome.querySelector(".manga-reader-menu-settings");

      dom.window.innerWidth = 380;
      panel.getBoundingClientRect = () => ({
        left: -168 + Number(panel.dataset.shift || 0),
        width: 348,
      });
      dom.click(toggle);

      assert.strictEqual(
        panel.style.transform,
        "translateX(176px)",
        "a panel that landed off the left of the window is moved back into it"
      );

      // Opened again on the same screen: the same answer — and *nothing written* to
      // say so, because this is where the panel already is. The pass that keeps this
      // header up to date runs on every change the lightbox makes, and a write per
      // pass is the shape of change that makes a change: the observer hears its own
      // write and runs again. Counting the writes, not comparing the value, since a
      // second write of the same transform leaves the same transform behind.
      dom.click(toggle);
      const applied = panel.style.transform;
      let writes = 0;
      Object.defineProperty(panel.style, "transform", {
        configurable: true,
        get: () => applied,
        set: () => {
          writes++;
        },
      });

      dom.click(toggle);
      assert.strictEqual(
        writes,
        0,
        "and opening it again on the same screen writes nothing at all"
      );
      assert.strictEqual(
        panel.style.transform,
        applied,
        "…leaving it exactly where it already was, because there was nothing to fix"
      );

      // **And downwards, which is a height rather than a shift.** A panel taller than the room
      // beneath it has nowhere to be moved to, so it is given the room that is left and a
      // scrollbar of its own — the same thing Stash's own menu does, at a flat 300px. The two
      // numbers here are a real pair, measured on a laptop: a 710px panel whose top is 46px
      // down a 698px window, which is 58px of it below the screen.
      let capped = 0;
      let maxHeight = "";
      Object.defineProperty(panel.style, "maxHeight", {
        configurable: true,
        get: () => maxHeight,
        set: (value) => {
          capped++;
          maxHeight = value;
        },
      });
      dom.window.innerHeight = 698;
      panel.getBoundingClientRect = () => ({
        left: 0,
        top: 46,
        width: 348,
        height: 710,
      });

      // A pass rather than a click: the menu is open and stays open — and a pass is what a
      // window that changed size asks for.
      dom.flush();
      assert.strictEqual(
        panel.style.maxHeight,
        "644px",
        "a panel with more under it than the window has room for is given that room: " +
          "698 − 46 − the margin"
      );

      // The same pass again on the same window: nothing written, and nothing to write. A cap
      // written per pass would be a change per pass, and the observer hears its own writes.
      capped = 0;
      dom.flush();
      assert.strictEqual(capped, 0, "…and the next pass writes nothing at all");

      // A window with almost no room still leaves a menu a few rows and a scrollbar, rather
      // than one row: the floor under the answer.
      dom.window.innerHeight = 100;
      dom.flush();
      assert.strictEqual(
        panel.style.maxHeight,
        "180px",
        "and a window too short for anything leaves the floor"
      );

      // And the chapter menu is left alone, which is the other half of that answer: it is a
      // list that scrolls inside itself, and a cap of this kind on it would be a second
      // scrollbar around the first.
      const chapters = chrome.querySelector(".manga-reader-menu-chapters");
      chapters.getBoundingClientRect = () => ({
        left: 0,
        top: 46,
        width: 348,
        height: 710,
      });
      dom.window.innerHeight = 698;
      dom.click(
        [...chrome.querySelectorAll(".manga-reader-menu-button")].find(
          (button) => button.dataset.opens === "chapters"
        )
      );
      dom.flush();
      assert.strictEqual(
        chapters.style.maxHeight,
        undefined,
        "the chapter menu is not capped: its own list is what scrolls"
      );

      dom.window.innerHeight = 0;
      stopReader(box);
    }
  );

  /**
   * The settings that only mean something about a *pair* go away with the pairing.
   *
   * "Cover on a page of its own" and "detect spreads" describe how two pages are put
   * together, and the shift moves that pairing by a page: a reader reading one page at
   * a time has no use for any of them, and a switch that changes nothing is worse than
   * no switch. They are put away rather than removed — this panel is built once and
   * updated in place, which is the same rule as the zoom button's.
   */
  await runSection(
    "the pairing's own settings go with the pairing",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const panel = box.lightbox.querySelector(".manga-reader-menu-settings");

      /** The row a control sits in — the stub has no `closest`, so the walk is ours */
      const rowAt = (id) => {
        for (
          let at = panel.querySelector(id);
          at && at !== panel;
          at = at.parentNode
        ) {
          if (at.classList?.contains("manga-reader-row")) return at;
        }
        return null;
      };
      const away = (node) =>
        node.getAttribute("data-manga-reader-hidden") !== null;

      const pairedRows = [
        "#manga-reader-cover-alone",
        "#manga-reader-detect-spreads",
        "#manga-reader-offset",
      ];
      for (const id of pairedRows) {
        assert.strictEqual(
          away(rowAt(id)),
          false,
          `${id} is there to be set while there is a pairing`
        );
      }
      assert.strictEqual(
        away(panel.querySelector(".manga-reader-divider")),
        false,
        "and the one rule between the two groups is where it was"
      );

      // One page at a time: all three go — the shift included, which moves a pairing by
      // a page — and the rule between the groups that remain stays.
      dom.click(panel.querySelector("#manga-reader-single-page"));

      for (const id of pairedRows) {
        assert.strictEqual(
          away(rowAt(id)),
          true,
          `${id} is put away when the pages are read one at a time`
        );
      }
      assert.strictEqual(
        away(panel.querySelector(".manga-reader-divider")),
        false,
        "with the rule between the groups left in place"
      );

      // And back, since the pairing is the browser's setting rather than this section's.
      dom.click(panel.querySelector("#manga-reader-double-page"));
      assert.strictEqual(
        away(rowAt("#manga-reader-cover-alone")),
        false,
        "and choosing two pages brings them back"
      );

      stopReader(box);
    }
  );

  /**
   * A gallery in no chapters has no chapter menu: no menu, and no button to open one.
   *
   * Stash's own header is empty of them on such a gallery — it renders its chapter
   * menu only when it has chapters to put in it — and a button that opens nothing is
   * worse than no button at all: it says there are chapters, and then shows none.
   */
  await runSection(
    "a gallery in no chapters gets no chapter button",
    async () => {
      const { box } = await startReader({ galleryId: "8", on: true });
      const chrome = box.lightbox.querySelector(".manga-reader-chrome");
      const menu = chrome.querySelector(".manga-reader-chapter-menu");

      assert.ok(menu, "the header is built with a place for the chapter menu");
      assert.notStrictEqual(
        menu.getAttribute("data-manga-reader-hidden"),
        null,
        "and the place is hidden, because this gallery has no chapters to put in it"
      );

      stopReader(box);
    }
  );
};
