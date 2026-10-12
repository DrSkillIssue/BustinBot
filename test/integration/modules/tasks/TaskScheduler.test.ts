import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import cron from "node-cron";
import { ChannelType, RESTJSONErrorCodes } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../fixtures.js";
import { DiscordError } from "../../../discord/harness.js";
import { IDS } from "../../../discord/payloads.js";
import {
    getDefaultChannel,
    initTaskScheduler,
    stopTaskScheduler,
} from "../../../../src/modules/tasks/TaskScheduler.js";

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
        const poll = [...cron.getTasks().values()].find((job) => job.name === `taskScheduler:${IDS.guild}:poll`);
        assert(poll);

        await expect(poll.execute()).rejects.toBe(unavailable);

        expect(error).toHaveBeenCalledWith(`[taskScheduler:${IDS.guild}:poll]`, unavailable);
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
