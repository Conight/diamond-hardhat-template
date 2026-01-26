// Diamond Facets Configuration
// Shared between deployment tasks and wagmi configuration

import { MigrationConfig } from "@/scripts/libraries/diamond.js";

interface DiamondConfig {
  facets: string[];
  migration: MigrationConfig;
}

export const CustomNFT: DiamondConfig = {
  facets: [
    "DiamondUpgradeFacet",
    "DiamondInspectFacet",
    "OwnerFacet",
    "ERC165Facet",
    "ERC721TransferFacet",
    "ERC721DataFacet",
    "ERC721ApproveFacet",
    "ERC721BurnFacet",
    "CustomNFTFacet",
  ],
  migration: {
    facetName: "CustomNFTMigrationFacet",
    args: { mintTo: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  },
};
