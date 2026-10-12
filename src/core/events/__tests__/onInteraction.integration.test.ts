import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { SlashCommandBuilder } from "discord.js";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { handleInteraction } from "../onInteraction.js";
import { CommandModule, CommandRole, type Command } from "../../../models/Command.js";
import { IDS, apiGuild, apiMember, apiRole, chatInputInteraction } from "../../../tests/discord/payloads.js";
import type { DiscordHarness } from "../../../tests/discord/harness.js";
import type { Firestore } from "firebase-admin/firestore";
import { GuildRepository } from "../../database/GuildRepo.js";
import { guildFactory } from "../../../tests/factories.js";

function command(execute: Command["execute"], allowedRoles = [CommandRole.Everyone]): Command {
    return {
        name: "probe",
        description: "Test command",
        module: CommandModule.Core,
        allowedRoles,
        slashData: new SlashCommandBuilder().setName("probe").setDescription("Test command"),
        execute,
    };
}

describe("slash command routing", () => {
    // Interactions from a guild discord.js hasn't cached carry the member as raw data with role ids only
        async function fromUncachedGuild(discord: DiscordHarness, db: Firestore, adminRoleName: string) {
        const admin = apiRole({ name: adminRoleName });
        discord.guild(apiGuild({ id: IDS.uncachedGuild, roles: [apiRole({ id: IDS.uncachedGuild, name: "@everyone" }), admin] }));
        await new GuildRepository(db).initGuild(IDS.uncachedGuild, guildFactory.build({ id: IDS.uncachedGuild, roles: { admin: "BustinBot Admin" } }));
        return { guild_id: IDS.uncachedGuild, member: apiMember({ roles: [admin.id] }) };
    }

    test("recognises a role configured by name for a member Discord sends as role ids", async ({ discord, services, db }) => {
        const interaction = await discord.dispatch(chatInputInteraction("probe", [], await fromUncachedGuild(discord, db, "BustinBot Admin")));
        const ran = command(async ({ interaction: probe }) => {
            await probe?.reply({ content: "ran" });
        }, [CommandRole.BotAdmin]);

        await handleInteraction(interaction, new Map([["probe", ran]]), services);

        expect(discord.callbacks(interaction)).toEqual([{ type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "ran" }) }]);
    });

    test("lets a BustinBot Admin Discord sends as role ids run /setup", async ({ discord, services, db, commands }) => {
        const interaction = await discord.dispatch(chatInputInteraction("setup", [], await fromUncachedGuild(discord, db, "BustinBot Admin")));

        await handleInteraction(interaction, commands, services);

        expect(JSON.stringify(discord.callbacks(interaction))).not.toContain("Only members with the **BustinBot Admin** role can run");
    });

    test("refuses /setup to a member without the BustinBot Admin role", async ({ discord, services, db, commands }) => {
        const interaction = await discord.dispatch(chatInputInteraction("setup", [], await fromUncachedGuild(discord, db, "Moderator")));

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: "Only members with the **BustinBot Admin** role can run `/setup`. Please have a server admin create and assign this role first." }),
        }]);
    });

    test("replies privately when the command is unknown", async ({ discord, services }) => {
        const interaction = await discord.dispatch(chatInputInteraction("missing"));

        await handleInteraction(interaction, new Map(), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "Command not found.", flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("refuses a role-restricted command to members without the role", async ({ discord, services }) => {
        const interaction = await discord.dispatch(chatInputInteraction("probe"));
        const execute = vi.fn();

        await handleInteraction(interaction, new Map([["probe", command(execute, [CommandRole.TaskAdmin])]]), services);

        expect(execute).not.toHaveBeenCalled();
        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("tells members to run /setup before the bot is configured", async ({ discord, services }) => {
        await services.guilds.update(guildFactory.build().id, { setupComplete: { core: false, movie: false, task: false } });
        const interaction = await discord.dispatch(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", command(vi.fn())]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: expect.stringContaining("run `/setup`"), flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("counts the command in the member's stats once it has responded", async ({ discord, services }) => {
        const users = services.repos.userRepo;
        const interaction = await discord.dispatch(chatInputInteraction("probe"));
        let statsWhenAcknowledged: unknown;

        await handleInteraction(interaction, new Map([["probe", command(async ({ interaction }) => {
            await interaction!.reply({ content: "pong", flags: MessageFlags.Ephemeral });
            statsWhenAcknowledged = await users.getUserById(interaction!.user.id);
        })]]), services);

        expect(discord.callbacks(interaction)).toHaveLength(1);
        expect(statsWhenAcknowledged).toBeNull();
        expect(await users.getUserById(interaction.user.id)).toMatchObject({ commandsRun: 1 });
    });

    test("replies with a private error when a command fails before responding", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.dispatch(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", command(async () => {
            throw new Error("boom");
        })]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "There was an error executing that command.", flags: MessageFlags.Ephemeral }) },
        ]);
        expect(error).toHaveBeenCalledWith("[Slash Command Error]: probe", expect.objectContaining({ message: "boom" }));
    });
});
