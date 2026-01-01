// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract AFacets {
    function aFunc1() external pure returns (uint256) {
        return 1;
    }

    // function aFunc2() external pure returns (uint256) {
    //     return 2;
    // }

    function supportsInterface(
        bytes4 _interfaceID
    ) external view returns (bool) {}
}
