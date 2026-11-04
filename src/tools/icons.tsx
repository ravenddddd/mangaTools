/**
 * The five icons the settings page lets a reader choose, drawn.
 *
 * **One renderer for two kinds of picture.** A slot holds either a Font Awesome
 * name or an uploaded SVG, and every surface draws it the same way: a 1em box
 * that takes the surrounding colour, with a font glyph or a mask inside it. The
 * mask is how the uploaded file is coloured — the file supplies the shape and
 * `background-color` supplies the colour, which is also what makes an SVG safe to
 * accept: a mask is an image, and an image cannot run script.
 *
 * The current values live in `NS.icons`, refreshed with the rest of the settings,
 * so a change made in the dialog reaches every surface on the next redraw.
 */
import { NS } from "../languages";
import { requirePluginApi } from "../plugin-api";
import {
  DEFAULT_ICONS,
  isUpload,
  parseChoice,
  type IconSlot,
} from "./icon-model";

const PluginApi = requirePluginApi();

// The classic JSX transform compiles every element to React.createElement, which
// resolves to this binding; the inline style below uses it by name as well.
const React = PluginApi.React;

/** Names already reported, so a page of galleries does not print a page of logs. */
const missingNames: { [name: string]: boolean } = {};

function noteMissingName(name: string): void {
  if (missingNames[name]) return;
  missingNames[name] = true;
  console.error(
    "[mangaTools] this Stash's FontAwesome has no " +
      name +
      ", so that icon is drawn as nothing. Check the name on the settings page's " +
      "icons dialog."
  );
}

/**
 * The Font Awesome definition for a stored value, or null when there is none.
 *
 * `quiet` skips the console line: the editor asks this on every keystroke while a
 * name is being typed, and a name that is half-typed is not a library missing a
 * glyph worth reporting.
 */
export function iconDefinition(value: string, quiet = false): unknown {
  const choice = parseChoice(value);
  if (!choice) return null;

  const library =
    choice.style === "regular"
      ? PluginApi.libraries.FontAwesomeRegular
      : PluginApi.libraries.FontAwesomeSolid;
  const icon = library ? library[choice.name] : undefined;
  if (!icon) {
    if (!quiet) noteMissingName(value);
    return null;
  }
  return icon;
}

/**
 * One value drawn, in a 1em box — or nothing at all when the value is empty.
 *
 * Takes the value rather than a slot, so the editor's preview can draw the draft
 * it is showing without touching what is in force.
 */
export function IconView(props: { value: string; className?: string }) {
  const value = props.value;
  if (!value) return null;

  const className =
    "manga-tools-slot-icon" + (props.className ? " " + props.className : "");

  if (isUpload(value)) {
    return (
      <span
        className={className + " is-mask"}
        aria-hidden="true"
        style={
          { "--manga-tools-icon": `url("${value}")` } as React.CSSProperties
        }
      />
    );
  }

  const Icon = PluginApi.components.Icon;
  const icon = iconDefinition(value);
  if (!Icon || !icon) return null;

  return (
    <span className={className} aria-hidden="true">
      <Icon icon={icon} />
    </span>
  );
}

/**
 * One slot's icon as it is in force — or nothing at all when the slot is empty.
 *
 * Nothing rather than a placeholder: an empty slot is a choice the reader made,
 * and the call sites are laid out so that a missing icon costs a gap, not a
 * layout.
 */
export function SlotIcon(props: { slot: IconSlot; className?: string }) {
  const value = NS.icons[props.slot];

  // A name this Stash does not have falls back to the slot's default rather than
  // disappearing: the editor refuses such a name, so a stored one came from a
  // hand-edited config, and the default is what that slot is supposed to look
  // like. `""` is not that case — it is the reader's own choice to draw nothing.
  const broken = !!value && !isUpload(value) && !iconDefinition(value);

  return (
    <IconView
      value={broken ? DEFAULT_ICONS[props.slot] : value}
      className={props.className}
    />
  );
}

/**
 * The mark — the one that makes a gallery manga.
 *
 * The class is kept for the stylesheet and the tests: it says which slot this is
 * on the surfaces that draw more than one icon.
 */
export function MangaIcon() {
  return <SlotIcon slot="mark" className="manga-tools-manga-icon" />;
}

// Published for the smoke test, which reaches the tools half through the window.
NS.slotIcon = SlotIcon;
NS.iconView = IconView;

/** The two states of the original text: as written, and translated. */
export function SteakIcon(props: { raw: boolean }) {
  return (
    <SlotIcon
      slot={props.raw ? "raw" : "cooked"}
      className={props.raw ? "manga-tools-raw-icon" : "manga-tools-cooked-icon"}
    />
  );
}
