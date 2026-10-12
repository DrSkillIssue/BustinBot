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
        // One write with no read: Firestore applies the increment itself, creating the member's stats document
        // with the field set to `amount` when it doesn't exist yet, so increments arriving together are all counted.
        // The other counts read as zero until set, and joinedAt is the document's creation time (userStatsConverter).
        await this.collection.doc(userId).set(
            { userId, [field]: FieldValue.increment(amount), lastActiveAt: new Date() },
            { merge: true },
        );
    }

    // Moves a member's task completion from one tier to the higher one they reached. It reads the member's stats in a
    // transaction because a member with no stats yet gets the new tier set to 1 rather than -1 on the old one, which a
    // single write can't decide; it only runs when an admin approves a higher tier.
    async updateTierStat(
        userId: string,
        fromField: keyof UserStats,
        toField: keyof UserStats
    ): Promise<void> {
        const docRef = this.collection.doc(userId);

        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);

            if (!doc.exists) {
                transaction.set(docRef, { ...newUserStats(userId, new Date()), [toField]: 1 });
                return;
            }

            transaction.update(docRef, {
                [fromField]: FieldValue.increment(-1),
                [toField]: FieldValue.increment(1),
                lastActiveAt: new Date(),
            });
        });
    }

    async updateLastActive(userId: string): Promise<void> {
        await this.collection.doc(userId).update({
            lastActiveAt: new Date(),
        });
    }
}
