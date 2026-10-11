import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../tests/fixtures.js";

describe("fun commands", () => {
    test("/goodbot replies publicly with the updated praise count", async ({ discord, db, slash }) => {
        await slash("goodbot");
        const interaction = await slash("goodbot");

        // Public: the deferral carries no ephemeral flag
        expect(discord.callbacks(interaction)).toEqual([{ type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: 0 } }]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "🥹 *BustinBot has been called a good bot 2 times!*" }),
        ]);
        expect((await db.doc("bot/stats").get()).get("funStats.goodbotCount")).toBe(2);
    });

    test("/badbot replies publicly with the criticism count", async ({ discord, db, slash }) => {
        const interaction = await slash("badbot");

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "😭 *BustinBot has been called a bad bot 1 time!*" }),
        ]);
        expect((await db.doc("bot/stats").get()).get("funStats.badbotCount")).toBe(1);
    });

    test("/bustin replies publicly and counts the ping", async ({ discord, db, slash }) => {
        const interaction = await slash("bustin");

        expect(discord.callbacks(interaction)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]);
        expect((await db.doc("bot/stats").get()).get("funStats.bustinCount")).toBe(1);
    });
});
