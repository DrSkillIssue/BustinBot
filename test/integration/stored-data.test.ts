import { test, describe, expect } from "../fixtures.js";
import {
    movieFactory,
    movieEventFactory,
    moviePollFactory,
    taskEventFactory,
    taskPollFactory,
    taskSubmissionFactory,
    submissionDraftFactory,
    taskFactory,
    taskFeedbackFactory,
} from "../factories.js";
import { IDS } from "../discord/payloads.js";
import { TaskRepository } from "../../src/core/database/TaskRepo.js";

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

describe("TaskRepository kept tasks", () => {
    test("are read once, so a change written straight to Firestore isn't picked up", async ({ services, db }) => {
        const tasks = services.repos.taskRepo;
        await tasks.createTask(taskFactory.build({ id: "PVM001", taskName: "Kill {amount} Zulrah" }));
        await tasks.getTaskSearch();

        await db.doc(`guilds/${IDS.guild}/tasks/PVM001`).update({ taskName: "Kill {amount} Vorkath" });

        expect(await tasks.getAllTasks()).toEqual([expect.objectContaining({ taskName: "Kill {amount} Zulrah" })]);
        expect((await tasks.getTaskSearch()).search("vorkath")).toEqual([]);
    });

    test("follow the bot's own writes, matching a fresh read of what is stored", async ({ services, db }) => {
        const tasks = services.repos.taskRepo;
        const stored = () => new TaskRepository(db, IDS.guild).getAllTasks();
        await tasks.createTask(taskFactory.build({ id: "PVM001", taskName: "Kill {amount} Zulrah", weight: 50 }));
        await tasks.getTaskSearch();

        await tasks.createTask(taskFactory.build({ id: "PVM001", taskName: "Kill {amount} Vorkath", weight: 50 }));
        await tasks.createTask(taskFactory.build({ id: "PVM002", taskName: "Kill {amount} Zuk" }));
        await tasks.seedTasks([taskFactory.build({ id: "PVM003", taskName: "Kill {amount} Nex" })]);
        // Two imports at once both add the tasks neither has seen stored yet
        await tasks.seedTasks([taskFactory.build({ id: "PVM003", taskName: "Kill {amount} Nex" })]);
        await tasks.addTask(taskFactory.build({ id: "PVM004", taskName: "Kill {amount} Araxxor" }));
        expect(await tasks.addTask(taskFactory.build({ id: "PVM002", taskName: "Kill {amount} Hespori" }))).toBe(false);
        await tasks.recordFeedback(taskFeedbackFactory.build({ taskId: "PVM001", vote: "up" }));
        await tasks.recordFeedback(taskFeedbackFactory.build({ taskId: "PVM001", vote: "down" }));
        await tasks.recordFeedback(taskFeedbackFactory.build({ taskId: "PVM002", userId: "someone-else", vote: "up" }));

        expect(await tasks.getAllTasks()).toEqual(await stored());
        expect(await tasks.getAllTasks()).toContainEqual(expect.objectContaining({ id: "PVM001", weight: 49 }));
        const search = await tasks.getTaskSearch();
        expect(search.search("vorkath").map((result) => result.item.id)).toEqual(["PVM001"]);
        expect(search.search("zulrah")).toEqual([]);
        expect(search.search("nex").map((result) => result.item.id)).toEqual(["PVM003"]);
        expect(search.search("araxxor").map((result) => result.item.id)).toEqual(["PVM004"]);
        expect(search.search("hespori")).toEqual([]);

        await tasks.deleteAllTasks();
        expect(await tasks.getAllTasks()).toEqual(await stored());
        expect((await tasks.getTaskSearch()).search("vorkath")).toEqual([]);
    });
});
