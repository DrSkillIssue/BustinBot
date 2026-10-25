import {
    Timestamp,
    type DocumentData,
    type FirestoreDataConverter,
    type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { cloneDeepWith } from "es-toolkit";
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
import type { TaskSubmission, TaskSubmissionDraft } from "../../models/TaskSubmission.js";
import { newUserStats, type UserStats } from "../../models/UserStats.js";

function storedDocument(snapshot: QueryDocumentSnapshot): DocumentData {
    return cloneDeepWith(snapshot.data(), (value) => (value instanceof Timestamp ? value.toDate() : undefined));
}

function converter<T extends DocumentData>(): FirestoreDataConverter<T> {
    return {
        toFirestore: (model) => model,
        fromFirestore: (snapshot) => storedDocument(snapshot) as T,
    };
}

export const movieConverter = converter<Movie>();
export const moviePollConverter = converter<MoviePoll>();
export const movieEventConverter = converter<MovieEvent>();
export const taskConverter = converter<Task>();
export const taskPollConverter = converter<TaskPoll>();
export const taskEventConverter = converter<TaskEvent>();
export const taskSubmissionConverter = converter<TaskSubmission>();
export const taskSubmissionDraftConverter = converter<TaskSubmissionDraft>();
export const taskFeedbackConverter = converter<TaskFeedback>();
export const taskLeaderboardConverter = converter<TaskLeaderboard>();
export const prizeDrawConverter = converter<PrizeDraw>();
export const keywordConverter = converter<Keyword>();
export const botStatsConverter = converter<BotStats>();

export const guildConverter: FirestoreDataConverter<Guild> = {
    toFirestore: (guild) => guild,
    fromFirestore: (snapshot) => ({ ...(storedDocument(snapshot) as Omit<Guild, "id">), id: snapshot.id }),
};

interface StoredUserStats extends Partial<UserStats> {
    userId: string;
    createdAt?: Date;
}

export const userStatsConverter: FirestoreDataConverter<UserStats> = {
    toFirestore: (stats) => stats,
    fromFirestore: (snapshot) => {
        const { createdAt, joinedAt, ...stored } = storedDocument(snapshot) as StoredUserStats;
        const joined = joinedAt ?? createdAt ?? snapshot.createTime.toDate();
        return { ...newUserStats(stored.userId, joined), ...stored, lastActiveAt: stored.lastActiveAt ?? joined };
    },
};
