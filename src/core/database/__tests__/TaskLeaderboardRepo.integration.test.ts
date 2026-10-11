import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { TaskLeaderboardRepository } from '../TaskLeaderboardRepo.js';
import type { TaskLeaderboard } from '../../../models/TaskLeaderboard.js';

const test = base.extend('repo', ({ db }) => new TaskLeaderboardRepository(db, 'guild-1'));

function buildLeaderboard(overrides: Partial<TaskLeaderboard> = {}): TaskLeaderboard {
    return {
        id: 'periodic',
        points: {},
        tierCounts: {},
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z',
        ...overrides,
    };
}

describe('TaskLeaderboardRepository', () => {
    test('stores lifetime and periodic leaderboards as separate documents', async ({ repo }) => {
        await repo.createLeaderboard(buildLeaderboard({ id: 'lifetime', points: { 'user-1': 10 } }));
        await repo.createLeaderboard(buildLeaderboard({ id: 'periodic', points: { 'user-1': 3 } }));

        expect(await repo.getLeaderboard('lifetime')).toMatchObject({ points: { 'user-1': 10 } });
        expect(await repo.getLeaderboard('periodic')).toMatchObject({ points: { 'user-1': 3 } });
    });

    test('replaces whole score maps on update so stale scores are cleared', async ({ repo }) => {
        await repo.createLeaderboard(buildLeaderboard({ points: { 'old-user': 6, 'user-1': 1 } }));

        await repo.updateLeaderboard('periodic', { points: { 'user-1': 3 }, pendingPeriod: null });

        const stored = await repo.getLeaderboard('periodic');
        expect(stored?.points).toEqual({ 'user-1': 3 });
        expect(stored?.pendingPeriod).toBeNull();
    });

    test('increments points and tier counts per user', async ({ repo }) => {
        await repo.createLeaderboard(buildLeaderboard());

        await repo.incrementPoints('periodic', 'user-1', 3);
        await repo.incrementPoints('periodic', 'user-1', 3);
        await repo.incrementTierCount('periodic', 'user-1', 'silver', 1);
        await repo.incrementTierCount('periodic', 'user-1', 'bronze', -1);

        expect(await repo.getLeaderboard('periodic')).toMatchObject({
            points: { 'user-1': 6 },
            tierCounts: { 'user-1': { silver: 1, bronze: -1 } },
        });
    });

    test('rejects changes to a leaderboard that does not exist', async ({ repo }) => {
        await expect(repo.incrementPoints('periodic', 'user-1', 1)).rejects.toThrow();
        await expect(repo.updateLeaderboard('periodic', { points: {} })).rejects.toThrow();
    });
});
