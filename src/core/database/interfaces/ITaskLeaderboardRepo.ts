import type { TaskLeaderboard, TaskLeaderboardId } from "../../../models/TaskLeaderboard.js";

export interface ITaskLeaderboardRepository {
    getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null>;
    createLeaderboard(data: TaskLeaderboard): Promise<void>;
    updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void>;
    updateLeaderboardWith<T>(
        id: TaskLeaderboardId,
        change: (current: TaskLeaderboard | null) => { update: Partial<TaskLeaderboard>; result: T } | null
    ): Promise<T | null>;
    incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void>;
    incrementTierCount(
        id: TaskLeaderboardId,
        userId: string,
        tier: "bronze" | "silver" | "gold",
        amount: number
    ): Promise<void>;
}
