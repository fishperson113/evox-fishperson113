"use client";

import { useMemo, useEffect, useRef } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AgentCard } from "@/components/agent-card";
import { ActivityFeed } from "@/components/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, ListTodo, CheckCircle2 } from "lucide-react";

// Mock data fallback
const mockAgents = [
  {
    name: "Sam",
    role: "pm" as const,
    status: "online" as const,
    currentTask: "Planning Phase 2 features",
    avatar: "SM",
    lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago
  },
  {
    name: "Leo",
    role: "frontend" as const,
    status: "online" as const,
    currentTask: "Building dashboard components",
    avatar: "LO",
    lastHeartbeat: new Date(Date.now() - 30 * 1000), // 30 secs ago
  },
  {
    name: "Backend Agent",
    role: "backend" as const,
    status: "idle" as const,
    currentTask: undefined,
    avatar: "BE",
    lastHeartbeat: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago
  },
] as const;

const mockActivities = [
  {
    _id: "1",
    agent: { name: "Leo", avatar: "LO", role: "frontend" as const, status: "online" as const },
    action: "completed task",
    target: "AGT-69",
    createdAt: Date.now() - 5 * 60 * 1000,
  },
  {
    _id: "2",
    agent: { name: "Sam", avatar: "SM", role: "pm" as const, status: "online" as const },
    action: "created task",
    target: "Phase 2 Planning",
    createdAt: Date.now() - 15 * 60 * 1000,
  },
  {
    _id: "3",
    agent: { name: "Leo", avatar: "LO", role: "frontend" as const, status: "online" as const },
    action: "updated task",
    target: "AGT-68",
    createdAt: Date.now() - 25 * 60 * 1000,
  },
];

/** Map agent display name to canonical name for getUnreadMessages (AGT-123) */
const agentNameToCanonical: Record<string, string> = {
  SON: "max",
  SAM: "sam",
  LEO: "leo",
};

const SYNC_INTERVAL_MS = 60 * 1000; // 60s (AGT-133)

export default function DashboardPage() {
  const agents = useQuery(api.agents.list);
  const tasks = useQuery(api.tasks.list, {});
  const activities = useQuery(api.activities.listWithAgents, { limit: 50 });
  const triggerSync = useAction(api.linearSync.triggerSync);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AGT-133: Auto-sync on mount + every 60s
  useEffect(() => {
    const runSync = () => {
      triggerSync({}).catch((err) => console.warn("Dashboard auto-sync failed:", err));
    };
    runSync();
    syncIntervalRef.current = setInterval(runSync, SYNC_INTERVAL_MS);
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [triggerSync]);

  // Unread counts: skip query on dashboard to avoid crash when agentMappings not seeded or Convex not yet deployed; badge shows 0
  const unreadCounts: Record<string, number> | undefined = undefined;

  const agentsList = Array.isArray(agents) && agents.length > 0 ? agents : mockAgents;
  const activitiesList =
    Array.isArray(activities) && activities.length > 0 ? activities : mockActivities;

  const taskStats = useMemo(() => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { total: 0, inProgress: 0, completed: 0 };
    }
    return {
      total: tasks.length,
      inProgress: tasks.filter((t: { status?: string }) => t.status === "in_progress").length,
      completed: tasks.filter((t: { status?: string }) => t.status === "done").length,
    };
  }, [tasks]);

  const lastActivityByAgent = useMemo(() => {
    if (!Array.isArray(activities) || activities.length === 0) return {} as Record<string, number>;
    const byAgent: Record<string, number> = {};
    for (const a of activities) {
      const agentDoc = (a as { agent: { _id?: string } | null })?.agent;
      const id = agentDoc?._id;
      if (!id) continue;
      const ts = (a as { createdAt?: number }).createdAt;
      if (ts == null) continue;
      if (!byAgent[id] || ts > byAgent[id]) byAgent[id] = ts;
    }
    return byAgent;
  }, [activities]);

  const currentTaskByAgent = useMemo(() => {
    if (!Array.isArray(tasks) || tasks.length === 0 || !Array.isArray(agents) || agents.length === 0) {
      return {} as Record<string, string>;
    }
    const map: Record<string, string> = {};
    for (const agent of agents) {
      const a = agent as { _id?: string; currentTask?: string };
      const aid = a?._id;
      if (!aid) continue;
      const inProgress = tasks.find(
        (t: { assignee?: string; status?: string }) =>
          t.assignee === aid && t.status === "in_progress"
      );
      const byCurrent = a.currentTask
        ? tasks.find((t: { _id?: string }) => t._id === a.currentTask)
        : null;
      const task = inProgress ?? byCurrent;
      if (task) {
        const t = task as { title?: string; linearIdentifier?: string };
        map[aid] = t.linearIdentifier ? `${t.linearIdentifier}: ${t.title ?? ""}` : (t.title ?? "");
      }
    }
    return map;
  }, [tasks, agents]);

  return (
    <div className="h-full bg-black p-8">

      <div className="grid gap-6">
          {/* Task Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-zinc-400">
                  Total Tasks
                </CardTitle>
                <ListTodo className="h-4 w-4 text-zinc-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-50">
                  {taskStats.total}
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-zinc-400">
                  In Progress
                </CardTitle>
                <Users className="h-4 w-4 text-zinc-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-500">
                  {taskStats.inProgress}
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-zinc-400">
                  Completed
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-zinc-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-500">
                  {taskStats.completed}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Agent Cards Grid */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-50">Agents</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agentsList.map((agent: Record<string, unknown>, idx: number) => {
                const name = (agent.name as string) ?? "Unknown";
                const canonical =
                  agentNameToCanonical[name] ?? String(name).toLowerCase();
                const unreadCount =
                  unreadCounts && typeof unreadCounts === "object" && canonical in unreadCounts
                    ? Number((unreadCounts as Record<string, number>)[canonical]) ?? 0
                    : 0;
                const agentId = agent._id as string | undefined;
                const lastActivityTs = agentId ? lastActivityByAgent[agentId] : undefined;
                const lastActivityAt = lastActivityTs != null ? new Date(lastActivityTs) : undefined;
                const lastSeen = agent.lastSeen as number | undefined;
                const lastHeartbeat = lastSeen != null ? new Date(lastSeen) : (agent.lastHeartbeat as Date | undefined);
                const currentTask = agentId ? currentTaskByAgent[agentId] : (agent.currentTask as string | undefined);
                return (
                  <AgentCard
                    key={agentId ?? idx}
                    name={name}
                    role={(agent.role as "pm" | "backend" | "frontend") ?? "pm"}
                    status={(agent.status as "online" | "idle" | "offline" | "busy") ?? "offline"}
                    currentTask={currentTask}
                    avatar={(agent.avatar as string) ?? "?"}
                    lastHeartbeat={lastHeartbeat}
                    lastActivityAt={lastActivityAt}
                    unreadCount={unreadCount}
                  />
                );
              })}
            </div>
          </div>

          {/* Activity Feed */}
          <div>
            <ActivityFeed activities={activitiesList} />
          </div>
      </div>
    </div>
  );
}
