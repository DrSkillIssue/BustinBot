import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const suppress: Command = {
    name: "suppress",
    description: "Temporarily disable role/user pings from bot messages.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("suppress")
        .setDescription("Temporarily disable role/user pings from bot messages.")
        .addIntegerOption((option) =>
            option
                .setName("minutes")
                .setDescription("How long mention suppression should stay active.")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1440)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services?: ServiceContainer }) {
        if (!interaction || !services) return;

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: "This command can only be used in a server.", flags: 1 << 6 });
            return;
        }

        const minutes = interaction.options.getInteger("minutes", true);
        const untilMs = Date.now() + minutes * 60_000;

        await services.guilds.update(guildId, {
            mentionSuppressedUntilMs: untilMs,
            updatedBy: interaction.user.id,
            updatedAt: new Date() as any,
        });

        const untilUnix = Math.floor(untilMs / 1000);
        await interaction.reply({
            content: `Mention suppression enabled for **${minutes}** minute${minutes === 1 ? "" : "s"}. It will expire <t:${untilUnix}:R> (<t:${untilUnix}:F>).`,
            flags: 1 << 6,
        });
    },
};

export default suppress;
