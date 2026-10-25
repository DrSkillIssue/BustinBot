import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import { createMovieNightEmbed } from '../../movies/MovieEmbeds.js';
import type { Movie } from '../../../models/Movie.js';
import { UNPICKED_MOVIE_ID } from '../../../models/MovieEvent.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';
import { DateTime } from 'luxon';

const currentmovie: Command = {
    name: 'currentmovie',
    description: 'View the currently scheduled movie night details.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('currentmovie')
        .setDescription('View the currently scheduled movie night details.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const movieRepo = services.repos.movieRepo;

        // Fetch latest scheduled movie event
        const movieEvent = await movieRepo.getActiveEvent();
        if (!movieEvent || movieEvent.completed) {
            await interaction.editReply("No movie night is currently scheduled.");
            return;
        }

        const startDate = movieEvent.startTime;

        const startTime = DateTime.fromJSDate(startDate);
        const unixTimestamp = Math.floor(startTime.toSeconds());

        // The night's movie, unless none has been picked yet
        const currentMovie: Movie | null = movieEvent.movie.id !== UNPICKED_MOVIE_ID ? movieEvent.movie : null;

        // Determine state message
        let stateMessage = "";
        if (currentMovie) {
            stateMessage = `🎬 We will be watching **${currentMovie.title}**!`;
        } else {
            stateMessage = "📭 No movie has been selected yet.";
        }

        const host = await interaction.client.users.fetch(movieEvent.hostedBy);
        const embed = createMovieNightEmbed(
            currentMovie,
            unixTimestamp,
            stateMessage,
            host.username
        );

        await interaction.editReply({
            embeds: [embed],
        });

        console.log(`[CurrentMovie] Displayed current movie night info.`);
    },
};

export default currentmovie;