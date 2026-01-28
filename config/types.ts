export interface MigrationConfig {
  facetName: string;
  args: Record<string, unknown>;
}

export interface DiamondConfiguration {
  name: string;
  facets: readonly string[];
  migration?: MigrationConfig;
}
