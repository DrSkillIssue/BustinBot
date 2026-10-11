import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

// Every HTTP request the bot makes goes through undici: Discord REST through @discordjs/rest's undici client and
// everything else through Node's fetch. A fresh MockAgent becomes the global dispatcher for each test, so only
// requests the test or the Discord harness declared get a response and anything else fails. undici 8 also installs
// it under the dispatcher key that undici 6 and Node 24's fetch read (https://github.com/nodejs/undici#global-dispatcher).
// The Firestore emulator is a real local service, so its address stays reachable.
//
// The agent lives here rather than in the setup file because vitest runs setup files again for every test file,
// while ordinary modules like this one may be shared between files.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const realDispatcher = getGlobalDispatcher();
let agent: MockAgent | undefined;

export function mockAgent(): MockAgent {
    if (!agent) throw new Error("The mock agent only exists while a test is running.");
    return agent;
}

export function installMockAgent(): void {
    agent = new MockAgent({ enableCallHistory: true });
    agent.disableNetConnect();
    if (emulatorHost) agent.enableNetConnect(emulatorHost);
    setGlobalDispatcher(agent);
}

export async function removeMockAgent(): Promise<void> {
    const finished = mockAgent();
    agent = undefined;
    setGlobalDispatcher(realDispatcher);
    // Routes registered to be used once are responses the test expected the bot to ask for; persistent routes are
    // allowed to go unused
    const unused = finished.pendingInterceptors().filter((interceptor) => !interceptor.persist);
    await finished.close();
    if (unused.length) {
        const routes = unused.map(({ method, origin, path }) => `${method} ${origin}${String(path)}`).join("\n");
        throw new Error(`Expected requests were never made:\n${routes}`);
    }
}
