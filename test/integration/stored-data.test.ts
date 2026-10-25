import { test, describe, expect } from "../fixtures.js";
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

describe("TaskRepository dates", () => {
    test("reads task events, polls, submissions and drafts back exactly as stored", async ({ services }) => {
        const event = taskEventFactory.build();
        const poll = taskPollFactory.build();
        const submission = taskSubmissionFactory.build({
            submittedAt: new Date("2026-01-06T01:00:00.000Z"),
            reviewedAt: new Date("2026-01-06T02:00:00.000Z"),
        });
        await services.repos.taskRepo.createTaskEvent(event);
        await services.repos.taskRepo.createTaskPoll(poll);
        await services.repos.taskRepo.createSubmission(submission);
        const draft = submissionDraftFactory.build({
            taskEventId: event.id,
            createdAt: new Date("2026-01-06T00:30:00.000Z"),
        });
        await services.repos.taskRepo.saveSubmissionDraft(draft);

        expect(await services.repos.taskRepo.getSubmissionDraft(IDS.user)).toEqual(draft);
        expect(await services.repos.taskRepo.getTaskEventById(event.id)).toEqual(event);
        expect(await services.repos.taskRepo.getTaskPollById(poll.id)).toEqual(poll);
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toEqual(submission);
    });
});
