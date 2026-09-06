import type {
  AllMatchingScope,
  ReconcileScopeInput,
  RefreshScopeTokenInput,
  RowId,
  SelectionCommand,
  SelectionContext,
  SelectionState,
  SetIdSelectedInput,
  SetIdsSelectedInput,
  TransitionResult,
} from "./types.js";
export type NormalizedSelectionInput<Id extends RowId = RowId> =
  | Readonly<{
      mode: "empty";
      scopeKey: string;
      scopeRevision: number;
    }>
  | Readonly<{
      mode: "explicit";
      scopeKey: string;
      scopeRevision: number;
      ids: readonly Id[];
    }>
  | Readonly<{
      mode: "allMatching";
      scopeKey: string;
      scopeRevision: number;
      scopeToken: string;
      excludedIds: readonly Id[];
    }>;
export declare function assertNormalizedSelection<Id extends RowId>(
  value: SelectionState<Id>,
  name?: string,
): void;
/** Builds a normalized state after a trusted package decoder has checked its shape. */
export declare function createNormalizedSelection<Id extends RowId = RowId>(
  input: NormalizedSelectionInput<Id>,
): SelectionState<Id>;
export declare function emptySelection<Id extends RowId = RowId>(
  scopeKey: string,
): SelectionState<Id>;
export declare function applySelectionCommand<Id extends RowId>(
  state: SelectionState<Id>,
  command: SelectionCommand<NoInfer<Id>>,
): TransitionResult<Id>;
export declare function reconcileScope<Id extends RowId>(
  state: SelectionState<Id>,
  input: ReconcileScopeInput,
): TransitionResult<Id>;
export declare function refreshScopeToken<Id extends RowId>(
  state: SelectionState<Id>,
  input: RefreshScopeTokenInput,
): TransitionResult<Id>;
export declare function setIdSelected<Id extends RowId>(
  state: SelectionState<Id>,
  input: SetIdSelectedInput<NoInfer<Id>>,
): TransitionResult<Id>;
export declare function setIdsSelected<Id extends RowId>(
  state: SelectionState<Id>,
  input: SetIdsSelectedInput<NoInfer<Id>>,
): TransitionResult<Id>;
export declare function clearSelection<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): TransitionResult<Id>;
export declare function selectAllMatching<Id extends RowId>(
  state: SelectionState<Id>,
  scope: AllMatchingScope,
): TransitionResult<Id>;
