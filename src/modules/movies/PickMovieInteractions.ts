import { ButtonInteraction, ModalSubmitInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, MessageFlags } from "discord.js";
import Fuse from 'fuse.js';
import type { Movie } from "../../models/Movie.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import type { PollSession } from "../../models/PollSession.js";
import { createMovieEmbed } from "./MovieEmbeds.js";
import { pickRandomMovie, buildMovieEmbedWithMeta } from "./MovieLocalSelector.js";
import { changeManualPollPage, showMovieManualPollMenu } from "./MovieManualPoll.js";
import { pollMovieRandom, pollMovieWithList } from "./MoviePolls.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { notifyMovieSubmitter } from "./MovieLocalSelector.js";
function getActiveMoviesSorted(movies: Movie[]): Movie[] {
    return movies
        .filter((movie) => !movie.watched)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
}

export async function saveCurrentMovie(services: ServiceContainer, movie: Movie, selectedBy?: string) {
    const movieRepo = services.repos.movieRepo;

    if (movie.watched) {
        console.warn(`[MovieStorage] Refusing to select watched movie: ${movie.title} (${movie.id})`);
        return;
    }

    try {
        const { addedByDisplay, addedByDevId, ...movieData } = movie;
        const updatedMovie: Movie = {
            ...movieData,
            watched: false,
            selectedAt: new Date(),
            selectedBy,
        };
        await movieRepo.upsertMovie(updatedMovie);

        const activeEvent = await movieRepo.getActiveEvent();
        if (activeEvent && !activeEvent.completed) {
            const guildConfig = services.guildId ? await services.guilds.get(services.guildId) : null;
            const voiceChannelId = activeEvent.voiceChannelId ?? guildConfig?.channels?.movieVC;
            const updatedEvent = {
                ...activeEvent,
                movie: updatedMovie,
                ...(voiceChannelId ? { voiceChannelId } : {}),
            };
            await movieRepo.createMovieEvent(updatedEvent);
        }
        console.log(`[MovieStorage] Saved current movie: ${movie.title}`);
    } catch (error) {
        console.error("[MovieStorage] Failed to save current movie:", error);
    }
}

function getPollSession(poll: MoviePoll): PollSession<Movie> {
    const voteCounts = new Map<string, number>();
    for (const movie of poll.options) {
        voteCounts.set(movie.id, 0);
    }

    Object.values(poll.votes).forEach(movieId => {
        if (voteCounts.has(movieId)) {
            voteCounts.set(movieId, voteCounts.get(movieId)! + 1);
        }
    });

    return {
        ...poll,
        optionVoteCounts: voteCounts,
    };
}

export async function handleMoviePickChooseModalSubmit(services: ServiceContainer, interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    const movieRepo = services.repos.movieRepo;

    const input = interaction.fields.getTextInputValue("movie_input").trim();
    const movies: Movie[] = getActiveMoviesSorted(await movieRepo.getAllMovies());

    if (!movies.length) {
        await interaction.editReply({ content: "Movie list is empty." });
        return;
    }

    let selectedMovie: Movie | undefined;

    // Case 1: Numeric input as index
    if (/^\d+$/.test(input)) {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < movies.length) {
            selectedMovie = movies[index];
        }
    }

    // Case 2: Title fuzzy match using Fuse.js
    if (!selectedMovie) {
        const fuse = new Fuse(movies, {
            keys: ["title"],
            threshold: 0.4,
            includeScore: true,
        });

        const results = fuse.search(input);
        if (results.length) {
            selectedMovie = results[0]?.item;
        }
    }

    if (!selectedMovie) {
        await interaction.editReply({ content: "No matching movie found." });
        return;
    }

    await saveCurrentMovie(services, selectedMovie, interaction.user.id);
    await notifyMovieSubmitter(selectedMovie, interaction.client, services);

    const embed = createMovieEmbed(selectedMovie);
    const existingDescription = embed.data.description ?? "";
    const addedByLine = `\n\n*Added by <@${selectedMovie.addedBy}>*`;

    embed.setTitle(
        `🎯  ${selectedMovie.title} ${selectedMovie.releaseDate ? `(${selectedMovie.releaseDate})` : ""
        }`
    );
    embed.setDescription(`${existingDescription}${addedByLine}`);

    const channel = interaction.channel;
    if (!channel?.isSendable()) {
        await interaction.editReply({ content: "The selected movie can't be posted in this channel." });
        return;
    }
    await interaction.editReply({
        content: `**${selectedMovie.title}** has been selected and posted!`,
    });

    await channel.send({
        content: `The following movie has been selected for movie night:`,
        embeds: [embed],
    });
}

