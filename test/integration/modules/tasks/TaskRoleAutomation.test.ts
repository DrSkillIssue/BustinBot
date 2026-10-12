import { SnowflakeUtil } from "discord.js";
import { describe, expect, test, vi } from "../../../fixtures.js";
import type { DiscordHarness } from "../../../discord/harness.js";
import type { ServiceContainer } from "../../../../src/core/services/ServiceContainer.js";
import { IDS, apiGuildMember, apiRole, apiUser } from "../../../discord/payloads.js";
import { milestoneRoleFactory, leaderboardPeriodFactory } from "../../../factories.js";
import { applyTaskMilestoneRoles } from "../../../../src/modules/tasks/TaskMilestones.js";
import { awardTaskChampionRoles } from "../../../../src/modules/tasks/TaskLeaderboards.js";

const member = SnowflakeUtil.generate().toString();
// The guild's milestone roles at 5, 25 and 50 submissions, in Discord and in the guild's settings
async function setUpMilestoneRoles(discord: DiscordHarness, services: ServiceContainer) {
    const participant = apiRole({ name: "Task Participant" });
    const enthusiast = apiRole({ name: "Task Enthusiast" });
    const expert = apiRole({ name: "Task Expert" });
    for (const role of [participant, enthusiast, expert]) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, {
        taskSettings: {
            milestoneRoles: [
                milestoneRoleFactory.build({ roleId: participant.id, label: participant.name, requiredSubmissions: 5 }),
                milestoneRoleFactory.build({ roleId: enthusiast.id, label: enthusiast.name, requiredSubmissions: 25 }),
                milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
            ],
        },
    });
    return { participant, enthusiast, expert };
}

describe("milestone roles", () => {
    test("give a member the highest milestone they have reached, take the lower one away and tell them", async ({
        discord,
        services,
        factories,
    }) => {
        const { participant, enthusiast } = await setUpMilestoneRoles(discord, services);
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }), roles: [participant.id] }));
        const dm = discord.acceptDirectMessages(apiUser({ id: member }));

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${enthusiast.id}`]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([`${member}:${participant.id}`]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: "You have earned the **Task Enthusiast** role for completing 25 tasks!",
            }),
        ]);
    });

    test("still give the role to a member who doesn't accept DMs", async ({ discord, services, factories }) => {
        const { participant } = await setUpMilestoneRoles(discord, services);
        await factories.userStats.create({ userId: member, tasksCompletedGold: 6 });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }) }));
        discord.refuseDirectMessages(apiUser({ id: member }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${participant.id}`]);
        expect(warn).toHaveBeenCalledWith(
            `[TaskMilestones] Granted Task Participant to ${member} but couldn't DM them:`,
            expect.objectContaining({ code: 50007 }),
        );
    });
});

describe("champion roles", () => {
    test("pass from last period's champions to this period's, and count each win", async ({
        discord,
        services,
        factories,
    }) => {
        const first = apiRole({ name: "Task Champion (1st)" });
        const second = apiRole({ name: "Task Champion (2nd)" });
        for (const role of [first, second]) await discord.addRole(IDS.guild, role);
        await services.guilds.update(IDS.guild, {
            roles: { taskChampionFirst: first.id, taskChampionSecond: second.id },
        });
        const previousChampion = SnowflakeUtil.generate().toString();
        const runnerUp = SnowflakeUtil.generate().toString();
        // Champions are awarded once their period has ended and the next one has begun
        const endedPeriod = 3;
        await factories.periodicLeaderboard.create({
            period: leaderboardPeriodFactory.build({ index: endedPeriod + 1 }),
            champions: { first: [previousChampion] },
        });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: previousChampion }), roles: [first.id] }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }) }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: runnerUp }) }));

        await awardTaskChampionRoles(
            discord.client,
            services,
            {
                first: [{ userId: member, points: 10 }],
                second: [{ userId: runnerUp, points: 8 }],
                third: [],
                winners: [
                    { userId: member, points: 10 },
                    { userId: runnerUp, points: 8 },
                ],
            },
            endedPeriod,
        );

        expect(discord.memberRoleChanges("DELETE")).toEqual([`${previousChampion}:${first.id}`]);
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${first.id}`, `${runnerUp}:${second.id}`]);
        expect(await services.repos.userRepo.getUserById(member)).toMatchObject({ taskChampionFirsts: 1 });
        expect(await services.repos.userRepo.getUserById(runnerUp)).toMatchObject({ taskChampionSeconds: 1 });
        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("periodic"))?.champions).toMatchObject({
            first: [member],
            second: [runnerUp],
            third: [],
            periodIndex: endedPeriod,
        });
    });
});
