import type { MockAgent } from "undici";

const JSON_RESPONSE = { headers: { "content-type": "application/json" } };

export type TMDbMovie = { id: number; title: string; release_date: string; overview: string };

export function tmdbSearch(http: MockAgent, query: string, results: TMDbMovie[]): void {
    http.get("https://api.themoviedb.org")
        .intercept({ path: `/3/search/movie?api_key=test-key&query=${encodeURIComponent(query)}`, method: "GET" })
        .reply(200, { results }, JSON_RESPONSE);
}

export function tmdbMovie(http: MockAgent, movie: TMDbMovie, runtime: number, director: string): void {
    const tmdb = http.get("https://api.themoviedb.org");
    tmdb.intercept({ path: `/3/movie/${movie.id}?api_key=test-key&language=en-US`, method: "GET" }).reply(
        200,
        { ...movie, runtime, vote_average: 8.2, genres: [{ id: 1, name: "Action" }] },
        JSON_RESPONSE,
    );
    tmdb.intercept({ path: `/3/movie/${movie.id}/credits?api_key=test-key&language=en-US`, method: "GET" }).reply(
        200,
        { cast: [{ name: "Keanu Reeves", order: 0 }], crew: [{ job: "Director", name: director }] },
        JSON_RESPONSE,
    );
}
