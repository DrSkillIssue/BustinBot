import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./test/setup.ts"],
        // Tests never inherit the developer's shell or .env mode (dotenv does not override variables already set)
        env: { BOT_MODE: "test" },
        // Every test starts from the real globals and environment, whatever an earlier test stubbed
        unstubGlobals: true,
        unstubEnvs: true,
        // and with every spy restored
        restoreMocks: true,
        // Console output is shown for failing tests only
        silent: "passed-only",
        coverage: { provider: "v8", reporter: ["text", "html"] },
        projects: [
            {
                extends: true,
                test: {
                    name: "unit",
                    include: ["test/unit/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "integration",
                    include: ["test/integration/**/*.test.ts"],
                    env: {
                        // Tests never run on Google Cloud; skip the metadata-server probe Google's auth library
                        // otherwise makes before the first Firestore call
                        METADATA_SERVER_DETECTION: "none",
                        // The key in the TMDb requests tests answer (test/tmdb.ts)
                        TMDB_API_KEY: "test-key",
                    },
                },
            },
        ],
    },
});
