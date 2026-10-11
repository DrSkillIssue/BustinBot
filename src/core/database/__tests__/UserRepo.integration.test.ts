import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { UserRepository } from '../UserRepo.js';
import { buildUserStats } from '../../../tests/fakes/builders.js';
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

    test('clears every user in the guild', async ({ repo }) => {
        await repo.createUser(buildUserStats({ userId: 'user-1' }));
        await repo.createUser(buildUserStats({ userId: 'user-2' }));

        await repo.clearAllUsers();

        expect(await repo.getAllUsers()).toEqual([]);
    });
});
