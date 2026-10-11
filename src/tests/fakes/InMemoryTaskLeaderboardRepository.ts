import type { ITaskLeaderboardRepository } from "../../core/database/interfaces/ITaskLeaderboardRepo.js";
import type { TaskLeaderboard, TaskLeaderboardId } from "../../models/TaskLeaderboard.js";

// Stores each leaderboard document by id and copies on every read and write, so callers can't mutate stored state
// through a reference. Mirrors Firestore: update() and the increments reject a missing document, and update()
// rejects undefined field values (null is allowed).
export class InMemoryTaskLeaderboardRepository implements ITaskLeaderboardRepository {
    private readonly documents = new Map<TaskLeaderboardId, TaskLeaderboard>();

    async getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null> {
        const stored = this.documents.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async createLeaderboard(data: TaskLeaderboard): Promise<void> {
        this.documents.set(data.id, structuredClone(data));
    }

    async updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void> {
        const stored = this.require(id);
        for (const [field, value] of Object.entries(data)) {
            if (value === undefined) {
                throw new Error(`Cannot update leaderboard ${id}: field "${field}" is undefined`);
            }
        }
        this.documents.set(id, { ...stored, ...structuredClone(data) });
    }

    async incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void> {
        const stored = this.require(id);
        stored.points[userId] = (stored.points[userId] ?? 0) + amount;
    }

    async incrementTierCount(
        id: TaskLeaderboardId,
        userId: string,
        tier: "bronze" | "silver" | "gold",
        amount: number
    ): Promise<void> {
        const stored = this.require(id);
        stored.tierCounts ??= {};
        stored.tierCounts[userId] ??= { bronze: 0, silver: 0, gold: 0 };
        stored.tierCounts[userId][tier] += amount;
    }

    private require(id: TaskLeaderboardId): TaskLeaderboard {
        const stored = this.documents.get(id);
        if (!stored) {
            throw new Error(`Leaderboard ${id} does not exist`);
        }
        return stored;
    }
}
