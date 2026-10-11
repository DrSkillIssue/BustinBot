import path from "node:path";
import type { Interaction, Message } from "discord.js";
import type { APIApplicationCommandInteractionDataOption, APIChatInputApplicationCommandGuildInteraction, APIInteraction, GatewayMessageCreateDispatchData } from "discord-api-types/v10";
import { test as base } from "vitest";
import { createServiceContainer } from "../core/services/ServiceFactory.js";
import { BotStatsService } from "../core/services/BotStatsService.js";
import { BotRepository } from "../core/database/BotRepo.js";
import { loadCommands } from "../core/services/CommandService.js";
import { routeInteraction } from "../core/events/routeInteraction.js";
import { handleMessage } from "../core/events/onMessage.js";
import { GuildRepository } from "../core/database/GuildRepo.js";
import { DiscordHarness } from "./discord/harness.js";
import { chatInputInteraction, messageCreate } from "./discord/payloads.js";
import { clearEmulatorFirestore, getEmulatorFirestore } from "./firestoreEmulator.js";
import { buildGuild } from "./fakes/builders.js";

// The one test API for the suite. Fixtures are created only when a test asks for them:
// - discord: a real discord.js client logged in through a test gateway, with Discord's REST API answered by the
//   test's MockAgent (src/tests/http.ts)
// - db: the Firestore emulator, emptied before the test (integration tests only)
// - services: the bot's real service container on a freshly cleared emulator, with a fully set-up guild
// - commands: the bot's real slash command registry
// - interact: delivers any interaction (button, select, form) and routes it exactly as the running bot does
// - slash: runs a slash command through the bot's interaction routing, the way a member invoking it would
// - prefix: sends a channel message through the real prefix command handler
export const test = base
    .extend("discord", async ({}, { onCleanup }) => {
        const discord = await DiscordHarness.start();
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
    .extend("interact", ({ discord, services, commands }) =>
        async (payload: APIInteraction): Promise<Interaction> => {
            const interaction = await discord.dispatch(payload);
            await routeInteraction(interaction, discord.client, commands, services);
            return interaction;
        }
    )
    .extend("slash", ({ interact }) =>
        (
            name: string,
            options: APIApplicationCommandInteractionDataOption[] = [],
            overrides: Partial<APIChatInputApplicationCommandGuildInteraction> = {}
        ): Promise<Interaction> => interact(chatInputInteraction(name, options, overrides))
    )
    .extend("prefix", ({ discord, services, commands }) =>
        async (content: string, overrides: Partial<GatewayMessageCreateDispatchData> = {}): Promise<Message> => {
            const message = await discord.sendMessage(messageCreate(content, overrides));
            await handleMessage(message, commands, services);
            return message;
        }
    );

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
