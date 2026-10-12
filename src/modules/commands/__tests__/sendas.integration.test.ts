import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, ChannelType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { PRIVATE_DEFERRAL, DiscordError } from "../../../tests/discord/harness.js";
import { IDS, apiMember, chatInputInteraction, withRoles } from "../../../tests/discord/payloads.js";

const admin = withRoles(IDS.roles.admin);

// /sendas aimed at a channel, as Discord delivers it with the channel resolved
function sendas(channel: { id: string; type: ChannelType.GuildText | ChannelType.GuildCategory; name: string }, text: string, overrides = admin) {
    return chatInputInteraction(
        "sendas",
        [
            { type: ApplicationCommandOptionType.Channel, name: "channel", value: channel.id },
            { type: ApplicationCommandOptionType.String, name: "message", value: text },
        ],
        overrides,
        { channels: { [channel.id]: { ...channel, permissions: "0" } } },
    );
}

const general = { id: IDS.channel, type: ChannelType.GuildText as const, name: "general" };

describe("/sendas", () => {
    test("posts the message as the bot and confirms privately", async ({ discord, interact }) => {
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(sendas(general, "Hello, this is BustinBot!"));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([expect.objectContaining({ content: "Hello, this is BustinBot!" })]);
        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: `Message sent in <#${IDS.channel}>.` })]);
    });

    test("is refused to members who are not bot admins", async ({ discord, interact }) => {
        const interaction = await interact(sendas(general, "Hello", { member: apiMember() }));

        expect(discord.callbacks(interaction)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral }),
        }]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("reports once when Discord won't post the message", async ({ discord, interact }) => {
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(sendas(general, "Hello"));

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Failed to send message." })]);
        expect(error).toHaveBeenCalledWith("Error sending message:", expect.objectContaining({ code: 50013 }));
    });

    test("refuses a channel that can't hold messages", async ({ discord, interact }) => {
        const category = { id: SnowflakeUtil.generate().toString(), type: ChannelType.GuildCategory as const, name: "Tasks" };

        const interaction = await interact(sendas(category, "Hello"));

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Please select a valid text channel." })]);
    });
});
