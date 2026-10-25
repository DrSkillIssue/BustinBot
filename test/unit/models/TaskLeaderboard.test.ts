import { describe, expect, test } from "vitest";
import {
    leaderboardEntries,
    rankLifetimeEntries,
    rankPeriodicEntries,
    resolvePeriodicPlacements,
} from "../../../src/models/TaskLeaderboard.js";

describe("leaderboard ranking", () => {
    test("orders lifetime leaderboard by points then current streak", () => {
        const ranked = rankLifetimeEntries([
            { userId: "alice", points: 10, currentStreak: 2 },
            { userId: "bob", points: 10, currentStreak: 5 },
            { userId: "carol", points: 8, currentStreak: 1 },
        ]);
        expect(ranked[0]?.userId).toBe("bob");
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.userId).toBe("alice");
        expect(ranked[1]?.rank).toBe(2);
    });

    test("assigns equal ranks when points and streak are tied", () => {
        const ranked = rankLifetimeEntries([
            { userId: "alice", points: 10, currentStreak: 3 },
            { userId: "bob", points: 10, currentStreak: 3 },
        ]);
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
    });

    test("assigns equal ranks for periodic ties", () => {
        const ranked = rankPeriodicEntries(leaderboardEntries({ alice: 10, bob: 10, carol: 8 }));

        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
        expect(ranked[2]?.rank).toBe(3);
    });
});

describe("period placements", () => {
    test("skips second place when there is a tie for first", () => {
        const placements = resolvePeriodicPlacements(rankPeriodicEntries(leaderboardEntries({ a: 10, b: 10, c: 8 })));

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a", "b"]);
        expect(placements.second).toHaveLength(0);
        expect(placements.third.map((entry) => entry.userId)).toEqual(["c"]);
    });

    test("skips third place when there is a tie for second", () => {
        const placements = resolvePeriodicPlacements(
            rankPeriodicEntries(leaderboardEntries({ a: 12, b: 9, c: 9, d: 7 })),
        );

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a"]);
        expect(placements.second.map((entry) => entry.userId)).toEqual(["b", "c"]);
        expect(placements.third).toHaveLength(0);
    });
});
