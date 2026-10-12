import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test as base } from "../fixtures.js";
import { chatInputInteraction } from "../discord/payloads.js";
import { BotRepository } from "../../src/core/database/BotRepo.js";
import { botStatsFactory } from "../factories.js";

const test = base.extend("repo", ({ db }) => new BotRepository(db));

describe("fun commands", () => {
    test("/goodbot replies publicly with the updated praise count", async ({ discord, interact, db }) => {
        await interact(chatInputInteraction("goodbot"));
        const interaction = await interact(chatInputInteraction("goodbot"));

        // Public: the deferral carries no ephemeral flag
        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: 0 } },
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "🥹 *BustinBot has been called a good bot 2 times!*" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.goodbotCount).toBe(2);
    });

    test("/badbot replies publicly with the criticism count", async ({ discord, interact, db }) => {
        const interaction = await interact(chatInputInteraction("badbot"));

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "😭 *BustinBot has been called a bad bot 1 time!*" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.badbotCount).toBe(1);
    });

    test("/bustin replies publicly and counts the ping", async ({ discord, interact, db }) => {
        const interaction = await interact(chatInputInteraction("bustin"));

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.bustinCount).toBe(1);
    });

    test("/bustincount says privately how many times /bustin was used", async ({ discord, interact }) => {
        await interact(chatInputInteraction("bustin"));
        await interact(chatInputInteraction("bustin"));

        const interaction = await interact(chatInputInteraction("bustincount"));

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "The `/bustin` command has been used 2 times.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});

describe("BotRepository", () => {
    test("reads the stats back exactly as stored", async ({ repo }) => {
        const stats = botStatsFactory.build({ lastUpdatedAt: new Date("2026-01-08T00:00:00.000Z") });
        await repo.initBotStats(stats);

        expect(await repo.getBotStats()).toEqual(stats);
    });

    test("creates the stats document only when it does not exist", async ({ repo }) => {
        expect(await repo.getBotStats()).toBeNull();

        await repo.initBotStats(botStatsFactory.build({ commandsRun: 5 }));
        await repo.initBotStats(botStatsFactory.build({ commandsRun: 99 }));

        expect(await repo.getBotStats()).toMatchObject({ commandsRun: 5 });
    });

    test("increments counters, fun stats and per-command counts", async ({ repo }) => {
        await repo.initBotStats(botStatsFactory.build());

        await repo.increment("moviesAdded", 2);
        await repo.incrementFunStat("goodbotCount");
        await repo.incrementCommand("stats");
        await repo.incrementCommand("stats");
        await repo.incrementErrorCount();

        expect(await repo.getBotStats()).toMatchObject({
            moviesAdded: 2,
            commandsRun: 2,
            commandsByName: { stats: 2 },
            funStats: { bustinCount: 0, goodbotCount: 1, badbotCount: 0 },
            errorCount: 1,
        });
    });

    test("records guild counts and resets every counter", async ({ repo }) => {
        await repo.initBotStats(botStatsFactory.build());
        await repo.updateGuildStats(5, 10, 20);
        expect(await repo.getBotStats()).toMatchObject({ guildCount: 5, channelCount: 10, userCount: 20 });

        await repo.incrementCommand("stats");
        await repo.resetAllStats();

        expect(await repo.getBotStats()).toMatchObject({
            commandsRun: 0,
            commandsByName: {},
            guildCount: 0,
            errorCount: 0,
            funStats: { bustinCount: 0, goodbotCount: 0, badbotCount: 0 },
        });
    });
});
