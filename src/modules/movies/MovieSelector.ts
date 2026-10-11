import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import { randomUUID } from "node:crypto";
import { createMovieEmbed, createMoviePreviewEmbeds } from "./MovieEmbeds.js";
import { addMovieWithStats, fetchMovieDetailsById, type TMDbSearchResponse } from "./MovieService.js";
import type { Movie } from "../../models/Movie.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";

export const MAX_ACTIVE_MOVIES_PER_USER = 3;

// Result buttons carry the TMDb id they add, so they work for as long as the results are shown, across restarts
export const ADD_MOVIE_BUTTON = "addmovie|";

type Member = ChatInputCommandInteraction["member"] | ButtonInteraction["member"];

// Whether a member runs movie nights: the server owner, administrators, and bot or movie admins. They may add more
// than the usual number of movies. Discord sends the member's roles as a cached GuildMember or, when the member
// isn't cached, as ids.
export async function isMovieNightAdmin(services: ServiceContainer, interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
    if (interaction.guild?.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const member: Member = interaction.member;
    const roleIds = member instanceof GuildMember ? [...member.roles.cache.keys()] : member?.roles ?? [];
    const roles = (await services.guilds.get(services.guildId))?.roles ?? {};
    return [roles.admin, roles.movieAdmin].some((roleId) => !!roleId && roleIds.includes(roleId));
}

// Why a member can't add a movie right now, or null if they can: they already have the most movies allowed in
// the list, or the movie is already in it
export async function checkCanAddMovie(services: ServiceContainer, interaction: ChatInputCommandInteraction | ButtonInteraction, tmdbId?: number): Promise<string | null> {
    const movies = await services.repos.movieRepo!.getAllMovies();
    const active = movies.filter((movie) => !movie.watched);

    const own = active.filter((movie) => movie.addedBy === interaction.user.id);
    if (own.length >= MAX_ACTIVE_MOVIES_PER_USER && !(await isMovieNightAdmin(services, interaction))) {
        return `You have reached the maximum of ${MAX_ACTIVE_MOVIES_PER_USER} active movies. Remove one or wait for a movie night to conclude before adding more.`;
    }

    const existing = tmdbId === undefined ? undefined : active.find((movie) => movie.tmdbId === tmdbId);
    if (existing) {
        const addedBy = existing.addedByDisplay ?? `<@${existing.addedBy}>`;
        return `**${existing.title}** is already in the movie list (added by ${addedBy}). Please choose a different result.`;
    }
    return null;
}

// Shows the top TMDb results for a search, each with a button that adds it
export async function presentMovieSelection(interaction: ChatInputCommandInteraction, query: string, year?: number, maxResults = 3): Promise<void> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}${year ? `&year=${year}` : ''}`;
    const response = await fetch(searchUrl);
    const data = await response.json() as TMDbSearchResponse;

    if (!data?.results?.length) {
        await interaction.editReply(`No results found for "${query}".`);
        return;
    }

    const topResults = data.results.slice(0, maxResults);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...topResults.map((result, i) =>
            new ButtonBuilder()
                .setCustomId(`${ADD_MOVIE_BUTTON}select|${result.id}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Primary)
        ),
        new ButtonBuilder()
            .setCustomId(`${ADD_MOVIE_BUTTON}cancel`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
        content: "Here are the **top 3** results for that movie; click the button that matches the movie you're looking for. If none of these match, click **Cancel** and try again with a different search term.",
        embeds: createMoviePreviewEmbeds(topResults),
        components: [buttons],
    });
}

// A click on one of the search results, or Cancel
export async function handleAddMovieButton(services: ServiceContainer, interaction: ButtonInteraction): Promise<void> {
    const [, action, id] = interaction.customId.split("|");
    if (action === "cancel") {
        await interaction.update({ content: 'Cancelled movie selection.', components: [], embeds: [] });
        return;
    }

    await interaction.deferUpdate();
    const tmdbId = Number(id);
    const refusal = await checkCanAddMovie(services, interaction, tmdbId);
    if (refusal) {
        await interaction.followUp({ content: refusal, flags: MessageFlags.Ephemeral });
        return;
    }

    const metadata = await fetchMovieDetailsById(tmdbId);
    if (!metadata?.title) {
        await interaction.followUp({ content: `Could not fetch details for that movie.`, flags: MessageFlags.Ephemeral });
        return;
    }

    const movie: Movie = {
        id: randomUUID(),
        tmdbId: metadata.tmdbId,
        title: metadata.title,
        releaseDate: metadata.releaseDate,
        posterUrl: metadata.posterUrl,
        infoUrl: metadata.infoUrl,
        overview: metadata.overview,
        runtime: metadata.runtime,
        genres: metadata.genres,
        rating: metadata.rating,
        director: metadata.director,
        cast: metadata.cast,
        watched: false,
        addedBy: interaction.user.id,
        addedAt: new Date(),
    };
    await addMovieWithStats(movie, services);

    const embed = createMovieEmbed(movie)
        .setTitle(`Added: ${movie.title}`)
        .setFooter({ text: `Added by ${interaction.user.username}` });
    await interaction.editReply({ content: '', embeds: [embed], components: [] });
    console.log(`[AddMovie] Added "${movie.title}" by ${interaction.user.username}`);
}
