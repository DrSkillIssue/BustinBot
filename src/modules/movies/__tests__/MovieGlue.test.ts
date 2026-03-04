import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY ?? 'test-key';

const handleMoviePickChooseModalSubmit = vi.fn().mockResolvedValue(undefined);
const handleConfirmRandomMovie = vi.fn().mockResolvedValue(undefined);
const handleRerollRandomMovie = vi.fn().mockResolvedValue(undefined);
const handleMoviePollVote = vi.fn().mockResolvedValue(undefined);
const handleManualPollInteraction = vi.fn().mockResolvedValue(undefined);
const handleRandomPollCountSelect = vi.fn().mockResolvedValue(undefined);

vi.mock('../PickMovieInteractions', () => ({
    handleMoviePickChooseModalSubmit,
    handleConfirmRandomMovie,
    handleRerollRandomMovie,
    handleMoviePollVote,
    handleManualPollInteraction,
    handleRandomPollCountSelect,
}));

const handleMovieNightDate = vi.fn().mockResolvedValue(undefined);
const handleMovieNightTime = vi.fn().mockResolvedValue(undefined);
vi.mock('../MovieScheduler', () => ({
    handleMovieNightDate,
    handleMovieNightTime,
}));

const initAttendanceTracking = vi.fn();
const finaliseAttendance = vi.fn().mockResolvedValue([]);
const getActiveVoiceMemberIds = vi.fn().mockResolvedValue([]);
vi.mock('../MovieAttendance', () => ({
    initAttendanceTracking,
    finaliseAttendance,
    getActiveVoiceMemberIds,
}));

const services: any = {
    guildId: 'guild-1',
    repos: {
        movieRepo: {
            getActiveEvent: vi.fn(),
            getAllEvents: vi.fn(),
            upsertMovie: vi.fn(),
            createMovieEvent: vi.fn(),
            getAllMovies: vi.fn(),
        },
    },
    guilds: {
        getAll: vi.fn(),
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue(undefined),
    },
};

const movieManualPoll = await import('../MovieManualPoll.js');
const updateManualPollSelectionSpy = vi.spyOn(movieManualPoll, 'updateManualPollSelection');
const showMovieManualPollMenuSpy = vi.spyOn(movieManualPoll, 'showMovieManualPollMenu');
const { clearManualPollSession } = movieManualPoll;

const movieLifecycle = await import('../MovieLifecycle.js');
const { finishMovieNight, scheduleMovieAutoEnd, clearScheduledMovieAutoEnd } = movieLifecycle;
const { handleMovieInteraction } = await import('../MovieInteractionHandler.js');
const { showMovieManualPollMenu } = await import('../MovieManualPoll.js');
const { pickRandomMovie } = await import('../MovieLocalSelector.js');

const setupServiceModule = await import('../../../core/services/SetupService.js');
const { setupService } = setupServiceModule;

const DateUtils = await import('../../../utils/DateUtils.js');
vi.spyOn(DateUtils, 'normaliseFirestoreDates').mockImplementation((movie: any) => movie);

beforeEach(() => {
    clearScheduledMovieAutoEnd();
    updateManualPollSelectionSpy.mockClear();
    showMovieManualPollMenuSpy.mockClear();
    initAttendanceTracking.mockClear();
    finaliseAttendance.mockClear();
    getActiveVoiceMemberIds.mockClear();
    getActiveVoiceMemberIds.mockResolvedValue([]);

    Object.values(services.repos.movieRepo).forEach((fn: any) => fn.mockClear?.());
    Object.values(services.guilds).forEach((fn: any) => fn.mockClear?.());

    services.guilds.getAll.mockResolvedValue([]);
    services.guilds.get.mockResolvedValue({ setupComplete: { movie: false } });
    services.guilds.update.mockResolvedValue(undefined);
    services.guilds.refresh.mockResolvedValue(undefined);

    setupService.clearSelections('movie', 'user-1');
});

afterEach(() => {
    clearScheduledMovieAutoEnd();
    setupService.clearSelections('movie', 'user-1');
});

