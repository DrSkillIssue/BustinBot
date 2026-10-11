import { afterEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import { IDS, apiGuildMember, apiRole, apiUser } from "../../../tests/discord/payloads.js";
import { buildUserStats } from "../../../tests/fakes/builders.js";
import { applyTaskMilestoneRoles } from "../TaskMilestones.js";
import { awardTaskChampionRoles } from "../TaskLeaderboards.js";

const member = "100000000000000031";
const participant = apiRole({ name: "Task Participant" });
const enthusiast = apiRole({ name: "Task Enthusiast" });
const expert = apiRole({ name: "Task Expert" });
const milestoneRoles = [
    { id: participant.id, label: "Task Participant", roleId: participant.id, requiredSubmissions: 5, enabled: true },
    { id: enthusiast.id, label: "Task Enthusiast", roleId: enthusiast.id, requiredSubmissions: 25, enabled: true },
    { id: expert.id, label: "Task Expert", roleId: expert.id, requiredSubmissions: 50, enabled: true },
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe("milestone roles", () => {
    test("give a member the highest milestone they have reached, take the lower one away and tell them", async ({ discord, services }) => {
        for (const role of [participant, enthusiast, expert]) await discord.addRole(IDS.guild, role);
        await services.guilds.update(IDS.guild, { taskSettings: { milestoneRoles } });
        await services.repos.userRepo!.createUser(buildUserStats({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }), roles: [participant.id] }));
        discord.acceptMemberRoleChanges(IDS.guild, member);
        const dm = discord.acceptDirectMessages(member);

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${enthusiast.id}`]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([`${member}:${participant.id}`]);
        expect(discord.messagesSentTo(dm)).toEqual([expect.objectContaining({ content: "You have earned the **Task Enthusiast** role for completing 25 tasks!" })]);
    });

    test("still give the role to a member who doesn't accept DMs", async ({ discord, services }) => {
        for (const role of [participant, enthusiast, expert]) await discord.addRole(IDS.guild, role);
        await services.guilds.update(IDS.guild, { taskSettings: { milestoneRoles } });
        await services.repos.userRepo!.createUser(buildUserStats({ userId: member, tasksCompletedGold: 6 }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }) }));
        discord.acceptMemberRoleChanges(IDS.guild, member);
        const dm = "100000000000000097";
        discord.api
            .intercept({ path: "/api/v10/users/@me/channels", method: "POST" })
            .reply(200, { id: dm, type: 1, name: null, last_message_id: null, recipients: [apiUser({ id: member })] }, { headers: { "content-type": "application/json" } });
        discord.api
            .intercept({ path: `/api/v10/channels/${dm}/messages`, method: "POST" })
            .reply(403, { code: 50007, message: "Cannot send messages to this user" }, { headers: { "content-type": "application/json" } });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${participant.id}`]);
        expect(warn).toHaveBeenCalledWith(`[TaskMilestones] Granted Task Participant to ${member} but couldn't DM them:`, expect.objectContaining({ code: 50007 }));
    });
});

describe("champion roles", () => {
    test("pass from last period's champions to this period's, and count each win", async ({ discord, services }) => {
        const first = apiRole({ name: "Task Champion (1st)" });
        const second = apiRole({ name: "Task Champion (2nd)" });
        for (const role of [first, second]) await discord.addRole(IDS.guild, role);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: first.id, taskChampionSecond: second.id } });
        const previousChampion = "100000000000000032";
        const runnerUp = "100000000000000033";
        await services.repos.taskLeaderboardRepo!.createLeaderboard({
            id: "periodic", points: {}, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z",
            period: { length: 4, eventIds: [], startedAt: "2026-01-05T00:00:00.000Z", index: 4 },
            champions: { first: [previousChampion] },
        });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: previousChampion }), roles: [first.id] }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }) }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: runnerUp }) }));
        for (const userId of [previousChampion, member, runnerUp]) discord.acceptMemberRoleChanges(IDS.guild, userId);

        await awardTaskChampionRoles(discord.client, services, {
            first: [{ userId: member, points: 10 }],
            second: [{ userId: runnerUp, points: 8 }],
            third: [],
            winners: [{ userId: member, points: 10 }, { userId: runnerUp, points: 8 }],
        }, 3);

        expect(discord.memberRoleChanges("DELETE")).toEqual([`${previousChampion}:${first.id}`]);
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${first.id}`, `${runnerUp}:${second.id}`]);
        expect(await services.repos.userRepo!.getUserById(member)).toMatchObject({ taskChampionFirsts: 1 });
        expect(await services.repos.userRepo!.getUserById(runnerUp)).toMatchObject({ taskChampionSeconds: 1 });
        expect((await services.repos.taskLeaderboardRepo!.getLeaderboard("periodic"))?.champions).toMatchObject({
            first: [member], second: [runnerUp], third: [], periodIndex: 3,
        });
    });
});
