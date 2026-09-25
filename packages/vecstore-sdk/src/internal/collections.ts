export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};

export const lastById = <T extends { readonly id: string }>(
  records: readonly T[]
): T[] => {
  const byId = new Map<string, T>();
  for (const record of records) {
    byId.set(record.id, record);
  }
  return [...byId.values()];
};

export const sortByIds = <T extends { readonly id: string }>(
  ids: readonly string[],
  records: readonly T[]
): T[] => {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered: T[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (record !== undefined) {
      ordered.push(record);
    }
  }
  return ordered;
};

export const BATCH_CONCURRENCY = 4;

export interface MapBatchesOptions<T, R> {
  readonly items: readonly T[];
  readonly size: number;
  readonly action: (batch: T[]) => Promise<R>;
  readonly concurrency?: number;
}

export const mapBatches = async <T, R>({
  items,
  size,
  action,
  concurrency = BATCH_CONCURRENCY,
}: MapBatchesOptions<T, R>): Promise<R[]> => {
  const batches = chunk(items, size);
  const results: R[] = Array.from({ length: batches.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    const position = next;
    if (position >= batches.length) {
      return;
    }
    next += 1;
    const batch = batches[position];
    if (batch !== undefined) {
      results[position] = await action(batch);
    }
    await worker();
  };
  const workers = Array.from(
    { length: Math.min(concurrency, batches.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
};
