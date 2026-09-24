// SPDX-License-Identifier: MIT
pragma solidity >=0.8.30;

import "../lib/token/ERC721/Mint/ERC721MintMod.sol" as ERC721MintMod;
import "../lib/access/Owner/Data/OwnerDataMod.sol" as OwnerDataMod;

contract SelectiveFacet {
    function extra() external pure returns (uint256) {
        return 42;
    }
    function helper() external pure returns (uint256) {
        return 99;
    }
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.extra.selector);
    }
}
contract DuplicateSelectorsFacet {
    function extra() external pure returns (uint256) {
        return 0;
    }
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.extra.selector, this.extra.selector);
    }
}
contract MalformedSelectorsFacet {
    function exportSelectors() external pure returns (bytes memory) {
        return hex"123456";
    }
}
contract SelfExportFacet {
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.exportSelectors.selector);
    }
}
contract CollisionFacet {
    function mint(address) external pure {}
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.mint.selector);
    }
}
contract CustomNFTFacetV2 {
    bytes32 constant STORAGE_POSITION = keccak256("conight.customNFT.storage");
    struct NFTStorage {
        uint256 totalSupply;
    }
    function store() internal pure returns (NFTStorage storage s) {
        bytes32 position = STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
    function mint(address to) external {
        NFTStorage storage s = store();
        ERC721MintMod.mint(to, s.totalSupply++);
    }
    function mintedSupply() external view returns (uint256) {
        return store().totalSupply;
    }
    function version() external pure returns (uint256) {
        return 2;
    }
    function exportSelectors() external pure returns (bytes memory) {
        // Changes the first selector as well as adding and removing selectors.
        return bytes.concat(this.version.selector, this.mint.selector, this.mintedSupply.selector);
    }
}
contract MigrationV2Facet {
    bytes32 constant ID = keccak256("CustomNFT_Migration_V2");
    bytes32 constant POSITION = keccak256("conight.customNFT.storage.migration");
    struct MigrationStorage {
        mapping(bytes32 => bool) completed;
    }
    struct Params {
        address mintTo;
    }
    function store() internal pure returns (MigrationStorage storage s) {
        bytes32 position = POSITION;
        assembly {
            s.slot := position
        }
    }
    function migrationId() external pure returns (bytes32) {
        return ID;
    }
    function isMigrationCompleted(bytes32 id) external view returns (bool) {
        return store().completed[id];
    }
    function migrate(Params calldata params) external {
        OwnerDataMod.requireOwner();
        require(!store().completed[ID], "already migrated");
        ERC721MintMod.mint(params.mintTo, 999);
        store().completed[ID] = true;
    }
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.migrate.selector, this.migrationId.selector, this.isMigrationCompleted.selector);
    }
}
contract RevertingMigrationFacet {
    struct Params {
        address mintTo;
    }
    function migrationId() external pure returns (bytes32) {
        return keccak256("reverting");
    }
    function isMigrationCompleted(bytes32) external pure returns (bool) {
        return false;
    }
    function migrate(Params calldata) external pure {
        revert("migration failed");
    }
    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.migrate.selector, this.migrationId.selector, this.isMigrationCompleted.selector);
    }
}
