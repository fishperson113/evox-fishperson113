"use client";

import type { KanbanTask } from "./task-card";

interface TaskDetailProps {
  task: KanbanTask;
  onClose: () => void;
}

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-50">Task Detail</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-50"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Title</h4>
          <p className="mt-1 text-sm text-zinc-50">{task.title}</p>
          {task.linearIdentifier && (
            <a href={task.linearUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[#888] hover:text-zinc-400">
              {task.linearIdentifier}
            </a>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Description</h4>
          <p className="mt-1 text-sm text-zinc-400 italic">—</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Assignee</h4>
          <p className="mt-1 text-sm text-zinc-400">{task.assigneeName ?? "—"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Comments</h4>
          <p className="mt-1 text-sm text-zinc-400 italic">—</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Quick actions</h4>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700">
              Open in Linear
            </button>
            <button type="button" className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700">
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
