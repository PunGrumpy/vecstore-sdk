export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
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
