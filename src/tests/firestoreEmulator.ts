import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "firestore-emulator-tests";

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
    const app = getApps().find((existing) => existing.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);
    return getFirestore(app);
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
