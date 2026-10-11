import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { KeywordRepository } from '../KeywordRepo.js';
import { clearEmulatorFirestore, getEmulatorFirestore } from '../../../tests/firestoreEmulator.js';

const db = getEmulatorFirestore();
const repo = new KeywordRepository(db, 'guild-1');

beforeEach(async () => {
    await clearEmulatorFirestore();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('KeywordRepository', () => {
    it('adds a keyword under a normalised id with no usage', async () => {
        await repo.addKeyword('New Keyword!');

        const keyword = await repo.getKeywordById('new_keyword');
        expect(keyword).toMatchObject({ id: 'new_keyword', word: 'New Keyword!', timesUsed: 0, usageHistory: [] });
        expect(keyword?.lastUsedAt.toMillis()).toBe(0);
        expect(await repo.getAllKeywords()).toHaveLength(1);
    });

    it('records usage with the most recent event first, keeping the last 20', async () => {
        await repo.addKeyword('rare');
        for (let event = 1; event <= 21; event++) {
            await repo.markKeywordUsed('rare', `event-${event}`);
        }

        const keyword = await repo.getKeywordById('rare');
        expect(keyword?.timesUsed).toBe(21);
        expect(keyword?.lastUsedEventId).toBe('event-21');
        expect(keyword?.usageHistory).toHaveLength(20);
        expect(keyword?.usageHistory[0]).toBe('event-21');
        expect(keyword?.lastUsedAt.toMillis()).toBeGreaterThan(0);
    });

    it('ignores usage of a keyword that does not exist', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await repo.markKeywordUsed('missing', 'event-1');

        expect(await repo.getKeywordById('missing')).toBeNull();
    });

    it('picks only from keywords outside the most recently used ones', async () => {
        for (const [index, word] of ['a', 'b', 'c', 'd'].entries()) {
            await db.doc(`guilds/guild-1/keywords/${word}`).set({
                id: word,
                word,
                lastUsedAt: Timestamp.fromMillis(1000 - index),
                timesUsed: 1,
                usageHistory: [],
            });
        }
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        expect(await repo.getRandomKeyword(2)).toMatchObject({ id: 'd' });
        expect(await repo.getRandomKeyword(4)).toBeNull();
    });

    it('resets usage on every keyword and deletes single keywords', async () => {
        await repo.addKeyword('alpha');
        await repo.addKeyword('beta');
        await repo.markKeywordUsed('alpha', 'event-1');
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await repo.resetAllUsage();
        expect(await repo.getKeywordById('alpha')).toMatchObject({ timesUsed: 0, lastUsedEventId: '', usageHistory: [] });

        await repo.deleteKeyword('beta');
        expect(await repo.getKeywordById('beta')).toBeNull();
    });
});
