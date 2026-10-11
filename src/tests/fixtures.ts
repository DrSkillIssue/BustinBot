import { test as base } from "vitest";
import { createServiceContainer } from "../core/services/ServiceFactory.js";
import { GuildRepository } from "../core/database/GuildRepo.js";
import { DiscordHarness } from "./discord/harness.js";
import { clearEmulatorFirestore, getEmulatorFirestore } from "./firestoreEmulator.js";
import { buildGuild } from "./fakes/builders.js";

// The one test API for the suite. Fixtures are created only when a test asks for them:
// - discord: a real discord.js client fed raw Discord payloads, with Discord's REST API served by msw
// - db: the Firestore emulator, emptied before the test (integration tests only)
// - services: the bot's real service container on a freshly cleared emulator, with a fully set-up guild
export const test = base
    .extend("discord", async ({}, { onCleanup }) => {
        const discord = DiscordHarness.start();
        onCleanup(() => discord.destroy());
        return discord;
    })
    .extend("firestore", { scope: "file" }, () => getEmulatorFirestore())
    .extend("db", async ({ firestore }) => {
        await clearEmulatorFirestore();
        return firestore;
    })
    .extend("services", async ({ db }) => {
        await new GuildRepository(db).initGuild(buildGuild().id, buildGuild());
        return createServiceContainer(db, buildGuild().id);
    });

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
