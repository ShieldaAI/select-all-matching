import type {
  PageSelection,
  RowId,
  ScopedRead,
  SelectionContext,
  SelectionState,
  SelectionStateSummary,
  SelectionView,
} from "./types.js";
export declare function createSelectionView<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): ScopedRead<SelectionView<Id>>;
export declare function isIdSelected<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  id: NoInfer<Id>,
): ScopedRead<boolean>;
export declare function getPageSelection<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  pageIds: readonly NoInfer<Id>[],
): ScopedRead<PageSelection>;
export declare function summarizeSelectionState<Id extends RowId>(
  state: SelectionState<Id>,
): SelectionStateSummary;
