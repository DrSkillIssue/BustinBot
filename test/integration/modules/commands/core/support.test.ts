import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { chatInputInteraction } from "../../../../discord/payloads.js";

describe("/support", () => {
    test("lists the ways to support the bot privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("support"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "❤️ Support BustinBot" })],
                }),
            },
        ]);
    });
});
