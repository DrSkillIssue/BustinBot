import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrizeDrawRepository } from '../PrizeDrawRepo.js';
import type { PrizeDraw } from '../../../models/PrizeDraw.js';
import { TaskCategory } from '../../../models/Task.js';
import { clearEmulatorFirestore, getEmulatorFirestore } from '../../../tests/firestoreEmulator.js';

const db = getEmulatorFirestore();
const repo = new PrizeDrawRepository(db, 'guild-1');

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

beforeEach(async () => {
    await clearEmulatorFirestore();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PrizeDrawRepository', () => {
    it('stores draws and lists them newest first', async () => {
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'older', start: '2026-01-05T00:00:00.000Z' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'newer', start: '2026-01-19T00:00:00.000Z' }));

        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id)).toEqual(['newer', 'older']);
        expect(await repo.getPrizeDrawById('older')).toMatchObject({ id: 'older' });
        expect(await repo.getPrizeDrawById('missing')).toBeNull();
    });

    it('records participants and recomputes the entry total', async () => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.updateParticipants('2026-01-05_to_2026-01-18', { 'user-1': 2, 'user-2': 1 });

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            participants: { 'user-1': 2, 'user-2': 1 },
            totalEntries: 3,
        });
    });

    it('adds each user as an entry at most once', async () => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-1');
        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-1');
        await repo.addEntry('2026-01-05_to_2026-01-18', 'user-2');

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            entries: ['user-1', 'user-2'],
            totalEntries: 2,
        });
    });

    it('records winners and the overall winner', async () => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.setWinners('2026-01-05_to_2026-01-18', { [TaskCategory.PvM]: ['user-1'] } as Record<TaskCategory, string[]>, 'user-1');

        const draw = await repo.getPrizeDrawById('2026-01-05_to_2026-01-18');
        expect(draw).toMatchObject({ winners: { PvM: ['user-1'] }, winnerId: 'user-1' });
        expect(draw?.rolledAt).toEqual(expect.any(String));
    });

    it('leaves no overall winner when none is given', async () => {
        await repo.createPrizeDraw(buildPrizeDraw({ winnerId: 'stale-winner' }));

        await repo.setWinners('2026-01-05_to_2026-01-18', {} as Record<TaskCategory, string[]>);

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).not.toHaveProperty('winnerId');
    });

    it('deletes one draw or all draws', async () => {
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'a' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'b' }));
        await repo.createPrizeDraw(buildPrizeDraw({ id: 'c' }));

        await repo.deletePrizeDraw('a');
        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id).sort()).toEqual(['b', 'c']);

        await repo.clearPrizeDraws();
        expect(await repo.getAllPrizeDraws()).toEqual([]);
    });
});
