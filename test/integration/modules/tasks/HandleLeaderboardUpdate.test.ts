import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test, vi, type StoringFactories } from "../../../fixtures.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../../../firestoreEmulator.js";
import type { ServiceContainer } from "../../../../src/core/services/ServiceContainer.js";
import { DiscordError, type DiscordHarness } from "../../../discord/harness.js";
import { AS, IDS, NAMES, apiGuildMember, apiRole, apiUser } from "../../../discord/payloads.js";
import { leaderboardPeriodFactory, taskFactory } from "../../../factories.js";
import { SubmissionStatus } from "../../../../src/models/TaskSubmission.js";
import type { TaskLeaderboard } from "../../../../src/models/TaskLeaderboard.js";
import {
    postPeriodicLeaderboardUpdate,
    warnPendingLeaderboardFinalization,
} from "../../../../src/modules/tasks/HandleLeaderboardUpdate.js";

const [winner, runnerUp, third] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

// Weekly task events, each starting on its own day; `ended` of them are over
async function storeWeeks(factories: StoringFactories, count: number, ended: number): Promise<string[]> {
    const ids: string[] = [];
    for (let week = 0; week < count; week++) {
        const id = `week-${week + 1}`;
        const endTime = DateTime.now().plus({ days: week < ended ? -(ended - week) : week + 1 });
        await factories.taskEvent.create({
            id,
            task: taskFactory.build({ id }),
            startTime: endTime.minus({ days: 7 }).toJSDate(),
            endTime: endTime.toJSDate(),
        });
        ids.push(id);
    }
    return ids;
}

async function storePeriodic(factories: StoringFactories, overrides: Partial<TaskLeaderboard>): Promise<void> {
    await factories.periodicLeaderboard.create(overrides);
    await factories.lifetimeLeaderboard.create();
}

// Champion roles set up in the guild, and the members who placed, as Discord knows them
async function setUpChampions(discord: DiscordHarness, services: ServiceContainer) {
    const roles = {
        first: apiRole({ name: "Task Champion (1st)" }),
        second: apiRole({ name: "Task Champion (2nd)" }),
        third: apiRole({ name: "Task Champion (3rd)" }),
    };
    for (const role of Object.values(roles)) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, {
        roles: {
            taskChampionFirst: roles.first.id,
            taskChampionSecond: roles.second.id,
            taskChampionThird: roles.third.id,
        },
    });
    const dms: Record<string, string> = {};
    for (const [index, userId] of [winner, runnerUp, third].entries()) {
        const user = apiUser({ id: userId, username: `member${index + 1}`, global_name: `member${index + 1}` });
        discord.member(IDS.guild, apiGuildMember({ user }));
        dms[userId] = discord.acceptDirectMessages(user);
    }
    return { roles, dms };
}