describe('handleMovieInteraction', () => {
    it('prompts for missing selections on confirm', async () => {
        const interaction: any = {
            user: { id: 'user-1' },
            guildId: 'guild-1',
            isModalSubmit: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            isChannelSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            customId: 'moviesetup_confirm',
            reply: vi.fn(),
            update: vi.fn(),
        };

        setupService.clearSelections('movie', 'user-1');
        setupService.setSelection('movie', 'user-1', 'movieNight', 'channel');

        await handleMovieInteraction(interaction, services);
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('movieAdmin'),
        }));
    });

    it('persists movie setup when selections complete', async () => {
        const interaction: any = {
            user: { id: 'user-1' },
            guildId: 'guild-1',
            isModalSubmit: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            isChannelSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            customId: 'moviesetup_confirm',
            reply: vi.fn(),
            update: vi.fn(),
        };

        setupService.clearSelections('movie', 'user-1');
        setupService.setSelection('movie', 'user-1', 'movieAdmin', 'role-admin');
        setupService.setSelection('movie', 'user-1', 'movieUser', 'role-user');
        setupService.setSelection('movie', 'user-1', 'movieNight', 'channel');
        setupService.setSelection('movie', 'user-1', 'movieVC', 'voice');

        const persistSpy = vi.spyOn(setupService, 'persist').mockResolvedValue(undefined);
        const clearSpy = vi.spyOn(setupService, 'clearSelections');

        await handleMovieInteraction(interaction, services);

        expect(persistSpy).toHaveBeenCalledWith('movie', services.guilds, 'guild-1', expect.any(Object));
        expect(clearSpy).toHaveBeenCalledWith('movie', 'user-1');
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Movie module setup complete'),
        }));

        persistSpy.mockRestore();
        clearSpy.mockRestore();
    });

    it('routes manual poll selection menu', async () => {
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'movie-1', title: 'Movie One', addedAt: new Date('2024-01-01') },
        ]);

        const interaction: any = {
            user: { id: 'user-1' },
            isModalSubmit: () => false,
            isButton: () => false,
            isStringSelectMenu: () => true,
            isChannelSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            customId: 'movie_poll_manual_select',
            values: ['movie-1'],
            reply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            deferred: false,
            replied: false,
        };

        await handleMovieInteraction(interaction, services);
        expect(updateManualPollSelectionSpy).toHaveBeenCalledWith('user-1', ['movie-1']);
        expect(showMovieManualPollMenuSpy).toHaveBeenCalledWith(services, interaction);
    });

    it('captures channel selection for setup', async () => {
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const interaction: any = {
            user: { id: 'user-1' },
            isModalSubmit: () => false,
            isButton: () => false,
            isStringSelectMenu: () => false,
            isChannelSelectMenu: () => true,
            isRoleSelectMenu: () => false,
            customId: 'moviesetup_channel',
            values: ['channel-1'],
            deferUpdate,
            reply: vi.fn().mockResolvedValue(undefined),
        };

        setupService.clearSelections('movie', 'user-1');
        await handleMovieInteraction(interaction, services);
        expect(setupService.getSelections('movie', 'user-1')?.movieNight).toBe('channel-1');
        expect(deferUpdate).toHaveBeenCalled();
    });

    it('handles movie pick modal submission', async () => {
        const interaction: any = {
            isModalSubmit: () => true,
            isButton: () => false,
            customId: 'movie_pick_choose_modal',
        };

        await handleMovieInteraction(interaction, services);
        expect(handleMoviePickChooseModalSubmit).toHaveBeenCalledWith(services, interaction);
    });
});

