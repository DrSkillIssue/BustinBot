import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";

describe("/help", () => {
    test("introduces the bot privately", async ({ discord, slash }) => {
        const command = await slash("help");

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "🤖 Welcome to BustinBot" })],
                }),
            },
        ]);
    });
});
