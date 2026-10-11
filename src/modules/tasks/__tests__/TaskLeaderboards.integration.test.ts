import { afterEach, beforeEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import {
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    incrementPeriodicPoints,
    registerPeriodicTaskEvent,
} from "../TaskLeaderboards.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import type { TaskLeaderboard } from "../../../models/TaskLeaderboard.js";
import { buildTask, buildTaskEvent, buildUserStats } from "../../../tests/fakes/builders.js";

async function storeEvent(services: ServiceContainer, id: string, start: string, end: string): Promise<string> {
    await services.repos.taskRepo!.createTaskEvent(
        buildTaskEvent({ id, task: buildTask({ id }), keyword: id, startTime: new Date(start), endTime: new Date(end) })
    );
    return id;
}

async function periodic(services: ServiceContainer): Promise<TaskLeaderboard | null> {
    return services.repos.taskLeaderboardRepo!.getLeaderboard("periodic");
}

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("TaskLeaderboards initialisation", () => {
    test("builds the lifetime leaderboard from stored user stats", async ({ services }) => {
        await services.repos.userRepo!.createUser(buildUserStats({ userId: "user-1", tasksCompletedGold: 1, tasksCompletedBronze: 2 }));

        await ensureTaskLeaderboardsInitialized(services);

        expect(await services.repos.taskLeaderboardRepo!.getLeaderboard("lifetime")).toMatchObject({ points: { "user-1": 8 } });
        expect(await periodic(services)).toMatchObject({ points: {}, period: { length: 4, eventIds: [], index: 1 } });
    });

    test("throws when user stats are unavailable", async ({ services }) => {
        delete services.repos.userRepo;

        await expect(ensureTaskLeaderboardsInitialized(services)).rejects.toThrow("Leaderboard initialisation failed");
    });
});

describe("TaskLeaderboards periodic submissions", () => {
    test("keeps every category event from the fourth week in the completing period", async ({ services }) => {
        const eventIds: string[] = [];
        for (const week of [1, 2, 3]) {
            for (const category of ["pvm", "skilling", "minigame"]) {
                eventIds.push(await storeEvent(
                    services,
                    `week-${week}-${category}`,
                    `2026-01-${String(week * 7 - 2).padStart(2, "0")}T00:00:00.000Z`,
                    `2026-01-${String(week * 7 + 5).padStart(2, "0")}T00:00:00.000Z`
                ));
            }
        }
        for (const category of ["pvm", "skilling", "minigame"]) {
            eventIds.push(await storeEvent(services, `week-4-${category}`, "2026-01-26T00:00:00.000Z", "2026-02-02T00:00:00.000Z"));
        }
        eventIds.push(await storeEvent(services, "week-5-pvm", "2026-02-02T00:00:00.000Z", "2026-02-09T00:00:00.000Z"));

        await ensureTaskLeaderboardsInitialized(services);
        for (const eventId of eventIds) {
            await registerPeriodicTaskEvent(services, eventId);
        }

        const stored = await periodic(services);
        expect(stored?.period?.eventIds).toEqual(eventIds.slice(0, 12));
        expect(stored?.pendingPeriod?.period.eventIds).toEqual(["week-5-pvm"]);
    });

    test("carries approved submissions from the overlap into the following period", async ({ services }) => {
        const weeks = [
            ["week-1", "2026-01-05", "2026-01-12"],
            ["week-2", "2026-01-12", "2026-01-19"],
            ["week-3", "2026-01-19", "2026-01-26"],
            ["week-4", "2026-01-26", "2026-02-02"],
            ["week-5", "2026-02-02", "2026-02-09"],
        ] as const;
        for (const [id, start, end] of weeks) {
            await storeEvent(services, id, `${start}T00:00:00.000Z`, `${end}T00:00:00.000Z`);
        }

        await ensureTaskLeaderboardsInitialized(services);
        for (const [id] of weeks.slice(0, 4)) {
            await registerPeriodicTaskEvent(services, id);
        }
        await incrementPeriodicPoints(services, "old-period-user", 6, "week-4", "gold");
        await registerPeriodicTaskEvent(services, "week-5");
        await incrementPeriodicPoints(services, "overlap-user", 3, "week-5", "silver");

        const finalising = await periodic(services);
        expect(finalising?.points).toEqual({ "old-period-user": 6 });

        await finalizePeriodicLeaderboard(services, finalising!, [{ userId: "old-period-user", points: 6 }]);

        const stored = await periodic(services);
        expect(stored?.completedPeriod?.topTen).toEqual([{ userId: "old-period-user", points: 6 }]);
        expect(stored?.period?.eventIds).toEqual(["week-5"]);
        expect(stored?.points).toEqual({ "overlap-user": 3 });
        expect(stored?.tierCounts).toEqual({ "overlap-user": { bronze: 0, silver: 1, gold: 0 } });
    });

    test("moves tier counts when approved submissions are upgraded", async ({ services }) => {
        await storeEvent(services, "week-1", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z");
        await storeEvent(services, "week-2", "2026-01-12T00:00:00.000Z", "2026-01-19T00:00:00.000Z");

        await ensureTaskLeaderboardsInitialized(services);
        await registerPeriodicTaskEvent(services, "week-1");
        await registerPeriodicTaskEvent(services, "week-2");
        for (const eventId of ["week-1", "week-2"]) {
            await incrementPeriodicPoints(services, "upgraded-user", 1, eventId, "bronze");
            await incrementPeriodicPoints(services, "upgraded-user", 2, eventId, "silver");
            await incrementPeriodicPoints(services, "upgraded-user", 3, eventId, "gold");
        }

        const stored = await periodic(services);
        expect(stored?.points).toEqual({ "upgraded-user": 12 });
        expect(stored?.tierCounts).toEqual({ "upgraded-user": { bronze: 0, silver: 0, gold: 2 } });
    });
});
