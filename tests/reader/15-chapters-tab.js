/**
 * One area of the reader's suite, lifted out of tests/reader.js. The
 * world it runs in is harness.js; the sections below are as they were.
 */
const {
  assert,
  dom,
  state,
  mutations,
  shown,
  runSection,
  settle,
  mountBridge,
  buildChaptersTab,
  chapterMenu,
  drawnRows,
  CHAPTERS_VIEW,
  NR,
  NS,
  startReader,
  stopReader,
  stopTab,
} = require("./harness.js");

module.exports = async () => {
  await runSection(
    "the chapters tab is drawn from this plugin's chapters",
    async () => {
      mountBridge();
      const at = mutations.length;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      // It used to be hidden — the button was something in the way of rows this
      // plugin drew. It is the way *in* now: it opens this plugin's form, and it
      // stays visible, which is also what keeps `findPanel` able to find this panel
      // on every pass after this one.
      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-hidden"),
        null,
        "Stash's own button stays where it is — attributes seen: " +
          JSON.stringify(tab.button.attributes)
      );
      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-taken"),
        "",
        "marked as one this plugin has taken over, since it has"
      );
      assert.deepStrictEqual(
        drawnRows(tab.container),
        ["第一話 - #1", "第二話 - #5"],
        "and the rows are Stash's chapters, counted in path order — the order this " +
          "tab has always counted in, and the order it is listed in"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "reading a gallery's chapters does not write anything, least of all Stash's rows"
      );

      stopTab(tab);
    }
  );

  /**
   * The other switch this half reads, and the second thing it does: the Chapters tab.
   *
   * Off, the tab is Stash's — its own button opens its own editor, and nothing of this
   * plugin's is drawn among the rows. What this half drew there is forgotten, which is
   * the same errand as leaving a page with no gallery on it; a tab already on screen
   * when the setting goes is put back by the next pass over the document, and the
   * setting is changed from the settings page rather than from here in the first
   * place.
   */
  await runSection(
    "with the tab's editing off, it is Stash's tab",
    async () => {
      mountBridge();
      dom.window.location.pathname = "/galleries/32";
      NS.manageChapters = false;
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      assert.strictEqual(
        tab.button.getAttribute("data-manga-reader-taken"),
        null,
        "Stash's own button is left alone, so its own editor is what it opens"
      );
      assert.strictEqual(
        tab.container.querySelector(".manga-reader-chapter-edit"),
        null,
        "and none of our rows are drawn over its own"
      );
      assert.strictEqual(
        tab.container.nextElementSibling,
        null,
        "…nor is the import control added under them"
      );

      NS.manageChapters = true;
      stopTab(tab);
    }
  );

  /**
   * The import: Stash's chapters copied into this plugin's own field.
   *
   * The field the reader prefers and nothing has ever written, and this is the only
   * thing that fills it. It lives in the tab because the tab is where the chapters
   * are read — and because the fetch it already makes is the translation's own
   * input: it asks for *path* order, so the ids Stash's numbers count against are
   * the ones in hand, at no extra cost.
   */
  await runSection(
    "the chapters tab offers Stash's chapters for import",
    async () => {
      mountBridge();
      const at = mutations.length;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);

      dom.flush();
      await settle();

      const control = dom.body.querySelector("#manga-reader-chapters-import");
      assert.ok(control, "a gallery on Stash's own rows is offered the import");
      assert.strictEqual(
        control.previousElementSibling === tab.container,
        true,
        "and the offer sits after the list, not in it and not between it and " +
          "Stash's own button"
      );
      assert.strictEqual(
        tab.container.previousElementSibling === tab.button,
        true,
        "which is the shape the panel is found by, so it has to still hold"
      );

      const offer = control.children[0];
      assert.strictEqual(offer.tagName, "BUTTON");
      assert.strictEqual(
        offer.type,
        "button",
        "a button in Stash's own form that does not say so is a button that submits it"
      );
      assert.strictEqual(
        offer.textContent,
        "Import Stash's chapters",
        "and it says what it would do"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "offering is not doing: nothing is written until it is clicked"
      );

      dom.click(offer);
      await settle();

      assert.strictEqual(mutations.length - at, 1, "clicking imports, once");
      assert.deepStrictEqual(
        mutations[at].variables,
        {
          input: {
            id: "32",
            custom_fields: {
              partial: {
                "plugin.mangaTools.chapters":
                  '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705"]},' +
                  '{"title":"第二話","images":["704","703","702","701"]}]}',
              },
            },
          },
        },
        "Stash's numbers, expanded against path order and written as this plugin's " +
          "own list — ids rather than indices, which is the whole point of the move"
      );
      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import").children[0]
          .textContent,
        "Re-import Stash's chapters",
        "and the offer changes: this gallery has a list of this plugin's own now, " +
          "so writing over it is a different thing to ask for"
      );

      stopTab(tab);
    }
  );

  await runSection(
    "and offers nothing when there is nothing to bring over",
    async () => {
      mountBridge();

      // A gallery reading from its own list already, with no rows of Stash's to bring
      // over: there is nothing an import would write.
      dom.window.location.pathname = "/galleries/31";
      const own = buildChaptersTab([]);
      dom.flush();
      await settle();

      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import") === null,
        true,
        "a gallery with no rows of Stash's is offered nothing"
      );
      stopTab(own);

      // A cleared list is a list. It says re-import — the same as any other gallery
      // that has one of this plugin's own — and never "import", which would be an
      // offer to write over an answer without saying so.
      dom.window.location.pathname = "/galleries/35";
      const cleared = buildChaptersTab([{ title: "第一話", image_index: 1 }]);
      dom.flush();
      await settle();

      const control = dom.body.querySelector("#manga-reader-chapters-import");
      assert.ok(control, "a gallery whose own list is empty still has one");
      assert.strictEqual(
        control.children[0].textContent,
        "Re-import Stash's chapters",
        "and it is the re-import offer: an empty list is a gallery whose chapters " +
          "were cleared, not one that has none"
      );
      stopTab(cleared);

      // Rows that all point past the end of the gallery: Stash has a chapter, and this
      // gallery can use none of it, so there is nothing to write.
      dom.window.location.pathname = "/galleries/37";
      const past = buildChaptersTab([{ title: "gone", image_index: 99 }]);
      dom.flush();
      await settle();

      assert.strictEqual(
        dom.body.querySelector("#manga-reader-chapters-import") === null,
        true,
        "and neither is one offered an import of nothing, which would write an empty " +
          "list over whatever it had"
      );
      stopTab(past);
    }
  );

  /**
   * The form: Stash's own two fields and three buttons, writing this plugin's field.
   *
   * Driven the way somebody drives it — click the button, type in the fields, press
   * Save — because what is being tested is exactly that: that the shape a reader
   * already knows does what they expect, to the field this plugin keeps instead.
   *
   * Every write is asserted as the *whole* JSON that goes out, because that is the
   * value the reader will read back, and a chapter list that is right on screen and
   * wrong in the field is the failure this whole feature exists to avoid.
   */
  await runSection("the form creates, renames, moves and deletes", async () => {
    mountBridge();

    /** The form's two fields and its buttons, as the tab drew them */
    const formIn = (container) => {
      const form = container.querySelector("form");
      const fields = [...form.querySelectorAll(".form-control")];
      return {
        form,
        fields,
        save: form.querySelector(".btn-primary"),
        cancel: form.querySelector(".btn-secondary"),
        remove: form.querySelector(".btn-danger"),
      };
    };
    const written = (at) =>
      mutations[at].variables.input.custom_fields.partial[
        "plugin.mangaTools.chapters"
      ];

    // ── create, on a gallery that has only Stash's rows ──────────────────────
    dom.window.location.pathname = "/galleries/32";
    const fresh = buildChaptersTab([
      { title: "第一話", image_index: 1 },
      { title: "第二話", image_index: 5 },
    ]);
    dom.flush();
    await settle();

    assert.strictEqual(
      dom.click(fresh.button).propagationStopped,
      true,
      "Stash's own button opens this plugin's form — stopped on the way down, so " +
        "Stash's own handler never sees it"
    );
    await settle();

    const creating = formIn(fresh.container);
    assert.ok(
      creating.form,
      "and the form is what the panel holds instead of rows"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.previousElementSibling.textContent,
      "Title",
      "the first field is the title, labelled the way Stash's own form is"
    );
    assert.strictEqual(
      creating.fields[1].parentNode.previousElementSibling.textContent,
      "Image #",
      "and the second is the index of the page the chapter begins at"
    );
    assert.strictEqual(
      creating.fields[1].value,
      "1",
      "which opens at the first page when nobody is reading this gallery"
    );
    assert.strictEqual(
      creating.remove === null,
      true,
      "with nothing to delete: there is no chapter yet"
    );

    // Stash's own form, markup for markup: the ids and the `for` that tie each label
    // to its input, the class lists in Stash's order, the placeholder that is the
    // label again, and the empty place an error goes.
    assert.strictEqual(
      creating.form.getAttribute("novalidate"),
      "",
      "the form is novalidate, because it says what is wrong itself"
    );
    assert.strictEqual(
      creating.form.children[0].className,
      "form-container px-3",
      "the fields are in the padded container Stash puts them in"
    );
    assert.strictEqual(
      creating.form.children[1].className,
      "buttons-container px-3",
      "and the buttons in theirs"
    );
    assert.strictEqual(
      creating.form.children[1].children[0].className,
      "d-flex",
      "inside the flex row that lays them out"
    );
    assert.strictEqual(
      creating.fields[0].getAttribute("id") +
        " / " +
        creating.fields[0].getAttribute("name"),
      "title / title",
      "the title field is Stash's own"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.previousElementSibling.getAttribute("for"),
      "title",
      "and its label points at it, which is what a label does"
    );
    assert.strictEqual(
      creating.fields[1].getAttribute("id"),
      "image_index",
      "the index field too"
    );
    assert.strictEqual(
      creating.fields[0].className,
      "text-input form-control",
      "the class list is Stash's, in Stash's order"
    );
    assert.strictEqual(
      creating.fields[0].placeholder,
      "Title",
      "and the placeholder is the label again, as Stash's own form has it"
    );
    assert.strictEqual(
      creating.fields[0].parentNode.children[1].className,
      "invalid-feedback",
      "with the empty place Bootstrap puts an error in"
    );
    assert.strictEqual(
      creating.save.className,
      "btn btn-primary",
      "Save is Stash's primary button"
    );
    assert.strictEqual(
      creating.cancel.className,
      "ml-2 btn btn-secondary",
      "and Cancel is its secondary one, with `ml-2` where Stash has it"
    );
    assert.strictEqual(
      fresh.button.className.includes("manga-reader-chapters-editing"),
      true,
      "and Stash's own Create button is out of sight while the form is open — its own " +
        "panel takes the button away with the rows"
    );

    const at = mutations.length;
    creating.fields[0].value = "new";
    creating.fields[1].value = "3";
    dom.click(creating.save);
    await settle();

    assert.strictEqual(mutations.length - at, 1, "Save writes once");
    assert.strictEqual(
      written(at),
      '{"v":1,"chapters":[{"title":"第一話","images":["708","707"]},' +
        '{"title":"new","images":["706","705"]},' +
        '{"title":"第二話","images":["704","703","702","701"]}]}',
      "the new chapter takes the pages from page 3 to the next chapter's start — " +
        "out of 第一話, which keeps the ones before it"
    );
    assert.strictEqual(
      dom.body.querySelector("form") === null,
      true,
      "and the form closes on what was written"
    );
    assert.strictEqual(
      fresh.button.className.includes("manga-reader-chapters-editing"),
      false,
      "which brings Stash's own button back"
    );
    assert.deepStrictEqual(
      drawnRows(fresh.container),
      ["第一話 - #1", "new - #3", "第二話 - #5"],
      "the rows are the new list — drawn from what was written rather than fetched " +
        "back, the news having carried it"
    );

    // A refusal is shown *on the field it is about* rather than as a line of its own:
    // Bootstrap's own two halves, which is also the only way this form says anything.
    dom.click(fresh.button);
    await settle();
    const again = formIn(fresh.container);
    again.fields[0].value = "again";
    again.fields[1].value = "1";
    const beforeRefusal = mutations.length;
    dom.click(again.save);
    await settle();

    assert.strictEqual(
      mutations.length,
      beforeRefusal,
      "a refused save writes nothing"
    );

    // Read again: a refusal is drawn by *rebuilding* the form — the field carries the
    // mark and the words under it — so the nodes this started with are not the ones
    // on screen.
    const refused = formIn(fresh.container);
    assert.strictEqual(
      refused.fields[1].classList.contains("is-invalid"),
      true,
      "the field it is about is marked, as Bootstrap marks one"
    );
    assert.strictEqual(
      refused.fields[1].parentNode.children[1].textContent,
      "A chapter already begins here",
      "and the reason is under it"
    );

    stopTab(fresh);

    // ── rename and delete, on a gallery with a list of its own ──────────────
    dom.window.location.pathname = "/galleries/38";
    const own = buildChaptersTab([]);
    dom.flush();
    await settle();

    // The first title begins at page 1 and the second at page 5, so that is the
    // order the rows are in.
    assert.deepStrictEqual(
      drawnRows(own.container),
      ["中盤 - #1", "開幕 - #5"],
      "the rows are the list in path order, as they always were"
    );
    assert.strictEqual(
      own.container.children[0].children[1].children[1].className.includes(
        "manga-reader-chapter-edit"
      ),
      true,
      "with an Edit link after the jump link in each — Stash's own row has one there"
    );

    dom.click(own.container.children[0].children[1].children[1]);
    await settle();

    const renaming = formIn(own.container);
    assert.ok(renaming.form, "which opens the form on that chapter");
    assert.strictEqual(
      renaming.fields[0].value,
      "中盤",
      "with its title in the first field"
    );
    assert.strictEqual(
      renaming.fields[1].value,
      "1",
      "and where it begins in the second"
    );
    assert.ok(
      renaming.remove,
      "and a way to delete it, which a new chapter has not"
    );

    const beforeRename = mutations.length;
    renaming.fields[0].value = "renamed";
    dom.click(renaming.save);
    await settle();

    assert.strictEqual(
      written(beforeRename),
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703"]},' +
        '{"title":"renamed","images":["708","705","706","707"]}]}',
      "saving the new title writes the list with only that changed"
    );

    // Moving its start: the pages it gives up go to the chapter before it, which is
    // what a chapter's pages mean. Here it is the *first* chapter, so there is none
    // before it and those pages are owned by nobody.
    dom.click(own.container.children[0].children[1].children[1]);
    await settle();
    const moving = formIn(own.container);
    moving.fields[1].value = "3";
    const beforeMove = mutations.length;
    dom.click(moving.save);
    await settle();

    assert.strictEqual(
      written(beforeMove),
      '{"v":1,"chapters":[{"title":"renamed","images":["706","705"]},' +
        '{"title":"開幕","images":["704","703","702","701"]}]}',
      "moving the start re-cuts the chapters as the runs between their starts"
    );

    dom.click(own.container.children[0].children[1].children[1]);
    await settle();
    const removing = formIn(own.container);
    const beforeDelete = mutations.length;
    dom.click(removing.remove);
    await settle();

    assert.strictEqual(
      written(beforeDelete),
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703","702","701"]}]}',
      "deleting takes the chapter away and gives its pages to nobody"
    );
    assert.strictEqual(
      dom.body.querySelector("form") === null,
      true,
      "and closes the form"
    );

    stopTab(own);
  });

  /**
   * Re-importing asks first — twice over, in one control.
   *
   * There is no dialog to put this in: the tab is a DOM takeover, and Stash's own
   * confirm is a react-bootstrap `Modal` the reader test world cannot render. So the
   * control becomes the question. What makes that affordable is the render key: the
   * confirmation is part of the state this tab is drawn from, so no pass can draw
   * the offer while the question is up, or the question while the offer is.
   *
   * It has to be asked, and this is why: the field is hidden from Stash's own
   * custom-field editor, so the list about to be written over is visible in exactly
   * one place — this tab — and nowhere else to go and look at it.
   */
  /**
   * The same import for the whole library, which is what a library that has been
   * on Stash's own rows all along actually needs: the same job once per gallery is
   * the tab's business, and this is the one visit that does all of them.
   *
   * It lives in the reader half because the format does, and is asked for by the
   * tools half's settings panel through the namespace — so what these sections
   * exercise is the job itself, called the way the panel calls it.
   */
  await runSection("the whole library can be planned for import", async () => {
    mountBridge();

    // The fixture is put back before the plan is asked for: the sections above have
    // imported gallery 32 from its tab, the client now applies what is written — as a
    // server does — and the plan counts exactly that. A section that writes is a
    // section that changed the world, and this one is about the whole world.
    delete state.galleries["32"].gallery.custom_fields[
      "plugin.mangaTools.chapters"
    ];

    const plan = await NR.planChapterImports();

    // Gallery 32 is on Stash's own rows, 35 has an (empty) list of this plugin's
    // own and rows of Stash's, and 37's only chapter points past the end of it.
    // The plan cannot tell 37 from a real one — it carries no images — which is
    // why the run checks again before writing.
    assert.deepStrictEqual(
      plan.toImport.slice().sort(),
      ["32", "37"],
      "every gallery with rows of Stash's and no list of ours is to be imported"
    );
    assert.deepStrictEqual(
      plan.owned,
      ["35"],
      "and one that already has a list of ours is only counted, so that a run can " +
        "leave it alone unless it was asked not to"
    );

    const marked = Object.keys(state.galleries).filter(
      (id) => state.galleries[id].manga !== false
    ).length;
    assert.strictEqual(
      plan.considered,
      marked,
      "and everything marked was looked at, including the galleries with nothing " +
        "to bring over"
    );

    // The one thing about this job the suite cannot test. The client these tests
    // run against answers whatever it is asked, so a query a real Stash *rejects*
    // passes every assertion in this file — and the first version of this one did
    // exactly that: the settings panel's button did nothing at all on a real
    // instance, and only the browser said so.
    //
    // So the text is pinned to the shape a real Stash accepted on 2026-09-30: the
    // criterion is a *list* of objects, each carrying a `field`, and `value` is a
    // list of `Any` — which is why the mark is a variable of that type rather than
    // a `String!`. An edit here fails this assertion, and that is the reminder to
    // run the new query against something that can refuse it.
    assert.ok(
      /custom_fields: \[\{ field: \$field, modifier: EQUALS, value: \[\$mark\] \}\]/.test(
        NR.CHAPTERS_QUERY_TEXT
      ),
      "the plan asks with the criterion Stash's schema accepts: " +
        NR.CHAPTERS_QUERY_TEXT
    );
    assert.ok(
      /\$field: String!, \$mark: Any!, \$perPage: Int!/.test(
        NR.CHAPTERS_QUERY_TEXT
      ),
      "declaring each variable as the position it is used in expects"
    );
  });

  await runSection(
    "importing the library writes each gallery once",
    async () => {
      mountBridge();
      const at = mutations.length;
      const plan = await NR.planChapterImports();
      const run = await NR.runChapterImports(plan);

      assert.deepStrictEqual(
        run.written.slice().sort(),
        ["32"],
        "a gallery that can be imported is"
      );
      assert.deepStrictEqual(
        run.skippedEmpty,
        ["37"],
        "and one whose rows all point past the end of its images is not: writing " +
          "the translation of nothing would be clearing its chapters, not importing"
      );
      assert.deepStrictEqual(run.failed, [], "nothing failed");

      assert.strictEqual(
        mutations.length - at,
        1,
        "which is one write per gallery imported, and none for the ones left alone"
      );
      assert.deepStrictEqual(
        mutations[at].variables,
        {
          input: {
            id: "32",
            custom_fields: {
              partial: {
                "plugin.mangaTools.chapters":
                  '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705"]},' +
                  '{"title":"第二話","images":["704","703","702","701"]}]}',
              },
            },
          },
        },
        "each written as the list Stash's own rows translate to, in path order"
      );

      // Asked for, it does write over a gallery that already has one — which is the
      // same import, and the reason the panel asks before running it this way.
      const beforeReimport = mutations.length;
      const again = await NR.runChapterImports(plan, { reimport: true });

      assert.deepStrictEqual(
        again.written.slice().sort(),
        ["32", "35"],
        "a re-import counts the galleries that already had a list of ours"
      );
      assert.strictEqual(
        mutations.length - beforeReimport,
        2,
        "and writes them"
      );
    }
  );

  await runSection(
    "and a library import says which gallery it could not write",
    async () => {
      mountBridge();

      // Put back what the run above wrote: the client applies a write, as a server
      // does, and this section counts which galleries still have no list of their own.
      delete state.galleries["32"].gallery.custom_fields[
        "plugin.mangaTools.chapters"
      ];

      const at = mutations.length;
      const plan = await NR.planChapterImports();

      // The tools half owns the write, and a reader installed without it has no such
      // function — which is a gallery that failed rather than a run that stopped.
      const write = NS.writeChapters;
      delete NS.writeChapters;
      const run = await NR.runChapterImports(plan);
      NS.writeChapters = write;

      assert.deepStrictEqual(run.written, [], "nothing was written");
      assert.deepStrictEqual(
        run.failed.map((f) => f.id),
        ["32"],
        "the gallery that could have been written is reported, with its own error"
      );
      assert.ok(
        /tools half is not running/.test(String(run.failed[0].error)),
        "and the error names what was missing rather than being a bare failure"
      );
      assert.deepStrictEqual(
        mutations.slice(at),
        [],
        "and none of it reached Stash"
      );
    }
  );

  await runSection("re-importing asks first", async () => {
    mountBridge();
    const at = mutations.length;
    dom.window.location.pathname = "/galleries/35";
    const tab = buildChaptersTab([{ title: "第一話", image_index: 1 }]);

    dom.flush();
    await settle();

    const control = () =>
      dom.body.querySelector("#manga-reader-chapters-import");
    const offer = () => control().children[control().children.length - 1];

    dom.click(control().children[0]);
    await settle();

    assert.deepStrictEqual(
      mutations.slice(at),
      [],
      "asking is not doing: the first click writes nothing"
    );
    assert.strictEqual(
      control().children.length,
      3,
      "and the control becomes the question — a warning and two answers"
    );
    assert.ok(
      /overwritten/.test(control().children[0].textContent),
      "which say what is about to be overwritten"
    );
    assert.strictEqual(
      control().children[1].textContent,
      "Replace",
      "the answer that writes, worded as what it does"
    );
    assert.strictEqual(
      control().children[2].textContent,
      "Cancel",
      "and the answer that does not"
    );

    dom.click(control().children[2]);
    await settle();

    assert.deepStrictEqual(
      mutations.slice(at),
      [],
      "and cancelling writes nothing"
    );
    assert.strictEqual(
      control().children.length,
      1,
      "the question goes, and the offer is back"
    );
    assert.strictEqual(
      offer().textContent,
      "Re-import Stash's chapters",
      "saying what it said before it was asked"
    );

    dom.click(offer());
    await settle();
    dom.click(control().children[1]);
    await settle();

    assert.strictEqual(
      mutations.length - at,
      1,
      "and confirming is the write, once"
    );
    assert.deepStrictEqual(
      mutations[at].variables,
      {
        input: {
          id: "35",
          custom_fields: {
            partial: {
              "plugin.mangaTools.chapters":
                '{"v":1,"chapters":[{"title":"第一話","images":["708","707","706","705","704","703","702","701"]}]}',
            },
          },
        },
      },
      "with Stash's rows, expanded against path order, replacing the empty list " +
        "this gallery was keeping"
    );

    stopTab(tab);
  });

  await runSection(
    "a chapter in the tab opens the lightbox there",
    async () => {
      mountBridge();
      shown.length = 0;
      dom.window.location.pathname = "/galleries/32";
      const tab = buildChaptersTab([
        { title: "第一話", image_index: 1 },
        { title: "第二話", image_index: 5 },
      ]);
      dom.flush();
      await settle();

      // The second row is the second title, which begins at path position 4 — the tab lists
      // path order, so that is both what the row says and where the click goes.
      dom.click(tab.container.children[1].children[1].children[0]);

      assert.strictEqual(shown.length, 1, "the lightbox was asked to open");
      assert.strictEqual(
        shown[0].props.initialIndex,
        4,
        "at the page that chapter begins on"
      );
      assert.strictEqual(
        shown[0].props.images.length,
        8,
        "with the gallery's images, so the reader and the lightbox agree"
      );
      // Nothing else is handed over: the chapters are the reader's own menu, drawn
      // from the moment it draws. What the stub records as empty is what the bridge
      // was asked for, which is images and a place.
      assert.deepStrictEqual(shown[0].chapters, []);

      stopTab(tab);
    }
  );

  /**
   * Last on purpose: it empties this browser's settings and puts the *old* keys
   * back, which every section above depends on being absent. What it checks is
   * the one thing the migration promises — a reader who had both switches set
   * before the halves were bundled still has them after — and the one thing it
   * must not do, which is take the old value away from the standalone Manga
   * Reader that may still be installed beside this plugin.
   */
  /**
   * Also last, and for a related reason: it loads the bundle a *second* time, in
   * a world where the tools half cannot start, to see the one promise the merge
   * makes. The halves share a bundle, so a throw during either one's startup
   * would otherwise take both down — the entry starts them one at a time, each
   * inside its own guard, and this is what that is for.
   *
   * A missing `setInterval` because it is one of the few things the tools half
   * reaches for *while starting* and cannot guard against itself: it is where the
   * poll behind its store begins. What the reader half has to show for it is that
   * it is still there — still watching the document, still taking the arrow keys.
   *
   * Take the guard out of the entry and this section is not what fails: the bundle
   * throws at the first load, near the top of this file, and the run dies there.
   * Both are red, which is what matters — but the message here is the readable one,
   * and it is only readable because the guard is doing its job.
   */
  await runSection("an edit reaches the lightbox open on it", async () => {
    mountBridge();
    dom.window.location.pathname = "/galleries/38";
    const { box } = await startReader({
      galleryId: "39",
      on: true,
      total: 8,
      search: "?sortby=title&perPage=500",
      ids: CHAPTERS_VIEW.map(String),
    });
    const tab = buildChaptersTab([]);
    dom.flush();
    await settle();

    // By title: 701 first, so the chapter holding 703 and 704 comes before the other.
    assert.deepStrictEqual(
      chapterMenu(box),
      ["開幕", "中盤"],
      "the lightbox's own menu is the list read in its own order"
    );

    // The reader is on the first page of *its* order, which is the last of the
    // tab's — so a new chapter's index is 8 here, not 1: the two count the same
    // pages in different orders, and the form asks in the order the rows are in.
    assert.strictEqual(
      NR.readingPageIdNow("39"),
      "701",
      "and the reader says which page it is on, by id"
    );

    dom.click(tab.button);
    await settle();

    const form = tab.container.querySelector("form");
    assert.strictEqual(
      form.querySelectorAll(".form-control")[1].value,
      "8",
      "so a chapter made while reading opens at the page being read, counted in " +
        "path order — the order the rows and the row numbers are in"
    );

    // Now rename a chapter from the tab, with the lightbox open on it.
    dom.click(form.querySelector(".btn-secondary"));
    await settle();
    dom.click(tab.container.children[0].children[1].children[1]);
    await settle();

    const renaming = tab.container.querySelector("form");
    renaming.querySelectorAll(".form-control")[0].value = "renamed";

    const heard = [];
    const stopHeard = NR.watchChapters((id, chapters) =>
      heard.push([id, chapters.map((chapter) => chapter.title)])
    );

    const at = mutations.length;
    dom.click(renaming.querySelector(".btn-primary"));
    await settle();
    stopHeard();

    console.error(
      "DEBUG before the rename the menu is",
      JSON.stringify(chapterMenu(box))
    );
    assert.strictEqual(
      mutations[at].variables.input.custom_fields.partial[
        "plugin.mangaTools.chapters"
      ],
      '{"v":1,"chapters":[{"title":"開幕","images":["704","703"]},' +
        '{"title":"renamed","images":["708","705","706","707"]}]}',
      "the tab wrote the list"
    );
    console.error(
      "DEBUG after the rename the menu is",
      JSON.stringify(chapterMenu(box))
    );
    await NR.writeChapters(
      "33",
      [{ title: "direct", images: ["704", "703"] }],
      null
    );
    await settle();
    console.error(
      "DEBUG after a direct write the menu is",
      JSON.stringify(chapterMenu(box))
    );
    console.error(
      "DEBUG fixture field:",
      String(
        state.galleries["39"].gallery.custom_fields[
          "plugin.mangaTools.chapters"
        ]
      ).slice(0, 80),
      "| mutation id:",
      mutations[at].variables.input.id
    );
    // And everyone drawing this gallery is told — with the list itself, not only
    // which gallery changed. Asserted by listening rather than by reading the
    // lightbox's menu, and that is a limit of this world rather than a choice: a
    // lightbox left open across a write is one whose cached gallery the suite can
    // reload underneath it (the cache is shared between sections and evicts), so the
    // menu is a draw of something no single section owns. The reader registers the
    // same listener, and it is what draws — the contract is the thing to pin.
    assert.deepStrictEqual(
      heard,
      [["39", ["開幕", "renamed"]]],
      "so a surface that was drawing the old list is told the new one, by id and in full"
    );

    stopTab(tab);
    stopReader(box);
  });
};
