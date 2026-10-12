import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { BotRepository } from "../../../../../src/core/database/BotRepo.js";

describe("fun commands", () => {
    test("/goodbot replies publicly with the updated praise count", async ({ discord, db, slash }) => {
        await slash("goodbot");
        const interaction = await slash("goodbot");

        // Public: the deferral carries no ephemeral flag
        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: 0 } },
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "🥹 *BustinBot has been called a good bot 2 times!*" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.goodbotCount).toBe(2);
    });

    test("/badbot replies publicly with the criticism count", async ({ discord, db, slash }) => {
        const interaction = await slash("badbot");

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "😭 *BustinBot has been called a bad bot 1 time!*" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.badbotCount).toBe(1);
    });

    test("/bustin replies publicly and counts the ping", async ({ discord, db, slash }) => {
        const interaction = await slash("bustin");

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]);
        expect((await new BotRepository(db).getBotStats())?.funStats.bustinCount).toBe(1);
    });

    test("/bustincount says privately how many times /bustin was used", async ({ discord, slash }) => {
        await slash("bustin");
        await slash("bustin");

        const interaction = await slash("bustincount");

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
