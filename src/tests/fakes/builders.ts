import { TaskCategory, TaskType, type Task } from "../../models/Task.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { UserStats } from "../../models/UserStats.js";
import { SubmissionStatus, type TaskSubmission } from "../../models/TaskSubmission.js";
import type { TaskPoll } from "../../models/TaskPoll.js";

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
    return {
        userId: "user-1",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastActiveAt: new Date("2026-01-01T00:00:00.000Z"),
        commandsRun: 0,
        moviesAdded: 0,
        moviesWatched: 0,
        moviesAttended: 0,
        moviePollsVoted: 0,
        tasksCompletedBronze: 0,
        tasksCompletedSilver: 0,
        tasksCompletedGold: 0,
        taskStreak: 0,
        longestTaskStreak: 0,
        taskPollsVoted: 0,
        taskPrizesWon: 0,
        legacyTasksCompleted: 0,
        ...overrides,
    };
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
        messageId: "message-1",
        channelId: "channel-1",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        endsAt: new Date("2026-01-05T00:00:00.000Z"),
        isActive: true,
        votes: {},
        ...overrides,
    };
}
