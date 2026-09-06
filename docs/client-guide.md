# Client integration

The browser stores selected IDs, or one server scope plus excluded IDs. Pages remain in your
data-fetching layer. The [reference app](https://github.com/ShieldaAI/select-all-matching/tree/main/examples/server-table)
is a runnable example.

## Keep a context with each page

A list response supplies a `scopeKey` representing the candidate set. It should change when the
tenant, resource, filter, or relevant permission revision changes. Page number and presentation
sorting normally do not change it.

Start with `emptySelection(scopeKey)`. Keep `{ scopeKey, scopeRevision }` alongside the page that
produced an event. Commands and checkbox reads must use that context. Reading the newest context
inside an old event handler can incorrectly make an old event look current.

On a new query, invalidate the old page immediately and disable its bulk controls. Fetch the page
with a request sequence or cancellation signal. Discard out-of-date responses before calling
`reconcileScope`. When an accepted response has a new scope key, reconcile using the expected
current context and adopt the returned revision. This clears selection.

Returning from A to B to A produces a new revision, even when the key is again A. Request
sequencing is still necessary: the library cannot know which query your UI currently wants.

## Render and update checkboxes

```ts
const context = { scopeKey: state.scopeKey, scopeRevision: state.scopeRevision };
const view = createSelectionView(state, context);
if (view.scopeMatches) {
  const pageStatus = view.value.getPageSelection(eligiblePageIds);
  pageCheckbox.checked = pageStatus === "all";
  pageCheckbox.indeterminate = pageStatus === "some";
  pageCheckbox.disabled = pageStatus === "noRows";
}
```

Build one indexed view per state/context and reuse it for the page. Pass only eligible IDs to
page operations. A disabled row is an application decision; the library cannot infer permissions
from an ID. Label row checkboxes and the page checkbox, and set the native `indeterminate`
property for partial pages.

Send the explicit `checked` value using `setIdSelected` or `setIdsSelected`. Repeated checked events
are harmless. In stateful UI frameworks, apply these operations inside a functional state update
or reducer so two queued events use the latest state. Keep the event's original context.

```ts
setState((current) => {
  const result = setIdsSelected(current, {
    context: renderedPageContext,
    ids: eligiblePageIds,
    selected: checked,
  });
  return result.state;
});
```

This callback shows the update pattern; it is not a shipped framework hook. A rejected transition
returns the unchanged state. You may record a stale-event diagnostic without showing a user error.

## Select all and fetch tokens

When a server token is already available, call `selectAllMatching(state, { ...context, scopeToken })`.
The operation replaces an explicit list with an all-matching scope. Later deselections add IDs to
its exclusion list. Calling select-all again preserves exclusions; to include them again, pass the
current exclusions to `setIdsSelected` with `selected: true`.

When tokens are loaded lazily, capture the starting state object, page context, and a request
sequence. On completion, apply the token only if the request is still current and the state object
has not changed. Cancel/clear, another checkbox event, a new query, or a newer request must
invalidate it. Key/revision checks alone cannot detect a clear within the same scope.

`refreshScopeToken` replaces an existing token using both the page context and
`expectedScopeToken`. A delayed response for an older token returns `staleToken`. Refresh only
when the server confirms the candidate scope is unchanged; otherwise reconcile and clear.

## Counts, previews, and execution

Explicit counts come from `summarizeSelectionState`. All-matching summaries report only the
number of exclusions. Get an authoritative selected count from the server. Subtracting exclusions
from an old total is unreliable when rows disappear or permissions change.

Use `toBulkSelection` before sending JSON. Empty state produces `null`; oversized lists/tokens
produce a conversion failure. Let the user reduce selection after such a failure. Boundaries are
measured in UTF-8 bytes, not JavaScript string length.

A server preview describes the request at that moment. In a live query, rows can change between
preview and execution. The server must resolve and authorize again. If the token expires, clear
the selection and ask the user to select again, or obtain a replacement after confirming its
scope. Never silently reapply an expired selection to a different result set.

## Transfer and restore

Use `encodeSelection` and `decodeSelection` to pass state through JSON, a worker, or another copy
of the package. Runtime states are frozen and owned by their creating package instance. Object
spread, structured cloning, and development reloads do not preserve that ownership.

Encoded state is suitable for short-lived transfer. It is not a saved-query service. In particular,
all-matching state contains a sensitive scope token; avoid URLs, analytics, logs, and long-lived
browser storage. Restoring state does not validate its token, user, tenant, or current filter.
Ask the server to validate them and discard obsolete pending events before using restored state.
