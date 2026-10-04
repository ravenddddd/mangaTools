/**
 * The manga block in the details tab, and the boundary that keeps it from taking
 * the page with it.
 *
 * The gallery's manga attributes, as a collapsible block in the details tab — a
 * disclosure rather than a tab this plugin injects into Stash's tab bar: it owns
 * its own open state and nothing else's, which is the entire difference — a tab
 * would have to agree with react-bootstrap about which tab is active, and that is
 * what made the first attempt at this too fragile to keep. It portals itself in at
 * the end of `.gallery-details`, which lands after "photographer" and before
 * "details".
 *
 * What reaches it is the CustomFields patch in index.tsx: the one patchable
 * component on that page with the gallery's custom fields in hand. A row is drawn
 * for a value that is set and whose field is on, and the whole block is dropped
 * when there is nothing to say — see MangaDetailsPanel.
 *
 * guardedBlock is here rather than in patches.ts because it has exactly one
 * caller, the block below. What makes it lazy is about this half's load, which is
 * the block's business as well.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { CensorshipIcon } from "./censorship";
import { Flag } from "./fields-ui";
import { fieldLabel } from "./filter-model";
import { ensureDetailHost } from "./hosts";
import { censorshipOf, pickLanguage, useGlobalVersion } from "./core";
import type { CustomFieldsMap } from "./core";
import { requirePluginApi } from "../plugin-api";
import type { ReactNode } from "react";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. The uses of it below are
// explicit — React.Component, React.useState, ReactDOM — so the linter sees this
// one; a module whose only use is JSX needs the ignore fields-ui.tsx carries.
const React = PluginApi.React;

/**
 * Renders nothing rather than taking the page with it, and says so.
 *
 * For the block this plugin adds to the details tab, so that a mistake in it
 * costs one section rather than the whole page: React 17 answers a throw inside a
 * render by unmounting the tree, which is what left the app sitting on "Loading"
 * while this was being built. A boundary turns that into a log line naming the
 * block.
 *
 * Built on first use rather than where it is written, and that is about the
 * bundle rather than about React. A class body is evaluated where it stands, so
 * `extends React.Component` resolves the API *while the file loads* — and this
 * half shares a bundle with the reader's, whose half must not be taken down by
 * anything that happens during this one's load. Inside a render, a throw costs
 * one block; at load it costs both halves.
 */
export type GuardedBlockProps = { name: string; children?: ReactNode };
export type GuardedBlockState = { failed: boolean };

let guardedBlockClass: React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> | null = null;

/** The error boundary, made once and reused. Call it from inside a render. */
export function guardedBlock(): React.ComponentClass<
  GuardedBlockProps,
  GuardedBlockState
> {
  if (guardedBlockClass) return guardedBlockClass;

  guardedBlockClass = class extends (
    React.Component<GuardedBlockProps, GuardedBlockState>
  ) {
    state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error: unknown) {
      console.error(
        "[mangaTools] the " +
          this.props.name +
          " threw while rendering, so it is " +
          "not on the page. Everything else the plugin does is unaffected.",
        error
      );
    }

    render() {
      return this.state.failed ? null : this.props.children;
    }
  };

  return guardedBlockClass;
}

/**
 * The gallery's manga attributes, as labelled rows.
 *
 * A row is drawn only when its value is set — an unset one is simply absent,
 * the same way the rest of the plugin keeps an unset value quiet. With no value
 * at all the whole panel is dropped, since a fold whose only content is its own
 * heading is not worth a line.
 */
