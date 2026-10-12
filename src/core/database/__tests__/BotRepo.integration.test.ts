import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { botStatsFactory } from '../../../tests/factories.js';
import { BotRepository } from '../BotRepo.js';

const test = base.extend('repo', ({ db }) => new BotRepository(db));

describe('BotRepository', () => {
    test('reads the stats back exactly as stored', async ({ repo }) => {
        const stats = botStatsFactory.build({ lastUpdatedAt: new Date('2026-01-08T00:00:00.000Z') });
        await repo.initBotStats(stats);

        expect(await repo.getBotStats()).toEqual(stats);
    });

    test('creates the stats document only when it does not exist', async ({ repo }) => {
        expect(await repo.getBotStats()).toBeNull();

        await repo.initBotStats(botStatsFactory.build({ commandsRun: 5 }));
        await repo.initBotStats(botStatsFactory.build({ commandsRun: 99 }));

        expect(await repo.getBotStats()).toMatchObject({ commandsRun: 5 });
    });

    test('increments counters, fun stats and per-command counts', async ({ repo }) => {
        await repo.initBotStats(botStatsFactory.build());

        await repo.increment('moviesAdded', 2);
        await repo.incrementFunStat('goodbotCount');
        await repo.incrementCommand('stats');
        await repo.incrementCommand('stats');
        await repo.incrementErrorCount();

        expect(await repo.getBotStats()).toMatchObject({
            moviesAdded: 2,
            commandsRun: 2,
            commandsByName: { stats: 2 },
            funStats: { bustinCount: 0, goodbotCount: 1, badbotCount: 0 },
            errorCount: 1,
        });
    });

    test('records guild counts and resets every counter', async ({ repo }) => {
        await repo.initBotStats(botStatsFactory.build());
        await repo.updateGuildStats(5, 10, 20);
        expect(await repo.getBotStats()).toMatchObject({ guildCount: 5, channelCount: 10, userCount: 20 });

        await repo.incrementCommand('stats');
        await repo.resetAllStats();

        expect(await repo.getBotStats()).toMatchObject({
            commandsRun: 0,
            commandsByName: {},
            guildCount: 0,
            errorCount: 0,
            funStats: { bustinCount: 0, goodbotCount: 0, badbotCount: 0 },
        });
    });
});
