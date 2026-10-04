/**
 * The plugin's own artwork: the mark's icon and the two steaks.
 *
 * They are drawn as a CSS mask over a file each (see the `.manga-tools-*-icon`
 * rules in mangaTools.css), and the file is fetched from
 * where Stash serves this plugin's mapped assets — `assetBase`, which is only
 * known once start() has run, so an unset one falls back to the stylesheet's own
 * relative URL rather than drawing nothing.
 *
 * Here rather than in the entry file because the surfaces that draw them are
 * modules of their own: the settings page draws the mark's icon in its help
 * examples, and the edit page and the bulk row draw the steaks.
 */
import { assetBase } from "./core";
import { requirePluginApi } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/**
 * One of the SVG files this plugin ships, drawn as a mask.
 *
 * A span with a mask rather than an `<svg>`: the artwork is a file, shipped as
 * downloaded with its attribution comment intact, and a file cannot see the
 * page's `currentColor` — that only works for markup inlined into the page. A CSS
 * mask reads the shape and ignores the colour, so the file supplies one and
 * `background-color` supplies the other, and a state is a colour rule each. The
 * class names the icon: `.manga-tools-<name>-icon` carries the file, and the
 * declarations they all share are written once in mangaTools.css.
 */
function AssetIcon(props: { file: string; className: string }) {
  // The stylesheet carries a relative URL for this, and it is right whenever
  // plugin files sit under one path. This is the same answer reached from the
  // plugin's own tag instead, which does not depend on that being true — and it is
  // only known after start() has run.
  const style = assetBase
    ? ({
        "--manga-tools-icon": `url("${assetBase}assets/icons/${props.file}")`,
      } as React.CSSProperties)
    : undefined;

  return <span className={props.className} aria-hidden="true" style={style} />;
}

/** The mark's icon — the one that makes a gallery manga. */
export function MangaIcon() {
  return <AssetIcon className="manga-tools-manga-icon" file="manga.svg" />;
}

/**
 * The two steaks: raw, and cooked.
 *
 * The joke is the fandom's — an untranslated work is "raw meat", and what a
 * translation makes of it is that meat cooked. It is worth keeping for a
 * reason beyond the joke: neither file says a word of anybody's language, so the
 * state of the field reads the same whatever Stash's UI is set to. The words go in
 * the button's name and its tooltip, where the reader's language does apply.
 */
export function SteakIcon(props: { raw: boolean }) {
  return props.raw ? (
    <AssetIcon className="manga-tools-raw-icon" file="raw.svg" />
  ) : (
    <AssetIcon className="manga-tools-cooked-icon" file="cooked.svg" />
  );
}
