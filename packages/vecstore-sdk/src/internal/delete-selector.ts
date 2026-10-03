import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { DeleteSelector } from "../types";
import { filterError } from "./filter";
import { isObjectLike, isStringArray } from "./guards";

const SELECTOR_RULE =
  "delete takes { ids } with at least one string id, { filter }, or { all: true }";

export const deleteSelectorError = (
  provider: Provider,
  selector: DeleteSelector
): VecstoreError | undefined => {
  if (!isObjectLike(selector)) {
    return invalidArgument(provider, `${SELECTOR_RULE}.`);
  }
  if ("ids" in selector) {
    return isStringArray(selector.ids) && selector.ids.length > 0
      ? undefined
      : invalidArgument(provider, `${SELECTOR_RULE}. Received no usable ids.`);
  }
  if ("filter" in selector) {
    return filterError(provider, selector.filter);
  }
  return "all" in selector && selector.all === true
    ? undefined
    : invalidArgument(
        provider,
        `${SELECTOR_RULE}. Refusing to delete a whole namespace without { all: true }.`
      );
};
