export type RowId = string | number;

export type SelectionContext = Readonly<{
  scopeKey: string;
  scopeRevision: number;
}>;

export type AllMatchingScope = Readonly<{
  scopeKey: string;
  scopeRevision: number;
  scopeToken: string;
}>;

declare const normalizedSelection: unique symbol;
declare const selectionIdType: unique symbol;

export type SelectionState<Id extends RowId = RowId> = (
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
    }>
) & {
  readonly [normalizedSelection]: true;
  readonly [selectionIdType]?: (id: Id) => Id;
};

export type SetIdsSelectedCommand<Id extends RowId = RowId> = Readonly<{
  type: "setIdsSelected";
  context: SelectionContext;
  ids: readonly Id[];
  selected: boolean;
}>;

export type SelectAllMatchingCommand = Readonly<{
  type: "selectAllMatching";
  scope: AllMatchingScope;
}>;

export type RefreshScopeTokenCommand = Readonly<{
  type: "refreshScopeToken";
  context: SelectionContext;
  expectedScopeToken: string;
  nextScopeToken: string;
}>;

export type ClearSelectionCommand = Readonly<{
  type: "clear";
  context: SelectionContext;
}>;

export type SelectionCommand<Id extends RowId = RowId> =
  | SetIdsSelectedCommand<Id>
  | SelectAllMatchingCommand
  | RefreshScopeTokenCommand
  | ClearSelectionCommand;

export type TransitionFailureReason = "staleScope" | "staleToken";

export type TransitionResult<Id extends RowId = RowId> =
  | Readonly<{
      applied: true;
      state: SelectionState<Id>;
    }>
  | Readonly<{
      applied: false;
      reason: TransitionFailureReason;
      state: SelectionState<Id>;
    }>;

export type ReconcileScopeInput = Readonly<{
  expected: SelectionContext;
  nextScopeKey: string;
}>;

export type RefreshScopeTokenInput = Readonly<{
  context: SelectionContext;
  expectedScopeToken: string;
  nextScopeToken: string;
}>;

export type SetIdSelectedInput<Id extends RowId = RowId> = Readonly<{
  context: SelectionContext;
  id: Id;
  selected: boolean;
}>;

export type SetIdsSelectedInput<Id extends RowId = RowId> = Readonly<{
  context: SelectionContext;
  ids: readonly Id[];
  selected: boolean;
}>;

export type ScopedRead<Value> =
  Readonly<{ scopeMatches: true; value: Value }> | Readonly<{ scopeMatches: false }>;

export type PageSelection = "noRows" | "none" | "some" | "all";

export type SelectionView<Id extends RowId = RowId> = Readonly<{
  isIdSelected: (id: Id) => boolean;
  getPageSelection: (pageIds: readonly Id[]) => PageSelection;
}>;

export type SelectionStateSummary =
  | Readonly<{ kind: "empty"; selectedCount: 0 }>
  | Readonly<{ kind: "explicit"; selectedCount: number }>
  | Readonly<{ kind: "allMatching"; excludedCount: number }>;
