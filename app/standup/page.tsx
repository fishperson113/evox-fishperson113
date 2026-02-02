"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ChevronLeft, ChevronRight, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StandupSummary } from "@/components/standup-summary";
import { StandupAgentCard } from "@/components/standup-agent-card";

/** Map agent role to StandupAgentCard color */
const roleToColor = {
  backend: "green" as const,
  frontend: "purple" as const,
  pm: "blue" as const,
};

/** Time filter preset for standup (AGT-131) */
export type StandupTimeFilter = "full" | "morning" | "afternoon" | "evening";

/** AGT-138: Standup range — Day (single day), Week (last 7 days), 30 Days (last 30 days) */
export type StandupRangeMode = "day" | "week" | "30days";

/** User's local day + optional time window as UTC ms for Convex standup */
function getDayRangeWithTimeFilter(
  d: Date,
  filter: StandupTimeFilter
): { startTs: number; endTs: number } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  let start: number;
  let end: number;
  if (filter === "full") {
    start = new Date(y, m, day).getTime();
    end = start + 24 * 60 * 60 * 1000 - 1;
  } else if (filter === "morning") {
    start = new Date(y, m, day, 0, 0, 0, 0).getTime();
    end = new Date(y, m, day, 12, 0, 0, 0).getTime() - 1;
  } else if (filter === "afternoon") {
    start = new Date(y, m, day, 12, 0, 0, 0).getTime();
    end = new Date(y, m, day, 18, 0, 0, 0).getTime() - 1;
  } else {
    // evening: 18:00–24:00
    start = new Date(y, m, day, 18, 0, 0, 0).getTime();
    end = new Date(y, m, day, 23, 59, 59, 999).getTime();
  }
  return { startTs: start, endTs: end };
}

/** AGT-138: Compute startTs/endTs for Day / Week / 30 Days */
function getRangeForMode(
  rangeMode: StandupRangeMode,
  date: Date,
  timeFilter: StandupTimeFilter
): { startTs: number; endTs: number } {
  if (rangeMode === "day") {
    return getDayRangeWithTimeFilter(date, timeFilter);
  }
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const daysAgo = rangeMode === "week" ? 7 : 30;
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - daysAgo);
  const startOfRange = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  return { startTs: startOfRange, endTs: endOfToday };
}

const TIME_FILTER_LABELS: Record<StandupTimeFilter, string> = {
  full: "Full day",
  morning: "Morning (00:00–12:00)",
  afternoon: "Afternoon (12:00–18:00)",
  evening: "Evening (18:00–24:00)",
};

const RANGE_MODE_LABELS: Record<StandupRangeMode, string> = {
  day: "Day",
  week: "Week",
  "30days": "30 Days",
};

const SYNC_INTERVAL_MS = 60 * 1000; // 60s (AGT-133)

/** Never show raw Convex _id — identifier column only linearIdentifier or "—" (BUG 2) */
function sanitizeIdentifier(linearIdentifier?: string | null): string {
  if (!linearIdentifier || typeof linearIdentifier !== "string") return "—";
  if (linearIdentifier.length >= 26 && /^[a-z0-9]+$/i.test(linearIdentifier)) return "—";
  return linearIdentifier;
}

