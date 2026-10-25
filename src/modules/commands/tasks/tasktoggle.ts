import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { initTaskScheduler, stopTaskScheduler } from "../../tasks/TaskScheduler.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const tasktoggle: Command = {
    name: "tasktoggle",
    description: "Toggle task automations on and off.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("tasktoggle")
        .setDescription("Toggle task automations on and off.")
        .addSubcommand((sub) => sub.setName("schedule").setDescription("Toggle the task scheduler on and off."))
        .addSubcommand((sub) =>
            sub.setName("leaderboard").setDescription("Toggle periodic leaderboard automation on and off."),
        ),

    async execute({
        interaction,
        services,
    }: {
        interaction?: ChatInputCommandInteraction<"raw" | "cached">;
        services: ServiceContainer;
    }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        const guildId = interaction.guildId;
        const guildService = services.guilds;

        const sub = interaction.options.getSubcommand();

        // Fetch the latest guild config from Firestore
        const guildConfig = await guildService.get(guildId);

        if (sub === "schedule") {
            const currentState = guildConfig?.toggles?.taskScheduler ?? false;
            const newState = !currentState;

            // Change the running jobs first and save the toggle only once that worked, putting the jobs back if
            // saving fails, so the stored setting always matches what is running
            if (newState) {
                await initTaskScheduler(interaction.client, services);
            } else {
                await stopTaskScheduler(guildId);
            }

            try {
                await guildService.updateToggle(guildId, "toggles.taskScheduler", newState, interaction.user.id);
            } catch (err) {
                if (newState) {
                    await stopTaskScheduler(guildId);
                } else {
                    await initTaskScheduler(interaction.client, services);
                }
                throw err;
            }

            await interaction.editReply({
                content: newState
                    ? `✅ Task scheduler **enabled** and started for this guild.`
                    : `⏹️ Task scheduler **disabled** and stopped for this guild.`,
            });
            return;
        }

        if (sub === "leaderboard") {
            const currentState = guildConfig?.toggles?.taskLeaderboard ?? true;
            const newState = !currentState;

            await guildService.updateToggle(guildId, "toggles.taskLeaderboard", newState, interaction.user.id);

            await interaction.editReply({
                content: newState
                    ? "🏆 Periodic leaderboard automation **enabled**."
                    : "🧊 Periodic leaderboard automation **disabled** (read-only mode).",
            });
            return;
        }

        await interaction.editReply({ content: "Unknown tasktoggle option." });
    },
};

export default tasktoggle;