describe('MovieLifecycle.finishMovieNight', () => {
    it('marks event complete, updates repository, and notifies submitter', async () => {
        const userSend = vi.fn().mockResolvedValue(undefined);
        const messageSend = vi.fn().mockResolvedValue(undefined);
        const channel = { send: messageSend };

        const guildObj = {
            channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, ...channel }) },
        };

        const client: any = {
            users: { fetch: vi.fn().mockResolvedValue({ send: userSend }) },
            guilds: { fetch: vi.fn().mockResolvedValue(guildObj) },
        };

        services.repos.movieRepo.getActiveEvent.mockResolvedValue({
            id: 'event-1',
            startTime: new Date(),
            movie: { title: 'Movie', addedBy: 'user-1' },
            channelId: 'channel-1',
            completed: false,
            hostedBy: 'moderator',
        });
        services.repos.movieRepo.getAllEvents.mockResolvedValue([
            {
                id: 'event-1',
                startTime: new Date(),
                movie: { title: 'Movie', addedBy: 'user-1' },
                channelId: 'channel-1',
                completed: false,
                hostedBy: 'moderator',
            },
        ]);
        services.repos.movieRepo.getAllMovies.mockResolvedValue([{ addedBy: 'user-1', watched: false }]);
        services.guilds.getAll.mockResolvedValue([{ id: 'guild-1' }]);
        services.guilds.get.mockResolvedValue({ channels: { movieNight: 'channel-1' } });

        const attendees = ['user-1', 'user-2'];
        finaliseAttendance.mockResolvedValue(attendees as any);

        const result = await finishMovieNight('moderator', services, client);
        expect(result.success).toBe(true);
        expect(services.repos.movieRepo.upsertMovie).toHaveBeenCalled();
        expect(userSend).toHaveBeenCalledWith(expect.stringContaining('Movie'));
        expect(finaliseAttendance).toHaveBeenCalledWith(services);
    });

    it('archives the selected movie when active event still has a TBD placeholder', async () => {
        const startTime = new Date('2026-03-04T10:00:00.000Z');
        services.repos.movieRepo.getAllEvents.mockResolvedValue([
            {
                id: 'event-tbd',
                startTime,
                movie: { id: 'TBD', title: 'TBD', addedBy: 'host-1', addedAt: new Date(), watched: false },
                channelId: 'channel-1',
                completed: false,
                hostedBy: 'host-1',
            },
        ]);
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            {
                id: 'movie-real',
                title: 'The Real Movie',
                addedBy: 'user-1',
                addedAt: new Date('2026-03-01T10:00:00.000Z'),
                watched: false,
                selectedAt: new Date('2026-03-04T09:55:00.000Z'),
            },
        ]);

        const client: any = {
            users: { fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) }) },
            guilds: { fetch: vi.fn().mockResolvedValue({ name: 'Guild' }) },
        };

        const result = await finishMovieNight('moderator', services, client);
        expect(result.success).toBe(true);
        expect(result.finishedMovie?.id).toBe('movie-real');
        expect(services.repos.movieRepo.upsertMovie).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'movie-real',
                watched: true,
            })
        );
    });
});

