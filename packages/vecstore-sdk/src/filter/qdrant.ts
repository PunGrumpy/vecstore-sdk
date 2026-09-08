import type { Filter, NonEmpty, Scalar } from "./ast";

export interface QdrantMatchValue {
  readonly value: Scalar;
}

export interface QdrantMatchAny {
  readonly any: string[] | number[];
}

export interface QdrantMatchExcept {
  readonly except: string[] | number[];
}

export interface QdrantRange {
  readonly gt?: number;
  readonly gte?: number;
  readonly lt?: number;
  readonly lte?: number;
}

export interface QdrantMatchCondition {
  readonly key: string;
  readonly match: QdrantMatchValue | QdrantMatchAny | QdrantMatchExcept;
}

export interface QdrantRangeCondition {
  readonly key: string;
  readonly range: QdrantRange;
}

export interface QdrantIsEmptyCondition {
  readonly is_empty: { readonly key: string };
}

export type QdrantCondition =
  | QdrantMatchCondition
  | QdrantRangeCondition
  | QdrantIsEmptyCondition
  | QdrantFilter;

export interface QdrantFilter {
  readonly must?: QdrantCondition[];
  readonly should?: QdrantCondition[];
  readonly must_not?: QdrantCondition[];
}

const isStringList = (values: readonly Scalar[]): values is string[] =>
  values.every((value): value is string => typeof value === "string");

const isIntegerList = (values: readonly Scalar[]): values is number[] =>
  values.every(
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value)
  );

const isFloat = (value: Scalar): value is number =>
  typeof value === "number" && !Number.isInteger(value);

const equalsCondition = (
  field: string,
  value: Scalar
): QdrantMatchCondition | QdrantRangeCondition =>
  isFloat(value)
    ? { key: field, range: { gte: value, lte: value } }
    : { key: field, match: { value } };

const membership = (
  field: string,
  values: NonEmpty<Scalar>,
  exclude: boolean
): QdrantCondition => {
  const list = [...values];
  if (isStringList(list) || isIntegerList(list)) {
    return { key: field, match: exclude ? { except: list } : { any: list } };
  }
  const conditions = list.map((value) => equalsCondition(field, value));
  return exclude ? { must_not: conditions } : { should: conditions };
};

const toCondition = (filter: Filter): QdrantCondition => {
  switch (filter.kind) {
    case "eq": {
      return equalsCondition(filter.field, filter.value);
    }
    case "ne": {
      return { must_not: [equalsCondition(filter.field, filter.value)] };
    }
    case "gt": {
      return { key: filter.field, range: { gt: filter.value } };
    }
    case "gte": {
      return { key: filter.field, range: { gte: filter.value } };
    }
    case "lt": {
      return { key: filter.field, range: { lt: filter.value } };
    }
    case "lte": {
      return { key: filter.field, range: { lte: filter.value } };
    }
    case "in": {
      return membership(filter.field, filter.values, false);
    }
    case "nin": {
      return membership(filter.field, filter.values, true);
    }
    case "exists": {
      return { must_not: [{ is_empty: { key: filter.field } }] };
    }
    case "and": {
      return { must: filter.filters.map(toCondition) };
    }
    case "or": {
      return { should: filter.filters.map(toCondition) };
    }
    case "not": {
      return { must_not: [toCondition(filter.filter)] };
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

const isQdrantFilter = (
  condition: QdrantCondition
): condition is QdrantFilter =>
  !("key" in condition) && !("is_empty" in condition);

export const compileQdrantFilter = (filter: Filter): QdrantFilter => {
  const condition = toCondition(filter);
  return isQdrantFilter(condition) ? condition : { must: [condition] };
};
