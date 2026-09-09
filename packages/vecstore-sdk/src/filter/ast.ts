export type Scalar = string | number | boolean;

export type NonEmpty<T> = readonly [T, ...T[]];

export interface EqFilter {
  readonly kind: "eq";
  readonly field: string;
  readonly value: Scalar;
}

export interface NeFilter {
  readonly kind: "ne";
  readonly field: string;
  readonly value: Scalar;
}

export interface GtFilter {
  readonly kind: "gt";
  readonly field: string;
  readonly value: number;
}

export interface GteFilter {
  readonly kind: "gte";
  readonly field: string;
  readonly value: number;
}

export interface LtFilter {
  readonly kind: "lt";
  readonly field: string;
  readonly value: number;
}

export interface LteFilter {
  readonly kind: "lte";
  readonly field: string;
  readonly value: number;
}

export interface InFilter {
  readonly kind: "in";
  readonly field: string;
  readonly values: NonEmpty<Scalar>;
}

export interface NinFilter {
  readonly kind: "nin";
  readonly field: string;
  readonly values: NonEmpty<Scalar>;
}

export interface ExistsFilter {
  readonly kind: "exists";
  readonly field: string;
}

export interface AndFilter {
  readonly kind: "and";
  readonly filters: NonEmpty<Filter>;
}

export interface OrFilter {
  readonly kind: "or";
  readonly filters: NonEmpty<Filter>;
}

export interface NotFilter {
  readonly kind: "not";
  readonly filter: Filter;
}

export type RangeFilter = GtFilter | GteFilter | LtFilter | LteFilter;

export type Filter =
  | EqFilter
  | NeFilter
  | RangeFilter
  | InFilter
  | NinFilter
  | ExistsFilter
  | AndFilter
  | OrFilter
  | NotFilter;

export const eq = (field: string, value: Scalar): EqFilter => ({
  field,
  kind: "eq",
  value,
});

export const ne = (field: string, value: Scalar): NeFilter => ({
  field,
  kind: "ne",
  value,
});

export const gt = (field: string, value: number): GtFilter => ({
  field,
  kind: "gt",
  value,
});

export const gte = (field: string, value: number): GteFilter => ({
  field,
  kind: "gte",
  value,
});

export const lt = (field: string, value: number): LtFilter => ({
  field,
  kind: "lt",
  value,
});

export const lte = (field: string, value: number): LteFilter => ({
  field,
  kind: "lte",
  value,
});

export const isIn = (field: string, values: NonEmpty<Scalar>): InFilter => ({
  field,
  kind: "in",
  values,
});

export const notIn = (field: string, values: NonEmpty<Scalar>): NinFilter => ({
  field,
  kind: "nin",
  values,
});

export const exists = (field: string): ExistsFilter => ({
  field,
  kind: "exists",
});

export const and = (first: Filter, ...rest: Filter[]): AndFilter => ({
  filters: [first, ...rest],
  kind: "and",
});

export const or = (first: Filter, ...rest: Filter[]): OrFilter => ({
  filters: [first, ...rest],
  kind: "or",
});

export const not = (filter: Filter): NotFilter => ({ filter, kind: "not" });