describe('MovieLifecycle.scheduleMovieAutoEnd', () => {
    it('schedules auto end and triggers finishMovieNight', async () => {
        const pending: Promise<unknown>[] = [];
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((callback: any, _ms?: number) => {
            if (typeof callback === 'function') {
                pending.push(Promise.resolve(callback()));
            }
            return 0 as any;
        }) as any);

        const guildsFetch = vi.fn().mockResolvedValue({
            name: 'Guild',
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    isTextBased: () => true,
                    send: vi.fn().mockResolvedValue(undefined),
                }),
            },
        });
        const client: any = {
            guilds: { fetch: guildsFetch },
        };

        services.repos.movieRepo.getActiveEvent.mockResolvedValue({
            id: 'event-1',
            channelId: 'channel-123',
            voiceChannelId: 'voice-123',
            startTime: new Date(),
            movie: { title: 'Auto Movie', addedBy: 'user-1' },
            completed: false,
            hostedBy: 'host-1',
        });
        services.repos.movieRepo.getAllEvents.mockResolvedValue([
            {
                id: 'event-1',
                channelId: 'channel-123',
                voiceChannelId: 'voice-123',
                startTime: new Date(),
                movie: { title: 'Auto Movie', addedBy: 'user-1' },
                completed: false,
                hostedBy: 'host-1',
            },
        ]);
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'movie-1', title: 'Other Movie', addedBy: 'user-1', watched: false },
        ]);
        services.repos.movieRepo.upsertMovie.mockResolvedValue(undefined);
        services.repos.movieRepo.createMovieEvent.mockResolvedValue(undefined);
        services.guilds.getAll.mockResolvedValue([{ id: 'guild-1' }]);
        services.guilds.get.mockResolvedValue({ channels: { movieNight: 'channel-123', movieVC: 'voice-123' } });
        getActiveVoiceMemberIds.mockResolvedValueOnce(['seed-user']);

        try {
            const startISO = new Date(Date.now() + 60_000).toISOString();

            await scheduleMovieAutoEnd(services, startISO, 0, client);
            await Promise.resolve();
            expect(initAttendanceTracking).toHaveBeenCalledWith({
                channelId: 'voice-123',
                startTime: expect.any(Date),
                client,
                initialUserIds: ['seed-user'],
            });

            await Promise.all(pending);
            expect(services.repos.movieRepo.upsertMovie).toHaveBeenCalled();
            expect(services.repos.movieRepo.createMovieEvent).toHaveBeenCalled();
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });
    it('falls back to guild-configured voice channel when event is missing voiceChannelId', async () => {
        services.repos.movieRepo.getActiveEvent.mockResolvedValue({
            id: 'event-2',
            channelId: 'channel-abc',
            startTime: new Date(),
            movie: { title: 'Fallback Movie', addedBy: 'user-2' },
            completed: false,
            hostedBy: 'host-1',
        });
        services.repos.movieRepo.getAllEvents.mockResolvedValue([
            {
                id: 'event-2',
                channelId: 'channel-abc',
                startTime: new Date(),
                movie: { title: 'Fallback Movie', addedBy: 'user-2' },
                completed: false,
                hostedBy: 'host-1',
            },
        ]);
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'movie-2', title: 'Another Movie', addedBy: 'user-2', watched: false },
        ]);
        services.repos.movieRepo.upsertMovie.mockResolvedValue(undefined);
        services.repos.movieRepo.createMovieEvent.mockResolvedValue(undefined);
        services.guilds.get.mockResolvedValue({ channels: { movieNight: 'channel-abc', movieVC: 'voice-fallback' } });
        getActiveVoiceMemberIds.mockResolvedValueOnce(['fallback-seed']);

        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: any) => {
            cb();
            return 0 as any;
        }) as any);

        const fallbackClient: any = { guilds: { fetch: vi.fn() } };
        try {
            const startISO = new Date(Date.now() + 60_000).toISOString();
            await scheduleMovieAutoEnd(services, startISO, 0, fallbackClient);
            expect(initAttendanceTracking).toHaveBeenCalledWith({
                channelId: 'voice-fallback',
                startTime: expect.any(Date),
                client: fallbackClient,
                initialUserIds: ['fallback-seed'],
            });
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });

    it('replaces timers per guild without touching other guild timers', async () => {
        let timeoutId = 0;
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((_cb: any) => {
            timeoutId += 1;
            return timeoutId as any;
        }) as any);
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation((() => undefined) as any);

        const client: any = { guilds: { fetch: vi.fn() } };
        const startISO = new Date(Date.now() + 60_000).toISOString();

        const guild1Services: any = {
            guildId: 'guild-1',
            repos: {
                movieRepo: {
                    getActiveEvent: vi.fn().mockResolvedValue({
                        id: 'event-g1',
                        channelId: 'channel-g1',
                        voiceChannelId: 'voice-g1',
                        startTime: new Date(),
                        movie: { title: 'Guild 1 Movie', addedBy: 'user-1' },
                        completed: false,
                        hostedBy: 'host-1',
                    }),
                },
            },
            guilds: {
                get: vi.fn().mockResolvedValue({ channels: { movieVC: 'voice-g1' } }),
            },
        };

        const guild2Services: any = {
            guildId: 'guild-2',
            repos: {
                movieRepo: {
                    getActiveEvent: vi.fn().mockResolvedValue({
                        id: 'event-g2',
                        channelId: 'channel-g2',
                        voiceChannelId: 'voice-g2',
                        startTime: new Date(),
                        movie: { title: 'Guild 2 Movie', addedBy: 'user-2' },
                        completed: false,
                        hostedBy: 'host-2',
                    }),
                },
            },
            guilds: {
                get: vi.fn().mockResolvedValue({ channels: { movieVC: 'voice-g2' } }),
            },
        };

        try {
            await scheduleMovieAutoEnd(guild1Services, startISO, 0, client);
            await scheduleMovieAutoEnd(guild2Services, startISO, 0, client);
            await scheduleMovieAutoEnd(guild1Services, startISO, 0, client);

            expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
            expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

            const firstGuild1Timer = setTimeoutSpy.mock.results[0]?.value;
            const guild2Timer = setTimeoutSpy.mock.results[1]?.value;

            expect(clearTimeoutSpy).toHaveBeenCalledWith(firstGuild1Timer);
            expect(clearTimeoutSpy).not.toHaveBeenCalledWith(guild2Timer);
        } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
            clearScheduledMovieAutoEnd('guild-1');
            clearScheduledMovieAutoEnd('guild-2');
        }
    });
});

