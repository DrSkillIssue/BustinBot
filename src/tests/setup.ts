import cron from "node-cron";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach } from "vitest";
import failOnConsole from "vitest-fail-on-console";

// Every HTTP request the bot makes goes through undici: Discord REST through @discordjs/rest's undici client and
// everything else through Node's fetch. No test reaches the network: this agent answers nothing, so a request no
// test declared fails. Integration tests that expect requests get their own agent from the `http` fixture. undici 8
// also installs it under the dispatcher key that Node's fetch reads (https://github.com/nodejs/undici#global-dispatcher).
// The Firestore emulator is a real local service, so its address stays reachable.
const offline = new MockAgent();
offline.disableNetConnect();
if (process.env.FIRESTORE_EMULATOR_HOST) offline.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
setGlobalDispatcher(offline);

// A test fails if the bot logs an error or warning it didn't declare by spying on the console method and
// asserting the call, so failures the bot catches and logs can't pass unnoticed
failOnConsole({ shouldPrintMessage: true });

// Scheduled jobs a test started never outlive it
afterEach(() => cron.shutdown());
