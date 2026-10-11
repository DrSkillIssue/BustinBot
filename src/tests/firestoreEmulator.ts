import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FIRESTORE_SETTINGS } from "../core/database/firestore.js";

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
        throw new Error("FIRESTORE_EMULATOR_HOST is not set. Run integration tests with `npm test`, which starts the Firestore emulator.");
    }

    const projectId = process.env.GCLOUD_PROJECT ?? "";
    if (!projectId.startsWith("demo-")) {
        throw new Error(`Refusing to run against project "${projectId}": emulator tests must use a demo- project.`);
    }

    return { host, projectId };
}

export function getEmulatorFirestore(): Firestore {
    const { projectId } = emulatorTarget();
    const existing = getApps().find((app) => app.name === APP_NAME);
    if (existing) return getFirestore(existing);

    // Same settings as production so tests see the same write behaviour
    const db = getFirestore(initializeApp({ projectId }, APP_NAME));
    db.settings(FIRESTORE_SETTINGS);
    return db;
}

// Deletes every document in the emulator database (documented emulator REST endpoint)
export async function clearEmulatorFirestore(): Promise<void> {
    const { host, projectId } = emulatorTarget();
    const response = await fetch(
        `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: "DELETE" }
    );
    if (!response.ok) {
        throw new Error(`Failed to clear the Firestore emulator: HTTP ${response.status}`);
    }
}
