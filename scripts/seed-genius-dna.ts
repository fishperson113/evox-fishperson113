#!/usr/bin/env tsx
/**
 * AGT-241: Seed Genius DNA into agentMemory records
 *
 * Usage: npx tsx scripts/seed-genius-dna.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://gregarious-elk-556.convex.cloud";

const client = new ConvexHttpClient(CONVEX_URL);

const DNA_MAP: Record<string, string> = {
  max: "von Neumann + Feynman + Musk",
  sam: "Shannon + Turing + Carmack",
  leo: "Tesla + Dirac + Rams",
  quinn: "Bach + Dijkstra + Taleb",
};

async function seedGeniusDNA() {
  console.log("🧬 Seeding Genius DNA...\n");

  // Get all agents
  const agents = await client.query(api.agents.list);

  for (const agent of agents) {
    const nameLower = agent.name.toLowerCase();
    const dna = DNA_MAP[nameLower];

    if (!dna) {
      console.log(`⊘ Skipping ${agent.name} (no DNA mapping)`);
      continue;
    }

    // Get soul memory
    const soul = await client.query(api.agentMemory.getMemory, {
      agentId: agent._id,
      type: "soul",
    });

    if (!soul) {
      console.log(`⚠ No soul memory found for ${agent.name}`);
      continue;
    }

    // Since we can't update geniusDNA field directly (not yet deployed),
    // we'll append it to the content for now
    const updatedContent = `${soul.content}\n\n## Genius DNA\n${dna}`;

    await client.mutation(api.agentMemory.upsertMemory, {
      agentId: agent._id,
      type: "soul",
      content: updatedContent,
    });

    console.log(`✓ Updated ${agent.name}: ${dna}`);
  }

  console.log("\n✅ Genius DNA seeding complete!");
}

seedGeniusDNA().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
