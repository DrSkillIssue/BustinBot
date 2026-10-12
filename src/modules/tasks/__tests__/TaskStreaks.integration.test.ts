import { DateTime } from "luxon";
import { describe, expect, test } from "../../../tests/fixtures.js";
import { IDS } from "../../../tests/discord/payloads.js";
import type { ITaskRepository } from "../../../core/database/interfaces/ITaskRepo.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import { taskEventFactory, taskSubmissionFactory } from "../../../tests/factories.js";
import { calculateTaskStreakSummary } from "../TaskStreaks.js";

// Weekly task events stored back to back from `start`, one per id
async function storeWeeks(repo: ITaskRepository, start: DateTime, ids: string[]): Promise<void> {
    for (const [week, id] of ids.entries()) {
        await repo.createTaskEvent(taskEventFactory.build({ id, startTime: start.plus({ weeks: week }).toJSDate(), endTime: start.plus({ weeks: week + 1 }).toJSDate(), createdAt: start.plus({ weeks: week }).toJSDate() }));
    }
}

async function submit(repo: ITaskRepository, eventId: string, submittedAt: Date, overrides: Parameters<typeof taskSubmissionFactory.build>[0] = {}): Promise<void> {
    await repo.createSubmission(taskSubmissionFactory.build({
        id: `${eventId}-submission`,
        userId: IDS.user,
        taskEventId: eventId,
        status: SubmissionStatus.Bronze,
        createdAt: submittedAt,
        submittedAt,
        ...overrides,
    }));
}

describe("task streaks", () => {
    test("start when the current week's task is completed", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-01-05T00:00:00Z");
        await storeWeeks(repo, start, ["week-1"]);
        await submit(repo, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, repo, start.plus({ days: 2 }).toJSDate())).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("continue across consecutive weeks", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-02-02T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2"]);
        await submit(repo, "week-1", start.plus({ days: 1 }).toJSDate());
        await submit(repo, "week-2", start.plus({ days: 8 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, repo, start.plus({ days: 8 }).toJSDate())).toMatchObject({
            currentStreak: 2,
            longestStreak: 2,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("break when a week with a task is missed", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-03-02T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2", "week-3"]);
        await submit(repo, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, repo, start.plus({ days: 16 }).toJSDate())).toMatchObject({
            currentStreak: 0,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("survive a break in which no tasks ran", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-04-06T00:00:00Z");
        const afterBreak = start.plus({ days: 35 });
        await repo.createTaskEvent(taskEventFactory.build({ id: "before-break", startTime: start.toJSDate(), endTime: start.plus({ days: 7 }).toJSDate(), createdAt: start.toJSDate() }));
        await repo.createTaskEvent(taskEventFactory.build({ id: "after-break", startTime: afterBreak.toJSDate(), endTime: afterBreak.plus({ days: 7 }).toJSDate(), createdAt: afterBreak.toJSDate() }));
        await submit(repo, "before-break", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, repo, afterBreak.plus({ days: 1 }).toJSDate())).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("count a submission made before the week ended even if it was reviewed afterwards", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-05-04T00:00:00Z");
        await storeWeeks(repo, start, ["week-1"]);
        const end = start.plus({ days: 7 });
        await submit(repo, "week-1", end.minus({ hours: 2 }).toJSDate(), {
            status: SubmissionStatus.Gold,
            createdAt: end.plus({ hours: 2 }).toJSDate(),
        });

        expect(await calculateTaskStreakSummary(IDS.user, repo, end.plus({ days: 1 }).toJSDate())).toMatchObject({ currentStreak: 1, longestStreak: 1 });
    });

    test("ignore submissions that were rejected or are still pending", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = DateTime.fromISO("2026-06-01T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2"]);
        await submit(repo, "week-1", start.plus({ days: 1 }).toJSDate(), { status: SubmissionStatus.Rejected });
        await submit(repo, "week-2", start.plus({ days: 8 }).toJSDate(), { status: SubmissionStatus.Pending });

        expect(await calculateTaskStreakSummary(IDS.user, repo, start.plus({ days: 9 }).toJSDate())).toMatchObject({ currentStreak: 0, longestStreak: 0 });
    });
});
