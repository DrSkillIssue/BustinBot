import { test, describe, expect } from "../fixtures.js";
import { movieFactory, movieEventFactory, moviePollFactory } from "../factories.js";

describe("MovieRepository dates", () => {
    const watched = movieFactory.build({
        id: "movie-3",
        watched: true,
        watchedAt: new Date("2026-01-04T00:00:00.000Z"),
        selectedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    test("reads movies, polls and events back exactly as stored, nested dates included", async ({ services }) => {
        const poll = moviePollFactory.build({ options: [movieFactory.build(), watched] });
        const event = movieEventFactory.build({
            movie: watched,
            completed: true,
            completedAt: new Date("2026-01-03T12:00:00.000Z"),
        });
        await services.repos.movieRepo.upsertMovie(watched);
        await services.repos.movieRepo.createPoll(poll);
        await services.repos.movieRepo.createMovieEvent(event);

        expect(await services.repos.movieRepo.getMovieById("movie-3")).toEqual(watched);
        expect(await services.repos.movieRepo.getActivePoll()).toEqual(poll);
        expect(await services.repos.movieRepo.getLatestEvent()).toEqual(event);
        expect((await services.repos.movieRepo.getLatestEvent())?.movie.watchedAt).toBeInstanceOf(Date);
    });
});
