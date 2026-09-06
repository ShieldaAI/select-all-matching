import {
  clearSelection,
  emptySelection,
  reconcileScope,
  selectAllMatching,
  setIdsSelected,
} from "select-all-matching";

export function createTableController({ loadRows, createScope, onChange = () => {} }) {
  let state = emptySelection("initial");
  let filter = { status: "all", search: "" };
  let page = 1;
  let data = null;
  let loading = false;
  let requestingScope = false;
  let error = "";
  let querySequence = 0;
  let scopeSequence = 0;

  const context = () => ({ scopeKey: state.scopeKey, scopeRevision: state.scopeRevision });
  const snapshot = () => ({
    state,
    filter: { ...filter },
    page,
    data,
    loading,
    requestingScope,
    error,
  });
  const notify = () => onChange(snapshot());

  function cancelScopeRequest() {
    scopeSequence += 1;
    requestingScope = false;
  }

  async function load(nextFilter = filter, nextPage = page) {
    const changedFilter =
      nextFilter.status !== filter.status || nextFilter.search !== filter.search;
    const sequence = ++querySequence;
    cancelScopeRequest();
    if (changedFilter) {
      // Invalidate the rendered scope immediately, even if A -> B -> A completes out of order.
      state = reconcileScope(state, {
        expected: context(),
        nextScopeKey: `pending:${sequence}`,
      }).state;
      data = null;
    }
    filter = { ...nextFilter };
    page = nextPage;
    loading = true;
    error = "";
    notify();
    try {
      const result = await loadRows({ filter: { ...filter }, page });
      if (sequence !== querySequence) return;
      state = reconcileScope(state, { expected: context(), nextScopeKey: result.scopeKey }).state;
      data = result;
    } catch (failure) {
      if (sequence !== querySequence) return;
      page = data?.page ?? 1;
      error = failure.message;
    } finally {
      if (sequence === querySequence) {
        loading = false;
        notify();
      }
    }
  }

  function selectIds(renderedContext, ids, selected) {
    if (loading) return;
    const result = setIdsSelected(state, { context: renderedContext, ids, selected });
    if (!result.applied) return;
    cancelScopeRequest();
    state = result.state;
    error = "";
    notify();
  }

  function clear(renderedContext = context()) {
    const result = clearSelection(state, renderedContext);
    if (!result.applied) return;
    cancelScopeRequest();
    state = result.state;
    error = "";
    notify();
  }

  async function selectAll() {
    if (loading || !data || state.mode === "allMatching") return;
    const sequence = ++scopeSequence;
    const startingState = state;
    const startingQuery = querySequence;
    const startingContext = context();
    requestingScope = true;
    error = "";
    notify();
    try {
      const scope = await createScope({
        filter: { ...filter },
        expectedScopeKey: startingContext.scopeKey,
      });
      if (sequence !== scopeSequence || startingQuery !== querySequence || state !== startingState)
        return;
      if (scope.scopeKey !== startingContext.scopeKey)
        throw new Error("The filter changed. Reload the page and select again.");
      state = selectAllMatching(state, { ...startingContext, scopeToken: scope.scopeToken }).state;
    } catch (failure) {
      if (sequence === scopeSequence) error = failure.message;
    } finally {
      if (sequence === scopeSequence) {
        requestingScope = false;
        notify();
      }
    }
  }

  return { snapshot, load, selectIds, clear, selectAll };
}
