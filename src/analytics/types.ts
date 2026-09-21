import type { TweetRow } from "@/data/db";

export type Interval = "hour" | "day";

export interface Bucket {
  /** inclusive start, epoch ms, local time */
  start: number;
  /** exclusive end, epoch ms */
  end: number;
  /** local label: YYYY-MM-DD for days, YYYY-MM-DD HH:00 for hours */
  label: string;
}

export interface Point {
  label: string;
  start: number;
  end: number;
  value: number;
  /** tweets published inside the bucket, when the series knows it */
  count?: number;
}

export type TweetKind = "tweet" | "reply" | "retweet";

export type Tweet = TweetRow;

/** Sentinel period value: the range comes from settings.customRange. */
export const CUSTOM_PERIOD = -2;

export const PERIODS = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "All time", days: -1 },
  { label: "Custom range", days: -2 },
] as const;

export type PeriodDays = (typeof PERIODS)[number]["days"];
