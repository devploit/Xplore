import { DAY_MS, dayLabel, periodStart } from "./buckets";
import type { Tweet } from "./types";

export interface FrequencyCell {
  day: string;
  start: number;
  count: number;
}

export interface FrequencyGrid {
  /** weeks[w][d], d = 0 Monday .. 6 Sunday, oldest week first */
  weeks: FrequencyCell[][];
  max: number;
  min: number;
  avg: number;
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** GitHub-style grid of daily activity for the last `weeks` weeks, ending with the current week. */
export function frequencyGrid(tweets: Tweet[], weeks = 18, now: number = Date.now(), statsDays?: number): FrequencyGrid {
  const today = new Date(periodStart(0, now));
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (6 - mondayIndex(today)));
  const start = new Date(endOfWeek);
  start.setDate(endOfWeek.getDate() - weeks * 7 + 1);
  const counts = new Map<string, number>();
  for (const t of tweets) {
    if (t.created_at < start.getTime()) continue;
    const key = dayLabel(new Date(t.created_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const grid: FrequencyCell[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const week: FrequencyCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = dayLabel(cursor);
      week.push({ day, start: cursor.getTime(), count: counts.get(day) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(week);
  }
  const windowDays = statsDays ?? weeks * 7;
  const windowStart = periodStart(Math.max(0, windowDays - 1), now);
  const values = grid.flat().filter((c) => c.start >= windowStart && c.start <= today.getTime()).map((c) => c.count);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { weeks: grid, max, min, avg };
}

export interface HourCell {
  impressions: number;
  count: number;
}

/** grid[weekday][hour] with weekday 0 = Monday, of impressions and tweet counts. */
export function hourWeekdayGrid(tweets: Tweet[]): HourCell[][] {
  const grid: HourCell[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ impressions: 0, count: 0 })));
  for (const t of tweets) {
    const d = new Date(t.created_at);
    const cell = grid[mondayIndex(d)]![d.getHours()]!;
    cell.impressions += t.view_count;
    cell.count += 1;
  }
  return grid;
}

export { DAY_MS };
