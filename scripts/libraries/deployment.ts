/**
 * Diamond Deployment File Management
 *
 * Handles reading, writing, and migrating deployment files.
 * Supports versioned format with upgrade history tracking.
 */

import hre from "hardhat";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { keccak256, toHex, type Address, type Hash } from "viem";
import type {
  DeploymentFacet,
  DeploymentFunction,
  DiamondDeployment,
  HashString,
  LegacyDiamondDeployment,
  Selector,
  UpgradeRecord,
} from "./types.js";
import { isLegacyDeployment, isV2Deployment } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const CURRENT_VERSION = 2;

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the deployment directory path for a network
 */
export function getDeploymentDir(networkName: string): string {
  return path.join(hre.config.paths.root, "deployment", networkName);
}

/**
 * Get the deployment file path for a diamond contract
 */
export function getDeploymentPath(
  networkName: string,
  diamondName: string,
): string {
  return path.join(getDeploymentDir(networkName), `${diamondName}.json`);
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Check if a deployment file exists
 */
export async function deploymentExists(
  networkName: string,
  diamondName: string,
): Promise<boolean> {
  try {
    await fs.access(getDeploymentPath(networkName, diamondName));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and parse a deployment file, migrating if necessary
 */
export async function loadDeployment(
  networkName: string,
  diamondName: string,
): Promise<DiamondDeployment> {
  const deploymentPath = getDeploymentPath(networkName, diamondName);

  try {
    const content = await fs.readFile(deploymentPath, "utf-8");
    const parsed = JSON.parse(content);

    // Handle legacy format
    if (isLegacyDeployment(parsed)) {
      console.log(`  ⚠️  Migrating deployment file from v1 to v2 format...`);
      return migrateLegacyDeployment(parsed);
    }

    // Validate v2 format
    if (isV2Deployment(parsed)) {
      return parsed;
    }

    throw new Error("Unknown deployment file format");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Deployment not found for ${diamondName} on ${networkName}`,
      );
    }
    throw error;
  }
}

/**
 * Migrate a legacy v1 deployment to v2 format
 */
function migrateLegacyDeployment(
  legacy: LegacyDiamondDeployment,
): DiamondDeployment {
  // Add bytecodeHash to facets (empty for now, will be populated on next deploy)
  const facets: Record<string, DeploymentFacet> = {};
  for (const [name, facet] of Object.entries(legacy.facets)) {
    facets[name] = {
      ...facet,
      blockHash: facet.blockHash as Hash,
      bytecodeHash: "0x" as HashString, // Will be populated on next upgrade
    };
  }

  return {
    version: CURRENT_VERSION,
    diamond: legacy.diamond,
    functions: legacy.functions,
    owner: legacy.owner,
    blockNumber: legacy.blockNumber,
    blockHash: legacy.blockHash as Hash,
    facets,
    upgradeHistory: [],
  };
}

/**
 * Save a deployment file
 */
export async function saveDeployment(
  networkName: string,
  diamondName: string,
  deployment: DiamondDeployment,
): Promise<void> {
  const deploymentDir = getDeploymentDir(networkName);
  await fs.mkdir(deploymentDir, { recursive: true });

  const deploymentPath = getDeploymentPath(networkName, diamondName);
  await fs.writeFile(
    deploymentPath,
    JSON.stringify(deployment, jsonReplacer, 2),
  );

  console.log(`\n💾 Deployment saved: ${deploymentPath}`);
}

// ============================================================================
// Upgrade History
// ============================================================================

/**
 * Create an upgrade history record
 */
export function createUpgradeRecord(params: {
  blockNumber: bigint;
  transactionHash: Hash;
  tag?: string;
  added: readonly DeploymentFunction[];
  replaced: readonly DeploymentFunction[];
  removed: readonly Selector[];
  migrationExecuted: boolean;
}): UpgradeRecord {
  return {
    timestamp: new Date().toISOString(),
    blockNumber: params.blockNumber.toString(),
    transactionHash: params.transactionHash,
    tag: params.tag,
    added: params.added,
    replaced: params.replaced,
    removed: params.removed,
    migrationExecuted: params.migrationExecuted,
  };
}

/**
 * Append an upgrade record to deployment
 */
export function appendUpgradeHistory(
  deployment: DiamondDeployment,
  record: UpgradeRecord,
): DiamondDeployment {
  return {
    ...deployment,
    upgradeHistory: [...deployment.upgradeHistory, record],
  };
}

// ============================================================================
// Deployment Creation
// ============================================================================

/**
 * Create a new deployment record for initial deployment
 */
export function createDeployment(params: {
  diamondAddress: Address;
  owner: Address;
  blockNumber: bigint;
  blockHash: Hash;
  functions: readonly DeploymentFunction[];
  facets: Record<string, DeploymentFacet>;
}): DiamondDeployment {
  return {
    version: CURRENT_VERSION,
    diamond: params.diamondAddress,
    functions: params.functions,
    owner: params.owner,
    blockNumber: params.blockNumber.toString(),
    blockHash: params.blockHash,
    facets: params.facets,
    upgradeHistory: [],
  };
}

/**
 * Update deployment after upgrade
 */
export function updateDeploymentForUpgrade(
  existing: DiamondDeployment,
  params: {
    newFunctions: readonly DeploymentFunction[];
    newFacets: Record<string, DeploymentFacet>;
    upgradeRecord: UpgradeRecord;
  },
): DiamondDeployment {
  return {
    ...existing,
    functions: params.newFunctions,
    facets: { ...existing.facets, ...params.newFacets },
    upgradeHistory: [...existing.upgradeHistory, params.upgradeRecord],
  };
}

// ============================================================================
// Bytecode Hash
// ============================================================================

/**
 * Compute bytecode hash for a deployed contract
 */
export function computeBytecodeHash(bytecode: HashString): HashString {
  return keccak256(toHex(bytecode)) as HashString;
}

// ============================================================================
// JSON Serialization
// ============================================================================

/**
 * JSON replacer for BigInt values
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}
