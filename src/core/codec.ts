import type { RowId, SelectionState } from "./types.js";
import { assertNormalizedSelection, createNormalizedSelection } from "./state.js";

export type DecodeResult<Value> =
  Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false; code: string }>;

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

export const DEFAULT_BULK_LIMITS: BulkLimits = Object.freeze({
  maxIds: 10_000,
  maxScopeTokenBytes: 4_096,
  maxStringIdBytes: 1_024,
});

export const DEFAULT_STATE_DECODE_LIMITS: StateDecodeLimits = Object.freeze({
  ...DEFAULT_BULK_LIMITS,
  maxScopeKeyBytes: 512,
});

export type EncodedSelectionDraft<Id extends RowId = RowId> = Readonly<{
  readonly stateVersion: 0;
  readonly scopeKey: string;
  readonly scopeRevision: number;
  selection:
    | Readonly<{ mode: "empty" }>
    | Readonly<{ mode: "explicit"; ids: readonly Id[] }>
    | Readonly<{
        mode: "allMatching";
        scopeToken: string;
        excludedIds: readonly Id[];
      }>;
}>;

export type BulkSelectionDraft<Id extends RowId = RowId> =
  | Readonly<{
      protocolVersion: 0;
      mode: "explicit";
      ids: readonly Id[];
    }>
  | Readonly<{
      protocolVersion: 0;
      mode: "allMatching";
      scopeToken: string;
      excludedIds: readonly Id[];
    }>;

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
  Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false; error: PayloadError }>;

export type BulkConversionResult<Id extends RowId = RowId> =
  | Readonly<{ ok: true; value: BulkSelectionDraft<Id> | null }>
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

type UnknownRecord = Record<string, unknown>;

type ResolvedDecodeOptions<Id extends RowId, Limits extends BulkLimits = BulkLimits> = Readonly<{
  decodeId: IdDecoder<Id> | undefined;
  limits: Limits;
}>;

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const ownValue = (value: UnknownRecord | undefined, key: string): unknown =>
  value !== undefined && hasOwn(value, key) ? value[key] : undefined;

const error = (
  code: PayloadErrorCode,
  path: string,
  decoderCode?: string,
): PayloadDecodeResult<never> => ({
  ok: false,
  error: decoderCode === undefined ? { code, path } : { code, path, decoderCode },
});

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function propertyPath(parent: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `${parent}.${property}`
    : `${parent}[${JSON.stringify(property)}]`;
}

function safeDecoderCode(value: unknown, rejected: RowId): string | undefined {
  if (
    typeof value !== "string" ||
    value === rejected ||
    !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value)
  ) {
    return undefined;
  }

  return value;
}

function exactFields(
  value: UnknownRecord,
  expected: readonly string[],
  path: string,
): PayloadDecodeResult<true> {
  for (const field of expected) {
    if (!hasOwn(value, field)) {
      return error("missingField", propertyPath(path, field));
    }
  }

  const expectedSet = new Set(expected);
  let extra: string | undefined;
  for (const field of Object.keys(value)) {
    if (!expectedSet.has(field) && (extra === undefined || field < extra)) {
      extra = field;
    }
  }

  return extra === undefined
    ? { ok: true, value: true }
    : error("unexpectedField", propertyPath(path, extra));
}

