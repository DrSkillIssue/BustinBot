import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { normaliseFirestoreDates } from "../../../utils/DateUtils.js";

const setstreak: Command = {
    name: "setstreak",
    description: "Admin override to set a user's task streak.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin, CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("setstreak")
        .setDescription("Admin override to set a user's task streak.")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("User to update.")
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("streak")
                .setDescription("New current streak value.")
                .setRequired(true)
                .setMinValue(0)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer; }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const userRepo = services.repos.userRepo;
        if (!userRepo) {
            await interaction.editReply("User repository not available.");
            return;
        }

        const targetUser = interaction.options.getUser("user", true);
        const streakValue = interaction.options.getInteger("streak", true);

        try {
            const raw = await userRepo.getUserById(targetUser.id);
            const stats = raw ? normaliseFirestoreDates(raw) : null;

            if (!stats) {
                await userRepo.incrementStat(targetUser.id, "taskStreak", streakValue);
                if (streakValue > 0) {
                    await userRepo.updateUser(targetUser.id, { longestTaskStreak: streakValue });
                }
            } else {
                const longest = Math.max(stats.longestTaskStreak ?? 0, streakValue);
                await userRepo.updateUser(targetUser.id, {
                    taskStreak: streakValue,
                    longestTaskStreak: longest,
                });
            }

            await interaction.editReply(
                `✅ Updated task streak for **${targetUser.username}** to **${streakValue}**.`
            );
        } catch (err) {
            console.error("[SetStreak Command] Failed to update streak:", err);
            await interaction.editReply("Failed to update the streak. Please try again later.");
        }
    }
};

export default setstreak;
