import type { Movie } from "../../models/Movie.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

function tmdbUrl(path: string, params: Record<string, string> = {}): URL {
    const key = process.env.TMDB_API_KEY;
    if (!key) {
        throw new Error("TMDB_API_KEY is not set in your environment variables.");
    }
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.search = new URLSearchParams({ api_key: key, ...params }).toString();
    return url;
}

// TMDb Response Types
export interface TMDbSearchResult {
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

export async function searchMovies(query: string, year?: number): Promise<TMDbSearchResult[]> {
    const response = await fetch(tmdbUrl("/search/movie", year === undefined ? { query } : { query, year: `${year}` }));
    const data = (await response.json()) as TMDbSearchResponse;
    return data?.results ?? [];
}

export async function fetchMovieDetails(movieName: string): Promise<Partial<Movie> | null> {
    const [topResult] = await searchMovies(movieName);
    return topResult ? fetchMovieDetailsById(topResult.id) : null;
}

export async function fetchMovieDetailsById(id: number): Promise<Partial<Movie> | null> {
    const [detailsRes, creditsRes] = await Promise.all([
        fetch(tmdbUrl(`/movie/${id}`, { language: "en-US" })),
        fetch(tmdbUrl(`/movie/${id}/credits`, { language: "en-US" })),
    ]);

    if (!detailsRes.ok) throw new Error("Failed to fetch TMDb details");
    if (!creditsRes.ok) throw new Error("Failed to fetch TMDb credits");

    const details = (await detailsRes.json()) as TMDbDetailsResponse;
    const credits = (await creditsRes.json()) as TMDbCreditsResponse;

    if (!details?.id) return null;

    // Extract director and top 3 billed cast
    const director = credits.crew?.find((member) => member.job === "Director")?.name ?? undefined;
    const cast =
        credits.cast
            ?.slice(0, 3)
            .map((actor) => actor.name)
            .filter(Boolean) ?? [];

    return {
        tmdbId: details.id,
        title: details.title,
        overview: details.overview,
        releaseDate: details.release_date ? Number(details.release_date.slice(0, 4)) : undefined,
        posterUrl: details.poster_path ? `${TMDB_IMAGE_BASE}${details.poster_path}` : undefined,
        infoUrl: `https://www.themoviedb.org/movie/${details.id}`,
        runtime: details.runtime ?? undefined,
        rating: details.vote_average ?? undefined,
        genres: details.genres?.map((g) => g.name) ?? undefined,
        director,
        cast,
    };
}

export async function addMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

    await movieRepo.upsertMovie(movie);
    await userRepo.incrementStat(movie.addedBy, "moviesAdded", 1);
}

export async function removeMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

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
    await userRepo.incrementStat(movie.addedBy, "moviesAdded", -1);
}
