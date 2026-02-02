"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface AgentProfileProps {
  agentId: Id<"agents">;
  name: string;
  role: string;
  status: string;
  avatar: string;
  onClose: () => void;
}

/** AGT-155: Status dots — green / yellow / gray only (Vercel/Notion minimal) */
const statusDot: Record<string, string> = {
  online: "bg-green-500",
  busy: "bg-yellow-500",
  idle: "bg-gray-500",
  offline: "bg-gray-500",
};

const roleLabels: Record<string, string> = {
  pm: "PM",
  backend: "Backend",
  frontend: "Frontend",
};

/** AGT-155: Agent Profile v2 — SOUL, statusReason, statusSince, current task from Convex */
export function AgentProfile({ agentId, name, role, status, avatar, onClose }: AgentProfileProps) {
  const agent = useQuery(api.agents.get, { id: agentId });
  const full = agent as {
    soul?: string;
    about?: string;
    statusReason?: string;
    statusSince?: number;
    currentTask?: Id<"tasks">;
  } | null;
  const currentTaskId = full?.currentTask;
  const currentTask = useQuery(
    api.tasks.get,
    currentTaskId ? { id: currentTaskId } : "skip"
  );
  const taskDoc = currentTask as { title?: string; linearIdentifier?: string; linearUrl?: string } | null;

  const dot = statusDot[status?.toLowerCase() ?? "offline"] ?? statusDot.offline;
  const soulText = full?.soul ?? full?.about ?? null;
  const statusReason = full?.statusReason ?? null;
  const statusSince = full?.statusSince;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-50">Agent Profile</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white transition-colors"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
        <div className="relative">
          <Avatar className="h-12 w-12 border-2 border-gray-800">
            <AvatarFallback className="bg-gray-800 text-zinc-50">{avatar}</AvatarFallback>
          </Avatar>
          <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a0a0a]", dot)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-50">{name}</p>
          <p className="text-xs text-gray-500">{roleLabels[role] ?? role}</p>
          <p className="text-xs capitalize text-gray-400">{status}</p>
          {statusReason && (
            <p className="mt-1 text-xs text-gray-500">{statusReason}</p>
          )}
          {statusSince != null && (
            <p className="text-xs text-gray-500">
              Since {formatDistanceToNow(statusSince, { addSuffix: true })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">About / SOUL</h4>
          <p className="mt-1 text-sm text-gray-400 whitespace-pre-wrap">
            {soulText ?? "—"}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Skills</h4>
          <p className="mt-1 text-sm text-gray-400 italic">—</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Current task</h4>
          {currentTaskId && taskDoc ? (
            <a
              href={taskDoc.linearUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-sm text-gray-400 hover:text-white transition-colors"
            >
              {taskDoc.linearIdentifier ? `${taskDoc.linearIdentifier}: ` : ""}{taskDoc.title ?? "—"}
            </a>
          ) : currentTaskId ? (
            <p className="mt-1 text-sm text-gray-500">Loading…</p>
          ) : (
            <p className="mt-1 text-sm text-gray-500">No current task</p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Send message</h4>
          <textarea
            placeholder="Type a message..."
            className="mt-1 w-full rounded border border-gray-800 bg-gray-900/50 px-3 py-2 text-sm text-zinc-50 placeholder:text-gray-500 focus:border-gray-600 focus:outline-none"
            rows={2}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
