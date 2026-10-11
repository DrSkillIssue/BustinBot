import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { buildMovie, buildMovieEvent, buildMoviePoll } from '../../../tests/fakes/builders.js';
import { IDS } from '../../../tests/discord/payloads.js';
import { MovieRepository } from '../MovieRepo.js';
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from '../../../tests/firestoreEmulator.js';

const test = base.extend('repo', ({ db }) => new MovieRepository(db, IDS.guild));

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
        await repo.createPoll(buildMoviePoll({ id: 'older', createdAt: new Date('2026-01-01T00:00:00.000Z') }));
        await repo.createPoll(buildMoviePoll({ id: 'newer', createdAt: new Date('2026-01-05T00:00:00.000Z') }));
        await repo.createPoll(buildMoviePoll({ id: 'closed', createdAt: new Date('2026-01-09T00:00:00.000Z'), isActive: false }));

        const active = await repo.getActivePoll();
        expect(active?.id).toBe('newer');
        expect(active?.createdAt).toEqual(new Date('2026-01-05T00:00:00.000Z'));
        expect(active?.endsAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    });

    test('closes a poll once, returning it with its votes as it closed', async ({ repo }) => {
        await repo.createPoll(buildMoviePoll({ votes: { [IDS.user]: 'movie-2' } }));

        expect(await repo.closePoll('poll-1')).toMatchObject({ id: 'poll-1', votes: { [IDS.user]: 'movie-2' } });
        expect(await repo.closePoll('poll-1')).toBeNull();
        expect(await repo.getActivePoll()).toBeNull();
    });

    test('closes a poll closed twice at the same moment once', async ({ repo }) => {
        await repo.createPoll(buildMoviePoll());

        const closed = await Promise.all([repo.closePoll('poll-1'), repo.closePoll('poll-1')]);

        expect(closed.filter(Boolean)).toHaveLength(1);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('records a vote and reports whether it was the voter\'s first', async ({ repo }) => {
        await repo.createPoll(buildMoviePoll());

        const first = await repo.voteInPollOnce('poll-1', IDS.user, 'movie-1');
        const changed = await repo.voteInPollOnce('poll-1', IDS.user, 'movie-2');

        expect(first.firstTime).toBe(true);
        expect(changed.firstTime).toBe(false);
        expect(changed.updatedPoll.votes).toEqual({ [IDS.user]: 'movie-2' });
        await expect(repo.voteInPollOnce('missing', IDS.user, 'movie-1')).rejects.toThrow('Poll not found.');
    });

    test('counts every vote when voters vote at the same time', async ({ repo }) => {
        await repo.createPoll(buildMoviePoll());

        await Promise.all(
            Array.from({ length: 5 }, (_, voter) => repo.voteInPollOnce('poll-1', `user-${voter}`, 'movie-1'))
        );

        expect(Object.keys((await repo.getActivePoll())?.votes ?? {})).toHaveLength(5);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('clears all polls', async ({ repo }) => {
        await repo.createPoll(buildMoviePoll());

        await repo.clearPolls();

        expect(await repo.getActivePoll()).toBeNull();
    });
});

describe('MovieRepository events', () => {
    test('returns the active event with the latest start time, as dates', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent({ id: 'early', startTime: new Date('2026-01-03T09:00:00.000Z') }));
        await repo.createMovieEvent(buildMovieEvent({ id: 'late', startTime: new Date('2026-01-10T09:00:00.000Z') }));
        await repo.createMovieEvent(buildMovieEvent({ id: 'done', completed: true }));

        const active = await repo.getActiveEvent();
        expect(active?.id).toBe('late');
        expect(active?.startTime).toEqual(new Date('2026-01-10T09:00:00.000Z'));
    });

    test('completes an event once, with the changes given', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent());
        const completedAt = new Date('2026-01-03T12:00:00.000Z');

        expect(await repo.completeEvent('event-1', { completedAt, movie: buildMovie({ watched: true }) })).toMatchObject({
            completed: true, completedAt, movie: { watched: true },
        });
        expect(await repo.completeEvent('event-1')).toBeNull();
        expect(await repo.completeEvent('missing')).toBeNull();
        expect(await repo.getActiveEvent()).toBeNull();
    });

    test('completes an event completed twice at the same moment once', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent());

        const completed = await Promise.all([repo.completeEvent('event-1'), repo.completeEvent('event-1')]);

        expect(completed.filter(Boolean)).toHaveLength(1);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('claims each reminder once, and none for an event that has ended', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent());
        await repo.createMovieEvent(buildMovieEvent({ id: 'ended', completed: true }));

        expect(await repo.claimReminders('event-1', ['2 hours before'])).toEqual(['2 hours before']);
        expect(await repo.claimReminders('event-1', ['2 hours before', '30 mins before'])).toEqual(['30 mins before']);
        expect(await repo.claimReminders('ended', ['start time'])).toEqual([]);
        expect((await repo.getActiveEvent())?.remindersSent).toEqual(['2 hours before', '30 mins before']);
    });

    test('claims a reminder claimed twice at the same moment once', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent());

        const claims = await Promise.all([repo.claimReminders('event-1', ['start time']), repo.claimReminders('event-1', ['start time'])]);

        expect(claims.flat()).toEqual(['start time']);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('lists events newest first and returns the latest', async ({ repo }) => {
        await repo.createMovieEvent(buildMovieEvent({ id: 'first', createdAt: new Date('2026-01-01T00:00:00.000Z') }));
        await repo.createMovieEvent(buildMovieEvent({ id: 'second', createdAt: new Date('2026-01-08T00:00:00.000Z') }));

        expect((await repo.getAllEvents()).map((event) => event.id)).toEqual(['second', 'first']);
        expect((await repo.getLatestEvent())?.id).toBe('second');

        await repo.clearEvents();
        expect(await repo.getAllEvents()).toEqual([]);
    });
});

describe('MovieRepository dates', () => {
    const watched = buildMovie({ id: 'movie-3', watched: true, watchedAt: new Date('2026-01-04T00:00:00.000Z'), selectedAt: new Date('2026-01-02T00:00:00.000Z') });

    test('reads movies, polls and events back exactly as stored, nested dates included', async ({ repo }) => {
        const poll = buildMoviePoll({ options: [buildMovie(), watched] });
        const event = buildMovieEvent({ movie: watched, completed: true, completedAt: new Date('2026-01-03T12:00:00.000Z') });
        await repo.upsertMovie(watched);
        await repo.createPoll(poll);
        await repo.createMovieEvent(event);

        expect(await repo.getMovieById('movie-3')).toEqual(watched);
        expect(await repo.getActivePoll()).toEqual(poll);
        expect(await repo.getLatestEvent()).toEqual(event);
        expect((await repo.getLatestEvent())?.movie.watchedAt).toBeInstanceOf(Date);
    });

    test('reports a stored date that is not a timestamp instead of guessing', async ({ repo, db }) => {
        await db.doc(`guilds/${IDS.guild}/movies/movie-1`).set({ ...buildMovie(), addedAt: '2026-01-01' });

        await expect(repo.getMovieById('movie-1')).rejects.toThrow('Stored movie.addedAt is string, not a timestamp.');
    });
});
