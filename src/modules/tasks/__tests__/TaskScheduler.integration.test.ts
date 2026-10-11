import cron from "node-cron";
import { ChannelType } from "discord-api-types/v10";
import { afterEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import { createServiceContainer } from "../../../core/services/ServiceFactory.js";
import { GuildRepository } from "../../../core/database/GuildRepo.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { buildGuild } from "../../../tests/fakes/builders.js";
import { getDefaultChannel, initTaskScheduler, stopTaskScheduler } from "../TaskScheduler.js";

const otherGuild = "100000000000000011";

// The guild's jobs as node-cron records them, by job name
function jobsOf(guildId: string): Record<string, string> {
    const prefix = `taskScheduler:${guildId}:`;
    return Object.fromEntries(
        [...cron.getTasks().values()]
            .filter((job) => job.name?.startsWith(prefix))
            .map((job) => [job.name!.slice(prefix.length), job.getPattern()])
    );
}

afterEach(async () => {
    vi.restoreAllMocks();
    await cron.shutdown();
});

describe("task scheduler", () => {
    test("schedules the weekly poll, task start, prize draw and leaderboard jobs at midnight UTC", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});

        await initTaskScheduler(discord.client, services);

        expect(jobsOf(IDS.guild)).toEqual({
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

    test("keeps each guild's jobs separate, and scheduling again replaces a guild's jobs instead of adding more", async ({ discord, services, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await new GuildRepository(db).initGuild(otherGuild, buildGuild({ id: otherGuild }));
        const otherServices = createServiceContainer(db, otherGuild, services.botStats);

        await initTaskScheduler(discord.client, services);
        await initTaskScheduler(discord.client, otherServices);
        await initTaskScheduler(discord.client, services);

        expect(Object.keys(jobsOf(IDS.guild))).toHaveLength(5);
        expect(Object.keys(jobsOf(otherGuild))).toHaveLength(5);
        expect(cron.getTasks().size).toBe(10);

        await stopTaskScheduler(IDS.guild);

        expect(jobsOf(IDS.guild)).toEqual({});
        expect(Object.keys(jobsOf(otherGuild))).toHaveLength(5);
    });
});

describe("the task channel", () => {
    test("is the configured text channel", async ({ discord, services }) => {
        expect((await getDefaultChannel(discord.client, services))?.id).toBe(IDS.channel);
    });

    test("is missing when none is configured", async ({ discord, services }) => {
        await services.guilds.update(IDS.guild, { channels: { ...buildGuild().channels, taskChannel: "" } });

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
    });

    test("is missing when the configured channel is not a text channel", async ({ discord, services }) => {
        const category = "100000000000000098";
        await services.guilds.update(IDS.guild, { channels: { ...buildGuild().channels, taskChannel: category } });
        discord.api
            .intercept({ path: `/api/v10/channels/${category}`, method: "GET" })
            .reply(200, { id: category, type: ChannelType.GuildCategory, guild_id: IDS.guild, name: "Tasks", position: 0, permission_overwrites: [] }, { headers: { "content-type": "application/json" } });

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
    });

    test("is reported missing when the configured channel no longer exists", async ({ discord, services }) => {
        const deleted = "100000000000000099";
        await services.guilds.update(IDS.guild, { channels: { ...buildGuild().channels, taskChannel: deleted } });
        discord.api
            .intercept({ path: `/api/v10/channels/${deleted}`, method: "GET" })
            .reply(404, { code: 10003, message: "Unknown Channel" }, { headers: { "content-type": "application/json" } });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await getDefaultChannel(discord.client, services)).toBeNull();
        expect(warn).toHaveBeenCalledWith(`[TaskScheduler] Can't reach the task channel ${deleted} in ${IDS.guild}:`, expect.objectContaining({ code: 10003 }));
    });
});
