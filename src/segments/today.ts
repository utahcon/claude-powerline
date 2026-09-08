import type { TokenBreakdown } from "./session";
import type { WindowUsageEntry } from "./usage-window";

import { debug } from "../utils/logger";
import { getWindowEntries, getTotalTokens, startOfDay } from "./usage-window";

export type TodayUsageEntry = WindowUsageEntry;

export interface TodayInfo {
  cost: number | null;
  tokens: number | null;
  tokenBreakdown: TokenBreakdown | null;
  date: string;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class TodayProvider {
  async getTodayInfo(): Promise<TodayInfo> {
    const now = new Date();

    try {
      const entries = await getWindowEntries(startOfDay(now));

      if (entries.length === 0) {
        return {
          cost: null,
          tokens: null,
          tokenBreakdown: null,
          date: formatDate(now),
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
        `Today segment: $${totalCost.toFixed(2)}, ${totalTokens} tokens total`,
      );

      return {
        cost: totalCost,
        tokens: totalTokens,
        tokenBreakdown,
        date: formatDate(now),
      };
    } catch (error) {
      debug("Error getting today's info:", error);
      return {
        cost: null,
        tokens: null,
        tokenBreakdown: null,
        date: formatDate(now),
      };
    }
  }
}
