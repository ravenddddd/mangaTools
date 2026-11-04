/**
 * The icons dialog: five slots, one row each, and the rules that keep a value
 * readable.
 *
 * **A row on the settings page and a dialog behind it**, not five rows inline:
 * what a reader changes here is rare, and each row is a name, a preview and three
 * buttons — too much furniture for a settings page that is already long.
 *
 * **Two sources per slot.** A Font Awesome name typed into the field (solid, or
 * `regular:` for the outlined set — brands are not offered), or an SVG uploaded
 * and kept in the settings as a data URI. The editor checks a typed name against
 * the very library Stash hands the plugin, so a name that would draw nothing is
 * refused here rather than discovered later on a card.
 *
 * **The mark cannot be emptied.** A gallery's "is this manga" toggle with nothing
 * drawn is a control nobody can find, so its row keeps the clear button, disabled.
 * Every other slot may hold `""`, which means exactly that: nothing is drawn, and
 * it stays that way — an empty value is never replaced by the default.
 */
import { NS } from "../languages";
import { emit } from "./core";
import { t } from "../i18n";
import { IconView, iconDefinition } from "./icons";
import {
  DEFAULT_ICONS,
  ICON_SLOTS,
  ICON_SUGGESTIONS,
  iconsFromJson,
  iconsToJson,
  isUpload,
  parseChoice,
  type IconSlot,
} from "./icon-model";
import { requirePluginApi } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** The largest SVG the settings will carry, in bytes of source. */
const MAX_SVG = 64 * 1024;

/** The message id for one slot's name in the dialog */
const LABEL_OF: { [slot in IconSlot]: string } = {
  mark: "mangaTools.icons.mark",
  raw: "mangaTools.icons.raw",
  cooked: "mangaTools.icons.cooked",
  censored: "mangaTools.icons.censored",
  uncensored: "mangaTools.icons.uncensored",
};

/** The three blocks of the dialog, each with the slots it holds. */
const BLOCKS: {
  heading: string;
  slots: { slot: IconSlot; label: string }[];
}[] = [
  { heading: "mangaTools.icons.mark", slots: [{ slot: "mark", label: "" }] },
  {
    heading: "mangaTools.icons.rawHeading",
    slots: [
      { slot: "raw", label: "mangaTools.icons.raw" },
      { slot: "cooked", label: "mangaTools.icons.cooked" },
    ],
  },
  {
    heading: "mangaTools.icons.censorshipHeading",
    slots: [
      { slot: "censored", label: "mangaTools.icons.censored" },
      { slot: "uncensored", label: "mangaTools.icons.uncensored" },
    ],
  },
];

/**
 * Reads an SVG file and answers it as a data URI, or null when it is not one this
 * dialog will keep.
 *
 * The text is what gets encoded, not base64: `encodeURIComponent` on source is
 * smaller than base64 for typical SVGs, and the mask reads it either way.
 */
function svgDataUri(
  file: File,
  done: (value: string | null, tooLarge: boolean) => void
): void {
  if (file.size > MAX_SVG) {
    done(null, true);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    if (!/<svg[\s>]/i.test(text)) {
      done(null, false);
      return;
    }
    done("data:image/svg+xml;charset=utf-8," + encodeURIComponent(text), false);
  };
  reader.onerror = () => done(null, false);
  reader.readAsText(file);
}

/** Opens the file picker for one slot. */
function pickSvg(
  done: (value: string | null, tooLarge: boolean) => void
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,image/svg+xml";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) svgDataUri(file, done);
  };
  input.click();
}