describe("the weekly leaderboard update", () => {
    test("posts the current standings with the week of the period", async ({ discord, services, factories }) => {
        const events = await storeWeeks(factories, 2, 1);
        await storePeriodic(factories, {
            points: { [winner]: 6 },
            tierCounts: { [winner]: { bronze: 0, silver: 0, gold: 1 } },
            period: leaderboardPeriodFactory.build({ eventIds: events }),
        });
        discord.member(
            IDS.guild,
            apiGuildMember({ user: apiUser({ id: winner, username: "member1", global_name: "member1" }) }),
        );
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const [posted] = discord.messagesSentTo(IDS.channel);
        const embed = posted?.embeds?.[0];
        expect(embed?.title).toBe("🏆 Current Leaderboard Standings");
        expect(embed?.fields).toContainEqual({ name: "Period Progress", value: "Week 2 of 4" });
        expect(embed?.fields?.[0]?.value).toMatch(/^🥇\s+member1\s+6\s+0\s+0\s+1$/m);
        expect(embed?.footer?.text).toBe("Task events elapsed: 1/4");
    });

    test(
        "ends the period once however many runs see it finished: champions, final standings and congratulations",
        async ({ discord, services, factories }) => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const events = await storeWeeks(factories, 4, 4);
            const period = leaderboardPeriodFactory.build({ eventIds: events });
            await storePeriodic(factories, { points: { [winner]: 9, [runnerUp]: 6, [third]: 1 }, period });
            const { roles, dms } = await setUpChampions(discord, services);
            discord.acceptMessages(IDS.channel);

            await Promise.all([
                postPeriodicLeaderboardUpdate(discord.client, services),
                postPeriodicLeaderboardUpdate(discord.client, services),
            ]);

            const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
            expect(stored).toMatchObject({
                points: {},
                period: { index: period.index + 1, eventIds: [] },
                completedPeriod: {
                    index: period.index,
                    topThree: [
                        { userId: winner, points: 9 },
                        { userId: runnerUp, points: 6 },
                        { userId: third, points: 1 },
                    ],
                },
                champions: { first: [winner], second: [runnerUp], third: [third], periodIndex: period.index },
            });
            expect(discord.memberRoleChanges("PUT").sort()).toEqual(
                [`${winner}:${roles.first.id}`, `${runnerUp}:${roles.second.id}`, `${third}:${roles.third.id}`].sort(),
            );
            expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });
            const finals = discord
                .messagesSentTo(IDS.channel)
                .filter((message) => message.embeds?.[0]?.title === "🏆 Final Leaderboard Standings");
            expect(finals).toHaveLength(1);
            expect(finals[0]?.embeds?.[0]?.fields?.[0]?.value).toBe("🥇 member1\n🥈 member2\n🥉 member3");
            expect(discord.messagesSentTo(dms[winner]!)).toEqual([
                expect.objectContaining({
                    content: `🏆 Congratulations! You placed **1st** on the periodic task leaderboard in **${NAMES.guild}**.\nYou have been awarded the **Task Champion (1st)** role to flex.`,
                }),
            ]);
            expect(warn).toHaveBeenCalledWith(`[LeaderboardUpdate] Period ${period.index} had already ended.`);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("awards a period once when its final post can't be made, so /taskboard final can post it", async ({
        discord,
        services,
        slash,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(factories, 4, 4);
        await storePeriodic(factories, {
            points: { [winner]: 9 },
            period: leaderboardPeriodFactory.build({ eventIds: events }),
        });
        await setUpChampions(discord, services);
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel, { persist: true });

        await postPeriodicLeaderboardUpdate(discord.client, services);
        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(warn).toHaveBeenCalledWith("[LeaderboardUpdate] Task channel not found for leaderboard update.");
        expect(discord.memberRoleChanges("PUT")).toHaveLength(1);
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });

        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.channel } });
        discord.acceptMessages(IDS.channel);
        const command = await slash(
            "taskboard",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "final" }],
            AS.botAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Final leaderboard posted." }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]).toMatchObject({
            title: "🏆 Final Leaderboard Standings",
        });
    });
});

describe("/taskboard", () => {
    test("says so when the task channel can't be reached", async ({ discord, services, slash, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storePeriodic(factories, {});
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        const command = await slash(
            "taskboard",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "update" }],
            AS.botAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Couldn't post the leaderboard: the task channel isn't set up or I can't reach it, or there is no leaderboard period yet.",
            }),
        ]);
        expect(warn).toHaveBeenCalledWith("[LeaderboardUpdate] Task channel not found for leaderboard update.");
    });
});

describe("the warning before a period ends", () => {
    test("tells the task admins how many submissions still need reviewing", async ({
        discord,
        services,
        factories,
    }) => {
        const events = await storeWeeks(factories, 4, 4);
        await storePeriodic(factories, { period: leaderboardPeriodFactory.build({ eventIds: events }) });
        for (const [index, eventId] of ["week-1", "week-4", "week-4"].entries()) {
            await factories.taskSubmission.create({
                id: `pending-${index}`,
                taskEventId: eventId,
                status: SubmissionStatus.Pending,
            });
        }
        await factories.taskSubmission.create({ id: "reviewed", taskEventId: "week-4", status: SubmissionStatus.Gold });
        discord.acceptMessages(IDS.channel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: `<@&${IDS.roles.taskAdmin}> There are 3 pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`,
            }),
        ]);
    });

    test("is skipped with a warning when the verification channel is gone", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(factories, 4, 4);
        await storePeriodic(factories, { period: leaderboardPeriodFactory.build({ eventIds: events }) });
        await factories.taskSubmission.create({ taskEventId: "week-4", status: SubmissionStatus.Pending });
        await services.guilds.update(IDS.guild, { channels: { taskVerification: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[LeaderboardUpdate] Task verification channel ${IDS.missingChannel} not found; pending submissions not announced.`,
        );
    });
});
