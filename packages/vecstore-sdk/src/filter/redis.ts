import { isNumber, isString } from "../internal/guards";
import { err, ok } from "../result";
import type { Result } from "../result";
import type {
  AndFilter,
  EqFilter,
  Filter,
  InFilter,
  NeFilter,
  NinFilter,
  NonEmpty,
  OrFilter,
  RangeFilter,
  Scalar,
} from "./ast";

export type RedisFieldType = "tag" | "numeric";

export interface RedisMetadataField {
  readonly field: string;
  readonly type: RedisFieldType;
}

export interface RedisFilterProblem {
  readonly kind: "invalid_argument";
  readonly field: string;
  readonly message: string;
}

export type RedisFilterResult = Result<string, RedisFilterProblem>;

export const REDIS_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const REDIS_RESERVED_FIELDS: ReadonlySet<string> = new Set([
  "namespace",
  "vector",
  "vector_distance",
]);

const TAG_ESCAPE_PATTERN = /["\\]/gu;

const RANGE_BOUNDS: Record<
  RangeFilter["kind"],
  (value: string) => readonly [string, string]
> = {
  gt: (value) => [`(${value}`, "+inf"],
  gte: (value) => [value, "+inf"],
  lt: (value) => ["-inf", `(${value}`],
  lte: (value) => ["-inf", value],
};

const problem = (field: string, message: string): RedisFilterProblem => ({
  field,
  kind: "invalid_argument",
  message,
});

const unknownField = (field: string): RedisFilterProblem =>
  problem(
    field,
    `Redis matches nothing on "${field}", because the index schema has no such field. List it in metadataFields before you create the index.`
  );

const reservedField = (field: string): RedisFilterProblem =>
  problem(
    field,
    `The Redis adapter keeps "${field}" for itself. Rename the metadata field.`
  );

const malformedField = (field: string): RedisFilterProblem =>
  problem(
    field,
    `Redis cannot name a field "${field}". A field name must match ${REDIS_FIELD_PATTERN.source}.`
  );

const tagHoldsNoNumber = (field: string): RedisFilterProblem =>
  problem(
    field,
    `Redis indexes a number as NUMERIC and never as TAG, and "${field}" is a tag field. Compare it against a string or a boolean, or declare it as numeric.`
  );

const numericHoldsOnlyNumbers = (field: string): RedisFilterProblem =>
  problem(
    field,
    `Redis compares a NUMERIC field against numbers only, and "${field}" is a numeric field. Compare it against a number, or declare it as a tag.`
  );

const rangeNeedsNumeric = (field: string): RedisFilterProblem =>
  problem(
    field,
    `Redis orders values in a NUMERIC field only, and "${field}" is a tag field. Declare it as numeric to compare it with gt, gte, lt, or lte.`
  );

const finiteNumbersOnly = (field: string, value: number): RedisFilterProblem =>
  problem(
    field,
    `Redis compares finite numbers only, and the filter on "${field}" carries ${String(value)}.`
  );

const escapeCharacter = (character: string): string => `\\${character}`;

export const escapeRedisTag = (value: string): string =>
  `"${value.replaceAll(TAG_ESCAPE_PATTERN, escapeCharacter)}"`;

export const redisTagClause = (field: string, value: string): string =>
  `@${field}:{${escapeRedisTag(value)}}`;

type FieldTypes = ReadonlyMap<string, RedisFieldType>;

const fieldTypes = (fields: readonly RedisMetadataField[]): FieldTypes =>
  new Map(fields.map((field) => [field.field, field.type]));

const typeOfField = (
  field: string,
  types: FieldTypes
): Result<RedisFieldType, RedisFilterProblem> => {
  if (REDIS_RESERVED_FIELDS.has(field)) {
    return err(reservedField(field));
  }
  if (!REDIS_FIELD_PATTERN.test(field)) {
    return err(malformedField(field));
  }
  const type = types.get(field);
  return type === undefined ? err(unknownField(field)) : ok(type);
};

const tagValue = (field: string, value: Scalar): RedisFilterResult => {
  if (isNumber(value)) {
    return err(tagHoldsNoNumber(field));
  }
  return ok(isString(value) ? value : String(value));
};

const numericValue = (field: string, value: Scalar): RedisFilterResult => {
  if (!isNumber(value)) {
    return err(numericHoldsOnlyNumbers(field));
  }
  return Number.isFinite(value)
    ? ok(String(value))
    : err(finiteNumbersOnly(field, value));
};

const numericMatch = (field: string, value: string): string =>
  `@${field}:[${value} ${value}]`;

const equality = (
  field: string,
  type: RedisFieldType,
  value: Scalar
): RedisFilterResult => {
  if (type === "numeric") {
    const number = numericValue(field, value);
    return number.ok ? ok(numericMatch(field, number.value)) : number;
  }
  const tag = tagValue(field, value);
  return tag.ok ? ok(redisTagClause(field, tag.value)) : tag;
};

const comparison = (
  field: string,
  type: RedisFieldType,
  filter: RangeFilter
): RedisFilterResult => {
  if (type === "tag") {
    return err(rangeNeedsNumeric(field));
  }
  const number = numericValue(field, filter.value);
  if (!number.ok) {
    return number;
  }
  const [start, end] = RANGE_BOUNDS[filter.kind](number.value);
  return ok(`@${field}:[${start} ${end}]`);
};

const tagMembership = (
  field: string,
  values: NonEmpty<Scalar>
): RedisFilterResult => {
  const tags: string[] = [];
  for (const value of values) {
    const tag = tagValue(field, value);
    if (!tag.ok) {
      return tag;
    }
    tags.push(escapeRedisTag(tag.value));
  }
  return ok(`@${field}:{${tags.join(" | ")}}`);
};

const numericMembership = (
  field: string,
  values: NonEmpty<Scalar>
): RedisFilterResult => {
  const matches: string[] = [];
  for (const value of values) {
    const number = numericValue(field, value);
    if (!number.ok) {
      return number;
    }
    matches.push(numericMatch(field, number.value));
  }
  return ok(`(${matches.join(" | ")})`);
};

type LeafFilter = EqFilter | NeFilter | RangeFilter | InFilter | NinFilter;

const leafClause = (
  filter: LeafFilter,
  type: RedisFieldType
): RedisFilterResult => {
  switch (filter.kind) {
    case "eq":
    case "ne": {
      return equality(filter.field, type, filter.value);
    }
    case "in":
    case "nin": {
      return type === "tag"
        ? tagMembership(filter.field, filter.values)
        : numericMembership(filter.field, filter.values);
    }
    default: {
      return comparison(filter.field, type, filter);
    }
  }
};

const isNegatedLeaf = (filter: LeafFilter): boolean =>
  filter.kind === "ne" || filter.kind === "nin";

const negate = (clause: string): string => `-(${clause})`;

const compileLeaf = (
  filter: LeafFilter,
  types: FieldTypes,
  negated: boolean
): RedisFilterResult => {
  const type = typeOfField(filter.field, types);
  if (!type.ok) {
    return type;
  }
  const clause = leafClause(filter, type.value);
  if (!clause.ok) {
    return clause;
  }
  return ok(
    isNegatedLeaf(filter) === negated ? clause.value : negate(clause.value)
  );
};

type CompileNode = (
  filter: Filter,
  types: FieldTypes,
  negated: boolean
) => RedisFilterResult;

const compileGroup = (
  filter: AndFilter | OrFilter,
  types: FieldTypes,
  compile: CompileNode
): RedisFilterResult => {
  const clauses: string[] = [];
  for (const child of filter.filters) {
    const compiled = compile(child, types, false);
    if (!compiled.ok) {
      return compiled;
    }
    clauses.push(compiled.value);
  }
  const separator = filter.kind === "and" ? " " : " | ";
  return ok(`(${clauses.join(separator)})`);
};

const compileExists = (
  field: string,
  types: FieldTypes,
  negated: boolean
): RedisFilterResult => {
  const type = typeOfField(field, types);
  if (!type.ok) {
    return type;
  }
  const clause = `ismissing(@${field})`;
  return ok(negated ? clause : `-${clause}`);
};

const compileNode: CompileNode = (filter, types, negated) => {
  switch (filter.kind) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "in":
    case "nin": {
      return compileLeaf(filter, types, negated);
    }
    case "exists": {
      return compileExists(filter.field, types, negated);
    }
    case "and":
    case "or": {
      const group = compileGroup(filter, types, compileNode);
      if (!group.ok) {
        return group;
      }
      return ok(negated ? negate(group.value) : group.value);
    }
    case "not": {
      return compileNode(filter.filter, types, !negated);
    }
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
};

export const compileRedisFilter = (
  filter: Filter,
  fields: readonly RedisMetadataField[]
): RedisFilterResult => compileNode(filter, fieldTypes(fields), false);
