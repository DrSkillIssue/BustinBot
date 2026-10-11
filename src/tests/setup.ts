import { afterEach, beforeEach } from "vitest";
import failOnConsole from "vitest-fail-on-console";
import { installMockAgent, removeMockAgent } from "./http.js";

// A test fails if the bot logs an error or warning it didn't declare by spying on the console method and
// asserting the call, so failures the bot catches and logs can't pass unnoticed
failOnConsole({ shouldPrintMessage: true });

beforeEach(() => {
    installMockAgent();
});

afterEach(async () => {
    await removeMockAgent();
});
