import { SnowflakeUtil } from "discord.js";
import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { prizeDrawFactory } from '../../../tests/factories.js';
import { IDS } from '../../../tests/discord/payloads.js';
import { PrizeDrawRepository } from '../PrizeDrawRepo.js';

const test = base.extend('repo', ({ db }) => new PrizeDrawRepository(db, IDS.guild));
const otherUser = SnowflakeUtil.generate().toString();

describe('PrizeDrawRepository', () => {
    test('stores draws and lists them newest first', async ({ repo }) => {
        await repo.createPrizeDraw(prizeDrawFactory.build({ id: 'older', start: '2026-01-05T00:00:00.000Z' }));
        await repo.createPrizeDraw(prizeDrawFactory.build({ id: 'newer', start: '2026-01-19T00:00:00.000Z' }));

        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id)).toEqual(['newer', 'older']);
        expect(await repo.getPrizeDrawById('older')).toMatchObject({ id: 'older' });
        expect(await repo.getPrizeDrawById('missing')).toBeNull();
    });

    test('records participants and recomputes the entry total', async ({ repo }) => {
        const draw = prizeDrawFactory.build();
        await repo.createPrizeDraw(draw);

        await repo.updateParticipants(draw.id, { [IDS.user]: 2, [otherUser]: 1 });

        expect(await repo.getPrizeDrawById(draw.id)).toMatchObject({
            participants: { [IDS.user]: 2, [otherUser]: 1 },
            totalEntries: 3,
        });
    });

    test('adds each user as an entry at most once', async ({ repo }) => {
        const draw = prizeDrawFactory.build();
        await repo.createPrizeDraw(draw);

        await repo.addEntry(draw.id, IDS.user);
        await repo.addEntry(draw.id, IDS.user);
        await repo.addEntry(draw.id, otherUser);

        expect(await repo.getPrizeDrawById(draw.id)).toMatchObject({
            entries: [IDS.user, otherUser],
            totalEntries: 2,
        });
    });

    test('records the winner and when they were rolled', async ({ repo }) => {
        const draw = prizeDrawFactory.build();
        await repo.createPrizeDraw(draw);

        await repo.setWinner(draw.id, IDS.user);

        const stored = await repo.getPrizeDrawById(draw.id);
        expect(stored).toMatchObject({ winnerId: IDS.user });
        expect(stored?.rolledAt).toEqual(expect.any(String));
    });

    test('deletes one draw or all draws', async ({ repo }) => {
        await repo.createPrizeDraw(prizeDrawFactory.build({ id: 'a' }));
        await repo.createPrizeDraw(prizeDrawFactory.build({ id: 'b' }));
        await repo.createPrizeDraw(prizeDrawFactory.build({ id: 'c' }));

        await repo.deletePrizeDraw('a');
        expect((await repo.getAllPrizeDraws()).map((draw) => draw.id).sort()).toEqual(['b', 'c']);

        await repo.clearPrizeDraws();
        expect(await repo.getAllPrizeDraws()).toEqual([]);
    });
});
