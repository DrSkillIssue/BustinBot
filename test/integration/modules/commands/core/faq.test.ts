import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";

describe("/faq", () => {
    test("links the FAQ privately", async ({ discord, slash }) => {
        const command = await slash("faq");

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
