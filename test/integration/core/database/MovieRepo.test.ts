import { SnowflakeUtil } from "discord.js";
import { test as base, describe, expect } from "../../../fixtures.js";
import { movieFactory, movieEventFactory, moviePollFactory } from "../../../factories.js";
import { IDS } from "../../../discord/payloads.js";
import { MovieRepository } from "../../../../src/core/database/MovieRepo.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../../../firestoreEmulator.js";

const test = base.extend("repo", ({ db }) => new MovieRepository(db, IDS.guild));

describe("MovieRepository movies", () => {
    test("stores, lists and deletes movies", async ({ repo }) => {
        await repo.upsertMovie(movieFactory.build({ id: "movie-1" }));
        await repo.upsertMovie(movieFactory.build({ id: "movie-2", title: "Arrival" }));

        expect(await repo.getMovieById("movie-2")).toMatchObject({ title: "Arrival" });
        expect((await repo.getAllMovies()).map((movie) => movie.id).sort()).toEqual(["movie-1", "movie-2"]);

        await repo.deleteMovie("movie-1");
        expect(await repo.getMovieById("movie-1")).toBeNull();
    });

    test("stores a movie whose optional TMDb details are missing", async ({ repo }) => {
        await repo.upsertMovie(
            movieFactory.build({
                id: "arrival",
                title: "Arrival",
                director: undefined,
                runtime: undefined,
                posterUrl: undefined,
            }),
        );

        expect(await repo.getMovieById("arrival")).toMatchObject({ title: "Arrival" });
    });
});

