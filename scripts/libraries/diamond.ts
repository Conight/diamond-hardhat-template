/**
 * Diamond Deployment Orchestrator
 *
 * Main entry point for Diamond deployment and upgrade operations.
 * This module coordinates the various components:
 * - Diffing: Computes what changed
 * - Executor: Deploys contracts and executes upgrades
 * - Deployment: Manages deployment files
 * - Prompts: Handles user interaction
 */

import hre from "hardhat";
import type { Address } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

// Import all modules
import { computeDiamondDiff } from "./diffing.js";
import {
  createDeployment,
  createUpgradeRecord,
  loadDeployment,
  saveDeployment,
  updateDeploymentForUpgrade,
  deploymentExists,
} from "./deployment.js";
import {
  buildDeploymentFunctions,
  deployDiamondContract,
  deployFacets,
  executeDiamondUpgrade,
  mergeDeploymentFunctions,
  prepareMigration,
  toDeploymentFacets,
  toFacetFunctions,
} from "./executor.js";
import {
  confirmChanges,
  logOperationComplete,
  logOperationStart,
} from "./prompts.js";
import type {
  DiamondConfig,
  DiamondDeployment,
  FunctionFacetPair,
  Selector,
} from "./types.js";

// Re-export types for consumers
export type { DiamondConfig, MigrationConfig } from "./types.js";
export { loadDeployment } from "./deployment.js";

// ============================================================================
// Type Definitions
// ============================================================================

type ViemConnection = NetworkConnection<"generic">["viem"];

