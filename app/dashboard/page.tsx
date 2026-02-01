"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
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

export default function DashboardPage() {
  const projects = useQuery(api.projects.list);
  const evoxProjectId = useMemo(
    () => projects?.find((p: { name: string }) => p.name === "EVOX")?._id,
    [projects]
  );
  const agents = useQuery(api.agents.list);
  const tasks = useQuery(api.tasks.list, evoxProjectId ? { projectId: evoxProjectId } : "skip");
  const activities = useQuery(api.activities.listWithAgents, { limit: 50 });
  const unreadCounts = useQuery(api.agentMessages.getUnreadCounts);
  useQuery(api.agentMessages.getUnreadMessages, { agentName: "max" });

  const displayAgents = agents && agents.length > 0 ? agents : mockAgents;
  const displayActivities = activities && activities.length > 0 ? activities : mockActivities;

  // BUG 5: Same source as Tasks page — EVOX project only so Completed count matches
  const taskStats = tasks
    ? {
        total: tasks.length,
        inProgress: tasks.filter((t: { status: string }) => t.status === "in_progress").length,
        completed: tasks.filter((t: { status: string }) => t.status === "done").length,
      }
    : { total: 0, inProgress: 0, completed: 0 };

  // BUG 3: Last activity per agent from activities table (max createdAt per agent)
  const lastActivityByAgent = useMemo(() => {
    if (!activities?.length) return {} as Record<string, number>;
    const byAgent: Record<string, number> = {};
    for (const a of activities) {
      const agentDoc = (a as { agent: { _id: string } | null }).agent;
      const id = agentDoc?._id;
      if (!id) continue;
      const ts = (a as { createdAt: number }).createdAt;
      if (!byAgent[id] || ts > byAgent[id]) byAgent[id] = ts;
    }
    return byAgent;
  }, [activities]);

  // BUG 4: Current task = first in_progress task assigned to agent (or task by agent.currentTask)
  const currentTaskByAgent = useMemo(() => {
    if (!tasks?.length || !agents?.length) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const agent of agents) {
      const a = agent as { _id: string; currentTask?: string };
      const inProgress = tasks.find(
        (t: { assignee?: string; status: string }) =>
          t.assignee === a._id && t.status === "in_progress"
      );
      const byCurrent = a.currentTask
        ? tasks.find((t: { _id: string }) => t._id === a.currentTask)
        : null;
      const task = inProgress ?? byCurrent;
      if (task) map[a._id] = (task as { title: string }).title;
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
              {displayAgents.map((agent: any, idx: number) => {
                const canonical =
                  agentNameToCanonical[agent.name] ?? agent.name?.toLowerCase?.();
                const unreadCount = unreadCounts?.[canonical] ?? 0;
                const lastActivityTs = agent._id ? lastActivityByAgent[agent._id] : undefined;
                const lastActivityAt = lastActivityTs ? new Date(lastActivityTs) : undefined;
                const lastHeartbeat = agent.lastSeen ? new Date(agent.lastSeen) : agent.lastHeartbeat;
                const currentTask =
                  agent._id ? currentTaskByAgent[agent._id] : agent.currentTask;
                return (
                  <AgentCard
                    key={agent._id ?? idx}
                    name={agent.name}
                    role={agent.role}
                    status={agent.status}
                    currentTask={currentTask}
                    avatar={agent.avatar}
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
            <ActivityFeed activities={displayActivities} />
          </div>
      </div>
    </div>
  );
}