export default function StandupPage() {
  const [date, setDate] = useState(new Date());
  const [timeFilter, setTimeFilter] = useState<StandupTimeFilter>("full");
  const [rangeMode, setRangeMode] = useState<StandupRangeMode>("day");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "success">("idle");
  const dayRange = useMemo(
    () => getRangeForMode(rangeMode, date, timeFilter),
    [rangeMode, date, timeFilter]
  );

  const standupData = useQuery(api.standup.getDaily, dayRange);
  const standupSummary = useQuery(api.standup.getDailySummary, dayRange);
  const triggerSync = useAction(api.linearSync.triggerSync);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AGT-133: Auto-sync on mount + every 60s (manual Sync Now still available)
  useEffect(() => {
    const runSync = () => {
      triggerSync({}).catch((err) => console.warn("Standup auto-sync failed:", err));
    };
    runSync();
    syncIntervalRef.current = setInterval(runSync, SYNC_INTERVAL_MS);
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [triggerSync]);

  const formatDate = (d: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d);
  };

  const isToday = (d: Date) => {
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  };

  const goToPrevDay = () => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() - 1);
    setDate(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    setDate(newDate);
  };

  const goToToday = () => {
    setDate(new Date());
  };

  const handleSyncNow = async () => {
    setSyncState("syncing");
    try {
      await triggerSync({});
      setSyncState("success");
    } catch (error) {
      console.error("Sync failed:", error);
      setSyncState("idle");
    }
  };

  // Fade success state back to idle after 2 seconds
  useEffect(() => {
    if (syncState === "success") {
      const timer = setTimeout(() => {
        setSyncState("idle");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [syncState]);

  // AGT-142: Canonical standup agents — display "Max" not "Son", order Max → Sam → Leo
  const STANDUP_DISPLAY_NAMES: Record<string, string> = {
    Son: "Max",
    son: "Max",
    Max: "Max",
    SAM: "Sam",
    Sam: "Sam",
    sam: "Sam",
    LEO: "Leo",
    Leo: "Leo",
    leo: "Leo",
  };
  const STANDUP_ORDER = ["Max", "Sam", "Leo"];

  const agentCards = useMemo(() => {
    if (!standupData?.agents) return [];
    const toTask = (t: { id: string; title: string; linearIdentifier?: string | null }) => ({
      id: t.id,
      title: t.title,
      identifier: sanitizeIdentifier(t.linearIdentifier),
    });
    const cards = standupData.agents.map((report) => {
      const color = roleToColor[report.agent.role] ?? "blue";
      const rawName = report.agent.name ?? "Unknown";
      const displayName = STANDUP_DISPLAY_NAMES[rawName] ?? rawName;
      return {
        displayName,
        rawName,
        avatar: report.agent.avatar ?? "?",
        color,
        done: report.completed.map(toTask),
        wip: report.inProgress.map(toTask),
        backlog: report.backlog.map(toTask),
        blocked: report.blocked.map(toTask),
      };
    });
    // Sort: Max, Sam, Leo (fill missing with empty so we always show 3)
    const byDisplay = new Map(cards.map((c) => [c.displayName, c]));
    return STANDUP_ORDER.map((name) => {
      const existing = byDisplay.get(name);
      if (existing)
        return {
          name: existing.displayName,
          avatar: existing.avatar,
          color: existing.color,
          done: existing.done,
          wip: existing.wip,
          backlog: existing.backlog,
          blocked: existing.blocked,
        };
      return {
        name,
        avatar: name.charAt(0),
        color: "blue" as const,
        done: [],
        wip: [],
        backlog: [],
        blocked: [],
      };
    });
  }, [standupData]);

  const totalDone = standupSummary?.tasksCompleted ?? 0;
  const totalWip = standupSummary?.tasksInProgress ?? 0;
  const totalBacklog = standupSummary?.tasksBacklog ?? 0;
  const totalBlocked = standupSummary?.tasksBlocked ?? 0;

  const isLoading = standupData === undefined || standupSummary === undefined;

  return (
    <div className="h-full overflow-y-auto bg-black p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header with Range (Day/Week/30 Days) + Date Navigation — AGT-138 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-50">Standup</h1>
              <p className="text-sm text-zinc-500">
                {rangeMode === "day" && formatDate(date)}
                {rangeMode === "day" && timeFilter !== "full" && (
                  <span className="ml-2 text-zinc-400">— {TIME_FILTER_LABELS[timeFilter]}</span>
                )}
                {rangeMode === "week" && "Last 7 days"}
                {rangeMode === "30days" && "Last 30 days"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncNow}
              disabled={syncState === "syncing"}
              className="border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {syncState === "syncing" ? (
                <>
                  <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                  Syncing...
                </>
              ) : syncState === "success" ? (
                <>
                  <Check className="mr-2 h-3 w-3 text-green-500" />
                  Synced
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3 w-3" />
                  Sync Now
                </>
              )}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* AGT-138: Range mode — Day / Week / 30 Days */}
            <select
              value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value as StandupRangeMode)}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              {(Object.keys(RANGE_MODE_LABELS) as StandupRangeMode[]).map((key) => (
                <option key={key} value={key}>
                  {RANGE_MODE_LABELS[key]}
                </option>
              ))}
            </select>

            {/* Time filter (AGT-131) — only when Day */}
            {rangeMode === "day" && (
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value as StandupTimeFilter)}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
              >
                {(Object.keys(TIME_FILTER_LABELS) as StandupTimeFilter[]).map((key) => (
                  <option key={key} value={key}>
                    {TIME_FILTER_LABELS[key]}
                  </option>
                ))}
              </select>
            )}

            {/* Date nav — only when Day */}
            {rangeMode === "day" && (
              <>
                <button
                  onClick={goToPrevDay}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {!isToday(date) && (
                  <button
                    onClick={goToToday}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    Today
                  </button>
                )}
                <button
                  onClick={goToNextDay}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <StandupSummary
          doneCount={totalDone}
          wipCount={totalWip}
          backlogCount={totalBacklog}
          blockedCount={totalBlocked}
        />

        {/* Agent Cards Grid - live data from Convex (synced from Linear) */}
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="mb-4 h-10 w-24 rounded bg-zinc-700" />
                <div className="space-y-3">
                  <div className="h-4 rounded bg-zinc-700" />
                  <div className="h-4 rounded bg-zinc-700" />
                  <div className="h-4 w-3/4 rounded bg-zinc-700" />
                </div>
              </div>
            ))}
          </div>
        ) : agentCards.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {agentCards.map((card) => (
              <StandupAgentCard key={card.name} {...card} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-zinc-500">
            {rangeMode === "day"
              ? "No agents or tasks for this date. Run seed and sync Linear, then try Sync Now."
              : "No agents or tasks for this range. Run seed and sync Linear, then try Sync Now."}
          </div>
        )}
      </div>
    </div>
  );
}
