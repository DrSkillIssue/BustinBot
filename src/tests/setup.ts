import { afterEach, beforeEach } from "vitest";
import { installMockAgent, removeMockAgent } from "./http.js";

beforeEach(() => {
    installMockAgent();
});

afterEach(async () => {
    await removeMockAgent();
});
