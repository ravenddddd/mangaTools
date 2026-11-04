/**
 * The icons: five slots, the two kinds of value a slot may hold, and the renderer
 * every surface draws them with.
 *
 * The model is pure and driven directly; the rendering is read off the element
 * tree, which is what the smoke tests' React stub can show — a name becomes a
 * font glyph, an uploaded SVG becomes a mask, and an empty slot becomes nothing.
 */

const assert = require("node:assert");
const { NS, PluginApi, find, runSection } = require("../helpers.js");

module.exports = () => {
  runSection("12 the five icon slots, and what a value may be", () => {
    const defaults = NS.DEFAULT_ICONS;
    assert.deepStrictEqual(
      Object.keys(defaults).sort(),
      ["censored", "cooked", "mark", "raw", "uncensored"],
      "five slots: the mark, the two states of the original text, the two of " +
        "censorship"
    );
    assert.deepStrictEqual(
      [
        defaults.mark,
        defaults.raw,
        defaults.cooked,
        defaults.censored,
        defaults.uncensored,
      ],
      ["m", "font", "language", "chess-board", "regular:square"],
      "and the defaults the dialog shows, in the spelling the site lists"
    );

    // Absent or unreadable reads as the defaults — the same reading every other
    // setting gives a value this build does not know.
    for (const raw of [null, undefined, "", "{not json", "42", '"x"', "[]"]) {
      assert.deepStrictEqual(
        NS.iconsFromJson(raw),
        defaults,
        `absent or unusable (${JSON.stringify(raw)}) reads as the defaults`
      );
    }

    // A written slot wins; an unwritten one keeps its default; a foreign key is
    // ignored. `""` is a value, not an absence — that is the "draw nothing" state.
    assert.deepStrictEqual(
      NS.iconsFromJson(
        JSON.stringify({ mark: "", raw: "crow", bogus: "faAngry" })
      ),
      {
        mark: "",
        raw: "crow",
        cooked: "language",
        censored: "chess-board",
        uncensored: "regular:square",
      },
      'a written slot wins, a missing one keeps its default, and `""` survives'
    );

    // Serialising writes every slot, so an empty one is not read back as absent.
    const cleared = { ...defaults, raw: "" };
    assert.deepStrictEqual(
      NS.iconsFromJson(NS.iconsToJson(cleared)),
      cleared,
      "the cleared slot round-trips instead of reverting to its default"
    );

    assert.deepStrictEqual(NS.parseChoice("regular:faSquare"), {
      style: "regular",
      name: "faSquare",
    });
    assert.deepStrictEqual(NS.parseChoice("faM"), {
      style: "solid",
      name: "faM",
    });
    assert.strictEqual(
      NS.parseChoice("data:image/svg+xml;charset=utf-8,%3Csvg%3E"),
      null,
      "an upload is not a name"
    );
    assert.strictEqual(NS.parseChoice(""), null, "and neither is nothing");
    // Both spellings of a name are accepted: the site lists `chess-board`, the
    // library exports `faChessBoard`, and a reader copies whichever they have.
    for (const typed of [
      "chess-board",
      "faChessBoard",
      "fa-chess-board",
      "ChessBoard",
    ]) {
      assert.deepStrictEqual(
        NS.parseChoice(typed),
        { style: "solid", name: "faChessBoard" },
        `${typed} is the icon the library exports as faChessBoard`
      );
    }
    assert.deepStrictEqual(NS.parseChoice("face-smile"), {
      style: "solid",
      name: "faFaceSmile",
    });
    assert.deepStrictEqual(NS.parseChoice("regular:square"), {
      style: "regular",
      name: "faSquare",
    });

    assert.strictEqual(
      NS.isUpload("data:image/svg+xml;charset=utf-8,%3Csvg%3E"),
      true
    );
    assert.strictEqual(NS.isUpload("faM"), false);
  });

  runSection("12 a value is drawn as a glyph, a mask, or nothing", () => {
    const before = { ...NS.icons };

    try {
      // A Font Awesome name becomes Stash's own Icon, with that definition.
      NS.icons = { ...before, mark: "faFont" };
      const glyph = find(
        NS.slotIcon({ slot: "mark" }),
        (n) => n.type === "Icon"
      );
      assert.strictEqual(
        glyph.props.icon,
        PluginApi.libraries.FontAwesomeSolid.faFont,
        "a solid name draws the solid definition"
      );

      // `regular:` reads the outlined library.
      NS.icons = { ...before, mark: "regular:faSquare" };
      const outlined = find(
        NS.slotIcon({ slot: "mark" }),
        (n) => n.type === "Icon"
      );
      assert.strictEqual(
        outlined.props.icon,
        PluginApi.libraries.FontAwesomeRegular.faSquare,
        "so does a name with the prefix"
      );

      // An uploaded SVG is a mask over the data URI, and takes the text's colour.
      const upload = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E";
      NS.icons = { ...before, mark: upload };
      const drawn = NS.slotIcon({ slot: "mark" });
      const mask = find(drawn, (n) =>
        String(n.props?.className || "")
          .split(" ")
          .includes("is-mask")
      );
      assert.ok(mask, "an upload is drawn as a mask");
      assert.strictEqual(
        mask.props.style["--manga-tools-icon"],
        `url("${upload}")`,
        "…over the data URI the settings hold"
      );

      // An empty slot draws nothing at all — the renderer answers null rather
      // than a placeholder, and the call sites are laid out to take that.
      NS.icons = { ...before, mark: "" };
      assert.strictEqual(
        NS.iconView({ value: "" }),
        null,
        "an empty slot draws nothing"
      );
    } finally {
      NS.icons = before;
    }

    assert.deepStrictEqual(NS.icons, before, "the list in force is put back");
  });

  runSection("12 the settings row and the dialog behind it", () => {
    const row = NS.iconsSetting({ persist: () => {} });
    assert.ok(
      find(row, (n) => n.type === "h3"),
      "the row has a heading"
    );
    assert.ok(
      find(row, (n) => n.type === "Button"),
      "…and a button that opens the dialog"
    );

    const dialog = NS.iconsDialog({ onClose: () => {}, onSave: () => {} });
    const inputs = [];
    find(dialog, (n) => {
      if (n.type === "Control") inputs.push(n);
      return false;
    });
    assert.strictEqual(
      inputs.length,
      5,
      "the dialog draws one name field per slot"
    );
    assert.deepStrictEqual(
      inputs.map((n) => n.props.value),
      [
        NS.icons.mark,
        NS.icons.raw,
        NS.icons.cooked,
        NS.icons.censored,
        NS.icons.uncensored,
      ],
      "each showing the value in force"
    );

    const clears = [];
    find(dialog, (n) => {
      const classes = String(n.props?.className || "").split(" ");
      if (classes.includes("manga-tools-icon-clear")) clears.push(n);
      return false;
    });
    assert.strictEqual(clears.length, 5, "every slot has a clear button");
    assert.strictEqual(
      clears.filter((n) => n.props.disabled === true).length,
      1,
      "the mark's is the one that is disabled: it cannot be empty"
    );
  });
};