export function MangaDetailsPanel(props: { values: CustomFieldsMap }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const state = React.useState(NS.openDetailsBlock);
  const open = state[0];
  const setOpen = state[1];

  // Each value is read only if its field is drawn, so a field that is off cannot
  // reach the panel through the back door — a row whose value happens to be set on
  // the gallery is exactly what "turned off" has to hide. What it does not do is
  // touch the gallery: the values stay where they are, and turning the field back
  // on brings them back.
  const language = NS.fieldShowing("language")
    ? NS.describe(pickLanguage(props.values), intl.locale)
    : null;
  const mark = NS.fieldShowing("censorship") ? censorshipOf(props.values) : "";
  const group = NS.fieldShowing("translationGroup")
    ? NS.translationGroupOf(props.values)
    : "";
  const original = NS.fieldShowing("original") && NS.isOriginal(props.values);
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;
  const Collapse = PluginApi.libraries.Bootstrap?.Collapse;

  // Nothing set means nothing to say: with none of the four set the whole panel
  // is dropped, rather than left as an empty fold with only its heading. The same
  // test answers "are there any fields at all": with every one of them turned off
  // none of the four can be set, so the panel drops without a second question.
  if (!language && !mark && !group && !original) return null;

  // The same mount point the plain language row used: the end of .gallery-details,
  // which lands after "photographer" and before "details".
  const host = ensureDetailHost();
  if (!host) return null;

  // The flag and the space before the name are conditional, and both for the same
  // reason: an unknown value has no flag, and a row that always put a space there
  // would read "Language:  klingon".
  const showFlag = NS.showFlags && !!language?.flag;

  // Two <h6>s, exactly as the rows above and below are drawn — the pieces are
  // separate children rather than a label and a value in a wrapper, so the text
  // nodes come out the way Stash's own rows produce them. Each is drawn only
  // when its value is set.
  //
  // The censorship row comes first, then the language, then the group: the
  // censorship is about the copy in hand — what was or was not done to the scans —
  // and the other two are about where the text came from. The raw mark is not a
  // row at all: it rides on the language, when there is one.
  const body = (
    <div className="manga-tools-panel-body">
      {mark ? (
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.censorship.heading") + ": "}
          <CensorshipIcon value={mark} />
          {mark ? " " : null}
          {NS.censorshipLabel(intl, mark)}
        </h6>
      ) : null}
      {language ? (
        <h6 className="manga-tools-detail">
          {fieldLabel(intl) + ": "}
          {showFlag ? (
            <Flag flag={language.flag as string} className="manga-tools-flag" />
          ) : null}
          {showFlag ? " " : null}
          {language.name}
          {/*
            The raw mark rides on this row rather than having one of its own. It
            answers a question about the language — the text is in it, untranslated
            — and as a row of its own under the *group's* label it read like a group
            called "raw", which is the reading this field exists to avoid.

            The space in front of it is part of the string, not a text node of its
            own like the flag's: English wants one before a bracket and Chinese
            takes none, so the catalog is where that difference belongs.
          */}
          {original
            ? t(intl, "mangaTools.translationGroup.originalInline")
            : null}
        </h6>
      ) : null}
      {group ? (
        // No icon and no flag: a group's name is its own, and there is nothing
        // here to draw beside it. Drawn last, because it is the one row that is
        // the same shape on every gallery rather than picked from a list.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.heading") + ": "}
          {group}
        </h6>
      ) : null}
      {original && !language ? (
        // Raw with no language row to carry the mark, so it stands on its own —
        // and without the group's label, for the reason above. The wording carries
        // the rest: a bare "原文" under that label would read like a group called
        // that, which is why the string says what it does.
        //
        // "No language row" rather than "no language set": with the language field
        // turned off there is no row to ride on whatever the gallery holds, and a
        // raw mark with no way of being shown is worse than one shown plainly.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.originalDetail")}
        </h6>
      ) : null}
    </div>
  );

  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      {/*
        Stash's own collapsible section, reproduced rather than invented: the
        classes are `components/Shared/CollapseButton.tsx`'s, and its stylesheet is
        what makes this look like the rest of the page. `minimal` is the class
        that gives a button the page's text colour — without it a bare <button>
        keeps the browser's own, which is black whatever the theme.
      */}
      <div className="collapse-header">
        {Button ? (
          <Button
            className="minimal collapse-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              icon={open ? Solid.faChevronDown : Solid.faChevronRight}
              fixedWidth
            />
            <span>{t(intl, "mangaTools.panel.heading")}</span>
          </Button>
        ) : null}
      </div>

      {/* With no Bootstrap at all the body simply shows — degraded, not hidden. */}
      {Collapse ? <Collapse in={open}>{body}</Collapse> : body}
    </div>,
    host
  );
}
