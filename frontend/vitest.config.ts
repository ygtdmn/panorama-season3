import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts"],
		environment: "node",
	},
	resolve: {
		alias: { "@": `${import.meta.dirname}/src` },
	},
});
