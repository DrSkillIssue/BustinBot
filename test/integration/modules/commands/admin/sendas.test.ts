import { SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandOptionType,
    ChannelType,
    InteractionResponseType,
    MessageFlags,
    RESTJSONErrorCodes,
} from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { PRIVATE_DEFERRAL, DiscordError } from "../../../../discord/harness.js";
import { AS, IDS, apiMember, apiResolvedChannel, chatInputInteraction } from "../../../../discord/payloads.js";

describe("/sendas", () => {
    test("posts the message as the bot and confirms privately", async ({ discord, interact }) => {
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello, this is BustinBot!" },
                ],
                AS.botAdmin,
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "Hello, this is BustinBot!" }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Message sent in <#${IDS.channel}>.` }),
        ]);
    });

    test("is refused to members who are not bot admins", async ({ discord, interact }) => {
        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                { member: apiMember() },
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("reports once when Discord won't post the message", async ({ discord, interact }) => {
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Failed to send message." }),
        ]);
        expect(error).toHaveBeenCalledWith(
            "Error sending message:",
            expect.objectContaining({ code: RESTJSONErrorCodes.MissingPermissions }),
        );
    });

    test("refuses a channel that can't hold messages", async ({ discord, interact }) => {
        const category = apiResolvedChannel({
            id: SnowflakeUtil.generate().toString(),
            type: ChannelType.GuildCategory,
            name: "Tasks",
        });

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: category.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [category.id]: category } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please select a valid text channel." }),
        ]);
    });
});
