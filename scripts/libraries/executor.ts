/**
 * Diamond Deployment Executor
 *
 * Handles the actual contract deployment and upgrade execution.
 */

import { artifacts } from "hardhat";
import {
  encodeFunctionData,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import type {
  DeploymentFacet,
  DeploymentFunction,
  FacetFunctions,
  FacetFunctionsWithName,
  HashString,
  MigrationConfig,
  Selector,
} from "./types.js";
import { computeBytecodeHash } from "./deployment.js";
import type { SelectorInfo } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

// Hardhat's viem plugin provides its own typed wallet client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HardhatWalletClient = any;

interface DeployedFacet {
  readonly contractName: string;
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hash;
  readonly transactionHash: Hash;
  readonly transactionIndex: number;
  readonly from: Address;
  readonly bytecodeHash: HashString;
  readonly selectors: readonly Selector[];
}

interface DeployResult {
  readonly facets: readonly DeployedFacet[];
  readonly diamondAddress?: Address;
  readonly diamondReceipt?: {
    readonly blockNumber: bigint;
    readonly blockHash: Hash;
    readonly transactionHash: Hash;
    readonly from: Address;
  };
}

interface UpgradeResult {
  readonly transactionHash: Hash;
  readonly blockNumber: bigint;
  readonly migrationExecuted: boolean;
}

// ============================================================================
// Selector Lookup
// ============================================================================

// Cache for selector map - will be refreshed on each call
let cachedSelectorMap: Record<string, SelectorInfo | undefined> | null = null;
let cacheTimestamp = 0;

// Get the directory of this file (ESM compatible)
const currentDir = path.dirname(new URL(import.meta.url).pathname);

/**
 * Get the selector map, reading from file if needed
 * Cache is refreshed if file has been modified
 */
function getSelectorMap(): Record<string, SelectorInfo | undefined> {
  const selectorsPath = path.join(currentDir, "selectors.json");

  try {
    const stats = fs.statSync(selectorsPath);
    const modifiedTime = stats.mtimeMs;

    // Return cached if file hasn't been modified
    if (cachedSelectorMap && modifiedTime <= cacheTimestamp) {
      return cachedSelectorMap;
    }

    // Read and parse the file
    const content = fs.readFileSync(selectorsPath, "utf-8");
    cachedSelectorMap = JSON.parse(content);
    cacheTimestamp = modifiedTime;

    return cachedSelectorMap!;
  } catch {
    // Return empty map if file doesn't exist
    return {};
  }
}

/**
 * Get selector signature from the generated selectors.json
 * This function dynamically reads the file to get the latest signatures
 */
export function getSelectorSignature(selector: Selector): string {
  const selectorMap = getSelectorMap();
  return selectorMap[selector]?.signature ?? selector;
}

// ============================================================================
// Facet Deployment
// ============================================================================

/**
 * Deploy a single facet contract
 */
async function deployFacet(
  publicClient: PublicClient,
  walletClient: HardhatWalletClient,
  contractName: string,
  selectors: readonly Selector[],
): Promise<DeployedFacet> {
  const artifact = await artifacts.readArtifact(contractName);

  console.log(`  - Deploying ${contractName} (${selectors.length} selectors)`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as HashString,
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error(`${contractName} deployment failed - no contract address`);
  }

  const bytecodeHash = computeBytecodeHash(
    artifact.deployedBytecode as HashString,
  );

  console.log(`    ✓ Deployed at ${receipt.contractAddress}`);

  return {
    contractName,
    address: receipt.contractAddress,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionHash: receipt.transactionHash,
    transactionIndex: receipt.transactionIndex,
    from: receipt.from,
    bytecodeHash,
    selectors,
  };
}

/**
 * Deploy all facets that have changes
 */
export async function deployFacets(
  publicClient: PublicClient,
  walletClient: HardhatWalletClient,
  adds: readonly FacetFunctionsWithName[],
  replaces: readonly FacetFunctionsWithName[],
): Promise<readonly DeployedFacet[]> {
  // Collect unique facets that need deployment
  const facetsToDeployMap = new Map<
    string,
    { contractName: string; selectors: Selector[] }
  >();

  for (const facet of [...adds, ...replaces]) {
    const existing = facetsToDeployMap.get(facet.contractName);
    if (existing) {
      existing.selectors.push(...facet.selectors);
    } else {
      facetsToDeployMap.set(facet.contractName, {
        contractName: facet.contractName,
        selectors: [...facet.selectors],
      });
    }
  }

  console.log("\n📦 Deploying facets...");

  const deployedFacets: DeployedFacet[] = [];

  for (const { contractName, selectors } of facetsToDeployMap.values()) {
    const deployed = await deployFacet(
      publicClient,
      walletClient,
      contractName,
      selectors,
    );
    deployedFacets.push(deployed);
  }

  console.log(`✅ Deployed ${deployedFacets.length} facet(s)\n`);

  return deployedFacets;
}

// ============================================================================
// Diamond Deployment
// ============================================================================

/**
 * Deploy a new Diamond contract
 */
export async function deployDiamondContract(
  publicClient: PublicClient,
  walletClient: HardhatWalletClient,
  diamondName: string,
  facetFunctions: readonly FacetFunctions[],
  owner: Address,
): Promise<DeployResult["diamondReceipt"] & { address: Address }> {
  const artifact = await artifacts.readArtifact(diamondName);

  console.log(`\n💎 Deploying ${diamondName}...`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as HashString,
    args: [facetFunctions, owner],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error(`${diamondName} deployment failed - no contract address`);
  }

  console.log(`✅ Diamond deployed at ${receipt.contractAddress}\n`);

  return {
    address: receipt.contractAddress,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionHash: receipt.transactionHash,
    from: receipt.from,
  };
}

// ============================================================================
// Diamond Upgrade
// ============================================================================

/**
 * Execute the upgradeDiamond function on an existing diamond
 */
export async function executeDiamondUpgrade(
  publicClient: PublicClient,
  walletClient: HardhatWalletClient,
  diamondAddress: Address,
  addFunctions: readonly FacetFunctions[],
  replaceFunctions: readonly FacetFunctions[],
  removeFunctions: readonly Selector[],
  delegate: Address,
  delegateCalldata: HashString,
  tag?: string,
): Promise<UpgradeResult> {
  // Get contract interface
  const artifact = await artifacts.readArtifact("DiamondUpgradeFacet");

  console.log("🔄 Executing diamond upgrade...");

  const hash = await walletClient.writeContract({
    address: diamondAddress,
    abi: artifact.abi,
    functionName: "upgradeDiamond",
    args: [
      addFunctions,
      replaceFunctions,
      removeFunctions,
      delegate,
      delegateCalldata,
      tag ? (tag as `0x${string}`) : zeroHash,
      "0x",
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(`✅ Upgrade complete (tx: ${receipt.transactionHash})\n`);

  return {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    migrationExecuted: delegate !== zeroAddress,
  };
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Check if migration is already completed
 */
export async function isMigrationCompleted(
  publicClient: PublicClient,
  diamondAddress: Address,
  migrationFacetName: string,
): Promise<boolean> {
  try {
    const artifact = await artifacts.readArtifact(migrationFacetName);
    const result = await publicClient.readContract({
      address: diamondAddress,
      abi: artifact.abi,
      functionName: "isMigrationCompleted",
    });
    return result as boolean;
  } catch {
    // If the function doesn't exist, assume not completed
    return false;
  }
}

/**
 * Encode migration calldata
 */
export async function encodeMigrationCalldata(
  migrationFacetName: string,
  migrationArgs: Record<string, unknown>,
): Promise<HashString> {
  const artifact = await artifacts.readArtifact(migrationFacetName);

  return encodeFunctionData({
    abi: artifact.abi,
    functionName: "migrate",
    args: [migrationArgs],
  });
}

/**
 * Prepare migration parameters for upgrade
 *
 * IMPORTANT: This function returns the CORRECT values:
 * - When migration NOT completed: delegate = diamondAddress, calldata = encoded migrate()
 * - When migration IS completed: delegate = zeroAddress, calldata = "0x"
 */
export async function prepareMigration(
  publicClient: PublicClient,
  diamondAddress: Address,
  migration: MigrationConfig | undefined,
): Promise<{ delegate: Address; calldata: HashString; willExecute: boolean }> {
  if (!migration || !migration.facetName) {
    return { delegate: zeroAddress, calldata: "0x", willExecute: false };
  }

  const completed = await isMigrationCompleted(
    publicClient,
    diamondAddress,
    migration.facetName,
  );

  if (completed) {
    console.log(`  ⏭️  Migration already completed, skipping`);
    return { delegate: zeroAddress, calldata: "0x", willExecute: false };
  }

  const calldata = await encodeMigrationCalldata(
    migration.facetName,
    migration.args,
  );

  console.log(`  🔄 Migration will execute: ${migration.facetName}`);

  return { delegate: diamondAddress, calldata, willExecute: true };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert deployed facets to FacetFunctions array for contract calls
 */
export function toFacetFunctions(
  deployedFacets: readonly DeployedFacet[],
  facetNamesWithName: readonly FacetFunctionsWithName[],
): FacetFunctions[] {
  const addressMap = new Map<string, Address>();
  for (const facet of deployedFacets) {
    addressMap.set(facet.contractName, facet.address);
  }

  return facetNamesWithName
    .filter((f) => addressMap.has(f.contractName))
    .map((f) => ({
      facet: addressMap.get(f.contractName)!,
      selectors: f.selectors,
    }));
}

/**
 * Convert deployed facets to DeploymentFacet records
 */
export function toDeploymentFacets(
  deployedFacets: readonly DeployedFacet[],
): Record<string, DeploymentFacet> {
  const result: Record<string, DeploymentFacet> = {};

  for (const facet of deployedFacets) {
    result[facet.contractName] = {
      address: facet.address,
      blockNumber: facet.blockNumber.toString(),
      blockHash: facet.blockHash,
      transactionHash: facet.transactionHash,
      transactionIndex: facet.transactionIndex,
      bytecodeHash: facet.bytecodeHash,
      from: facet.from,
    };
  }

  return result;
}

/**
 * Build deployment function records for a deployed facet
 */
export function buildDeploymentFunctions(
  deployedFacets: readonly DeployedFacet[],
): DeploymentFunction[] {
  const functions: DeploymentFunction[] = [];

  for (const facet of deployedFacets) {
    for (const selector of facet.selectors) {
      functions.push({
        selector,
        signature: getSelectorSignature(selector),
        contract: facet.contractName,
      });
    }
  }

  return functions;
}

/**
 * Merge existing functions with new deployments, handling replacements
 */
export function mergeDeploymentFunctions(
  existing: readonly DeploymentFunction[],
  adds: readonly DeploymentFunction[],
  replaces: readonly DeploymentFunction[],
  removes: readonly Selector[],
): DeploymentFunction[] {
  const removeSet = new Set(removes);
  const replaceMap = new Map<Selector, DeploymentFunction>();
  for (const r of replaces) {
    replaceMap.set(r.selector, r);
  }

  // Filter existing: remove deleted and replaced
  const filtered = existing.filter(
    (f) => !removeSet.has(f.selector) && !replaceMap.has(f.selector),
  );

  // Add new functions and replacements
  return [...filtered, ...adds, ...replaces];
}
