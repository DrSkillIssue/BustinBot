import { test as base, describe, expect } from "../fixtures.js";
import {
    movieFactory,
    movieEventFactory,
    moviePollFactory,
    taskEventFactory,
    taskPollFactory,
    taskSubmissionFactory,
    submissionDraftFactory,
} from "../factories.js";
import { IDS } from "../discord/payloads.js";
import { MovieRepository } from "../../src/core/database/MovieRepo.js";
import { TaskRepository } from "../../src/core/database/TaskRepo.js";

const test = base
    .extend("movieRepo", ({ db }) => new MovieRepository(db, IDS.guild))
    .extend("taskRepo", ({ db }) => new TaskRepository(db, IDS.guild));

describe("MovieRepository dates", () => {
    const watched = movieFactory.build({
        id: "movie-3",
        watched: true,
        watchedAt: new Date("2026-01-04T00:00:00.000Z"),
        selectedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    test("reads movies, polls and events back exactly as stored, nested dates included", async ({ movieRepo }) => {
        const poll = moviePollFactory.build({ options: [movieFactory.build(), watched] });
        const event = movieEventFactory.build({
            movie: watched,
            completed: true,
            completedAt: new Date("2026-01-03T12:00:00.000Z"),
        });
        await movieRepo.upsertMovie(watched);
        await movieRepo.createPoll(poll);
        await movieRepo.createMovieEvent(event);

        expect(await movieRepo.getMovieById("movie-3")).toEqual(watched);
        expect(await movieRepo.getActivePoll()).toEqual(poll);
        expect(await movieRepo.getLatestEvent()).toEqual(event);
        expect((await movieRepo.getLatestEvent())?.movie.watchedAt).toBeInstanceOf(Date);
    });

    test("reports a stored date that is not a timestamp instead of guessing", async ({ movieRepo, db }) => {
        await db.doc(`guilds/${IDS.guild}/movies/movie-1`).set({ ...movieFactory.build(), addedAt: "2026-01-01" });

        await expect(movieRepo.getMovieById("movie-1")).rejects.toThrow(
            "Stored movie.addedAt is string, not a timestamp.",
        );
    });
});

describe("TaskRepository dates", () => {
    test("reads task events, polls, submissions and drafts back exactly as stored", async ({ taskRepo }) => {
        const event = taskEventFactory.build();
        const poll = taskPollFactory.build();
        const submission = taskSubmissionFactory.build({
            submittedAt: new Date("2026-01-06T01:00:00.000Z"),
            reviewedAt: new Date("2026-01-06T02:00:00.000Z"),
        });
        await taskRepo.createTaskEvent(event);
        await taskRepo.createTaskPoll(poll);
        await taskRepo.createSubmission(submission);
        const draft = submissionDraftFactory.build({
            taskEventId: event.id,
            createdAt: new Date("2026-01-06T00:30:00.000Z"),
        });
        await taskRepo.saveSubmissionDraft(draft);

        expect(await taskRepo.getSubmissionDraft(IDS.user)).toEqual(draft);
        expect(await taskRepo.getTaskEventById(event.id)).toEqual(event);
        expect(await taskRepo.getTaskPollById(poll.id)).toEqual(poll);
        expect(await taskRepo.getSubmissionById(submission.id)).toEqual(submission);
    });
});
