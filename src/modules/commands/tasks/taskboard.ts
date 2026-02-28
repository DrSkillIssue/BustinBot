import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { postFinalLeaderboardSnapshot, postWeeklyLeaderboardSnapshot } from "../../tasks/HandleLeaderboardUpdate.js";

const taskboard: Command = {
    name: "taskboard",
    description: "Manually post the weekly task leaderboard update.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("taskboard")
        .setDescription("Manually post the weekly task leaderboard update.")
        .addSubcommand((sub) =>
            sub.setName("update").setDescription("Post the weekly leaderboard update.")
        )
        .addSubcommand((sub) =>
            sub.setName("final").setDescription("Post the final leaderboard snapshot.")
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            const sub = interaction.options.getSubcommand();
            if (sub === "final") {
                await postFinalLeaderboardSnapshot(interaction.client, services);
                await interaction.editReply("Final leaderboard posted.");
            } else {
                await postWeeklyLeaderboardSnapshot(interaction.client, services);
                await interaction.editReply("Leaderboard update posted.");
            }
        } catch (err) {
            console.error("[TaskBoard Command Error]", err);
            await interaction.editReply("Failed to post the leaderboard. Check console for details.");
        }
    }
};

export default taskboard;
