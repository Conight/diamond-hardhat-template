import { network } from "hardhat";
import { upgradeDiamond } from "./libraries/diamond.js";

const main = async () => {
  const { viem, networkName } = await network.connect();

  const diamondName = "CustomNFTDiamond";
  const facets = [
    "DiamondUpgradeFacet",
    "DiamondInspectFacet",
    "OwnerFacet",
    "ERC165Facet",
    "ERC721Facet",
    "ERC721BurnFacet",
    "CustomNFTFacet",
  ];
  await upgradeDiamond(viem, networkName, diamondName, facets);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