describe("MovieRepository polls", () => {
    test("returns the most recently created active poll", async ({ repo }) => {
        await repo.createPoll(moviePollFactory.build({ id: "older", createdAt: new Date("2026-01-01T00:00:00.000Z") }));
        await repo.createPoll(moviePollFactory.build({ id: "newer", createdAt: new Date("2026-01-05T00:00:00.000Z") }));
        await repo.createPoll(
            moviePollFactory.build({ id: "closed", createdAt: new Date("2026-01-09T00:00:00.000Z"), isActive: false }),
        );

        const active = await repo.getActivePoll();
        expect(active?.id).toBe("newer");
        expect(active?.createdAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
        expect(active?.endsAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    });

    test("closes a poll once, returning it with its votes as it closed", async ({ repo }) => {
        const poll = moviePollFactory.build({ votes: { [IDS.user]: "movie-2" } });
        await repo.createPoll(poll);

        expect(await repo.closePoll(poll.id)).toMatchObject({ id: poll.id, votes: { [IDS.user]: "movie-2" } });
        expect(await repo.closePoll(poll.id)).toBeNull();
        expect(await repo.getActivePoll()).toBeNull();
    });

    test(
        "closes a poll closed twice at the same moment once",
        async ({ repo }) => {
            const poll = moviePollFactory.build();
            await repo.createPoll(poll);

            const closed = await Promise.all([repo.closePoll(poll.id), repo.closePoll(poll.id)]);

            expect(closed.filter(Boolean)).toHaveLength(1);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("records a vote and reports whether it was the voter's first", async ({ repo }) => {
        const poll = moviePollFactory.build();
        await repo.createPoll(poll);

        const first = await repo.voteInPollOnce(poll.id, IDS.user, "movie-1");
        const changed = await repo.voteInPollOnce(poll.id, IDS.user, "movie-2");

        expect(first.firstTime).toBe(true);
        expect(changed.firstTime).toBe(false);
        expect(changed.updatedPoll.votes).toEqual({ [IDS.user]: "movie-2" });
        await expect(repo.voteInPollOnce("missing", IDS.user, "movie-1")).rejects.toThrow("Poll not found.");
    });

    test(
        "counts every vote when voters vote at the same time",
        async ({ repo }) => {
            const poll = moviePollFactory.build();
            await repo.createPoll(poll);

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    repo.voteInPollOnce(poll.id, SnowflakeUtil.generate().toString(), "movie-1"),
                ),
            );

            expect(Object.keys((await repo.getActivePoll())?.votes ?? {})).toHaveLength(5);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("clears all polls", async ({ repo }) => {
        await repo.createPoll(moviePollFactory.build());

        await repo.clearPolls();

        expect(await repo.getActivePoll()).toBeNull();
    });
});

describe("MovieRepository events", () => {
    test("returns the active event with the latest start time, as dates", async ({ repo }) => {
        await repo.createMovieEvent(
            movieEventFactory.build({ id: "early", startTime: new Date("2026-01-03T09:00:00.000Z") }),
        );
        await repo.createMovieEvent(
            movieEventFactory.build({ id: "late", startTime: new Date("2026-01-10T09:00:00.000Z") }),
        );
        await repo.createMovieEvent(movieEventFactory.build({ id: "done", completed: true }));

        const active = await repo.getActiveEvent();
        expect(active?.id).toBe("late");
        expect(active?.startTime).toEqual(new Date("2026-01-10T09:00:00.000Z"));
    });

    test("completes an event once, with the changes given", async ({ repo }) => {
        const event = movieEventFactory.build();
        await repo.createMovieEvent(event);
        const completedAt = new Date("2026-01-03T12:00:00.000Z");

        expect(
            await repo.completeEvent(event.id, { completedAt, movie: movieFactory.build({ watched: true }) }),
        ).toMatchObject({
            completed: true,
            completedAt,
            movie: { watched: true },
        });
        expect(await repo.completeEvent(event.id)).toBeNull();
        expect(await repo.completeEvent("missing")).toBeNull();
        expect(await repo.getActiveEvent()).toBeNull();
    });

    test(
        "completes an event completed twice at the same moment once",
        async ({ repo }) => {
            const event = movieEventFactory.build();
            await repo.createMovieEvent(event);

            const completed = await Promise.all([repo.completeEvent(event.id), repo.completeEvent(event.id)]);

            expect(completed.filter(Boolean)).toHaveLength(1);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("claims each reminder once, and none for an event that has ended", async ({ repo }) => {
        const event = movieEventFactory.build();
        await repo.createMovieEvent(event);
        await repo.createMovieEvent(movieEventFactory.build({ id: "ended", completed: true }));

        expect(await repo.claimReminders(event.id, ["2 hours before"])).toEqual(["2 hours before"]);
        expect(await repo.claimReminders(event.id, ["2 hours before", "30 mins before"])).toEqual(["30 mins before"]);
        expect(await repo.claimReminders("ended", ["start time"])).toEqual([]);
        expect((await repo.getActiveEvent())?.remindersSent).toEqual(["2 hours before", "30 mins before"]);
    });

    test(
        "claims a reminder claimed twice at the same moment once",
        async ({ repo }) => {
            const event = movieEventFactory.build();
            await repo.createMovieEvent(event);

            const claims = await Promise.all([
                repo.claimReminders(event.id, ["start time"]),
                repo.claimReminders(event.id, ["start time"]),
            ]);

            expect(claims.flat()).toEqual(["start time"]);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("lists events newest first and returns the latest", async ({ repo }) => {
        await repo.createMovieEvent(
            movieEventFactory.build({ id: "first", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        );
        await repo.createMovieEvent(
            movieEventFactory.build({ id: "second", createdAt: new Date("2026-01-08T00:00:00.000Z") }),
        );

        expect((await repo.getAllEvents()).map((event) => event.id)).toEqual(["second", "first"]);
        expect((await repo.getLatestEvent())?.id).toBe("second");

        await repo.clearEvents();
        expect(await repo.getAllEvents()).toEqual([]);
    });
});

describe("MovieRepository dates", () => {
    const watched = movieFactory.build({
        id: "movie-3",
        watched: true,
        watchedAt: new Date("2026-01-04T00:00:00.000Z"),
        selectedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    test("reads movies, polls and events back exactly as stored, nested dates included", async ({ repo }) => {
        const poll = moviePollFactory.build({ options: [movieFactory.build(), watched] });
        const event = movieEventFactory.build({
            movie: watched,
            completed: true,
            completedAt: new Date("2026-01-03T12:00:00.000Z"),
        });
        await repo.upsertMovie(watched);
        await repo.createPoll(poll);
        await repo.createMovieEvent(event);

        expect(await repo.getMovieById("movie-3")).toEqual(watched);
        expect(await repo.getActivePoll()).toEqual(poll);
        expect(await repo.getLatestEvent()).toEqual(event);
        expect((await repo.getLatestEvent())?.movie.watchedAt).toBeInstanceOf(Date);
    });

    test("reports a stored date that is not a timestamp instead of guessing", async ({ repo, db }) => {
        await db.doc(`guilds/${IDS.guild}/movies/movie-1`).set({ ...movieFactory.build(), addedAt: "2026-01-01" });

        await expect(repo.getMovieById("movie-1")).rejects.toThrow("Stored movie.addedAt is string, not a timestamp.");
    });
});
