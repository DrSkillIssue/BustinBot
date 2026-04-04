import type { TaskLeaderboard, TaskLeaderboardId } from "../../../models/TaskLeaderboard.js";

export interface ITaskLeaderboardRepository {
    getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null>;
    createLeaderboard(data: TaskLeaderboard): Promise<void>;
    updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void>;
    incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void>;
    incrementTierCount(
        id: TaskLeaderboardId,
        userId: string,
        tier: "bronze" | "silver" | "gold",
        amount: number
    ): Promise<void>;
}
