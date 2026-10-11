import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const leagues: Command = {
    name: 'leagues',
    description: 'Toggle inclusion of Leagues tasks in polls and events.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName('leagues')
        .setDescription('Toggle Leagues tasks in polls and events on/off.'),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        const repo = services.repos?.guildRepo;
        if (!repo) {
            await interaction.editReply({
                content: "Guild repository unavailable.",
            });
            return;
        }

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.editReply({
                content: "This command must be used inside a server.",
            });
            return;
        }

        const userId = interaction.user.id;

        const guildConfig = await repo.getGuild(guildId);
        const current = guildConfig?.toggles?.leaguesEnabled ?? false;

        const newState = !current;
        await repo.updateToggle(guildId, "toggles.leaguesEnabled", newState, userId);

        const status = newState ? '**enabled**' : '**disabled**';

        await interaction.editReply({
            content: `Leagues tasks have been ${status}.`,
        });

        console.log(`[Leagues Toggle] ${interaction.guild?.name ?? guildId}: ${status}`);
    }
}

export default leagues;