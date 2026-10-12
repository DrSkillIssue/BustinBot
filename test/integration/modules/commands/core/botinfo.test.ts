import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { chatInputInteraction } from "../../../../discord/payloads.js";
import { packageVersion } from "../../../../../src/utils/version.js";

describe("/botinfo", () => {
    test("shows the version and uptime privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("botinfo"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        expect.objectContaining({
                            title: "🤖 BustinBot Information",
                            fields: expect.arrayContaining([
                                { name: "Version", value: packageVersion, inline: true },
                                { name: "Uptime", value: expect.stringMatching(/^\d+d \d+h \d+m \d+s$/), inline: true },
                            ]),
                        }),
                    ],
                }),
            },
        ]);
    });
});
