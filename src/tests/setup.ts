import { http, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

// The Firestore emulator is a real local service, not a dependency to mock, so its traffic always passes through
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const permanentHandlers = emulatorHost ? [http.all(`http://${emulatorHost}/*`, () => passthrough())] : [];

// One request-mocking server for the whole suite (https://vitest.dev/guide/mocking/requests).
// Tests and harnesses add handlers with server.use(); those are reset after every test, and any request
// without a handler fails the test.
export const server = setupServer(...permanentHandlers);

beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
    server.resetHandlers();
});

afterAll(() => {
    server.close();
});
