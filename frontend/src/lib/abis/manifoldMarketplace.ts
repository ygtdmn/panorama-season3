// Read-only subset of Manifold's MarketplaceUpgradeable (implementation
// 0x8f7dc0c580d3c7f27a4f8560f0927a5e2c30dd30 behind the mainnet proxy).

export const manifoldMarketplaceAbi = [
	{
		type: "function",
		name: "getListing",
		stateMutability: "view",
		inputs: [{ name: "listingId", type: "uint40" }],
		outputs: [
			{
				name: "",
				type: "tuple",
				components: [
					{ name: "id", type: "uint256" },
					{ name: "seller", type: "address" },
					{ name: "finalized", type: "bool" },
					{ name: "totalSold", type: "uint24" },
					{ name: "marketplaceBPS", type: "uint16" },
					{ name: "referrerBPS", type: "uint16" },
					{
						name: "details",
						type: "tuple",
						components: [
							{ name: "initialAmount", type: "uint256" },
							{ name: "type_", type: "uint8" },
							{ name: "totalAvailable", type: "uint24" },
							{ name: "totalPerSale", type: "uint24" },
							{ name: "extensionInterval", type: "uint16" },
							{ name: "minIncrementBPS", type: "uint16" },
							{ name: "erc20", type: "address" },
							{ name: "identityVerifier", type: "address" },
							{ name: "startTime", type: "uint48" },
							{ name: "endTime", type: "uint48" },
						],
					},
					{
						name: "token",
						type: "tuple",
						components: [
							{ name: "id", type: "uint256" },
							{ name: "address_", type: "address" },
							{ name: "spec", type: "uint8" },
							{ name: "lazy", type: "bool" },
						],
					},
					{
						name: "receivers",
						type: "tuple[]",
						components: [
							{ name: "receiver", type: "address" },
							{ name: "receiverBPS", type: "uint16" },
						],
					},
					{
						name: "fees",
						type: "tuple",
						components: [
							{ name: "deliverBPS", type: "uint16" },
							{ name: "deliverFixed", type: "uint240" },
						],
					},
					{
						name: "bid",
						type: "tuple",
						components: [
							{ name: "amount", type: "uint256" },
							{ name: "bidder", type: "address" },
							{ name: "delivered", type: "bool" },
							{ name: "settled", type: "bool" },
							{ name: "refunded", type: "bool" },
							{ name: "timestamp", type: "uint48" },
							{ name: "referrer", type: "address" },
						],
					},
					{ name: "offersAccepted", type: "bool" },
				],
			},
		],
	},
	{
		type: "event",
		name: "BidEvent",
		inputs: [
			{ name: "listingId", type: "uint40", indexed: true },
			{ name: "referrer", type: "address", indexed: false },
			{ name: "bidder", type: "address", indexed: false },
			{ name: "amount", type: "uint256", indexed: false },
		],
	},
] as const;
