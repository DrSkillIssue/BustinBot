import { orderBy } from "es-toolkit";
import type { SubmissionTier } from "./TaskSubmission.js";

export type TaskLeaderboardId = "lifetime" | "periodic";

export interface TaskLeaderboardEntry {
    userId: string;
    points: number;
}

export interface TaskTierCounts {
    bronze?: number;
    silver?: number;
    gold?: number;
}

export interface TaskTierChange {
    userId: string;
    points: number;
    from: SubmissionTier | null;
    to: SubmissionTier;
}

export interface TaskLeaderboardPeriod {
    length: number;
    eventIds: string[];
    startedAt: string;
    index: number;
}

export interface TaskLeaderboardCompletedPeriod {
    index: number;
    eventIds: string[];
    endedAt: string;
    topThree: TaskLeaderboardEntry[];
    topTen?: TaskLeaderboardEntry[];
    tierCounts?: Record<string, TaskTierCounts>;
}

export interface TaskLeaderboardPendingPeriod {
    period: TaskLeaderboardPeriod;
    points: Record<string, number>;
    tierCounts?: Record<string, TaskTierCounts>;
}

export interface TaskLeaderboardChampions {
    first?: string[];
    second?: string[];
    third?: string[];
    awardedAt?: string;
    periodIndex?: number;
}

export interface TaskLeaderboard {
    id: TaskLeaderboardId;
    points: Record<string, number>;
    tierCounts?: Record<string, TaskTierCounts>;
    createdAt: string;
    updatedAt: string;
    period?: TaskLeaderboardPeriod;
    completedPeriod?: TaskLeaderboardCompletedPeriod;
    pendingPeriod?: TaskLeaderboardPendingPeriod | null;
    champions?: TaskLeaderboardChampions;
}

export type RankedEntry<T extends TaskLeaderboardEntry = TaskLeaderboardEntry> = T & { rank: number };

export type LifetimeEntry = TaskLeaderboardEntry & { currentStreak: number };

export interface PeriodicPlacements {
    first: TaskLeaderboardEntry[];
    second: TaskLeaderboardEntry[];
    third: TaskLeaderboardEntry[];
    winners: TaskLeaderboardEntry[];
}

export interface FinalisedPeriod {
    completed: TaskLeaderboardCompletedPeriod;
    placements: PeriodicPlacements;
}

export function newPeriod(length: number, index: number, startedAt: string): TaskLeaderboardPeriod {
    return { length, eventIds: [], startedAt, index };
}

export function leaderboardEntries(points: Record<string, number>): TaskLeaderboardEntry[] {
    return Object.entries(points).flatMap(([userId, memberPoints]) => (memberPoints > 0 ? [{ userId, points: memberPoints }] : []));
}

function applyRanks<T extends TaskLeaderboardEntry>(sorted: T[], tieKey: (entry: T) => string): RankedEntry<T>[] {
    let rank = 0;
    let lastKey: string | null = null;
    return sorted.map((entry, index) => {
        const key = tieKey(entry);
        if (key !== lastKey) {
            rank = index + 1;
            lastKey = key;
        }
        return { ...entry, rank };
    });
}

export function rankPeriodicEntries(entries: TaskLeaderboardEntry[]): RankedEntry[] {
    return applyRanks(orderBy(entries, ["points", "userId"], ["desc", "asc"]), (entry) => `${entry.points}`);
}

export function rankLifetimeEntries(entries: LifetimeEntry[]): RankedEntry<LifetimeEntry>[] {
    return applyRanks(
        orderBy(entries, ["points", "currentStreak", "userId"], ["desc", "desc", "asc"]),
        (entry) => `${entry.points}|${entry.currentStreak}`
    );
}

export function resolvePeriodicPlacements(ranked: RankedEntry[]): PeriodicPlacements {
    const placed = (rank: number) => ranked.filter((entry) => entry.rank === rank).map(({ userId, points }) => ({ userId, points }));
    const [first, second, third] = [placed(1), placed(2), placed(3)];
    return { first, second, third, winners: [...first, ...second, ...third] };
}
