import { describe, expect, test } from "../../../tests/fixtures.js";
import { IDS } from "../../../tests/discord/payloads.js";
import type { ITaskRepository } from "../../../core/database/interfaces/ITaskRepo.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import { buildTaskEvent, buildTaskSubmission } from "../../../tests/fakes/builders.js";
import { calculateTaskStreakSummary } from "../TaskStreaks.js";

const DAY = 24 * 60 * 60 * 1000;
const at = (start: Date, days: number) => new Date(start.getTime() + days * DAY);

// Weekly task events stored back to back from `start`, one per id
async function storeWeeks(repo: ITaskRepository, start: Date, ids: string[]): Promise<void> {
    for (const [week, id] of ids.entries()) {
        await repo.createTaskEvent(buildTaskEvent({ id, startTime: at(start, 7 * week), endTime: at(start, 7 * (week + 1)), createdAt: at(start, 7 * week) }));
    }
}

async function submit(repo: ITaskRepository, eventId: string, submittedAt: Date, overrides: Parameters<typeof buildTaskSubmission>[0] = {}): Promise<void> {
    await repo.createSubmission(buildTaskSubmission({
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
        const start = new Date("2026-01-05T00:00:00Z");
        await storeWeeks(repo, start, ["week-1"]);
        await submit(repo, "week-1", at(start, 1));

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(start, 2))).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("continue across consecutive weeks", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = new Date("2026-02-02T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2"]);
        await submit(repo, "week-1", at(start, 1));
        await submit(repo, "week-2", at(start, 8));

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(start, 8))).toMatchObject({
            currentStreak: 2,
            longestStreak: 2,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("break when a week with a task is missed", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = new Date("2026-03-02T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2", "week-3"]);
        await submit(repo, "week-1", at(start, 1));

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(start, 16))).toMatchObject({
            currentStreak: 0,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("survive a break in which no tasks ran", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = new Date("2026-04-06T00:00:00Z");
        const afterBreak = at(start, 35);
        await repo.createTaskEvent(buildTaskEvent({ id: "before-break", startTime: start, endTime: at(start, 7), createdAt: start }));
        await repo.createTaskEvent(buildTaskEvent({ id: "after-break", startTime: afterBreak, endTime: at(afterBreak, 7), createdAt: afterBreak }));
        await submit(repo, "before-break", at(start, 1));

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(afterBreak, 1))).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("count a submission made before the week ended even if it was reviewed afterwards", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = new Date("2026-05-04T00:00:00Z");
        await storeWeeks(repo, start, ["week-1"]);
        const end = at(start, 7);
        await submit(repo, "week-1", new Date(end.getTime() - 2 * 60 * 60 * 1000), {
            status: SubmissionStatus.Gold,
            createdAt: new Date(end.getTime() + 2 * 60 * 60 * 1000),
        });

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(end, 1))).toMatchObject({ currentStreak: 1, longestStreak: 1 });
    });

    test("ignore submissions that were rejected or are still pending", async ({ services }) => {
        const repo = services.repos.taskRepo;
        const start = new Date("2026-06-01T00:00:00Z");
        await storeWeeks(repo, start, ["week-1", "week-2"]);
        await submit(repo, "week-1", at(start, 1), { status: SubmissionStatus.Rejected });
        await submit(repo, "week-2", at(start, 8), { status: SubmissionStatus.Pending });

        expect(await calculateTaskStreakSummary(IDS.user, repo, at(start, 9))).toMatchObject({ currentStreak: 0, longestStreak: 0 });
    });
});
