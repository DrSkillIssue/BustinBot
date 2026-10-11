import type { SubmissionTier } from "./TaskSubmission.js";

export type TaskLeaderboardId = "lifetime" | "periodic";

export interface TaskLeaderboardEntry {
    userId: string;
    points: number;
}

export interface TaskTierCounts {
    bronze: number;
    silver: number;
    gold: number;
}

// A member reaching a higher tier on a task: the points it adds and the tier it replaces, if they held one
export interface TaskTierChange {
    userId: string;
    points: number;
    from: SubmissionTier | null;
    to: SubmissionTier;
}

// One leaderboard period: a run of weekly task events whose points count towards the same standings
export interface TaskLeaderboardPeriod {
    // How many weeks of task events the period lasts
    length: number;
    // The task events registered in it so far
    eventIds: string[];
    startedAt: string;
    // Which period this is: 1 for the guild's first, counting up as each one ends
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