export async function handleRandomPollCountSelect(services: ServiceContainer, interaction: StringSelectMenuInteraction) {
    const selectedCount = parseInt(interaction.values[0]!, 10);
    await interaction.deferUpdate();
    await pollMovieRandom(services, interaction, selectedCount);
}

export async function handleConfirmRandomMovie(services: ServiceContainer, interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    const embed = interaction.message.embeds[0];
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
        await interaction.editReply({ content: "The selected movie can't be posted in this channel." });
        return;
    }

    const parts = interaction.customId.split("_");
    const movieId = parts[3];
    if (!movieId) {
        await interaction.editReply({ content: "Could not identify movie ID." });
        return;
    }

    const movieRepo = services.repos.movieRepo;

    const movies = await movieRepo.getAllMovies();
    const selectedMovie = movies.find((m) => m.id === movieId && !m.watched);
    if (!selectedMovie) {
        await interaction.editReply({
            content: "Could not find the selected movie in the active movie list."
        });
        return;
    }

    await saveCurrentMovie(services, selectedMovie, interaction.user.id);
    await notifyMovieSubmitter(selectedMovie, interaction.client, services);

    if (!embed) {
        await channel.send({
            content: `🎉 Movie locked in (no embed found).`,
            components: [],
        });
        return;
    }

    await channel.send({
        content: `The following movie has been selected for movie night:`,
        embeds: [embed],
        components: [],
    });

    try {
        await interaction.editReply({
            content: "Movie selected and posted!",
            embeds: [],
            components: [],
        });
    } catch (error) {
        console.warn("[MovieConfirm] Failed to clean up ephemeral message:", error);
    }
}

