import { SnowflakeUtil } from "discord.js";
import { Factory } from "fishery";
import { TaskCategory, TaskType, type Task } from "../models/Task.js";
import type { TaskEvent } from "../models/TaskEvent.js";
import { newUserStats, type UserStats } from "../models/UserStats.js";
import { SubmissionStatus, type TaskSubmission, type TaskSubmissionDraft } from "../models/TaskSubmission.js";
import type { TaskPoll } from "../models/TaskPoll.js";
import type { Guild, TaskMilestoneRole } from "../models/Guild.js";
import type { Movie } from "../models/Movie.js";
import type { MovieEvent } from "../models/MovieEvent.js";
import type { MoviePoll } from "../models/MoviePoll.js";
import type { TaskLeaderboard, TaskLeaderboardPeriod } from "../models/TaskLeaderboard.js";
import type { PrizeDraw } from "../models/PrizeDraw.js";
import type { BotStats } from "../models/BotStats.js";
import type { Keyword } from "../models/Keyword.js";
import type { TaskFeedback } from "../models/TaskFeedback.js";
import { IDS } from "./discord/payloads.js";

// fishery factories: each builds a complete, valid domain object; tests pass only the fields they care about.

export const taskFactory = Factory.define<Task>(() => ({
    id: "PVM001",
    taskName: "Kill {amount} Zulrah",
    category: TaskCategory.PvM,
    type: TaskType.KC,
    amtBronze: 10,
    amtSilver: 25,
    amtGold: 50,
    weight: 50,
}));

export const taskEventFactory = Factory.define<TaskEvent>(({ params }) => {
    const task = taskFactory.build(params.task);
    return {
        id: `${task.id}-20260105`,
        task,
        category: task.category,
        amounts: { bronze: task.amtBronze, silver: task.amtSilver, gold: task.amtGold },
        keyword: "keyword",
        startTime: new Date("2026-01-05T00:00:00.000Z"),
        endTime: new Date("2026-01-12T00:00:00.000Z"),
        completionCounts: { bronze: 0, silver: 0, gold: 0 },
        completedUserIds: [],
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
    };
});

export const userStatsFactory = Factory.define<UserStats>(() => newUserStats(IDS.user, new Date("2026-01-01T00:00:00.000Z")));

export const taskSubmissionFactory = Factory.define<TaskSubmission>(() => ({
    id: "submission-1",
    userId: IDS.user,
    taskEventId: "PVM001-20260105",
    taskName: "Kill 10 Zulrah",
    screenshotUrls: ["https://cdn.discordapp.com/attachments/1/2/proof.png"],
    status: SubmissionStatus.Pending,
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
}));

// A member's click on Submit, waiting for their screenshots
export const submissionDraftFactory = Factory.define<TaskSubmissionDraft>(() => ({
    userId: IDS.user,
    taskEventId: "PVM001-20260105",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
}));

export const taskPollFactory = Factory.define<TaskPoll>(() => ({
    id: "poll-1",
    type: "task",
    category: TaskCategory.PvM,
    options: [taskFactory.build({ id: "PVM001" }), taskFactory.build({ id: "PVM002" }), taskFactory.build({ id: "PVM003" })],
    // Posted in the harness guild's channel, so flows that fetch the poll message reach the harness
    messageId: SnowflakeUtil.generate().toString(),
    channelId: IDS.channel,
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    endsAt: new Date("2026-01-05T00:00:00.000Z"),
    isActive: true,
    votes: {},
}));

// A member's 👍/👎 on a task
export const taskFeedbackFactory = Factory.define<Omit<TaskFeedback, "id">>(() => ({
    taskId: "PVM001",
    eventId: "PVM001-20260105",
    userId: IDS.user,
    vote: "up",
}));

// A fully set-up guild whose ids match the Discord harness's guild, channel and roles
export const guildFactory = Factory.define<Guild>(() => ({
    id: IDS.guild,
    toggles: { taskScheduler: false, leaguesEnabled: false },
    roles: { ...IDS.roles },
    channels: { announcements: IDS.channel, taskChannel: IDS.channel, taskVerification: IDS.channel, movieNight: IDS.channel },
    setupComplete: { core: true, movie: true, task: true },
    timezone: "UTC",
}));

export const milestoneRoleFactory = Factory.define<TaskMilestoneRole>(({ params }) => {
    const roleId = params.roleId ?? SnowflakeUtil.generate().toString();
    return { id: roleId, label: "Task Participant", roleId, requiredSubmissions: 5, enabled: true };
});

export const keywordFactory = Factory.define<Keyword>(() => ({
    id: "keyword",
    word: "keyword",
    lastUsedAt: new Date(0),
    timesUsed: 0,
    usageHistory: [],
}));

export const movieFactory = Factory.define<Movie>(() => ({
    id: "movie-1",
    title: "Inception",
    watched: false,
    addedBy: IDS.user,
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
    runtime: 148,
}));

// A scheduled movie night, announced in the harness channel
export const movieEventFactory = Factory.define<MovieEvent>(({ params }) => ({
    id: "event-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    startTime: new Date("2026-01-03T20:00:00.000Z"),
    movie: movieFactory.build(params.movie),
    channelId: IDS.channel,
    completed: false,
    hostedBy: IDS.user,
}));

// An open movie poll, posted in the harness channel
export const moviePollFactory = Factory.define<MoviePoll>(() => ({
    id: "poll-1",
    type: "movie",
    options: [movieFactory.build({ id: "movie-1" }), movieFactory.build({ id: "movie-2", title: "Arrival" })],
    messageId: SnowflakeUtil.generate().toString(),
    channelId: IDS.channel,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-01-02T00:00:00.000Z"),
    isActive: true,
    votes: {},
}));

// The first period of four weekly task events, with none registered yet
export const leaderboardPeriodFactory = Factory.define<TaskLeaderboardPeriod>(() => ({
    length: 4,
    eventIds: [],
    startedAt: "2026-01-05T00:00:00.000Z",
    index: 1,
}));

// The periodic task leaderboard in the first period of a guild's task events
export const periodicLeaderboardFactory = Factory.define<TaskLeaderboard>(({ params }) => ({
    id: "periodic",
    points: {},
    tierCounts: {},
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    period: leaderboardPeriodFactory.build(params.period),
}));

export const lifetimeLeaderboardFactory = Factory.define<TaskLeaderboard>(() => ({
    id: "lifetime",
    points: {},
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
}));

// A prize draw's snapshot, taken but not yet rolled
export const prizeDrawFactory = Factory.define<PrizeDraw>(() => ({
    id: "2026-01-05_to_2026-01-18",
    start: "2026-01-05T00:00:00.000Z",
    end: "2026-01-18T23:59:59.999Z",
    snapshotTakenAt: "2026-01-19T00:00:00.000Z",
    participants: {},
    entries: [],
    totalEntries: 0,
}));

export const botStatsFactory = Factory.define<BotStats>(() => ({
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
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
    lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
}));
