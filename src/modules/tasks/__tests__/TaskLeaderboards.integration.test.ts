import { SnowflakeUtil } from "discord.js";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import {
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    recordPeriodicTierChange,
    registerPeriodicTaskEvent,
} from "../TaskLeaderboards.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { buildTask, buildTaskEvent, buildUserStats } from "../../../tests/fakes/builders.js";
import { IDS, buttonInteraction } from "../../../tests/discord/payloads.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";

const [oldPeriodMember, overlapMember, upgradedMember] = [SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString()];

async function storeEvent(services: ServiceContainer, id: string, start: string, end: string): Promise<string> {
    await services.repos.taskRepo.createTaskEvent(
        buildTaskEvent({ id, task: buildTask({ id }), keyword: id, startTime: new Date(start), endTime: new Date(end) })
    );
    return id;
}

describe("TaskLeaderboards initialisation", () => {
    test("builds the lifetime leaderboard from stored user stats", async ({ services }) => {
        await services.repos.userRepo.createUser(buildUserStats({ userId: IDS.user, tasksCompletedGold: 1, tasksCompletedBronze: 2 }));

        await ensureTaskLeaderboardsInitialized(services);

        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({ points: { [IDS.user]: 8 } });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({ points: {}, period: { length: 4, eventIds: [], index: 1 } });
    });
});

describe("the leaderboard buttons", () => {
    test("log why the leaderboard couldn't be built and tell the member", async ({ discord, interact, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        // The emulator can't be made to fail one read, so the leaderboard read fails the way an unreachable Firestore fails it
        const unavailable = Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 });
        vi.spyOn(services.repos.taskLeaderboardRepo, "getLeaderboard").mockRejectedValueOnce(unavailable);

        const click = await interact(buttonInteraction("task-leaderboard|lifetime"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Leaderboard initialisation failed. Please use /reportbug if it continues." })]);
        expect(error).toHaveBeenCalledWith("[TaskInteractions] Failed to build the leaderboard:", unavailable);
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

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
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
        await recordPeriodicTierChange(services, "week-4", { userId: oldPeriodMember, points: 6, from: null, to: SubmissionStatus.Gold });
        await registerPeriodicTaskEvent(services, "week-5");
        await recordPeriodicTierChange(services, "week-5", { userId: overlapMember, points: 3, from: null, to: SubmissionStatus.Silver });

        const finalising = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(finalising?.points).toEqual({ [oldPeriodMember]: 6 });
        // The leaderboard starts at its first period
        const firstPeriod = 1;
        expect(finalising?.period?.index).toBe(firstPeriod);

        const finalised = await finalizePeriodicLeaderboard(services, firstPeriod);

        expect(finalised?.placements.first).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.completedPeriod?.topThree).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        expect(stored?.completedPeriod?.topTen).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        expect(stored?.period?.eventIds).toEqual(["week-5"]);
        expect(stored?.points).toEqual({ [overlapMember]: 3 });
        expect(stored?.tierCounts).toEqual({ [overlapMember]: { silver: 1 } });
        expect(await finalizePeriodicLeaderboard(services, firstPeriod)).toBeNull();
    });

    test("moves tier counts when approved submissions are upgraded", async ({ services }) => {
        await storeEvent(services, "week-1", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z");
        await storeEvent(services, "week-2", "2026-01-12T00:00:00.000Z", "2026-01-19T00:00:00.000Z");

        await ensureTaskLeaderboardsInitialized(services);
        await registerPeriodicTaskEvent(services, "week-1");
        await registerPeriodicTaskEvent(services, "week-2");
        for (const eventId of ["week-1", "week-2"]) {
            await recordPeriodicTierChange(services, eventId, { userId: upgradedMember, points: 1, from: null, to: SubmissionStatus.Bronze });
            await recordPeriodicTierChange(services, eventId, { userId: upgradedMember, points: 2, from: SubmissionStatus.Bronze, to: SubmissionStatus.Silver });
            await recordPeriodicTierChange(services, eventId, { userId: upgradedMember, points: 3, from: SubmissionStatus.Silver, to: SubmissionStatus.Gold });
        }

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [upgradedMember]: 12 });
        expect(stored?.tierCounts).toEqual({ [upgradedMember]: { bronze: 0, silver: 0, gold: 2 } });
    });
});
