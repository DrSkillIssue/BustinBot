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
        coverage: { provider: "v8", reporter: ["text", "html"] },
    },
});
