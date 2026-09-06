export {
  decodeBulkSelection,
  DEFAULT_BULK_LIMITS,
  type BulkDecodeOptions,
  type BulkLimits,
  type BulkSelection,
  type DecodeResult,
  type IdDecoder,
  type PayloadDecodeResult,
  type PayloadError,
  type PayloadErrorCode,
  type TypedBulkDecodeOptions,
} from "../core/codec.js";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Retained for beta migrations.
export type { BulkSelectionDraft } from "../core/codec.js";
