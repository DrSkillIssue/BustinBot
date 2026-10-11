import path from "node:path";
import type { ChatInputCommandInteraction } from "discord.js";
import type { APIApplicationCommandInteractionDataOption, APIChatInputApplicationCommandGuildInteraction } from "discord-api-types/v10";
import { test as base } from "vitest";
import { createServiceContainer } from "../core/services/ServiceFactory.js";
import { BotStatsService } from "../core/services/BotStatsService.js";
import { BotRepository } from "../core/database/BotRepo.js";
import { loadCommands } from "../core/services/CommandService.js";
import { handleInteraction } from "../core/events/onInteraction.js";
import { GuildRepository } from "../core/database/GuildRepo.js";
import { DiscordHarness } from "./discord/harness.js";
import { chatInputInteraction } from "./discord/payloads.js";
import { clearEmulatorFirestore, getEmulatorFirestore } from "./firestoreEmulator.js";
import { buildGuild } from "./fakes/builders.js";

// The one test API for the suite. Fixtures are created only when a test asks for them:
// - discord: a real discord.js client fed raw Discord payloads, with Discord's REST API served by msw
// - db: the Firestore emulator, emptied before the test (integration tests only)
// - services: the bot's real service container on a freshly cleared emulator, with a fully set-up guild
// - commands: the bot's real slash command registry
// - slash: runs a slash command through the real router, the way a member invoking it would
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
        const botStats = new BotStatsService(new BotRepository(db));
        await botStats.init();
        return createServiceContainer(db, buildGuild().id, botStats);
    })
    .extend("commands", { scope: "file" }, () => loadCommands(path.join(import.meta.dirname, "../modules/commands")))
    .extend("slash", ({ discord, services, commands }) =>
        async (
            name: string,
            options: APIApplicationCommandInteractionDataOption[] = [],
            overrides: Partial<APIChatInputApplicationCommandGuildInteraction> = {}
        ): Promise<ChatInputCommandInteraction> => {
            const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction(name, options, overrides));
            await handleInteraction(interaction, commands, services);
            return interaction;
        }
    );

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
