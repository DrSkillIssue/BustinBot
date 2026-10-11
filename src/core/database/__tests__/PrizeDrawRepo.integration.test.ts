import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { PrizeDrawRepository } from '../PrizeDrawRepo.js';
import type { PrizeDraw } from '../../../models/PrizeDraw.js';

const test = base.extend('repo', ({ db }) => new PrizeDrawRepository(db, 'guild-1'));

function buildPrizeDraw(overrides: Partial<PrizeDraw> = {}): PrizeDraw {
    return {
        id: '2026-01-05_to_2026-01-18',
        start: '2026-01-05T00:00:00.000Z',
        end: '2026-01-18T23:59:59.999Z',
        snapshotTakenAt: '2026-01-19T00:00:00.000Z',
        participants: {},
        entries: [],
        totalEntries: 0,
        ...overrides,
    };
}

describe('PrizeDrawRepository', () => {
    test('stores draws and lists them newest first', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'older', start: '2026-01-05T00:00:00.000Z' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'newer', start: '2026-01-19T00:00:00.000Z' }));

        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id)).toEqual(['newer', 'older']);
        expect(await repo.getPrizeDrawById('older')).toMatchObject({ id: 'older' });
        expect(await repo.getPrizeDrawById('missing')).toBeNull();
    });

    test('records participants and recomputes the entry total', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.updateParticipants('2026-01-05_to_2026-01-18', { 'user-1': 2, 'user-2': 1 });

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            participants: { 'user-1': 2, 'user-2': 1 },
            totalEntries: 3,
        });
    });

    test('adds each user as an entry at most once', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-1');
        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-1');
        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-2');

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            entries: ['user-1', 'user-2'],
            totalEntries: 2,
        });
    });

    test('records the winner and when they were rolled', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.setWinner('2026-01-05_to_2026-01-18', 'user-1');

        const draw = await repo.getPrizeDrawById('2026-01-05_to_2026-01-18');
        expect(draw).toMatchObject({ winnerId: 'user-1' });
        expect(draw?.rolledAt).toEqual(expect.any(String));
    });

    test('deletes one draw or all draws', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'a' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'b' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'c' }));

        await repo.deletePrizeDraw('a');
        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id).sort()).toEqual(['b', 'c']);

        await repo.clearPrizeDraws();
        expect(await repo.getAllPrizeDraws()).toEqual([]);
    });
});
