import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import cron from "node-cron";
import { ChannelType, RESTJSONErrorCodes } from "discord-api-types/v10";
import { beforeEach, describe, expect, storePollableTasks, test, vi } from "../../../fixtures.js";
import { DiscordError } from "../../../discord/harness.js";
import { IDS } from "../../../discord/payloads.js";
import { TaskCategory } from "../../../../src/models/Task.js";
import {
    getDefaultChannel,
    getNextEventDate,
    getNextPollDate,
    getNextPrizeDrawDate,
    initTaskScheduler,
    stopTaskScheduler,
} from "../../../../src/modules/tasks/TaskScheduler.js";

// A guild's scheduled job, by its name
function scheduledJob(guildId: string, name: string) {
    const job = [...cron.getTasks().values()].find(
        (candidate) => candidate.name === `taskScheduler:${guildId}:${name}`,
    );
    assert(job);
    return job;
}

// Today at the given minute past noon, on the host's clock that the dev-mode cycle reads
const atMinute = (minute: number): Date =>
    DateTime.now().set({ hour: 12, minute, second: 0, millisecond: 0 }).toJSDate();

describe("task scheduler", () => {
    test("schedules the weekly poll, task start, prize draw and leaderboard jobs at midnight UTC", async ({
        discord,
        services,
        scheduledJobs,
    }) => {
        await initTaskScheduler(discord.client, services);

        expect(scheduledJobs(IDS.guild)).toEqual({
            poll: "0 0 * * 0",
            taskStart: "0 0 * * 1",
            prizeDraw: "0 0 * * 2",
            leaderboardWarning: "0 0 * * 2",
            leaderboardUpdate: "0 0 * * 3",
        });
        for (const job of cron.getTasks().values()) {
            const nextRun = job.getNextRun();
            expect([nextRun?.getUTCHours(), nextRun?.getUTCMinutes()]).toEqual([0, 0]);
        }
    });

    test("keeps each guild's jobs separate, and scheduling again replaces a guild's jobs instead of adding more", async ({
        discord,
        services,
        otherGuild,
        scheduledJobs,
    }) => {
        await initTaskScheduler(discord.client, services);
        await initTaskScheduler(discord.client, otherGuild);
        await initTaskScheduler(discord.client, services);

        expect(Object.keys(scheduledJobs(IDS.guild))).toHaveLength(5);
        expect(Object.keys(scheduledJobs(IDS.otherGuild))).toHaveLength(5);
        expect(cron.getTasks().size).toBe(10);

        await stopTaskScheduler(IDS.guild);

        expect(scheduledJobs(IDS.guild)).toEqual({});
        expect(Object.keys(scheduledJobs(IDS.otherGuild))).toHaveLength(5);
    });
    test("logs a job that fails under the job's name", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await initTaskScheduler(discord.client, services);
        // The emulator can't be made to fail one read, so the guild read fails the way an unreachable Firestore fails it
        const unavailable = Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 });
        vi.spyOn(services.guilds, "get").mockRejectedValueOnce(unavailable);

        await expect(scheduledJob(IDS.guild, "poll").execute()).rejects.toBe(unavailable);

        expect(error).toHaveBeenCalledWith(`[taskScheduler:${IDS.guild}:poll]`, unavailable);
    });
});

describe("the dev-mode task cycle", () => {
    // BOT_MODE=dev runs the weekly cycle every 7 minutes so it can be tried out on the dev server
    beforeEach(() => {
        vi.stubEnv("BOT_MODE", "dev");
        vi.stubEnv("DISCORD_GUILD_ID_DEV", IDS.guild);
    });

    test("is one job that runs every minute", async ({ discord, services, scheduledJobs }) => {
        await initTaskScheduler(discord.client, services);

        expect(scheduledJobs(IDS.guild)).toEqual({ test: "* * * * *" });
    });

    test("reports when its next poll, task start and prize draw come", async ({ discord, services }) => {
        vi.setSystemTime(atMinute(2));

        await initTaskScheduler(discord.client, services);

        expect([getNextPollDate(), getNextEventDate(), getNextPrizeDrawDate()]).toEqual([
            atMinute(6),
            atMinute(7),
            atMinute(15),
        ]);
    });

    test("posts the polls the minute before each 7-minute mark and starts their tasks on the mark", async ({
        discord,
        services,
        factories,
    }) => {
        await storePollableTasks(factories);
        await services.repos.keywordRepo.addKeyword("Bustin");
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageEdits(IDS.channel);
        await initTaskScheduler(discord.client, services);
        const job = scheduledJob(IDS.guild, "test");

        vi.setSystemTime(atMinute(6));
        await job.execute();
        const categories = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc];
        const polls = await Promise.all(
            categories.map((category) => services.repos.taskRepo.getActiveTaskPollByCategory(category)),
        );
        expect(polls).toEqual(categories.map((category) => expect.objectContaining({ category, isActive: true })));
        expect(await services.repos.taskRepo.getLatestTaskEvent()).toBeNull();

        vi.setSystemTime(atMinute(7));
        await job.execute();
        // Nobody voted, so each category starts its poll's first option
        const started = await services.repos.taskRepo.getTaskEventsBetween(
            atMinute(7),
            DateTime.fromJSDate(atMinute(7)).plus({ weeks: 2 }).toJSDate(),
        );
        expect(started.map((event) => event.task.id).sort()).toEqual(polls.map((poll) => poll?.options[0]?.id).sort());
    });

    test("draws the prize one minute after every other 7-minute mark", async ({ discord, services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await initTaskScheduler(discord.client, services);
        const job = scheduledJob(IDS.guild, "test");

        vi.setSystemTime(atMinute(8));
        await job.execute();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([]);

        vi.setSystemTime(atMinute(15));
        await job.execute();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([
            expect.objectContaining({ totalEntries: 0 }),
        ]);
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });

    test("does nothing on the other minutes", async ({ discord, services, factories }) => {
        await storePollableTasks(factories);
        await initTaskScheduler(discord.client, services);

        vi.setSystemTime(atMinute(2));
        await scheduledJob(IDS.guild, "test").execute();

        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toBeNull();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([]);
        expect(discord.requests()).toEqual([]);
    });
});

describe("the task channel", () => {
    test("is the configured text channel", async ({ discord, services }) => {
        expect((await getDefaultChannel(discord.client, services))?.id).toBe(IDS.channel);
    });

    test("is missing when none is configured", async ({ discord, services }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: "" } });

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
    });

    test("is missing when the configured channel is not a text channel", async ({ discord, services }) => {
        const category = SnowflakeUtil.generate().toString();
        await services.guilds.update(IDS.guild, { channels: { taskChannel: category } });
        discord.channel({
            id: category,
            type: ChannelType.GuildCategory,
            guild_id: IDS.guild,
            name: "Tasks",
            position: 0,
            permission_overwrites: [],
        });

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
    });

    test("is reported missing when the configured channel no longer exists", async ({ discord, services }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
        expect(warn).toHaveBeenCalledWith(
            `[TaskScheduler] Can't reach the task channel ${IDS.missingChannel} in ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
    });
});
