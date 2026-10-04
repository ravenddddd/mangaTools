/**
 * 14: the bulk edit dialog — where its rows go, what they prefill with, and what
 * an Apply sends. Like 08, it waits for the plugin's first refresh.
 */

const assert = require("node:assert");
const {
  NS,
  call,
  callAfter,
  documentRoot,
  find,
  globalListeners,
  loggedErrors,
  loggedWarnings,
  makeEl,
  mutationWrites,
  patchedBefore,
  runSection,
  state,
} = require("../helpers.js");

module.exports = () => {
  // ── 14. Bulk edit dialog: the manga rows ride along with Apply ──
  // The rows' prefill comes from the plugin's gallery store, which only has data
  // once the refresh promise has settled — hence the timer this file runs in.
  //
  // Stand in for EditGalleriesDialog's form: BulkUpdateFormGroup renders each row
  // as a Bootstrap `.row` carrying data-field, so that is the anchor.
  //
  // The rating row comes first because Stash's dialog has one, and it is what the
  // plugin identifies the dialog by — the studio attribute alone is shared with
  // the scrape dialog's rows, so the anchor has to be looked for inside this form
  // rather than in the document. A fixture without it would be modelling a dialog
  // Stash does not draw.
  const bulkForm = makeEl("form");
  documentRoot.appendChild(bulkForm);

  const bulkRatingRow = makeEl("div");
  bulkRatingRow.className = "row";
  bulkRatingRow.dataset.field = "rating";
  bulkForm.appendChild(bulkRatingRow);

  const bulkStudioRow = makeEl("div");
  bulkStudioRow.className = "row";
  bulkStudioRow.dataset.field = "studio";
  const bulkStudioLabel = makeEl("label");
  bulkStudioLabel.className = "col-form-label col-3";
  const bulkStudioControl = makeEl("div");
  bulkStudioControl.className = "col-9";
  bulkStudioRow.appendChild(bulkStudioLabel);
  bulkStudioRow.appendChild(bulkStudioControl);
  bulkForm.appendChild(bulkStudioRow);

  const bulkPerformerRow = makeEl("div");
  bulkPerformerRow.className = "row";
  bulkPerformerRow.dataset.field = "performers";
  bulkForm.appendChild(bulkPerformerRow);

  // The selection is read from GalleryList, which the plugin observes rather
  // than replaces.
  const selectGalleries = (ids) =>
    patchedBefore.GalleryList({ selectedIds: new Set(ids) }, undefined);

  // The rows are mounted by the RatingSystem patch; render the fragment it
  // returns and follow the portal it makes.
  // Stash's own rating control, as the `after` patch is handed it.
  const ratingResult = { type: "RatingSystem", props: {} };

  const bulkRow = () => {
    const frag = callAfter("RatingSystem", { value: 0 }, ratingResult);
    const rowEl = frag.props.children[1];
    return rowEl.type(rowEl.props);
  };

  // The component draws a fragment of [warning?, mark, language?, censorship?].
  // The nulls are dropped, so this is exactly the rows that are on screen.
  const bulkChildren = () => {
    const kids = bulkRow().node.props.children;
    return (Array.isArray(kids) ? kids : [kids]).filter(Boolean);
  };
  const selectOf = (inputId) =>
    find(bulkRow().node, (n) => n.props && n.props.inputId === inputId);
  const mangaBox = () =>
    find(
      bulkRow().node,
      (n) =>
        n.props &&
        n.props.id === "manga_tools_manga" &&
        n.props.type === "checkbox"
    );

  // The mark's tri-state. React has no `indeterminate` prop, so the plugin sets
  // it on the DOM node through the ref — probe it the way a real node would be.
  const mangaState = () => {
    const box = mangaBox();
    const probe = {};
    box.props.ref(probe);
    return {
      checked: box.props.checked,
      indeterminate: probe.indeterminate === true,
    };
  };

  const b14 = bulkRow();
  assert.strictEqual(
    b14.__portal,
    true,
    "the bulk rows should render through a portal"
  );

  // Found from the studio row rather than by position in the form: the form is
  // Stash's, its other rows come and go with what the dialog offers, and an index
  // into it would be a fact about the fixture rather than about the plugin.
  const bulkHost = bulkStudioRow.nextElementSibling;
  assert.strictEqual(bulkHost.className, "manga-tools-field-host");
  assert.strictEqual(
    bulkHost.previousElementSibling === bulkStudioRow,
    true,
    "the rows should go right after the studio row"
  );
  assert.strictEqual(
    bulkHost.nextElementSibling === bulkPerformerRow,
    true,
    "and right before the performers row — i.e. between studio and performers"
  );
  assert.strictEqual(b14.host, bulkHost);

  // The mark is native organized-style markup (form-group wrapping a form-check,
  // checkbox then label), not the grid columns the selects below use. Nothing is
  // selected yet, so only the mark is drawn.
  const markRow = bulkChildren()[0];
  assert.strictEqual(markRow.props.className, "form-group");
  assert.strictEqual(markRow.props["data-field"], "manga_tools_manga");
  const markCheck = markRow.props.children;
  assert.strictEqual(
    markCheck.props.className,
    "form-check",
    "the mark should be a native form-check like Stash's organized field"
  );
  const markLabel = markCheck.props.children[1];
  assert.strictEqual(
    markLabel.props.className,
    "form-check-label",
    "with the label after the checkbox"
  );
  assert.strictEqual(
    markLabel.props.children,
    "是否为漫画",
    "named as the question it asks about the galleries, not as the field"
  );

  // ── The mark is the gate ──
  // Nothing selected reads as "not manga", so only the mark is drawn — no fields,
  // no warning.
  selectGalleries([]);
  assert.strictEqual(
    bulkChildren().length,
    1,
    "an empty selection draws only the mark"
  );
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });

  // All-manga: the two fields appear, pre-filled from the selection. Gallery 1
  // and 6 are zh-Hans; 1 is censored, 6 has no censorship value.
  selectGalleries(["1", "6"]);
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    [
      "manga_tools_manga",
      "manga_tools_language",
      "manga_tools_censorship",
      "manga_tools_translation_group",
    ],
    "an all-manga selection shows the mark and every field, in order"
  );

  // …and each of the two only while its own switch says so. The mark is not one of
  // the four fields and is never gated on them: it is what makes a gallery this
  // plugin's at all, so a dialog that could not set it would leave every gallery
  // unmarked.
  NS.fieldCensorship = false;
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    [
      "manga_tools_manga",
      "manga_tools_language",
      "manga_tools_translation_group",
    ],
    "a field turned off takes its row and nothing else"
  );
  NS.fieldCensorship = true;
  NS.fieldLanguage = false;
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    [
      "manga_tools_manga",
      "manga_tools_censorship",
      "manga_tools_translation_group",
    ],
    "…whichever of them it is"
  );
  NS.fieldLanguage = true;
  // The translation group is a field like the other two, and its switch is the
  // only thing that takes its row away.
  NS.fieldTranslationGroup = false;
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    ["manga_tools_manga", "manga_tools_language", "manga_tools_censorship"],
    "the group's own switch takes the group's row"
  );
  NS.fieldTranslationGroup = true;
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    [
      "manga_tools_manga",
      "manga_tools_language",
      "manga_tools_censorship",
      "manga_tools_translation_group",
    ],
    "and every one of them is back"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.value.value,
    "zh-Hans",
    "the whole selection agreeing should prefill that language"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.value.label,
    "简体中文",
    "in the UI language"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.placeholder,
    "选择语言…",
    "the placeholder is this plugin's own string, so it follows the UI language too"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.menuPortalTarget,
    global.document.body,
    "the menu has to escape the modal"
  );
  assert.strictEqual(selectOf("manga_tools_language").props.isClearable, true);

  // Both selects carry the "remove" option as their last entry, distinct from the
  // clear button (clear = "leave alone", remove = "delete").
  const langOptions = selectOf("manga_tools_language").props.options;
  const censorOptions = selectOf("manga_tools_censorship").props.options;
  const langRemove = langOptions[langOptions.length - 1];
  const censorRemove = censorOptions[censorOptions.length - 1];
  assert.strictEqual(langRemove.label, "移除");
  assert.strictEqual(censorRemove.label, "移除");
  assert.strictEqual(
    langRemove.value,
    censorRemove.value,
    "the same sentinel value is used by both selects"
  );

  // Censorship prefills the same way: a single censored gallery.
  selectGalleries(["1"]);
  assert.strictEqual(
    selectOf("manga_tools_censorship").props.value.value,
    "censored",
    "a censored selection prefills"
  );

  // A mixed language selection must not prefill.
  selectGalleries(["1", "2"]);
  assert.strictEqual(selectOf("manga_tools_language").props.value, null);

  // ── The mixed cycle: keep → mark → unmark → keep ──
  // Gallery 8 is not manga (it is not even in the store), so 1+8 is mixed.
  selectGalleries(["1", "8"]);
  assert.deepStrictEqual(mangaState(), { checked: false, indeterminate: true });
  assert.strictEqual(
    bulkChildren().length,
    1,
    "a mixed selection draws no fields yet"
  );

  mangaBox().props.onChange(); // mark — the safe direction first
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  assert.strictEqual(bulkChildren().length, 4, "marking reveals the fields");

  mangaBox().props.onChange(); // unmark
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  {
    const rows = bulkChildren();
    assert.strictEqual(
      rows.length,
      2,
      "unmarking draws the warning above the mark"
    );
    assert.strictEqual(rows[0].props.className, "alert alert-warning");
    assert.ok(
      String(rows[0].props.children).includes("移除"),
      "the warning names removal"
    );
    assert.strictEqual(rows[1].props["data-field"], "manga_tools_manga");
  }

  mangaBox().props.onChange(); // back to keep
  assert.deepStrictEqual(mangaState(), { checked: false, indeterminate: true });

  // An all-manga selection toggles keep ↔ unmark (no indeterminate state).
  selectGalleries(["1", "6"]);
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  mangaBox().props.onChange(); // unmark
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  mangaBox().props.onChange(); // keep again
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });

  // A none selection toggles keep ↔ mark.
  selectGalleries(["8"]);
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  mangaBox().props.onChange(); // mark
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  mangaBox().props.onChange(); // keep again
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });

  // ── Apply: the picked values ride along with the dialog's own update ──
  /** Runs an operation through the plugin's link and reports what came out */
  const runLink = (variables, rootField) => {
    let forwarded = null;
    let completed = null;
    const forward = (op) => {
      forwarded = op;
      return {
        map(fn) {
          completed = fn({ data: {} });
          return this;
        },
      };
    };
    state.installedLink.__chain[0].request(
      {
        query: {
          kind: "Document",
          definitions: [
            {
              kind: "OperationDefinition",
              selectionSet: {
                selections: [
                  { name: { value: rootField ?? "bulkGalleryUpdate" } },
                ],
              },
            },
          ],
        },
        variables,
      },
      forward
    );
    return { forwarded, completed };
  };

  const bulkVars = () => ({ input: { ids: ["1", "2"], photographer: "x" } });

  // The link is installed the first time the rows render, and must not disturb
  // the chain Stash already had.
  assert.ok(state.installedLink, "the bulk rows should install the link hook");
  assert.strictEqual(
    state.installedLink.__chain[1].__original,
    true,
    "the existing link chain must be passed through untouched"
  );

  // Untouched: nothing pending, so a bulk edit of photographers goes out exactly
  // as Stash built it.
  let r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "an untouched selection must not add custom_fields"
  );
  assert.strictEqual(
    r14.completed,
    null,
    "nothing to clear when nothing was injected"
  );

  // A successful write refetches the store, or the badges go stale. The refetch
  // itself is checked at the end, once the microtask queue has drained — see the
  // note beside that assertion. This first write's shape is the immediate result.
  selectGalleries(["1", "6"]);
  const queriesBefore = state.galleryQueryCount;
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "ja" },
  });

  // ...and the pending value is dropped, so a second Apply does not repeat it.
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "the value should only ever be sent once"
  );

  // Language set.
  selectOf("manga_tools_language").props.onChange({
    value: "zh-Hant",
    label: "繁体中文",
    flag: "tw",
  });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "zh-Hant" },
  });
  assert.deepStrictEqual(
    r14.forwarded.variables.input.ids,
    ["1", "2"],
    "the rest of the input must be left alone"
  );
  assert.strictEqual(r14.forwarded.variables.input.photographer, "x");

  // Language remove — the one way to empty the field across a whole selection.
  selectOf("manga_tools_language").props.onChange(langRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: ["plugin.mangaTools.language"],
  });

  // Censorship set.
  selectOf("manga_tools_censorship").props.onChange({ value: "uncensored" });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.censorship": "uncensored" },
  });

  // Censorship remove.
  selectOf("manga_tools_censorship").props.onChange(censorRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: ["plugin.mangaTools.censorship"],
  });

  // ── The translation group, and the raw mark that is its other answer ──
  //
  // The pair the edit page draws — a select and a steak — moved into the dialog,
  // where each of the two has a third state the edit page's field never has, because
  // a selection can hold more than one answer.
  const groupSelect = () => selectOf("manga_tools_translation_group");

  // Matched by whole class names on a `button`, not by substring: the div the two
  // chips share a column with carries `manga-tools-chip-row`, which *contains*
  // "manga-tools-chip" — a substring test finds that wrapper first and reads the
  // wrong node's props.
  const chipButton = (want, not) =>
    find(
      bulkRow().node,
      (n) =>
        n.type === "button" &&
        typeof n.props?.className === "string" &&
        n.props.className.split(/\s+/).includes(want) &&
        (!not || !n.props.className.split(/\s+/).includes(not))
    );
  const chip = () => chipButton("manga-tools-original");

  // The groups the library holds, by name, with the remove entry last — the same
  // shape as the two rows above. Two spellings of one name (gallery 4 typed its
  // group with spaces) are one group, which is the store's rule, not this row's.
  selectGalleries(["1", "4"]);
  const groupOptions = groupSelect().props.options;
  assert.deepStrictEqual(
    groupOptions.map((o) => o.value),
    ["Aozora", "Lily Manga", langRemove.value],
    "the groups the library holds, in name order, with remove last"
  );
  assert.strictEqual(
    groupSelect().props.value.value,
    "Lily Manga",
    "the group the selection agrees on prefills"
  );
  assert.strictEqual(
    groupSelect().props.isDisabled,
    false,
    "a translated selection leaves the box usable"
  );
  // The hint is the same fact the ordering below uses, drawn beside the name.
  assert.deepStrictEqual(
    groupOptions.find((o) => o.value === "Lily Manga").hint,
    { flag: "cn", name: "简体中文" },
    "and the menu says which language that group's galleries usually are"
  );
  assert.strictEqual(
    groupOptions.find((o) => o.value === "Aozora").hint,
    null,
    "a group the store has nothing to say about carries no hint"
  );

  // …and the ordering the edit page does, done against what a *selection* agrees on
  // rather than against one gallery: both of these are zh-Hans, and Lily Manga's
  // galleries usually are, so it comes first. With no agreed language there is
  // nothing to sort by and the name order above is what is left.
  selectGalleries(["1", "6"]);
  assert.deepStrictEqual(
    groupSelect().props.options.map((o) => o.value),
    ["Lily Manga", "Aozora", langRemove.value],
    "the group whose galleries speak the selection's language comes first"
  );

  // A group the selection disagrees about does not prefill — like the language row.
  selectGalleries(["1", "3"]);
  assert.strictEqual(groupSelect().props.value, null);

  // ── The steak ──
  // Gallery 7 is raw and 1 is not, so this selection is a mix — which is the state
  // a button cannot show by being pressed or not pressed, and has to say some other
  // way. `aria-pressed="mixed"` is that way; the title says it in words.
  selectGalleries(["1", "7"]);
  assert.strictEqual(
    chip().props["aria-pressed"],
    "mixed",
    "a selection that disagrees about raw says so"
  );
  assert.ok(
    /生肉/.test(chip().props.title),
    "…in words too, since a button has no indeterminate look of its own"
  );
  assert.strictEqual(chip().props.className.includes("mixed"), true);

  // The cycle mirrors the mark's: mix → raw → not raw → mix. Pressing raw takes the
  // group away, remembering it — which is what makes the next press an undo rather
  // than a second guess.
  //
  // The name is *typed* rather than picked, and that is the point: picking a group
  // is the other answer to "is this raw" and so moves this control's state on its
  // own (see the note in groupSelect's onChange), while typing says nothing about
  // raw. Typing is also how a group the library does not have yet gets set, so this
  // is the state the steak has to work from.
  groupSelect().props.onInputChange("Hoshi", { action: "input-change" });
  assert.strictEqual(
    chip().props["aria-pressed"],
    "mixed",
    "typing a name is not a claim about raw"
  );
  chip().props.onClick(); // raw
  assert.strictEqual(chip().props["aria-pressed"], true);
  assert.strictEqual(
    groupSelect().props.isDisabled,
    true,
    "raw is why there is no group to enter"
  );
  assert.strictEqual(
    groupSelect().props.placeholder,
    "生肉（无翻译组）",
    "…and the box says which of the two emptinesses this is"
  );
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.original": "true" },
    remove: ["plugin.mangaTools.translationGroup"],
  });

  chip().props.onClick(); // not raw — and the name comes back
  assert.strictEqual(chip().props["aria-pressed"], false);
  assert.strictEqual(groupSelect().props.isDisabled, false);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    {
      partial: { "plugin.mangaTools.translationGroup": "Hoshi" },
      remove: ["plugin.mangaTools.original"],
    },
    "un-pressing raw puts back the name it took, as the edit page does"
  );

  chip().props.onClick(); // back to the mix
  assert.strictEqual(chip().props["aria-pressed"], "mixed");
  assert.deepStrictEqual(
    runLink(bulkVars()).forwarded.variables.input.custom_fields,
    { partial: { "plugin.mangaTools.translationGroup": "Hoshi" } },
    "the rest state takes no view on raw — the name in the box is still going out"
  );

  // **The case this got wrong.** A selection where nothing is raw — the ordinary
  // one, and the one every reader starts from — has to toggle on the *first* press.
  // Keyed on the pending value instead of on the selection, that first press moved
  // "no view" to "no view" and the button sat there looking broken; every press has
  // to change what is drawn, which is what keying it on the aggregate buys.
  selectGalleries(["1"]); // group Lily Manga, no gallery raw
  groupSelect().props.onChange(null);
  assert.strictEqual(
    chip().props["aria-pressed"],
    false,
    "precondition: nothing in this selection is raw"
  );
  chip().props.onClick();
  assert.strictEqual(
    chip().props["aria-pressed"],
    true,
    "one press marks it raw, from the state the selection is already in"
  );
  assert.deepStrictEqual(
    runLink(bulkVars()).forwarded.variables.input.custom_fields,
    {
      partial: { "plugin.mangaTools.original": "true" },
      remove: ["plugin.mangaTools.translationGroup"],
    },
    "…and raw takes the group with it, the selection's own included"
  );

  // The undo puts back **exactly** what it took, which for a box that was showing
  // the selection's own value is "no pending at all" — so the removal above goes
  // with it rather than being left standing. A selection with no group of its own
  // is the case that tells the two apart: restoring "the name" would have had to
  // invent one.
  chip().props.onClick();
  assert.strictEqual(
    chip().props["aria-pressed"],
    false,
    "a second press takes raw back, so the pair is one toggle"
  );
  assert.strictEqual(
    runLink(bulkVars()).forwarded.variables.input.custom_fields,
    undefined,
    "…and the removal raw made goes with it, so the box says nothing at all again"
  );
  selectGalleries(["6"]); // no group of its own
  chip().props.onClick();
  chip().props.onClick();
  assert.strictEqual(
    runLink(bulkVars()).forwarded.variables.input.custom_fields,
    undefined,
    "which is the same answer where there was no group to take"
  );

  // The chip is one of the four fields' controls, so its switch takes it away — and
  // the row stays either way, which is the point of a field switch rather than a
  // harder question about the row.
  NS.fieldOriginal = false;
  assert.strictEqual(chip(), null, "the raw field off takes the steak with it");
  assert.ok(groupSelect(), "…and leaves the group row standing");
  NS.fieldOriginal = true;
  assert.ok(chip(), "and it is back");
  selectGalleries(["1"]);

  // ── The suggested language, offered here as the edit page offers it ──
  //
  // Gallery 4 carries "  Lily Manga  " and no language, so the group has something
  // to suggest (Lily Manga's galleries are zh-Hans) and the row has nothing to say
  // yet. Gallery 1 is the same group *with* that language — nothing to suggest,
  // because writing what is already there is furniture.
  const wand = () => chipButton("manga-tools-chip", "manga-tools-original");
  // From what each selection *says*, with nothing picked in this dialog — which is
  // the state the two assertions below are about.
  groupSelect().props.onChange(null);
  selectOf("manga_tools_language").props.onChange(null);

  selectGalleries(["1"]);
  assert.strictEqual(
    wand(),
    null,
    "a language the group already agrees with is no suggestion"
  );
  selectGalleries(["4"]);
  assert.ok(wand(), "a group whose galleries are usually zh-Hans suggests it");
  assert.ok(
    /简体中文/.test(wand().props.title),
    "naming the language in the tooltip"
  );
  wand().props.onClick();
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    { partial: { "plugin.mangaTools.language": "zh-Hans" } },
    "clicking it writes the language, and nothing else — the group in the row is " +
      "the selection's, not something this dialog picked"
  );

  // Remove first, while nothing else has been said: it takes the group off and that
  // is the whole of what it does. The chip beside it is how raw is said, and the two
  // are different claims.
  selectGalleries(["1"]);
  groupSelect().props.onChange(langRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: ["plugin.mangaTools.translationGroup"],
  });

  // Choosing a group is the edit page's other answer to "is this raw": it writes
  // the group *and* un-marks raw, because a gallery with a translator is not one.
  groupSelect().props.onChange({ value: "Aozora", label: "Aozora" });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.translationGroup": "Aozora" },
    remove: ["plugin.mangaTools.original"],
  });

  // …and removing the name afterwards does *not* take that claim back: a pick said
  // "not raw", and taking a name off a gallery is not a statement about whether it
  // is the original. The two rules compose rather than override — so the payload
  // carries both, and the chip is how you disagree.
  groupSelect().props.onChange(langRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    {
      remove: [
        "plugin.mangaTools.translationGroup",
        "plugin.mangaTools.original",
      ],
    },
    "a pick's un-raw survives a remove, which is about the group alone"
  );

  // Clearing every control — which is what the ✕ on each box means — leaves the
  // dialog writing nothing: the state this section works in from here is the one it
  // started in, and no pending of the four can leak into somebody else's payload.
  //
  // The steak has no ✕, so "no view" is reached through its own cycle — and how many
  // presses that takes depends on where it was left, because the cycle is keyed on
  // what the selection *is* (see cycleOriginal). Here the selection is not raw and a
  // group pick has already said "not raw", so it is two: raw, then nothing — the
  // same two the mark's checkbox takes from the same place.
  chip().props.onClick();
  chip().props.onClick();
  selectOf("manga_tools_language").props.onChange(null);
  groupSelect().props.onChange(null);
  assert.strictEqual(
    runLink(bulkVars()).forwarded.variables.input.custom_fields,
    undefined,
    "every control cleared writes nothing at all"
  );

  // Mark: a none selection unified to manga.
  selectGalleries(["8"]);
  mangaBox().props.onChange(); // mark
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.manga": "true" },
  });

  // Mark + set + remove can coexist in one input.
  selectGalleries(["8"]);
  mangaBox().props.onChange(); // mark
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  selectOf("manga_tools_censorship").props.onChange(censorRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: {
      "plugin.mangaTools.manga": "true",
      "plugin.mangaTools.language": "ja",
    },
    remove: ["plugin.mangaTools.censorship"],
  });

  // Unmark wins over the other two: every field this plugin owns is removed, and the
  // language/censorship pendings are ignored.
  //
  // **Which fields, and in which spelling, is not this dialog's opinion.** The list is
  // the union of `NS.fieldsToClear` over the selected galleries — the same function the
  // single-gallery unmark uses — so it is each gallery's own keys (gallery 1 carries four
  // of the six, gallery 6 carries two) and it answers `deleteOnUnmark` itself. It used to
  // be a hand-written list of canonical names: unconditional, so it destroyed values the
  // setting promised to keep, and canonical, so a key that had drifted in case stayed
  // behind. Gallery 2 is the case for the second half — its language key is spelled with
  // a capital L, and that is the spelling that has to go.
  selectGalleries(["1", "6"]);
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  selectOf("manga_tools_censorship").props.onChange({ value: "censored" });
  mangaBox().props.onChange(); // unmark
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    {
      remove: [
        "plugin.mangaTools.manga",
        "plugin.mangaTools.language",
        "plugin.mangaTools.censorship",
        "plugin.mangaTools.translationGroup",
      ],
    },
    "the keys these two galleries actually carry, and nothing else"
  );

  selectGalleries(["2"]);
  mangaBox().props.onChange(); // unmark
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    { remove: ["plugin.mangaTools.manga", "plugin.mangaTools.Language"] },
    "a key that drifted in case goes with the rest, under its own spelling"
  );

  // …and the setting is part of the answer rather than decoration: with it off, an
  // unmark takes the mark and leaves every value where the reader asked for it to stay.
  NS.deleteOnUnmark = false;
  selectGalleries(["1"]);
  mangaBox().props.onChange(); // unmark
  const keepWarning = String(bulkChildren()[0].props.children);
  assert.ok(
    /只移除漫画标记/.test(keepWarning),
    "the dialog says so before Apply, rather than promising the other thing"
  );
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(
    r14.forwarded.variables.input.custom_fields,
    { remove: ["plugin.mangaTools.manga"] },
    "with the setting off, unmarking takes the mark and nothing else"
  );
  // Turned back on, the same press is described as what it is again — asked *before*
  // the write, because a successful write clears the pending values (see the link
  // hook) and with them the warning.
  NS.deleteOnUnmark = true;
  selectGalleries(["1"]);
  mangaBox().props.onChange(); // unmark
  assert.ok(
    /全部自定义字段/.test(String(bulkChildren()[0].props.children)),
    "and turned back on, the wording says what it takes again"
  );
  // Put the mark back to "no view" before leaving: an unmark still pending would hide
  // the field rows from everything below (they are drawn only for a manga selection),
  // and this section works in the state it found.
  mangaBox().props.onChange();
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    [
      "manga_tools_manga",
      "manga_tools_language",
      "manga_tools_censorship",
      "manga_tools_translation_group",
    ],
    "the rows are back, and nothing is pending"
  );

  // Other entities' bulk updates are never touched, even with a value pending.
  selectGalleries(["1", "6"]);
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  r14 = runLink(bulkVars(), "bulkSceneUpdate");
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "a scene bulk update must not be given a language"
  );

  // ...and the value survives that, so it is still applied to the right operation.
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "ja" },
  });

  // Clearing the x means "leave the language alone", exactly as clearing the
  // studio field means "leave the studio alone" — neither sends a value.
  selectOf("manga_tools_language").props.onChange(null);
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "clearing must not write anything"
  );
  assert.strictEqual(r14.completed, null);

  // ── 14f. Where the route comes from: the URL, not a remembered value ──
  //
  // Reported: the bulk rows gone, on a gallery page, with nothing on the console.
  // The plugin used to take its path from the last `stash:location` it had been
  // handed, so a navigation it never heard about — the listener never registered,
  // an event that never arrived — left every path-gated row reading a stale answer
  // for the rest of the session. It reads the URL now, which is the thing that is
  // actually current; the event only says *when* to redraw.
  //
  // Both directions are asserted, because each one alone passes on the wrong
  // implementation: a remembered path that says "gallery" while the URL says
  // otherwise must not draw the rows, and a remembered path that says otherwise
  // while the URL says "gallery" must.
  global.window.location.pathname = "/scenes/5";
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries" } } },
  });
  // The event settled the remembered path on /galleries — and, as in a browser,
  // moved the URL with it. Now the URL moves on alone.
  global.window.location.pathname = "/scenes/5";
  // Asserted as a boolean, here and below: a portal compared against null makes
  // Node print the whole fixture DOM as the failure message, which is enough text
  // to exhaust the heap instead of reporting anything.
  assert.ok(
    !bulkRow(),
    "the URL decides, even with a remembered path that says gallery"
  );

  global.window.location.pathname = "/galleries";
  assert.ok(
    !!bulkRow(),
    "…and the rows draw from the URL alone, with no event of any kind"
  );

  // …on a list Stash scoped to an entity as well: the dialog there is the galleries
  // one, and its rows are ours to add to. This is the page the reader reported —
  // the rows simply were not there, and nothing on the console said why.
  global.window.location.pathname = "/studios/422/galleries";
  assert.ok(!!bulkRow(), "…and on a studio's own gallery list");
  global.window.location.pathname = "/galleries";

  // **A route that says otherwise is not worth a line, and this is where that is
  // pinned.** The rating row this component is mounted from belongs to *a* bulk
  // dialog, and galleries, images, scenes and groups all draw that same row — so a
  // page like /images with its own dialog open looks exactly like a gallery page
  // whose route the plugin got wrong. A line here would cry wolf on every one of
  // them, and a diagnostic nobody can trust is worse than none.
  assert.deepStrictEqual(
    loggedWarnings.filter((line) => /bulk edit dialog|react-select/.test(line)),
    [],
    "an off-route render says nothing: this is the ordinary case, not a failure"
  );

  // ── 14g. MangaTools.diag(): the readings those guards make ──
  //
  // Asserted because it is what a future "nothing drew and nothing was said" gets
  // debugged with, and a diagnostic that lies is worse than none. Every field is a
  // reading rather than a conclusion — the two paths are reported apart so that a
  // disagreement is visible instead of resolved.
  const diag = NS.diag();
  assert.strictEqual(diag.url, "/galleries", "diag reports the URL's path");
  assert.strictEqual(
    diag.path,
    "/galleries",
    "…and the path the guards answer with"
  );
  assert.strictEqual(
    diag.rememberedPath,
    "/galleries",
    "…and the last announced one"
  );
  assert.strictEqual(diag.galleryContext, true);
  assert.strictEqual(
    diag.bulkAnchor,
    true,
    "the dialog's anchor is on the page"
  );
  assert.strictEqual(diag.started, true);
  assert.strictEqual(diag.eventApi, true);
  assert.strictEqual(
    diag.locationListener,
    true,
    "and the route listener is on"
  );
  assert.ok(diag.bulkRenders > 0, "the rows have rendered");
  assert.deepStrictEqual(
    diag.hosts.find(([key]) => key === "bulk"),
    ["bulk", "attached"],
    "and their mount point is on the page, not a node React has dropped"
  );

  global.window.location.pathname = "/scenes/5";
  const offRoute = NS.diag();
  assert.strictEqual(offRoute.url, "/scenes/5");
  // Asserted *while the two disagree*, which is the only time this says anything:
  // with the event and the URL agreeing, a diag reporting either one passes.
  assert.strictEqual(
    offRoute.path,
    "/scenes/5",
    "the path the guards answer with is the URL's, not the remembered one"
  );
  assert.strictEqual(
    offRoute.rememberedPath,
    "/galleries",
    "the two paths are reported side by side, so a disagreement can be read off"
  );
  assert.strictEqual(offRoute.galleryContext, false);
  global.window.location.pathname = "/galleries";

  // The route is checked by the injection itself, not only by the rows being
  // mounted: a value left pending must not be written once the route has moved on.
  selectOf("manga_tools_language").props.onChange({
    value: "ko",
    label: "韩语",
    flag: "kr",
  });
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/scenes/5" } } },
  });
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "a pending value must never be written once the route has left the galleries"
  );

  // Off a gallery page there is no row at all
  const onScene14 = callAfter("RatingSystem", { value: 0 }, ratingResult);
  assert.strictEqual(
    onScene14.props.children[1].type(onScene14.props.children[1].props),
    null,
    "no bulk manga rows on a scene page"
  );
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries" } } },
  });
  assert.notStrictEqual(bulkRow(), null, "restored on a gallery page");

  // ── 14e. The scrape dialog's studio row is not the one we are after ──
  //
  // Reported: scraping a gallery and then editing the scraped studio put the mark
  // checkbox in the scrape dialog, under that field. The scrape dialog draws rows
  // of its own — ScrapeDialogRow emits the very `data-field="studio"` the bulk
  // dialog's row does — and it was open over a gallery page, whose RatingSystem is
  // what mounts this component. So the anchor is looked for inside the bulk
  // dialog's own form, entered from the rating row that dialog alone has.
  //
  // In front of the bulk form on purpose: document order is what a document-wide
  // query goes by, and this is the arrangement that used to find the wrong row.
  const scrapeModal = makeEl("div");
  scrapeModal.className = "modal-dialog scrape-dialog";
  const scrapeBody = makeEl("div");
  const scrapeForm = makeEl("form");
  const scrapeStudio = makeEl("div");
  // The class Stash's own row carries, px-3 and all: the fair reproduction has to
  // be the row that was reported, not a convenient stand-in for it.
  scrapeStudio.className = "px-3 pt-3 row";
  scrapeStudio.dataset.field = "studio";
  scrapeStudio.appendChild(makeEl("label"));
  scrapeStudio.appendChild(makeEl("div"));
  scrapeForm.appendChild(scrapeStudio);
  scrapeBody.appendChild(scrapeForm);
  scrapeModal.appendChild(scrapeBody);
  documentRoot.insertBefore(scrapeModal, bulkForm);
  assert.ok(
    documentRoot.children.indexOf(scrapeModal) <
      documentRoot.children.indexOf(bulkForm),
    "precondition: the scraped studio row comes first in the document"
  );

  // A portal, so it is not null — asserted as a boolean rather than compared
  // against null: a failed comparison against a portal makes Node print the whole
  // fixture DOM as the failure message, which is enough text to exhaust the heap
  // instead of reporting anything. That is how this investigation started.
  assert.ok(!!bulkRow(), "the bulk dialog's own row still draws");
  assert.ok(
    bulkStudioRow.nextElementSibling?.className === "manga-tools-field-host",
    "…and its mount point is still the bulk studio row's neighbour"
  );
  assert.ok(
    !scrapeStudio.nextElementSibling,
    "while nothing lands beside the scraped studio field"
  );

  // And the mark that identifies the dialog is what the rule rests on: take the
  // rating row away and there is no dialog to find, so nothing is drawn rather
  // than guessed at.
  bulkForm.detach(bulkRatingRow);
  assert.ok(
    !bulkRow(),
    "no rating row, no bulk dialog, and no row drawn off the back of a guess"
  );
  bulkForm.insertBefore(bulkRatingRow, bulkStudioRow);
  assert.ok(!!bulkRow(), "and back to normal with the dialog whole again");

  // ── 14h. The one way this draws nothing does say so ──
  //
  // A limit worth stating: that this line is said from the layout effect rather
  // than from the render is a fact about when a browser commits, and this world
  // cannot express it — `useLayoutEffect` here runs the callback where React would
  // run it after committing, so both placements behave identically below. What is
  // asserted is the outcome at each end (silence when the dialog is whole, one line
  // when the anchor is gone); the *placement* rests on the note in the effect.
  //
  // Reported as an empty slot in a dialog and a console with nothing on it: the
  // dialog up, its rating row in place, and the row the mount point anchors on not
  // found inside its form — which is what a browser did with a `tagName` compared
  // in lower case (see bulkAnchor and makeEl). This is the case worth a line, and
  // it is said from the layout effect rather than the render, because on the first
  // render of a dialog that opens *perfectly well* the studio row is not committed
  // yet: asked there, the line would fire on every dialog rather than on the broken
  // ones.
  const saidBefore = loggedWarnings.length;
  assert.ok(!!bulkRow(), "precondition: the dialog draws");
  assert.deepStrictEqual(
    loggedWarnings.slice(saidBefore),
    [],
    "a dialog whose studio row is where it should be says nothing"
  );

  bulkForm.detach(bulkStudioRow);
  assert.ok(!bulkRow(), "the anchor gone, the rows go with it");
  const noHost = loggedWarnings.slice(saidBefore);
  assert.strictEqual(noHost.length, 1, "…and that one does say why, once");
  assert.ok(
    /mount point could not be placed/.test(noHost[0]) &&
      /\[data-field="studio"\]/.test(noHost[0]),
    "naming the anchor it looked for and did not find"
  );
  bulkForm.insertBefore(bulkStudioRow, bulkPerformerRow);
  assert.ok(!!bulkRow(), "and the mount point comes back with the row");

  documentRoot.detach(scrapeModal);
  console.log(
    "✓ bulk edit (placement / gate+cycle / prefill / set+remove+mark+unmark / " +
      "scene isolation / one-shot / route / the scrape dialog's studio row / " +
      "the translation group and the steak / the suggested language)"
  );

  // The badges read the plugin's own store, so a successful write refetches it —
  // otherwise the covers keep the old flag until the next poll. That refetch is
  // deliberately deferred until any fetch already in flight has settled (a fetch
  // started before the write would otherwise land afterwards and undo it), so the
  // count can only be checked once the microtask queue has drained. Every write
  // above coalesced onto that one in-flight fetch, so there is exactly one
  // refetch no matter how many fields were applied.
  setTimeout(() => {
    runSection("14 the refetch it defers", () => {
      assert.strictEqual(
        state.galleryQueryCount,
        queriesBefore + 1,
        "a successful bulk update should refetch the gallery map, so the badges update"
      );
      console.log("✓ bulk edit refetch (deferred past the in-flight fetch)");
    });

    // The toolbar's writes defer the same way, and this is the only place to
    // check it: they cost two fetches of their own, so anything counting them has
    // to have finished first.
    //
    // Why it matters, in the words of the function that does it: a fetch built
    // before a write answers with the state before it, so letting that response
    // land afterwards puts back what the write just changed — a mark the reader
    // has just removed, or one they just made.
    //
    // One burst, so this is one refetch however many writes it holds: the clicks
    // happen together, their refetches are all deferred onto the fetch the last
    // navigation started, and the first of them to run starts a request the rest
    // then share. What is being asserted is that the fetch happens at all —
    // deliberately *not* one per write, which is not what the code does.
    const beforeToolbar = state.galleryQueryCount;
    for (const id of ["995", "996"]) {
      globalListeners["stash:location"]({
        detail: { data: { location: { pathname: `/galleries/${id}` } } },
      });
      const toolbar = call("CustomFields", {
        values: { [NS.FIELD_NAME]: "ja", other: "x" },
      }).props.children[2];
      const drawn = toolbar.type(toolbar.props);
      drawn.node.props.children[0].props.onClick();
    }

    setTimeout(() => {
      runSection("14b a write's refresh waits its turn", () => {
        assert.strictEqual(
          state.galleryQueryCount - beforeToolbar,
          2,
          "each write should wait for the fetch in flight and then fetch again — " +
            "one deduplicated fetch would be an answer from before the write"
        );
      });

      // A write that fails *before* it is sent — no client — has to refetch for
      // the same reason, only more so: the store was changed optimistically, the
      // server never heard, and a page left without this refresh keeps a mark
      // that does not exist. In its own burst, because a burst shares one
      // refetch (above) and so cannot tell this one from the others'.
      //
      // The baseline is taken before the navigation, which is itself a refresh.
      // The client is only missing for the click: the refresh it leads to is a
      // promise away, by which time a Stash without a client would have one
      // again — and a refresh that could not happen either way is not what this
      // is about.
      const beforeMissing = state.galleryQueryCount;
      const errorsBefore = loggedErrors.length;
      const writesBefore = mutationWrites.length;
      globalListeners["stash:location"]({
        detail: { data: { location: { pathname: "/galleries/994" } } },
      });
      const toolbar = call("CustomFields", {
        values: { [NS.FIELD_NAME]: "ja", other: "x" },
      }).props.children[2];
      state.clientMissing = true;
      toolbar.type(toolbar.props).node.props.children[0].props.onClick();
      state.clientMissing = false;

      setTimeout(() => {
        runSection("14c a write with no client says so, and refetches", () => {
          assert.strictEqual(
            mutationWrites.length,
            writesBefore,
            "with no client there is nothing to write with, so nothing is sent"
          );
          assert.strictEqual(
            state.galleryQueryCount - beforeMissing,
            2,
            "one fetch for the navigation and one to undo the optimistic mark — " +
              "a write with nowhere to go must not leave the store lying"
          );
          // The one symptom this failure has: the page cannot be told apart from
          // a successful write any other way.
          assert.ok(
            loggedErrors
              .slice(errorsBefore)
              .some((line) => /could not write the manga mark/.test(line)),
            "a write that could not be sent must be reported as one"
          );
        });

        // 14d. And the one refresh that is not a write's: opening the translation
        // group's menu asks for a fresh list, so that the name just saved is in it
        // rather than offered as a new one. Here rather than in section 08 because
        // what it costs is a query, and a query's timing is this section's subject.
        setTimeout(() => {
          runSection("14d opening the group menu refetches", () => {
            // The edit field is drawn on a gallery's page, and the section before
            // this one left the route on the list.
            globalListeners["stash:location"]({
              detail: { data: { location: { pathname: "/galleries/1" } } },
            });

            // Taken after the navigation, which is itself a refresh.
            const beforeOpen = state.galleryQueryCount;
            const { editField } = require("../renders.js");
            const block = editField({
              [NS.TRANSLATION_GROUP_FIELD_NAME]: "Lily",
            });
            const groupSelect = find(
              block.node,
              (n) => n.props?.inputId === "manga_tools_translation_group"
            );
            assert.ok(groupSelect, "the field should be on the edit page");
            groupSelect.props.onMenuOpen();

            setTimeout(() => {
              runSection("14d …and it asked", () => {
                assert.strictEqual(
                  state.galleryQueryCount - beforeOpen,
                  1,
                  "opening the menu should refetch the groups it is offering"
                );
              });
            }, 0);
          });
        }, 0);
      }, 0);
    }, 0);
  }, 0);
};
