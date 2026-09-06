import type { RowId, SelectionContext } from "./types.js";
export declare function assertNonEmptyString(value: unknown, name: string): asserts value is string;
export declare function assertObject(value: unknown, name: string): asserts value is object;
export declare function normalizeScopeRevision(value: unknown, name?: string): number;
export declare function normalizeRowId<Id extends RowId>(value: Id, name?: string): Id;
export declare function normalizeRowIds<Id extends RowId>(
  values: readonly Id[],
  name?: string,
): readonly Id[];
export declare function normalizeContext(value: SelectionContext, name?: string): SelectionContext;
export declare function assertBoolean(value: unknown, name: string): asserts value is boolean;
