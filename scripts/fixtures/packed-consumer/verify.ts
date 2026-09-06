import {
  decodeSelection,
  emptySelection,
  encodeSelection,
  setIdSelected,
  toBulkSelection,
  type BulkSelection,
  type EncodedSelection,
  type IdDecoder,
  type SelectionView,
} from "select-all-matching";
import {
  decodeBulkSelection,
  type BulkSelection as ServerBulkSelection,
} from "select-all-matching/server";

declare const customerIdBrand: unique symbol;
type CustomerId = string & { readonly [customerIdBrand]: true };

const customerId = "cus_1" as CustomerId;
const state = emptySelection<CustomerId>("customers");
declare function acceptsStringState(
  value: import("select-all-matching").SelectionState<string>,
): void;

// @ts-expect-error -- branded state cannot be widened to accept plain strings
acceptsStringState(state);

if (state.mode === "empty") {
  setIdSelected(state, {
    context: { scopeKey: "customers", scopeRevision: 0 },
    // @ts-expect-error -- narrowing must preserve the branded ID type
    id: "plain-string",
    selected: true,
  });
}

setIdSelected(state, {
  context: { scopeKey: "customers", scopeRevision: 0 },
  id: customerId,
  selected: true,
});

declare const brandedView: SelectionView<CustomerId>;
declare function acceptsStringView(view: SelectionView<string>): void;

// @ts-expect-error -- branded views cannot accept arbitrary strings
acceptsStringView(brandedView);

declare const payload: unknown;

// @ts-expect-error -- typed decoding needs an ID decoder
decodeBulkSelection<CustomerId>(payload);

// @ts-expect-error -- restored branded IDs also need an ID decoder
decodeSelection<CustomerId>(payload);

const decodeCustomerId: IdDecoder<CustomerId> = (value) =>
  typeof value === "string" && value.startsWith("cus_")
    ? { ok: true, value: value as CustomerId }
    : { ok: false, code: "invalidCustomerId" };

const restored = decodeSelection(payload, { decodeId: decodeCustomerId });
if (restored.ok) {
  const encoded: EncodedSelection<CustomerId> = encodeSelection(restored.value);
  const version: 1 = encoded.stateVersion;
  void version;
  const request = toBulkSelection(restored.value);
  if (request.ok && request.value !== null) {
    const serverInput: ServerBulkSelection<CustomerId> = request.value;
    const output: BulkSelection<string> = serverInput;
    const protocolVersion: 1 = output.protocolVersion;
    void protocolVersion;
    if (output.mode === "explicit") {
      // @ts-expect-error -- callers cannot append unvalidated IDs to wire output
      output.ids.push("plain-string");
    }
  }
}

const decodedRequest = decodeBulkSelection(payload, { decodeId: decodeCustomerId });
if (decodedRequest.ok && decodedRequest.value.mode === "explicit") {
  const ids: readonly CustomerId[] = decodedRequest.value.ids;
  void ids;
}

// @ts-expect-error -- internals are not a supported package entry point
import { createNormalizedSelection } from "select-all-matching/dist/core/state.js";
void createNormalizedSelection;