/** Matches TextEncoder's treatment of lone UTF-16 surrogates without a runtime dependency. */
function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function assertPlainObject(
  value: unknown,
  name: string,
): asserts value is UnknownRecord | undefined {
  if (value === undefined) return;

  if (!isRecord(value)) {
    throw new TypeError(`${name} must be a plain object when provided`);
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object when provided`);
  }
}

function assertOnlyOptionFields(
  value: UnknownRecord | undefined,
  allowed: readonly string[],
  name: string,
): void {
  if (value === undefined) return;

  const allowedSet = new Set(allowed);
  let extra: string | undefined;
  for (const field of Object.keys(value)) {
    if (!allowedSet.has(field) && (extra === undefined || field < extra)) {
      extra = field;
    }
  }
  if (extra !== undefined) {
    throw new TypeError(`${name}.${extra} is not supported`);
  }
}

function readLimit(input: UnknownRecord | undefined, key: string, fallback: number): number {
  const value = input !== undefined && hasOwn(input, key) ? input[key] : fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`limits.${key} must be a positive safe integer`);
  }
  return value as number;
}

function resolveBulkLimits(limits: unknown): BulkLimits {
  assertPlainObject(limits, "limits");
  const input = limits;
  assertOnlyOptionFields(input, ["maxIds", "maxScopeTokenBytes", "maxStringIdBytes"], "limits");
  return {
    maxIds: readLimit(input, "maxIds", DEFAULT_BULK_LIMITS.maxIds),
    maxScopeTokenBytes: readLimit(
      input,
      "maxScopeTokenBytes",
      DEFAULT_BULK_LIMITS.maxScopeTokenBytes,
    ),
    maxStringIdBytes: readLimit(input, "maxStringIdBytes", DEFAULT_BULK_LIMITS.maxStringIdBytes),
  };
}

function resolveStateLimits(limits: unknown): StateDecodeLimits {
  assertPlainObject(limits, "limits");
  const input = limits;
  assertOnlyOptionFields(
    input,
    ["maxIds", "maxScopeKeyBytes", "maxScopeTokenBytes", "maxStringIdBytes"],
    "limits",
  );
  return {
    maxIds: readLimit(input, "maxIds", DEFAULT_STATE_DECODE_LIMITS.maxIds),
    maxScopeTokenBytes: readLimit(
      input,
      "maxScopeTokenBytes",
      DEFAULT_STATE_DECODE_LIMITS.maxScopeTokenBytes,
    ),
    maxStringIdBytes: readLimit(
      input,
      "maxStringIdBytes",
      DEFAULT_STATE_DECODE_LIMITS.maxStringIdBytes,
    ),
    maxScopeKeyBytes: readLimit(
      input,
      "maxScopeKeyBytes",
      DEFAULT_STATE_DECODE_LIMITS.maxScopeKeyBytes,
    ),
  };
}

function resolveDecodeOptions<Id extends RowId>(
  options: unknown,
  kind: "state",
): ResolvedDecodeOptions<Id, StateDecodeLimits>;
function resolveDecodeOptions<Id extends RowId>(
  options: unknown,
  kind: "bulk",
): ResolvedDecodeOptions<Id>;
function resolveDecodeOptions<Id extends RowId>(
  options: unknown,
  kind: "bulk" | "state",
): ResolvedDecodeOptions<Id, StateDecodeLimits | BulkLimits> {
  assertPlainObject(options, "Codec options");
  const input = options;
  assertOnlyOptionFields(input, ["decodeId", "limits"], "options");
  const candidate = ownValue(input, "decodeId");

  if (candidate !== undefined && typeof candidate !== "function") {
    throw new TypeError("decodeId must be a function when provided");
  }

  const configuredLimits = ownValue(input, "limits");
  return {
    decodeId: candidate as IdDecoder<Id> | undefined,
    limits:
      kind === "state" ? resolveStateLimits(configuredLimits) : resolveBulkLimits(configuredLimits),
  };
}

function decodeRequiredString(
  value: unknown,
  path: string,
  maxBytes: number,
): PayloadDecodeResult<string> {
  if (typeof value !== "string") {
    return error("invalidType", path);
  }
  if (value.length === 0) {
    return error("invalidValue", path);
  }
  if (utf8ByteLength(value) > maxBytes) {
    return error("stringTooLong", path);
  }
  return { ok: true, value };
}

function decodeScopeRevision(value: unknown, path: string): PayloadDecodeResult<number> {
  if (typeof value !== "number") {
    return error("invalidType", path);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return error("invalidValue", path);
  }
  return { ok: true, value };
}

function decodeWireId<Id extends RowId>(
  value: unknown,
  path: string,
  maxStringIdBytes: number,
  decodeId: IdDecoder<Id> | undefined,
): PayloadDecodeResult<Id> {
  let normalized: RowId;
  if (typeof value === "string") {
    if (value.length === 0) {
      return error("invalidId", path);
    }
    if (utf8ByteLength(value) > maxStringIdBytes) {
      return error("stringTooLong", path);
    }
    normalized = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return error("invalidId", path);
    }
    normalized = Object.is(value, -0) ? 0 : value;
  } else {
    return error("invalidId", path);
  }

  if (decodeId === undefined) {
    return { ok: true, value: normalized as Id };
  }

  let decoded: DecodeResult<Id>;
  try {
    decoded = decodeId(normalized);
  } catch {
    return error("invalidId", path);
  }

  if (!isRecord(decoded)) {
    return error("invalidId", path);
  }
  const decodedOk = decoded.ok;
  if (typeof decodedOk !== "boolean") {
    return error("invalidId", path);
  }
  if (!decodedOk) {
    const decoderCode = safeDecoderCode(decoded.code, normalized);
    return error("invalidId", path, decoderCode);
  }

  const output = decoded.value;
  const decodedId =
    typeof output === "string" && output.length > 0
      ? output
      : typeof output === "number" && Number.isSafeInteger(output)
        ? Object.is(output, -0)
          ? 0
          : output
        : undefined;

  if (decodedId === undefined || decodedId !== normalized) {
    return error("invalidId", path);
  }

  return { ok: true, value: decodedId as Id };
}

function decodeIdList<Id extends RowId>(
  input: unknown[],
  length: number,
  path: string,
  limits: BulkLimits,
  decodeId: IdDecoder<Id> | undefined,
): PayloadDecodeResult<Id[]> {
  const ids: Id[] = [];

  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(input, String(index))) {
      return error("missingField", `${path}[${index}]`);
    }
    const decoded = decodeWireId(
      input[index],
      `${path}[${index}]`,
      limits.maxStringIdBytes,
      decodeId,
    );
    if (!decoded.ok) {
      return decoded;
    }
    ids.push(decoded.value);
  }

  const seen = new Set<RowId>();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      return error("duplicateId", `${path}[${index}]`);
    }
    seen.add(id);
  }

  return { ok: true, value: ids };
}

function decodeVersion(
  record: UnknownRecord,
  field: "stateVersion" | "protocolVersion",
  path: string,
): PayloadDecodeResult<true> {
  const fieldPath = propertyPath(path, field);
  if (!hasOwn(record, field)) {
    return error("missingField", fieldPath);
  }
  const version = record[field];
  if (typeof version !== "number") {
    return error("invalidType", fieldPath);
  }
  if (version !== 0) {
    return error("unsupportedVersion", fieldPath);
  }
  return { ok: true, value: true };
}

function decodeMode(
  record: UnknownRecord,
  path: string,
  accepted: readonly string[],
): PayloadDecodeResult<string> {
  const modePath = propertyPath(path, "mode");
  if (!hasOwn(record, "mode")) {
    return error("missingField", modePath);
  }
  const mode = record["mode"];
  if (typeof mode !== "string") {
    return error("invalidType", modePath);
  }
  if (!accepted.includes(mode)) {
    return error("invalidMode", modePath);
  }
  return { ok: true, value: mode };
}

function decodeSelectionUnsafe<Id extends RowId>(
  input: unknown,
  options: ResolvedDecodeOptions<Id, StateDecodeLimits>,
): PayloadDecodeResult<SelectionState<Id>> {
  if (!isRecord(input)) {
    return error("invalidType", "$");
  }

  const version = decodeVersion(input, "stateVersion", "$");
  if (!version.ok) return version;

  const rootFields = exactFields(
    input,
    ["stateVersion", "scopeKey", "scopeRevision", "selection"],
    "$",
  );
  if (!rootFields.ok) return rootFields;

  const selectionValue = input["selection"];
  if (!isRecord(selectionValue)) {
    return error("invalidType", "$.selection");
  }

  const selection = selectionValue;
  const mode = decodeMode(selection, "$.selection", ["empty", "explicit", "allMatching"]);
  if (!mode.ok) return mode;

  const selectionFields = exactFields(
    selection,
    mode.value === "empty"
      ? ["mode"]
      : mode.value === "explicit"
        ? ["mode", "ids"]
        : ["mode", "scopeToken", "excludedIds"],
    "$.selection",
  );
  if (!selectionFields.ok) return selectionFields;

  const listValue =
    mode.value === "explicit"
      ? selection["ids"]
      : mode.value === "allMatching"
        ? selection["excludedIds"]
        : undefined;
  const listPath = mode.value === "explicit" ? "$.selection.ids" : "$.selection.excludedIds";
  let listLength = 0;

  if (mode.value !== "empty") {
    if (!Array.isArray(listValue)) {
      return error("invalidType", listPath);
    }
    listLength = listValue.length;
    if (!Number.isSafeInteger(listLength) || listLength < 0) {
      return error("invalidPayload", listPath);
    }
    if (mode.value === "explicit" && listLength === 0) {
      return error("emptyExplicitSelection", listPath);
    }
    if (listLength > options.limits.maxIds) {
      return error("tooManyIds", listPath);
    }
  }

  const scopeKey = decodeRequiredString(
    input["scopeKey"],
    "$.scopeKey",
    options.limits.maxScopeKeyBytes,
  );
  if (!scopeKey.ok) return scopeKey;

  const scopeRevision = decodeScopeRevision(input["scopeRevision"], "$.scopeRevision");
  if (!scopeRevision.ok) return scopeRevision;

  if (mode.value === "empty") {
    return {
      ok: true,
      value: createNormalizedSelection({
        mode: "empty",
        scopeKey: scopeKey.value,
        scopeRevision: scopeRevision.value,
      }),
    };
  }

  if (mode.value === "explicit") {
    const ids = decodeIdList(
      listValue as unknown[],
      listLength,
      listPath,
      options.limits,
      options.decodeId,
    );
    if (!ids.ok) return ids;

    return {
      ok: true,
      value: createNormalizedSelection({
        mode: "explicit",
        scopeKey: scopeKey.value,
        scopeRevision: scopeRevision.value,
        ids: ids.value,
      }),
    };
  }

  const scopeToken = decodeRequiredString(
    selection["scopeToken"],
    "$.selection.scopeToken",
    options.limits.maxScopeTokenBytes,
  );
  if (!scopeToken.ok) return scopeToken;

  const excludedIds = decodeIdList(
    listValue as unknown[],
    listLength,
    listPath,
    options.limits,
    options.decodeId,
  );
  if (!excludedIds.ok) return excludedIds;

  return {
    ok: true,
    value: createNormalizedSelection({
      mode: "allMatching",
      scopeKey: scopeKey.value,
      scopeRevision: scopeRevision.value,
      scopeToken: scopeToken.value,
      excludedIds: excludedIds.value,
    }),
  };
}

export function encodeSelection<Id extends RowId>(
  state: SelectionState<Id>,
): EncodedSelectionDraft<Id> {
  assertNormalizedSelection(state);
  const base = {
    stateVersion: 0 as const,
    scopeKey: state.scopeKey,
    scopeRevision: state.scopeRevision,
  };

  switch (state.mode) {
    case "empty":
      return { ...base, selection: { mode: "empty" } };
    case "explicit":
      return {
        ...base,
        selection: { mode: "explicit", ids: [...state.ids] },
      };
    case "allMatching":
      return {
        ...base,
        selection: {
          mode: "allMatching",
          scopeToken: state.scopeToken,
          excludedIds: [...state.excludedIds],
        },
      };
  }
}

export function decodeSelection<Id extends RowId>(
  input: unknown,
  options: TypedSelectionDecodeOptions<Id>,
): PayloadDecodeResult<SelectionState<Id>>;
export function decodeSelection(
  input: unknown,
  options?: SelectionDecodeOptions,
): PayloadDecodeResult<SelectionState<RowId>>;
export function decodeSelection<Id extends RowId>(
  input: unknown,
  options?: SelectionDecodeOptions | TypedSelectionDecodeOptions<Id>,
): PayloadDecodeResult<SelectionState<Id>> {
  const resolved = resolveDecodeOptions<Id>(options, "state");

  try {
    return decodeSelectionUnsafe(input, resolved);
  } catch {
    return error("invalidPayload", "$");
  }
}

export function toBulkSelection<Id extends RowId>(
  state: SelectionState<Id>,
  limits?: Partial<BulkLimits>,
): BulkConversionResult<Id> {
  assertNormalizedSelection(state);
  const resolved = resolveBulkLimits(limits);

  if (state.mode === "empty") {
    return { ok: true, value: null };
  }

  const ids = state.mode === "explicit" ? state.ids : state.excludedIds;
  if (ids.length > resolved.maxIds) {
    return { ok: false, reason: "tooManyIds" };
  }
  if (
    state.mode === "allMatching" &&
    utf8ByteLength(state.scopeToken) > resolved.maxScopeTokenBytes
  ) {
    return { ok: false, reason: "tokenTooLong" };
  }
  if (ids.some((id) => typeof id === "string" && utf8ByteLength(id) > resolved.maxStringIdBytes)) {
    return { ok: false, reason: "idTooLong" };
  }

  return state.mode === "explicit"
    ? {
        ok: true,
        value: {
          protocolVersion: 0,
          mode: "explicit",
          ids: [...state.ids],
        },
      }
    : {
        ok: true,
        value: {
          protocolVersion: 0,
          mode: "allMatching",
          scopeToken: state.scopeToken,
          excludedIds: [...state.excludedIds],
        },
      };
}

function decodeBulkSelectionUnsafe<Id extends RowId>(
  input: unknown,
  options: ResolvedDecodeOptions<Id>,
): PayloadDecodeResult<BulkSelectionDraft<Id>> {
  if (!isRecord(input)) {
    return error("invalidType", "$");
  }

  const version = decodeVersion(input, "protocolVersion", "$");
  if (!version.ok) return version;

  const mode = decodeMode(input, "$", ["explicit", "allMatching"]);
  if (!mode.ok) return mode;

  const fields = exactFields(
    input,
    mode.value === "explicit"
      ? ["protocolVersion", "mode", "ids"]
      : ["protocolVersion", "mode", "scopeToken", "excludedIds"],
    "$",
  );
  if (!fields.ok) return fields;

  const listValue = mode.value === "explicit" ? input["ids"] : input["excludedIds"];
  const listPath = mode.value === "explicit" ? "$.ids" : "$.excludedIds";
  if (!Array.isArray(listValue)) {
    return error("invalidType", listPath);
  }
  const listLength = listValue.length;
  if (!Number.isSafeInteger(listLength) || listLength < 0) {
    return error("invalidPayload", listPath);
  }
  if (mode.value === "explicit" && listLength === 0) {
    return error("emptyExplicitSelection", listPath);
  }
  if (listLength > options.limits.maxIds) {
    return error("tooManyIds", listPath);
  }

  if (mode.value === "explicit") {
    const ids = decodeIdList(listValue, listLength, listPath, options.limits, options.decodeId);
    if (!ids.ok) return ids;

    return {
      ok: true,
      value: { protocolVersion: 0, mode: "explicit", ids: ids.value },
    };
  }

  const scopeToken = decodeRequiredString(
    input["scopeToken"],
    "$.scopeToken",
    options.limits.maxScopeTokenBytes,
  );
  if (!scopeToken.ok) return scopeToken;

  const excludedIds = decodeIdList(
    listValue,
    listLength,
    listPath,
    options.limits,
    options.decodeId,
  );
  if (!excludedIds.ok) return excludedIds;

  return {
    ok: true,
    value: {
      protocolVersion: 0,
      mode: "allMatching",
      scopeToken: scopeToken.value,
      excludedIds: excludedIds.value,
    },
  };
}

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
  const resolved = resolveDecodeOptions<Id>(options, "bulk");
  try {
    return decodeBulkSelectionUnsafe(input, resolved);
  } catch {
    return error("invalidPayload", "$");
  }
}
