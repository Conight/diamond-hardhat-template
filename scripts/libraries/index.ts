export {
  deployDiamond,
  upgradeDiamond,
  deployOrUpgrade,
  loadDeployment,
} from "./diamond.js";
export type {
  DiamondConfig,
  MigrationConfig,
  DiamondDeployment,
  DeploymentFunction,
  DeploymentFacet,
  UpgradeRecord,
  FacetReplacement,
  Selector,
  HashString,
  OperationOptions,
} from "./types.js";
export { computeDiamondDiff } from "./diffing.js";
export {
  deploymentExists,
  getDeploymentPath,
  saveDeployment,
} from "./deployment.js";
export { inspectFacetArtifact, unpackSelectors } from "./selectors.js";
export { confirmChanges, displayChanges } from "./prompts.js";
