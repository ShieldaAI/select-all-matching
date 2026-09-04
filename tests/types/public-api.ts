import {
  applySelectionCommand,
  decodeSelection,
  emptySelection,
  isIdSelected,
  setIdSelected,
  type BulkSelectionDraft,
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

declare const customerBulk: BulkSelectionDraft<CustomerId>;
const readonlyStringBulk: BulkSelectionDraft<string> = customerBulk;
declare function acceptsMutableStringIds(ids: string[]): void;
if (readonlyStringBulk.mode === "explicit") {
  // @ts-expect-error -- Covariant wire output is safe because its arrays are readonly.
  acceptsMutableStringIds(readonlyStringBulk.ids);
}
