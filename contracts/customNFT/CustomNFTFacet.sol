// SPDX-License-Identifier: MIT
pragma solidity >=0.8.30;

import "lib/token/ERC721/Mint/ERC721MintMod.sol" as ERC721MintMod;

/**
 * @title CustomNFTFacet
 * @notice Facet for managing custom NFT minting with diamond storage pattern
 * @dev Uses diamond storage pattern to avoid storage collisions
 */
contract CustomNFTFacet {
    // ============ Storage ============

    /// @dev Storage position for CustomNFT data
    bytes32 private constant STORAGE_POSITION =
        keccak256("conight.customNFT.storage");

    struct CustomNFTStorage {
        uint256 totalSupply;
        // Future fields can be added here without storage conflicts
    }

    // ============ Internal Functions ============

    /**
     * @dev Returns a storage pointer to the CustomNFT storage
     * @return s Storage pointer to CustomNFTStorage struct
     */
    function getStorage() internal pure returns (CustomNFTStorage storage s) {
        bytes32 position = STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    /**
     * @dev Returns the current total supply
     * @return Current total supply of NFTs
     */
    function _totalSupply() internal view returns (uint256) {
        return getStorage().totalSupply;
    }

    // ============ External Functions ============

    /**
     * @notice Mints a new NFT to the specified address
     * @dev Increments totalSupply and assigns the new tokenId
     * @param to The address to receive the minted NFT
     */
    function mint(address to) external {
        // Get storage pointer once to save gas
        CustomNFTStorage storage s = getStorage();

        // Cache tokenId to avoid multiple SLOADs
        uint256 tokenId = s.totalSupply;

        // Mint the token
        ERC721MintMod.mintERC721(to, tokenId);

        // Update supply (safe to use unchecked as overflow is practically impossible)
        unchecked {
            s.totalSupply = tokenId + 1;
        }
    }

    /**
     * @notice Returns the total supply of minted NFTs
     * @return Total number of NFTs minted
     */
    function totalSupply() external view returns (uint256) {
        return _totalSupply();
    }
}
