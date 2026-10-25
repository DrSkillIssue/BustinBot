import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../fixtures.js";
import { handleInteraction } from "../../src/core/events/onInteraction.js";
import { AS, IDS, NAMES, chatInputInteraction, apiUser } from "../discord/payloads.js";
import { PRIVATE_DEFERRAL } from "../discord/harness.js";
import { commandFactory } from "../factories.js";

const { user: _user, permissions: _permissions, ...botAdmin } = AS.botAdmin.member;

describe("slash command routing", () => {
    test("lets a BustinBot Admin Discord sends as role ids run /setup", async ({
        discord,
        services,
        commands,
        uncachedGuild,
    }) => {
        await services.guilds.update(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.dispatch(
            chatInputInteraction("setup", [], { ...uncachedGuild, ...AS.botAdmin }),
        );

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
    });

    test("replies privately when the command is unknown", async ({ discord, services }) => {
        const interaction = await discord.dispatch(chatInputInteraction("missing"));

        await handleInteraction(interaction, new Map(), services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({ content: "Command not found.", flags: MessageFlags.Ephemeral }),
            },
        ]);
    });

    test("turns the deferred reply into the error when a command fails after deferring", async ({
        discord,
        services,
    }) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.dispatch(chatInputInteraction("probe"));

        await handleInteraction(
            interaction,
            new Map([
                [
                    "probe",
                    commandFactory.build({
                        execute: async ({ interaction: probe }) => {
                            await probe?.deferReply({ flags: MessageFlags.Ephemeral });
                            throw new Error("boom");
                        },
                    }),
                ],
            ]),
            services,
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "There was an error executing that command." }),
        ]);
        expect(discord.followUps(interaction)).toEqual([]);
    });
});

describe("prefix commands", () => {
    test("!goodbot replies with an emoji then posts the praise count", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        const message = await prefix("!goodbot");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: "🥹",
                message_reference: expect.objectContaining({ message_id: message.id }),
            }),
            expect.objectContaining({ content: "*BustinBot has been called a good bot 1 time!*" }),
        ]);
    });

    test("ignores messages without the prefix, from bots, or for unknown commands", async ({ discord, prefix }) => {
        await prefix("goodbot");
        await prefix("!goodbot", { author: apiUser({ id: IDS.bot, bot: true }) });
        await prefix("!unknown");

        expect(discord.requests()).toEqual([]);
    });

    test("refuses a restricted command to members without the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "You don't have permission to use this command." }),
        ]);
    });

    test("runs a restricted command for members with the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas", { member: botAdmin });

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("replaced with a slash command") }),
        ]);
    });
});
