import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const pickmovie: Command = {
    name: "pickmovie",
    description: "Pick the movie for the next movie night (via poll, random roll, or specific movie).",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("pickmovie")
        .setDescription("Pick the movie for the next movie night (via poll, random roll, or specific movie)."),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("movie_pick_choose")
                .setLabel("🎯 Choose a movie")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("movie_pick_random")
                .setLabel("🎲 Random movie")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("movie_poll_random")
                .setLabel("📊 Poll random movies")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("movie_poll_manual")
                .setLabel("🗳️ Poll specific movies")
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.editReply({
            content: "How would you like to pick the movie?",
            components: [row],
        });
    },
};

export default pickmovie;
