// SPDX-License-Identifier: MIT
pragma solidity >=0.8.34 <0.9.0;

import { DeployAuction } from "./DeployAuction.s.sol";

/// @notice Sepolia rehearsal deployment of the Season 3 auction. Runs the exact same
///         config validation, deployment, and postconditions as DeployAuction. Only the
///         chain gate differs. Mainnet deployments must use DeployAuction directly.
///         The rehearsal NFT must mirror mainnet: seasons 1 and 2 configured at 90 each,
///         `totalMinted == 180` and `mintCap == 180`.
contract DeployAuctionSepolia is DeployAuction {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11_155_111;

    function _requiredChainId() internal pure override returns (uint256) {
        return SEPOLIA_CHAIN_ID;
    }
}
