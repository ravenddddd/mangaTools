/**
 * The settings page's shop editor: a row, and the dialog behind it.
 *
 * **The list is data.** The plugin ships four presets (see BUILTIN_SHOPS), and
 * this dialog is where a library changes them: rename a shop, add or remove the
 * domains a link may live on, add the patterns that read its product code, pick
 * an icon. What it edits is a **draft** — the list in force (`NS.shops`) is
 * replaced only when Save is pressed, so Cancel really cancels and a half-typed
 * shop never changes what the edit form recognises.
 *
 * **Identity is the name.** Two shops may not share a name, and no domain may be
 * used twice; those two rules are what the dialog checks, and also what decides
 * whether a built-in can be added again — a preset that keeps a name or a domain
 * in use is greyed out, because adding it would break the same rule the form
 * checks. There is no id to store: an edited preset simply stops matching its
 * preset, and the preset becomes addable again.
 *
 * **The two list fields are Stash's own `StringListInput`, reproduced.** That
 * component is not exposed to plugins, so this is its markup (an `input-group`
 * per row, a grip, a danger minus, and an empty row at the end to type into) with
 * Bootstrap's controls. The order matters for the patterns — the first that
 * captures wins — and is meaningless for the domains, which is why only the
 * patterns carry a drag handle.
 *
 * **Errors follow Stash's forms**: `is-invalid` on the control and a message
 * under it, shown once the field has been touched or Save has been pressed; Save
 * is disabled while any error stands.
 */
import { NS } from "../languages";
import { emit } from "./core";
import { shopIconUrl, shopLetter } from "./shops";
import { numbered, stringFor, t } from "../i18n";
import { requirePluginApi } from "../plugin-api";
import {
  BUILTIN_SHOPS,
  compilePattern,
  domainOwner,
  isValidDomain,
  moveItem,
  nameTaken,
  normalizeDomain,
  type Shop,
} from "./shop-model";

const PluginApi = requirePluginApi();

// The classic JSX transform compiles every element to React.createElement, which
// resolves to this binding; the hooks below use it explicitly as well.
const React = PluginApi.React;

/** A draft nobody else holds: the dialog edits this, and Cancel throws it away. */
function draftOf(shops: Shop[]): Shop[] {
  return shops.map((shop) => ({
    name: shop.name,
    icon: shop.icon,
    domains: shop.domains.slice(),
    regexes: shop.regexes.slice(),
  }));
}

/** One row's messages, by where they are shown. "" means "nothing to say". */
interface RowIssues {
  /** Under the name field */
  name: string;
  /** Under the domain list, when it is empty */
  domains: string;
  /** Per domain row */
  domainAt: string[];
  /** Per pattern row */
  regexAt: string[];
}

/** The messages one row would show, all of them — what is *displayed* is gated. */
function issuesOf(shops: Shop[], index: number, locale: string): RowIssues {
  const shop = shops[index];
  const taken = shop ? nameTaken(shops, shop.name, index) : false;

  const issues: RowIssues = {
    name: !shop?.name.trim()
      ? stringFor(locale, "mangaTools.shops.nameRequired")
      : taken
        ? stringFor(locale, "mangaTools.shops.nameTaken")
        : "",
    domains:
      !shop || shop.domains.length === 0
        ? stringFor(locale, "mangaTools.shops.domainsRequired")
        : "",
    domainAt: [],
    regexAt: [],
  };

  if (shop) {
    issues.domainAt = shop.domains.map((domain) => {
      if (!isValidDomain(domain)) {
        return stringFor(locale, "mangaTools.shops.domainInvalid");
      }
      const owner = domainOwner(shops, domain, index);
      if (!owner) return "";
      return stringFor(locale, "mangaTools.shops.domainTaken").replace(
        "{name}",
        owner.name
      );
    });
    issues.regexAt = shop.regexes.map((source) =>
      source.trim() !== "" && !compilePattern(source)
        ? stringFor(locale, "mangaTools.shops.badPattern")
        : ""
    );
  }

  return issues;
}

