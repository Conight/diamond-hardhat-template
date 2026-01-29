/**
 * Diamond Deployment Types
 *
 * Type definitions for the Diamond deployment and upgrade system.
 * Following ERC-8109 Diamonds, Simplified standard.
 */

import type { Address, Hash } from "viem";

// ============================================================================
// Hex Types
// ============================================================================

export type HashString = `0x${string}`;
export type Selector = `0x${string}`;

// ============================================================================
// Function Change Types
// ============================================================================

export type FunctionChangeType = "add" | "replace" | "remove" | "ignored";

/**
 * A single function selector change with its new facet address
 */
export interface FunctionChange {
  readonly selector: Selector;
  readonly facet: Address;
  readonly changeType: FunctionChangeType;
  readonly signature?: string;
}

/**
 * Facet with its associated function selectors
 * Matches the Solidity struct: struct FacetFunctions { address facet; bytes4[] selectors; }
 */
export interface FacetFunctions {
  readonly facet: Address;
  readonly selectors: readonly Selector[];
}

/**
 * Extended facet info with contract name for tracking
 */
export interface FacetFunctionsWithName extends FacetFunctions {
  readonly contractName: string;
}

// ============================================================================
// Selector Diff Types
// ============================================================================

/**
 * Diff result for a single facet contract
 */
export interface SelectorDiff {
  readonly contractName: string;
  readonly facet: Address;
  readonly add: readonly Selector[];
  readonly replace: readonly Selector[];
  readonly ignored: readonly Selector[];
  readonly bytecodeChanged: boolean;
}

/**
 * Complete diff result for an upgrade operation
 */
export interface DiamondDiff {
  readonly adds: readonly FacetFunctionsWithName[];
  readonly replaces: readonly FacetFunctionsWithName[];
  readonly removes: readonly Selector[];
  readonly unchanged: readonly FacetFunctionsWithName[];
  readonly hasChanges: boolean;
}

// ============================================================================
// Deployment File Types
// ============================================================================

/**
 * Function record in deployment file
 */
export interface DeploymentFunction {
  readonly selector: Selector;
  readonly signature: string;
  readonly contract: string;
}

/**
 * Facet deployment details
 */
export interface DeploymentFacet {
  readonly address: Address;
  readonly blockNumber: string;
  readonly blockHash: Hash;
  readonly transactionHash: Hash;
  readonly transactionIndex: number;
  readonly bytecodeHash: HashString;
  readonly from: Address;
}

/**
 * Upgrade history entry
 */
export interface UpgradeRecord {
  readonly timestamp: string;
  readonly blockNumber: string;
  readonly transactionHash: Hash;
  readonly tag?: string;
  readonly added: readonly DeploymentFunction[];
  readonly replaced: readonly DeploymentFunction[];
  readonly removed: readonly Selector[];
  readonly migrationExecuted: boolean;
}

/**
 * Complete deployment file structure (v2 format)
 */
export interface DiamondDeployment {
  readonly version: 2;
  readonly diamond: Address;
  readonly functions: readonly DeploymentFunction[];
  readonly owner: Address;
  readonly blockNumber: string;
  readonly blockHash: Hash;
  readonly facets: Record<string, DeploymentFacet>;
  readonly upgradeHistory: readonly UpgradeRecord[];
}

/**
 * Legacy deployment file structure (v1 format - for migration)
 */
export interface LegacyDiamondDeployment {
  readonly diamond: Address;
  readonly functions: readonly DeploymentFunction[];
  readonly owner: Address;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly facets: Record<string, Omit<DeploymentFacet, "bytecodeHash">>;
  readonly upgradeHistory: readonly unknown[];
}

// ============================================================================
// Selector Lookup Types
// ============================================================================

/**
 * Selector info from the generated selectors.json
 */
export interface SelectorInfo {
  readonly signature: string;
  readonly contracts: readonly string[];
}

export type SelectorMap = Record<string, SelectorInfo | undefined>;

// ============================================================================
// FunctionFacetPair (matches Solidity struct from DiamondInspectFacet)
// ============================================================================

export interface FunctionFacetPair {
  readonly selector: Selector;
  readonly facet: Address;
}

// ============================================================================
// Migration Types
// ============================================================================

/**
 * Migration configuration
 */
export interface MigrationConfig<TParams = Record<string, unknown>> {
  readonly facetName: string;
  readonly args: TParams;
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  readonly executed: boolean;
  readonly transactionHash?: Hash;
  readonly alreadyCompleted: boolean;
}

// ============================================================================
// Diamond Configuration
// ============================================================================

/**
 * Configuration for a Diamond contract
 */
export interface DiamondConfig<TMigration = Record<string, unknown>> {
  readonly name: string;
  readonly facets: readonly string[];
  readonly migration?: MigrationConfig<TMigration>;
}

// ============================================================================
// Deployment Context
// ============================================================================

/**
 * Context passed through deployment/upgrade operations
 */
export interface DeploymentContext {
  readonly networkName: string;
  readonly diamondName: string;
  readonly isUpgrade: boolean;
  readonly existingDeployment?: DiamondDeployment;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a deployment file is legacy format (v1)
 */
export function isLegacyDeployment(
  deployment: unknown,
): deployment is LegacyDiamondDeployment {
  if (!deployment || typeof deployment !== "object") return false;
  const d = deployment as Record<string, unknown>;
  return !("version" in d) && "diamond" in d && "functions" in d;
}

/**
 * Check if a deployment file is v2 format
 */
export function isV2Deployment(
  deployment: unknown,
): deployment is DiamondDeployment {
  if (!deployment || typeof deployment !== "object") return false;
  const d = deployment as Record<string, unknown>;
  return d.version === 2;
}

/**
 * Validate selector format
 */
export function isValidSelector(value: unknown): value is Selector {
  return typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value);
}

/**
 * Validate address format
 */
export function isValidAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
