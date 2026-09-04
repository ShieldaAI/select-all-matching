import { emptySelection, setIdSelected, type SelectionView } from "select-all-matching";
import { decodeBulkSelection } from "select-all-matching/server";

declare const customerIdBrand: unique symbol;
type CustomerId = string & { readonly [customerIdBrand]: true };

const customerId = "cus_1" as CustomerId;
const state = emptySelection<CustomerId>("customers");

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
