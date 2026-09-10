import { err, ok } from "../result";
import type { Result } from "../result";
import type {
  EqFilter,
  Filter,
  InFilter,
  NeFilter,
  NinFilter,
  NonEmpty,
  RangeFilter,
  Scalar,
} from "./ast";

export type VectorizeComparisonOperator =
  | "$eq"
  | "$ne"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte";

export type VectorizeCollectionOperator = "$in" | "$nin";

export type VectorizeComparison = {
  readonly [Operator in VectorizeComparisonOperator]?: Scalar;
};

export type VectorizeCollection = {
  readonly [Operator in VectorizeCollectionOperator]?: Scalar[];
};

export type VectorizeCondition = VectorizeComparison | VectorizeCollection;

export interface VectorizeFilter {
  readonly [field: string]: VectorizeCondition;
}

export interface VectorizeUnsupportedFilter {
  readonly kind: "unsupported";
  readonly feature: string;
  readonly message: string;
}

export interface VectorizeInvalidFilter {
  readonly kind: "invalid_argument";
  readonly message: string;
}

export type VectorizeFilterProblem =
  | VectorizeUnsupportedFilter
  | VectorizeInvalidFilter;

export type VectorizeFilterResult = Result<
  VectorizeFilter,
  VectorizeFilterProblem
>;

interface ComparisonClause {
  readonly kind: "comparison";
  readonly field: string;
  readonly operator: VectorizeComparisonOperator;
  readonly value: Scalar;
}

interface CollectionClause {
  readonly kind: "collection";
  readonly field: string;
  readonly operator: VectorizeCollectionOperator;
  readonly values: Scalar[];
}

type Clause = ComparisonClause | CollectionClause;

const COMPARISONS: Record<
  RangeFilter["kind"],
  readonly [VectorizeComparisonOperator, VectorizeComparisonOperator]
> = {
  gt: ["$gt", "$lte"],
  gte: ["$gte", "$lt"],
  lt: ["$lt", "$gte"],
  lte: ["$lte", "$gt"],
};

const comparisonClause = (
  field: string,
  operator: VectorizeComparisonOperator,
  value: Scalar
): ComparisonClause => ({ field, kind: "comparison", operator, value });

const collectionClause = (
  field: string,
  operator: VectorizeCollectionOperator,
  values: NonEmpty<Scalar>
): CollectionClause => ({
  field,
  kind: "collection",
  operator,
  values: [...values],
});

const noOrOperator: VectorizeUnsupportedFilter = {
  feature: "orFilter",
  kind: "unsupported",
  message:
    "Vectorize joins every part of a filter with AND and has no OR operator. Run one query per branch and merge the results yourself.",
};

const noExistsOperator: VectorizeUnsupportedFilter = {
  feature: "existsFilter",
  kind: "unsupported",
  message:
    "Vectorize has no operator that tests whether a metadata property is present.",
};

const mixedOperators = (field: string): VectorizeInvalidFilter => ({
  kind: "invalid_argument",
  message: `Vectorize holds membership and comparison operators in separate objects, so it cannot filter "${field}" with both at once.`,
});

const repeatedOperator = (
  field: string,
  operator: string
): VectorizeInvalidFilter => ({
  kind: "invalid_argument",
  message: `A Vectorize filter holds one ${operator} per field, and this filter sets ${operator} on "${field}" twice.`,
});

type LeafFilter = EqFilter | NeFilter | RangeFilter | InFilter | NinFilter;

const leafClause = (filter: LeafFilter, negated: boolean): Clause => {
  switch (filter.kind) {
    case "eq": {
      return comparisonClause(
        filter.field,
        negated ? "$ne" : "$eq",
        filter.value
      );
    }
    case "ne": {
      return comparisonClause(
        filter.field,
        negated ? "$eq" : "$ne",
        filter.value
      );
    }
    case "in": {
      return collectionClause(
        filter.field,
        negated ? "$nin" : "$in",
        filter.values
      );
    }
    case "nin": {
      return collectionClause(
        filter.field,
        negated ? "$in" : "$nin",
        filter.values
      );
    }
    default: {
      const [operator, negatedOperator] = COMPARISONS[filter.kind];
      return comparisonClause(
        filter.field,
        negated ? negatedOperator : operator,
        filter.value
      );
    }
  }
};

const clausesOf = (
  filter: Filter,
  negated: boolean
): Result<Clause[], VectorizeFilterProblem> => {
  switch (filter.kind) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "in":
    case "nin": {
      return ok([leafClause(filter, negated)]);
    }
    case "exists": {
      return err(noExistsOperator);
    }
    case "and":
    case "or": {
      if ((filter.kind === "and") === negated) {
        return err(noOrOperator);
      }
      const clauses: Clause[] = [];
      for (const child of filter.filters) {
        const compiled = clausesOf(child, negated);
        if (!compiled.ok) {
          return compiled;
        }
        clauses.push(...compiled.value);
      }
      return ok(clauses);
    }
    case "not": {
      return clausesOf(filter.filter, !negated);
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

const insert = <Operator, Value>(
  groups: Map<string, Map<Operator, Value>>,
  field: string,
  operator: Operator,
  value: Value
): boolean => {
  const operators = groups.get(field) ?? new Map<Operator, Value>();
  if (operators.has(operator)) {
    return false;
  }
  operators.set(operator, value);
  groups.set(field, operators);
  return true;
};

const merge = (clauses: readonly Clause[]): VectorizeFilterResult => {
  const comparisons = new Map<
    string,
    Map<VectorizeComparisonOperator, Scalar>
  >();
  const collections = new Map<
    string,
    Map<VectorizeCollectionOperator, Scalar[]>
  >();
  for (const clause of clauses) {
    if (clause.kind === "comparison") {
      if (collections.has(clause.field)) {
        return err(mixedOperators(clause.field));
      }
      if (!insert(comparisons, clause.field, clause.operator, clause.value)) {
        return err(repeatedOperator(clause.field, clause.operator));
      }
      continue;
    }
    if (comparisons.has(clause.field)) {
      return err(mixedOperators(clause.field));
    }
    if (!insert(collections, clause.field, clause.operator, clause.values)) {
      return err(repeatedOperator(clause.field, clause.operator));
    }
  }
  const conditions: [string, VectorizeCondition][] = [];
  for (const [field, operators] of comparisons) {
    conditions.push([field, Object.fromEntries(operators)]);
  }
  for (const [field, operators] of collections) {
    conditions.push([field, Object.fromEntries(operators)]);
  }
  return ok(Object.fromEntries(conditions));
};

export const compileVectorizeFilter = (
  filter: Filter
): VectorizeFilterResult => {
  const clauses = clausesOf(filter, false);
  return clauses.ok ? merge(clauses.value) : clauses;
};
