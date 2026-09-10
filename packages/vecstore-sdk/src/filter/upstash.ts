import { isNumber, isString } from "../internal/guards";
import type { Filter, NonEmpty, RangeFilter, Scalar } from "./ast";

const UPSTASH_FILTER_ERROR = "UpstashFilterError";

const IDENTIFIER_PATTERN = /^[A-Za-z_][\w.[\]#-]*$/u;

const filterError = (message: string): Error =>
  Object.assign(new Error(message), { name: UPSTASH_FILTER_ERROR });

export const isUpstashFilterError = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === UPSTASH_FILTER_ERROR;

const identifier = (field: string): string => {
  if (IDENTIFIER_PATTERN.test(field)) {
    return field;
  }
  throw filterError(
    `Upstash cannot filter on the metadata field "${field}". Field names must match ${IDENTIFIER_PATTERN.source}.`
  );
};

const stringLiteral = (value: string): string => {
  if (value.includes("\\")) {
    throw filterError(
      `Upstash filter values cannot contain a backslash, received "${value}".`
    );
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  throw filterError(
    `Upstash filter values cannot contain both quote characters, received "${value}".`
  );
};

const numberLiteral = (value: number): string => {
  if (Number.isFinite(value)) {
    return String(value);
  }
  throw filterError(
    `Upstash filter values must be finite numbers, received ${String(value)}.`
  );
};

const literal = (value: Scalar): string => {
  if (isString(value)) {
    return stringLiteral(value);
  }
  if (isNumber(value)) {
    return numberLiteral(value);
  }
  return value ? "true" : "false";
};

const COMPARISONS: Record<RangeFilter["kind"], readonly [string, string]> = {
  gt: [">", "<="],
  gte: [">=", "<"],
  lt: ["<", ">="],
  lte: ["<=", ">"],
};

const equality = (field: string, value: Scalar, negated: boolean): string =>
  `${identifier(field)} ${negated ? "!=" : "="} ${literal(value)}`;

const comparison = (filter: RangeFilter, negated: boolean): string => {
  const [operator, negatedOperator] = COMPARISONS[filter.kind];
  const selected = negated ? negatedOperator : operator;
  return `${identifier(filter.field)} ${selected} ${numberLiteral(filter.value)}`;
};

const membership = (
  field: string,
  values: NonEmpty<Scalar>,
  exclude: boolean
): string => {
  const operator = exclude ? "NOT IN" : "IN";
  const list = values.map(literal).join(", ");
  return `${identifier(field)} ${operator} (${list})`;
};

const compile = (filter: Filter, negated: boolean): string => {
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
      const operator = negated ? "HAS NOT FIELD" : "HAS FIELD";
      return `${operator} ${identifier(filter.field)}`;
    }
    case "and": {
      const clauses = filter.filters.map((child) => compile(child, negated));
      return `(${clauses.join(negated ? " OR " : " AND ")})`;
    }
    case "or": {
      const clauses = filter.filters.map((child) => compile(child, negated));
      return `(${clauses.join(negated ? " AND " : " OR ")})`;
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

export const compileUpstashFilter = (filter: Filter): string =>
  compile(filter, false);
