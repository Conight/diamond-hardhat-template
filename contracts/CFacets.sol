// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CFacets {
    function cFunc1() external pure returns (uint256) {
        return 1;
    }

    function cFunc2() external pure returns (uint256) {
        return 2;
    }

    function cFunc3() external pure returns (uint256) {
        return 3;
    }

    function supportsInterface(
        bytes4 _interfaceID
    ) external view returns (bool) {}
}
