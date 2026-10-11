import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { UserRepository } from '../UserRepo.js';
import { buildUserStats } from '../../../tests/fakes/builders.js';
import { newUserStats } from '../../../models/UserStats.js';
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from '../../../tests/firestoreEmulator.js';

const test = base.extend('repo', ({ db }) => new UserRepository(db, 'guild-1'));

describe('UserRepository', () => {
    test('stores users under the guild and reads them back', async ({ repo, db }) => {
        await repo.createUser(buildUserStats({ userId: 'user-1', commandsRun: 3 }));

        expect(await repo.getUserById('user-1')).toMatchObject({ userId: 'user-1', commandsRun: 3 });
        expect(await repo.getAllUsers()).toEqual([expect.objectContaining({ userId: 'user-1' })]);
        expect((await db.doc('guilds/guild-1/userStats/user-1').get()).exists).toBe(true);
        expect(await repo.getUserById('missing')).toBeNull();
    });

    test('updates and deletes a user', async ({ repo }) => {
        await repo.createUser(buildUserStats({ userId: 'user-1', commandsRun: 3 }));

        await repo.updateUser('user-1', { commandsRun: 4 });
        expect(await repo.getUserById('user-1')).toMatchObject({ commandsRun: 4 });

        await repo.deleteUser('user-1');
        expect(await repo.getUserById('user-1')).toBeNull();
    });

    test('increments a stat on an existing user', async ({ repo }) => {
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 1);
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 2);

        expect(await repo.getUserById('user-1')).toMatchObject({ tasksCompletedBronze: 3, commandsRun: 0 });
    });

    test('counts every increment when several arrive at once for a user with no stats yet', async ({ repo }) => {
        await Promise.all([
            repo.incrementStat('user-1', 'commandsRun', 1),
            repo.incrementStat('user-1', 'commandsRun', 1),
            repo.incrementStat('user-1', 'commandsRun', 1),
        ]);

        expect(await repo.getUserById('user-1')).toMatchObject({ commandsRun: 3 });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('moves one completion between tiers on an existing user', async ({ repo }) => {
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 1);

        await repo.updateTierStat('user-1', 'tasksCompletedBronze', 'tasksCompletedSilver');

        expect(await repo.getUserById('user-1')).toMatchObject({ tasksCompletedBronze: 0, tasksCompletedSilver: 1 });
    });

    test('keeps a tier move and an increment made at the same moment for a user with no stats yet', async ({ repo }) => {
        await Promise.all([
            repo.updateTierStat('user-1', 'tasksCompletedBronze', 'tasksCompletedSilver'),
            repo.incrementStat('user-1', 'tasksCompletedGold', 1),
        ]);

        expect(await repo.getUserById('user-1')).toMatchObject({ tasksCompletedSilver: 1, tasksCompletedGold: 1 });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('clears every user in the guild', async ({ repo }) => {
        await repo.createUser(buildUserStats({ userId: 'user-1' }));
        await repo.createUser(buildUserStats({ userId: 'user-2' }));

        await repo.clearAllUsers();

        expect(await repo.getAllUsers()).toEqual([]);
    });

    test('reads a user back exactly as stored', async ({ repo }) => {
        const user = buildUserStats({ userId: 'user-1', commandsRun: 3, lastActiveAt: new Date('2026-01-07T00:00:00.000Z') });
        await repo.createUser(user);

        expect(await repo.getUserById('user-1')).toEqual(user);
    });

    test('reads a member created by the legacy completion import as a full set of stats', async ({ repo, db }) => {
        // The shape src/scripts/importLegacySubmissions.ts wrote before it stored complete stats
        const importedAt = new Date('2025-10-29T00:00:00.000Z');
        await db.doc('guilds/guild-1/userStats/legacy-user').set({ userId: 'legacy-user', legacyTasksCompleted: 12, createdAt: importedAt });

        expect(await repo.getUserById('legacy-user')).toEqual({ ...newUserStats('legacy-user', importedAt), legacyTasksCompleted: 12 });
    });
});
