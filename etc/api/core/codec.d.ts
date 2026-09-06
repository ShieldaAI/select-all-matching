import type { RowId, SelectionState } from "./types.js";
export type DecodeResult<Value> =
  | Readonly<{
      ok: true;
      value: Value;
    }>
  | Readonly<{
      ok: false;
      code: string;
    }>;
/** Narrows a wire ID without changing its string or number value. */
export type IdDecoder<Id extends RowId> = (value: unknown) => DecodeResult<Id>;
export type BulkLimits = Readonly<{
  maxIds: number;
  maxScopeTokenBytes: number;
  maxStringIdBytes: number;
}>;
export type StateDecodeLimits = BulkLimits &
  Readonly<{
    maxScopeKeyBytes: number;
  }>;
export declare const DEFAULT_BULK_LIMITS: BulkLimits;
export declare const DEFAULT_STATE_DECODE_LIMITS: StateDecodeLimits;
type EncodedSelectionFormat<Id extends RowId, Version extends 0 | 1> = Readonly<{
  readonly stateVersion: Version;
  readonly scopeKey: string;
  readonly scopeRevision: number;
  selection:
    | Readonly<{
        mode: "empty";
      }>
    | Readonly<{
        mode: "explicit";
        ids: readonly Id[];
      }>
    | Readonly<{
        mode: "allMatching";
        scopeToken: string;
        excludedIds: readonly Id[];
      }>;
}>;
type BulkSelectionFormat<Id extends RowId, Version extends 0 | 1> =
  | Readonly<{
      protocolVersion: Version;
      mode: "explicit";
      ids: readonly Id[];
    }>
  | Readonly<{
      protocolVersion: Version;
      mode: "allMatching";
      scopeToken: string;
      excludedIds: readonly Id[];
    }>;
export type EncodedSelection<Id extends RowId = RowId> = EncodedSelectionFormat<Id, 1>;
export type BulkSelection<Id extends RowId = RowId> = BulkSelectionFormat<Id, 1>;
/** @deprecated Version 0 input remains readable. New state encodes as EncodedSelection. */
export type EncodedSelectionDraft<Id extends RowId = RowId> = EncodedSelectionFormat<Id, 0>;
/** @deprecated Version 0 input remains readable. New requests use BulkSelection. */
export type BulkSelectionDraft<Id extends RowId = RowId> = BulkSelectionFormat<Id, 0>;
export type PayloadErrorCode =
  | "invalidType"
  | "missingField"
  | "unexpectedField"
  | "unsupportedVersion"
  | "invalidMode"
  | "invalidValue"
  | "stringTooLong"
  | "tooManyIds"
  | "emptyExplicitSelection"
  | "invalidId"
  | "duplicateId"
  | "invalidPayload";
export type PayloadError = Readonly<{
  code: PayloadErrorCode;
  path: string;
  /** Stable code returned by the application's ID decoder. */
  decoderCode?: string;
}>;
export type PayloadDecodeResult<Value> =
  | Readonly<{
      ok: true;
      value: Value;
    }>
  | Readonly<{
      ok: false;
      error: PayloadError;
    }>;
export type BulkConversionResult<Id extends RowId = RowId> =
  | Readonly<{
      ok: true;
      value: BulkSelection<Id> | null;
    }>
  | Readonly<{
      ok: false;
      reason: "tooManyIds" | "tokenTooLong" | "idTooLong";
    }>;
export type SelectionDecodeOptions = Readonly<{
  limits?: Partial<StateDecodeLimits>;
}>;
export type TypedSelectionDecodeOptions<Id extends RowId> = Readonly<{
  decodeId: IdDecoder<Id>;
  limits?: Partial<StateDecodeLimits>;
}>;
export type BulkDecodeOptions = Readonly<{
  limits?: Partial<BulkLimits>;
}>;
export type TypedBulkDecodeOptions<Id extends RowId> = Readonly<{
  decodeId: IdDecoder<Id>;
  limits?: Partial<BulkLimits>;
}>;
export declare function encodeSelection<Id extends RowId>(
  state: SelectionState<Id>,
): EncodedSelection<Id>;
export declare function decodeSelection<Id extends RowId>(
  input: unknown,
  options: TypedSelectionDecodeOptions<Id>,
): PayloadDecodeResult<SelectionState<Id>>;
export declare function decodeSelection(
  input: unknown,
  options?: SelectionDecodeOptions,
): PayloadDecodeResult<SelectionState<RowId>>;
export declare function toBulkSelection<Id extends RowId>(
  state: SelectionState<Id>,
  limits?: Partial<BulkLimits>,
): BulkConversionResult<Id>;
export declare function decodeBulkSelection<Id extends RowId>(
  input: unknown,
  options: TypedBulkDecodeOptions<Id>,
): PayloadDecodeResult<BulkSelection<Id>>;
export declare function decodeBulkSelection(
  input: unknown,
  options?: BulkDecodeOptions,
): PayloadDecodeResult<BulkSelection<RowId>>;
export {};
