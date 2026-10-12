import { DateTime } from "luxon";
import { describe, expect, test, type StoringFactories } from "../../../fixtures.js";
import { IDS } from "../../../discord/payloads.js";
import { SubmissionStatus } from "../../../../src/models/TaskSubmission.js";
import { calculateTaskStreakSummary } from "../../../../src/modules/tasks/TaskStreaks.js";

// Weekly task events stored back to back from `start`, one per id
async function storeWeeks(factories: StoringFactories, start: DateTime, ids: string[]): Promise<void> {
    for (const [week, id] of ids.entries()) {
        await factories.taskEvent.create({
            id,
            startTime: start.plus({ weeks: week }).toJSDate(),
            endTime: start.plus({ weeks: week + 1 }).toJSDate(),
            createdAt: start.plus({ weeks: week }).toJSDate(),
        });
    }
}

async function submit(
    factories: StoringFactories,
    eventId: string,
    submittedAt: Date,
    overrides: Parameters<StoringFactories["taskSubmission"]["build"]>[0] = {},
): Promise<void> {
    await factories.taskSubmission.create({
        id: `${eventId}-submission`,
        userId: IDS.user,
        taskEventId: eventId,
        status: SubmissionStatus.Bronze,
        createdAt: submittedAt,
        submittedAt,
        ...overrides,
    });
}

describe("task streaks", () => {
    test("start when the current week's task is completed", async ({ services, factories }) => {
        const start = DateTime.fromISO("2026-01-05T00:00:00Z");
        await storeWeeks(factories, start, ["week-1"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(
            await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo, start.plus({ days: 2 }).toJSDate()),
        ).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("continue across consecutive weeks", async ({ services, factories }) => {
        const start = DateTime.fromISO("2026-02-02T00:00:00Z");
        await storeWeeks(factories, start, ["week-1", "week-2"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());
        await submit(factories, "week-2", start.plus({ days: 8 }).toJSDate());

        expect(
            await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo, start.plus({ days: 8 }).toJSDate()),
        ).toMatchObject({
            currentStreak: 2,
            longestStreak: 2,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("break when a week with a task is missed", async ({ services, factories }) => {
        const start = DateTime.fromISO("2026-03-02T00:00:00Z");
        await storeWeeks(factories, start, ["week-1", "week-2", "week-3"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(
            await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo, start.plus({ days: 16 }).toJSDate()),
        ).toMatchObject({
            currentStreak: 0,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("survive a break in which no tasks ran", async ({ services, factories }) => {
        const start = DateTime.fromISO("2026-04-06T00:00:00Z");
        const afterBreak = start.plus({ days: 35 });
        await factories.taskEvent.create({
            id: "before-break",
            startTime: start.toJSDate(),
            endTime: start.plus({ days: 7 }).toJSDate(),
            createdAt: start.toJSDate(),
        });
        await factories.taskEvent.create({
            id: "after-break",
            startTime: afterBreak.toJSDate(),
            endTime: afterBreak.plus({ days: 7 }).toJSDate(),
            createdAt: afterBreak.toJSDate(),
        });
        await submit(factories, "before-break", start.plus({ days: 1 }).toJSDate());

        expect(
            await calculateTaskStreakSummary(
                IDS.user,
                services.repos.taskRepo,
                afterBreak.plus({ days: 1 }).toJSDate(),
            ),
        ).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("count a submission made before the week ended even if it was reviewed afterwards", async ({
        services,
        factories,
    }) => {
        const start = DateTime.fromISO("2026-05-04T00:00:00Z");
        await storeWeeks(factories, start, ["week-1"]);
        const end = start.plus({ days: 7 });
        await submit(factories, "week-1", end.minus({ hours: 2 }).toJSDate(), {
            status: SubmissionStatus.Gold,
            createdAt: end.plus({ hours: 2 }).toJSDate(),
        });

        expect(
            await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo, end.plus({ days: 1 }).toJSDate()),
        ).toMatchObject({ currentStreak: 1, longestStreak: 1 });
    });

    test("ignore submissions that were rejected or are still pending", async ({ services, factories }) => {
        const start = DateTime.fromISO("2026-06-01T00:00:00Z");
        await storeWeeks(factories, start, ["week-1", "week-2"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate(), { status: SubmissionStatus.Rejected });
        await submit(factories, "week-2", start.plus({ days: 8 }).toJSDate(), { status: SubmissionStatus.Pending });

        expect(
            await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo, start.plus({ days: 9 }).toJSDate()),
        ).toMatchObject({ currentStreak: 0, longestStreak: 0 });
    });
});
