/**
 * Diamond Deployment Prompts
 *
 * User interaction utilities for displaying changes and confirming operations.
 */

import Table from "cli-table3";
import chalk from "chalk";
import { createInterface } from "node:readline";
import type {
  DiamondDiff,
  FacetFunctionsWithName,
  MigrationConfig,
  Selector,
} from "./types.js";
import { getSelectorSignature } from "./executor.js";

// ============================================================================
// Change Display
// ============================================================================

/**
 * Display Diamond changes in a formatted table
 */
export async function displayChanges(
  diff: DiamondDiff,
  migration?: MigrationConfig,
): Promise<void> {
  const table = new Table({
    head: [
      chalk.bold("Action"),
      chalk.bold("Selector"),
      chalk.bold("Signature"),
      chalk.bold("Facet"),
    ],
    colWidths: [12, 14, 45, 25],
    wordWrap: true,
  });

  // Add functions
  for (const facet of diff.adds) {
    addTableRows(table, facet, "Add", chalk.green);
  }

  // Replace functions
  for (const facet of diff.replaces) {
    addTableRows(table, facet, "Replace", chalk.yellow);
  }

  // Removed functions
  for (const selector of diff.removes) {
    table.push([
      chalk.red("Remove"),
      selector,
      truncate(getSelectorSignature(selector), 42),
      chalk.gray("(removed)"),
    ]);
  }

  // Unchanged functions (collapsed)
  if (diff.unchanged.length > 0) {
    const totalUnchanged = diff.unchanged.reduce(
      (sum, f) => sum + f.selectors.length,
      0,
    );
    table.push([
      chalk.gray("Unchanged"),
      chalk.gray("..."),
      chalk.gray(`${totalUnchanged} function(s) unchanged`),
      chalk.gray("..."),
    ]);
  }

  if (table.length === 0) {
    console.log(chalk.yellow("\n⚠️  No changes detected.\n"));
    return;
  }

  console.log("\n📋 Diamond Changes:\n");
  console.log(table.toString());

  // Display migration info
  if (migration?.facetName) {
    const hasMigrationChanges = [...diff.adds, ...diff.replaces].some(
      (f) => f.contractName === migration.facetName,
    );
    if (hasMigrationChanges) {
      console.log(
        chalk.cyan(`\n🚀 Migration scheduled: ${migration.facetName}`),
      );
    }
  }

  // Summary
  const addCount = diff.adds.reduce((sum, f) => sum + f.selectors.length, 0);
  const replaceCount = diff.replaces.reduce(
    (sum, f) => sum + f.selectors.length,
    0,
  );
  const removeCount = diff.removes.length;

  console.log(
    chalk.dim(
      `\nSummary: ${addCount} add, ${replaceCount} replace, ${removeCount} remove`,
    ),
  );
}

/**
 * Add rows for a facet's selectors to the table
 */
function addTableRows(
  table: Table.Table,
  facet: FacetFunctionsWithName,
  action: string,
  colorFn: (str: string) => string,
): void {
  for (const selector of facet.selectors) {
    const signature = getSelectorSignature(selector);
    table.push([
      colorFn(action),
      selector,
      truncate(signature, 42),
      facet.contractName,
    ]);
  }
}

/**
 * Truncate a string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

// ============================================================================
// User Prompts
// ============================================================================

/**
 * Prompt user for confirmation
 */
export async function promptConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await new Promise<boolean>((resolve) => {
      rl.question(chalk.cyan(`\n${question} (y/N): `), (answer) => {
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      });
    });
  } finally {
    rl.close();
  }
}

/**
 * Display changes and prompt for confirmation
 */
export async function confirmChanges(
  diff: DiamondDiff,
  isUpgrade: boolean,
  migration?: MigrationConfig,
): Promise<boolean> {
  if (!diff.hasChanges) {
    console.log(chalk.yellow("\n⚠️  No changes to apply.\n"));
    return false;
  }

  await displayChanges(diff, migration);

  const action = isUpgrade ? "upgrade" : "deployment";
  return promptConfirmation(`Proceed with ${action}?`);
}

// ============================================================================
// Progress Logging
// ============================================================================

/**
 * Log operation start
 */
export function logOperationStart(
  diamondName: string,
  networkName: string,
  isUpgrade: boolean,
): void {
  const operation = isUpgrade ? "Upgrading" : "Deploying";
  console.log(
    chalk.bold(`\n💎 ${operation} ${diamondName} on ${networkName}\n`),
  );
}

/**
 * Log operation complete
 */
export function logOperationComplete(
  diamondAddress: string,
  isUpgrade: boolean,
): void {
  const operation = isUpgrade ? "Upgrade" : "Deployment";
  console.log(chalk.green(`\n✅ ${operation} complete!`));
  console.log(chalk.dim(`   Diamond: ${diamondAddress}\n`));
}