interface DiamondOperationResult {
  readonly diamondAddress: Address;
  readonly deployment: DiamondDeployment;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Deploy a new Diamond contract
 */
export async function deployDiamond(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
): Promise<DiamondOperationResult | undefined> {
  // Run selectors task first
  await hre.tasks.getTask("selectors").run();

  logOperationStart(config.name, networkName, false);

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();

  // Ensure migration facet is included
  const allFacets = ensureMigrationFacet(
    config.facets,
    config.migration?.facetName,
  );

  // Compute diff (for new deployment, everything is an add)
  const diff = await computeDiamondDiff(
    publicClient,
    allFacets,
    undefined, // No existing deployment
    undefined, // No on-chain facets
  );

  // Confirm with user
  const confirmed = await confirmChanges(diff, false, config.migration);
  if (!confirmed) {
    console.log("Deployment cancelled.");
    return undefined;
  }

  // Deploy all facets
  const deployedFacets = await deployFacets(
    publicClient,
    walletClient,
    diff.adds,
    diff.replaces,
  );

  // Build facet functions array for diamond constructor
  const facetFunctions = toFacetFunctions(deployedFacets, diff.adds);

  // Deploy the diamond contract
  const diamondResult = await deployDiamondContract(
    publicClient,
    walletClient,
    config.name,
    facetFunctions,
    walletClient.account.address,
  );

  // Execute migration if configured
  if (config.migration?.facetName) {
    const migrationPrep = await prepareMigration(
      publicClient,
      diamondResult.address,
      config.migration,
    );

    if (migrationPrep.willExecute) {
      await executeDiamondUpgrade(
        publicClient,
        walletClient,
        diamondResult.address,
        [], // No adds
        [], // No replaces
        [], // No removes
        migrationPrep.delegate,
        migrationPrep.calldata,
      );
    }
  }

  // Build and save deployment
  const functions = buildDeploymentFunctions(deployedFacets);
  const deployment = createDeployment({
    diamondAddress: diamondResult.address,
    owner: walletClient.account.address,
    blockNumber: diamondResult.blockNumber,
    blockHash: diamondResult.blockHash,
    functions,
    facets: toDeploymentFacets(deployedFacets),
  });

  await saveDeployment(networkName, config.name, deployment);
  logOperationComplete(diamondResult.address, false);

  return {
    diamondAddress: diamondResult.address,
    deployment,
  };
}

/**
 * Upgrade an existing Diamond contract
 */
export async function upgradeDiamond(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
): Promise<DiamondOperationResult | undefined> {
  // Run selectors task first
  await hre.tasks.getTask("selectors").run();

  logOperationStart(config.name, networkName, true);

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();

  // Load existing deployment
  const existingDeployment = await loadDeployment(networkName, config.name);

  // Get on-chain function facet pairs
  const diamondInspect = await viem.getContractAt(
    "DiamondInspectFacet",
    existingDeployment.diamond,
  );
  const onChainFacets =
    (await diamondInspect.read.functionFacetPairs()) as readonly FunctionFacetPair[];

  // Ensure migration facet is included
  const allFacets = ensureMigrationFacet(
    config.facets,
    config.migration?.facetName,
  );

  // Compute diff
  const diff = await computeDiamondDiff(
    publicClient,
    allFacets,
    existingDeployment,
    onChainFacets,
  );

  // Confirm with user
  const confirmed = await confirmChanges(diff, true, config.migration);
  if (!confirmed) {
    console.log("Upgrade cancelled.");
    return undefined;
  }

  // Check if there are any changes to apply
  if (!diff.hasChanges) {
    console.log("No changes to apply.");
    return {
      diamondAddress: existingDeployment.diamond,
      deployment: existingDeployment,
    };
  }

  // Deploy changed facets
  const deployedFacets = await deployFacets(
    publicClient,
    walletClient,
    diff.adds,
    diff.replaces,
  );

  // Build facet functions arrays for upgrade
  const addFunctions = toFacetFunctions(deployedFacets, diff.adds);
  const replaceFunctions = toFacetFunctions(deployedFacets, diff.replaces);

  // Prepare migration
  const migrationPrep = await prepareMigration(
    publicClient,
    existingDeployment.diamond,
    config.migration,
  );

  // Execute the upgrade
  const upgradeResult = await executeDiamondUpgrade(
    publicClient,
    walletClient,
    existingDeployment.diamond,
    addFunctions,
    replaceFunctions,
    diff.removes,
    migrationPrep.delegate,
    migrationPrep.calldata,
  );

  // Build new deployment functions
  const newAddedFunctions = buildDeploymentFunctions(
    deployedFacets.filter((f) =>
      diff.adds.some((a) => a.contractName === f.contractName),
    ),
  );
  const newReplacedFunctions = buildDeploymentFunctions(
    deployedFacets.filter((f) =>
      diff.replaces.some((r) => r.contractName === f.contractName),
    ),
  );

  const newFunctions = mergeDeploymentFunctions(
    existingDeployment.functions,
    newAddedFunctions,
    newReplacedFunctions,
    diff.removes,
  );

  // Create upgrade record
  const upgradeRecord = createUpgradeRecord({
    blockNumber: upgradeResult.blockNumber,
    transactionHash: upgradeResult.transactionHash,
    added: newAddedFunctions,
    replaced: newReplacedFunctions,
    removed: diff.removes,
    migrationExecuted: upgradeResult.migrationExecuted,
  });

  // Update and save deployment
  const updatedDeployment = updateDeploymentForUpgrade(existingDeployment, {
    newFunctions,
    newFacets: toDeploymentFacets(deployedFacets),
    upgradeRecord,
  });

  await saveDeployment(networkName, config.name, updatedDeployment);
  logOperationComplete(existingDeployment.diamond, true);

  return {
    diamondAddress: existingDeployment.diamond,
    deployment: updatedDeployment,
  };
}

/**
 * Smart deploy/upgrade: deploys if not exists, upgrades if exists
 */
export async function deployOrUpgrade(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
): Promise<DiamondOperationResult | undefined> {
  const exists = await deploymentExists(networkName, config.name);

  if (exists) {
    return upgradeDiamond(viem, networkName, config);
  } else {
    return deployDiamond(viem, networkName, config);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensure migration facet is included in the facet list
 */
function ensureMigrationFacet(
  facets: readonly string[],
  migrationFacetName: string | undefined,
): readonly string[] {
  if (!migrationFacetName) return facets;
  if (facets.includes(migrationFacetName)) return facets;
  return [...facets, migrationFacetName];
}
