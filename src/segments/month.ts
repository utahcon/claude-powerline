import type { TokenBreakdown } from "./session";
import type { WindowUsageEntry } from "./usage-window";

import { debug } from "../utils/logger";
import { getWindowEntries, getTotalTokens } from "./usage-window";

export type MonthUsageEntry = WindowUsageEntry;

export interface MonthInfo {
  cost: number | null;
  tokens: number | null;
  tokenBreakdown: TokenBreakdown | null;
  month: string;
}

function formatMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function startOfMonth(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

export class MonthProvider {
  async getMonthInfo(): Promise<MonthInfo> {
    const now = new Date();

    try {
      const entries = await getWindowEntries(startOfMonth(now));

      if (entries.length === 0) {
        return {
          cost: null,
          tokens: null,
          tokenBreakdown: null,
          month: formatMonth(now),
        };
      }

      const totalCost = entries.reduce((sum, entry) => sum + entry.costUSD, 0);
      const totalTokens = entries.reduce(
        (sum, entry) => sum + getTotalTokens(entry.usage),
        0,
      );

      const tokenBreakdown = entries.reduce(
        (breakdown, entry) => ({
          input: breakdown.input + entry.usage.inputTokens,
          output: breakdown.output + entry.usage.outputTokens,
          cacheCreation:
            breakdown.cacheCreation + entry.usage.cacheCreationInputTokens,
          cacheRead: breakdown.cacheRead + entry.usage.cacheReadInputTokens,
        }),
        {
          input: 0,
          output: 0,
          cacheCreation: 0,
          cacheRead: 0,
        },
      );

      debug(
        `Month segment: $${totalCost.toFixed(2)}, ${totalTokens} tokens total`,
      );

      return {
        cost: totalCost,
        tokens: totalTokens,
        tokenBreakdown,
        month: formatMonth(now),
      };
    } catch (error) {
      debug("Error getting month's info:", error);
      return {
        cost: null,
        tokens: null,
        tokenBreakdown: null,
        month: formatMonth(now),
      };
    }
  }
}
