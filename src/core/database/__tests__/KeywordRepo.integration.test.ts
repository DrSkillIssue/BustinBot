import { test as base, describe, expect, vi } from '../../../tests/fixtures.js';
import { IDS } from '../../../tests/discord/payloads.js';
import { Timestamp } from 'firebase-admin/firestore';
import { KeywordRepository } from '../KeywordRepo.js';

const test = base.extend('repo', ({ db }) => new KeywordRepository(db, IDS.guild));


describe('KeywordRepository', () => {
    test('adds a keyword under a normalised id with no usage', async ({ repo }) => {
        await repo.addKeyword('New Keyword!');

        const keyword = await repo.getKeywordById('new_keyword');
        expect(keyword).toMatchObject({ id: 'new_keyword', word: 'New Keyword!', timesUsed: 0, usageHistory: [] });
        expect(keyword?.lastUsedAt.getTime()).toBe(0);
        expect(await repo.getAllKeywords()).toHaveLength(1);
    });

    test('records usage with the most recent event first, keeping the last 20', async ({ repo }) => {
        await repo.addKeyword('rare');
        for (let event = 1; event <= 21; event++) {
            await repo.markKeywordUsed('rare', `event-${event}`);
        }

        const keyword = await repo.getKeywordById('rare');
        expect(keyword?.timesUsed).toBe(21);
        expect(keyword?.lastUsedEventId).toBe('event-21');
        expect(keyword?.usageHistory).toHaveLength(20);
        expect(keyword?.usageHistory[0]).toBe('event-21');
        expect(keyword?.lastUsedAt.getTime()).toBeGreaterThan(0);
    });

    test('ignores usage of a keyword that does not exist', async ({ repo }) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await repo.markKeywordUsed('missing', 'event-1');

        expect(await repo.getKeywordById('missing')).toBeNull();
        expect(warn).toHaveBeenCalledWith('[KeywordRepo] Keyword missing not found');
    });

    test('picks only from keywords outside the most recently used ones', async ({ repo, db }) => {
        for (const [index, word] of ['a', 'b', 'c', 'd'].entries()) {
            await db.doc(`guilds/${IDS.guild}/keywords/${word}`).set({
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

    test('resets usage on every keyword and deletes single keywords', async ({ repo }) => {
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
