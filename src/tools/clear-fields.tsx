/**
 * The settings page's "remove the plugin's fields" row, and the dialog behind it.
 *
 * **It queues a task; it does not do the work.** Removing this plugin's fields from
 * a library is hundreds of mutations, and a page that ran them itself would have to
 * stay open for the whole job, hold it in memory, and lose it if the tab closed.
 * Stash has a queue for exactly this: the plugin declares a task in its manifest
 * (`mangaToolsTasks.js`), and this row only asks the two questions — which fields,
 * and whether to rehearse it — then hands the answers over with `runPluginTask`.
 * The progress bar and the log then live where every other job's do, in Settings →
 * Tasks, and the work goes on after this page is closed.
 *
 * **The dialog is Stash's own "Clean generated files" one, in shape.** A header
 * naming what is about to happen, a card of switches — one per field, plus the dry
 * run — and a destructive button in the footer, so it reads as the same kind of
 * thing as the clean-up it sits beside in the settings.
 *
 * **Everything starts on.** The user asked for that, and it is the honest default
 * for a page that removes data: the dry run is a rehearsal, and a field left off is
 * a field somebody has to come back for.
 */
import { NS } from "../languages";
import { t } from "../i18n";
import { gqlDoc, requirePluginApi } from "../plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** This plugin's id, as Stash names it — the manifest's filename */
const PLUGIN_ID = "mangaTools";

/** Must match the task's `name` in mangaTools.yml — the id Stash looks it up by */
export const CLEAR_FIELDS_TASK = "Remove the plugin's fields";

/**
 * The fields the dialog offers, in the order it lists them.
 *
 * The same six keys `mangaToolsTasks.js` knows, in the order the task's own list is
 * in — a key missing here is a key a run handed `all` would still clear, which is
 * why `all` is the manifest's default rather than this list being the whole truth.
 */
export const CLEARABLE_FIELDS = [
  "plugin.mangaTools.manga",
  "plugin.mangaTools.language",
  "plugin.mangaTools.censorship",
  "plugin.mangaTools.original",
  "plugin.mangaTools.translationGroup",
  "plugin.mangaTools.chapters",
];

/**
 * What the task is handed.
 *
 * Strings, because `args_map` is a plain map and the task reads it the way a
 * command line would: `fields` is a comma-separated list (`all` when everything is
 * chosen), and `dryRun` is `"true"` or `"false"` rather than a boolean, so a run
 * started from Stash's own Tasks page and one started here are read by the same
 * code.
 */
export function clearTaskArgs(
  fields: string[],
  dryRun: boolean
): Record<string, string> {
  return {
    fields:
      fields.length === CLEARABLE_FIELDS.length ? "all" : fields.join(","),
    dryRun: dryRun ? "true" : "false",
  };
}

/** The message id for one field's label in the dialog */
const LABEL_OF: Record<string, string> = {
  "plugin.mangaTools.manga": "mangaTools.clearFields.manga",
  "plugin.mangaTools.language": "mangaTools.clearFields.language",
  "plugin.mangaTools.censorship": "mangaTools.clearFields.censorship",
  "plugin.mangaTools.original": "mangaTools.clearFields.original",
  "plugin.mangaTools.translationGroup":
    "mangaTools.clearFields.translationGroup",
  "plugin.mangaTools.chapters": "mangaTools.clearFields.chapters",
};

const RUN_TASK_MUTATION = [
  "mutation MangaToolsRunTask($plugin_id: ID!, $task_name: String!, $args_map: Map) {",
  "  runPluginTask(plugin_id: $plugin_id, task_name: $task_name, args_map: $args_map)",
  "}",
].join("\n");

let runTaskDocument: unknown = null;

/**
 * Asks Stash to run the task, and answers whether it was queued.
 *
 * Answers `false` rather than throwing when there is nothing to send *with* — no
 * client, no document — because that is the one failure with no server behind it,
 * and the row has a line to say so. A rejected promise is the server's own answer
 * and is reported the same way by the caller.
 */
function queueClear(args: Record<string, string>): Promise<boolean> {
  const client = PluginApi.utils.StashService.getClient();
  if (!client) return Promise.resolve(false);

  if (!runTaskDocument) {
    runTaskDocument = gqlDoc(RUN_TASK_MUTATION, "build the run-task mutation");
  }
  if (!runTaskDocument) return Promise.resolve(false);

  return client
    .mutate({
      mutation: runTaskDocument,
      variables: {
        plugin_id: PLUGIN_ID,
        task_name: CLEAR_FIELDS_TASK,
        args_map: args,
      },
    })
    .then(() => true);
}

/**
 * One query, one alias per field, asking only for `count`.
 *
 * Six small counts rather than one big list: the dialog only wants the numbers, and
 * the same filter the task uses (`NOT_NULL`) is the one that makes them true — a
 * count from anywhere else could disagree with what the run would actually do.
 */
export function countsQuery(): string {
  const parts = CLEARABLE_FIELDS.map(
    (field, index) =>
      `f${index}: findGalleries(` +
      `gallery_filter: { custom_fields: [{ field: "${field}", modifier: NOT_NULL }] }, ` +
      "filter: { per_page: 1 }) { count }"
  );
  return "query { " + parts.join(" ") + " }";
}

/** Those counts, by field, out of the answer — a field with no answer reads 0 */
export function countsFrom(data: unknown): Record<string, number> {
  const answer = (data || {}) as Record<string, { count?: number } | undefined>;
  const counts: Record<string, number> = {};
  CLEARABLE_FIELDS.forEach((field, index) => {
    const count = answer["f" + index]?.count;
    counts[field] = typeof count === "number" ? count : 0;
  });
  return counts;
}

