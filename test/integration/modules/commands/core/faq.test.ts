import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { chatInputInteraction } from "../../../../discord/payloads.js";

describe("/faq", () => {
    test("links the FAQ privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("faq"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "Need help? Click here to view the BustinBot FAQ: https://github.com/dossyb/BustinBot/wiki",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});
