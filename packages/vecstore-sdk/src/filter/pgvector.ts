import type { Filter } from "./ast";

export interface PgvectorSql {
  readonly text: string;
  readonly params: string[];
}

export interface CompilePgvectorFilterOptions {
  readonly column?: string;
  readonly startIndex?: number;
}

type Param = (value: string) => string;

const RANGE_OPERATORS = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
} as const;

const compileNode = (filter: Filter, column: string, param: Param): string => {
  const fieldPath = (field: string): string =>
    `(${column}->${param(field)}::text)`;
  switch (filter.kind) {
    case "eq": {
      return `${column} @> ${param(JSON.stringify({ [filter.field]: filter.value }))}::jsonb`;
    }
    case "ne": {
      return `NOT (${column} @> ${param(JSON.stringify({ [filter.field]: filter.value }))}::jsonb)`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const path = fieldPath(filter.field);
      const operator = RANGE_OPERATORS[filter.kind];
      const value = `${param(JSON.stringify(filter.value))}::jsonb`;
      return `(jsonb_typeof(${path}) = 'number' AND ${path} ${operator} ${value})`;
    }
    case "in": {
      const path = fieldPath(filter.field);
      return `${path} <@ ${param(JSON.stringify(filter.values))}::jsonb`;
    }
    case "nin": {
      const path = fieldPath(filter.field);
      return `NOT COALESCE(${path} <@ ${param(JSON.stringify(filter.values))}::jsonb, false)`;
    }
    case "exists": {
      const path = fieldPath(filter.field);
      return `(${path} IS NOT NULL AND jsonb_typeof(${path}) <> 'null')`;
    }
    case "and": {
      return `(${filter.filters
        .map((child) => compileNode(child, column, param))
        .join(" AND ")})`;
    }
    case "or": {
      return `(${filter.filters
        .map((child) => compileNode(child, column, param))
        .join(" OR ")})`;
    }
    case "not": {
      return `NOT (${compileNode(filter.filter, column, param)})`;
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

export const compilePgvectorFilter = (
  filter: Filter,
  options: CompilePgvectorFilterOptions = {}
): PgvectorSql => {
  const column = options.column ?? "metadata";
  const startIndex = options.startIndex ?? 1;
  const params: string[] = [];
  const param: Param = (value) => {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  };
  const text = compileNode(filter, column, param);
  return { params, text };
};
