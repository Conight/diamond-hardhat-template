/**
 * Diamond Diffing Module
 *
 * Pure functions for computing changes between on-chain diamond state
 * and local facet artifacts.
 */

import { artifacts } from "hardhat";
import { toFunctionSelector, type Address, type PublicClient } from "viem";
import type { Abi, AbiFunction } from "viem";
import type {
  DiamondDeployment,
  DiamondDiff,
  FacetFunctionsWithName,
  FunctionFacetPair,
  HashString,
  Selector,
  SelectorDiff,
} from "./types.js";
import { zeroAddress } from "viem";

// ============================================================================
// Pure Functions for Computing Diffs
// ============================================================================

/**
 * Extract function selectors from a contract ABI
 */
export function extractSelectorsFromAbi(abi: Abi): Selector[] {
  return abi
    .filter((item): item is AbiFunction => item.type === "function")
    .map((func) => toFunctionSelector(func) as Selector);
}

/**
 * Get function signatures from ABI (for display)
 */
export function getAbiFunctions(abi: Abi): AbiFunction[] {
  return abi.filter((item): item is AbiFunction => item.type === "function");
}

/**
 * Compare local bytecode with on-chain bytecode
 */
export async function hasBytecodeChanged(
  publicClient: PublicClient,
  onChainAddress: Address | undefined,
  localBytecode: HashString,
): Promise<boolean> {
  if (!onChainAddress) return true;

  const onChainBytecode = await publicClient.getCode({
    address: onChainAddress,
  });

  return onChainBytecode !== localBytecode;
}

/**
 * Compute the diff for a single facet contract
 */
export async function computeFacetDiff(
  publicClient: PublicClient,
  contractName: string,
  existingDeployment: DiamondDeployment | undefined,
  onChainFacets: readonly FunctionFacetPair[] | undefined,
): Promise<SelectorDiff> {
  const artifact = await artifacts.readArtifact(contractName);
  const selectors = extractSelectorsFromAbi(artifact.abi as Abi);
  const localBytecode = artifact.deployedBytecode as HashString;

  // For new deployments, all functions are adds
  if (!existingDeployment) {
    return {
      contractName,
      facet: zeroAddress,
      add: selectors,
      replace: [],
      ignored: [],
      bytecodeChanged: true,
    };
  }

  // Check if bytecode changed
  const deployedFacet = existingDeployment.facets[contractName];
  const bytecodeChanged = await hasBytecodeChanged(
    publicClient,
    deployedFacet?.address,
    localBytecode,
  );

  // If bytecode hasn't changed, all selectors are ignored
  if (!bytecodeChanged) {
    return {
      contractName,
      facet: deployedFacet!.address,
      add: [],
      replace: [],
      ignored: selectors,
      bytecodeChanged: false,
    };
  }

  // Bytecode changed - categorize selectors
  const add: Selector[] = [];
  const replace: Selector[] = [];

  for (const selector of selectors) {
    const existsOnChain = onChainFacets?.some((p) => p.selector === selector);
    if (existsOnChain) {
      replace.push(selector);
    } else {
      add.push(selector);
    }
  }

  return {
    contractName,
    facet: zeroAddress, // Will be set after deployment
    add,
    replace,
    ignored: [],
    bytecodeChanged: true,
  };
}

/**
 * Find selectors that should be removed (exist on-chain but not in local config)
 */
export function computeRemoved(
  onChainFacets: readonly FunctionFacetPair[],
  localSelectors: ReadonlySet<Selector>,
): Selector[] {
  return onChainFacets
    .filter((p) => !localSelectors.has(p.selector as Selector))
    .map((p) => p.selector as Selector);
}

/**
 * Compute complete diamond diff
 */
export async function computeDiamondDiff(
  publicClient: PublicClient,
  facetNames: readonly string[],
  existingDeployment: DiamondDeployment | undefined,
  onChainFacets: readonly FunctionFacetPair[] | undefined,
): Promise<DiamondDiff> {
  const adds: FacetFunctionsWithName[] = [];
  const replaces: FacetFunctionsWithName[] = [];
  const unchanged: FacetFunctionsWithName[] = [];
  const allLocalSelectors = new Set<Selector>();

  // Process each facet
  for (const contractName of facetNames) {
    const diff = await computeFacetDiff(
      publicClient,
      contractName,
      existingDeployment,
      onChainFacets,
    );

    // Track all local selectors for removal detection
    [...diff.add, ...diff.replace, ...diff.ignored].forEach((s) =>
      allLocalSelectors.add(s),
    );

    if (diff.add.length > 0) {
      adds.push({
        contractName,
        facet: diff.facet,
        selectors: diff.add,
      });
    }

    if (diff.replace.length > 0) {
      replaces.push({
        contractName,
        facet: diff.facet,
        selectors: diff.replace,
      });
    }

    if (diff.ignored.length > 0) {
      unchanged.push({
        contractName,
        facet: diff.facet,
        selectors: diff.ignored,
      });
    }
  }

  // Find removed selectors
  const removes = onChainFacets
    ? computeRemoved(onChainFacets, allLocalSelectors)
    : [];

  const hasChanges =
    adds.length > 0 || replaces.length > 0 || removes.length > 0;

  return {
    adds,
    replaces,
    removes,
    unchanged,
    hasChanges,
  };
}

/**
 * Get all selectors from a diff (for validation)
 */
export function getAllSelectorsFromDiff(diff: DiamondDiff): Set<Selector> {
  const selectors = new Set<Selector>();

  for (const facet of [...diff.adds, ...diff.replaces, ...diff.unchanged]) {
    for (const selector of facet.selectors) {
      selectors.add(selector);
    }
  }

  return selectors;
}
