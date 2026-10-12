import { SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandOptionType,
    ChannelType,
    InteractionResponseType,
    MessageFlags,
} from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { PRIVATE_DEFERRAL, DiscordError } from "../../../../discord/harness.js";
import { AS, IDS, NAMES, apiMember, chatInputInteraction } from "../../../../discord/payloads.js";

const general = { id: IDS.channel, type: ChannelType.GuildText as const, name: NAMES.channel };

describe("/sendas", () => {
    test("posts the message as the bot and confirms privately", async ({ discord, interact }) => {
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: general.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello, this is BustinBot!" },
                ],
                AS.botAdmin,
                { channels: { [general.id]: { ...general, permissions: "0" } } },
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
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: general.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                { member: apiMember() },
                { channels: { [general.id]: { ...general, permissions: "0" } } },
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
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: general.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [general.id]: { ...general, permissions: "0" } } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Failed to send message." }),
        ]);
        expect(error).toHaveBeenCalledWith("Error sending message:", expect.objectContaining({ code: 50013 }));
    });

    test("refuses a channel that can't hold messages", async ({ discord, interact }) => {
        const category = {
            id: SnowflakeUtil.generate().toString(),
            type: ChannelType.GuildCategory as const,
            name: "Tasks",
        };

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: category.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [category.id]: { ...category, permissions: "0" } } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please select a valid text channel." }),
        ]);
    });
});
