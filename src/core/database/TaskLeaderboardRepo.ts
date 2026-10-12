import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository, isAlreadyExists } from "./CoreRepo.js";
import type { TaskLeaderboard, TaskLeaderboardId, TaskTierChange } from "../../models/TaskLeaderboard.js";
import type { ITaskLeaderboardRepository } from "./interfaces/ITaskLeaderboardRepo.js";
import { taskLeaderboardConverter } from "./converters.js";

export class TaskLeaderboardRepository extends GuildScopedRepository<TaskLeaderboard> implements ITaskLeaderboardRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "taskLeaderboards", taskLeaderboardConverter);
    }

    async getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null> {
        return await this.getById(id);
    }

    // Creates a leaderboard unless it already exists, so two members starting it at once don't overwrite each
    // other's points. create() fails atomically when the document is there, so no transaction is needed.
    async createLeaderboard(data: TaskLeaderboard): Promise<void> {
        try {
            await this.collection.doc(data.id).create(data);
        } catch (err) {
            if (!isAlreadyExists(err)) throw err;
        }
    }

    async updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void> {
        await this.collection.doc(id).update(data);
    }

    // Reads a leaderboard and changes it in one transaction. change decides the update from what is stored, or
    // returns null to leave it; its result is returned once the update is written.
    async updateLeaderboardWith<T>(
        id: TaskLeaderboardId,
        change: (current: TaskLeaderboard | null) => { update: Partial<TaskLeaderboard>; result: T } | null
    ): Promise<T | null> {
        const ref = this.collection.doc(id);
        return this.db.runTransaction(async (transaction) => {
            const decided = change((await transaction.get(ref)).data() ?? null);
            if (!decided) return null;
            transaction.update(ref, decided.update);
            return decided.result;
        });
    }

    async incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void> {
        await this.collection.doc(id).update({
            [`points.${userId}`]: FieldValue.increment(amount),
            updatedAt: new Date().toISOString(),
        });
    }

    // Adds a member's points for reaching a higher tier and moves their tier count from the old tier to the new
    // one, in the leaderboard itself or in its pending period
    async recordTierChange(id: TaskLeaderboardId, change: TaskTierChange, within?: "pendingPeriod"): Promise<void> {
        const prefix = within ? `${within}.` : "";
        await this.collection.doc(id).update({
            [`${prefix}points.${change.userId}`]: FieldValue.increment(change.points),
            [`${prefix}tierCounts.${change.userId}.${change.to}`]: FieldValue.increment(1),
            ...(change.from ? { [`${prefix}tierCounts.${change.userId}.${change.from}`]: FieldValue.increment(-1) } : {}),
            updatedAt: new Date().toISOString(),
        });
    }
}

