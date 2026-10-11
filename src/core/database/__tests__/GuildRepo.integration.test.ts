import { test as base, afterEach, beforeEach, describe, expect, vi } from '../../../tests/fixtures.js';
import { GuildRepository } from '../GuildRepo.js';
import type { Guild } from '../../../models/Guild.js';

const test = base.extend('repo', ({ db }) => new GuildRepository(db));

function buildGuild(overrides: Partial<Guild> = {}): Guild {
    return {
        id: 'guild-1',
        toggles: { taskScheduler: false, leaguesEnabled: false },
        roles: { admin: 'role-admin', taskAdmin: 'role-task-admin' },
        channels: { taskChannel: 'channel-tasks', movieNight: 'channel-movies' },
        setupComplete: { core: true, movie: true, task: true },
        timezone: 'Australia/Melbourne',
        ...overrides,
    };
}

beforeEach(() => {
    vi.stubEnv('BOT_MODE', 'production');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('GuildRepository', () => {
    test('initialises a guild only when it has no document yet', async ({ repo }) => {
        await repo.initGuild('guild-1', buildGuild());
        await repo.initGuild('guild-1', buildGuild({ timezone: 'UTC' }));

        expect(await repo.getGuild('guild-1')).toMatchObject({ id: 'guild-1', timezone: 'Australia/Melbourne' });
        expect(await repo.getGuild('missing')).toBeNull();
    });

    test('merges updates into the stored guild without dropping other fields', async ({ repo }) => {
        await repo.initGuild('guild-1', buildGuild());

        await repo.updateGuild('guild-1', { roles: { movieAdmin: 'role-movie-admin' } });

        expect(await repo.getGuild('guild-1')).toMatchObject({
            roles: { admin: 'role-admin', taskAdmin: 'role-task-admin', movieAdmin: 'role-movie-admin' },
            channels: { taskChannel: 'channel-tasks', movieNight: 'channel-movies' },
            timezone: 'Australia/Melbourne',
        });
    });

    test('changes a single toggle and records who changed it', async ({ repo }) => {
        await repo.initGuild('guild-1', buildGuild({ toggles: { taskScheduler: false, leaguesEnabled: true } }));

        await repo.updateToggle('guild-1', 'toggles.taskScheduler', true, 'user-1');

        expect(await repo.getGuild('guild-1')).toMatchObject({
            toggles: { taskScheduler: true, leaguesEnabled: true },
            updatedBy: 'user-1',
        });
    });

    test('lists every guild', async ({ repo }) => {
        await repo.initGuild('guild-1', buildGuild({ id: 'guild-1' }));
        await repo.initGuild('guild-2', buildGuild({ id: 'guild-2' }));

        expect((await repo.getAllGuilds()).map((guild) => guild.id).sort()).toEqual(['guild-1', 'guild-2']);
    });

    test('only reads and writes the dev guild in dev mode', async ({ repo }) => {
        await repo.initGuild('guild-1', buildGuild({ id: 'guild-1' }));
        await repo.initGuild('guild-dev', buildGuild({ id: 'guild-dev' }));
        vi.stubEnv('BOT_MODE', 'dev');
        vi.stubEnv('DISCORD_GUILD_ID_DEV', 'guild-dev');

        expect((await repo.getAllGuilds()).map((guild) => guild.id)).toEqual(['guild-dev']);
        expect(await repo.getGuild('guild-1')).toBeNull();

        await repo.updateGuild('guild-1', { timezone: 'UTC' });
        vi.stubEnv('BOT_MODE', 'production');
        expect(await repo.getGuild('guild-1')).toMatchObject({ timezone: 'Australia/Melbourne' });
    });
});
