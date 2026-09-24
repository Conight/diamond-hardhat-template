/** ERC-8153 deployment and upgrade types. */
import type { Abi, Address, Hash, Hex } from "viem";

export type HashString = Hex;
export type Selector = Hex;
export interface FacetReplacement {
  readonly oldFacet: Address;
  readonly newFacet: Address;
}
export interface OnChainFacet {
  readonly facet: Address;
  readonly functionSelectors: readonly Selector[];
}
export interface FacetArtifact {
  readonly contractName: string;
  readonly abi: Abi;
  readonly bytecode: Hex;
  readonly deployedBytecode: Hex;
  readonly selectors: readonly Selector[];
}
export interface ExistingFacet {
  readonly contractName: string;
  readonly address: Address;
  readonly selectors: readonly Selector[];
}
export interface PlannedReplacement {
  readonly previous: ExistingFacet;
  readonly next: FacetArtifact;
}
export interface DiamondDiff {
  readonly adds: readonly FacetArtifact[];
  readonly replaces: readonly PlannedReplacement[];
  readonly removes: readonly ExistingFacet[];
  readonly unchanged: readonly ExistingFacet[];
  readonly hasChanges: boolean;
}
export interface DeploymentFunction {
  readonly selector: Selector;
  readonly signature: string;
  readonly contract: string;
}
export interface DeploymentFacet {
  readonly address: Address;
  readonly selectors: readonly Selector[];
  readonly blockNumber: string;
  readonly blockHash: Hash;
  readonly transactionHash: Hash;
  readonly transactionIndex: number;
  readonly bytecodeHash: Hash;
  readonly from: Address;
}
export interface UpgradeRecord {
  readonly timestamp: string;
  readonly blockNumber: string;
  readonly transactionHash: Hash;
  readonly added: readonly Address[];
  readonly replaced: readonly FacetReplacement[];
  readonly removed: readonly Address[];
  readonly migrationExecuted: boolean;
}
export interface DiamondDeployment {
  readonly version: 3;
  readonly standard: "ERC-8153";
  readonly chainId: number;
  readonly diamond: Address;
  readonly functions: readonly DeploymentFunction[];
  readonly owner: Address;
  readonly blockNumber: string;
  readonly blockHash: Hash;
  readonly facets: Readonly<Record<string, DeploymentFacet>>;
  readonly upgradeHistory: readonly UpgradeRecord[];
}
export interface MigrationConfig<TParams = Record<string, unknown>> {
  readonly facetName: string;
  readonly args: TParams;
}
export interface DiamondConfig<TMigration = Record<string, unknown>> {
  readonly name: string;
  readonly facets: readonly string[];
  readonly migration?: MigrationConfig<TMigration>;
  /** Map a renamed/new contract name to the deployed name it replaces. */
  readonly replacements?: Readonly<Record<string, string>>;
}
export interface OperationPlan {
  readonly diff: DiamondDiff;
  readonly isUpgrade: boolean;
  readonly migration?: string;
}
export interface OperationOptions {
  /** Defaults to the interactive transaction confirmation. */
  readonly confirm?: (plan: OperationPlan) => Promise<boolean>;
}
export interface SelectorInfo {
  readonly signature: string;
  readonly contracts: readonly string[];
}
export type SelectorMap = Record<string, SelectorInfo>;
