import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../fixtures.js";
import { handleInteraction } from "../../../../src/core/events/onInteraction.js";
import { CommandRole } from "../../../../src/models/Command.js";
import { AS, IDS, NAMES, chatInputInteraction } from "../../../discord/payloads.js";
import { PRIVATE_DEFERRAL } from "../../../discord/harness.js";

import { GuildRepository } from "../../../../src/core/database/GuildRepo.js";
import { commandFactory } from "../../../factories.js";

describe("slash command routing", () => {
    // Interactions from a guild discord.js hasn't cached carry the member as raw data with role ids only
    test("recognises a role configured by name for a member Discord sends as role ids", async ({
        discord,
        services,
        db,
        uncachedGuild,
    }) => {
        await new GuildRepository(db).updateGuild(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.dispatch(
            chatInputInteraction("probe", [], { ...uncachedGuild, ...AS.botAdmin }),
        );
        const ran = commandFactory.build({
            allowedRoles: [CommandRole.BotAdmin],
            execute: async ({ interaction: probe }) => {
                await probe?.reply({ content: "ran" });
            },
        });

        await handleInteraction(interaction, new Map([["probe", ran]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({ content: "ran" }),
            },
        ]);
    });

    test("lets a BustinBot Admin Discord sends as role ids run /setup", async ({
        discord,
        services,
        db,
        commands,
        uncachedGuild,
    }) => {
        await new GuildRepository(db).updateGuild(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.dispatch(
            chatInputInteraction("setup", [], { ...uncachedGuild, ...AS.botAdmin }),
        );

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
    });

    test("refuses /setup to a member without the BustinBot Admin role", async ({
        discord,
        services,
        db,
        commands,
        uncachedGuild,
    }) => {
        await new GuildRepository(db).updateGuild(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        // The member's only role is Task Admin
        const interaction = await discord.dispatch(
            chatInputInteraction("setup", [], { ...uncachedGuild, ...AS.taskAdmin }),
        );

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "Only members with the **BustinBot Admin** role can run `/setup`. Please have a server admin create and assign this role first.",
                }),
            },
        ]);
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

    test("refuses a role-restricted command to members without the role", async ({ discord, services }) => {
        const interaction = await discord.dispatch(chatInputInteraction("probe"));
        const execute = vi.fn();

        await handleInteraction(
            interaction,
            new Map([["probe", commandFactory.build({ execute, allowedRoles: [CommandRole.TaskAdmin] })]]),
            services,
        );

        expect(execute).not.toHaveBeenCalled();
        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("tells members to run /setup before the bot is configured", async ({ discord, services }) => {
        const execute = vi.fn();
        await services.guilds.update(IDS.guild, {
            setupComplete: { core: false, movie: false, task: false },
        });
        const interaction = await discord.dispatch(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", commandFactory.build({ execute })]]), services);

        expect(execute).not.toHaveBeenCalled();

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("run `/setup`"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("counts the command in the member's stats once it has responded", async ({ discord, services }) => {
        const users = services.repos.userRepo;
        const interaction = await discord.dispatch(chatInputInteraction("probe"));
        let statsWhenAcknowledged: unknown;

        await handleInteraction(
            interaction,
            new Map([
                [
                    "probe",
                    commandFactory.build({
                        execute: async ({ interaction }) => {
                            if (!interaction) return;
                            await interaction.reply({ content: "pong", flags: MessageFlags.Ephemeral });
                            statsWhenAcknowledged = await users.getUserById(interaction.user.id);
                        },
                    }),
                ],
            ]),
            services,
        );

        expect(discord.callbacks(interaction)).toHaveLength(1);
        expect(statsWhenAcknowledged).toBeNull();
        expect(await users.getUserById(interaction.user.id)).toMatchObject({ commandsRun: 1 });
    });

    test("replies with a private error when a command fails before responding", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.dispatch(chatInputInteraction("probe"));

        await handleInteraction(
            interaction,
            new Map([
                [
                    "probe",
                    commandFactory.build({
                        execute: async () => {
                            throw new Error("boom");
                        },
                    }),
                ],
            ]),
            services,
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "There was an error executing that command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(error).toHaveBeenCalledWith(
            "[Slash Command Error]: probe",
            expect.objectContaining({ message: "boom" }),
        );
    });
});
