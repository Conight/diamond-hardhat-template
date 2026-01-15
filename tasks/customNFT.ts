import { createDiamondTask } from "./common.js";

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

export default createDiamondTask("CustomNFTDiamond", facets);
