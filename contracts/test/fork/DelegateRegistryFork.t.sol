// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Panorama } from "../../src/Panorama.sol";
import { PanoramaSeason3SignalController } from "../../src/PanoramaSeason3SignalController.sol";

interface IDelegateRegistryV2 {
    function delegateAll(address to, bytes32 rights, bool enable) external payable returns (bytes32);
    function delegateERC721(
        address to,
        address contract_,
        uint256 tokenId,
        bytes32 rights,
        bool enable
    ) external payable returns (bytes32);
}

interface IDelegationRegistryV1 {
    function delegateForAll(address delegate, bool value) external;
    function delegateForToken(address delegate, address contract_, uint256 tokenId, bool value) external;
}

/// @dev `setTokenSignal` against the real delegate.xyz v2 and v1 registries on a mainnet fork. Runs when
///      MAINNET_FORK_RPC is set: `MAINNET_FORK_RPC=<url> forge test --match-path test/fork/*`.
contract DelegateRegistryForkTest is Test {
    Panorama nft;
    PanoramaSeason3SignalController signals;
    IDelegateRegistryV2 registry;
    address vault = address(0x5A17);
    address hot = address(0x407);

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        nft = new Panorama();
        nft.mintTo(vault, 190); // the fresh NFT has no mint controller: the owner mints freely
        signals = new PanoramaSeason3SignalController(address(nft));
        registry = IDelegateRegistryV2(signals.DELEGATE_REGISTRY());
        assertGt(address(registry).code.length, 0, "no delegate registry on this chain");
    }

    function test_fork_delegateAll() public {
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(181, "x");

        vm.prank(vault);
        registry.delegateAll(hot, bytes32(0), true);
        vm.prank(hot);
        signals.setTokenSignal(181, "from the hot wallet");
        assertEq(signals.tokenSignal(181), "from the hot wallet");
    }

    function test_fork_delegateToken() public {
        vm.prank(vault);
        registry.delegateERC721(hot, address(nft), 182, bytes32(0), true);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(181, "x");
        vm.prank(hot);
        signals.setTokenSignal(182, "one token");
        assertEq(signals.tokenSignal(182), "one token");
    }

    function test_fork_v1DelegateForAll() public {
        IDelegationRegistryV1 v1 = IDelegationRegistryV1(signals.DELEGATE_REGISTRY_V1());
        assertGt(address(v1).code.length, 0, "no v1 registry on this chain");
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "x");
        vm.prank(vault);
        v1.delegateForAll(hot, true);
        vm.prank(hot);
        signals.setTokenSignal(183, "v1 wallet");
        assertEq(signals.tokenSignal(183), "v1 wallet");
    }

    function test_fork_v1DelegateForToken() public {
        IDelegationRegistryV1 v1 = IDelegationRegistryV1(signals.DELEGATE_REGISTRY_V1());
        vm.prank(vault);
        v1.delegateForToken(hot, address(nft), 184, true);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(185, "x");
        vm.prank(hot);
        signals.setTokenSignal(184, "v1 token");
        assertEq(signals.tokenSignal(184), "v1 token");
    }
}
