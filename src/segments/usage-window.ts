import type { ParsedEntry } from "../utils/claude";

import { debug } from "../utils/logger";
import { PricingService } from "./pricing";
import { CacheManager } from "../utils/cache";
import { loadEntriesFromProjects } from "../utils/claude";

export interface WindowUsageEntry {
  timestamp: Date;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUSD: number;
  model: string;
}

export function getTotalTokens(usage: WindowUsageEntry["usage"]): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

export function formatDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function convertToWindowEntry(entry: ParsedEntry): WindowUsageEntry {
  return {
    timestamp: entry.timestamp,
    usage: {
      inputTokens: entry.message?.usage?.input_tokens || 0,
      outputTokens: entry.message?.usage?.output_tokens || 0,
      cacheCreationInputTokens:
        entry.message?.usage?.cache_creation_input_tokens || 0,
      cacheReadInputTokens: entry.message?.usage?.cache_read_input_tokens || 0,
    },
    costUSD: entry.costUSD || 0,
    model: entry.message?.model || "unknown",
  };
}

function parseDayString(dayStr: string): Date {
  const [year, month, day] = dayStr.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function enumerateDayStrings(windowStart: Date, today: Date): string[] {
  const days: string[] = [];
  const cursor = startOfDay(windowStart);
  const last = startOfDay(today);
  while (cursor.getTime() <= last.getTime()) {
    days.push(formatDayString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Buckets usage entries by calendar day so a multi-day window (e.g. `month`)
 * only has to re-parse transcripts for days that aren't cached yet. A day
 * strictly before today is "completed" and permanently cacheable, since
 * transcripts are appended with real-time timestamps and can't grow a past
 * day's entries retroactively. Today's own bucket is always re-parsed fresh
 * and never touches the day cache — the same cost the `today` segment has
 * always paid, so single-day callers see no regression.
 */
async function loadWindowEntries(
  windowStart: Date,
): Promise<WindowUsageEntry[]> {
  const now = new Date();
  const todayStr = formatDayString(now);
  const dayStrings = enumerateDayStrings(windowStart, now);

  const buckets = new Map<string, WindowUsageEntry[]>();
  const missing: string[] = [];

  for (const dayStr of dayStrings) {
    if (dayStr === todayStr) {
      missing.push(dayStr);
      continue;
    }
    const cached = (await CacheManager.getDayUsageCache(dayStr)) as
      | WindowUsageEntry[]
      | null;
    if (cached) {
      buckets.set(dayStr, cached);
    } else {
      missing.push(dayStr);
    }
  }

  if (missing.length > 0) {
    const scanStart = parseDayString(missing[0]!);

    debug(
      `Usage window: scanning entries from ${missing[0]} through now (${missing.length} day(s) missing)`,
    );

    // One day of slack before the scan boundary: a transcript's mtime can
    // trail the timestamps of the entries it contains, so a file untouched
    // since just before the boundary could still hold entries from just
    // after it.
    const fileFilterCutoff = new Date(scanStart);
    fileFilterCutoff.setDate(fileFilterCutoff.getDate() - 1);

    const fileFilter = (_filePath: string, modTime: Date): boolean =>
      modTime >= fileFilterCutoff;

    const timeFilter = (entry: ParsedEntry): boolean =>
      entry.timestamp >= scanStart;

    const parsedEntries = await loadEntriesFromProjects(
      timeFilter,
      fileFilter,
      true,
    );

    const freshBuckets = new Map<string, WindowUsageEntry[]>();
    for (const dayStr of missing) freshBuckets.set(dayStr, []);

    let entriesFound = 0;
    for (const entry of parsedEntries) {
      const bucket = freshBuckets.get(formatDayString(entry.timestamp));
      if (!bucket || !entry.message?.usage) continue;

      const windowEntry = convertToWindowEntry(entry);
      if (!windowEntry.costUSD && entry.raw) {
        windowEntry.costUSD = await PricingService.calculateCostForEntry(
          entry.raw,
        );
      }
      bucket.push(windowEntry);
      entriesFound++;
    }

    debug(
      `Usage window: found ${entriesFound} entries across ${missing.length} day(s)`,
    );

    for (const dayStr of missing) {
      const bucket = freshBuckets.get(dayStr)!;
      buckets.set(dayStr, bucket);
      if (dayStr !== todayStr) {
        await CacheManager.setDayUsageCache(dayStr, bucket);
      }
    }
  }

  const result: WindowUsageEntry[] = [];
  for (const dayStr of dayStrings) {
    result.push(...(buckets.get(dayStr) ?? []));
  }
  return result;
}

export async function getWindowEntries(
  windowStart: Date,
): Promise<WindowUsageEntry[]> {
  try {
    return await loadWindowEntries(windowStart);
  } catch (error) {
    debug("Error loading usage window entries:", error);
    return [];
  }
}
