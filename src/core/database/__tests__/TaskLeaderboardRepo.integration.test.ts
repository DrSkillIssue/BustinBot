import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { TaskLeaderboardRepository } from '../TaskLeaderboardRepo.js';
import type { TaskLeaderboard } from '../../../models/TaskLeaderboard.js';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';

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

    test('keeps a leaderboard that already exists when asked to create it', async ({ repo }) => {
        await repo.createLeaderboard(buildLeaderboard({ points: { 'user-1': 3 } }));

        await repo.createLeaderboard(buildLeaderboard());

        expect(await repo.getLeaderboard('periodic')).toMatchObject({ points: { 'user-1': 3 } });
    });

    test('adds points and moves tier counts when a member reaches a higher tier', async ({ repo }) => {
        await repo.createLeaderboard(buildLeaderboard());

        await repo.incrementPoints('periodic', 'user-1', 3);
        await repo.recordTierChange('periodic', { userId: 'user-1', points: 1, from: null, to: SubmissionStatus.Bronze });
        await repo.recordTierChange('periodic', { userId: 'user-1', points: 2, from: SubmissionStatus.Bronze, to: SubmissionStatus.Silver });

        expect(await repo.getLeaderboard('periodic')).toMatchObject({
            points: { 'user-1': 6 },
            tierCounts: { 'user-1': { bronze: 0, silver: 1 } },
        });
    });

    test('records a tier change in the pending period', async ({ repo }) => {
        const period = { length: 4, eventIds: ['week-5'], startedAt: '2026-02-02T00:00:00.000Z', index: 2 };
        await repo.createLeaderboard(buildLeaderboard({ pendingPeriod: { period, points: {}, tierCounts: {} } }));

        await repo.recordTierChange('periodic', { userId: 'user-1', points: 6, from: null, to: SubmissionStatus.Gold }, 'pendingPeriod');

        expect(await repo.getLeaderboard('periodic')).toMatchObject({
            points: {},
            pendingPeriod: { period, points: { 'user-1': 6 }, tierCounts: { 'user-1': { gold: 1 } } },
        });
    });

    test('rejects changes to a leaderboard that does not exist', async ({ repo }) => {
        await expect(repo.incrementPoints('periodic', 'user-1', 1)).rejects.toThrow();
        await expect(repo.updateLeaderboard('periodic', { points: {} })).rejects.toThrow();
    });
});
