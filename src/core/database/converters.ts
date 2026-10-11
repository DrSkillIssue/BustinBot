import { Timestamp, type DocumentData, type FirestoreDataConverter, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { BotStats } from "../../models/BotStats.js";
import type { Guild } from "../../models/Guild.js";
import type { Keyword } from "../../models/Keyword.js";
import type { Movie } from "../../models/Movie.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import type { PrizeDraw } from "../../models/PrizeDraw.js";
import type { Task } from "../../models/Task.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { TaskFeedback } from "../../models/TaskFeedback.js";
import type { TaskLeaderboard } from "../../models/TaskLeaderboard.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import type { TaskSubmission } from "../../models/TaskSubmission.js";
import { newUserStats, type UserStats } from "../../models/UserStats.js";

// One converter per collection, given to Firestore with withConverter
// (https://cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestoredataconverter).
// Firestore stores a Date as a Timestamp and returns the Timestamp when read; each converter turns its collection's
// date fields back into the Dates the models declare, so the rest of the bot only ever sees Dates.

// The stored form of a model: what the model holds as a Date, Firestore holds as a Timestamp
type Stored<T> = { [K in keyof T]: T[K] extends Date ? Timestamp : T[K] extends Date | undefined ? Timestamp | undefined : T[K] };
type StoredMovie = Stored<Movie>;
type StoredMoviePoll = Omit<Stored<MoviePoll>, "options"> & { options: StoredMovie[] };
type StoredMovieEvent = Omit<Stored<MovieEvent>, "movie"> & { movie: StoredMovie };

// Firestore does not enforce a schema, so a stored value that is not a timestamp is reported rather than guessed at
function date(value: unknown, field: string): Date {
    if (value instanceof Timestamp) return value.toDate();
    throw new TypeError(`Stored ${field} is ${value === null ? "null" : typeof value}, not a timestamp.`);
}

function optionalDate(value: unknown, field: string): Date | undefined {
    return value === undefined || value === null ? undefined : date(value, field);
}

// A converter that reads a document in the stored form its collection is written in. Writes pass through unchanged,
// because Firestore itself stores Dates as Timestamps.
function converter<T extends DocumentData, S extends DocumentData = T>(fromStored: (stored: S, id: string) => T): FirestoreDataConverter<T> {
    return {
        toFirestore: (model) => model,
        fromFirestore: (snapshot: QueryDocumentSnapshot) => fromStored(snapshot.data() as S, snapshot.id),
    };
}

function movieFrom(stored: StoredMovie, path: string): Movie {
    return {
        ...stored,
        addedAt: date(stored.addedAt, `${path}.addedAt`),
        watchedAt: optionalDate(stored.watchedAt, `${path}.watchedAt`),
        selectedAt: optionalDate(stored.selectedAt, `${path}.selectedAt`),
    };
}

export const movieConverter = converter<Movie, StoredMovie>((stored) => movieFrom(stored, "movie"));

export const moviePollConverter = converter<MoviePoll, StoredMoviePoll>((stored) => ({
    ...stored,
    options: stored.options.map((option, index) => movieFrom(option, `moviePoll.options[${index}]`)),
    createdAt: date(stored.createdAt, "moviePoll.createdAt"),
    endsAt: date(stored.endsAt, "moviePoll.endsAt"),
}));

export const movieEventConverter = converter<MovieEvent, StoredMovieEvent>((stored) => {
    const { completedAt, ...rest } = stored;
    return {
        ...rest,
        movie: movieFrom(stored.movie, "movieEvent.movie"),
        createdAt: date(stored.createdAt, "movieEvent.createdAt"),
        startTime: date(stored.startTime, "movieEvent.startTime"),
        ...(completedAt !== undefined ? { completedAt: date(completedAt, "movieEvent.completedAt") } : {}),
    };
});

export const taskConverter = converter<Task>((stored) => stored);

export const taskPollConverter = converter<TaskPoll, Stored<TaskPoll>>((stored) => ({
    ...stored,
    createdAt: date(stored.createdAt, "taskPoll.createdAt"),
    endsAt: date(stored.endsAt, "taskPoll.endsAt"),
}));

export const taskEventConverter = converter<TaskEvent, Stored<TaskEvent>>((stored) => ({
    ...stored,
    startTime: date(stored.startTime, "taskEvent.startTime"),
    endTime: date(stored.endTime, "taskEvent.endTime"),
    createdAt: date(stored.createdAt, "taskEvent.createdAt"),
}));

export const taskSubmissionConverter = converter<TaskSubmission, Stored<TaskSubmission>>((stored) => {
    const { submittedAt, reviewedAt, ...rest } = stored;
    return {
        ...rest,
        createdAt: date(stored.createdAt, "taskSubmission.createdAt"),
        ...(submittedAt !== undefined ? { submittedAt: date(submittedAt, "taskSubmission.submittedAt") } : {}),
        ...(reviewedAt !== undefined ? { reviewedAt: date(reviewedAt, "taskSubmission.reviewedAt") } : {}),
    };
});

export const taskFeedbackConverter = converter<TaskFeedback>((stored) => stored);

export const taskLeaderboardConverter = converter<TaskLeaderboard>((stored) => stored);

export const prizeDrawConverter = converter<PrizeDraw>((stored) => stored);

// Members created by the legacy completion import (src/scripts/importLegacySubmissions.ts, 2025-10-29) were stored with
// only userId, legacyTasksCompleted and createdAt. Their other counts start at zero and they joined when imported.
type StoredUserStats = Partial<Stored<UserStats>> & Pick<UserStats, "userId"> & { createdAt?: Timestamp };

export const userStatsConverter = converter<UserStats, StoredUserStats>((stored) => {
    const { createdAt, joinedAt, lastActiveAt, ...counts } = stored;
    const joined = optionalDate(joinedAt, "userStats.joinedAt") ?? date(createdAt, "userStats.createdAt");
    return {
        ...newUserStats(stored.userId, joined),
        ...counts,
        lastActiveAt: optionalDate(lastActiveAt, "userStats.lastActiveAt") ?? joined,
    };
});

export const keywordConverter = converter<Keyword, Stored<Keyword>>((stored) => ({
    ...stored,
    lastUsedAt: date(stored.lastUsedAt, "keyword.lastUsedAt"),
}));

export const botStatsConverter = converter<BotStats, Stored<BotStats>>((stored) => ({
    ...stored,
    startedAt: date(stored.startedAt, "botStats.startedAt"),
    lastUpdatedAt: date(stored.lastUpdatedAt, "botStats.lastUpdatedAt"),
}));

// A guild's id is its document's id
export const guildConverter = converter<Guild, Omit<Stored<Guild>, "id">>((stored, id) => {
    const { updatedAt, ...rest } = stored;
    return {
        ...rest,
        id,
        ...(updatedAt !== undefined ? { updatedAt: date(updatedAt, "guild.updatedAt") } : {}),
    };
});
