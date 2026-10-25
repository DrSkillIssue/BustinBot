import path from "node:path";
import type { Interaction, Message } from "discord.js";
import type {
    APIInteraction,
    GatewayMessageCreateDispatchData,
    GatewayVoiceStateUpdateDispatchData,
} from "discord-api-types/v10";
import type { DateTime } from "luxon";
import { test as base } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createServiceContainer } from "../src/core/services/ServiceFactory.js";
import { BotStatsService } from "../src/core/services/BotStatsService.js";
import { BotRepository } from "../src/core/database/BotRepo.js";
import { loadCommands } from "../src/core/services/CommandService.js";
import { routeInteraction } from "../src/core/events/routeInteraction.js";
import { handleMessage } from "../src/core/events/onMessage.js";
import { GuildRepository } from "../src/core/database/GuildRepo.js";
import type { ServiceContainer } from "../src/core/services/ServiceContainer.js";
import { Skill, TaskCategory } from "../src/models/Task.js";
import type { Firestore } from "firebase-admin/firestore";
import { DiscordHarness } from "./discord/harness.js";
import { IDS, apiGuild, messageCreate } from "./discord/payloads.js";
import { newEmulatorDatabase } from "./firestoreEmulator.js";
import {
    guildFactory,
    keywordFactory,
    lifetimeLeaderboardFactory,
    movieEventFactory,
    movieFactory,
    moviePollFactory,
    periodicLeaderboardFactory,
    prizeDrawFactory,
    submissionDraftFactory,
    taskEventFactory,
    taskFactory,
    taskPollFactory,
    taskSubmissionFactory,
    userStatsFactory,
} from "./factories.js";

function storingFactories(db: Firestore, services: ServiceContainer) {
    const { repos } = services;
    return {
        task: taskFactory.onCreate(async (task) => {
            await repos.taskRepo.createTask(task);
            return task;
        }),
        taskEvent: taskEventFactory.onCreate(async (event) => {
            await repos.taskRepo.createTaskEvent(event);
            return event;
        }),
        taskPoll: taskPollFactory.onCreate(async (poll) => {
            await repos.taskRepo.createTaskPoll(poll);
            return poll;
        }),
        taskSubmission: taskSubmissionFactory.onCreate(async (submission) => {
            await repos.taskRepo.createSubmission(submission);
            return submission;
        }),
        submissionDraft: submissionDraftFactory.onCreate(async (draft) => {
            await repos.taskRepo.saveSubmissionDraft(draft);
            return draft;
        }),
        userStats: userStatsFactory.onCreate(async (stats) => {
            await repos.userRepo.createUser(stats);
            return stats;
        }),
        periodicLeaderboard: periodicLeaderboardFactory.onCreate(async (board) => {
            await repos.taskLeaderboardRepo.createLeaderboard(board);
            return board;
        }),
        lifetimeLeaderboard: lifetimeLeaderboardFactory.onCreate(async (board) => {
            await repos.taskLeaderboardRepo.createLeaderboard(board);
            return board;
        }),
        prizeDraw: prizeDrawFactory.onCreate(async (draw) => {
            await repos.prizeRepo.createPrizeDraw(draw);
            return draw;
        }),
        movie: movieFactory.onCreate(async (movie) => {
            await repos.movieRepo.upsertMovie(movie);
            return movie;
        }),
        movieEvent: movieEventFactory.onCreate(async (event) => {
            await repos.movieRepo.createMovieEvent(event);
            return event;
        }),
        moviePoll: moviePollFactory.onCreate(async (poll) => {
            await repos.movieRepo.createPoll(poll);
            return poll;
        }),
        keyword: keywordFactory.onCreate(async (keyword) => {
            await db.doc(`guilds/${services.guildId}/keywords/${keyword.id}`).set(keyword);
            return keyword;
        }),
    };
}

export type StoringFactories = ReturnType<typeof storingFactories>;

const TASK_ID_PREFIXES: Record<TaskCategory, string> = {
    [TaskCategory.PvM]: "PVM",
    [TaskCategory.Skilling]: "SKL",
    [TaskCategory.MinigameMisc]: "MIN",
    [TaskCategory.Leagues]: "LEA",
};
const POLL_SKILLS = [Skill.Mining, Skill.Fishing, Skill.Cooking];

