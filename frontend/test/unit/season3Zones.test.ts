import { describe, expect, it } from "vitest";
import {
	dayLabelForToken,
	themeForToken,
	SEASON_3_ZONES,
	seasonDayForToken,
	tokenForSeasonDay,
	zoneForToken,
} from "@/lib/season3Zones";

describe("Season 3 zones", () => {
	it("six zones of five days cover #181-#210 in order", () => {
		expect(SEASON_3_ZONES.map((z) => z.name)).toEqual([
			"Interface",
			"City",
			"Suburb",
			"Village",
			"Nature",
			"Abstract",
		]);
		expect(SEASON_3_ZONES.map((z) => [z.firstToken, z.lastToken])).toEqual([
			[181, 185],
			[186, 190],
			[191, 195],
			[196, 200],
			[201, 205],
			[206, 210],
		]);
	});

	it("maps tokens to season days and back", () => {
		expect(seasonDayForToken(181)).toBe(1);
		expect(seasonDayForToken(210)).toBe(30);
		expect(seasonDayForToken(180)).toBeNull();
		expect(seasonDayForToken(211)).toBeNull();
		expect(seasonDayForToken(181.5)).toBeNull();
		expect(tokenForSeasonDay(1)).toBe(181);
		expect(tokenForSeasonDay(30)).toBe(210);
		expect(tokenForSeasonDay(0)).toBeNull();
		expect(tokenForSeasonDay(31)).toBeNull();
	});

	it("puts each token in its zone, boundaries included", () => {
		expect(zoneForToken(181)?.id).toBe("interface");
		expect(zoneForToken(185)?.id).toBe("interface");
		expect(zoneForToken(186)?.id).toBe("city");
		expect(zoneForToken(200)?.id).toBe("village");
		expect(zoneForToken(201)?.id).toBe("nature");
		expect(zoneForToken(210)?.id).toBe("abstract");
		expect(zoneForToken(91)).toBeUndefined();
	});

	it("labels days the way the board shows them", () => {
		expect(dayLabelForToken(181)).toBe("Day 1, creator");
		expect(dayLabelForToken(193)).toBe("Day 13, strategy");
		expect(dayLabelForToken(210)).toBe("Day 30, love");
		expect(dayLabelForToken(180)).toBeUndefined();
	});
});

describe("Pale Kirill's daily themes", () => {
	it("gives every day its theme and kind, five kinds per zone in order", () => {
		expect(themeForToken(181)).toEqual({ theme: "creator", kind: "figure" });
		expect(themeForToken(183)).toEqual({ theme: "internal error", kind: "event" });
		expect(themeForToken(189)).toEqual({ theme: "hoop", kind: "object" });
		expect(themeForToken(200)).toEqual({ theme: "silence", kind: "feeling" });
		expect(themeForToken(207)).toEqual({ theme: "basketball court", kind: "place" });
		expect(themeForToken(210)).toEqual({ theme: "love", kind: "feeling" });
		expect(themeForToken(180)).toBeUndefined();
		expect(themeForToken(211)).toBeUndefined();
	});

	it("has thirty distinct themes", () => {
		const all = SEASON_3_ZONES.flatMap((z) => z.themes);
		expect(all).toHaveLength(30);
		expect(new Set(all).size).toBe(30);
	});
});
