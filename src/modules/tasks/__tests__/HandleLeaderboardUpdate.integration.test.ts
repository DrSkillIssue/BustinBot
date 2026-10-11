import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import type { DiscordHarness } from "../../../tests/discord/harness.js";
import { IDS, apiGuildMember, apiRole, apiUser } from "../../../tests/discord/payloads.js";
import { buildTask, buildTaskEvent, buildTaskSubmission } from "../../../tests/fakes/builders.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import type { TaskLeaderboard } from "../../../models/TaskLeaderboard.js";
import { postPeriodicLeaderboardUpdate, warnPendingLeaderboardFinalization } from "../HandleLeaderboardUpdate.js";

const DAY = 24 * 60 * 60 * 1000;
const [winner, runnerUp, third] = ["100000000000000031", "100000000000000032", "100000000000000033"];
const DELETED_CHANNEL = "100000000000000099";

// Weekly task events, each starting on its own day; `ended` of them are over
async function storeWeeks(services: ServiceContainer, count: number, ended: number): Promise<string[]> {
    const ids: string[] = [];
    for (let week = 0; week < count; week++) {
        const id = `week-${week + 1}`;
        const endTime = new Date(Date.now() + (week < ended ? -(ended - week) * DAY : (week + 1) * DAY));
        await services.repos.taskRepo!.createTaskEvent(buildTaskEvent({
            id, task: buildTask({ id }), startTime: new Date(endTime.getTime() - 7 * DAY), endTime,
        }));
        ids.push(id);
    }
    return ids;
}

async function storePeriodic(services: ServiceContainer, overrides: Partial<TaskLeaderboard>): Promise<void> {
    await services.repos.taskLeaderboardRepo!.createLeaderboard({
        id: "periodic", points: {}, tierCounts: {}, createdAt: "", updatedAt: "",
        period: { length: 4, eventIds: [], startedAt: "", index: 1 },
        ...overrides,
    });
    await services.repos.taskLeaderboardRepo!.createLeaderboard({ id: "lifetime", points: {}, createdAt: "", updatedAt: "" });
}

// Champion roles set up in the guild, and the members who placed, as Discord knows them
async function setUpChampions(discord: DiscordHarness, services: ServiceContainer) {
    const roles = { first: apiRole({ name: "Task Champion (1st)" }), second: apiRole({ name: "Task Champion (2nd)" }), third: apiRole({ name: "Task Champion (3rd)" }) };
    for (const role of Object.values(roles)) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, { roles: { ...IDS.roles, taskChampionFirst: roles.first.id, taskChampionSecond: roles.second.id, taskChampionThird: roles.third.id } });
    const dms: Record<string, string> = {};
    for (const [index, userId] of [winner, runnerUp, third].entries()) {
        const user = apiUser({ id: userId, username: `member${index + 1}`, global_name: `member${index + 1}` });
        discord.user(user);
        discord.member(IDS.guild, apiGuildMember({ user }));
        discord.acceptMemberRoleChanges(IDS.guild, userId);
        dms[userId] = discord.acceptDirectMessages(userId);
    }
    return { roles, dms };
}

