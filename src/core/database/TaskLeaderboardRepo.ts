import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import {
    leaderboardEntries,
    rankPeriodicEntries,
    resolvePeriodicPlacements,
    type FinalisedPeriod,
    type TaskLeaderboard,
    type TaskLeaderboardCompletedPeriod,
    type TaskLeaderboardId,
    type TaskTierChange,
} from "../../models/TaskLeaderboard.js";
import type { ITaskLeaderboardRepository } from "./interfaces/ITaskLeaderboardRepo.js";
import { taskLeaderboardConverter } from "./converters.js";

export class TaskLeaderboardRepository extends GuildScopedRepository<TaskLeaderboard> implements ITaskLeaderboardRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "taskLeaderboards", taskLeaderboardConverter);
    }

    async getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null> {
        return await this.getById(id);
    }

    async createLeaderboard(data: TaskLeaderboard): Promise<void> {
        const ref = this.collection.doc(data.id);
        await this.db.runTransaction(async (transaction) => {
            if ((await transaction.get(ref)).exists) return;
            transaction.create(ref, data);
        });
    }

    async updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void> {
        await this.collection.doc(id).update(data);
    }

    async endPeriod(periodIndex: number, nextLength: number): Promise<FinalisedPeriod | null> {
        const ref = this.collection.doc("periodic");
        return this.db.runTransaction(async (transaction) => {
            const leaderboard = (await transaction.get(ref)).data();
            if (!leaderboard?.period || leaderboard.period.index !== periodIndex) return null;

            const now = new Date().toISOString();
            const ranked = rankPeriodicEntries(leaderboardEntries(leaderboard.points));
            const placements = resolvePeriodicPlacements(ranked);
            const completed: TaskLeaderboardCompletedPeriod = {
                index: periodIndex,
                eventIds: leaderboard.period.eventIds,
                endedAt: now,
                topThree: placements.winners,
                topTen: ranked.slice(0, 10).map(({ userId, points }) => ({ userId, points })),
                tierCounts: leaderboard.tierCounts ?? {},
            };
            const pending = leaderboard.pendingPeriod;
            transaction.update(ref, {
                completedPeriod: completed,
                period: {
                    length: pending?.period.length ?? nextLength,
                    eventIds: pending?.period.eventIds ?? [],
                    startedAt: pending?.period.startedAt ?? now,
                    index: periodIndex + 1,
                },
                points: pending?.points ?? {},
                tierCounts: pending?.tierCounts ?? {},
                pendingPeriod: null,
                updatedAt: now,
            });
            return { completed, placements };
        });
    }

    async incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void> {
        await this.collection.doc(id).update({
            [`points.${userId}`]: FieldValue.increment(amount),
            updatedAt: new Date().toISOString(),
        });
    }

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