/** One row: preview, name, upload, suggestions and the clear button. */
function IconLine(props: {
  slot: IconSlot;
  label: string;
  value: string;
  problem: string;
  onChange: (next: string) => void;
  onProblem: (message: string) => void;
  onClear: () => void;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Form = Bootstrap ? Bootstrap.Form : null;
  const Control = Form ? Form.Control : null;

  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];

  const button = React.useRef<HTMLElement | null>(null);
  const Overlay = Bootstrap ? Bootstrap.Overlay : null;
  const Popover = Bootstrap ? Bootstrap.Popover : null;
  const Content = Popover ? Popover.Content : null;

  const Button = Bootstrap ? Bootstrap.Button : null;

  const upload = isUpload(props.value);

  const suggestions =
    Overlay && Popover && Content && Button ? (
      <Popover
        id={"manga-tools-icons-" + props.slot}
        className="manga-tools-popover"
      >
        <Content>
          <div className="manga-tools-shop-menu-title">
            {t(intl, "mangaTools.icons.suggestions")}
          </div>
          {ICON_SUGGESTIONS[props.slot].map((name) => (
            <Button
              key={name}
              className="minimal"
              onClick={() => {
                setOpen(false);
                props.onChange(name);
              }}
            >
              <IconView value={name} />
              <span>{name}</span>
            </Button>
          ))}
        </Content>
      </Popover>
    ) : null;

  return (
    <div className="manga-tools-icon-line-wrap">
      <div className="manga-tools-icon-line">
        <span className="manga-tools-icon-name">{props.label}</span>
        <span className="manga-tools-icon-preview">
          <IconView value={props.value} />
        </span>
        {Control ? (
          <Control
            className={"text-input" + (props.problem ? " is-invalid" : "")}
            value={upload ? "" : props.value}
            placeholder={
              upload
                ? t(intl, "mangaTools.icons.svg")
                : t(
                    intl,
                    props.slot === "mark"
                      ? "mangaTools.icons.markHint"
                      : "mangaTools.icons.emptyHint"
                  )
            }
            aria-label={t(intl, LABEL_OF[props.slot])}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              props.onChange(e.currentTarget.value)
            }
          />
        ) : null}
        {Bootstrap?.Button ? (
          <Bootstrap.Button
            variant="secondary"
            onClick={() =>
              pickSvg((value, tooLarge) => {
                if (value) {
                  props.onProblem("");
                  props.onChange(value);
                  return;
                }
                props.onProblem(
                  tooLarge
                    ? t(intl, "mangaTools.icons.tooLarge")
                    : t(intl, "mangaTools.icons.notSvg")
                );
              })
            }
          >
            {t(intl, "mangaTools.icons.upload")}
          </Bootstrap.Button>
        ) : null}
        {suggestions && Button ? (
          <>
            <span ref={button}>
              <Button variant="secondary" onClick={() => setOpen(!open)}>
                {t(intl, "mangaTools.icons.suggestions")}
              </Button>
            </span>
            {Overlay && button.current ? (
              <Overlay
                target={button.current}
                show={open}
                onHide={() => setOpen(false)}
                rootClose
                placement="bottom"
              >
                {suggestions}
              </Overlay>
            ) : null}
          </>
        ) : null}
        {Bootstrap?.Button ? (
          <Bootstrap.Button
            variant="secondary"
            className="manga-tools-icon-clear"
            disabled={props.slot === "mark"}
            title={
              props.slot === "mark"
                ? t(intl, "mangaTools.icons.markRequired")
                : t(intl, "mangaTools.icons.clear")
            }
            onClick={props.onClear}
          >
            <PluginApi.components.Icon
              icon={PluginApi.libraries.FontAwesomeSolid?.faTrashCan}
            />
          </Bootstrap.Button>
        ) : null}
      </div>
      {props.problem ? (
        <div className="invalid-feedback d-block">{props.problem}</div>
      ) : null}
    </div>
  );
}

