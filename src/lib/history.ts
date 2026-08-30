const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return "";

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const span = max - min;
  const flat = BLOCKS[3] ?? "▄";
  if (span === 0) return flat.repeat(values.length);

  return values
    .map((value) => {
      const index = Math.min(BLOCKS.length - 1, Math.floor(((value - min) / span) * BLOCKS.length));
      return BLOCKS[index] ?? flat;
    })
    .join("");
}

export function percentChange(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round(((from - to) / from) * 1000) / 10;
}
