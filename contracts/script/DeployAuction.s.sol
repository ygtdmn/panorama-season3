// SPDX-License-Identifier: MIT
pragma solidity >=0.8.34 <0.9.0;

import { console2 } from "forge-std/src/console2.sol";
import { SafeCastLib } from "solady/utils/SafeCastLib.sol";
import { BaseScript } from "./Base.s.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";
import { IPanorama } from "../src/interfaces/IPanorama.sol";
import { IPanoramaMintController } from "../src/interfaces/IPanoramaMintController.sol";

/// @notice Deploys the production Season 3 signal controller and auction after validating the
///         complete immutable config, in three transactions: the controller, the auction pointing
///         at it, then `controller.setAuction(auction)`. Both directions are verified afterwards.
///         The start time is deliberately required and must be in the future, leaving time to
///         verify the deployed bytecode and configuration before bidding opens.
///
/// Required env:
///   PANORAMA_NFT                        - Panorama ERC721 address
///   PANORAMA_AUCTION_RESERVE_PRICE      - reserve price in wei (>= 0.1 ETH, the contract floor)
///   PANORAMA_AUCTION_MIN_INCREMENT_BPS  - minimum raise over the floor (1..10_000)
///   PANORAMA_AUCTION_START              - explicit unix start time, strictly in the future
///   PANORAMA_PAYOUT_A / PANORAMA_PAYOUT_B - distinct proceeds recipients (58% / 42%)
/// Optional env:
///   PANORAMA_AUCTION_DURATION           - seconds (default: 86_400; allowed: 1 hour..30 days)
contract DeployAuction is BaseScript {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant FIRST_TOKEN_ID = 181;
    uint256 internal constant MAX_UNITS = 30;
    /// @dev Seasons 1 and 2 are configured on the mint controller before Season 3 is sold.
    uint8 internal constant PRIOR_SEASON_COUNT = 2;
    uint256 internal constant MAX_SIGNAL_BYTES = 280;
    uint256 internal constant MAX_BIDS_PER_WALLET = 2;
    uint256 internal constant BID_TICK = 0.001 ether;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MIN_DURATION = 1 hours;
    uint256 internal constant MAX_DURATION = 30 days;
    uint256 internal constant MAX_TOTAL_EXTENSION = 24 hours;
    uint256 internal constant LAST_TOKEN_ID = 210;

    struct Config {
        address nft;
        uint96 reservePrice;
        uint16 minIncrementBps;
        uint64 startTime;
        uint64 duration;
        uint64 initialEndTime;
        uint64 absoluteEndTime;
        address payoutA;
        address payoutB;
    }

    function run() public returns (PanoramaSeason3Auction auction) {
        Config memory config = _loadAndValidateConfig();

        // Keep all checks before the first broadcast transaction. Forge performs a complete
        // simulation before broadcasting, so a failed postcondition prevents an unsafe run.
        vm.startBroadcast(privateKey);
        PanoramaSeason3SignalController controller = new PanoramaSeason3SignalController(config.nft);
        auction = new PanoramaSeason3Auction(
            config.nft,
            config.reservePrice,
            config.minIncrementBps,
            config.startTime,
            config.duration,
            config.payoutA,
            config.payoutB,
            address(controller)
        );
        controller.setAuction(address(auction));
        vm.stopBroadcast();

        _verifyDeployment(auction, controller, config);

        console2.log("Panorama Season 3 signal controller:", address(controller));
        console2.log("Panorama Season 3 auction:", address(auction));
        console2.log("Runtime code hash (verify independently before authorization):");
        console2.logBytes32(address(auction).codehash);
    }

    /// @dev Chain gate. Mainnet by default; testnet rehearsal variants override this
    ///      (see DeployAuctionSepolia) so the production script itself stays mainnet-only.
    function _requiredChainId() internal pure virtual returns (uint256) {
        return MAINNET_CHAIN_ID;
    }

    function _loadAndValidateConfig() internal view returns (Config memory config) {
        require(block.chainid == _requiredChainId(), "WRONG_CHAIN_ID");

        config.nft = vm.envAddress("PANORAMA_NFT");
        config.payoutA = vm.envAddress("PANORAMA_PAYOUT_A");
        config.payoutB = vm.envAddress("PANORAMA_PAYOUT_B");

        require(config.nft != address(0) && config.nft.code.length != 0, "INVALID_NFT");
        require(config.payoutA != address(0) && config.payoutB != address(0), "INVALID_PAYOUT");
        require(config.payoutA != config.payoutB, "PAYOUTS_MUST_DIFFER");

        uint256 reserveRaw = vm.envUint("PANORAMA_AUCTION_RESERVE_PRICE");
        uint256 incrementRaw = vm.envUint("PANORAMA_AUCTION_MIN_INCREMENT_BPS");
        uint256 startRaw = vm.envUint("PANORAMA_AUCTION_START");
        uint256 durationRaw = vm.envOr("PANORAMA_AUCTION_DURATION", uint256(24 hours));

        // Validate the full-width values before narrowing; Solidity explicit casts truncate.
        // Mirrors the contract's MIN_RESERVE_PRICE so a bad env value fails here, not on-chain.
        require(reserveRaw >= 0.1 ether && reserveRaw <= type(uint96).max, "INVALID_RESERVE_PRICE");
        // Mirrors the constructor: the reserve must be a whole number of BID_TICK (0.001 ETH).
        require(reserveRaw % BID_TICK == 0, "RESERVE_NOT_ON_TICK");
        require(
            incrementRaw > 0 && incrementRaw <= BPS_DENOMINATOR && incrementRaw <= type(uint16).max,
            "INVALID_INCREMENT_BPS"
        );
        require(startRaw > block.timestamp && startRaw <= type(uint64).max, "START_NOT_STRICTLY_FUTURE");
        require(durationRaw >= MIN_DURATION && durationRaw <= MAX_DURATION, "INVALID_DURATION");
        require(durationRaw <= type(uint64).max - startRaw, "END_TIME_OVERFLOW");

        uint256 initialEndRaw = startRaw + durationRaw;
        require(initialEndRaw <= type(uint64).max - MAX_TOTAL_EXTENSION, "ABSOLUTE_END_OVERFLOW");

        config.reservePrice = SafeCastLib.toUint96(reserveRaw);
        config.minIncrementBps = SafeCastLib.toUint16(incrementRaw);
        config.startTime = SafeCastLib.toUint64(startRaw);
        config.duration = SafeCastLib.toUint64(durationRaw);
        config.initialEndTime = SafeCastLib.toUint64(initialEndRaw);
        config.absoluteEndTime = SafeCastLib.toUint64(initialEndRaw + MAX_TOTAL_EXTENSION);

        IPanorama nft = IPanorama(config.nft);
        require(nft.totalMinted() == FIRST_TOKEN_ID - 1, "UNEXPECTED_MINTED_SUPPLY");
        require(nft.mintCap() == FIRST_TOKEN_ID - 1, "UNEXPECTED_PRE_AUCTION_MINT_CAP");
        require(nft.maxSupply() >= FIRST_TOKEN_ID + MAX_UNITS - 1, "INSUFFICIENT_MAX_SUPPLY");
        address controller = nft.mintController();
        require(controller != address(0) && controller.code.length != 0, "INVALID_MINT_CONTROLLER");
        // SettleAuctionAtomic opens Season 3 as the next season, so it must not exist yet.
        require(IPanoramaMintController(controller).seasonCount() == PRIOR_SEASON_COUNT, "UNEXPECTED_SEASON_COUNT");
    }

    function _verifyDeployment(
        PanoramaSeason3Auction auction,
        PanoramaSeason3SignalController controller,
        Config memory config
    ) internal view {
        require(address(auction).code.length != 0, "AUCTION_DEPLOYMENT_FAILED");
        require(auction.owner() == broadcaster, "UNEXPECTED_AUCTION_OWNER");
        require(address(auction.nft()) == config.nft, "NFT_MISMATCH");
        require(auction.payoutA() == config.payoutA && auction.payoutB() == config.payoutB, "PAYOUT_MISMATCH");
        require(auction.reservePrice() == config.reservePrice, "RESERVE_PRICE_MISMATCH");
        require(auction.minIncrementBps() == config.minIncrementBps, "INCREMENT_BPS_MISMATCH");
        require(auction.startTime() == config.startTime, "START_TIME_MISMATCH");
        require(auction.endTime() == config.initialEndTime, "END_TIME_MISMATCH");
        require(auction.absoluteEndTime() == config.absoluteEndTime, "ABSOLUTE_END_TIME_MISMATCH");
        require(auction.FIRST_TOKEN_ID() == FIRST_TOKEN_ID, "FIRST_TOKEN_ID_MISMATCH");
        require(auction.MAX_UNITS() == MAX_UNITS, "MAX_UNITS_MISMATCH");
        require(auction.MAX_BIDS_PER_WALLET() == MAX_BIDS_PER_WALLET, "MAX_BIDS_PER_WALLET_MISMATCH");
        require(auction.BID_TICK() == BID_TICK, "BID_TICK_MISMATCH");
        require(uint8(auction.phase()) == uint8(PanoramaSeason3Auction.Phase.Active), "UNEXPECTED_PHASE");
        require(auction.nextBidId() == 1 && auction.activeBids() == 0, "UNEXPECTED_BIDS");
        require(!auction.paused() && auction.extensionCount() == 0, "UNEXPECTED_INITIAL_STATE");

        // The controller and the auction point at each other.
        require(address(controller).code.length != 0, "CONTROLLER_DEPLOYMENT_FAILED");
        require(address(auction.signalController()) == address(controller), "AUCTION_CONTROLLER_MISMATCH");
        require(controller.auction() == address(auction), "CONTROLLER_AUCTION_MISMATCH");
        require(controller.owner() == broadcaster, "UNEXPECTED_CONTROLLER_OWNER");
        require(address(controller.nft()) == config.nft, "CONTROLLER_NFT_MISMATCH");
        require(
            controller.FIRST_TOKEN_ID() == FIRST_TOKEN_ID && controller.LAST_TOKEN_ID() == LAST_TOKEN_ID,
            "CONTROLLER_TOKEN_RANGE_MISMATCH"
        );
        require(controller.MAX_SIGNAL_BYTES() == MAX_SIGNAL_BYTES, "MAX_SIGNAL_BYTES_MISMATCH");

        // Ensure no concurrent collection mutation slipped into the simulated deployment sequence.
        IPanorama nft = IPanorama(config.nft);
        require(nft.totalMinted() == FIRST_TOKEN_ID - 1, "MINTED_SUPPLY_CHANGED");
        require(nft.mintCap() == FIRST_TOKEN_ID - 1, "MINT_CAP_CHANGED");
    }
}