describe("the weekly leaderboard update", () => {
    test("posts the current standings with the week of the period", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const events = await storeWeeks(services, 2, 1);
        await storePeriodic(services, { points: { [winner]: 6 }, tierCounts: { [winner]: { bronze: 0, silver: 0, gold: 1 } }, period: { length: 4, eventIds: events, startedAt: "", index: 1 } });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: winner, username: "member1", global_name: "member1" }) }));
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const [posted] = discord.messagesSentTo(IDS.channel);
        const embed = posted?.embeds?.[0];
        expect(embed?.title).toBe("🏆 Current Leaderboard Standings");
        expect(embed?.fields).toContainEqual({ name: "Period Progress", value: "Week 2 of 4" });
        expect(embed?.fields?.[0]?.value).toMatch(/^🥇\s+member1\s+6\s+0\s+0\s+1$/m);
        expect(embed?.footer?.text).toBe("Task events elapsed: 1/4");
    });

    test("ends the period once however many runs see it finished: champions, final standings and congratulations", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(services, 4, 4);
        await storePeriodic(services, { points: { [winner]: 9, [runnerUp]: 6, [third]: 1 }, period: { length: 4, eventIds: events, startedAt: "", index: 1 } });
        const { roles, dms } = await setUpChampions(discord, services);
        discord.acceptMessages(IDS.channel);

        await Promise.all([postPeriodicLeaderboardUpdate(discord.client, services), postPeriodicLeaderboardUpdate(discord.client, services)]);

        const stored = await services.repos.taskLeaderboardRepo!.getLeaderboard("periodic");
        expect(stored).toMatchObject({
            points: {}, period: { index: 2, eventIds: [] },
            completedPeriod: { index: 1, topThree: [{ userId: winner, points: 9 }, { userId: runnerUp, points: 6 }, { userId: third, points: 1 }] },
            champions: { first: [winner], second: [runnerUp], third: [third], periodIndex: 1 },
        });
        expect(discord.memberRoleChanges("PUT").sort()).toEqual([`${winner}:${roles.first.id}`, `${runnerUp}:${roles.second.id}`, `${third}:${roles.third.id}`].sort());
        expect(await services.repos.userRepo!.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });
        const finals = discord.messagesSentTo(IDS.channel).filter((message) => message.embeds?.[0]?.title === "🏆 Final Leaderboard Standings");
        expect(finals).toHaveLength(1);
        expect(finals[0]?.embeds?.[0]?.fields?.[0]?.value).toBe("🥇 member1\n🥈 member2\n🥉 member3");
        expect(discord.messagesSentTo(dms[winner]!)).toEqual([expect.objectContaining({
            content: "🏆 Congratulations! You placed **1st** on the periodic task leaderboard in **Test Guild**.\nYou have been awarded the **Task Champion (1st)** role to flex.",
        })]);
        expect(warn).toHaveBeenCalledWith("[LeaderboardUpdate] Period 1 had already ended.");
    });

    test("awards a period once when its final post can't be made, so /taskboard final can post it", async ({ discord, services, slash }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(services, 4, 4);
        await storePeriodic(services, { points: { [winner]: 9 }, period: { length: 4, eventIds: events, startedAt: "", index: 1 } });
        await setUpChampions(discord, services);
        await services.guilds.update(IDS.guild, { channels: { ...(await services.guilds.get(IDS.guild))!.channels, taskChannel: DELETED_CHANNEL } });
        discord.api
            .intercept({ path: `/api/v10/channels/${DELETED_CHANNEL}`, method: "GET" })
            .reply(404, { code: 10003, message: "Unknown Channel" }, { headers: { "content-type": "application/json" } })
            .persist();

        await postPeriodicLeaderboardUpdate(discord.client, services);
        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(warn).toHaveBeenCalledWith("[LeaderboardUpdate] Task channel not found for leaderboard update.");
        expect(discord.memberRoleChanges("PUT")).toHaveLength(1);
        expect(await services.repos.userRepo!.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });

        await services.guilds.update(IDS.guild, { channels: { ...(await services.guilds.get(IDS.guild))!.channels, taskChannel: IDS.channel } });
        discord.acceptMessages(IDS.channel);
        const command = await slash("taskboard", [{ type: 1, name: "final" }], { member: { ...apiGuildMember({ user: apiUser() }), roles: [IDS.roles.admin], permissions: "0" } });

        expect(discord.originalEdits(command)).toEqual([expect.objectContaining({ content: "Final leaderboard posted." })]);
        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]).toMatchObject({ title: "🏆 Final Leaderboard Standings" });
    });
});

describe("/taskboard", () => {
    test("says so when the task channel can't be reached", async ({ discord, services, slash }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await storePeriodic(services, {});
        await services.guilds.update(IDS.guild, { channels: { ...(await services.guilds.get(IDS.guild))!.channels, taskChannel: DELETED_CHANNEL } });
        discord.api
            .intercept({ path: `/api/v10/channels/${DELETED_CHANNEL}`, method: "GET" })
            .reply(404, { code: 10003, message: "Unknown Channel" }, { headers: { "content-type": "application/json" } });

        const command = await slash("taskboard", [{ type: 1, name: "update" }], { member: { ...apiGuildMember({ user: apiUser() }), roles: [IDS.roles.admin], permissions: "0" } });

        expect(discord.originalEdits(command)).toEqual([expect.objectContaining({
            content: "Couldn't post the leaderboard: the task channel isn't set up or I can't reach it, or there is no leaderboard period yet.",
        })]);
    });
});

describe("the warning before a period ends", () => {
    test("tells the task admins how many submissions still need reviewing", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const events = await storeWeeks(services, 4, 4);
        await storePeriodic(services, { period: { length: 4, eventIds: events, startedAt: "", index: 1 } });
        for (const [index, eventId] of ["week-1", "week-4", "week-4"].entries()) {
            await services.repos.taskRepo!.createSubmission(buildTaskSubmission({ id: `pending-${index}`, taskEventId: eventId, status: SubmissionStatus.Pending }));
        }
        await services.repos.taskRepo!.createSubmission(buildTaskSubmission({ id: "reviewed", taskEventId: "week-4", status: SubmissionStatus.Gold }));
        discord.acceptMessages(IDS.channel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([expect.objectContaining({
            content: `<@&${IDS.roles.taskAdmin}> There are 3 pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`,
        })]);
    });

    test("is skipped with a warning when the verification channel is gone", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(services, 4, 4);
        await storePeriodic(services, { period: { length: 4, eventIds: events, startedAt: "", index: 1 } });
        await services.repos.taskRepo!.createSubmission(buildTaskSubmission({ taskEventId: "week-4", status: SubmissionStatus.Pending }));
        await services.guilds.update(IDS.guild, { channels: { ...(await services.guilds.get(IDS.guild))!.channels, taskVerification: DELETED_CHANNEL } });
        discord.api
            .intercept({ path: `/api/v10/channels/${DELETED_CHANNEL}`, method: "GET" })
            .reply(404, { code: 10003, message: "Unknown Channel" }, { headers: { "content-type": "application/json" } });

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(warn).toHaveBeenCalledWith(`[LeaderboardUpdate] Task verification channel ${DELETED_CHANNEL} not found; pending submissions not announced.`);
    });
});
