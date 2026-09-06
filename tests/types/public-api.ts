import {
  applySelectionCommand,
  decodeSelection,
  emptySelection,
  encodeSelection,
  isIdSelected,
  setIdSelected,
  toBulkSelection,
  type BulkSelection,
  type BulkSelectionDraft,
  type EncodedSelection,
  type EncodedSelectionDraft,
  type IdDecoder,
  type SelectionState,
  type SelectionView,
} from "../../src/index.js";
import { decodeBulkSelection } from "../../src/server/index.js";

declare const customerIdBrand: unique symbol;
type CustomerId = string & { readonly [customerIdBrand]: true };

const customerId = "cus_1" as CustomerId;
const customerState = emptySelection<CustomerId>("customers");
declare function acceptsNumberState(state: SelectionState<number>): void;
declare function acceptsStringState(state: SelectionState<string>): void;

// @ts-expect-error -- A branded state cannot be widened and filled with plain strings.
acceptsStringState(customerState);

if (customerState.mode === "empty") {
  setIdSelected(customerState, {
    context: { scopeKey: "customers", scopeRevision: 0 },
    // @ts-expect-error -- Narrowing to empty must not erase the branded ID type.
    id: "plain-string",
    selected: true,
  });
  // @ts-expect-error -- Empty branded state must remain incompatible with number state.
  acceptsNumberState(customerState);
}

setIdSelected(customerState, {
  context: { scopeKey: "customers", scopeRevision: 0 },
  id: customerId,
  selected: true,
});
isIdSelected(customerState, { scopeKey: "customers", scopeRevision: 0 }, customerId);

setIdSelected(customerState, {
  context: { scopeKey: "customers", scopeRevision: 0 },
  // @ts-expect-error -- A branded state must not accept an arbitrary string ID.
  id: "plain-string",
  selected: true,
});

applySelectionCommand(customerState, {
  type: "setIdsSelected",
  context: { scopeKey: "customers", scopeRevision: 0 },
  ids: [customerId],
  selected: true,
});

applySelectionCommand(customerState, {
  type: "setIdsSelected",
  context: { scopeKey: "customers", scopeRevision: 0 },
  // @ts-expect-error -- Commands cannot widen a branded state to plain strings.
  ids: ["plain-string"],
  selected: true,
});

declare const payload: unknown;

// @ts-expect-error -- Typed decoding requires an application ID decoder.
decodeSelection<CustomerId>(payload);
// @ts-expect-error -- Typed server decoding requires an application ID decoder.
decodeBulkSelection<CustomerId>(payload);

declare const customerView: SelectionView<CustomerId>;
declare function acceptsStringView(view: SelectionView<string>): void;
// @ts-expect-error -- A branded-ID view must not be widened to accept plain strings.
acceptsStringView(customerView);

declare const customerBulk: BulkSelection<CustomerId>;
const readonlyStringBulk: BulkSelection<string> = customerBulk;
declare function acceptsMutableStringIds(ids: string[]): void;
if (readonlyStringBulk.mode === "explicit") {
  // @ts-expect-error -- Covariant wire output is safe because its arrays are readonly.
  acceptsMutableStringIds(readonlyStringBulk.ids);
}

declare function acceptsEncodedCustomerState(value: EncodedSelection<CustomerId>): void;
declare function acceptsCustomerBulk(value: BulkSelection<CustomerId>): void;
declare function acceptsVersionOne(version: 1): void;

const encodedCustomerState = encodeSelection(customerState);
acceptsEncodedCustomerState(encodedCustomerState);
acceptsVersionOne(encodedCustomerState.stateVersion);

const customerRequest = toBulkSelection(customerState);
if (customerRequest.ok && customerRequest.value !== null) {
  acceptsCustomerBulk(customerRequest.value);
  acceptsVersionOne(customerRequest.value.protocolVersion);
}

declare const decodeCustomerId: IdDecoder<CustomerId>;
const restoredCustomer = decodeSelection(payload, { decodeId: decodeCustomerId });
if (restoredCustomer.ok) acceptsEncodedCustomerState(encodeSelection(restoredCustomer.value));
const decodedRequest = decodeBulkSelection(payload, { decodeId: decodeCustomerId });
if (decodedRequest.ok) {
  acceptsCustomerBulk(decodedRequest.value);
  acceptsVersionOne(decodedRequest.value.protocolVersion);
}

/* eslint-disable @typescript-eslint/no-deprecated -- Check the beta migration types. */
declare const draftState: EncodedSelectionDraft<CustomerId>;
declare const draftRequest: BulkSelectionDraft<CustomerId>;
/* eslint-enable @typescript-eslint/no-deprecated */
// @ts-expect-error -- Beta payload types still describe version 0.
acceptsEncodedCustomerState(draftState);
// @ts-expect-error -- A beta request must be decoded before it can be treated as version 1.
acceptsCustomerBulk(draftRequest);

type InvoiceId = number & { readonly invoiceId: unique symbol };
const invoiceState = emptySelection<InvoiceId>("invoices");
setIdSelected(invoiceState, {
  context: { scopeKey: "invoices", scopeRevision: 0 },
  // @ts-expect-error -- Numeric ID brands receive the same protection as string brands.
  id: 42,
  selected: true,
});