export async function storeWeeks(factories: StoringFactories, firstStart: DateTime, ids: string[]): Promise<string[]> {
    for (const [week, id] of ids.entries()) {
        await factories.taskEvent.create({ id, startTime: firstStart.plus({ weeks: week }).toJSDate() });
    }
    return ids;
}

export async function storePollableTasks(
    factories: StoringFactories,
    categories: TaskCategory[] = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc],
): Promise<void> {
    for (const category of categories) {
        for (const [index, skill] of POLL_SKILLS.entries()) {
            await factories.task.create({
                id: `${TASK_ID_PREFIXES[category]}00${index + 1}`,
                category,
                ...(category === TaskCategory.Skilling ? { skill } : {}),
            });
        }
    }
}

export type Interact = (payload: APIInteraction) => Promise<Interaction>;

export const test = base
    .extend("http", ({}, { onCleanup }) => {
        const offline = getGlobalDispatcher();
        const agent = new MockAgent({ enableCallHistory: true });
        agent.disableNetConnect();
        if (process.env.FIRESTORE_EMULATOR_HOST) agent.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
        setGlobalDispatcher(agent);
        onCleanup(async () => {
            setGlobalDispatcher(offline);
            const unused = agent.pendingInterceptors().filter((interceptor) => !interceptor.persist);
            await agent.close();
            if (unused.length) {
                const routes = unused
                    .map(({ method, origin, path }) => `${method} ${origin}${String(path)}`)
                    .join("\n");
                throw new Error(`Expected requests were never made:\n${routes}`);
            }
        });
        return agent;
    })
    .extend("discord", async ({ http }, { onCleanup }) => {
        const discord = await DiscordHarness.start(http);
        onCleanup(() => discord.destroy());
        return discord;
    })
    .extend("openDatabases", { scope: "file" }, ({}, { onCleanup }) => {
        const databases: Firestore[] = [];
        onCleanup(async () => {
            await Promise.all(databases.map((db) => db.terminate()));
        });
        return databases;
    })
    .extend("db", ({ openDatabases }) => {
        const db = newEmulatorDatabase();
        openDatabases.push(db);
        return db;
    })
    .extend("services", async ({ db }) => {
        await new GuildRepository(db).initGuild(IDS.guild, guildFactory.build());
        const botStats = new BotStatsService(new BotRepository(db));
        await botStats.init();
        return createServiceContainer(db, IDS.guild, botStats);
    })
    .extend("factories", ({ db, services }) => storingFactories(db, services))
    .extend("otherGuild", async ({ db, services }) => {
        const channel = IDS.otherGuildChannel;
        const channels = {
            announcements: channel,
            taskChannel: channel,
            taskVerification: channel,
            movieNight: channel,
        };
        await new GuildRepository(db).initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild, channels }));
        return createServiceContainer(db, IDS.otherGuild, services.botStats);
    })
    .extend("uncachedGuild", async ({ db, discord }) => {
        await new GuildRepository(db).initGuild(IDS.uncachedGuild, guildFactory.build({ id: IDS.uncachedGuild }));
        discord.guild(apiGuild({ id: IDS.uncachedGuild }));
        return { guild_id: IDS.uncachedGuild };
    })
    .extend("commands", { scope: "file" }, () =>
        loadCommands(path.join(import.meta.dirname, "../src/modules/commands")),
    )
    .extend("interact", ({ discord, services, commands }): Interact => async (payload) => {
        const interaction = await discord.dispatch(payload);
        await routeInteraction(interaction, discord.client, commands, services);
        return interaction;
    })
    .extend("voice", ({ discord, services }) => async (state: GatewayVoiceStateUpdateDispatchData): Promise<void> => {
        const [oldState, newState] = await discord.voiceStateUpdate(state);
        services.movieAttendance.voiceStateChanged(oldState, newState);
    })
    .extend(
        "prefix",
        ({ discord, services, commands }) =>
            async (content: string, overrides: Partial<GatewayMessageCreateDispatchData> = {}): Promise<Message> => {
                const message = await discord.sendMessage(messageCreate(content, overrides));
                await handleMessage(message, commands, services);
                return message;
            },
    );

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
