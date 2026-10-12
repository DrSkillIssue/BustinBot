import { SnowflakeUtil } from "discord.js";
import { test as base, describe, expect } from "../../../fixtures.js";
import { IDS } from "../../../discord/payloads.js";
import { UserRepository } from "../../../../src/core/database/UserRepo.js";
import { userStatsFactory } from "../../../factories.js";
import { newUserStats } from "../../../../src/models/UserStats.js";

const test = base.extend("repo", ({ db }) => new UserRepository(db, IDS.guild));
const otherUser = SnowflakeUtil.generate().toString();
const legacyUser = SnowflakeUtil.generate().toString();

describe("UserRepository", () => {
    test("stores users under the guild and reads them back", async ({ repo, db }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user, commandsRun: 3 }));

        expect(await repo.getUserById(IDS.user)).toMatchObject({ userId: IDS.user, commandsRun: 3 });
        expect(await repo.getAllUsers()).toEqual([expect.objectContaining({ userId: IDS.user })]);
        expect((await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get()).exists).toBe(true);
        expect(await repo.getUserById("missing")).toBeNull();
    });

    test("updates and deletes a user", async ({ repo }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user, commandsRun: 3 }));

        await repo.updateUser(IDS.user, { commandsRun: 4 });
        expect(await repo.getUserById(IDS.user)).toMatchObject({ commandsRun: 4 });

        await repo.deleteUser(IDS.user);
        expect(await repo.getUserById(IDS.user)).toBeNull();
    });

    test("increments a stat on an existing user", async ({ repo }) => {
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 1);
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 2);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 3, commandsRun: 0 });
    });

    test("counts every increment when several arrive at once for a user with no stats yet", async ({ repo }) => {
        await Promise.all([
            repo.incrementStat(IDS.user, "commandsRun", 1),
            repo.incrementStat(IDS.user, "commandsRun", 1),
            repo.incrementStat(IDS.user, "commandsRun", 1),
        ]);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ commandsRun: 3 });
    });

    test("moves one completion between tiers on an existing user", async ({ repo }) => {
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 1);

        await repo.updateTierStat(IDS.user, "tasksCompletedBronze", "tasksCompletedSilver");

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 0, tasksCompletedSilver: 1 });
    });

    test("keeps a tier move and an increment made at the same moment for a user with no stats yet", async ({
        repo,
    }) => {
        await Promise.all([
            repo.updateTierStat(IDS.user, "tasksCompletedBronze", "tasksCompletedSilver"),
            repo.incrementStat(IDS.user, "tasksCompletedGold", 1),
        ]);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedSilver: 1, tasksCompletedGold: 1 });
    });

    test("clears every user in the guild", async ({ repo }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user }));
        await repo.createUser(userStatsFactory.build({ userId: otherUser }));

        await repo.clearAllUsers();

        expect(await repo.getAllUsers()).toEqual([]);
    });

    test("reads a user back exactly as stored", async ({ repo }) => {
        const user = userStatsFactory.build({
            userId: IDS.user,
            commandsRun: 3,
            lastActiveAt: new Date("2026-01-07T00:00:00.000Z"),
        });
        await repo.createUser(user);

        expect(await repo.getUserById(IDS.user)).toEqual(user);
    });

    test("reads a member created by the legacy completion import as a full set of stats", async ({ repo, db }) => {
        // The shape src/scripts/importLegacySubmissions.ts wrote before it stored complete stats
        const importedAt = new Date("2025-10-29T00:00:00.000Z");
        await db
            .doc(`guilds/${IDS.guild}/userStats/${legacyUser}`)
            .set({ userId: legacyUser, legacyTasksCompleted: 12, createdAt: importedAt });

        expect(await repo.getUserById(legacyUser)).toEqual({
            ...newUserStats(legacyUser, importedAt),
            legacyTasksCompleted: 12,
        });
    });
});
