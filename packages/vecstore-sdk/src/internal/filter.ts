import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { Filter, Scalar } from "../filter/ast";
import { isBoolean, isNumber, isObjectLike, isString } from "./guards";

type LeafFilter = Exclude<Filter, { readonly kind: "and" | "or" | "not" }>;

const VALUE_RULE = "a string, a finite number, or a boolean";

const isFiniteNumber = (value: unknown): value is number =>
  isNumber(value) && Number.isFinite(value);

const isScalar = (value: unknown): value is Scalar =>
  isString(value) || isBoolean(value) || isFiniteNumber(value);

const isScalarList = (value: unknown): value is Scalar[] =>
  Array.isArray(value) && value.length > 0 && value.every(isScalar);

const isNonEmptyList = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0;

const leafProblem = (filter: LeafFilter): string | undefined => {
  switch (filter.kind) {
    case "eq":
    case "ne": {
      return isScalar(filter.value)
        ? undefined
        : `"${filter.kind}" on "${filter.field}" needs ${VALUE_RULE}, received ${String(filter.value)}.`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      return isFiniteNumber(filter.value)
        ? undefined
        : `"${filter.kind}" on "${filter.field}" needs a finite number, received ${String(filter.value)}.`;
    }
    case "in":
    case "nin": {
      return isScalarList(filter.values)
        ? undefined
        : `"${filter.kind}" on "${filter.field}" needs a non-empty list where every value is ${VALUE_RULE}.`;
    }
    case "exists": {
      return undefined;
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

const filterProblem = (filter: Filter): string | undefined => {
  if (!isObjectLike(filter)) {
    return "A filter must be an object built with the filter helpers.";
  }
  switch (filter.kind) {
    case "and":
    case "or": {
      if (!isNonEmptyList(filter.filters)) {
        return `"${filter.kind}" needs at least one filter.`;
      }
      for (const child of filter.filters) {
        const problem = filterProblem(child);
        if (problem !== undefined) {
          return problem;
        }
      }
      return undefined;
    }
    case "not": {
      return filterProblem(filter.filter);
    }
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "in":
    case "nin":
    case "exists": {
      return isString(filter.field)
        ? leafProblem(filter)
        : `"${filter.kind}" needs a field name.`;
    }
    default: {
      const exhaustive: never = filter;
      return `Unknown filter ${JSON.stringify(exhaustive)}.`;
    }
  }
};

export const filterError = (
  provider: Provider,
  filter: Filter
): VecstoreError | undefined => {
  const problem = filterProblem(filter);
  return problem === undefined ? undefined : invalidArgument(provider, problem);
};
