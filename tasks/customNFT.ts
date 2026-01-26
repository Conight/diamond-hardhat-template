import { createDiamondTask } from "./common.js";
import { CustomNFT } from "./config.js";

export default createDiamondTask(
  "CustomNFTDiamond",
  CustomNFT.facets,
  CustomNFT.migration,
);
