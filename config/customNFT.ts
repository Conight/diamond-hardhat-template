import type { Address } from "viem";
import type { DiamondConfiguration } from "@/config/types.js";

// ============================================================================
// Constants & Types
// ============================================================================

const DEFAULT_MINT_TO: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

interface NetworkConfig {
  mintTo: Address;
}

// ============================================================================
// Base Configuration (Shared across networks)
// ============================================================================

const BASE_FACETS = [
  "DiamondUpgradeFacet",
  "DiamondInspectFacet",
  "OwnerFacet",
  "ERC165Facet",
  "ERC721TransferFacet",
  "ERC721DataFacet",
  "ERC721ApproveFacet",
  "ERC721BurnFacet",
  "CustomNFTFacet",
] as const;

// ============================================================================
// Network Specific Configurations
// ============================================================================

const NETWORKS: Record<string, NetworkConfig> = {
  // Local Development
  hardhat: { mintTo: DEFAULT_MINT_TO },
  localhost: { mintTo: DEFAULT_MINT_TO },

  // Testnets
  sepolia: {
    mintTo: (process.env.SEPOLIA_MINT_TO as Address) || DEFAULT_MINT_TO,
  }, // Fallback for safety, ideally throw

  // Mainnets
  mainnet: {
    mintTo: (process.env.MAINNET_MINT_TO as Address) || DEFAULT_MINT_TO,
  },
};

// ============================================================================
// Config Factory
// ============================================================================

export const getCustomNFTConfig = (
  networkName: string,
): DiamondConfiguration => {
  const networkConfig = NETWORKS[networkName] || NETWORKS.localhost;

  return {
    name: "CustomNFTDiamond",
    facets: BASE_FACETS,
    migration: {
      facetName: "CustomNFTMigrationFacet",
      args: {
        mintTo: networkConfig.mintTo,
      },
    },
  };
};
