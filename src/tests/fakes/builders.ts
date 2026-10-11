import { TaskCategory, TaskType, type Task } from "../../models/Task.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import { newUserStats, type UserStats } from "../../models/UserStats.js";
import { SubmissionStatus, type TaskSubmission } from "../../models/TaskSubmission.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import type { Guild } from "../../models/Guild.js";
import type { Movie } from "../../models/Movie.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import { IDS, nextId } from "../discord/payloads.js";

// Builders return complete, valid domain objects; tests override only the fields they care about.

export function buildTask(overrides: Partial<Task> = {}): Task {
    return {
        id: "PVM001",
        taskName: "Kill {amount} Zulrah",
        category: TaskCategory.PvM,
        type: TaskType.KC,
        amtBronze: 10,
        amtSilver: 25,
        amtGold: 50,
        weight: 50,
        ...overrides,
    };
}

export function buildTaskEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
    const task = overrides.task ?? buildTask();
    return {
        id: `${task.id}-20260105`,
        task,
        category: task.category,
        amounts: { bronze: task.amtBronze, silver: task.amtSilver, gold: task.amtGold },
        keyword: "keyword",
        startTime: new Date("2026-01-05T00:00:00.000Z"),
        endTime: new Date("2026-01-12T00:00:00.000Z"),
        completionCounts: { bronze: 0, silver: 0, gold: 0 },
        completedUserIds: [],
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        ...overrides,
    };
}

export function buildUserStats(overrides: Partial<UserStats> = {}): UserStats {
    return { ...newUserStats("user-1", new Date("2026-01-01T00:00:00.000Z")), ...overrides };
}

export function buildTaskSubmission(overrides: Partial<TaskSubmission> = {}): TaskSubmission {
    return {
        id: "submission-1",
        userId: "user-1",
        taskEventId: "PVM001-20260105",
        taskName: "Kill 10 Zulrah",
        screenshotUrls: ["https://cdn.discordapp.com/attachments/1/2/proof.png"],
        status: SubmissionStatus.Pending,
        createdAt: new Date("2026-01-06T00:00:00.000Z"),
        ...overrides,
    };
}

export function buildTaskPoll(overrides: Partial<TaskPoll> = {}): TaskPoll {
    return {
        id: "poll-1",
        type: "task",
        category: TaskCategory.PvM,
        options: [buildTask({ id: "PVM001" }), buildTask({ id: "PVM002" }), buildTask({ id: "PVM003" })],
        // Posted in the harness guild's channel, so flows that fetch the poll message reach the harness
        messageId: nextId(),
        channelId: IDS.channel,
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        endsAt: new Date("2026-01-05T00:00:00.000Z"),
        isActive: true,
        votes: {},
        ...overrides,
    };
}

// A fully set-up guild whose ids match the Discord harness's guild, channel and roles
export function buildGuild(overrides: Partial<Guild> = {}): Guild {
    return {
        id: IDS.guild,
        toggles: { taskScheduler: false, leaguesEnabled: false },
        roles: { ...IDS.roles },
        channels: { announcements: IDS.channel, taskChannel: IDS.channel, taskVerification: IDS.channel, movieNight: IDS.channel },
        setupComplete: { core: true, movie: true, task: true },
        timezone: "UTC",
        ...overrides,
    };
}

export function buildMovie(overrides: Partial<Movie> = {}): Movie {
    return {
        id: "movie-1",
        title: "Inception",
        watched: false,
        addedBy: IDS.user,
        addedAt: new Date("2026-01-01T00:00:00.000Z"),
        runtime: 148,
        ...overrides,
    };
}

// A scheduled movie night, announced in the harness channel
export function buildMovieEvent(overrides: Partial<MovieEvent> = {}): MovieEvent {
    return {
        id: "event-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        startTime: new Date("2026-01-03T20:00:00.000Z"),
        movie: buildMovie(),
        channelId: IDS.channel,
        completed: false,
        hostedBy: IDS.user,
        ...overrides,
    };
}

// An open movie poll, posted in the harness channel
export function buildMoviePoll(overrides: Partial<MoviePoll> = {}): MoviePoll {
    return {
        id: "poll-1",
        type: "movie",
        options: [buildMovie({ id: "movie-1" }), buildMovie({ id: "movie-2", title: "Arrival" })],
        messageId: nextId(),
        channelId: IDS.channel,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-02T00:00:00.000Z"),
        isActive: true,
        votes: {},
        ...overrides,
    };
}
