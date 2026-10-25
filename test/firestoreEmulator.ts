import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "firestore-emulator-tests";

export const CONCURRENT_TRANSACTION_TIMEOUT_MS = 35_000;

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

export function newEmulatorDatabase(): Firestore {
    const { projectId } = emulatorTarget();
    const app = getApps().find((existing) => existing.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);
    const db = getFirestore(app, `test-${randomUUID()}`);
    return db;
}
