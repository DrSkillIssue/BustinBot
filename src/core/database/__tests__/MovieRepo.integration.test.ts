import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { MovieRepository } from '../MovieRepo.js';
import type { Movie } from '../../../models/Movie.js';
import type { MovieEvent } from '../../../models/MovieEvent.js';
import type { MoviePoll } from '../../../models/MoviePoll.js';
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from '../../../tests/firestoreEmulator.js';

const test = base.extend('repo', ({ db }) => new MovieRepository(db, 'guild-1'));

function buildMovie(overrides: Partial<Movie> = {}): Movie {
    return {
        id: 'movie-1',
        title: 'Inception',
        watched: false,
        addedBy: 'user-1',
        addedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

function buildPoll(overrides: Partial<MoviePoll> = {}): MoviePoll {
    return {
        id: 'poll-1',
        type: 'movie',
        options: [buildMovie({ id: 'movie-1' }), buildMovie({ id: 'movie-2', title: 'Arrival' })],
        messageId: 'message-1',
        channelId: 'channel-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-02T00:00:00.000Z'),
        isActive: true,
        votes: {},
        ...overrides,
    };
}

function buildEvent(overrides: Partial<MovieEvent> = {}): MovieEvent {
    return {
        id: 'event-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startTime: new Date('2026-01-03T09:00:00.000Z'),
        movie: buildMovie(),
        channelId: 'channel-1',
        completed: false,
        hostedBy: 'user-1',
        ...overrides,
    };
}

describe('MovieRepository movies', () => {
    test('stores, lists and deletes movies', async ({ repo }) => {
        await repo.upsertMovie(buildMovie({ id: 'movie-1' }));
        await repo.upsertMovie(buildMovie({ id: 'movie-2', title: 'Arrival' }));

        expect(await repo.getMovieById('movie-2')).toMatchObject({ title: 'Arrival' });
        expect((await repo.getAllMovies()).map((movie) => movie.id).sort()).toEqual(['movie-1', 'movie-2']);

        await repo.deleteMovie('movie-1');
        expect(await repo.getMovieById('movie-1')).toBeNull();
    });

    test('stores a movie whose optional TMDb details are missing', async ({ repo }) => {
        await repo.upsertMovie(buildMovie({ director: undefined, runtime: undefined, posterUrl: undefined }));

        expect(await repo.getMovieById('movie-1')).toMatchObject({ title: 'Inception' });
    });
});

describe('MovieRepository polls', () => {
    test('returns the most recently created active poll', async ({ repo }) => {
        await repo.createPoll(buildPoll({ id: 'older', createdAt: new Date('2026-01-01T00:00:00.000Z') }));
        await repo.createPoll(buildPoll({ id: 'newer', createdAt: new Date('2026-01-05T00:00:00.000Z') }));
        await repo.createPoll(buildPoll({ id: 'closed', createdAt: new Date('2026-01-09T00:00:00.000Z'), isActive: false }));

        const active = await repo.getActivePoll();
        expect(active?.id).toBe('newer');
        expect(active?.createdAt).toEqual(new Date('2026-01-05T00:00:00.000Z'));
        expect(active?.endsAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    });

    test('closes a poll', async ({ repo }) => {
        await repo.createPoll(buildPoll());

        await repo.closePoll('poll-1');

        expect(await repo.getActivePoll()).toBeNull();
    });

    test('records a vote and reports whether it was the voter\'s first', async ({ repo }) => {
        await repo.createPoll(buildPoll());

        const first = await repo.voteInPollOnce('poll-1', 'user-1', 'movie-1');
        const changed = await repo.voteInPollOnce('poll-1', 'user-1', 'movie-2');

        expect(first.firstTime).toBe(true);
        expect(changed.firstTime).toBe(false);
        expect(changed.updatedPoll.votes).toEqual({ 'user-1': 'movie-2' });
        await expect(repo.voteInPollOnce('missing', 'user-1', 'movie-1')).rejects.toThrow('Poll not found.');
    });

    test('counts every vote when voters vote at the same time', async ({ repo }) => {
        await repo.createPoll(buildPoll());

        await Promise.all(
            Array.from({ length: 5 }, (_, voter) => repo.voteInPollOnce('poll-1', `user-${voter}`, 'movie-1'))
        );

        expect(Object.keys((await repo.getActivePoll())?.votes ?? {})).toHaveLength(5);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('clears all polls', async ({ repo }) => {
        await repo.createPoll(buildPoll());

        await repo.clearPolls();

        expect(await repo.getActivePoll()).toBeNull();
    });
});

describe('MovieRepository events', () => {
    test('returns the active event with the latest start time, as dates', async ({ repo }) => {
        await repo.createMovieEvent(buildEvent({ id: 'early', startTime: new Date('2026-01-03T09:00:00.000Z') }));
        await repo.createMovieEvent(buildEvent({ id: 'late', startTime: new Date('2026-01-10T09:00:00.000Z') }));
        await repo.createMovieEvent(buildEvent({ id: 'done', completed: true }));

        const active = await repo.getActiveEvent();
        expect(active?.id).toBe('late');
        expect(active?.startTime).toEqual(new Date('2026-01-10T09:00:00.000Z'));
    });

    test('lists events newest first and returns the latest', async ({ repo }) => {
        await repo.createMovieEvent(buildEvent({ id: 'first', createdAt: new Date('2026-01-01T00:00:00.000Z') }));
        await repo.createMovieEvent(buildEvent({ id: 'second', createdAt: new Date('2026-01-08T00:00:00.000Z') }));

        expect((await repo.getAllEvents()).map((event) => event.id)).toEqual(['second', 'first']);
        expect((await repo.getLatestEvent())?.id).toBe('second');

        await repo.clearEvents();
        expect(await repo.getAllEvents()).toEqual([]);
    });
});

describe('MovieRepository dates', () => {
    const watched = buildMovie({ id: 'movie-3', watched: true, watchedAt: new Date('2026-01-04T00:00:00.000Z'), selectedAt: new Date('2026-01-02T00:00:00.000Z') });

    test('reads movies, polls and events back exactly as stored, nested dates included', async ({ repo }) => {
        const poll = buildPoll({ options: [buildMovie(), watched] });
        const event = buildEvent({ movie: watched, completed: true, completedAt: new Date('2026-01-03T12:00:00.000Z') });
        await repo.upsertMovie(watched);
        await repo.createPoll(poll);
        await repo.createMovieEvent(event);

        expect(await repo.getMovieById('movie-3')).toEqual(watched);
        expect(await repo.getActivePoll()).toEqual(poll);
        expect(await repo.getLatestEvent()).toEqual(event);
        expect((await repo.getLatestEvent())?.movie.watchedAt).toBeInstanceOf(Date);
    });

    test('reports a stored date that is not a timestamp instead of guessing', async ({ repo, db }) => {
        await db.doc('guilds/guild-1/movies/movie-1').set({ ...buildMovie(), addedAt: '2026-01-01' });

        await expect(repo.getMovieById('movie-1')).rejects.toThrow('Stored movie.addedAt is string, not a timestamp.');
    });
});
