/** SuperX's estimate: 1.5 USD per 117,370 impressions. */
export const VIEWS_PER_UNIT = 117_370;
export const USD_PER_UNIT = 1.5;

export function estimateEarnings(impressions: number): number {
  return (impressions / VIEWS_PER_UNIT) * USD_PER_UNIT;
}
