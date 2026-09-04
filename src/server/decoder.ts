import {
  __decodeBulkSelection,
  type BulkDecodeOptions,
  type BulkSelectionDraft,
  type PayloadDecodeResult,
  type TypedBulkDecodeOptions,
} from "../core/codec.js";
import type { RowId } from "../core/types.js";

/**
 * Validates an untrusted draft bulk-selection payload.
 *
 * Payload failures are returned as data. Invalid decoder configuration is a
 * programmer error and throws a TypeError before payload validation starts.
 */
export function decodeBulkSelection<Id extends RowId>(
  input: unknown,
  options: TypedBulkDecodeOptions<Id>,
): PayloadDecodeResult<BulkSelectionDraft<Id>>;
export function decodeBulkSelection(
  input: unknown,
  options?: BulkDecodeOptions,
): PayloadDecodeResult<BulkSelectionDraft<RowId>>;
export function decodeBulkSelection<Id extends RowId>(
  input: unknown,
  options?: BulkDecodeOptions | TypedBulkDecodeOptions<Id>,
): PayloadDecodeResult<BulkSelectionDraft<Id>> {
  return __decodeBulkSelection(input, options as TypedBulkDecodeOptions<Id>);
}
