import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { chatInputInteraction } from "../../../../discord/payloads.js";

describe("/taskhelp", () => {
    test("explains the task system privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("taskhelp"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "🗺️ OSRS Community Task Guide" })],
                }),
            },
        ]);
    });
});
