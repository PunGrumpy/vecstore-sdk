import type { Filter, NonEmpty, RangeFilter, Scalar } from "./ast";

export type PineconeOperator =
  | { readonly $eq: Scalar }
  | { readonly $ne: Scalar }
  | { readonly $gt: number }
  | { readonly $gte: number }
  | { readonly $lt: number }
  | { readonly $lte: number }
  | { readonly $in: (string | number)[] }
  | { readonly $nin: (string | number)[] }
  | { readonly $exists: boolean };

export type PineconeFilter =
  | { readonly $and: PineconeFilter[] }
  | { readonly $or: PineconeFilter[] }
  | { readonly [field: string]: PineconeOperator };

const isStringOrNumber = (value: Scalar): value is string | number =>
  typeof value !== "boolean";

const membership = (
  field: string,
  values: NonEmpty<Scalar>,
  exclude: boolean
): PineconeFilter => {
  const list = values.filter(isStringOrNumber);
  if (list.length === values.length) {
    return { [field]: exclude ? { $nin: list } : { $in: list } };
  }
  const clauses = values.map((value): PineconeFilter => ({
    [field]: exclude ? { $ne: value } : { $eq: value },
  }));
  return exclude ? { $and: clauses } : { $or: clauses };
};

type Comparison = (value: number) => PineconeOperator;

const COMPARISONS: Record<
  RangeFilter["kind"],
  readonly [Comparison, Comparison]
> = {
  gt: [(value) => ({ $gt: value }), (value) => ({ $lte: value })],
  gte: [(value) => ({ $gte: value }), (value) => ({ $lt: value })],
  lt: [(value) => ({ $lt: value }), (value) => ({ $gte: value })],
  lte: [(value) => ({ $lte: value }), (value) => ({ $gt: value })],
};

const comparison = (filter: RangeFilter, negated: boolean): PineconeFilter => {
  const [operator, negatedOperator] = COMPARISONS[filter.kind];
  return {
    [filter.field]: (negated ? negatedOperator : operator)(filter.value),
  };
};

const equality = (
  field: string,
  value: Scalar,
  negated: boolean
): PineconeFilter => ({ [field]: negated ? { $ne: value } : { $eq: value } });

const compile = (filter: Filter, negated: boolean): PineconeFilter => {
  switch (filter.kind) {
    case "eq": {
      return equality(filter.field, filter.value, negated);
    }
    case "ne": {
      return equality(filter.field, filter.value, !negated);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      return comparison(filter, negated);
    }
    case "in": {
      return membership(filter.field, filter.values, negated);
    }
    case "nin": {
      return membership(filter.field, filter.values, !negated);
    }
    case "exists": {
      return { [filter.field]: { $exists: !negated } };
    }
    case "and": {
      const clauses = filter.filters.map((child) => compile(child, negated));
      return negated ? { $or: clauses } : { $and: clauses };
    }
    case "or": {
      const clauses = filter.filters.map((child) => compile(child, negated));
      return negated ? { $and: clauses } : { $or: clauses };
    }
    case "not": {
      return compile(filter.filter, !negated);
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

export const compilePineconeFilter = (filter: Filter): PineconeFilter =>
  compile(filter, false);
