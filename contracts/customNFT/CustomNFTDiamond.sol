// SPDX-License-Identifier: MIT
pragma solidity >=0.8.30;

import "lib/diamond/DiamondMod.sol" as DiamondMod;
import "lib/access/Owner/OwnerMod.sol" as OwnerMod;
import "lib/token/ERC721/ERC721/ERC721Mod.sol" as ERC721Mod;
import "lib/interfaceDetection/ERC165/ERC165Mod.sol" as ERC165Mod;
import {IERC721} from "lib/interfaces/IERC721.sol";
import {IERC721Metadata} from "lib/interfaces/IERC721Metadata.sol";

contract CustomNFTDiamond {
    /**
     * @notice Struct to hold facet address and its function selectors.
     * struct FacetFunctions {
     *     address facet;
     *     bytes4[] selectors;
     * }
     */
    /**
     * @notice Initializes the diamond contract with facets, owner and other data.
     * @dev Adds all provided facets to the diamond's function selector mapping and sets the contract owner.
     *      Each facet in the array will have its function selectors registered to enable delegatecall routing.
     * @param _facets Array of facet addresses and their corresponding function selectors to add to the diamond.
     * @param _diamondOwner Address that will be set as the owner of the diamond contract.
     */
    constructor(
        DiamondMod.FacetFunctions[] memory _facets,
        address _diamondOwner
    ) {
        DiamondMod.addFacets(_facets);

        /*************************************
         * Initialize storage variables
         ************************************/

        /**
         * Setting the contract owner
         */
        OwnerMod.setContractOwner(_diamondOwner);
        /**
         * Setting ERC721 token details
         */
        ERC721Mod.setMetadata({
            _name: "CustomNFT",
            _symbol: "cNFT",
            _baseURI: "https://example.com/metadata/"
        });
        /**
         * Registering ERC165 interfaces
         */
        ERC165Mod.registerInterface(type(IERC721).interfaceId);
        ERC165Mod.registerInterface(type(IERC721Metadata).interfaceId);
    }

    fallback() external payable {
        DiamondMod.diamondFallback();
    }

    receive() external payable {}
}
