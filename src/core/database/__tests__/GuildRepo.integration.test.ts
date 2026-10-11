import { test as base, beforeEach, describe, expect, vi } from '../../../tests/fixtures.js';
import { GuildRepository } from '../GuildRepo.js';
import { IDS } from '../../../tests/discord/payloads.js';
import { buildGuild } from '../../../tests/fakes/builders.js';

const test = base.extend('repo', ({ db }) => new GuildRepository(db));
const otherGuild = '100000000000000011';

beforeEach(() => {
    vi.stubEnv('BOT_MODE', 'production');
});

describe('GuildRepository', () => {
    test('initialises a guild only when it has no document yet', async ({ repo }) => {
        await repo.initGuild(IDS.guild, buildGuild());
        await repo.initGuild(IDS.guild, buildGuild({ timezone: 'Australia/Melbourne' }));

        expect(await repo.getGuild(IDS.guild)).toMatchObject({ id: IDS.guild, timezone: 'UTC' });
        expect(await repo.getGuild('missing')).toBeNull();
    });

    test('merges updates into the stored guild without dropping other fields', async ({ repo }) => {
        await repo.initGuild(IDS.guild, buildGuild());

        await repo.updateGuild(IDS.guild, { roles: { movieUser: 'role-movie-user' } });

        expect(await repo.getGuild(IDS.guild)).toMatchObject({
            roles: { ...IDS.roles, movieUser: 'role-movie-user' },
            channels: buildGuild().channels,
            timezone: 'UTC',
        });
    });

    test('changes a single toggle and records who changed it', async ({ repo }) => {
        await repo.initGuild(IDS.guild, buildGuild({ toggles: { taskScheduler: false, leaguesEnabled: true } }));

        await repo.updateToggle(IDS.guild, 'toggles.taskScheduler', true, 'user-1');

        expect(await repo.getGuild(IDS.guild)).toMatchObject({
            toggles: { taskScheduler: true, leaguesEnabled: true },
            updatedBy: 'user-1',
        });
    });

    test('lists every guild', async ({ repo }) => {
        await repo.initGuild(IDS.guild, buildGuild());
        await repo.initGuild(otherGuild, buildGuild({ id: otherGuild }));

        expect((await repo.getAllGuilds()).map((guild) => guild.id).sort()).toEqual([IDS.guild, otherGuild]);
    });

    test('only reads and writes the dev guild in dev mode', async ({ repo }) => {
        await repo.initGuild(IDS.guild, buildGuild());
        await repo.initGuild(otherGuild, buildGuild({ id: otherGuild }));
        vi.stubEnv('BOT_MODE', 'dev');
        vi.stubEnv('DISCORD_GUILD_ID_DEV', otherGuild);

        expect((await repo.getAllGuilds()).map((guild) => guild.id)).toEqual([otherGuild]);
        expect(await repo.getGuild(IDS.guild)).toBeNull();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await repo.updateGuild(IDS.guild, { timezone: 'Australia/Melbourne' });
        expect(warn).toHaveBeenCalledWith(`[GuildRepository] Skipping update for guild ${IDS.guild} in dev mode.`);
        vi.stubEnv('BOT_MODE', 'production');
        expect(await repo.getGuild(IDS.guild)).toMatchObject({ timezone: 'UTC' });
    });
});
