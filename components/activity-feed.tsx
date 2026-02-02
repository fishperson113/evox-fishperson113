"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";

// AGT-137: Unified activityEvents schema
interface ActivityEvent {
  _id: string;
  agentId: string;
  agentName: string;
  agent?: {
    name: string;
    avatar: string;
    role: "pm" | "backend" | "frontend";
    status: "online" | "idle" | "offline" | "busy";
  } | null;
  category: "task" | "git" | "deploy" | "system" | "message";
  eventType: string;
  title: string;
  description?: string;
  taskId?: string;
  linearIdentifier?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

interface ActivityFeedProps {
  activities: ActivityEvent[] | Array<Record<string, unknown>>;
  /** AGT-163: Use compact 40px single-line rows (default true) */
  compact?: boolean;
}

/** AGT-163: Map eventType to display verb. Never show raw Convex _id. */
const eventTypeToVerb: Record<string, string> = {
  created: "created",
  status_change: "moved",
  assigned: "assigned",
  updated: "updated",
  deleted: "deleted",
  completed: "completed",
  started: "started",
  commented: "commented on",
  push: "pushed",
  pr_opened: "opened PR",
  pr_merged: "merged PR",
  deploy_success: "deployed",
  deploy_failed: "deployment failed",
  sync_completed: "synced",
};

/** AGT-163: Extract ticket ID + title from activity. Use linearIdentifier, never _id. */
function getTicketDisplay(activity: Record<string, unknown>): { id: string; title: string } {
  const linearId = typeof activity.linearIdentifier === "string" ? activity.linearIdentifier : "";
  const title = typeof activity.title === "string" ? activity.title : "";
  return { id: linearId || "—", title: title || "—" };
}

/** AGT-163: Spec 5.5 — 40px row. AGT-167: font-mono for ticket IDs, text-[#555] for time. */
export function ActivityFeed({ activities, compact = true }: ActivityFeedProps) {
  const safeActivities = Array.isArray(activities) ? activities : [];
  const displayActivities = safeActivities.slice(0, 20);

  if (displayActivities.length === 0) {
    return <p className="text-sm text-zinc-500">No recent activity</p>;
  }

  if (compact) {
    return (
      <ul className="space-y-0">
        {displayActivities.map((activity, index) => {
          const raw = activity as Record<string, unknown>;
          const ts = typeof raw.timestamp === "number" ? raw.timestamp : 0;
          const key = raw._id && String(raw._id).length > 0 ? String(raw._id) : `activity-${index}`;
          const agent = raw.agent as { name?: string; avatar?: string } | null | undefined;
          const agentName = String(agent?.name ?? raw.agentName ?? "Unknown");
          const avatar = agent?.avatar ?? (typeof raw.agentName === "string" ? String(raw.agentName).charAt(0).toUpperCase() : "?");
          const verb = eventTypeToVerb[String(raw.eventType ?? "")] ?? String(raw.eventType ?? "updated");
          const { id: ticketId, title: ticketTitle } = getTicketDisplay(raw);

          return (
            <li
              key={key}
              className="flex h-10 items-center gap-2 border-b border-[#1a1a1a] px-2 text-sm"
            >
              <Avatar className="h-5 w-5 shrink-0 border border-[#222]">
                <AvatarFallback className="bg-[#111] text-[10px] text-zinc-400">{avatar}</AvatarFallback>
              </Avatar>
              <span className="w-14 shrink-0 truncate text-zinc-50" title={agentName}>
                {agentName}
              </span>
              <span className="shrink-0 text-zinc-500">{verb}</span>
              <span className="font-mono text-xs text-[#888]">{ticketId}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-400" title={ticketTitle}>
                {ticketTitle}
              </span>
              <span className="shrink-0 text-xs text-[#555]">
                {formatDistanceToNow(ts, { addSuffix: true })}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="relative space-y-6">
      {displayActivities.map((activity, index) => {
        const raw = activity as Record<string, unknown>;
        const ts = typeof raw.timestamp === "number" ? raw.timestamp : 0;
        const key = raw._id && String(raw._id).length > 0 ? String(raw._id) : `activity-${index}`;
        const agent = raw.agent as { name?: string; avatar?: string } | null | undefined;
        const agentName = String(agent?.name ?? raw.agentName ?? "Unknown");
        const avatar = agent?.avatar ?? (typeof raw.agentName === "string" ? String(raw.agentName).charAt(0).toUpperCase() : "?");
        const verb = eventTypeToVerb[String(raw.eventType ?? "")] ?? String(raw.eventType ?? "");
        const { id: ticketId, title: ticketTitle } = getTicketDisplay(raw);

        return (
          <div key={key} className="flex gap-4">
            <Avatar className="h-8 w-8 shrink-0 border-2 border-zinc-900 bg-zinc-800">
              <AvatarFallback className="bg-zinc-800 text-xs text-zinc-50">{avatar}</AvatarFallback>
            </Avatar>
            <div className="flex-1 pb-2">
              <p className="text-sm text-zinc-300">
                <span className="font-medium text-zinc-50">{agentName}</span> {verb}{" "}
                <span className="font-mono text-xs text-[#888]">{ticketId}</span>{" "}
                <span className="text-zinc-400">{ticketTitle}</span>
              </p>
              <p className="mt-1 text-xs text-[#555]">{formatDistanceToNow(ts, { addSuffix: true })}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
