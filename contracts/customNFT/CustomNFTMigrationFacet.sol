// SPDX-License-Identifier: MIT
pragma solidity >=0.8.30;

contract CustomNFTMigrationFacet {
    // For future upgrades, you can change the migration ID
    // e.g., currentMigrationId = "CustomNFT_Migration_V2"
    string constant currentMigrationId = "CustomNFT_Migration_V1";

    error MigrationAlreadyExecuted(string migrationId);

    bytes32 constant MIGRATION_STORAGE_POSITION = keccak256("conight.customNFT.storage.migration");

    struct MigrationStorage {
        mapping(string => bool) executedMigrations;
    }

    event MigrationExecuted(string migrationId, address executor);

    function getMigrationStorage() internal pure returns (MigrationStorage storage s) {
        bytes32 position = MIGRATION_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function _setCompleted(string memory _migrationId) internal {
        MigrationStorage storage s = getMigrationStorage();
        s.executedMigrations[_migrationId] = true;
    }

    function _isCompleted(string memory _migrationId) internal view returns (bool) {
        MigrationStorage storage s = getMigrationStorage();
        return s.executedMigrations[_migrationId];
    }

    struct MigrationParams {
        // Add any parameters needed for migration here
        address mintTo;
    }

    /**
     * @notice Example migration function with parameters.
     * @dev This function is automatically detected by the deployment script.
     *      It is used to migration state after deployment or upgrade.
     *      The logic manually implements the protected migration pattern to avoid modifiers.
     * @param params Encoded migration parameters.
     */
    function migrate(MigrationParams memory params) external {
        if (_isCompleted(currentMigrationId)) {
            revert MigrationAlreadyExecuted(currentMigrationId);
        }

        // Example migration logic
        // e.g., setting variables if not set in constructor

        // You can add more logic here.

        _setCompleted(currentMigrationId);
        emit MigrationExecuted(currentMigrationId, msg.sender);
    }

    /**
     * @notice Check if the current migration has been completed.
     * @return bool indicating if the migration is completed.
     */
    function isMigrationCompleted() external view returns (bool) {
        return _isCompleted(currentMigrationId);
    }
}