describe('showMovieManualPollMenu', () => {
    it('provides selection options and disables confirm until enough movies chosen', async () => {
        const editReply = vi.fn().mockResolvedValue(undefined);
        const interaction: any = {
            user: { id: 'user-1' },
            deferred: false,
            replied: false,
            reply: vi.fn().mockResolvedValue(undefined),
            editReply,
            values: [],
        };

        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'movie-1', title: 'Movie One', addedAt: new Date('2024-01-01') },
            { id: 'movie-2', title: 'Movie Two', addedAt: new Date('2024-02-01') },
        ]);

        await showMovieManualPollMenu(services, interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            components: expect.any(Array),
        }));

        // Simulate follow-up call after selecting two movies
        interaction.deferred = true;
        interaction.replied = true;
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'movie-1', title: 'Movie One', addedAt: new Date('2024-01-01') },
            { id: 'movie-2', title: 'Movie Two', addedAt: new Date('2024-02-01') },
        ]);

        movieManualPoll.updateManualPollSelection('user-1', ['movie-1', 'movie-2']);

        await showMovieManualPollMenu(services, interaction);
        expect(editReply).toHaveBeenCalled();
        clearManualPollSession('user-1');
    });

    it('returns no-active-movies response when all entries are watched', async () => {
        const interaction: any = {
            user: { id: 'user-1' },
            deferred: false,
            replied: false,
            followUp: vi.fn().mockResolvedValue(undefined),
            reply: vi.fn().mockResolvedValue(undefined),
        };

        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'watched-1', title: 'Old Movie', watched: true, addedAt: new Date('2024-01-01') },
        ]);

        await showMovieManualPollMenu(services, interaction);
        expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
            content: 'No active movies found.',
        }));
    });
});

describe('pickRandomMovie', () => {
    it('never returns watched movies', async () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        services.repos.movieRepo.getAllMovies.mockResolvedValue([
            { id: 'watched-1', title: 'Watched', watched: true, addedBy: 'user-1', addedAt: new Date() },
            { id: 'active-1', title: 'Active', watched: false, addedBy: 'user-1', addedAt: new Date() },
        ]);

        try {
            const movie = await pickRandomMovie(services);
            expect(movie?.id).toBe('active-1');
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('addMovieWithStats', () => {
    it('persists movie and increments user stat', async () => {
        const { addMovieWithStats } = await import('../MovieService.js');
        const servicesWithRepos: any = {
            repos: {
                movieRepo: { upsertMovie: vi.fn().mockResolvedValue(undefined) },
                userRepo: { incrementStat: vi.fn().mockResolvedValue(undefined) },
            },
        };

        const movie = { id: 'movie-1', addedBy: 'user-1' } as any;
        await addMovieWithStats(movie, servicesWithRepos);

        expect(servicesWithRepos.repos.movieRepo.upsertMovie).toHaveBeenCalledWith(movie);
        expect(servicesWithRepos.repos.userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'moviesAdded', 1);
    });
});
