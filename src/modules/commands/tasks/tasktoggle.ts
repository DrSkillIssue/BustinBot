import {
    SlashCommandBuilder,
    ChatInputCommandInteraction
} from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import {
    initTaskScheduler,
    stopTaskScheduler
} from '../../tasks/TaskScheduler.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';

const tasktoggle: Command = {
    name: 'tasktoggle',
    description: 'Toggle task automations on and off.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('tasktoggle')
        .setDescription('Toggle task automations on and off.')
        .addSubcommand((sub) =>
            sub
                .setName('schedule')
                .setDescription('Toggle the task scheduler on and off.')
        )
        .addSubcommand((sub) =>
            sub
                .setName('leaderboard')
                .setDescription('Toggle periodic leaderboard automation on and off.')
        ),

    async execute({
        interaction,
        services,
    }: {
        interaction?: ChatInputCommandInteraction;
        services?: ServiceContainer;
    }) {
        if (!interaction || !services) return;

        const guildId = interaction.guildId!;
        const guildService = services.guilds;

        const sub = interaction.options.getSubcommand();

        // Fetch the latest guild config from Firestore
        const guildConfig = await guildService.get(guildId);

        if (sub === 'schedule') {
            const currentState = guildConfig?.toggles.taskScheduler ?? false;
            const newState = !currentState;

            await guildService.updateToggle(
                guildId,
                "toggles.taskScheduler",
                newState,
                interaction.user.id
            );

            if (newState) {
                // Enable scheduler
                initTaskScheduler(interaction.client, services);
                await interaction.reply({
                    content: `✅ Task scheduler **enabled** and started for this guild.`,
                    flags: 1 << 6,
                });
            } else {
                // Disable scheduler
                stopTaskScheduler();
                await interaction.reply({
                    content: `⏹️ Task scheduler **disabled** and stopped for this guild.`,
                    flags: 1 << 6,
                });
            }
            return;
        }

        if (sub === 'leaderboard') {
            const currentState = guildConfig?.toggles?.taskLeaderboard ?? true;
            const newState = !currentState;

            await guildService.updateToggle(
                guildId,
                "toggles.taskLeaderboard",
                newState,
                interaction.user.id
            );

            await interaction.reply({
                content: newState
                    ? "🏆 Periodic leaderboard automation **enabled**."
                    : "🧊 Periodic leaderboard automation **disabled** (read-only mode).",
                flags: 1 << 6,
            });
            return;
        }

        await interaction.reply({ content: "Unknown tasktoggle option.", flags: 1 << 6 });
    },
};

export default tasktoggle;
