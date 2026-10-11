import { TaskCategory, TaskType, type Task } from "../../models/Task.js";
import type { TaskEvent } from "../../models/TaskEvent.js";

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
