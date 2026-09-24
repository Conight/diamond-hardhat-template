/** Plan whole-facet operations using the diamond's actual routing table. */
import type { Address, PublicClient } from "viem";
import type {
  DiamondDeployment,
  DiamondDiff,
  ExistingFacet,
  FacetArtifact,
  OnChainFacet,
} from "./types.js";
import { assertUniqueSelectors } from "./selectors.js";

const key = (address: Address) => address.toLowerCase();

export function assertDeploymentMatchesChain(
  deployment: DiamondDeployment,
  onChain: readonly OnChainFacet[],
): void {
  const recorded = Object.values(deployment.facets);
  if (recorded.length !== onChain.length)
    throw new Error("Deployment record does not match on-chain facets");
  for (const facet of recorded) {
    const chain = onChain.find((f) => key(f.facet) === key(facet.address));
    if (
      !chain ||
      chain.functionSelectors.length !== facet.selectors.length ||
      facet.selectors.some((s, i) => s !== chain.functionSelectors[i])
    ) {
      throw new Error(
        `Deployment record does not match on-chain facet ${facet.address}`,
      );
    }
  }
}

export async function computeDiamondDiff(
  publicClient: PublicClient,
  localFacets: readonly FacetArtifact[],
  deployment?: DiamondDeployment,
  onChain: readonly OnChainFacet[] = [],
  replacements: Readonly<Record<string, string>> = {},
): Promise<DiamondDiff> {
  assertUniqueSelectors(localFacets);
  if (!deployment) {
    if (Object.keys(replacements).length)
      throw new Error("Replacement mappings are only valid for upgrades");
    return {
      adds: localFacets,
      replaces: [],
      removes: [],
      unchanged: [],
      hasChanges: localFacets.length > 0,
    };
  }
  assertDeploymentMatchesChain(deployment, onChain);
  const localNames = new Set(localFacets.map((f) => f.contractName));
  for (const name of Object.keys(replacements)) {
    if (!localNames.has(name))
      throw new Error(`Replacement target ${name} is not configured`);
  }
  const adds: FacetArtifact[] = [];
  const replaces: { previous: ExistingFacet; next: FacetArtifact }[] = [];
  const unchanged: ExistingFacet[] = [];
  const retained = new Set<string>();
  for (const next of localFacets) {
    const mappedName = replacements[next.contractName];
    // A rename mapping may remain in configuration after it has been applied.
    const oldName =
      mappedName && deployment.facets[mappedName]
        ? mappedName
        : next.contractName;
    const old = deployment.facets[oldName];
    if (replacements[next.contractName] && !old)
      throw new Error(`Replacement source ${oldName} is not deployed`);
    if (!old) {
      adds.push(next);
      continue;
    }
    if (retained.has(oldName))
      throw new Error(`Multiple facets replace ${oldName}`);
    retained.add(oldName);
    const previous = {
      contractName: oldName,
      address: old.address,
      selectors: old.selectors,
    };
    const bytecode = await publicClient.getCode({ address: old.address });
    if (bytecode === next.deployedBytecode && oldName === next.contractName) {
      unchanged.push(previous);
    } else {
      replaces.push({ previous, next });
    }
  }
  const removes = Object.entries(deployment.facets)
    .filter(([name]) => !retained.has(name))
    .map(([contractName, facet]) => ({
      contractName,
      address: facet.address,
      selectors: facet.selectors,
    }));

  // ERC-8153 applies adds, then replacements, then removals. A selector cannot
  // move between unrelated facets in this transaction, even if its old facet is removed.
  const owners = new Map(
    onChain.flatMap((facet) =>
      facet.functionSelectors.map((s) => [s, key(facet.facet)] as const),
    ),
  );
  for (const next of adds) {
    for (const selector of next.selectors) {
      if (owners.has(selector))
        throw new Error(
          `${next.contractName}: selector ${selector} already exists. Use an explicit replacement or a separate removal upgrade.`,
        );
    }
  }
  for (const { previous, next } of replaces) {
    for (const selector of next.selectors) {
      const owner = owners.get(selector);
      if (owner && owner !== key(previous.address))
        throw new Error(
          `${next.contractName}: selector ${selector} belongs to a different facet; split/merge requires staged upgrades`,
        );
    }
  }
  return {
    adds,
    replaces,
    removes,
    unchanged,
    hasChanges: adds.length + replaces.length + removes.length > 0,
  };
}
