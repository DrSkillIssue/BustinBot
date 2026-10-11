import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@tests": path.resolve(import.meta.dirname, "./src/tests"),
            core: path.resolve(import.meta.dirname, "./src/core"),
            models: path.resolve(import.meta.dirname, "./src/models"),
            modules: path.resolve(import.meta.dirname, "./src/modules"),
            utils: path.resolve(import.meta.dirname, "./src/utils"),
        },
    },
    test: {
        environment: "node",
        setupFiles: ["./src/tests/setup.ts"],
        // Tests never inherit the developer's shell or .env mode (dotenv does not override variables already set)
        env: { BOT_MODE: "test" },
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
                },
            },
        ],
    },
});
