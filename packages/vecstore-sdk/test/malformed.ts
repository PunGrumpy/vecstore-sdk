import type { Filter } from "../src/filter/ast";
import type { DeleteSelector } from "../src/types";

export const looseFilter = (json: string): Filter => JSON.parse(json);

export const looseSelector = (json: string): DeleteSelector => JSON.parse(json);

export const filterWithoutValue = looseFilter('{"kind":"eq","field":"genre"}');

export const emptySelector = looseSelector("{}");