function rowHasIssues(issues: RowIssues): boolean {
  return (
    issues.name !== "" ||
    issues.domains !== "" ||
    issues.domainAt.some((message) => message !== "") ||
    issues.regexAt.some((message) => message !== "")
  );
}

/** A counter for tooltip ids: react-bootstrap wants one, and it must be unique. */
let tipSeq = 0;

/**
 * A Bootstrap tooltip around its trigger.
 *
 * Nothing to fall back to: `OverlayTrigger` and `Tooltip` come from the same
 * react-bootstrap module as the Button and Modal this dialog cannot draw without,
 * so a Stash that has those has these. (The smoke test's stand-in has neither, so
 * the guard below draws the bare trigger there.)
 */
function WithTip(props: { text: string; children: React.ReactNode }) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Overlay = Bootstrap ? Bootstrap.OverlayTrigger : null;
  const Tooltip = Bootstrap ? Bootstrap.Tooltip : null;

  if (!Overlay || !Tooltip || !props.text) return <>{props.children}</>;

  tipSeq += 1;
  return (
    <Overlay
      placement="top"
      overlay={<Tooltip id={"manga-tools-tip-" + tipSeq}>{props.text}</Tooltip>}
    >
      {props.children as never}
    </Overlay>
  );
}

/**
 * One string list, in Stash's `StringListInput` shape.
 *
 * The extra row at the end is the way in: typing into it makes a new entry, which
 * is exactly how Stash's own URL and alias lists are filled. `orderable` is false
 * where the order means nothing.
 */
