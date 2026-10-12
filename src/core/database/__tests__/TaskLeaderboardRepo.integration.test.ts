import { SnowflakeUtil } from "discord.js";
import { test as base, describe, expect } from "../../../tests/fixtures.js";
import {
    leaderboardPeriodFactory,
    lifetimeLeaderboardFactory,
    periodicLeaderboardFactory,
} from "../../../tests/factories.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { TaskLeaderboardRepository } from "../TaskLeaderboardRepo.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";

const test = base.extend("repo", ({ db }) => new TaskLeaderboardRepository(db, IDS.guild));

describe("TaskLeaderboardRepository", () => {
    test("stores lifetime and periodic leaderboards as separate documents", async ({ repo }) => {
        await repo.createLeaderboard(lifetimeLeaderboardFactory.build({ points: { [IDS.user]: 10 } }));
        await repo.createLeaderboard(periodicLeaderboardFactory.build({ points: { [IDS.user]: 3 } }));

        expect(await repo.getLeaderboard("lifetime")).toMatchObject({ points: { [IDS.user]: 10 } });
        expect(await repo.getLeaderboard("periodic")).toMatchObject({ points: { [IDS.user]: 3 } });
    });

    test("replaces whole score maps on update so stale scores are cleared", async ({ repo }) => {
        await repo.createLeaderboard(
            periodicLeaderboardFactory.build({ points: { [SnowflakeUtil.generate().toString()]: 6, [IDS.user]: 1 } }),
        );

        await repo.updateLeaderboard("periodic", { points: { [IDS.user]: 3 }, pendingPeriod: null });

        const stored = await repo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [IDS.user]: 3 });
        expect(stored?.pendingPeriod).toBeNull();
    });

    test("keeps a leaderboard that already exists when asked to create it", async ({ repo }) => {
        await repo.createLeaderboard(periodicLeaderboardFactory.build({ points: { [IDS.user]: 3 } }));

        await repo.createLeaderboard(periodicLeaderboardFactory.build());

        expect(await repo.getLeaderboard("periodic")).toMatchObject({ points: { [IDS.user]: 3 } });
    });

    test("adds points and moves tier counts when a member reaches a higher tier", async ({ repo }) => {
        await repo.createLeaderboard(periodicLeaderboardFactory.build());

        await repo.incrementPoints("periodic", IDS.user, 3);
        await repo.recordTierChange("periodic", {
            userId: IDS.user,
            points: 1,
            from: null,
            to: SubmissionStatus.Bronze,
        });
        await repo.recordTierChange("periodic", {
            userId: IDS.user,
            points: 2,
            from: SubmissionStatus.Bronze,
            to: SubmissionStatus.Silver,
        });

        expect(await repo.getLeaderboard("periodic")).toMatchObject({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { bronze: 0, silver: 1 } },
        });
    });

    test("records a tier change in the pending period", async ({ repo }) => {
        // The period after the current one, which task events join once the current one is full
        const period = leaderboardPeriodFactory.build({
            eventIds: ["week-5"],
            startedAt: "2026-02-02T00:00:00.000Z",
            index: 2,
        });
        await repo.createLeaderboard(
            periodicLeaderboardFactory.build({ pendingPeriod: { period, points: {}, tierCounts: {} } }),
        );

        await repo.recordTierChange(
            "periodic",
            { userId: IDS.user, points: 6, from: null, to: SubmissionStatus.Gold },
            "pendingPeriod",
        );

        expect(await repo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            pendingPeriod: { period, points: { [IDS.user]: 6 }, tierCounts: { [IDS.user]: { gold: 1 } } },
        });
    });

    test("rejects changes to a leaderboard that does not exist", async ({ repo }) => {
        await expect(repo.incrementPoints("periodic", IDS.user, 1)).rejects.toThrow();
        await expect(repo.updateLeaderboard("periodic", { points: {} })).rejects.toThrow();
    });
});
