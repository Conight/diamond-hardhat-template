import { network } from "hardhat";
import { deployDiamond } from "./libraries/diamond.js";

const main = async () => {
  const { viem, networkName } = await network.connect();

  const diamondName = "CustomNFTDiamond";
  const facets = [
    "DiamondUpgradeFacet",
    "DiamondInspectFacet",
    "OwnerFacet",
    "ERC165Facet",
    "ERC721TransferFacet",
    "ERC721DataFacet",
    "ERC721ApproveFacet",
    "ERC721BurnFacet",
    "CustomNFTFacet",
  ];

  await deployDiamond(viem, networkName, diamondName, facets, {
    facetName: "CustomNFTMigrationFacet",
    args: { mintTo: "0x000000000000000000000000000000000000dEaD" },
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
