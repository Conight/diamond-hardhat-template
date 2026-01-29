/**
 * Diamond Library Index
 *
 * Clean re-exports for the Diamond deployment system.
 */

// Main API
export {
  deployDiamond,
  upgradeDiamond,
  deployOrUpgrade,
  loadDeployment,
} from "./diamond.js";

// Types
export type {
  DiamondConfig,
  MigrationConfig,
  DiamondDeployment,
  DeploymentFunction,
  DeploymentFacet,
  UpgradeRecord,
  FacetFunctions,
  Selector,
  HashString,
} from "./types.js";

// Utilities (for advanced usage)
export { computeDiamondDiff } from "./diffing.js";
export {
  deploymentExists,
  getDeploymentPath,
  saveDeployment,
} from "./deployment.js";
export { getSelectorSignature } from "./executor.js";
export { confirmChanges, displayChanges } from "./prompts.js";
