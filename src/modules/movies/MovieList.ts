import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { createMovieListEmbeds } from "./MovieEmbeds.js";

const MOVIES_PER_PAGE = 3;

// Page buttons carry the page they lead to, so they work for as long as the list is shown, across restarts
export const MOVIE_LIST_BUTTON = "listmovies|";

export type MovieListPage = { content: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };

function pageButton(action: string, page: number, emoji: string, style: ButtonStyle, disabled: boolean): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`${MOVIE_LIST_BUTTON}${action}|${page}`)
        .setEmoji(emoji)
        .setStyle(style)
        .setDisabled(disabled);
}

// One page of the unwatched movies, oldest first, with buttons to the first, previous, next and last pages
export async function buildMovieListPage(services: ServiceContainer, requestedPage: number): Promise<MovieListPage> {
    const movies = (await services.repos.movieRepo.getAllMovies())
        .filter((movie) => !movie.watched)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());

    if (!movies.length) {
        return { content: "No unwatched movies are currently queued. Add a new one with `/addmovie`!", embeds: [], components: [] };
    }

    const lastPage = Math.ceil(movies.length / MOVIES_PER_PAGE) - 1;
    const page = Math.min(Math.max(requestedPage, 0), lastPage);
    const embeds = createMovieListEmbeds(movies.slice(page * MOVIES_PER_PAGE, (page + 1) * MOVIES_PER_PAGE), page, MOVIES_PER_PAGE);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        pageButton("start", 0, "⏮️", ButtonStyle.Secondary, page === 0),
        pageButton("prev", page - 1, "◀️", ButtonStyle.Primary, page === 0),
        pageButton("next", page + 1, "▶️", ButtonStyle.Primary, page >= lastPage),
        pageButton("end", lastPage, "⏭️", ButtonStyle.Secondary, page >= lastPage),
    );

    return { content: "", embeds, components: [buttons] };
}

// The page a list button leads to
export function movieListButtonPage(customId: string): number {
    return Number.parseInt(customId.split("|")[2] ?? "0", 10) || 0;
}
