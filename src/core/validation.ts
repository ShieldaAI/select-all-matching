import type { RowId, SelectionContext } from "./types.js";

function typeError(name: string, requirement: string): TypeError {
  return new TypeError(`${name} must be ${requirement}`);
}

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw typeError(name, "a non-empty string");
  }
}

export function assertObject(value: unknown, name: string): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw typeError(name, "an object");
  }
}

export function normalizeScopeRevision(value: unknown, name = "scopeRevision"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw typeError(name, "a non-negative safe integer");
  }

  return Object.is(value, -0) ? 0 : value;
}

export function normalizeRowId<Id extends RowId>(value: Id, name = "id"): Id {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw typeError(name, "a non-empty string or safe integer");
    }

    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return (Object.is(value, -0) ? 0 : value) as Id;
  }

  throw typeError(name, "a non-empty string or safe integer");
}

export function normalizeRowIds<Id extends RowId>(
  values: readonly Id[],
  name = "ids",
): readonly Id[] {
  if (!Array.isArray(values)) {
    throw typeError(name, "an array of row IDs");
  }

  const normalized: Id[] = [];
  const seen = new Set<RowId>();
  const length = values.length;

  if (!Number.isSafeInteger(length) || length < 0) {
    throw typeError(name, "an array of row IDs");
  }

  for (let index = 0; index < length; index += 1) {
    const value: Id | undefined = Object.hasOwn(values, index) ? (values[index] as Id) : undefined;
    const itemName = `${name}[${String(index)}]`;
    if (value === undefined) {
      throw typeError(itemName, "a non-empty string or safe integer");
    }
    const id = normalizeRowId(value, itemName);
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }

  return Object.freeze(normalized);
}

export function normalizeContext(value: SelectionContext, name = "context"): SelectionContext {
  assertObject(value, name);

  const scopeKey = value.scopeKey;
  const rawScopeRevision = value.scopeRevision;
  assertNonEmptyString(scopeKey, `${name}.scopeKey`);
  const scopeRevision = normalizeScopeRevision(rawScopeRevision, `${name}.scopeRevision`);

  return Object.freeze({ scopeKey, scopeRevision });
}

export function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw typeError(name, "a boolean");
  }
}
