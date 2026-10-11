import { GuildScopedRepository } from "./CoreRepo.js";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { IUserRepository } from "./interfaces/IUserRepo.js";
import { newUserStats, type UserStats } from "../../models/UserStats.js";
import { userStatsConverter } from "./converters.js";

export class UserRepository extends GuildScopedRepository<UserStats> implements IUserRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, 'userStats', userStatsConverter);
    }

    async getAllUsers(): Promise<UserStats[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getUserById(userId: string): Promise<UserStats | null> {
        const doc = await this.collection.doc(userId).get();
        return doc.data() ?? null;
    }

    async createUser(user: UserStats): Promise<void> {
        await this.collection.doc(user.userId).set(user);
    }

    async updateUser(userId: string, data: Partial<UserStats>): Promise<void> {
        await this.collection.doc(userId).update(data);
    }

    async deleteUser(userId: string): Promise<void> {
        await this.collection.doc(userId).delete();
    }

    async clearAllUsers(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    async incrementStat(
        userId: string,
        field: keyof UserStats,
        amount = 1
    ): Promise<void> {
        const docRef = this.collection.doc(userId);

        // Read and write in one transaction, so increments arriving together for a user with no stats yet
        // can't each create the document and overwrite one another
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);

            if (!doc.exists) {
                transaction.set(docRef, { ...newUserStats(userId, new Date()), [field]: amount });
                return;
            }

            // If exists, increment the field
            transaction.update(docRef, {
                [field]: FieldValue.increment(amount),
                lastActiveAt: new Date(),
            });
        });
    }

    async updateTierStat(
        userId: string,
        fromField: keyof UserStats,
        toField: keyof UserStats
    ): Promise<void> {
        const docRef = this.collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            await docRef.set({ ...newUserStats(userId, new Date()), [toField]: 1 });
            return;
        }

        await docRef.update({
            [fromField]: FieldValue.increment(-1),
            [toField]: FieldValue.increment(1),
            lastActiveAt: new Date(),
        });
    }

    async updateLastActive(userId: string): Promise<void> {
        await this.collection.doc(userId).update({
            lastActiveAt: new Date(),
        });
    }
}
