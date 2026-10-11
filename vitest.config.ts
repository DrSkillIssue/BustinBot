import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./src/tests/setup.ts"],
        // Tests never inherit the developer's shell or .env mode (dotenv does not override variables already set)
        env: { BOT_MODE: "test" },
        // Every test starts from the real globals and environment, whatever an earlier test stubbed
        unstubGlobals: true,
        unstubEnvs: true,
        // and with every spy restored
        restoreMocks: true,
        coverage: { provider: "v8", reporter: ["text", "html"] },
        projects: [
            {
                extends: true,
                test: {
                    name: "unit",
                    include: ["src/**/*.test.ts"],
                    exclude: ["src/**/*.integration.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "integration",
                    include: ["src/**/*.integration.test.ts"],
                    env: {
                        // Tests never run on Google Cloud; skip the metadata-server probe Google's auth library
                        // otherwise makes before the first Firestore call
                        METADATA_SERVER_DETECTION: "none",
                    },
                    // Every file shares the one emulator database and clears it between tests
                    fileParallelism: false,
                    // Projects with different worker limits must run as separate groups; unit tests run first
                    sequence: { groupOrder: 1 },
                },
            },
        ],
    },
});
