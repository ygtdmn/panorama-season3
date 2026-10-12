// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @notice The part of PanoramaSeason3SignalController the auction calls: it forwards the signal a
///         new bid carries, in the same transaction as the bid.
interface IPanoramaSeason3SignalController {
    function recordBidSignal(uint32 bidId, address bidder, string calldata signal) external;
}
