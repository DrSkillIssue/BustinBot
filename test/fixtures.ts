import path from "node:path";
import cron from "node-cron";
import type { Interaction, Message } from "discord.js";
import type {
    APIInteraction,
    GatewayMessageCreateDispatchData,
    GatewayVoiceStateUpdateDispatchData,
} from "discord-api-types/v10";
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

// The fishery factories whose create() stores what they build in a guild, through its repositories
function storingFactories(db: Firestore, services: ServiceContainer) {
    const { repos } = services;
    const storedWith =
        <T>(store: (value: T) => Promise<unknown>) =>
        async (value: T) => {
            await store(value);
            return value;
        };
    return {
        task: taskFactory.onCreate(storedWith((task) => repos.taskRepo.createTask(task))),
        taskEvent: taskEventFactory.onCreate(storedWith((event) => repos.taskRepo.createTaskEvent(event))),
        taskPoll: taskPollFactory.onCreate(storedWith((poll) => repos.taskRepo.createTaskPoll(poll))),
        taskSubmission: taskSubmissionFactory.onCreate(
            storedWith((submission) => repos.taskRepo.createSubmission(submission)),
        ),
        submissionDraft: submissionDraftFactory.onCreate(
            storedWith((draft) => repos.taskRepo.saveSubmissionDraft(draft)),
        ),
        userStats: userStatsFactory.onCreate(storedWith((stats) => repos.userRepo.createUser(stats))),
        periodicLeaderboard: periodicLeaderboardFactory.onCreate(
            storedWith((board) => repos.taskLeaderboardRepo.createLeaderboard(board)),
        ),
        lifetimeLeaderboard: lifetimeLeaderboardFactory.onCreate(
            storedWith((board) => repos.taskLeaderboardRepo.createLeaderboard(board)),
        ),
        prizeDraw: prizeDrawFactory.onCreate(storedWith((draw) => repos.prizeRepo.createPrizeDraw(draw))),
        movie: movieFactory.onCreate(storedWith((movie) => repos.movieRepo.upsertMovie(movie))),
        movieEvent: movieEventFactory.onCreate(storedWith((event) => repos.movieRepo.createMovieEvent(event))),
        moviePoll: moviePollFactory.onCreate(storedWith((poll) => repos.movieRepo.createPoll(poll))),
        // No repository stores a keyword with its usage, so it is written as the keyword repository reads it
        keyword: keywordFactory.onCreate(
            storedWith((keyword) => db.doc(`guilds/${services.guildId}/keywords/${keyword.id}`).set(keyword)),
        ),
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

// Enough tasks for a poll in each of the given categories: three in each (PVM001 to PVM003 and so on), the skilling
// ones each in its own skill
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

// Delivers an interaction and routes it as the running bot does (the `interact` fixture)
export type Interact = (payload: APIInteraction) => Promise<Interaction>;

// The one test API for the suite. Fixtures are created only when a test asks for them:
// - http: the test's own undici MockAgent, answering only the requests the test declares; one the test expected but
//   the bot never made fails the test
// - discord: a real discord.js client logged in through a test gateway, with Discord's REST API answered by `http`
// - db: a Firestore emulator database of the test's own, so no test sees another's data (integration tests only)
// - services: the bot's real service container on the test's database, with a fully set-up guild
// - factories: the fishery factories whose create() stores what they build in the test guild, through its repositories
// - otherGuild: the service container of a second fully set-up guild, whose channels are all IDS.otherGuildChannel
// - uncachedGuild: a set-up guild discord.js hasn't cached; returns the interaction fields that place an interaction in it
// - commands: the bot's real slash command registry
// - interact: delivers any interaction (button, select, form) and routes it exactly as the running bot does
// - prefix: sends a channel message through the real prefix command handler
// - scheduledJobs: the node-cron jobs scheduled for a guild, by job name, with their cron patterns
// - voice: delivers a member's voice state change and hands it to the guild's movie attendance, as the bot does
export const test = base
    .extend("http", ({}, { onCleanup }) => {
        const offline = getGlobalDispatcher();
        const agent = new MockAgent({ enableCallHistory: true });
        agent.disableNetConnect();
        if (process.env.FIRESTORE_EMULATOR_HOST) agent.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
        setGlobalDispatcher(agent);
        onCleanup(async () => {
            setGlobalDispatcher(offline);
            // Routes registered to be used once are responses the test expected the bot to ask for; persistent
            // routes may go unused. (undici's own assertNoPendingInterceptors counts unused persistent routes too.)
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
    // Each test's database stays open until its file has finished, so work the bot finishes after a test (a shutdown
    // registered with onTestFinished) can still reach it
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
        await new GuildRepository(db).initGuild(guildFactory.build().id, guildFactory.build());
        const botStats = new BotStatsService(new BotRepository(db));
        await botStats.init();
        return createServiceContainer(db, guildFactory.build().id, botStats);
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
    .extend("scheduledJobs", () => (guildId: string): Record<string, string> => {
        const prefix = `taskScheduler:${guildId}:`;
        return Object.fromEntries(
            [...cron.getTasks().values()].flatMap((job) =>
                job.name?.startsWith(prefix) ? [[job.name.slice(prefix.length), job.getPattern()]] : [],
            ),
        );
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
