"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ActivityFeed } from "@/components/activity-feed";
import { normalizeActivities } from "@/lib/activity-utils";
import { cn } from "@/lib/utils";

/** AGT-169: Full-page activity feed with filter [All] [Max] [Sam] [Leo] */
const AGENT_FILTERS = ["all", "max", "sam", "leo"] as const;
type AgentFilter = (typeof AGENT_FILTERS)[number];

export function ActivityPage() {
  const [filter, setFilter] = useState<AgentFilter>("all");

  const raw = useQuery(api.activityEvents.list, { limit: 50 });
  const normalized = useMemo(() => normalizeActivities(raw ?? []), [raw]);

  const activities = useMemo(() => {
    if (filter === "all") return normalized;
    return normalized.filter(
      (a) => (a.agentName as string)?.toLowerCase() === filter
    );
  }, [normalized, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#222] px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-50">Activity</h2>
        <div className="flex gap-1">
          {AGENT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide",
                filter === f
                  ? "border-zinc-50 bg-[#222] text-zinc-50"
                  : "border-[#222] text-zinc-500 hover:text-zinc-400"
              )}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ActivityFeed activities={activities} />
      </div>
    </div>
  );
}
