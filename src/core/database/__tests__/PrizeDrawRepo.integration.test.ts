import { SnowflakeUtil } from "discord.js";
import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { buildPrizeDraw } from '../../../tests/fakes/builders.js';
import { IDS } from '../../../tests/discord/payloads.js';
import { PrizeDrawRepository } from '../PrizeDrawRepo.js';

const test = base.extend('repo', ({ db }) => new PrizeDrawRepository(db, IDS.guild));
const otherUser = SnowflakeUtil.generate().toString();

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

        await repo.updateParticipants('2026-01-05_to_2026-01-18', { [IDS.user]: 2, [otherUser]: 1 });

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            participants: { [IDS.user]: 2, [otherUser]: 1 },
            totalEntries: 3,
        });
    });

    test('adds each user as an entry at most once', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.addEntry('2026-01-05_to_2026-01-18', IDS.user);
        await repo.addEntry('2026-01-05_to_2026-01-18', IDS.user);
        await repo.addEntry('2026-01-05_to_2026-01-18', otherUser);

        expect(await repo.getPrizeDrawById('2026-01-05_to_2026-01-18')).toMatchObject({
            entries: [IDS.user, otherUser],
            totalEntries: 2,
        });
    });

    test('records the winner and when they were rolled', async ({ repo }) => {
        await repo.createPrizeDraw(buildPrizeDraw());

        await repo.setWinner('2026-01-05_to_2026-01-18', IDS.user);

        const draw = await repo.getPrizeDrawById('2026-01-05_to_2026-01-18');
        expect(draw).toMatchObject({ winnerId: IDS.user });
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
