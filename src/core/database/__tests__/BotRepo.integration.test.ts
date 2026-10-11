import { beforeEach, describe, expect, it } from 'vitest';
import { BotRepository } from '../BotRepo.js';
import type { BotStats } from '../../../models/BotStats.js';
import { clearEmulatorFirestore, getEmulatorFirestore } from '../../../tests/firestoreEmulator.js';

const db = getEmulatorFirestore();
const repo = new BotRepository(db);

function buildBotStats(): BotStats {
    return {
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        commandsRun: 0,
        commandsByName: {},
        messagesSeen: 0,
        guildCount: 0,
        channelCount: 0,
        userCount: 0,
        moviesAdded: 0,
        moviesWatched: 0,
        moviePollsRun: 0,
        tasksAdded: 0,
        taskPollsRun: 0,
        tasksCompleted: 0,
        funStats: { bustinCount: 0, goodbotCount: 0, badbotCount: 0 },
        errorCount: 0,
        lastUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
}

beforeEach(async () => {
    await clearEmulatorFirestore();
});

describe('BotRepository', () => {
    it('creates the stats document only when it does not exist', async () => {
        expect(await repo.getBotStats()).toBeNull();

        await repo.initBotStats({ ...buildBotStats(), commandsRun: 5 });
        await repo.initBotStats({ ...buildBotStats(), commandsRun: 99 });

        expect(await repo.getBotStats()).toMatchObject({ commandsRun: 5 });
    });

    it('increments counters, fun stats and per-command counts', async () => {
        await repo.initBotStats(buildBotStats());

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

    it('records guild counts and resets every counter', async () => {
        await repo.initBotStats(buildBotStats());
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
