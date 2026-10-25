import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test as base } from "../fixtures.js";
import { chatInputInteraction } from "../discord/payloads.js";
import { BotRepository } from "../../src/core/database/BotRepo.js";
import { botStatsFactory } from "../factories.js";

const test = base.extend("repo", ({ db }) => new BotRepository(db));

describe("fun commands", () => {
    test("/badbot replies publicly with the criticism count", async ({ discord, interact, repo }) => {
        const interaction = await interact(chatInputInteraction("badbot"));

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "😭 *BustinBot has been called a bad bot 1 time!*" }),
        ]);
        expect((await repo.getBotStats())?.funStats.badbotCount).toBe(1);
    });

    test("/bustin replies publicly and counts the ping", async ({ discord, interact, repo }) => {
        const interaction = await interact(chatInputInteraction("bustin"));

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]);
        expect((await repo.getBotStats())?.funStats.bustinCount).toBe(1);
    });
});

describe("BotRepository", () => {
    test("creates the stats document only when it does not exist", async ({ repo }) => {
        expect(await repo.getBotStats()).toBeNull();

        await repo.initBotStats(botStatsFactory.build({ commandsRun: 5 }));
        await repo.initBotStats(botStatsFactory.build({ commandsRun: 99 }));

        expect(await repo.getBotStats()).toMatchObject({ commandsRun: 5 });
    });
});
