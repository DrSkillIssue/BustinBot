import { describe, expect, test } from "vitest";
import {
    buildRankedLifetimeEntries,
    buildRankedPeriodicEntries,
    resolvePeriodicPlacements,
} from "../../../../src/modules/tasks/TaskLeaderboards.js";

describe("TaskLeaderboards ranking", () => {
    test("orders lifetime leaderboard by points then current streak", () => {
        const points = { alice: 10, bob: 10, carol: 8 };
        const streaks = { alice: 2, bob: 5, carol: 1 };

        const ranked = buildRankedLifetimeEntries(points, streaks);
        expect(ranked[0]?.userId).toBe("bob");
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.userId).toBe("alice");
        expect(ranked[1]?.rank).toBe(2);
    });

    test("assigns equal ranks when points and streak are tied", () => {
        const points = { alice: 10, bob: 10 };
        const streaks = { alice: 3, bob: 3 };

        const ranked = buildRankedLifetimeEntries(points, streaks);
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
    });

    test("assigns equal ranks for periodic ties", () => {
        const points = { alice: 10, bob: 10, carol: 8 };
        const ranked = buildRankedPeriodicEntries(points);

        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
        expect(ranked[2]?.rank).toBe(3);
    });
});

describe("TaskLeaderboards placements", () => {
    test("skips second place when there is a tie for first", () => {
        const placements = resolvePeriodicPlacements([
            { userId: "a", points: 10 },
            { userId: "b", points: 10 },
            { userId: "c", points: 8 },
        ]);

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a", "b"]);
        expect(placements.second).toHaveLength(0);
        expect(placements.third.map((entry) => entry.userId)).toEqual(["c"]);
    });

    test("skips third place when there is a tie for second", () => {
        const placements = resolvePeriodicPlacements([
            { userId: "a", points: 12 },
            { userId: "b", points: 9 },
            { userId: "c", points: 9 },
            { userId: "d", points: 7 },
        ]);

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a"]);
        expect(placements.second.map((entry) => entry.userId)).toEqual(["b", "c"]);
        expect(placements.third).toHaveLength(0);
    });
});