export async function handleRerollRandomMovie(services: ServiceContainer, interaction: ButtonInteraction) {
    const newMovie = await pickRandomMovie(services);

    if (!newMovie) {
        await interaction.update({
            content: 'Failed to reroll: movie list is empty.',
            components: [],
            embeds: []
        });
        return;
    }

    const embed = await buildMovieEmbedWithMeta(newMovie, 'random');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_random_movie_${newMovie.id}`)
            .setLabel('🎥 Lock this in')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('reroll_random_movie')
            .setLabel('🔁 Reroll')
            .setStyle(ButtonStyle.Danger)
    );

    await interaction.update({
        content: '🔁 New movie selected:',
        embeds: [embed],
        components: [row],
    });
}

export async function handleMoviePollVote(services: ServiceContainer, interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    const movieRepo = services.repos.movieRepo;

    const activePoll = await movieRepo.getActivePoll();
    if (!activePoll || !activePoll.isActive) {
        await interaction.editReply({ content: "This poll is no longer active." });
        return;
    }

    if (interaction.message.id !== activePoll.messageId) {
        await interaction.editReply({ content: "This poll message is outdated." });
        return;
    }

    const selectedIndex = parseInt(interaction.customId.replace("movie_vote_", ""), 10);
    const selectedMovie = activePoll.options[selectedIndex];
    if (!selectedMovie) {
        await interaction.editReply({ content: "Invalid vote option." });
        return;
    }

    const userId = interaction.user.id;

    let firstTime = false;
    let updatedPoll = activePoll;
    try {
        const result = await movieRepo.voteInPollOnce(activePoll.id, userId, selectedMovie.id);
        firstTime = result.firstTime;
        updatedPoll = result.updatedPoll;
    } catch (err) {
        console.error("[MoviePollVote] Failed to record vote transaction:", err);
        await interaction.editReply({ content: "An error occurred while recording your vote." });
        return;
    }

    if (firstTime) {
        const userRepo = services.repos.userRepo;
        try {
            await userRepo.incrementStat(userId, "moviePollsVoted", 1);
        } catch (err) {
            console.warn(`[Stats] Failed to increment moviePollsVoted for ${interaction.user.username}:`, err);
        }
    }

    const pollSession = getPollSession(updatedPoll);
    const updatedEmbeds: EmbedBuilder[] = interaction.message.embeds.map((embedData, i) => {
        const embed = EmbedBuilder.from(embedData);
        const movie = updatedPoll.options[i]!;
        const count = pollSession.optionVoteCounts.get(movie.id) ?? 0;
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : "";
        embed.setFooter({
            text: `🗳️ ${count} vote${count !== 1 ? "s" : ""}${runtimeText} | Option ${i + 1}`,
        });
        return embed;
    });

    await interaction.message.edit({ embeds: updatedEmbeds });
    await interaction.editReply({ content: "Thank you for your vote!" });
}

export async function handlePickMovieButton(services: ServiceContainer, interaction: ButtonInteraction) {
    switch (interaction.customId) {
        case 'movie_pick_choose':
            await interaction.showModal(
                new ModalBuilder()
                    .setCustomId('movie_pick_choose_modal')
                    .setTitle('Choose a movie')
                    .addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('movie_input')
                                .setLabel('Enter movie title or list number')
                                .setPlaceholder('e.g., 3 or The Matrix')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    )
            );
            return;
        case 'movie_pick_random': {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const selectedMovie = await pickRandomMovie(services);
            if (!selectedMovie) {
                await interaction.editReply({ content: 'Movie list not found or is empty.' });
                return;
            }

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_random_movie_${selectedMovie.id}`)
                    .setLabel('🎥 Lock this in')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('reroll_random_movie')
                    .setLabel('🔁 Reroll')
                    .setStyle(ButtonStyle.Danger)
            );
            await interaction.editReply({
                content: 'A random movie has been selected:',
                embeds: [await buildMovieEmbedWithMeta(selectedMovie, 'random')],
                components: [row],
            });
            return;
        }
        case 'movie_poll_random':
            await interaction.reply({
                content: 'How many movies should be included in the poll?',
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('movie_poll_random_count')
                            .setPlaceholder('Select how many movies to include')
                            .addOptions([2, 3, 4, 5].map((num) => ({ label: `${num} movies`, value: num.toString() })))
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        case 'movie_poll_manual':
            await interaction.deferUpdate();
            await showMovieManualPollMenu(services, interaction);
            return;
    }
}

export async function handleManualPollInteraction(services: ServiceContainer, interaction: ButtonInteraction) {
    const uid = interaction.user.id;

    switch (interaction.customId) {
        case 'movie_poll_manual_prev':
        case 'movie_poll_manual_next':
            await interaction.deferUpdate();
            await changeManualPollPage(services, uid, interaction.customId === 'movie_poll_manual_prev' ? -1 : 1);
            return showMovieManualPollMenu(services, interaction);
        case 'movie_poll_manual_cancel':
            services.manualPolls.clear(uid);
            return interaction.update({ content: 'Poll creation cancelled.', embeds: [], components: [] });
        case 'movie_poll_manual_confirm': {
            const session = services.manualPolls.get(uid);
            if (session.selected.size < 2 || session.selected.size > 5) {
                return interaction.reply({ content: `You must select between 2 and 5 movies.`, flags: MessageFlags.Ephemeral });
            }

            const movieRepo = services.repos.movieRepo;

            const allMovies: Movie[] = (await movieRepo.getAllMovies()).filter((movie) => !movie.watched);
            const selectedMovieIds = Array.from(session.selected);
            const selectedMovies = allMovies.filter(m => selectedMovieIds.includes(m.id));

            services.manualPolls.clear(uid);

            return pollMovieWithList(services, interaction, selectedMovies);
        }
    }
}
