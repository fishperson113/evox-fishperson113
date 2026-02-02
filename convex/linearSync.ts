"use node";

import { v } from "convex/values";
import { action, internalAction, mutation, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { LinearClient } from "@linear/sdk";

const EVOX_PROJECT_ID = "d5bf6ea1-9dcb-4fa7-96e8-66fa03746cfe";

// Type for Linear issue data returned by fetchLinearIssues
interface LinearIssueData {
  linearId: string;
  linearIdentifier: string;
  linearUrl: string;
  title: string;
  description: string;
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assigneeName: string | null;
  projectName: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Map Linear status to EVOX task status
 */
function mapLinearStatus(
  linearStatus: string
): "backlog" | "todo" | "in_progress" | "review" | "done" {
  const statusLower = linearStatus.toLowerCase();

  if (statusLower.includes("backlog")) return "backlog";
  if (statusLower.includes("todo")) return "todo";
  if (statusLower.includes("in progress") || statusLower.includes("started")) {
    return "in_progress";
  }
  if (statusLower.includes("done") || statusLower.includes("completed")) {
    return "done";
  }
  if (statusLower.includes("review")) return "review";

  return "todo";
}

/**
 * Map Linear priority (1-4) to EVOX priority
 */
function mapLinearPriority(
  linearPriority: number
): "low" | "medium" | "high" | "urgent" {
  switch (linearPriority) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "medium";
  }
}

/**
 * Fetch Linear issues for EVOX project
 * AGT-161: Optimized to reduce API calls - uses GraphQL directly instead of N+1 SDK calls
 */
async function fetchLinearIssues(apiKey: string): Promise<LinearIssueData[]> {
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is required");
  }

  // Use GraphQL directly to fetch all data in a single request
  // This reduces ~150+ API calls to just 1
  const query = `
    query GetEVOXIssues($projectId: ID!) {
      issues(filter: { project: { id: { eq: $projectId } } }, includeArchived: false, first: 100) {
        nodes {
          id
          identifier
          url
          title
          description
          priority
          createdAt
          updatedAt
          state {
            name
          }
          assignee {
            name
          }
          project {
            name
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query,
      variables: { projectId: EVOX_PROJECT_ID },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Linear API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (result.errors?.length > 0) {
    console.error("Linear GraphQL errors:", result.errors);
    throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
  }

  const issueNodes = result.data?.issues?.nodes || [];

  const mappedIssues = issueNodes.map((issue: any) => ({
    linearId: issue.id,
    linearIdentifier: issue.identifier,
    linearUrl: issue.url,
    title: issue.title,
    description: issue.description || "",
    status: mapLinearStatus(issue.state?.name || "Todo"),
    priority: mapLinearPriority(issue.priority || 3),
    assigneeName: issue.assignee?.name || null,
    projectName: issue.project?.name || null,
    createdAt: new Date(issue.createdAt).getTime(),
    updatedAt: new Date(issue.updatedAt).getTime(),
  }));

  return mappedIssues;
}

/**
 * Sync tasks from Linear to Convex (Internal - called by cron)
 * Fetches issues from Linear EVOX project and upserts them
 */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; total: number; created: number; updated: number; message: string }> => {
    const apiKey = process.env.LINEAR_API_KEY;

    if (!apiKey) {
      throw new Error(
        "LINEAR_API_KEY not found in environment variables. Please set it in .env.local"
      );
    }

    try {
      // Fetch issues from Linear
      const linearIssues = await fetchLinearIssues(apiKey);

      console.log(`Fetched ${linearIssues.length} issues from Linear`);

      // Get all agents for matching assignees and finding system agent
      const agents = await ctx.runQuery(api.agents.list);
      const systemAgent = agents.find((a: { role: string }) => a.role === "pm");

      if (!systemAgent) {
        throw new Error("No system agent (PM) found. Run seed first.");
      }

      // Get EVOX project
      const projects = await ctx.runQuery(api.projects.list);
      const evoxProject = projects.find((p: { name: string }) => p.name === "EVOX");

      if (!evoxProject) {
        throw new Error("EVOX project not found. Run seed first.");
      }

      // AGT-142: Parse agent from ticket description (Dispatch section or Agent: line)
      // Falls back to Linear assignee if no dispatch found
      function parseAgentFromDescription(description: string): string | undefined {
        const descLower = description.toLowerCase();

        // Pattern 1: "## Agent: Sam" or "Agent: Sam"
        const agentMatch = descLower.match(/##?\s*agent:\s*(sam|leo|max)/i);
        if (agentMatch) return agentMatch[1].toLowerCase();

        // Pattern 2: "SAM's Steps" or "LEO's Steps" (agent-specific sections)
        if (descLower.includes("sam's steps") || descLower.includes("sam (backend)")) return "sam";
        if (descLower.includes("leo's steps") || descLower.includes("leo (frontend)")) return "leo";
        if (descLower.includes("max's steps") || descLower.includes("max (pm)")) return "max";

        // Pattern 3: Dispatch block with "Sam:" or "Leo:" at start of line
        const dispatchMatch = description.match(/^(Sam|Leo|Max):/im);
        if (dispatchMatch) return dispatchMatch[1].toLowerCase();

        // Pattern 4: Simple "## Dispatch\n...\nSam" or similar
        if (descLower.includes("dispatch") && descLower.includes("sam")) return "sam";
        if (descLower.includes("dispatch") && descLower.includes("leo")) return "leo";

        return undefined;
      }

      // Upsert each task
      const results = await Promise.all(
        linearIssues.map(async (issue) => {
          // Try to match assignee by name
          let assigneeId: Id<"agents"> | undefined = undefined;
          if (issue.assigneeName) {
            const matchedAgent = agents.find(
              (a: { name: string; _id: Id<"agents"> }) => a.name.toLowerCase() === issue.assigneeName?.toLowerCase()
            );
            assigneeId = matchedAgent?._id;
          }

          // AGT-142: Parse agent from description first, fallback to "max" (PM owns unassigned)
          const parsedAgent = parseAgentFromDescription(issue.description);
          const taskAgentName = parsedAgent ?? "max";

          // AGT-175: Use taskAgentName for activity attribution (not hardcoded "max")
          return await ctx.runMutation(api.tasks.upsertByLinearId, {
            agentName: taskAgentName,
            taskAgentName,
            projectId: evoxProject._id,
            linearId: issue.linearId,
            linearIdentifier: issue.linearIdentifier,
            linearUrl: issue.linearUrl,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
            assignee: assigneeId,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
          });
        })
      );

      const created = results.filter((r: { created: boolean }) => r.created).length;
      const updated = results.filter((r: { created: boolean }) => !r.created).length;

      // AGT-133: Update agent lastSeen when sync runs (sync-runner = max)
      const maxMapping = await ctx.runQuery(api.agentMappings.getByAgentName, {
        agentName: "max",
      });
      if (maxMapping?.convexAgentId) {
        await ctx.runMutation(api.agents.touchLastSeen, {
          agentId: maxMapping.convexAgentId,
        });
      }

      return {
        success: true,
        total: linearIssues.length,
        created,
        updated,
        message: `Synced ${linearIssues.length} tasks: ${created} created, ${updated} updated`,
      };
    } catch (error) {
      console.error("Linear sync failed:", error);
      throw new Error(`Linear sync failed: ${error}`);
    }
  },
});

/**
 * Public wrapper for manual sync trigger from frontend
 * Calls the internal syncAll action
 */
export const triggerSync = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; total: number; created: number; updated: number; message: string }> => {
    return await ctx.runAction(internal.linearSync.syncAll, {});
  },
});
