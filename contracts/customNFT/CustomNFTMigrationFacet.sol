// SPDX-License-Identifier: MIT
pragma solidity >=0.8.30;

import "lib/access/Owner/Data/OwnerDataMod.sol" as OwnerDataMod;

/** @notice Example of a versioned, owner-authorized migration. */
contract CustomNFTMigrationFacet {
    bytes32 constant CURRENT_MIGRATION_ID = keccak256("CustomNFT_Migration_V1");
    bytes32 constant MIGRATION_STORAGE_POSITION = keccak256("conight.customNFT.storage.migration");

    struct MigrationStorage {
        mapping(bytes32 id => bool completed) completed;
    }
    struct MigrationParams {
        address mintTo;
    }
    error MigrationAlreadyExecuted(bytes32 id);
    event MigrationExecuted(bytes32 indexed id, address indexed executor);

    function getMigrationStorage() internal pure returns (MigrationStorage storage s) {
        bytes32 position = MIGRATION_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function migrationId() external pure returns (bytes32) {
        return CURRENT_MIGRATION_ID;
    }

    function isMigrationCompleted(bytes32 id) external view returns (bool) {
        return getMigrationStorage().completed[id];
    }

    function migrate(MigrationParams calldata /* params */) external {
        OwnerDataMod.requireOwner();
        MigrationStorage storage s = getMigrationStorage();
        if (s.completed[CURRENT_MIGRATION_ID]) {
            revert MigrationAlreadyExecuted(CURRENT_MIGRATION_ID);
        }
        // Add initialization logic here. Change CURRENT_MIGRATION_ID for each new migration.
        s.completed[CURRENT_MIGRATION_ID] = true;
        emit MigrationExecuted(CURRENT_MIGRATION_ID, msg.sender);
    }

    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(this.migrate.selector, this.migrationId.selector, this.isMigrationCompleted.selector);
    }
}
