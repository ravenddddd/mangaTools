/**
 * 10–10b: the two built artefacts — the stylesheet and the bundle.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { PLUGIN } = require("../helpers.js");

module.exports = () => {
  // ── 10. Basic CSS checks (catch typos and missing rules after hand edits) ──
  const css = fs.readFileSync(path.join(PLUGIN, "mangaTools.css"), "utf8");
  assert.strictEqual(
    (css.match(/\{/g) || []).length,
    (css.match(/\}/g) || []).length,
    "CSS braces are unbalanced"
  );
  assert.ok(
    /\.manga-tools-badge\s*\{[^}]*opacity:\s*0\.75/.test(css),
    "the badge's resting opacity should be 0.75 (matching .studio-overlay)"
  );
  assert.ok(
    /\.gallery-card:hover\s+\.manga-tools-badge[^{]*\{[^}]*opacity:\s*0/.test(
      css
    ),
    "the hover fade-out rule is missing"
  );
  assert.ok(
    /\.gallery-card\s+\.thumbnail-section\s*\{[^}]*position:\s*relative/.test(
      css
    ),
    "the .thumbnail-section positioning context is missing, so the badge lands below the title"
  );
  assert.ok(
    /\.manga-tools-badge\s+\.fi\s*\{[^}]*height:/.test(css),
    "the badge flag sizing rule is missing"
  );
  // The text chip's truncation belongs to unrecognised values only. A recognised
  // language name is shown whole — clipping it is what made "印度尼西亚语" come out
  // as "印度尼…" with flags turned off.
  const boundedChip = /\.manga-tools-badge\.is-unknown\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    boundedChip && /text-overflow:\s*ellipsis/.test(boundedChip[1]),
    "an unrecognised value should be bounded and ellipsised"
  );
  assert.ok(
    !/\.manga-tools-badge\.is-name\s*\{[^}]*text-overflow/.test(css),
    "a recognised language name must not be truncated — see the .is-name rule"
  );
  // Stash's row of condition tags under our card carries Bootstrap's `d-flex`,
  // which is `display: flex !important` — so hiding it only works with
  // `!important` of our own. Without it the row shows the same selection a second
  // time in Stash's raw wording, right under the picker.
  //
  // The whole row, not the empty one: an earlier version hid it only when empty,
  // which left it appearing as soon as the criterion held anything — and that is
  // the state a language filter is normally in.
  const pillsTagsRule =
    /\.criterion-list \[data-type="language"\] \.filter-tags\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(pillsTagsRule, "the editor's own tag row should be hidden");
  assert.ok(
    /display:\s*none\s*!important/.test(pillsTagsRule[1]),
    "…with !important: a plain display: none loses to Bootstrap's d-flex"
  );
  // The flag needs its own spacing in a list row: a flex `gap` would also open up
  // the icon-to-name spacing those rows share with Stash's, and a margin applied
  // more broadly would double up in the dropdown and the detail row.
  assert.ok(
    /\.selected-object \.manga-tools-flag,[^}]*\.unselected-object \.manga-tools-flag\s*\{[^}]*margin:/.test(
      css
    ),
    "the flag in a list row should be spaced from the icon and the name"
  );
  // Stash's `.setting-section .setting > div:last-child { text-align: right }`
  // right-aligns the heading and description of this full-width settings block
  // unless it is explicitly undone. The selector is written twice — once for the
  // page's own level, once for the block's place inside a field's sub-settings —
  // so what is read here is the pair, not just the first.
  assert.ok(
    /\.setting-section\s+\.setting\.manga-tools-settings\s*>\s*div:last-child[^{]*\{[^}]*text-align:\s*left/.test(
      css
    ),
    "the settings block must reset Stash's text-align: right"
  );
  // Stash's `.setting-group .setting { flex-wrap: wrap }` covers the rows on a
  // plugin's page, and with a sub-heading long enough the switch wraps under the
  // text instead of staying beside it. That is a browser's layout engine disagreeing
  // with the DOM stub, so the check is on the stylesheet: the row has to be the one
  // that says `nowrap`, and it has to say it with the class the row actually wears.
  assert.ok(
    /\.setting-section\s+\.setting-group\s+\.setting\.manga-tools-setting\s*\{[^}]*flex-wrap:\s*nowrap/.test(
      css
    ),
    "a settings row must be allowed to keep its switch beside its text: Stash's " +
      "flex-wrap: wrap puts it on a line of its own, and the DOM stub cannot see it"
  );
  // The group's own indent is all that is left of the nesting signal, and the line
  // that used to run down its left edge is gone rather than merely unused: a border
  // left in the file would come back the moment the indent changed.
  const groupRule = /\.manga-tools-settings-group\s*\{([^}]*)\}/.exec(css);
  assert.ok(groupRule, "the settings group should still carry its own indent");
  assert.ok(
    !/border/.test(groupRule[1]),
    "the rule drawn down a group's left edge should be gone — the indent says the " +
      "same thing without making the page read as a table"
  );
  // A group heading that is not a `.setting` is not covered by the rule that puts
  // the rows 2.5rem in, and sat that far to the left of the rows under it.
  assert.ok(
    /\.manga-tools-settings-heading\s*\{[^}]*margin-left:\s*2\.5rem/.test(css),
    "a group heading has to stand where the rows under it stand — Stash indents " +
      "those by 2.5rem, and nothing indents a heading that is not a `.setting`"
  );
  // The help panel: it is in the page whether it is shown or not, and *opening* it
  // is the stylesheet's job — which is why the checks for it are here and not
  // where the panel is rendered (02-settings). Two things can go wrong. It can be
  // hidden with nothing to show it; and the ring can be written in a way that
  // moves what it goes around, which is not a hypothetical: the ring is on the
  // badge, the badge is absolutely positioned in the cover's corner, and a
  // `position` in the ring's rule (or a `position: relative` written for
  // `z-index`'s sake) drops it back into the flow.
  assert.ok(
    /\.manga-tools-help:hover\s+\.manga-tools-help-panel[^{]*\{[^}]*display:\s*block/.test(
      css
    ) && /\.manga-tools-help:focus-within\s+\.manga-tools-help-panel/.test(css),
    "the help panel should open on hover and on focus — the second is what gives " +
      "a keyboard and a finger what a mouse gets"
  );
  const panelRule = /\.manga-tools-help-panel\s*\{([^}]*)\}/.exec(css);
  assert.ok(panelRule, "the help panel needs a rule of its own");
  assert.ok(
    /display:\s*none/.test(panelRule[1]),
    "…and should start hidden, or every ? on the page shows its card at once"
  );
  const ringRule = /\.manga-tools-help-lit\s*\{([^}]*)\}/.exec(css);
  assert.ok(ringRule, "the ring is the whole of what a help panel says");
  assert.ok(
    /outline:\s*2px/.test(ringRule[1]),
    "…and should be drawn with an outline, which is drawn outside the box and " +
      "does not touch the element it goes around"
  );
  assert.ok(
    !/position/.test(ringRule[1]),
    "the ring must not set `position`: the badge it goes around is absolutely " +
      "positioned in the cover's corner, and this would pull it into the flow"
  );
  // The spotlight: the rest of the card pushed back so the ringed part is the
  // only bright thing on it. A shadow with a spread wide enough to cover the card,
  // drawn with the element itself and clipped by the card's own overflow — so
  // there is no overlay element to keep in step, and nothing to go wrong but the
  // one thing asserted here: the shadow is only visible if it is painted over the
  // card's other content, which is what the spread does.
  assert.ok(
    /box-shadow:\s*0 0 0 \d+px rgba\(/.test(ringRule[1]),
    "the part a help panel is about should be spotlit, not just ringed — a card " +
      "with the whole of it at full brightness says less at a glance"
  );
  // …which needs a `position` on the mark's slot, and a z-index above the badge's
  // own (9) or the badge would be the one thing left bright in the mark's panel.
  const slotLitRule =
    /\.manga-tools-popover-slot\.manga-tools-help-lit\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    slotLitRule,
    "the mark's slot needs its own rule for the spotlight — it is a plain span, " +
      "and the ring's own rule cannot carry a `position`"
  );
  assert.ok(
    /position:\s*relative/.test(slotLitRule[1]) &&
      Number(/z-index:\s*(\d+)/.exec(slotLitRule[1])?.[1] ?? 0) > 9,
    "…and it has to sit above the badge's z-index, or the mark's spotlight would " +
      "leave the badge standing out while everything else dimmed"
  );
  // The type. The panel hangs off the "?" inside the setting's `<h3>`, so a
  // heading's own font weight and line-height are inherited by the card unless
  // they are put back — which is a difference you can see and hard to place.
  const exampleCardRule = /\.manga-tools-help-card\s*\{([^}]*)\}/.exec(css);
  assert.ok(exampleCardRule, "the example needs a frame of its own");
  assert.ok(
    /font-weight:\s*normal/.test(exampleCardRule[1]) &&
      /line-height:\s*1\.5/.test(exampleCardRule[1]) &&
      /font-size:\s*1rem/.test(exampleCardRule[1]),
    "the example should not inherit the heading it sits in: without this the " +
      "date and the language on the badge come out heavier and tighter than they " +
      "are on a real card"
  );
  // The performers field is hidden by CSS rather than by not rendering the row —
  // Stash's form keeps the value, so nothing can clear it. That makes this rule
  // the whole of the feature, and its sibling combinator the load-bearing part of
  // it: the mount point carrying the class (set in 8–9b) has to be a sibling that
  // comes before Stash's row, which is where the plugin puts it.
  const performersRule =
    /\.manga-tools-field-host\.hide-performers\s*~\s*\.form-group\[data-field="performer_ids"\]\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(
    performersRule,
    "a manga gallery's edit page should hide the performers field"
  );
  assert.ok(
    /display:\s*none/.test(performersRule[1]),
    "…by taking the field off the page, and not by emptying anything"
  );

  // The language row's suggestion button. The first two are load-bearing rather
  // than cosmetic: the select has to be allowed below the 14rem floor the other
  // rows set, or the button is pushed out of the column on a narrow screen.
  //
  // The button's own look is deliberately absent here — it wears Stash's
  // `btn btn-secondary`, the same as the date field's calendar button, so there
  // is nothing of ours to check beyond what the tests above already assert.
  const chipRowRule = /\.manga-tools-chip-row\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    chipRowRule,
    "the language row should be able to lay its select and its button side by side"
  );
  assert.ok(
    /display:\s*flex/.test(chipRowRule[1]),
    "…by becoming a flex row when it has the button in it"
  );
  assert.ok(
    /\.manga-tools-chip-row\s+\.manga-tools-select\s*\{[^}]*min-width:\s*0/.test(
      css
    ),
    "the select in that row must be allowed below its 14rem floor, or the button is " +
      "pushed out of the column on a narrow screen"
  );
  assert.ok(
    /\.manga-tools-chip-row\s+\.manga-tools-chip\s*\{[^}]*align-self:\s*stretch/.test(
      css
    ),
    "and the button takes the field's height by stretching — which is the only way " +
      "to do it here, since height: 100% resolves against a definite height and " +
      "this row's height is whatever its tallest item turns out to be"
  );
  assert.ok(
    /\.manga-tools-chip-row\s+\.manga-tools-chip\s*\{[^}]*display:\s*inline-flex/.test(
      css
    ),
    "…and lays its own content out as a flex box, so the flag centres in a button " +
      "taller than it is: Bootstrap lays a button's content on a text baseline"
  );
  // The wand, which stands in when the reader has flags turned off. Both of these
  // are forced by code outside this file: Stash's unscoped `.fa-icon` margin, and
  // FontAwesome drawing its glyphs at 1em where the flag it replaces is 0.9rem tall.
  const chipIconRule = /\.manga-tools-chip\s+\.fa-icon\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    chipIconRule && /margin:\s*0/.test(chipIconRule[1]),
    "the wand has to zero Stash's unscoped .fa-icon margin, like the option rows " +
      "and the detail row each do"
  );
  assert.ok(
    chipIconRule && /font-size:\s*0\.9rem/.test(chipIconRule[1]),
    "…and be sized to the flag's height, so flipping the setting does not resize " +
      "the button"
  );

  // The group menu's row: the name at one end and the group's usual language at
  // the other, faintly. Its own class matters as much as what is in it — the
  // language and censorship dropdowns draw `.manga-tools-option`, and the
  // `justify-content` that pushes this flag to the far end would push their icon
  // and label to opposite ends with it.
  const groupOptionRule = /\.manga-tools-group-option\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    groupOptionRule &&
      /justify-content:\s*space-between/.test(groupOptionRule[1]),
    "the group menu's row should put the name and the hint at opposite ends"
  );
  assert.ok(
    /display:\s*flex/.test(groupOptionRule[1]),
    "…as a block-level flex box, so it fills the option and has something to " +
      "space: an inline one is only as wide as its own content"
  );
  const sharedOptionRule = /\.manga-tools-option\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    sharedOptionRule && !/space-between/.test(sharedOptionRule[1]),
    "and the row the other two dropdowns draw must not have been spread — their " +
      "icon belongs beside its label, not across the menu from it"
  );
  assert.ok(
    /\.manga-tools-hint\s*\{[^}]*opacity/.test(css),
    "the hint flag is drawn faint: two dozen rows of solid flags would read as a " +
      "row of flags rather than as a remark"
  );
  // The same hint as a name, for a reader with flags turned off. The clipping is
  // load-bearing: a language name under a long UI locale is far wider than a flag,
  // and the group's own name is what the row is for.
  const hintTextRule = /\.manga-tools-hint-text\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    hintTextRule && /font-size:\s*0\.75rem/.test(hintTextRule[1]),
    "the hint's name is drawn smaller than the group name it sits beside"
  );
  assert.ok(
    hintTextRule && /opacity/.test(hintTextRule[1]),
    "…and faint, so it reads as a remark rather than as a second name"
  );
  assert.ok(
    hintTextRule &&
      /overflow:\s*hidden/.test(hintTextRule[1]) &&
      /text-overflow:\s*ellipsis/.test(hintTextRule[1]) &&
      /white-space:\s*nowrap/.test(hintTextRule[1]),
    "…and it is the hint that gives way when the row runs out of room, never the " +
      "group's name: clipped rather than wrapped, so one long language does not " +
      "make every row in the menu two lines tall"
  );
  // This plugin's own artwork — the manga mark and the two steaks — is masked
  // rather than inlined, and the three files share every declaration but the URL.
  // The sharing is what is asserted: three near-identical rules are how one of
  // them quietly ends up a pixel different from the others.
  const assetIconRule =
    /\.manga-tools-manga-icon,\s*\.manga-tools-raw-icon,\s*\.manga-tools-cooked-icon\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(assetIconRule, "the three masked icons should share one rule");
  assert.ok(
    /mask:\s*var\(--manga-tools-icon\)/.test(assetIconRule[1]) &&
      /background-color:\s*currentColor/.test(assetIconRule[1]),
    "…which masks the file's shape and takes the colour from the text around it"
  );
  for (const name of ["manga", "raw", "cooked"]) {
    assert.ok(
      new RegExp(
        `\\.manga-tools-${name}-icon\\s*\\{[^}]*--manga-tools-icon:\\s*url\\("assets/icons/${name}\\.svg"\\)`
      ).test(css),
      `and .manga-tools-${name}-icon should name its own file, relatively, so it ` +
        "follows the plugin's ID wherever it is installed"
    );
  }
  assert.ok(
    /\.manga-tools-original\s+\.manga-tools-raw-icon[^{]*\{[^}]*width:\s*1\.15em/.test(
      css
    ),
    "the steak is the button's whole content, so it is sized for one rather than " +
      "for a line of text"
  );
  // The group box's statement, at full strength in a disabled control. Two
  // declarations, and the second is the one worth having: a theme may dim a
  // disabled control as a whole, which would undo the colour.
  const statementRule =
    /\.manga-tools-group-select\s+\.react-select__control--is-disabled\s+\.react-select__placeholder\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(
    statementRule && /color:\s*inherit/.test(statementRule[1]),
    "the declaration that a gallery is raw should read in the form's own " +
      "foreground colour, not the grey of a hint about what to type"
  );
  assert.ok(
    statementRule && /opacity:\s*1/.test(statementRule[1]),
    "…and not be dimmed with the rest of the disabled control"
  );
  assert.ok(
    !/^\.react-select__placeholder/m.test(css) &&
      !/\.manga-tools-select\s+\.react-select__placeholder/.test(css),
    "while the ordinary placeholder of all three dropdowns keeps the muted colour " +
      "it should have — the rule must name the state, not just the field"
  );
  console.log(
    "✓ CSS checks (braces / hover / positioning / flag sizing / settings alignment / " +
      "performers / chip / asset icons / the raw statement)"
  );

  // ── 10b. Bundle shape ──────────────────────────────────────────────
  // The plugin is loaded by Stash through a plain <script> tag, so the file has to
  // be a script and has to be self-contained. Both of those are properties of the
  // bundler configuration rather than of the source, which is exactly why they are
  // worth asserting: changing format to "esm" or forgetting bundle: true would
  // still produce a file, and it would only fail in the browser.
  const buildFiles = fs.readdirSync(PLUGIN).filter((f) => f.endsWith(".js"));
  assert.deepStrictEqual(
    buildFiles,
    ["mangaTools.js"],
    "one bundled file, named after the plugin ID — ui.javascript in the yml names this file"
  );

  const bundle = fs.readFileSync(path.join(PLUGIN, "mangaTools.js"), "utf8");
  assert.ok(
    !/^\s*(import|export)[\s{"']/m.test(bundle),
    "the bundle must not contain module syntax — Stash loads it as a plain script"
  );
  assert.ok(
    /React\.createElement/.test(bundle),
    "JSX should have been transformed into React.createElement calls"
  );
  assert.ok(
    /window\.MangaTools\s*=/.test(bundle),
    "languages.ts should be inlined into the bundle, not left as a separate file"
  );

  // The artwork, which is the one thing the bundle cannot inline: `ui.assets` maps
  // `assets/` to a served path, so a file that did not get copied is an icon that
  // draws nothing — and nothing in Stash would say why. The names here are the ones
  // the stylesheet asks for, one per rule.
  for (const name of ["manga", "raw", "cooked"]) {
    assert.ok(
      fs.existsSync(path.join(PLUGIN, "assets", "icons", `${name}.svg`)),
      `dist/ should carry assets/icons/${name}.svg: a served icon that was not ` +
        "packaged is a mask over a 404, which draws an empty box and logs nothing"
    );
  }

  // Both halves' stylesheets, for the same reason as the artwork: ui.css names
  // them one by one, so a file the manifest lists and the build does not copy is a
  // half that draws wrong with a 404 to explain it. Named here rather than read
  // from the yml, so that dropping one from the manifest fails here too.
  for (const name of ["mangaTools.css", "mangaReader.css"]) {
    assert.ok(
      fs.existsSync(path.join(PLUGIN, name)),
      `dist/ should carry ${name}: ui.css in the yml names it`
    );
  }

  // The reader half hides Stash's own chapter button by marking it, not by styling
  // it, so the marking only means anything if this rule shipped. It is checked here
  // because it is the shape of failure the DOM stub cannot see: the test world can
  // read an attribute, and it has no idea whether a browser would hide it — which is
  // exactly how a marked-but-visible button shipped once.
  const readerCss = fs.readFileSync(
    path.join(PLUGIN, "mangaReader.css"),
    "utf8"
  );
  assert.ok(
    /\[data-manga-reader-hidden\]\s*\{[^}]*display:\s*none/.test(readerCss),
    "mangaReader.css should hide what the reader marks with data-manga-reader-hidden: " +
      "the chapters tab's own button is marked, and a mark with no rule behind it hides nothing"
  );

  // The header's options popover, which this plugin places itself: Stash renders its
  // own into the lightbox and moves it there with a library, and this header has no
  // library. So it is positioned from the box it is drawn in, and that box has to be
  // one an absolutely-positioned child can be measured from — without it the popover
  // is measured from the page, and `top: 100%` of a page is below the bottom of the
  // screen. Which is where it went, and why it looked like a menu that did not open.
  assert.ok(
    /\.manga-reader-options-anchor\s*\{[^}]*position:\s*relative/.test(
      readerCss
    ),
    "mangaReader.css should make the options box the popover's own box: measured " +
      "from the page instead, the popover opens below the bottom of it"
  );
  assert.ok(
    /\.manga-reader-chrome \.popover\.show\s*\{[^}]*top:\s*100%/.test(
      readerCss
    ),
    "and should place that popover under the gear that opened it"
  );
  // Under the gear's right edge rather than centred on it. Centred is what Stash's
  // own popover does, and it gets away with it because a library measures it and
  // pushes it back inside the window; this header has none, and the gear is three
  // buttons from the edge of the screen — so a centred panel ran off the right of it.
  // `left: auto` is the line that matters and the one this check was written without:
  // Bootstrap's own `.popover` is `left: 0`, and a box given both a left and a right
  // edge with a width is over-constrained — in a left-to-right language the `right` is
  // the one thrown away. So `right: 0` on its own moved the panel's *left* edge to the
  // gear and sent it further right than the centring it replaced.
  // The semicolons are load-bearing: the rule's own comment explains this placement in
  // prose, and prose that *mentions* `left: auto` would satisfy a looser pattern —
  // which is what happened, and the check went on passing with the declaration gone.
  assert.ok(
    /\.manga-reader-chrome \.popover\.show\s*\{[^}]*left:\s*auto\s*;[^}]*right:\s*0\s*;[^}]*\}/.test(
      readerCss
    ),
    "and should hang it from the gear's own right edge, with the left edge released: " +
      "Bootstrap's own `left: 0` wins over a `right` that is set beside it"
  );
  // …and not by a transform, which is what centring it took. Read out of that one
  // rule rather than off the whole file: the bar's own bubble is centred with the
  // same transform, and it is meant to be.
  const popoverRule =
    /\.manga-reader-chrome \.popover\.show\s*\{([^}]*)\}/.exec(readerCss);
  assert.ok(
    popoverRule && popoverRule[1].indexOf("transform") === -1,
    "…which is to say not centred: anchoring it and shifting it back was what put " +
      "it off the edge of the screen"
  );

  // Above Stash's own chevrons, which are `z-index: 1045` in its lightbox stylesheet
  // and sit over the picture area the menus hang down into. Below them the chevron
  // takes the clicks meant for the row under it — a settings panel that opened and
  // could not be used, because every press on it went to the next-page button.
  assert.ok(
    /\.manga-reader-chrome \.popover\.show,\s*\.manga-reader-chrome \.dropdown-menu\.show\s*\{[^}]*z-index:\s*1050/.test(
      readerCss
    ),
    "both menus should be above the chevrons that overlap them: at 1045 they take " +
      "the clicks, and the panel is there but unusable"
  );

  // The panel's own bottom edge. Every group is a `form-group`, which carries its
  // margin at the bottom — that is the gap *between* one group and the next — so the
  // last one put a strip of nothing under the final switch.
  assert.ok(
    /\.manga-reader-group:last-child\s*\{[^}]*margin-bottom:\s*0/.test(
      readerCss
    ),
    "and the last group should not carry the gap that separates groups"
  );

  // And a group's heading is a *block*. It is a `<span>`, and a vertical margin on an
  // inline box does nothing at all — which is how a spacing change that was made,
  // written down and shipped moved nothing on the screen.
  assert.ok(
    /\.manga-reader-group-label\s*\{[^}]*display:\s*block/.test(readerCss),
    "mangaReader.css should make a group's heading a block: a span is inline, and the " +
      "space under it is a vertical margin, which an inline box has none of"
  );

  // And the space *between* the rows, which is a different rule from the `gap` inside
  // one. Getting that wrong is not hypothetical: the first attempt at this spacing
  // widened the gap — the distance between a row's words and its own switch — and left
  // the rows themselves flush against each other, which is the thing that looked tight.
  // The value is read rather than pattern-matched: the first attempt at this asked for
  // a margin beginning with a nonzero digit, which `0.75rem` does not — a check that
  // failed against the rule it was written for.
  const rowGap =
    /\.manga-reader-row:not\(:last-child\)\s*\{[^}]*margin-bottom:\s*([\d.]+)(?:rem|px)/.exec(
      readerCss
    );
  assert.ok(
    rowGap && Number(rowGap[1]) > 0,
    "mangaReader.css should separate one row from the next, which is a rule of its own " +
      "rather than the gap inside a row"
  );

  // No focus ring left behind by a *click*. Bootstrap draws one on `:focus` — a light
  // blue glow — and a press gives the button the focus it keeps, so the chosen half of
  // the pair came out outlined rather than chosen. `:focus-visible` is the difference
  // between a press and a Tab, and keeping it means the ring still lands for the
  // reader who is moving through the panel with the keyboard.
  // The declaration and not just the selector: a rule whose body was emptied would
  // satisfy a pattern that stopped at the `{`, which is how the previous check of this
  // kind went on passing with the thing it was checking removed.
  for (const control of ["segment", "menu-item"]) {
    assert.ok(
      new RegExp(
        "\\.manga-reader-chrome\\s+\\.manga-reader-" +
          control +
          ":focus:not\\(:focus-visible\\)[^{]*\\{[^}]*box-shadow:\\s*none"
      ).test(readerCss),
      `mangaReader.css should drop the focus ring a click leaves on the ${control}, ` +
        "and keep the one a Tab draws"
    );
  }
  assert.ok(
    /custom-control-input:focus:not\(:focus-visible\)[\s\S]{0,120}box-shadow:\s*none/.test(
      readerCss
    ),
    "…including the switches, whose ring is a shadow on the label's own track"
  );
  // And the same, the other way round, for the pages: the spread is measured from
  // the display it is drawn into, which is what makes it the size of the screen
  // rather than the size of its own contents.
  assert.ok(
    /\.manga-reader-spread\s*\{[^}]*position:\s*absolute/.test(readerCss),
    "mangaReader.css should lay the spread over the display: in the flow it takes " +
      "the width of its pages, and squeezes Stash's own arrows against the edges"
  );

  // The footer, which stays. It carries the image's own name and the link back to
  // the gallery it came from — Stash's to say, not this plugin's to replace — so a
  // rule that hides it is a whole row of the lightbox going missing.
  assert.ok(
    !/\.Lightbox-footer\s*[,{][^}]*display:\s*none/.test(readerCss),
    "mangaReader.css should not hide Stash's footer: the image's name and the way " +
      "back to its gallery are down there"
  );
  // Its left column is a different matter: the O counter and the rating stars are
  // Stash's, and a lightbox that is reading a book does not want them under the
  // reader's thumb. Hidden by their own rule rather than with the column they sit
  // in, which is one of the footer's three equal thirds — an empty third keeps the
  // image's name in the middle of the screen, and a missing one would not.
  assert.ok(
    /\.manga-reader-takeover \.Lightbox-footer-left\s*>\s*\*[^{]*\{[^}]*display:\s*none/.test(
      readerCss
    ),
    "mangaReader.css should hide the footer's rating and O counter, and not the " +
      "column holding them"
  );

  // The progress bar's own row, and the fact that it is a row: a bar positioned over
  // the pages would be a line drawn across the pages, and this plugin takes a strip
  // of the lightbox rather than any part of the picture.
  assert.ok(
    /\.manga-reader-progress\s*\{[^}]*flex-shrink:\s*0/.test(readerCss) &&
      !/\.manga-reader-progress\s*\{[^}]*position:\s*absolute/.test(readerCss),
    "mangaReader.css should lay the bar out as a row of the lightbox rather than " +
      "overlay the pages: the picture is not this plugin's to draw on"
  );
  assert.ok(
    /\.manga-reader-progress-track\s*\{[^}]*max-width:\s*100%/.test(readerCss),
    "and the track should be capped by the row it is in, since its width is measured " +
      "from pages that have not been laid out on the first pass"
  );

  // A chapter's tick is a block of white on the line, drawn inside a box the height of
  // the track: what is seen is inside the bar, and what answers to the pointer is a
  // target the size of the one the line itself offers.
  assert.ok(
    /\.manga-reader-progress-node::before\s*\{[^}]*height:\s*4px/.test(
      readerCss
    ),
    "mangaReader.css should draw a chapter's tick within the height of the line"
  );
  assert.ok(
    /\.manga-reader-progress-node\s*\{[^}]*bottom:\s*0/.test(readerCss),
    "and should give it the whole height of the track to be aimed at"
  );

  // And the pages cut off at the edge of the picture area, which is what keeps a
  // zoom off the header — Stash gets the same cut from its slides' paint containment.
  // Without it the zoomed pages paint over the header and take its clicks, and a
  // click that reaches the pages but not an image is the click that closes the
  // lightbox. Unhittable controls are the one failure a DOM test cannot see: the stub
  // has no hit testing to fail.
  assert.ok(
    /\.manga-reader-takeover \.Lightbox-display[^{]*\{[^}]*overflow:\s*hidden/.test(
      readerCss
    ),
    "mangaReader.css should clip the pages to the display: zoomed, they paint over " +
      "the header, whose buttons are the only way to zoom back out"
  );
  console.log(
    "✓ bundle shape (single script file, self-contained, JSX transformed, artwork shipped)"
  );
};