/** The counts for the dialog, or null while they are being asked for */
function loadCounts(): Promise<Record<string, number> | null> {
  const client = PluginApi.utils.StashService.getClient();
  if (!client) return Promise.resolve(null);

  const query = gqlDoc(countsQuery(), "build the clear-fields count query");
  if (!query) return Promise.resolve(null);

  return client
    .query({ query, fetchPolicy: "no-cache" })
    .then((res: { data?: unknown } | undefined) => countsFrom(res?.data))
    .catch(() => null);
}

/** One row of the dialog: a label and its switch */
function SwitchRow(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) return null;

  return (
    <div className="setting">
      <div>
        <h3>{props.label}</h3>
      </div>
      <div>
        <Bootstrap.Form.Switch
          id={props.id}
          checked={props.checked}
          onChange={() => props.onChange(!props.checked)}
        />
      </div>
    </div>
  );
}

export function ClearFieldsSetting() {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;

  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];

  const chosenState = React.useState<string[]>(CLEARABLE_FIELDS.slice());
  const chosen = chosenState[0];
  const setChosen = chosenState[1];

  const dryState = React.useState(true);
  const dryRun = dryState[0];
  const setDryRun = dryState[1];

  const busyState = React.useState(false);
  const busy = busyState[0];
  const setBusy = busyState[1];

  const noticeState = React.useState("");
  const notice = noticeState[0];
  const setNotice = noticeState[1];

  // How many galleries carry each field, asked for when the dialog opens so the
  // switches say what choosing them would touch. Null until the answer lands.
  const countsState = React.useState<Record<string, number> | null>(null);
  const counts = countsState[0];
  const setCounts = countsState[1];

  const openDialog = () => {
    setCounts(null);
    setOpen(true);
    loadCounts().then(setCounts);
  };

  /** Adds or removes one field, keeping the dialog's own order */
  const toggle = (key: string, on: boolean) => {
    setChosen((current: string[]) => {
      const has = current.indexOf(key) !== -1;
      if (has === on) return current;
      return on
        ? CLEARABLE_FIELDS.filter(
            (field) => field === key || current.indexOf(field) !== -1
          )
        : current.filter((field) => field !== key);
    });
  };

  const confirm = () => {
    setBusy(true);
    setNotice("");
    queueClear(clearTaskArgs(chosen, dryRun)).then(
      (queued) => {
        setBusy(false);
        if (!queued) {
          setNotice(t(intl, "mangaTools.clearFields.failed"));
          return;
        }
        setOpen(false);
        setNotice(t(intl, "mangaTools.clearFields.queued"));
      },
      (e: unknown) => {
        setBusy(false);
        setNotice(t(intl, "mangaTools.clearFields.failed"));
        console.error("[mangaTools] could not queue the clear task:", e);
      }
    );
  };

  const row = (
    <div className="setting manga-tools-setting">
      <div>
        <h3>{t(intl, "mangaTools.settings.clearFields.heading")}</h3>
        <div className="sub-heading">
          {t(intl, "mangaTools.settings.clearFields.description")}
        </div>
        {notice ? <div className="sub-heading">{notice}</div> : null}
      </div>
      <div>
        {Bootstrap ? (
          <Bootstrap.Button variant="danger" onClick={openDialog}>
            {t(intl, "mangaTools.clearFields.button")}
          </Bootstrap.Button>
        ) : null}
      </div>
    </div>
  );

  const Modal = Bootstrap ? Bootstrap.Modal : null;
  if (!Bootstrap || !open || !Modal?.Body) return row;

  return (
    <>
      {row}
      <Modal
        show
        onHide={() => {
          if (!busy) setOpen(false);
        }}
      >
        <div className="modal-header">
          <span>{t(intl, "mangaTools.clearFields.title")}</span>
        </div>
        <div className="modal-body">
          <p>{t(intl, "mangaTools.clearFields.intro")}</p>
          <div className="setting-section">
            <div className="card">
              {CLEARABLE_FIELDS.map((field) => (
                <SwitchRow
                  key={field}
                  id={"mangaTools-clear-" + field.split(".").pop()}
                  label={
                    t(intl, LABEL_OF[field]) +
                    (counts ? " (" + counts[field] + ")" : "")
                  }
                  checked={chosen.indexOf(field) !== -1}
                  onChange={(next) => toggle(field, next)}
                />
              ))}
              <SwitchRow
                id="mangaTools-clear-dryRun"
                label={t(intl, "mangaTools.clearFields.dryRun")}
                checked={dryRun}
                onChange={setDryRun}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <div />
          <div>
            <Bootstrap.Button
              className="ml-2"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t(intl, "mangaTools.clearFields.cancel")}
            </Bootstrap.Button>
            <Bootstrap.Button
              className="ml-2"
              variant="danger"
              disabled={busy || chosen.length === 0}
              onClick={confirm}
            >
              {t(intl, "mangaTools.clearFields.confirm")}
            </Bootstrap.Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// Published for the smoke test, which reaches the tools half through the window —
// see the note on MangaToolsNamespace in plugin-api.ts.
NS.clearTaskArgs = clearTaskArgs;
NS.CLEAR_FIELDS_TASK = CLEAR_FIELDS_TASK;
NS.CLEARABLE_FIELDS = CLEARABLE_FIELDS;
NS.clearFieldsCountsQuery = countsQuery;
NS.clearFieldsCountsFrom = countsFrom;
