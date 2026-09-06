import { createSelectionView, toBulkSelection } from "select-all-matching";
import { createTableController } from "./controller.mjs";

const endpoint = "/api/tenants/north/invoices";
const actionEndpoint = `${endpoint}/mark-reviewed`;
const limits = { maxIds: 100, maxScopeTokenBytes: 64, maxStringIdBytes: 32 };
const element = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en");
let actionSequence = 0;
let actionPending = false;
let permissionAllowed = true;
let previewedState = null;

async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Demo-Request": "1" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) {
    const code = result.error?.code ?? result.error ?? "request_failed";
    const messages = {
      selection_unavailable:
        "The server rejected this selection. It may have expired, or access or row eligibility may have changed. Clear the selection and reload before trying again.",
      tooManyIds:
        "This endpoint allows up to 100 explicit IDs or exclusions. Use a narrower filter or a smaller selection.",
    };
    throw new Error(messages[code] ?? `Request failed: ${code}`);
  }
  return result;
}

const controller = createTableController({
  loadRows({ filter, page }) {
    return api(`${endpoint}?${new URLSearchParams({ ...filter, page: String(page) })}`);
  },
  createScope(input) {
    return api(`${actionEndpoint}/scope`, input);
  },
  onChange: render,
});

function render(snapshot) {
  const { state, data, loading, requestingScope, error, page } = snapshot;
  if (previewedState && previewedState !== state) {
    previewedState = null;
    element("action-result").textContent =
      "Selection changed. Preview the current selection again.";
  }
  const context = { scopeKey: state.scopeKey, scopeRevision: state.scopeRevision };
  const view = createSelectionView(state, context).value;
  const pageRows = data?.rows ?? [];
  const eligibleIds = pageRows.filter((row) => row.selectable).map((row) => row.id);
  const pageSelection = view.getPageSelection(eligibleIds);
  const pageCheckbox = element("page-checkbox");
  pageCheckbox.checked = pageSelection === "all";
  pageCheckbox.indeterminate = pageSelection === "some";
  pageCheckbox.disabled = loading || actionPending || eligibleIds.length === 0;
  pageCheckbox.onchange = () => controller.selectIds(context, eligibleIds, pageCheckbox.checked);
  document.querySelector("table").setAttribute("aria-busy", String(loading));

  const focusedCheckbox = document.activeElement?.id;
  element("rows").replaceChildren(
    ...pageRows.map((row) => {
      const tr = document.createElement("tr");
      const checkboxCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `select-${row.id}`;
      checkbox.setAttribute("aria-label", `Select ${row.name}`);
      checkbox.checked = row.selectable && view.isIdSelected(row.id);
      checkbox.disabled = loading || actionPending || !row.selectable;
      checkbox.onchange = () => controller.selectIds(context, [row.id], checkbox.checked);
      checkboxCell.append(checkbox);
      tr.append(checkboxCell);
      for (const text of [
        row.name,
        row.status,
        row.locked ? "Locked" : row.reviewed ? "Reviewed" : "Not reviewed",
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  // Keep keyboard focus on the row when its checked state causes a render.
  if (focusedCheckbox?.startsWith("select-row-")) {
    element(focusedCheckbox)?.focus({ preventScroll: true });
  }

  element("selection-summary").textContent = requestingScope
    ? "Requesting a scope from the server…"
    : state.mode === "empty"
      ? "Nothing selected."
      : state.mode === "explicit"
        ? `${number.format(state.ids.length)} selected.`
        : `All matching rows selected, ${number.format(state.excludedIds.length)} excluded. Preview for a current eligible count.`;
  element("load-error").textContent = error;
  element("select-all").disabled =
    loading ||
    actionPending ||
    requestingScope ||
    !data?.eligibleCount ||
    state.mode === "allMatching";
  element("clear").disabled = actionPending || (state.mode === "empty" && !requestingScope);
  element("previous").disabled = loading || actionPending || page <= 1;
  element("next").disabled =
    loading || actionPending || !data || page * data.pageSize >= data.total;
  for (const control of element("filters").elements) control.disabled = actionPending;
  element("page-summary").textContent = loading
    ? "Loading invoices…"
    : data
      ? `Page ${page} of ${Math.max(1, Math.ceil(data.total / data.pageSize))} · ${number.format(data.total)} matching rows · ${number.format(data.eligibleCount)} eligible now`
      : "No page loaded.";
  const bulk = toBulkSelection(state, limits);
  element("selection-limit").textContent = bulk.ok
    ? ""
    : bulk.reason === "tooManyIds"
      ? state.mode === "allMatching"
        ? "This endpoint allows 100 exclusions. Reinclude some rows, or clear the selection and use a narrower filter."
        : "This endpoint allows 100 selected IDs. Deselect some rows, or use Select all matching."
      : "The selection cannot be sent. Clear it and select again.";
  const unavailable =
    loading || actionPending || requestingScope || !bulk.ok || bulk.value === null;
  element("preview").disabled = unavailable;
  element("apply").disabled = unavailable;
  element("request-preview").textContent = JSON.stringify(
    bulk.ok
      ? bulk.value?.mode === "allMatching"
        ? { ...bulk.value, scopeToken: "[opaque server handle]" }
        : bulk.value
      : { error: bulk.reason },
    null,
    2,
  );
}

async function runAction(action) {
  const { state } = controller.snapshot();
  const body = toBulkSelection(state, limits);
  if (!body.ok || body.value === null) return;
  const sequence = ++actionSequence;
  actionPending = true;
  element("action-result").textContent = "Checking the selection on the server…";
  render(controller.snapshot());
  try {
    const result = await api(`${actionEndpoint}/${action}`, body.value);
    if (sequence !== actionSequence) return;
    if (action === "preview" && controller.snapshot().state !== state) {
      element("action-result").textContent =
        "Selection changed while the preview was running. Preview the current selection again.";
      return;
    }
    previewedState = action === "preview" ? state : null;
    const noun = result.count === 1 ? "invoice" : "invoices";
    element("action-result").textContent =
      action === "apply"
        ? `${number.format(result.count)} ${noun} marked reviewed.`
        : `${number.format(result.count)} eligible ${noun} at preview time. The server will check again when marking reviewed.`;
    if (action === "apply") {
      if (controller.snapshot().state === state) controller.clear();
      await controller.load();
    }
  } catch (error) {
    if (sequence === actionSequence) element("action-result").textContent = error.message;
  } finally {
    if (sequence === actionSequence) {
      actionPending = false;
      render(controller.snapshot());
    }
  }
}

element("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  element("action-result").textContent = "";
  void controller.load(
    { status: element("status").value, search: element("search").value.trim().toLowerCase() },
    1,
  );
});
element("previous").onclick = () => controller.load(undefined, controller.snapshot().page - 1);
element("next").onclick = () => controller.load(undefined, controller.snapshot().page + 1);
element("select-all").onclick = () => controller.selectAll();
element("clear").onclick = () => controller.clear();
element("preview").onclick = () => runAction("preview");
element("apply").onclick = () => runAction("apply");
element("expire").onclick = async () => {
  try {
    await api("/api/demo/expire-scopes", {});
    element("action-result").textContent =
      "Scope tokens expired on the server. Try previewing the selection.";
  } catch (error) {
    element("action-result").textContent = error.message;
  }
};
element("permission").onclick = async () => {
  try {
    const result = await api("/api/demo/permission", { allowed: !permissionAllowed });
    permissionAllowed = result.allowed;
    element("permission").textContent = permissionAllowed
      ? "Revoke permission"
      : "Restore permission";
    element("action-result").textContent = permissionAllowed
      ? "Permission restored. Reload or apply the filter before selecting again."
      : "Permission revoked on the server. Try previewing or marking the current selection.";
  } catch (error) {
    element("action-result").textContent = error.message;
  }
};

void controller.load();
