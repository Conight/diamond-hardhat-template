import Table from "cli-table3";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import type { OperationPlan } from "./types.js";

export function displayChanges({ diff, migration }: OperationPlan): void {
  const table = new Table({ head: ["Action", "Facet", "Functions"] });
  for (const facet of diff.adds)
    table.push([
      chalk.green("Add"),
      facet.contractName,
      facet.selectors.length,
    ]);
  for (const { previous, next } of diff.replaces) {
    const added = next.selectors.filter(
      (s) => !previous.selectors.includes(s),
    ).length;
    const removed = previous.selectors.filter(
      (s) => !next.selectors.includes(s),
    ).length;
    table.push([
      chalk.yellow("Replace"),
      `${previous.contractName} → ${next.contractName}`,
      `${next.selectors.length} (+${added}, -${removed})`,
    ]);
  }
  for (const facet of diff.removes)
    table.push([
      chalk.red("Remove"),
      facet.contractName,
      facet.selectors.length,
    ]);
  for (const facet of diff.unchanged)
    table.push([
      chalk.gray("Unchanged"),
      facet.contractName,
      facet.selectors.length,
    ]);
  console.log(table.toString());
  if (migration) console.log(`Migration: ${migration}`);
}
export async function confirmChanges(plan: OperationPlan): Promise<boolean> {
  displayChanges(plan);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Proceed with ${plan.isUpgrade ? "upgrade" : "deployment"}? (y/N): `,
    );
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}
