/**
 * 6–7d: the plugin's registration with Stash, the query it sends for the
 * gallery map, its settings page, and its own strings.
 */

const assert = require("node:assert");
const {
  NS,
  React,
  call,
  capturedQueries,
  find,
  makeFilterModel,
  original,
  patched,
  patchedAfter,
  patchedBefore,
  state,
} = require("../helpers.js");

module.exports = () => {
  // ── 6. Patch registration ──────────────────────────────────────────
  // Note it is CustomFields (plural, the container), not CustomField — the latter
  // is a plain React.FC, so patching it reports no error and simply never runs.
  // That is a real bug this project hit.
  const requiredPatches = [
    "CustomFieldsInput",
    "CustomFieldInput",
    "CustomFields",
    "PluginSettings",
  ];
  for (const t of requiredPatches) {
    assert.ok(patched[t], `missing patch: ${t}`);
  }

  // The three that only add to Stash's own output are registered as `after`
  // patches. That is what leaves the original component uncalled — so one with
  // hooks inside (GalleryCard.Overlays uses useMemo) cannot be broken by the
  // patch — and what lets the output pass through untouched when the plugin has
  // nothing to add, which the identity checks below rely on.
  const requiredAfterPatches = [
    "GalleryCard.Overlays",
    "GalleryCard.Popovers",
    "RatingSystem",
    "FilteredGalleryList",
    "FilteredGalleryList.SidebarSections",
  ];
  for (const t of requiredAfterPatches) {
    assert.ok(patchedAfter[t], `missing after patch: ${t}`);
  }

  // GalleryList carries two patches, which is allowed: Stash runs the
  // before-functions first and passes their result on to any instead-functions
  // (see patch.tsx). It is observed for the selection the bulk dialog needs, and
  // wrapped so the filter dialog's card has somewhere to render.
  assert.ok(patchedBefore.GalleryList, "missing patch: GalleryList (before)");
  assert.ok(patched.GalleryList, "missing patch: GalleryList (instead)");

  // The wrapper has to hand the list through untouched — the plugin adds siblings,
  // it does not replace anything. Two now: the list the filter dialog draws
  // inside its own card, and the original list at the end. The three sidebar
  // sections are mounted elsewhere — through Stash's sidebar patch container, a
  // page of their own in the sidebar's tests.
  const listModel = makeFilterModel();
  const listEl = call("GalleryList", {
    filter: listModel,
    selectedIds: new Set(),
  });
  assert.strictEqual(
    listEl.type,
    React.Fragment,
    "GalleryList should be wrapped, not replaced"
  );
  const [dialogFilter, listOriginal] = listEl.props.children;
  assert.strictEqual(
    typeof dialogFilter.type,
    "function",
    "the dialog's card as a sibling"
  );
  assert.strictEqual(
    listOriginal.type,
    original,
    "the original GalleryList must still be rendered"
  );
  assert.strictEqual(
    listOriginal.props.filter,
    listModel,
    "…receiving the same filter it was given"
  );

  // Rendering the list is also what offers the filter dialog a Language card: the
  // dialog builds its cards from the same options array the model holds, and this
  // is the first moment that array is in hand.
  assert.ok(
    listModel.options.criterionOptions.some((o) => o.type === "language"),
    "the list patch should register a language criterion for the dialog"
  );
  console.log(
    "✓ all 6 patches registered (+ GalleryList observed and wrapped)"
  );

  // ── 7. Query shape ─────────────────────────────────────────────────
  // Another bug this project hit: OR is singular in the schema
  // (OR: GalleryFilterType). Writing it as an array makes the whole query fail
  // validation, the failure is swallowed by the catch, and the symptom is
  // "no badges at all" with no clue anywhere outside the console.
  const galleryQuery = capturedQueries.find((q) => /findGalleries/.test(q));
  assert.ok(galleryQuery, "the plugin never built the gallery-map query");
  assert.ok(
    !/OR\s*:\s*\[/.test(galleryQuery),
    "OR is singular in the schema; an array fails validation"
  );
  assert.ok(
    /custom_fields:\s*\[\{\s*field:\s*"plugin\.mangaTools\.manga",\s*modifier:\s*NOT_NULL\s*\}\]/.test(
      galleryQuery
    ),
    "the query should filter on the mark that makes a gallery manga"
  );
  console.log("✓ query shape (OR not misused as an array)");

  // ── 7b. Settings: enabledLanguages parse/serialise ─────────────────
  // The setting is a comma-separated string of canonical codes; an empty value
  // means "no restriction" (parse returns null).
  assert.strictEqual(NS.parseEnabledLanguages(null), null);
  assert.strictEqual(NS.parseEnabledLanguages(undefined), null);
  assert.strictEqual(NS.parseEnabledLanguages(""), null);
  assert.strictEqual(NS.parseEnabledLanguages("   "), null);
  assert.deepStrictEqual(
    [...NS.parseEnabledLanguages("ja,en,zh-Hans")].sort(),
    ["en", "ja", "zh-Hans"],
    "parse should split on commas"
  );
  assert.deepStrictEqual(
    [...NS.parseEnabledLanguages("ja, JA, klingon, zh-Hans ")].sort(),
    ["ja", "zh-Hans"],
    "parse should canonicalise case, drop unknown codes and dedupe"
  );
  assert.strictEqual(
    NS.parseEnabledLanguages("klingon"),
    null,
    "a value with only unknown codes parses to null (no restriction)"
  );

  // Ordered by code, never by the name the reader sees: the stored value has to
  // come out the same for every user, and languageOptions' order now follows the
  // UI language.
  assert.strictEqual(
    NS.serializeEnabledLanguages(["ja", "en"]),
    "en,ja",
    "serialise should order by code, not insertion order"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages(new Set(["zh-Hans", "ja"])),
    "ja,zh-Hans"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages(["en", "ja"]),
    NS.serializeEnabledLanguages(["ja", "en"]),
    "the same selection must serialise the same way whatever order it arrives in"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages([]),
    "",
    "an empty set serialises to the empty string"
  );

  // The boolean settings. Absent means "not configured", so the default — on — is
  // used, and an install that predates the setting behaves exactly as before.
  assert.strictEqual(NS.parseFlag(null, true), true);
  assert.strictEqual(NS.parseFlag(undefined, true), true);
  assert.strictEqual(NS.parseFlag("", true), true);
  assert.strictEqual(NS.parseFlag(true, false), true);
  assert.strictEqual(NS.parseFlag(false, true), false);
  assert.strictEqual(
    NS.parseFlag("false", true),
    false,
    "a hand-edited string is understood"
  );
  assert.strictEqual(NS.parseFlag("0", true), false);
  assert.strictEqual(NS.parseFlag(" TRUE ", false), true);
  assert.strictEqual(
    NS.parseFlag("nonsense", true),
    true,
    "an unreadable value falls back to the default"
  );
  assert.strictEqual(NS.showFlags, true, "flags default to on");
  assert.strictEqual(NS.showCoverBadge, true, "the cover badge defaults to on");

  // ── 7b2. Whether a field is drawn at all ───────────────────────────
  // One question, asked by every surface that draws a field, so that none of them
  // has to remember that the master switch is about all four.
  NS.fields = true;
  NS.fieldLanguage = true;
  NS.fieldCensorship = true;
  NS.fieldTranslationGroup = true;
  NS.fieldOriginal = true;
  assert.strictEqual(NS.fieldShowing("language"), true);
  assert.strictEqual(NS.anyFieldShowing(), true);

  NS.fieldLanguage = false;
  assert.strictEqual(
    NS.fieldShowing("language"),
    false,
    "a field's own switch is enough on its own"
  );
  assert.strictEqual(
    NS.fieldShowing("censorship"),
    true,
    "…and reaches only the field it belongs to"
  );
  assert.strictEqual(
    NS.anyFieldShowing(),
    true,
    "one field left on is enough for a block of them to be worth drawing"
  );
  NS.fieldCensorship = false;
  NS.fieldTranslationGroup = false;
  NS.fieldOriginal = false;
  assert.strictEqual(
    NS.anyFieldShowing(),
    false,
    "with all four off there is nothing to draw"
  );

  NS.fieldLanguage = true;
  NS.fields = false;
  assert.strictEqual(
    NS.fieldShowing("language"),
    false,
    "the master covers all four"
  );
  assert.strictEqual(NS.anyFieldShowing(), false);
  NS.fields = true;
  assert.strictEqual(
    NS.fieldShowing("language"),
    true,
    "and turning it back on gives the field back as it was — hiding is not writing"
  );
  NS.fieldCensorship = true;
  NS.fieldTranslationGroup = true;
  NS.fieldOriginal = true;

  // Which keys this plugin owns is a different question from whether it draws them.
  // A field nobody is showing still has to be recognised, or a gallery's own JSON
  // would come back as somebody else's custom field in Stash's edit form.
  NS.fieldLanguage = false;
  assert.strictEqual(
    NS.ownField("plugin.mangaTools.language"),
    NS.FIELD_NAME,
    "a hidden field is still this plugin's"
  );
  NS.fieldLanguage = true;
  console.log(
    "✓ fieldShowing (the master, the four, and what a hidden field is)"
  );
  console.log("✓ settings parse/serialise (including the booleans)");

  // ── 7c. Settings UI: the multiselect writes the setting back ───────
  // The patched PluginSettings swaps the stock input for MangaToolsSettings only
  // for this plugin; other plugins fall back to the original component.
  //
  // Rendered in English explicitly: the assertions below read the plugin's own
  // strings, which are translated (see 7d), so leaving the locale to whatever ran
  // last would make them say something different for reasons that are not the point.
  state.currentLocale = "en-US";
  const settingsEl = call("PluginSettings", { pluginID: "mangaTools" });
  assert.notStrictEqual(
    settingsEl.type,
    original,
    "mangaTools should swap in its own settings component"
  );
  assert.strictEqual(
    call("PluginSettings", { pluginID: "other" }).type,
    original,
    "other plugins must go back to the original component"
  );

  // Render the settings component (find renders function components) and locate
  // the react-select, which carries isMulti + the full option list.
  // Empty (no restriction) must render as an empty box with an "All languages"
  // placeholder, NOT as every tag pre-selected.
  NS.enabledLanguages = null;
  const emptySelect = find(
    settingsEl,
    (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
  );
  assert.ok(emptySelect, "the settings UI should render a multiselect");
  assert.strictEqual(emptySelect.props.isClearable, true);
  assert.strictEqual(
    emptySelect.props.menuPlacement,
    "auto",
    "the menu should flip up when there is not enough room below"
  );
  assert.deepStrictEqual(
    emptySelect.props.value,
    [],
    "empty must not pre-select every language"
  );
  assert.strictEqual(emptySelect.props.placeholder, "All languages");

  NS.enabledLanguages = new Set(["ja", "en"]);
  const settingsSelect = find(
    settingsEl,
    (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
  );
  assert.deepStrictEqual(
    settingsSelect.props.value.map((o) => o.value).sort(),
    ["en", "ja"],
    // Sorted: the value is drawn in the order the options are listed in, and those
    // are ordered by displayed name in the reader's collation — a display detail,
    // not something this assertion is about.
    "the current value should be the enabled set"
  );

  // The switches, laid out like Stash's own BooleanSetting, in the order the page
  // shows them: the two things the plugin takes over, the fields and what is under
  // them, and the mark's own three.
  const switchesIn = (el) => {
    const out = [];
    find(el, (n) => {
      if (n.type === "Switch") out.push(n);
      return false;
    });
    return out;
  };
  const switches = switchesIn(settingsEl);
  // Every switch sits in a row the stylesheet can name. Stash gives a plugin's rows
  // `flex-wrap: wrap`, and as soon as a sub-heading is long enough that is the switch
  // on a line of its own, under the text; the rule that undoes it is keyed on this
  // class (see 04-artifacts), so a switch whose row lost it is a switch under its own
  // text again. Which is what a browser would show — the DOM stub has no idea, which
  // is why the two halves are checked in the two places that can see them.
  let rowCount = 0;
  find(settingsEl, (n) => {
    if (
      typeof n.props?.className === "string" &&
      n.props.className.split(" ").includes("manga-tools-setting")
    ) {
      rowCount += 1;
    }
    return false;
  });
  assert.strictEqual(
    rowCount,
    switches.length,
    "every switch should be in a `.setting` row carrying the class the stylesheet " +
      "uses to keep the switch beside its text"
  );
  assert.deepStrictEqual(
    switches.map((n) => n.props.id),
    [
      "mangaTools-readerTakeover",
      "mangaTools-manageChapters",
      "mangaTools-fields",
      "mangaTools-fieldLanguage",
      "mangaTools-showFlags",
      "mangaTools-showCoverBadge",
      "mangaTools-fieldCensorship",
      "mangaTools-fieldTranslationGroup",
      "mangaTools-fieldOriginal",
      "mangaTools-openDetailsBlock",
      "mangaTools-openEditBlock",
      "mangaTools-hidePerformers",
      "mangaTools-confirmUnmark",
      "mangaTools-deleteOnUnmark",
      "mangaTools-coverIcon",
    ],
    "every switch on the page, in the order it is drawn"
  );

  const sw = {};
  for (const s of switches) sw[s.props.id] = s;

  // The five features are on by default, which is what the plugin did before any
  // of them could be turned off.
  for (const id of [
    "mangaTools-readerTakeover",
    "mangaTools-manageChapters",
    "mangaTools-fields",
    "mangaTools-fieldCensorship",
    "mangaTools-fieldTranslationGroup",
    "mangaTools-fieldOriginal",
    "mangaTools-confirmUnmark",
    "mangaTools-deleteOnUnmark",
    "mangaTools-coverIcon",
    "mangaTools-showFlags",
    "mangaTools-showCoverBadge",
    "mangaTools-hidePerformers",
  ]) {
    assert.strictEqual(sw[id].props.checked, true, `${id} defaults to on`);
  }
  // The two defaults that are *not* on, which is the point of them being settings:
  // a section of a dense page starts folded, a field does not.
  assert.strictEqual(
    sw["mangaTools-openDetailsBlock"].props.checked,
    false,
    "the details block starts collapsed"
  );
  assert.strictEqual(
    sw["mangaTools-openEditBlock"].props.checked,
    true,
    "the edit block starts open — it holds the only way to set a language"
  );

  // ── 7c2. Progressive disclosure ────────────────────────────────────
  // Everything a switch holds is drawn only while it is on, and that is the *only*
  // thing the switch does to it: nothing here writes a sub-setting, so a feature
  // turned off and on again comes back exactly as it was.
  NS.fields = false;
  const bare = call("PluginSettings", { pluginID: "mangaTools" });
  assert.deepStrictEqual(
    switchesIn(bare).map((n) => n.props.id),
    [
      "mangaTools-readerTakeover",
      "mangaTools-manageChapters",
      "mangaTools-fields",
      "mangaTools-confirmUnmark",
      "mangaTools-deleteOnUnmark",
      "mangaTools-coverIcon",
    ],
    "the four fields and the display rows go with the master switch"
  );
  assert.strictEqual(
    find(
      bare,
      (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
    ),
    null,
    "…including the language multiselect, three levels down"
  );

  NS.fields = true;
  NS.fieldLanguage = false;
  const noLanguage = call("PluginSettings", { pluginID: "mangaTools" });
  assert.strictEqual(
    find(
      noLanguage,
      (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
    ),
    null,
    "a field's own settings go with that field's switch"
  );
  assert.ok(
    find(noLanguage, (n) => n.props?.id === "mangaTools-fieldCensorship"),
    "…while the other fields under the master stay where they were"
  );
  NS.fieldLanguage = true;

  // A feature turned off and on again brings its sub-settings back untouched: the
  // master switch hides, it does not write. `NS.fieldCensorship` is set here by
  // hand for the same reason the switches themselves are what is being read.
  NS.fieldCensorship = false;
  NS.fields = false;
  NS.fields = true;
  assert.strictEqual(
    NS.fieldCensorship,
    false,
    "the master switch must not touch the switches under it"
  );
  NS.fieldCensorship = true;

  // The rows that are *not* one thing's sub-settings are not wrapped in a group —
  // Stash's `.setting-group` is the class that makes a row read as belonging to the
  // one above it, and the pair below reads as a parent and a child if it is.
  //
  // Walked with the trail of class names rather than checked on one node: what
  // wraps a row in the element tree is what wraps it in the DOM.
  const classesAround = (root, pred, trail = []) => {
    if (root === null || root === undefined) return null;
    if (Array.isArray(root)) {
      for (const n of root) {
        const hit = classesAround(n, pred, trail);
        if (hit) return hit;
      }
      return null;
    }
    if (root.__portal) return classesAround(root.node, pred, trail);
    if (typeof root !== "object") return null;
    if (typeof root.type === "function") {
      return classesAround(root.type(root.props), pred, trail);
    }
    if (pred(root)) return trail;
    return classesAround(root.props?.children, pred, [
      ...trail,
      root.props?.className,
    ]);
  };
  const groupsAround = (el, id) =>
    (classesAround(el, (n) => n.props?.id === id, []) || []).filter(
      (c) => typeof c === "string" && c.includes("setting-group")
    );

  assert.deepStrictEqual(
    groupsAround(settingsEl, "mangaTools-confirmUnmark"),
    [],
    "asking before unmarking is not a sub-setting of anything"
  );
  assert.deepStrictEqual(
    groupsAround(settingsEl, "mangaTools-deleteOnUnmark"),
    [],
    "…and neither is clearing the fields with the mark"
  );
  assert.deepStrictEqual(
    groupsAround(settingsEl, "mangaTools-coverIcon"),
    [],
    "…nor the icon, which is a third sibling rather than a third level"
  );
  assert.strictEqual(
    groupsAround(settingsEl, "mangaTools-showFlags").length,
    2,
    "while a field's own settings really are nested — twice over, in fact: under " +
      "the field, which is under the master"
  );
  // The two groups that have no switch of their own: their heading is on the page
  // and is not a `.setting` row, because Stash's rules would right-align a lone
  // heading in one.
  assert.ok(
    find(settingsEl, (n) => n.props?.children === "The manga mark"),
    "the mark's rows are under a heading of their own"
  );
  assert.ok(
    find(
      settingsEl,
      (n) => n.props?.children === "How the manga info is shown"
    ),
    "and so are the three display rows"
  );

  // ── The two notes, inside their rows' descriptions ─────────────────
  // "The lightbox's own settings are adjusted on the lightbox page" and "editing
  // chapters does not touch Stash's own rows" were each a row of their own under
  // their switch, in the same grey as the description — a line of grey prose under
  // a longer line of grey prose, which is a line nobody reads. Each is now the
  // second half of its own row's description, boxed; and each stays there with its
  // switch off, because a description is always drawn and this is part of what it
  // says.
  const NOTE_ROWS = [
    ["the lightbox", "readerTakeover"],
    ["the chapters tab", "manageChapters"],
  ];
  const stringsIn = (el) => {
    const out = [];
    find(el, (n) => {
      if (n.type === undefined && typeof n.props?.children === "string") {
        out.push(n.props.children);
      }
      return false;
    });
    return out;
  };
  const withClass = (el, cls) => {
    const out = [];
    find(el, (n) => {
      if (
        typeof n.props?.className === "string" &&
        n.props.className.split(" ").includes(cls)
      ) {
        out.push(n);
      }
      return false;
    });
    return out;
  };

  const localeHere = state.currentLocale;
  const pageIn = (locale) => {
    state.currentLocale = locale;
    return call("PluginSettings", { pluginID: "mangaTools" });
  };

  // Each row's note is found by its own catalogue words, so that a note drawn with
  // another row's sentence — or in another row's column — is what the checks below
  // are looking at rather than the count being right by accident.
  const notesIn = (page, locale) => {
    const cat = NS.catalogs()[locale];
    const notes = withClass(page, "manga-tools-settings-note");
    assert.strictEqual(
      notes.length,
      NOTE_ROWS.length,
      `${locale}: each row that says a second thing should have one note, and ` +
        "nothing else on the page should"
    );
    return NOTE_ROWS.map(([name, key]) => {
      const words = cat[`mangaTools.settings.${key}.note`];
      const mine = notes.filter((n) => stringsIn(n).includes(words));
      assert.strictEqual(
        mine.length,
        1,
        `${locale}: ${name}'s note should carry ${key}.note's own words`
      );
      return { name, key, note: mine[0], page, cat };
    });
  };

  for (const locale of ["zh-Hans", "en"]) {
    for (const { name, key, note, page, cat } of notesIn(
      pageIn(locale),
      locale
    )) {
      const descriptions = withClass(page, "sub-heading").filter((d) =>
        stringsIn(d).includes(cat[`mangaTools.settings.${key}.note`])
      );
      assert.strictEqual(
        descriptions.length,
        1,
        `${locale}: ${name}'s note should sit inside exactly one description block`
      );
      assert.ok(
        stringsIn(descriptions[0]).includes(
          cat[`mangaTools.settings.${key}.description`]
        ),
        `${locale}: …and that block should be ${name}'s own description, not ` +
          "another row's"
      );
      assert.strictEqual(
        find(note, (n) => n.type === "Icon").props.icon,
        "faInfoCircle",
        `${locale}: the note should carry the info icon, which is what makes it ` +
          "read as a remark rather than as the description's next clause"
      );
    }
  }

  // …and neither goes away with its switch: they are the descriptions, not
  // sub-settings that appear under one.
  NS.readerTakeover = false;
  NS.manageChapters = false;
  const bothOff = call("PluginSettings", { pluginID: "mangaTools" });
  assert.strictEqual(
    withClass(bothOff, "manga-tools-settings-note").length,
    NOTE_ROWS.length,
    "both notes belong to their descriptions, so turning the features off leaves " +
      "them where they are"
  );
  NS.readerTakeover = true;
  NS.manageChapters = true;
  state.currentLocale = localeHere;

  // ── Folding a group shut ───────────────────────────────────────────
  // The chevron is the reader's own fold, and it is drawn only where there is
  // something under the row to fold. Folding is not writing: it takes a row's rows
  // off the page and leaves every setting exactly as it was.
  //
  // Which chevron folds what is checked by folding each one and counting the
  // switches that go, in the order the page draws them: the fields group, the
  // language field inside it, the display heading inside it, and the mark's
  // heading. Four, and no more — the lightbox and the chapters rows have nothing
  // under them since their notes moved into their descriptions, so a chevron there
  // would open nothing (and a fifth would shift every count below).
  state.currentLocale = "en";
  {
    const countIn = (el, make) => {
      const out = [];
      find(el, (n) => {
        if (make(n)) out.push(n);
        return false;
      });
      return out.length;
    };
    const isClass = (n, cls) =>
      typeof n.props?.className === "string" &&
      n.props.className.split(" ").includes(cls);
    const chevronsIn = (el) => {
      const out = [];
      find(el, (n) => {
        if (isClass(n, "manga-tools-fold")) out.push(n);
        return false;
      });
      return out;
    };
    const groupsIn = (el) =>
      countIn(el, (n) => isClass(n, "manga-tools-settings-group"));
    const switchesIn = (el) => countIn(el, (n) => n.type === "Switch");
    const open = () => call("PluginSettings", { pluginID: "mangaTools" });
    const click = (c) => {
      c.props.onClick({ stopPropagation: () => {} });
    };

    const page = open();
    const chevrons = chevronsIn(page);
    assert.strictEqual(
      chevrons.length,
      4,
      "one chevron per row that has rows under it, and no row without them"
    );
    assert.ok(
      chevrons.every((c) => c.type === "button"),
      "…each a button, so a keyboard can fold a group too"
    );
    assert.ok(
      chevrons.every((c) => c.props["aria-expanded"] === true),
      "…and each saying it is open, which is the only way anything but an eye knows"
    );
    assert.strictEqual(groupsIn(page), 2, "two groups to start with");
    assert.strictEqual(switchesIn(page), 15, "…and fifteen switches");

    const before = state.capturedConfigWrite;

    // Fold one group, count what is left, and open it again. Unfolding happens in
    // a loop because a folded group takes the chevrons inside it off the page with
    // it — the display heading and the language field are both in the fields group.
    const shutEverything = () => {
      for (let pass = 0; pass < 5; pass++) {
        const shut = chevronsIn(open()).filter(
          (c) => !c.props["aria-expanded"]
        );
        if (!shut.length) break;
        shut.forEach((c) => {
          click(c);
        });
      }
    };

    for (const [what, index, left] of [
      ["the language field, which folds two switches", 1, 13],
      ["the display heading, which folds three rows", 2, 12],
      ["the mark's heading, which folds three rows and no group", 3, 12],
      ["the fields group, which folds all nine under it", 0, 6],
    ]) {
      click(chevronsIn(open())[index]);
      assert.strictEqual(
        switchesIn(open()),
        left,
        `${what} — folding it should leave ${left} on the page`
      );
      shutEverything();
      assert.strictEqual(
        switchesIn(open()),
        15,
        `…and opening it again should bring them all back (${what})`
      );
    }

    // Nothing was written, and no setting moved: a fold is a view.
    assert.strictEqual(
      state.capturedConfigWrite,
      before,
      "folding must not write anything to Stash"
    );
    assert.deepStrictEqual(
      [NS.fields, NS.fieldLanguage, NS.openDetailsBlock, NS.coverIcon],
      [true, true, false, true],
      "…nor change a setting"
    );
    assert.strictEqual(
      groupsIn(open()),
      2,
      "and both groups are where they were"
    );
    assert.ok(
      chevronsIn(open()).every((c) => c.props["aria-expanded"] === true),
      "with every chevron saying it is open"
    );
  }
  state.currentLocale = localeHere;

  // ── The "?" and the example it opens ──────────────────────────────
  // The two settings about a cover carry one, and what opens is a card with the
  // part in question ringed rather than another paragraph. What this section can
  // see is the shape — the button, the panel, the card inside it, and the words on
  // it. Whether the panel *opens* is the stylesheet's business, and is checked
  // there (04-artifacts).
  const helpWrapsIn = (locale) => {
    state.currentLocale = locale;
    const el = call("PluginSettings", { pluginID: "mangaTools" });
    const wraps = [];
    find(el, (n) => {
      if (n.props?.className === "manga-tools-help") wraps.push(n);
      return false;
    });
    return wraps;
  };

  const localeBefore = state.currentLocale;
  const wraps = helpWrapsIn("zh-Hans");
  assert.strictEqual(
    wraps.length,
    2,
    "the two settings about a cover should carry a ?, and only those two"
  );

  for (const [i, key] of [
    [0, "mangaTools.settings.showCoverBadge.help"],
    [1, "mangaTools.settings.coverIcon.help"],
  ]) {
    const [button, panel] = wraps[i].props.children;
    assert.strictEqual(
      button.type,
      "button",
      "the ? should be a button, so that a keyboard and a finger can open it"
    );
    assert.strictEqual(
      button.props["aria-label"],
      NS.catalogs()["zh-Hans"][key],
      "the wording the panel no longer shows should be the button's name — it is " +
        "read out to whoever cannot see the picture"
    );
    assert.ok(
      panel && String(panel.props.className).includes("manga-tools-help-panel"),
      "and it should open a panel"
    );
  }

  // The example inside it: Stash's own card, drawn with Stash's own classes, so
  // that what the ring goes around is where a real card keeps it.
  const exampleCard = (panel) =>
    find(
      panel,
      (n) =>
        typeof n.props?.className === "string" &&
        n.props.className.split(" ").includes("gallery-card")
    );
  const cardClasses = (panel) => {
    const card = exampleCard(panel);
    assert.ok(card, "the panel should hold a card");
    return card.props.className.split(" ");
  };
  for (const cls of ["gallery-card", "card", "grid-card", "zoom-1"]) {
    assert.ok(
      cardClasses(wraps[0].props.children[1]).includes(cls),
      `the example should wear Stash's own \`${cls}\`, or its stylesheet draws ` +
        "nothing on it"
    );
  }
  const nested = (panel, cls) =>
    !!find(
      panel,
      (n) =>
        typeof n.props?.className === "string" &&
        n.props.className.split(" ").includes(cls)
    );
  for (const cls of [
    "thumbnail-section",
    "gallery-card-cover",
    "gallery-card-image",
    "card-section",
    "card-section-title",
    "gallery-card__details",
    "card-popovers",
  ]) {
    assert.ok(
      nested(wraps[0].props.children[1], cls),
      `…including \`${cls}\`, which is the piece that places what the ring is around`
    );
  }

  // The words are the catalogues', every one of them: the three ids below are the
  // whole of the example's text, and an example that hardcoded its caption would
  // read Chinese in an English UI. Checked per locale, against the catalogue the
  // UI is in.
  const wordsIn = (locale) => {
    const panel = helpWrapsIn(locale)[0].props.children[1];
    const words = [];
    find(panel, (n) => {
      // `type === undefined` is how the walker hands over a *text node*: an
      // element whose only child is a string is visited too, and counting that
      // one would count every word twice.
      if (n.type === undefined && typeof n.props?.children === "string") {
        words.push(n.props.children);
      }
      return false;
    });
    return words;
  };
  const EXAMPLE_TEXT = [
    "mangaTools.settings.help.cover",
    "mangaTools.settings.help.card.title",
    "mangaTools.settings.help.card.date",
  ];
  for (const locale of ["zh-Hans", "en"]) {
    const words = wordsIn(locale);
    const expected = EXAMPLE_TEXT.map((key) => NS.catalogs()[locale][key]);
    // Equal, not merely present: the panel is a picture rather than more prose, so
    // these three ids are the whole of what it says. A sentence left in from a
    // mock, or a caption written into the component instead of the catalogue,
    // shows up here as one word too many — and that one would be the language the
    // UI is not in.
    assert.deepStrictEqual(
      words.slice().sort(),
      expected.slice().sort(),
      `${locale}: the example's text should be exactly these three catalogue ids ` +
        "(the badge's own language name draws as a flag while flags are on)"
    );
  }

  // The ring, and which of the two it is on. Both panels draw the same card:
  // one rings the badge in the cover's corner, the other the mark at the end of
  // the info row — that difference is the whole of what the two panels say.
  const ringed = (panel) => {
    const out = [];
    find(panel, (n) => {
      if (
        typeof n.props?.className === "string" &&
        n.props.className.includes("manga-tools-help-lit")
      ) {
        out.push(n.props.className);
      }
      return false;
    });
    return out;
  };
  const [badgeRinged, markRinged] = [
    ringed(wraps[0].props.children[1]),
    ringed(wraps[1].props.children[1]),
  ];
  assert.strictEqual(badgeRinged.length, 1, "one ring per panel");
  assert.strictEqual(markRinged.length, 1, "one ring per panel");
  assert.ok(
    badgeRinged[0].includes("manga-tools-badge"),
    "the badge setting rings the badge"
  );
  assert.ok(
    markRinged[0].includes("manga-tools-popover-slot"),
    "the icon setting rings the slot the icon sits in"
  );
  assert.ok(
    !badgeRinged[0].includes("manga-tools-popover-slot") &&
      !markRinged[0].includes("manga-tools-badge"),
    "…and neither rings the other one's"
  );

  // The badge in the example is the plugin's own, so it follows the plugin's own
  // setting: with flags off it is the name, which is what the setting does to a
  // real cover.
  NS.showFlags = false;
  const named = find(
    helpWrapsIn("zh-Hans")[0].props.children[1],
    (n) =>
      typeof n.props?.className === "string" &&
      n.props.className.split(" ").includes("is-name")
  );
  assert.ok(
    named,
    "with flags off the example's badge should show the language's name, which is " +
      "what the same setting does on a real cover"
  );
  NS.showFlags = true;

  // A UI in a language the language table has no entry for gets English on the
  // badge, not its own tag: the chip for a value nothing recognises is
  // `.is-unknown`, and drawing `de-DE` there would be showing the reader an
  // example of bad data and calling it a language.
  const badgeIn = (locale) =>
    find(
      helpWrapsIn(locale)[0].props.children[1],
      (n) =>
        typeof n.props?.className === "string" &&
        n.props.className.split(" ").includes("manga-tools-badge")
    );
  const inGerman = badgeIn("de-DE");
  assert.ok(inGerman, "the badge should still be drawn");
  assert.ok(
    !inGerman.props.className.includes("is-unknown"),
    "and a locale with no language-table entry must not fall through to the " +
      "unrecognised-value chip"
  );

  // The flag is the reader's own language, and Stash's locales name a *region*
  // while the language table holds language codes: `zh-CN` is not in it, and
  // asking about it drew an English flag in a Simplified Chinese UI. Checked for
  // all three of the UI languages this plugin ships, plus the two spellings that
  // are not Stash's own: a script-tagged tag, and a Chinese locale whose script
  // has to come from its region.
  const flagIn = (locale) => {
    const flag = find(
      helpWrapsIn(locale)[0].props.children[1],
      (n) =>
        typeof n.props?.className === "string" &&
        n.props.className.startsWith("fi fi-")
    );
    return flag ? flag.props.className : "";
  };
  assert.strictEqual(
    flagIn("zh-CN"),
    "fi fi-cn",
    "Simplified Chinese → the CN flag"
  );
  assert.strictEqual(
    flagIn("zh-TW"),
    "fi fi-tw",
    "Traditional Chinese → the TW flag"
  );
  assert.strictEqual(
    flagIn("en-US"),
    "fi fi-gb",
    "English → the flag the table pairs with it"
  );
  assert.strictEqual(
    flagIn("ja-JP"),
    "fi fi-jp",
    "Japanese → the region dropped"
  );
  assert.strictEqual(
    flagIn("zh-Hant-HK"),
    "fi fi-tw",
    "a script already in the tag is not second-guessed by the region"
  );

  state.currentLocale = localeBefore;

  // Selecting a new set writes it back through configurePlugin and updates the
  // shared NS.enabledLanguages immediately.
  settingsSelect.props.onChange([{ value: "ja" }, { value: "zh-Hans" }]);
  assert.deepStrictEqual(
    state.capturedConfigWrite,
    {
      plugin_id: "mangaTools",
      input: {
        enabledLanguages: "ja,zh-Hans",
        // The ten switches that say what the plugin does at all, and which fields it
        // manages. All on, which is what the plugin did before they existed.
        readerTakeover: true,
        manageChapters: true,
        fields: true,
        fieldLanguage: true,
        fieldCensorship: true,
        fieldTranslationGroup: true,
        fieldOriginal: true,
        coverIcon: true,
        confirmUnmark: true,
        deleteOnUnmark: true,
        showFlags: true,
        showCoverBadge: true,
        openDetailsBlock: false,
        openEditBlock: true,
        hidePerformers: true,
        // The reading half's own settings are part of this map too, and empty here
        // because nothing has been written to the library — see the reader's
        // readSettings, where absent is what puts the browser's value back in force.
        readerSettings: "",
      },
    },
    "every setting is written together, so replace-vs-merge cannot matter"
  );
  assert.deepStrictEqual(
    [...NS.enabledLanguages],
    ["ja", "zh-Hans"],
    "the in-memory set should update immediately"
  );

  // Clearing writes "" (which parses back to "no restriction").
  settingsSelect.props.onChange(null);
  assert.deepStrictEqual(state.capturedConfigWrite.input.enabledLanguages, "");
  assert.strictEqual(
    NS.enabledLanguages,
    null,
    "clearing should restore null (all languages)"
  );

  // Flipping a block's default updates the shared state and persists the lot,
  // exactly as the display switches do.
  sw["mangaTools-openDetailsBlock"].props.onChange();
  assert.strictEqual(NS.openDetailsBlock, true, "the details default flips");
  assert.strictEqual(
    state.capturedConfigWrite.input.openDetailsBlock,
    true,
    "and the whole map is written again"
  );
  // Put back by hand rather than by calling the switch again: it toggles the
  // `checked` it was *rendered* with, so a second call in the same render sets the
  // same value a second time.
  NS.openDetailsBlock = false;

  // Flipping a switch updates the shared state and persists the lot.
  sw["mangaTools-showFlags"].props.onChange();
  assert.strictEqual(
    NS.showFlags,
    false,
    "toggling should update the shared state"
  );
  assert.deepStrictEqual(state.capturedConfigWrite, {
    plugin_id: "mangaTools",
    input: {
      enabledLanguages: "",
      // The ten switches that say what the plugin does at all, and which fields it
      // manages. All on, which is what the plugin did before they existed.
      readerTakeover: true,
      manageChapters: true,
      fields: true,
      fieldLanguage: true,
      fieldCensorship: true,
      fieldTranslationGroup: true,
      fieldOriginal: true,
      coverIcon: true,
      confirmUnmark: true,
      deleteOnUnmark: true,
      showFlags: false,
      showCoverBadge: true,
      openDetailsBlock: false,
      openEditBlock: true,
      hidePerformers: true,
      // The reading half's own settings ride along, as the string the library holds
      // them as. Empty here because this library has never been written to — see
      // readSettings in the reader, where an absent value is what puts the browser's
      // own remembered one back in force.
      readerSettings: "",
    },
  });
  NS.showFlags = true;

  // Turning the performers switch off is how a reader asks for Stash's field
  // back; the gallery's edit page follows it, since the switch is read there.
  sw["mangaTools-hidePerformers"].props.onChange();
  assert.strictEqual(
    NS.hidePerformers,
    false,
    "the performers switch is live state like the rest"
  );
  assert.strictEqual(
    state.capturedConfigWrite.input.hidePerformers,
    false,
    "…and is written with the others"
  );
  NS.hidePerformers = true;
  console.log(
    "✓ settings UI (multiselect + switches write configurePlugin, update shared state)"
  );

  // The library-wide chapter import used to be on this page, and is not any more:
  // the reader half still does the job — see its own Chapters tab, and the import
  // it runs there — but the button that drove it from here, and everything this
  // half held to drive it, is gone. What replaces it is the silent import the
  // Chapters tab does for a gallery nobody has opened yet.

  // ── 7d. The plugin's own strings follow Stash's UI language ────────
  // Only the strings this plugin writes itself have catalogs: the headings, the
  // descriptions and the placeholders. Everything else on screen comes from Stash's
  // messages, which its own provider resolves.
  // The page's first heading is the lightbox switch's, and the multiselect deeper
  // down carries a localised placeholder of its own; between them they cover the
  // catalogs, the fallback chain and the ids.
  const headingIn = (locale) => {
    state.currentLocale = locale;
    const el = call("PluginSettings", { pluginID: "mangaTools" });
    return find(el, (n) => n.type === "h3").props.children;
  };
  const placeholderIn = (locale) => {
    state.currentLocale = locale;
    const el = call("PluginSettings", { pluginID: "mangaTools" });
    return find(
      el,
      (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
    ).props.placeholder;
  };

  assert.strictEqual(headingIn("en-US"), "Take over Stash's lightbox");
  assert.strictEqual(
    headingIn("zh-CN"),
    "接管 Stash 原生灯箱",
    "a Stash set to Simplified Chinese should read the Chinese heading"
  );
  assert.strictEqual(
    placeholderIn("zh-CN"),
    "全部语言",
    "…including the multiselect's placeholder"
  );
  assert.strictEqual(
    headingIn("zh-Hant"),
    "接管 Stash 原生燈箱",
    "Traditional Chinese has its own catalog"
  );

  // The locale chain: an exact tag, then subtags dropped one at a time, then
  // English. A regional variant reads its language's catalog.
  assert.strictEqual(
    headingIn("zh-Hant-HK"),
    "接管 Stash 原生燈箱",
    "zh-Hant-HK should fall back to the zh-Hant catalog"
  );
  assert.strictEqual(headingIn("en-GB"), "Take over Stash's lightbox");
  assert.strictEqual(
    headingIn("de-DE"),
    "Take over Stash's lightbox",
    "a language with no catalog of its own reads English rather than showing ids"
  );

  // And the lookup itself, including the reading a bare `zh` gets
  assert.strictEqual(
    NS.t({ locale: "zh" }, "mangaTools.select.placeholder"),
    "选择语言…",
    "a bare zh means Simplified, as it does in the language field"
  );
  assert.strictEqual(
    NS.t({ locale: "ja-JP" }, "mangaTools.select.placeholder"),
    "Select language…"
  );
  assert.strictEqual(
    NS.t({ locale: "zh-CN" }, "mangaTools.nope"),
    "mangaTools.nope",
    "an id no catalog has should show as itself, so it is obvious in the UI"
  );
  const catalogs = NS.catalogs();
  const englishIds = Object.keys(catalogs.en).sort();
  assert.ok(
    Object.keys(catalogs).length > 1,
    "there should be catalogs to compare"
  );
  for (const locale of Object.keys(catalogs)) {
    assert.deepStrictEqual(
      Object.keys(catalogs[locale]).sort(),
      englishIds,
      `the ${locale} catalog must cover exactly the ids en.json has — a missing one ` +
        "would read English in the middle of a translated screen, a stray one would " +
        "never be shown"
    );
  }
  // …and each of them *declares* each id once. The comparison above cannot see a
  // key written twice: `JSON.parse` keeps the last one and says nothing, and every
  // catalog being duplicated in the same way keeps the three equal — which is how a
  // duplicated block of ids passed this suite and every other one, and was caught by
  // the publishing workflow's `biome lint` instead. What is read here is the file,
  // not the parsed value.
  const fs = require("node:fs");
  const path = require("node:path");
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const file = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "messages",
      `${locale}.json`
    );
    const seen = new Set();
    const twice = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const key = /^\s*"([^"]+)":/.exec(line);
      if (!key) continue;
      if (seen.has(key[1])) twice.push(key[1]);
      seen.add(key[1]);
    }

    assert.deepStrictEqual(
      twice,
      [],
      `${locale}.json declares these ids more than once, and only the last of each ` +
        "would ever be read"
    );
  }

  state.currentLocale = "zh-CN";
  console.log(
    "✓ plugin strings (catalogs by Stash locale, subtag fallback, English last)"
  );
};
