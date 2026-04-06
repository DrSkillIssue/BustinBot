import { describe, it, expect, vi } from "vitest";
import { calculateTaskStreakSummary } from "../TaskStreaks.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(id: string, start: Date, end: Date) {
    return {
        id,
        startTime: start,
        endTime: end,
    } as any;
}

function makeSubmission(eventId: string, submittedAt: Date, status = SubmissionStatus.Bronze) {
    return {
        userId: "user-1",
        taskEventId: eventId,
        status,
        createdAt: new Date(submittedAt.getTime()),
        submittedAt,
    } as any;
}

function buildRepo(params: {
    latestEventId?: string;
    events: Record<string, any>;
    submissions: any[];
}) {
    const eventsArray = Object.values(params.events);
    return {
        getLatestTaskEvent: vi.fn(async () => (params.latestEventId ? params.events[params.latestEventId] : null)),
        getSubmissionsByUser: vi.fn(async () => params.submissions),
        getTaskEventById: vi.fn(async (id: string) => params.events[id] ?? null),
        getTaskEventsBetween: vi.fn(async (start: Date, end: Date) =>
            eventsArray.filter((event: any) => event.endTime >= start && event.endTime <= end)
        ),
    } as any;
}

describe("Task streaks", () => {
    it("establishes a streak when the current period is completed", async () => {
        const start = new Date("2025-01-01T00:00:00Z");
        const end = new Date(start.getTime() + 7 * DAY_MS);
        const event = makeEvent("event-1", start, end);
        const repo = buildRepo({
            latestEventId: "event-1",
            events: { "event-1": event },
            submissions: [makeSubmission("event-1", new Date(start.getTime() + DAY_MS))],
        });

        const summary = await calculateTaskStreakSummary("user-1", repo, new Date(start.getTime() + 2 * DAY_MS));

        expect(summary.currentStreak).toBe(1);
        expect(summary.longestStreak).toBe(1);
        expect(summary.hasCompletedCurrentPeriod).toBe(true);
    });

    it("continues streaks across consecutive periods", async () => {
        const start = new Date("2025-02-01T00:00:00Z");
        const event1 = makeEvent("event-1", start, new Date(start.getTime() + 7 * DAY_MS));
        const event2 = makeEvent(
            "event-2",
            new Date(start.getTime() + 7 * DAY_MS),
            new Date(start.getTime() + 14 * DAY_MS)
        );

        const repo = buildRepo({
            latestEventId: "event-2",
            events: { "event-1": event1, "event-2": event2 },
            submissions: [
                makeSubmission("event-1", new Date(start.getTime() + DAY_MS)),
                makeSubmission("event-2", new Date(start.getTime() + 8 * DAY_MS)),
            ],
        });

        const summary = await calculateTaskStreakSummary("user-1", repo, new Date(start.getTime() + 8 * DAY_MS));

        expect(summary.currentStreak).toBe(2);
        expect(summary.longestStreak).toBe(2);
        expect(summary.hasCompletedCurrentPeriod).toBe(true);
    });

    it("breaks streaks when a period is missed", async () => {
        const start = new Date("2025-03-01T00:00:00Z");
        const event1 = makeEvent("event-1", start, new Date(start.getTime() + 7 * DAY_MS));
        const event2 = makeEvent(
            "event-2",
            new Date(start.getTime() + 7 * DAY_MS),
            new Date(start.getTime() + 14 * DAY_MS)
        );
        const event3 = makeEvent(
            "event-3",
            new Date(start.getTime() + 14 * DAY_MS),
            new Date(start.getTime() + 21 * DAY_MS)
        );

        const repo = buildRepo({
            latestEventId: "event-3",
            events: { "event-1": event1, "event-2": event2, "event-3": event3 },
            submissions: [makeSubmission("event-1", new Date(start.getTime() + DAY_MS))],
        });

        const summary = await calculateTaskStreakSummary("user-1", repo, new Date(start.getTime() + 16 * DAY_MS));

        expect(summary.currentStreak).toBe(0);
        expect(summary.longestStreak).toBe(1);
        expect(summary.hasCompletedCurrentPeriod).toBe(false);
    });

    it("preserves streaks when no task events occur between periods", async () => {
        const start = new Date("2025-04-01T00:00:00Z");
        const event1 = makeEvent("event-1", start, new Date(start.getTime() + 7 * DAY_MS));
        const gapStart = new Date(start.getTime() + 35 * DAY_MS);
        const event2 = makeEvent("event-2", gapStart, new Date(gapStart.getTime() + 7 * DAY_MS));

        const repo = buildRepo({
            latestEventId: "event-2",
            events: { "event-1": event1, "event-2": event2 },
            submissions: [makeSubmission("event-1", new Date(start.getTime() + DAY_MS))],
        });

        const summary = await calculateTaskStreakSummary("user-1", repo, new Date(gapStart.getTime() + DAY_MS));

        expect(summary.currentStreak).toBe(1);
        expect(summary.longestStreak).toBe(1);
        expect(summary.hasCompletedCurrentPeriod).toBe(false);
    });

    it("counts submissions made before period end even if approved after closure", async () => {
        const start = new Date("2025-05-01T00:00:00Z");
        const end = new Date(start.getTime() + 7 * DAY_MS);
        const event = makeEvent("event-1", start, end);
        const submittedAt = new Date(end.getTime() - 2 * 60 * 60 * 1000);
        const createdLate = new Date(end.getTime() + 2 * 60 * 60 * 1000);

        const repo = buildRepo({
            events: { "event-1": event },
            submissions: [
                {
                    userId: "user-1",
                    taskEventId: "event-1",
                    status: SubmissionStatus.Gold,
                    createdAt: createdLate,
                    submittedAt,
                } as any,
            ],
        });

        const summary = await calculateTaskStreakSummary("user-1", repo, new Date(end.getTime() + DAY_MS));

        expect(summary.currentStreak).toBe(1);
        expect(summary.longestStreak).toBe(1);
    });
});