function ListInput(props: {
  /** Prefix for each row's id — one control per row, so one id per row */
  idPrefix: string;
  /** The field's name, for each row's accessible name */
  label: string;
  values: string[];
  placeholder: string;
  orderable: boolean;
  /** Message per row, "" for none; `values.length` is the trailing empty row */
  errors: string[];
  onChange: (next: string[]) => void;
  /** Called when a row is edited, for the touched-gating */
  onEdit?: () => void;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Button = Bootstrap ? Bootstrap.Button : null;
  const Form = Bootstrap ? Bootstrap.Form : null;
  const Control = Form ? Form.Control : null;

  const dragged = React.useState(-1);
  const dragIndex = dragged[0];
  const setDragIndex = dragged[1];

  const values = props.values.concat("");
  // Nothing to reorder with a single entry — the same rule Stash's own
  // `StringListInput` applies before it draws a handle.
  const orderable = props.orderable && props.values.length > 1;

  const setAt = (index: number, value: string) => {
    const next = props.values.slice();
    if (index === props.values.length) {
      if (value.trim() === "") return;
      next.push(value);
    } else {
      next[index] = value;
    }
    props.onChange(next);
    if (props.onEdit) props.onEdit();
  };

  const removeAt = (index: number) => {
    const next = props.values.slice();
    next.splice(index, 1);
    props.onChange(next);
    if (props.onEdit) props.onEdit();
  };

  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || from >= props.values.length) return;
    const next = props.values.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    props.onChange(next);
  };

  return (
    <div className="manga-tools-shop-list">
      {values.map((value, index) => {
        const last = index === values.length - 1;
        const message = props.errors[index] || "";

        return (
          <div
            className="manga-tools-shop-list-row"
            key={index}
            onDragOver={(e: React.DragEvent) => {
              if (dragIndex < 0 || last || dragIndex === index) return;
              e.preventDefault();
              move(dragIndex, index);
              setDragIndex(index);
            }}
          >
            <WithTip text={message}>
              {Control ? (
                <Control
                  id={props.idPrefix + "-" + index}
                  aria-label={props.label}
                  className={"text-input" + (message ? " is-invalid" : "")}
                  value={value}
                  placeholder={last ? props.placeholder : undefined}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAt(index, e.currentTarget.value)
                  }
                  onBlur={() => {
                    if (
                      !last &&
                      value.trim() === "" &&
                      index < props.values.length
                    ) {
                      removeAt(index);
                    }
                  }}
                />
              ) : null}
            </WithTip>
            <div className="manga-tools-shop-list-actions">
              {Button && orderable && !last ? (
                <Button
                  variant="secondary"
                  className="drag-handle minimal"
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(-1)}
                >
                  <PluginApi.components.Icon
                    icon={
                      PluginApi.libraries.FontAwesomeSolid
                        ? PluginApi.libraries.FontAwesomeSolid.faGripVertical
                        : undefined
                    }
                  />
                </Button>
              ) : null}
              {Button ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={last}
                  onClick={() => removeAt(index)}
                >
                  <PluginApi.components.Icon
                    icon={
                      PluginApi.libraries.FontAwesomeSolid
                        ? PluginApi.libraries.FontAwesomeSolid.faMinus
                        : undefined
                    }
                  />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One row of the draft: a stable id, and the shop being edited. */
interface DraftRow {
  id: string;
  shop: Shop;
}

/** Ids are compared and never shown; a counter is enough. */
let rowSeq = 0;

function nextRowId(): string {
  rowSeq += 1;
  return "shop-" + rowSeq;
}

/** A draft row holding a copy of `shop`, so the list can be edited safely. */
function rowOf(shop: Shop): DraftRow {
  return { id: nextRowId(), shop: draftOf([shop])[0] };
}

/**
 * The dialog: the list, the expanded form, the add menu and the footer.
 *
 * Rendered only while open (see ShopsSetting), so the draft is taken once, at
 * mount — `useState`'s initialiser is the copy.
 *
 * **Rows carry an id of their own.** An index is not an identity: deleting one
 * row would move every later row's "touched" mark onto its neighbour, so an
 * error could appear on a row nobody has edited — or not appear on the one that
 * has it. The open row and the row being dragged are named the same way.
 */
export function ShopDialog(props: {
  onClose: () => void;
  onSave: (shops: Shop[]) => void;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;

  const rowsState = React.useState<DraftRow[]>(() =>
    draftOf(NS.shops).map(rowOf)
  );
  const rows = rowsState[0];
  const setRows = rowsState[1];

  const openState = React.useState("");
  const open = openState[0];
  const setOpen = openState[1];

  const touchState = React.useState<{ [id: string]: boolean }>({});
  const touch = touchState[0];
  const setTouch = touchState[1];

  const attemptState = React.useState(false);
  const attempted = attemptState[0];
  const setAttempted = attemptState[1];

  const dragState = React.useState("");
  const dragRow = dragState[0];
  const setDragRow = dragState[1];

  /**
   * Where a drop would land: the row it is on, and which side of its middle.
   *
   * **Reordering happens on drop, not on every drag-over.** Moving the dragged
   * element in the DOM mid-drag makes the browser re-aim the drag at the element
   * now under the pointer, which is the row that just moved — so the list swaps
   * and swaps back on alternate events, and the rows flicker. A thin line over
   * the row that would be split is the whole of the feedback now; the list moves
   * once, when the drop arrives.
   */
  const dropState = React.useState<{ id: string; after: boolean } | null>(null);
  const drop = dropState[0];
  const setDrop = dropState[1];

  /**
   * Set while a row is being dragged, so the click that ends the drag does not
   * open the form. Cleared on the next mouse-down: the press that begins a drag
   * is also a mouse-down on the row, and it comes before `dragstart`, so a real
   * click after a drag clears the flag before the click itself is looked at.
   */
  const afterDrag = React.useRef(false);

  /** The entry elements, by row id, so a newly opened form can be scrolled to. */
  const entries = React.useRef<{ [id: string]: HTMLElement | null }>({});

  const shops = rows.map((row) => row.shop);
  const issues = shops.map((_shop, index) =>
    issuesOf(shops, index, intl.locale)
  );
  const invalid = issues.some(rowHasIssues);

  // A form that opens at the end of a long list is off the screen; a form that
  // opens on a row the reader just clicked is already in view, and `nearest`
  // then does nothing.
  React.useEffect(() => {
    if (!open) return;
    entries.current[open]?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const edit = (id: string, change: (shop: Shop) => Shop) => {
    setRows(
      rows.map((row) =>
        row.id === id ? { ...row, shop: change(row.shop) } : row
      )
    );
    setTouch({ ...touch, [id]: true });
  };

  const addShop = (preset: Shop) => {
    const row = rowOf(preset);
    setRows(rows.concat([row]));
    setOpen(row.id);
  };

  const removeShop = (id: string) => {
    setRows(rows.filter((row) => row.id !== id));
    setOpen("");
  };

  /** Whether a preset could be added: no name clash and no domain clash. */
  const canAdd = (preset: Shop): boolean => {
    if (nameTaken(shops, preset.name, -1)) return false;
    return !preset.domains.some((domain) => domainOwner(shops, domain, -1));
  };

  const Modal = Bootstrap ? Bootstrap.Modal : null;
  if (!Bootstrap || !Modal) return null;

  return (
    <Modal show onHide={props.onClose}>
      <div className="modal-header">
        <span>{t(intl, "mangaTools.shops.title")}</span>
      </div>
      <div className="modal-body">
        {rows.length === 0 ? (
          <p className="manga-tools-shop-empty">
            {t(intl, "mangaTools.shops.empty")}
          </p>
        ) : null}

        {rows.map((row, index) => {
          const shop = row.shop;
          const isOpen = open === row.id;
          const shown =
            attempted || touch[row.id]
              ? issues[index]
              : { name: "", domains: "", domainAt: [], regexAt: [] };

          return (
            <div
              className={
                "manga-tools-shop-entry" +
                (drop && drop.id === row.id
                  ? drop.after
                    ? " drop-after"
                    : " drop-before"
                  : "")
              }
              key={row.id}
              ref={(element: HTMLElement | null) => {
                entries.current[row.id] = element;
              }}
              onDragOver={(e: React.DragEvent) => {
                if (!dragRow || dragRow === row.id) return;
                e.preventDefault();

                const box = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const below = e.clientY > box.top + box.height / 2;

                // **One line per gap.** The lower half of a row and the upper half
                // of the one after it are the same place, so the marker is always
                // "before a row" — only past the last row is it "after" one.
                const next = rows[index + 1];
                const landing =
                  below && next
                    ? { id: next.id, after: false }
                    : { id: row.id, after: below && !next };

                if (
                  !drop ||
                  drop.id !== landing.id ||
                  drop.after !== landing.after
                ) {
                  setDrop(landing);
                }
              }}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                if (!dragRow || !drop || dragRow === drop.id) {
                  setDragRow("");
                  setDrop(null);
                  return;
                }

                const from = rows.findIndex(
                  (candidate) => candidate.id === dragRow
                );
                const target = rows.findIndex(
                  (candidate) => candidate.id === drop.id
                );
                if (from >= 0 && target >= 0) {
                  setRows(moveItem(rows, from, target, drop.after));
                }
                setDragRow("");
                setDrop(null);
              }}
            >
              <div
                className={"manga-tools-shop-row" + (isOpen ? " is-open" : "")}
                role="button"
                tabIndex={0}
                onMouseDown={() => {
                  afterDrag.current = false;
                }}
                onClick={() => {
                  if (afterDrag.current) return;
                  setOpen(isOpen ? "" : row.id);
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(isOpen ? "" : row.id);
                  }
                }}
              >
                <span
                  className="manga-tools-shop-grip"
                  draggable
                  title={t(intl, "mangaTools.shops.reorder")}
                  onDragStart={() => {
                    afterDrag.current = true;
                    // A drag is about the list's order, not about one row's
                    // fields: the open form folds away, so the rows being
                    // reordered are what the drag is drawn on.
                    setOpen("");
                    setDragRow(row.id);
                  }}
                  onDragEnd={() => {
                    setDragRow("");
                    setDrop(null);
                  }}
                >
                  <PluginApi.components.Icon
                    icon={
                      PluginApi.libraries.FontAwesomeSolid
                        ? PluginApi.libraries.FontAwesomeSolid.faGripVertical
                        : undefined
                    }
                  />
                </span>
                <ShopIcon shop={shop} />
                <span className="manga-tools-shop-name">
                  {shop.name.trim() || t(intl, "mangaTools.shops.unnamed")}
                </span>
                {Bootstrap?.Button ? (
                  <Bootstrap.Button
                    variant="danger"
                    size="sm"
                    className="manga-tools-shop-delete"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      removeShop(row.id);
                    }}
                  >
                    {t(intl, "mangaTools.shops.remove")}
                  </Bootstrap.Button>
                ) : null}
              </div>

              {isOpen ? (
                <ShopForm
                  shop={shop}
                  issues={shown}
                  onChange={(change) => edit(row.id, change)}
                  onOpenIcon={() =>
                    pickIcon((icon) =>
                      edit(row.id, (current) => ({ ...current, icon }))
                    )
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="modal-footer">
        <div className="manga-tools-shop-add">
          <AddShopMenu onAdd={addShop} canAdd={canAdd} />
        </div>
        <div>
          <Bootstrap.Button
            className="ml-2"
            variant="secondary"
            onClick={props.onClose}
          >
            {t(intl, "mangaTools.shops.cancel")}
          </Bootstrap.Button>
          <Bootstrap.Button
            className="ml-2"
            variant="primary"
            // Disabled only once a save has been *attempted*, which is the state
            // Stash's own forms end up in: formik has no errors before its first
            // validation, so the button is pressable and pressing it is what shows
            // them. Disabling it from the start would leave a new, empty shop with
            // a grey button and no explanation.
            disabled={invalid && attempted}
            onClick={() => {
              setAttempted(true);
              if (invalid) return;
              // The list as it will be stored: trimmed names and domains in the
              // spelling the matcher compares, so `DLsite.com` and `www.` never
              // reach the settings.
              props.onSave(
                shops.map((shop) => ({
                  name: shop.name.trim(),
                  icon: shop.icon,
                  domains: shop.domains
                    .map(normalizeDomain)
                    .filter((domain) => domain !== ""),
                  regexes: shop.regexes.map((source) => source.trim()),
                }))
              );
            }}
          >
            {t(intl, "mangaTools.shops.save")}
          </Bootstrap.Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Reads an image and answers a 32×32 PNG as a data URI.
 *
 * The settings are one JSON value in Stash's configuration, so an icon has to
 * *be* the bytes: there is no file of the plugin's own it could point at. 32px is
 * enough for both places it is drawn (a 16px head and a 15px badge) and keeps the
 * value to a few kilobytes rather than whatever the user happened to pick.
 */
function iconFromFile(file: File, done: (icon: string) => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      if (!context) {
        done("");
        return;
      }
      // **Cropped, not squashed.** A 16:9 picture drawn into 32×32 comes out
      // stretched; taking the largest centred square out of it keeps the part
      // that reads as an icon and leaves the aspect ratio alone.
      const source = Math.min(image.naturalWidth, image.naturalHeight);
      if (source <= 0) {
        done("");
        return;
      }
      const x = (image.naturalWidth - source) / 2;
      const y = (image.naturalHeight - source) / 2;
      context.drawImage(image, x, y, source, source, 0, 0, 32, 32);
      done(canvas.toDataURL("image/png"));
    };
    image.onerror = () => done("");
    image.src = String(reader.result || "");
  };
  reader.onerror = () => done("");
  reader.readAsDataURL(file);
}

/** Opens the file picker; answers nothing when the picker is cancelled. */
function pickIcon(done: (icon: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    iconFromFile(file, done);
  };
  input.click();
}

/**
 * A shop's icon, or the first letter of its name on the colour that name gives
 * it — the same block the badges and the link-row heads draw.
 */
function ShopIcon(props: { shop: Shop }) {
  const src = shopIconUrl(props.shop);
  if (src) {
    return (
      <img
        className="manga-tools-shop-icon"
        src={src}
        alt=""
        draggable={false}
      />
    );
  }

  const letter = shopLetter(props.shop);
  if (!letter) return null;

  return (
    <span
      className="manga-tools-shop-letter"
      aria-hidden="true"
      style={{ backgroundColor: letter.color }}
    >
      {letter.letter}
    </span>
  );
}

/**
 * "Add a shop": a button in the footer's left corner, and Stash's own popover.
 *
 * The popover is the one Stash draws for "set image" — a `Popover` on a click
 * trigger, one full-width minimal row per action with its icon, and a divider
 * between the two kinds of entry. A built-in that cannot be added (its name or a
 * domain is in use) is a disabled row rather than a hidden one: the list is
 * finite and fixed, and a row that disappears would say nothing about why.
 */
function AddShopMenu(props: {
  onAdd: (shop: Shop) => void;
  canAdd: (preset: Shop) => boolean;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Overlay = Bootstrap ? Bootstrap.Overlay : null;
  const Popover = Bootstrap ? Bootstrap.Popover : null;
  const Content = Popover ? Popover.Content : null;

  // A DOM node rather than the Button itself: react-bootstrap 1.x checks the
  // target with `findDOMNode` for a component, and that is on its way out in the
  // React Stash 0.32 runs. A wrapper span is the element it needs either way.
  const button = React.useRef<HTMLElement | null>(null);
  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];

  if (!Bootstrap?.Button || !Overlay || !Popover || !Content) return null;

  const icon = (glyph: unknown) =>
    glyph ? <PluginApi.components.Icon icon={glyph} /> : null;

  /** A row's action: close the menu first, so a new form does not open under it. */
  const choose = (shop: Shop) => {
    setOpen(false);
    props.onAdd(shop);
  };

  const content = (
    <Popover id="manga-tools-shop-add" className="manga-tools-shop-popover">
      <Content>
        <Bootstrap.Button
          className="minimal"
          onClick={() =>
            choose({ name: "", icon: "", domains: [], regexes: [] })
          }
        >
          {icon(PluginApi.libraries.FontAwesomeSolid?.faPlus)}
          <span>{t(intl, "mangaTools.shops.new")}</span>
        </Bootstrap.Button>
        <div className="manga-tools-shop-menu-divider" />
        <div className="manga-tools-shop-menu-title">
          {t(intl, "mangaTools.shops.builtin")}
        </div>
        {BUILTIN_SHOPS.map((preset) => {
          const allowed = props.canAdd(preset);
          return (
            <Bootstrap.Button
              key={preset.name}
              className="minimal"
              disabled={!allowed}
              onClick={allowed ? () => choose(preset) : undefined}
            >
              <ShopIcon shop={preset} />
              <span>{preset.name}</span>
            </Bootstrap.Button>
          );
        })}
      </Content>
    </Popover>
  );

  return (
    <>
      <span ref={button}>
        <Bootstrap.Button variant="secondary" onClick={() => setOpen(!open)}>
          {t(intl, "mangaTools.shops.add")}
        </Bootstrap.Button>
      </span>
      {open && button.current ? (
        <Overlay
          target={button.current}
          show
          onHide={() => setOpen(false)}
          rootClose
          placement="top"
        >
          {content}
        </Overlay>
      ) : null}
    </>
  );
}

/** The expanded form of one shop, in Stash's own form layout. */
function ShopForm(props: {
  shop: Shop;
  issues: RowIssues;
  onChange: (change: (shop: Shop) => Shop) => void;
  onOpenIcon: () => void;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Form = Bootstrap ? Bootstrap.Form : null;
  const Control = Form ? Form.Control : null;
  const Group = Form ? Form.Group : null;
  const Label = Form ? Form.Label : null;
  const Col = Bootstrap ? Bootstrap.Col : null;
  const src = shopIconUrl(props.shop);

  /**
   * One row, laid out the way Stash lays out its own: a `form-group row` with a
   * `col-form-label` on the left and the control in a column on the right (see
   * Stash's `renderField`). Not the plugin's own grid, because a label drawn by
   * this plugin looks nearly — and next to Stash's rows, wrongly — like Stash's.
   */
  /**
   * One row, laid out the way Stash lays out its own.
   *
   * `controlId` only where there is exactly one control to name — react-bootstrap
   * hands the id down through context, so a group holding several controls gives
   * them all the same id (React's "Duplicate form field id") and a group holding
   * none leaves the label pointing at nothing (Chrome's "Incorrect use of
   * <label for>"). The list rows carry their own ids and accessible names.
   */
  const field = (
    controlId: string,
    label: React.ReactNode,
    control: React.ReactNode
  ) =>
    Group && Label && Col ? (
      <Group
        as={Bootstrap ? Bootstrap.Row : undefined}
        controlId={controlId || undefined}
      >
        <Label column sm={3}>
          {label}
        </Label>
        <Col sm={9}>{control}</Col>
      </Group>
    ) : (
      control
    );

  return (
    <div className="manga-tools-shop-form">
      {field(
        "manga-tools-shop-name",
        t(intl, "mangaTools.shops.name"),
        <>
          {Control ? (
            <Control
              className={
                "text-input" + (props.issues.name ? " is-invalid" : "")
              }
              value={props.shop.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                props.onChange((shop) => ({
                  ...shop,
                  name: e.currentTarget.value,
                }))
              }
            />
          ) : null}
          {props.issues.name ? (
            <div className="invalid-feedback d-block">{props.issues.name}</div>
          ) : null}
        </>
      )}

      {field(
        "",
        t(intl, "mangaTools.shops.domains"),
        <>
          <ListInput
            idPrefix="manga-tools-shop-domain"
            label={t(intl, "mangaTools.shops.domains")}
            values={props.shop.domains}
            placeholder={t(intl, "mangaTools.shops.domainPlaceholder")}
            orderable
            errors={props.issues.domainAt}
            onChange={(domains) =>
              props.onChange((shop) => ({ ...shop, domains }))
            }
          />
          {props.issues.domains ? (
            <div className="invalid-feedback d-block">
              {props.issues.domains}
            </div>
          ) : null}
        </>
      )}

      {field(
        "",
        <>
          {t(intl, "mangaTools.shops.regexes")}
          <WithTip text={t(intl, "mangaTools.shops.regexHelp")}>
            <span className="manga-tools-help">
              <button
                type="button"
                className="manga-tools-help-button"
                aria-label={t(intl, "mangaTools.shops.regexHelp")}
              >
                {PluginApi.libraries.FontAwesomeSolid?.faQuestionCircle ? (
                  <PluginApi.components.Icon
                    icon={PluginApi.libraries.FontAwesomeSolid.faQuestionCircle}
                  />
                ) : (
                  "?"
                )}
              </button>
            </span>
          </WithTip>
        </>,
        <ListInput
          idPrefix="manga-tools-shop-regex"
          label={t(intl, "mangaTools.shops.regexes")}
          values={props.shop.regexes}
          placeholder={t(intl, "mangaTools.shops.regexPlaceholder")}
          orderable
          errors={props.issues.regexAt}
          onChange={(regexes) =>
            props.onChange((shop) => ({ ...shop, regexes }))
          }
        />
      )}

      {field(
        "",
        t(intl, "mangaTools.shops.icon"),
        <div className="manga-tools-shop-icon-row">
          <ShopIcon shop={props.shop} />
          {Bootstrap?.Button ? (
            <Bootstrap.Button variant="secondary" onClick={props.onOpenIcon}>
              {t(intl, "mangaTools.shops.pickIcon")}
            </Bootstrap.Button>
          ) : null}
          {src && Bootstrap?.Button ? (
            <Bootstrap.Button
              variant="secondary"
              onClick={() => props.onChange((shop) => ({ ...shop, icon: "" }))}
            >
              {t(intl, "mangaTools.shops.clearIcon")}
            </Bootstrap.Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The row on the settings page: what the list is, how many, and the way in.
 *
 * A row rather than a switch: the shop list is not something to turn on and off
 * — that is the switch above it — and the dialog is where the list changes.
 */
export function ShopsSetting(props: { persist: () => void }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;

  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];

  return (
    <>
      <div className="setting manga-tools-setting">
        <div>
          <h3>
            {numbered(
              intl.locale,
              "mangaTools.settings.shops.titleWithCount",
              NS.shops.length
            )}
          </h3>
        </div>
        <div>
          {Bootstrap ? (
            <Bootstrap.Button variant="secondary" onClick={() => setOpen(true)}>
              {t(intl, "mangaTools.shops.edit")}
            </Bootstrap.Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <ShopDialog
          onClose={() => setOpen(false)}
          onSave={(shops) => {
            NS.shops = shops;
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
NS.shopsSetting = ShopsSetting;
NS.shopDialog = ShopDialog;
NS.shopIssues = issuesOf;
