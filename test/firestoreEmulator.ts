import { SnowflakeUtil } from "discord.js";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FIRESTORE_SETTINGS } from "../src/core/database/firestore.js";

const APP_NAME = "firestore-emulator-tests";

// Firebase: "When you're testing features that involve multiple concurrent writes to one document, the emulator may
// be slow to complete write requests. In some cases, locks may take up to 30 seconds to be released."
// (https://firebase.google.com/docs/emulator-suite/connect_firestore). Tests of concurrent transactions use this timeout.
export const CONCURRENT_TRANSACTION_TIMEOUT_MS = 35_000;

// firebase-admin talks to the emulator whenever FIRESTORE_EMULATOR_HOST is set, which `firebase emulators:exec`
// does for the command it runs. Refusing to run without it, or against a non-demo project, means these tests can
// never touch a real Firestore database.
function emulatorTarget(): { host: string; projectId: string } {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host) {
        throw new Error(
            "FIRESTORE_EMULATOR_HOST is not set. Run integration tests with `npm test`, which starts the Firestore emulator.",
        );
    }

    const projectId = process.env.GCLOUD_PROJECT ?? "";
    if (!projectId.startsWith("demo-")) {
        throw new Error(`Refusing to run against project "${projectId}": emulator tests must use a demo- project.`);
    }

    return { host, projectId };
}

// A database of its own in the emulator, so a test sees only the data it stores. The emulator creates a named
// database "in response to any SDK or REST API calls to the emulator that reference a specific database"
// (https://firebase.google.com/docs/emulator-suite/connect_firestore), and drops them all when the run ends.
export function newEmulatorDatabase(): Firestore {
    const { projectId } = emulatorTarget();
    const app = getApps().find((existing) => existing.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);
    const db = getFirestore(app, `test-${SnowflakeUtil.generate()}`);
    // Same settings as production so tests see the same write behaviour
    db.settings(FIRESTORE_SETTINGS);
    return db;
}
