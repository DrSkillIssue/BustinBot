import type { FinalisedPeriod, TaskLeaderboard, TaskLeaderboardId, TaskTierChange } from "../../../models/TaskLeaderboard.js";

export interface ITaskLeaderboardRepository {
    getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null>;
    createLeaderboard(data: TaskLeaderboard): Promise<void>;
    updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void>;
    endPeriod(periodIndex: number, nextLength: number): Promise<FinalisedPeriod | null>;
    incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void>;
    recordTierChange(id: TaskLeaderboardId, change: TaskTierChange, within?: "pendingPeriod"): Promise<void>;
}
