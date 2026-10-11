import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { handleInteraction } from "../onInteraction.js";
import updatetask from "../../../modules/commands/tasks/updatetask.js";
import { CommandModule, CommandRole, type Command } from "../../../models/Command.js";
import { IDS, apiMember, chatInputInteraction } from "../../../tests/discord/payloads.js";
import { buildGuild, buildTask } from "../../../tests/fakes/builders.js";

const taskAdmin = apiMember({ roles: [IDS.roles.taskAdmin] });

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
    test("replies privately when the command is unknown", async ({ discord, services }) => {
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("missing"));

        await handleInteraction(interaction, new Map(), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "Command not found.", flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("refuses a role-restricted command to members without the role", async ({ discord, services }) => {
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("probe"));
        const execute = vi.fn();

        await handleInteraction(interaction, new Map([["probe", command(execute, [CommandRole.TaskAdmin])]]), services);

        expect(execute).not.toHaveBeenCalled();
        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("tells members to run /setup before the bot is configured", async ({ discord, services }) => {
        await services.guilds.update(buildGuild().id, { setupComplete: { core: false, movie: false, task: false } });
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", command(vi.fn())]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: expect.stringContaining("run `/setup`"), flags: MessageFlags.Ephemeral }) },
        ]);
    });

    test("counts the command in the member's stats without delaying it", async ({ discord, services }) => {
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", command(async ({ interaction }) => {
            await interaction!.reply({ content: "pong", flags: MessageFlags.Ephemeral });
        })]]), services);

        expect(discord.callbacks(interaction)).toHaveLength(1);
        await vi.waitFor(async () => {
            expect(await services.repos.userRepo!.getUserById(interaction.user.id)).toMatchObject({ commandsRun: 1 });
        });
    });

    test("replies with a private error when a command fails before responding", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", command(async () => {
            throw new Error("boom");
        })]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "There was an error executing that command.", flags: MessageFlags.Ephemeral }) },
        ]);
        expect(error).toHaveBeenCalledWith("[Slash Command Error]: probe", expect.objectContaining({ message: "boom" }));
    });
});

describe("/updatetask", () => {
    const idOption = (id: string) => [{ name: "id", type: ApplicationCommandOptionType.String as const, value: id }];

    test("opens the edit form pre-filled from the stored task as its first response", async ({ discord, services }) => {
        await services.repos.taskRepo!.createTask(buildTask({ id: "PVM001", taskName: "Kill {amount} Zulrah", amtBronze: 10, amtSilver: 25, amtGold: 50 }));
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(
            chatInputInteraction("updatetask", idOption("PVM001"), { member: taskAdmin })
        );

        await handleInteraction(interaction, new Map([["updatetask", updatetask]]), services);

        expect(discord.callbacks(interaction)).toHaveLength(1);
        const modal = discord.modal(interaction);
        expect(modal?.custom_id).toBe("update_task_modal_PVM001");
        const values = modal?.components.flatMap((row) => ("components" in row ? row.components : []))
            .map((input) => ["custom_id" in input ? input.custom_id : "", "value" in input ? input.value : ""]);
        expect(Object.fromEntries(values ?? [])).toEqual({ taskName: "Kill {amount} Zulrah", type: "KC", bronze: "10", silver: "25", gold: "50" });
    });

    test("replies privately when the task does not exist", async ({ discord, services }) => {
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(
            chatInputInteraction("updatetask", idOption("NOPE"), { member: taskAdmin })
        );

        await handleInteraction(interaction, new Map([["updatetask", updatetask]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "No task found with ID **NOPE**.", flags: MessageFlags.Ephemeral }) },
        ]);
    });
});
