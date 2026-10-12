import path from "node:path";
import type { Interaction, Message } from "discord.js";
import type { APIApplicationCommandInteractionDataOption, APIChatInputApplicationCommandGuildInteraction, APIInteraction, GatewayMessageCreateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import { test as base } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createServiceContainer } from "../core/services/ServiceFactory.js";
import { BotStatsService } from "../core/services/BotStatsService.js";
import { BotRepository } from "../core/database/BotRepo.js";
import { loadCommands } from "../core/services/CommandService.js";
import { routeInteraction } from "../core/events/routeInteraction.js";
import { handleMessage } from "../core/events/onMessage.js";
import { GuildRepository } from "../core/database/GuildRepo.js";
import { DiscordHarness } from "./discord/harness.js";
import { IDS, apiGuild, chatInputInteraction, messageCreate } from "./discord/payloads.js";
import { clearEmulatorFirestore, getEmulatorFirestore } from "./firestoreEmulator.js";
import { guildFactory } from "./factories.js";

// The one test API for the suite. Fixtures are created only when a test asks for them:
// - http: the test's own undici MockAgent, answering only the requests the test declares; one the test expected but
//   the bot never made fails the test
// - discord: a real discord.js client logged in through a test gateway, with Discord's REST API answered by `http`
// - db: the Firestore emulator, emptied before the test (integration tests only)
// - services: the bot's real service container on a freshly cleared emulator, with a fully set-up guild
// - otherGuild: the service container of a second fully set-up guild, whose channels are all IDS.otherGuildChannel
// - uncachedGuild: a set-up guild discord.js hasn't cached; returns the interaction fields that place an interaction in it
// - commands: the bot's real slash command registry
// - interact: delivers any interaction (button, select, form) and routes it exactly as the running bot does
// - slash: runs a slash command through the bot's interaction routing, the way a member invoking it would
// - prefix: sends a channel message through the real prefix command handler
// - voice: delivers a member's voice state change and hands it to the guild's movie attendance, as the bot does
export const test = base
    .extend("http", ({}, { onCleanup }) => {
        const offline = getGlobalDispatcher();
        const agent = new MockAgent({ enableCallHistory: true });
        agent.disableNetConnect();
        if (process.env.FIRESTORE_EMULATOR_HOST) agent.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
        setGlobalDispatcher(agent);
        onCleanup(async () => {
            setGlobalDispatcher(offline);
            // Routes registered to be used once are responses the test expected the bot to ask for; persistent
            // routes may go unused. (undici's own assertNoPendingInterceptors counts unused persistent routes too.)
            const unused = agent.pendingInterceptors().filter((interceptor) => !interceptor.persist);
            await agent.close();
            if (unused.length) {
                const routes = unused.map(({ method, origin, path }) => `${method} ${origin}${String(path)}`).join("\n");
                throw new Error(`Expected requests were never made:\n${routes}`);
            }
        });
        return agent;
    })
    .extend("discord", async ({ http }, { onCleanup }) => {
        const discord = await DiscordHarness.start(http);
        onCleanup(() => discord.destroy());
        return discord;
    })
    .extend("firestore", { scope: "file" }, () => getEmulatorFirestore())
    .extend("db", async ({ firestore }) => {
        await clearEmulatorFirestore();
        return firestore;
    })
    .extend("services", async ({ db }) => {
        await new GuildRepository(db).initGuild(guildFactory.build().id, guildFactory.build());
        const botStats = new BotStatsService(new BotRepository(db));
        await botStats.init();
        return createServiceContainer(db, guildFactory.build().id, botStats);
    })
    .extend("otherGuild", async ({ db, services }) => {
        const channel = IDS.otherGuildChannel;
        const channels = { announcements: channel, taskChannel: channel, taskVerification: channel, movieNight: channel };
        await new GuildRepository(db).initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild, channels }));
        return createServiceContainer(db, IDS.otherGuild, services.botStats);
    })
    .extend("uncachedGuild", async ({ db, discord }) => {
        await new GuildRepository(db).initGuild(IDS.uncachedGuild, guildFactory.build({ id: IDS.uncachedGuild }));
        discord.guild(apiGuild({ id: IDS.uncachedGuild }));
        return { guild_id: IDS.uncachedGuild };
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
    .extend("voice", ({ discord, services }) =>
        async (state: GatewayVoiceStateUpdateDispatchData): Promise<void> => {
            const [oldState, newState] = await discord.voiceStateUpdate(state);
            services.movieAttendance.voiceStateChanged(oldState, newState);
        }
    )
    .extend("prefix", ({ discord, services, commands }) =>
        async (content: string, overrides: Partial<GatewayMessageCreateDispatchData> = {}): Promise<Message> => {
            const message = await discord.sendMessage(messageCreate(content, overrides));
            await handleMessage(message, commands, services);
            return message;
        }
    );

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