/** The dialog itself: three blocks, five rows, save on the footer. */
export function IconsDialog(props: {
  onClose: () => void;
  onSave: (icons: { [slot: string]: string }) => void;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;

  const draftState = React.useState<{ [slot: string]: string }>(() => ({
    ...DEFAULT_ICONS,
    ...NS.icons,
  }));
  const draft = draftState[0];
  const setDraft = draftState[1];

  /** A refused upload's message, per slot, until the row is edited again */
  const problemsState = React.useState<{ [slot: string]: string }>({});
  const problems = problemsState[0];
  const setProblems = problemsState[1];

  /**
   * What is wrong with a slot's value, as a message: a name Stash does not have,
   * an upload that was refused, or the mark left empty.
   */
  const problemOf = (slot: IconSlot): string => {
    if (problems[slot]) return problems[slot];

    const value = draft[slot] || "";
    if (!value) {
      return slot === "mark" ? t(intl, "mangaTools.icons.markRequired") : "";
    }
    if (isUpload(value)) return "";
    return iconDefinition(value, true)
      ? ""
      : t(intl, "mangaTools.icons.badName");
  };

  const broken = ICON_SLOTS.some((slot) => problemOf(slot) !== "");

  const Modal = Bootstrap ? Bootstrap.Modal : null;
  if (!Bootstrap || !Modal) return null;

  // Wide, unlike the other dialogs: five rows of six controls each need the room,
  // and a row that wraps is a row whose buttons read as two controls apiece.
  return (
    <Modal show size="lg" onHide={props.onClose}>
      <div className="modal-header">
        <span>{t(intl, "mangaTools.icons.title")}</span>
      </div>
      <div className="modal-body">
        <p>
          {t(intl, "mangaTools.icons.noteBefore")}
          <a
            href="https://fontawesome.com/free"
            target="_blank"
            rel="noreferrer"
          >
            Font Awesome Free
          </a>
          {t(intl, "mangaTools.icons.noteAfter")}
        </p>
        {BLOCKS.map((block) => (
          <div className="manga-tools-icon-block" key={block.heading}>
            <h3>{t(intl, block.heading)}</h3>
            <div className="manga-tools-icon-lines">
              {block.slots.map((line) => (
                <IconLine
                  key={line.slot}
                  slot={line.slot}
                  label={line.label ? t(intl, line.label) : ""}
                  value={draft[line.slot] || ""}
                  problem={problemOf(line.slot)}
                  onChange={(next) => {
                    setProblems({ ...problems, [line.slot]: "" });
                    setDraft({ ...draft, [line.slot]: next });
                  }}
                  onProblem={(message) =>
                    setProblems({ ...problems, [line.slot]: message })
                  }
                  onClear={() => {
                    setProblems({ ...problems, [line.slot]: "" });
                    setDraft({ ...draft, [line.slot]: "" });
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <div />
        <div>
          <Bootstrap.Button
            className="ml-2"
            variant="secondary"
            onClick={props.onClose}
          >
            {t(intl, "mangaTools.icons.cancel")}
          </Bootstrap.Button>
          <Bootstrap.Button
            className="ml-2"
            variant="primary"
            disabled={broken}
            onClick={() => props.onSave(draft)}
          >
            {t(intl, "mangaTools.icons.save")}
          </Bootstrap.Button>
        </div>
      </div>
    </Modal>
  );
}

/** The settings row that opens the dialog. */
export function IconsSetting(props: { persist: () => void }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;

  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];

  return (
    <>
      <div className="setting manga-tools-setting">
        <div>
          <h3>{t(intl, "mangaTools.icons.heading")}</h3>
        </div>
        <div>
          {Bootstrap ? (
            <Bootstrap.Button variant="secondary" onClick={() => setOpen(true)}>
              {t(intl, "mangaTools.icons.edit")}
            </Bootstrap.Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <IconsDialog
          onClose={() => setOpen(false)}
          onSave={(icons) => {
            NS.icons = icons as never;
            emit();
            props.persist();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

// Published for the smoke test, which reaches the tools half through the window.
NS.iconsSetting = IconsSetting;
NS.iconsDialog = IconsDialog;
NS.iconsFromJson = iconsFromJson;
NS.iconsToJson = iconsToJson;
NS.DEFAULT_ICONS = DEFAULT_ICONS;
NS.parseChoice = parseChoice;
NS.isUpload = isUpload;
