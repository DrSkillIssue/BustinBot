import { beforeEach, describe, expect, it } from 'vitest';
import { UserRepository } from '../UserRepo.js';
import { clearEmulatorFirestore, getEmulatorFirestore } from '../../../tests/firestoreEmulator.js';
import { buildUserStats } from '../../../tests/fakes/builders.js';

const db = getEmulatorFirestore();
const repo = new UserRepository(db, 'guild-1');

beforeEach(async () => {
    await clearEmulatorFirestore();
});

describe('UserRepository', () => {
    it('stores users under the guild and reads them back', async () => {
        await repo.createUser(buildUserStats({ userId: 'user-1', commandsRun: 3 }));

        expect(await repo.getUserById('user-1')).toMatchObject({ userId: 'user-1', commandsRun: 3 });
        expect(await repo.getAllUsers()).toEqual([expect.objectContaining({ userId: 'user-1' })]);
        expect((await db.doc('guilds/guild-1/userStats/user-1').get()).exists).toBe(true);
        expect(await repo.getUserById('missing')).toBeNull();
    });

    it('updates and deletes a user', async () => {
        await repo.createUser(buildUserStats({ userId: 'user-1', commandsRun: 3 }));

        await repo.updateUser('user-1', { commandsRun: 4 });
        expect(await repo.getUserById('user-1')).toMatchObject({ commandsRun: 4 });

        await repo.deleteUser('user-1');
        expect(await repo.getUserById('user-1')).toBeNull();
    });

    it('increments a stat on an existing user', async () => {
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 1);
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 2);

        expect(await repo.getUserById('user-1')).toMatchObject({ tasksCompletedBronze: 3, commandsRun: 0 });
    });

    it('moves one completion between tiers on an existing user', async () => {
        await repo.incrementStat('user-1', 'tasksCompletedBronze', 1);

        await repo.updateTierStat('user-1', 'tasksCompletedBronze', 'tasksCompletedSilver');

        expect(await repo.getUserById('user-1')).toMatchObject({ tasksCompletedBronze: 0, tasksCompletedSilver: 1 });
    });

    it('clears every user in the guild', async () => {
        await repo.createUser(buildUserStats({ userId: 'user-1' }));
        await repo.createUser(buildUserStats({ userId: 'user-2' }));

        await repo.clearAllUsers();

        expect(await repo.getAllUsers()).toEqual([]);
    });
});
