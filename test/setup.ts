import cron from "node-cron";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, vi } from "vitest";
import failOnConsole from "vitest-fail-on-console";

const offline = new MockAgent();
offline.disableNetConnect();
if (process.env.FIRESTORE_EMULATOR_HOST) offline.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
setGlobalDispatcher(offline);

failOnConsole({ shouldPrintMessage: true });

afterEach(() => cron.shutdown());

afterEach(() => vi.useRealTimers());
