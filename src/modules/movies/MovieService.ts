import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import type { Movie } from "../../models/Movie.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { memberRoleIds } from "../../utils/MemberUtils.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export function tmdbApiKey(): string {
    const key = process.env.TMDB_API_KEY;
    if (!key) {
        throw new Error("TMDB_API_KEY is not set in your environment variables.");
    }
    return key;
}

function tmdbUrl(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.search = new URLSearchParams({ api_key: tmdbApiKey(), ...params }).toString();
    return url;
}

// TMDb Response Types
interface TMDbSearchResult {
    id: number;
    title: string;
    release_date?: string;
    overview?: string;
    poster_path?: string;
}

interface TMDbSearchResponse {
    results: TMDbSearchResult[];
}

interface TMDbDetailsResponse extends TMDbSearchResult {
    runtime?: number;
    vote_average?: number;
    genres?: { id: number; name: string }[];
    backdrop_path?: string;
}

interface TMDbCreditsResponse {
    cast: { name: string; order: number }[];
    crew: { job: string; name: string }[];
}

export async function fetchMovieDetails(movieName: string): Promise<Partial<Movie> | null> {
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieName)}`;

    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json() as TMDbSearchResponse;

    if (!searchData?.results?.length) return null;

    const topResult = searchData.results[0]!;

    const detailsUrl = `${TMDB_BASE_URL}/movie/${topResult.id}?api_key=${TMDB_API_KEY}`;
    const detailsResponse = await fetch(detailsUrl);
    const detailsData = (await detailsResponse.json()) as TMDbDetailsResponse;

    return {
        tmdbId: detailsData.id,
        title: detailsData.title,
        overview: detailsData.overview,
        releaseDate: detailsData.release_date
            ? Number(detailsData.release_date.slice(0, 4))
            : undefined,
        posterUrl: detailsData.poster_path
            ? `${TMDB_IMAGE_BASE}${detailsData.poster_path}`
            : undefined,
        infoUrl: `https://www.themoviedb.org/movie/${detailsData.id}`,
        runtime: detailsData.runtime ?? undefined,
        rating: detailsData.vote_average ?? undefined,
        genres: detailsData.genres?.map((g) => g.name) ?? undefined,
    } satisfies Partial<Movie>;
}

export async function fetchMovieDetailsById(id: number): Promise<Partial<Movie> | null> {
    const detailsUrl = `${TMDB_BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`;
    const creditsUrl = `${TMDB_BASE_URL}/movie/${id}/credits?api_key=${TMDB_API_KEY}&language=en-US`;

    const [detailsRes, creditsRes] = await Promise.all([
        fetch(detailsUrl),
        fetch(creditsUrl),
    ]);

    if (!detailsRes.ok) throw new Error("Failed to fetch TMDb details");
    if (!creditsRes.ok) throw new Error("Failed to fetch TMDb credits");

    const details = (await detailsRes.json()) as TMDbDetailsResponse;
    const credits = (await creditsRes.json()) as TMDbCreditsResponse;

    if (!details?.id) return null;

    // Extract director and top 3 billed cast
    const director =
        credits.crew?.find((member) => member.job === "Director")?.name ?? undefined;
    const cast =
        credits.cast?.slice(0, 3).map((actor) => actor.name).filter(Boolean) ?? [];

    return {
        tmdbId: details.id,
        title: details.title,
        overview: details.overview,
        releaseDate: details.release_date
            ? Number(details.release_date.slice(0, 4))
            : undefined,
        posterUrl: details.poster_path
            ? `${TMDB_IMAGE_BASE}${details.poster_path}`
            : undefined,
        infoUrl: `https://www.themoviedb.org/movie/${details.id}`,
        runtime: details.runtime ?? undefined,
        rating: details.vote_average ?? undefined,
        genres: details.genres?.map((g) => g.name) ?? undefined,
        director,
        cast,
    };
}

export const MAX_ACTIVE_MOVIES_PER_USER = 3;

export async function isMovieNightAdmin(
    services: ServiceContainer,
    interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<boolean> {
    if (interaction.guild?.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const roleIds = memberRoleIds(interaction.member);
    const roles = (await services.guilds.get(services.guildId))?.roles ?? {};
    return [roles.admin, roles.movieAdmin].some((roleId) => !!roleId && roleIds.includes(roleId));
}

export async function checkCanAddMovie(
    services: ServiceContainer,
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    tmdbId?: number
): Promise<string | null> {
    const movies = await services.repos.movieRepo.getAllMovies();
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

export async function addMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

    if (!movieRepo || !userRepo) {
        throw new Error("[MovieService] Missing repositories.");
    }

    await movieRepo.upsertMovie(movie);
    await userRepo.incrementStat(movie.addedBy, "moviesAdded", 1);
}

export async function removeMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

    if (!movieRepo) {
        throw new Error("[MovieService] Missing movie repository.");
    }

    if (movie.watched) {
        await movieRepo.upsertMovie({
            ...movie,
            watched: true,
            watchedAt: movie.watchedAt ?? new Date(),
            selectedAt: undefined,
            selectedBy: undefined,
        });
        return;
    }

    await movieRepo.deleteMovie(movie.id);

    if (!movie.watched && userRepo) {
        await userRepo.incrementStat(movie.addedBy, "moviesAdded", -1);
    } else if (!userRepo) {
        console.warn("[MovieService] User repository unavailable; skipping moviesAdded decrement.");
    }
}
