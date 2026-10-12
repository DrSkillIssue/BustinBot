import { ApplicationCommandOptionType, InteractionResponseType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, vi, type StoringFactories, storeWeeks, test as base } from "../fixtures.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import { DiscordError, type DiscordHarness } from "../discord/harness.js";
import {
    AS,
    IDS,
    NAMES,
    apiGuildMember,
    apiRole,
    apiUser,
    chatInputInteraction,
    buttonInteraction,
    apiMember,
    apiMessage,
} from "../discord/payloads.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";
import {
    postPeriodicLeaderboardUpdate,
    warnPendingLeaderboardFinalization,
} from "../../src/modules/tasks/HandleLeaderboardUpdate.js";
import {
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    recordPeriodicTierChange,
    registerPeriodicTaskEvent,
} from "../../src/modules/tasks/TaskLeaderboards.js";
import { leaderboardPeriodFactory, lifetimeLeaderboardFactory, periodicLeaderboardFactory } from "../factories.js";
import { TaskLeaderboardRepository } from "../../src/core/database/TaskLeaderboardRepo.js";

const [winner, runnerUp, third] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

async function storePeriodic(
    factories: StoringFactories,
    overrides: Parameters<StoringFactories["periodicLeaderboard"]["create"]>[0],
): Promise<void> {
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
    // A member Discord knows, who accepts DMs; returns their DM channel's id
    const placed = (userId: string, name: string) => {
        const user = apiUser({ id: userId, username: name, global_name: name });
        discord.member(IDS.guild, apiGuildMember({ user }));
        return discord.acceptDirectMessages(user);
    };
    const dms = {
        winner: placed(winner, "member1"),
        runnerUp: placed(runnerUp, "member2"),
        third: placed(third, "member3"),
    };
    return { roles, dms };
}

const [oldPeriodMember, overlapMember, upgradedMember] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

const test = base.extend("repo", ({ db }) => new TaskLeaderboardRepository(db, IDS.guild));

describe("the weekly leaderboard update", () => {
    test("posts the current standings with the week of the period", async ({ discord, services, factories }) => {
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 1, days: 1 }), ["week-1", "week-2"]);
        await storePeriodic(factories, {
            points: { [winner]: 6 },
            tierCounts: { [winner]: { bronze: 0, silver: 0, gold: 1 } },
            period: { length: 4, eventIds: events },
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
            const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 4, days: 1 }), [
                "week-1",
                "week-2",
                "week-3",
                "week-4",
            ]);
            const period = { index: 3, length: 4, eventIds: events };
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
            expect(discord.messagesSentTo(dms.winner)).toEqual([
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
        interact,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 4, days: 1 }), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
        ]);
        await storePeriodic(factories, {
            points: { [winner]: 9 },
            period: { length: 4, eventIds: events },
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
        const command = await interact(
            chatInputInteraction(
                "taskboard",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "final" }],
                AS.botAdmin,
            ),
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
    test("says so when the task channel can't be reached", async ({ discord, interact, services, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storePeriodic(factories, {});
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        const command = await interact(
            chatInputInteraction(
                "taskboard",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "update" }],
                AS.botAdmin,
            ),
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
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 4, days: 1 }), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
        ]);
        await storePeriodic(factories, { period: { length: 4, eventIds: events } });
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
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 4, days: 1 }), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
        ]);
        await storePeriodic(factories, { period: { length: 4, eventIds: events } });
        await factories.taskSubmission.create({ taskEventId: "week-4", status: SubmissionStatus.Pending });
        await services.guilds.update(IDS.guild, { channels: { taskVerification: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[LeaderboardUpdate] Task verification channel ${IDS.missingChannel} not found; pending submissions not announced.`,
        );
    });
});

describe("TaskLeaderboards initialisation", () => {
    test("builds the lifetime leaderboard from stored user stats", async ({ services, factories }) => {
        // A new leaderboard starts at its first period
        const firstPeriod = 1;
        await factories.userStats.create({ userId: IDS.user, tasksCompletedGold: 1, tasksCompletedBronze: 2 });

        await ensureTaskLeaderboardsInitialized(services);

        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
            points: { [IDS.user]: 8 },
        });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            period: { length: 4, eventIds: [], index: firstPeriod },
        });
    });
});

describe("the leaderboard buttons", () => {
    test("log why the leaderboard couldn't be built and tell the member", async ({ discord, interact, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        // The emulator can't be made to fail one read, so the leaderboard read fails the way an unreachable Firestore fails it
        const unavailable = Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 });
        vi.spyOn(services.repos.taskLeaderboardRepo, "getLeaderboard").mockRejectedValueOnce(unavailable);

        const click = await interact(buttonInteraction("task-leaderboard|lifetime"));

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({
                content: "Leaderboard initialisation failed. Please use /reportbug if it continues.",
            }),
        ]);
        expect(error).toHaveBeenCalledWith("[TaskInteractions] Failed to build the leaderboard:", unavailable);
    });
});

describe("TaskLeaderboards periodic submissions", () => {
    test("keeps every category event from the fourth week in the completing period", async ({
        services,
        factories,
    }) => {
        const eventIds: string[] = [];
        for (const week of [1, 2, 3]) {
            for (const category of ["pvm", "skilling", "minigame"]) {
                eventIds.push(
                    (
                        await factories.taskEvent.create({
                            id: `week-${week}-${category}`,
                            startTime: new Date(`2026-01-${String(week * 7 - 2).padStart(2, "0")}T00:00:00.000Z`),
                        })
                    ).id,
                );
            }
        }
        for (const category of ["pvm", "skilling", "minigame"]) {
            eventIds.push(
                (
                    await factories.taskEvent.create({
                        id: `week-4-${category}`,
                        startTime: new Date("2026-01-26T00:00:00.000Z"),
                    })
                ).id,
            );
        }
        eventIds.push(
            (await factories.taskEvent.create({ id: "week-5-pvm", startTime: new Date("2026-02-02T00:00:00.000Z") }))
                .id,
        );

        await ensureTaskLeaderboardsInitialized(services);
        for (const eventId of eventIds) {
            await registerPeriodicTaskEvent(services, eventId);
        }

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.period?.eventIds).toEqual(eventIds.slice(0, 12));
        expect(stored?.pendingPeriod?.period.eventIds).toEqual(["week-5-pvm"]);
    });

    test("carries approved submissions from the overlap into the following period", async ({ services, factories }) => {
        const weeks = await storeWeeks(factories, DateTime.fromISO("2026-01-05T00:00:00Z"), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
            "week-5",
        ]);

        await ensureTaskLeaderboardsInitialized(services);
        for (const id of weeks.slice(0, 4)) {
            await registerPeriodicTaskEvent(services, id);
        }
        await recordPeriodicTierChange(services, "week-4", {
            userId: oldPeriodMember,
            points: 6,
            from: null,
            to: SubmissionStatus.Gold,
        });
        await registerPeriodicTaskEvent(services, "week-5");
        await recordPeriodicTierChange(services, "week-5", {
            userId: overlapMember,
            points: 3,
            from: null,
            to: SubmissionStatus.Silver,
        });

        const finalising = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(finalising?.points).toEqual({ [oldPeriodMember]: 6 });
        // The leaderboard starts at its first period
        const firstPeriod = 1;
        expect(finalising?.period?.index).toBe(firstPeriod);

        const finalised = await finalizePeriodicLeaderboard(services, firstPeriod);

        expect(finalised?.placements.first).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.completedPeriod?.topThree).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        expect(stored?.completedPeriod?.topTen).toEqual([{ userId: oldPeriodMember, points: 6 }]);
        expect(stored?.period?.eventIds).toEqual(["week-5"]);
        expect(stored?.points).toEqual({ [overlapMember]: 3 });
        expect(stored?.tierCounts).toEqual({ [overlapMember]: { silver: 1 } });
        expect(await finalizePeriodicLeaderboard(services, firstPeriod)).toBeNull();
    });

    test("moves tier counts when approved submissions are upgraded", async ({ services, factories }) => {
        await factories.taskEvent.create({ id: "week-1", startTime: new Date("2026-01-05T00:00:00.000Z") });
        await factories.taskEvent.create({ id: "week-2", startTime: new Date("2026-01-12T00:00:00.000Z") });

        await ensureTaskLeaderboardsInitialized(services);
        await registerPeriodicTaskEvent(services, "week-1");
        await registerPeriodicTaskEvent(services, "week-2");
        for (const eventId of ["week-1", "week-2"]) {
            await recordPeriodicTierChange(services, eventId, {
                userId: upgradedMember,
                points: 1,
                from: null,
                to: SubmissionStatus.Bronze,
            });
            await recordPeriodicTierChange(services, eventId, {
                userId: upgradedMember,
                points: 2,
                from: SubmissionStatus.Bronze,
                to: SubmissionStatus.Silver,
            });
            await recordPeriodicTierChange(services, eventId, {
                userId: upgradedMember,
                points: 3,
                from: SubmissionStatus.Silver,
                to: SubmissionStatus.Gold,
            });
        }

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [upgradedMember]: 12 });
        expect(stored?.tierCounts).toEqual({ [upgradedMember]: { bronze: 0, silver: 0, gold: 2 } });
    });
});

describe("/leaderboard", () => {
    test("shows the all-time leaderboard with the member's rank, and switches to the period's", async ({
        discord,
        interact,
        factories,
    }) => {
        const ann = {
            member: apiMember({ user: apiUser({ id: SnowflakeUtil.generate().toString(), global_name: "Ann" }) }),
        };
        await factories.userStats.create({
            userId: ann.member.user.id,
            tasksCompletedBronze: 2,
            tasksCompletedGold: 1,
            taskStreak: 3,
            longestTaskStreak: 3,
        });

        const command = await interact(chatInputInteraction("leaderboard", [], ann));
        const periodic = await interact(buttonInteraction("task-leaderboard|periodic", apiMessage(), ann));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🏆 Task Leaderboard - All Time 🏆",
                        fields: [
                            {
                                name: "Top 10",
                                value: ["```", "Rank Name Pts B S G Str", "🥇   Ann    8 2 0 1  3*", "```"].join("\n"),
                            },
                            { name: "Your Rank", value: "#1 - 8 pts" },
                        ],
                    }),
                ],
            }),
        ]);
        expect(discord.callbacks(periodic)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(periodic)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🏆 Task Leaderboard - Monthly 🏆",
                        fields: [
                            { name: "Top 10", value: "No points recorded yet." },
                            { name: "Your Rank", value: "Unranked - 0 pts" },
                        ],
                        footer: { text: "Task events elapsed: 0/4" },
                    }),
                ],
            }),
        ]);
    });
});

describe("/taskperiod", () => {
    test("set saves the number of task events per period", async ({ discord, interact, services }) => {
        const command = await interact(
            chatInputInteraction(
                "taskperiod",
                [
                    {
                        type: ApplicationCommandOptionType.Subcommand,
                        name: "set",
                        options: [{ type: ApplicationCommandOptionType.Integer, name: "events", value: 8 }],
                    },
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Periodic leaderboard length set to **8** task events. This will apply after the current period ends.",
            }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.periodEvents).toBe(8);
    });

    test("start begins a fresh period without points, keeping the period number", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.periodicLeaderboard.create({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { gold: 1 } },
            period: { eventIds: ["week-1", "week-2"], index: 3 },
        });

        const command = await interact(
            chatInputInteraction(
                "taskperiod",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "start" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Periodic leaderboard reset. The next task event will be counted as the first event of the new period.",
            }),
        ]);
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            tierCounts: {},
            period: { eventIds: [], index: 3 },
        });
    });
});

describe("TaskLeaderboardRepository", () => {
    test("stores lifetime and periodic leaderboards as separate documents", async ({ repo }) => {
        await repo.createLeaderboard(lifetimeLeaderboardFactory.build({ points: { [IDS.user]: 10 } }));
        await repo.createLeaderboard(periodicLeaderboardFactory.build({ points: { [IDS.user]: 3 } }));

        expect(await repo.getLeaderboard("lifetime")).toMatchObject({ points: { [IDS.user]: 10 } });
        expect(await repo.getLeaderboard("periodic")).toMatchObject({ points: { [IDS.user]: 3 } });
    });

    test("replaces whole score maps on update so stale scores are cleared", async ({ repo }) => {
        await repo.createLeaderboard(
            periodicLeaderboardFactory.build({ points: { [SnowflakeUtil.generate().toString()]: 6, [IDS.user]: 1 } }),
        );

        await repo.updateLeaderboard("periodic", { points: { [IDS.user]: 3 }, pendingPeriod: null });

        const stored = await repo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [IDS.user]: 3 });
        expect(stored?.pendingPeriod).toBeNull();
    });

    test("keeps a leaderboard that already exists when asked to create it", async ({ repo }) => {
        await repo.createLeaderboard(periodicLeaderboardFactory.build({ points: { [IDS.user]: 3 } }));

        await repo.createLeaderboard(periodicLeaderboardFactory.build());

        expect(await repo.getLeaderboard("periodic")).toMatchObject({ points: { [IDS.user]: 3 } });
    });

    test("adds points and moves tier counts when a member reaches a higher tier", async ({ repo }) => {
        await repo.createLeaderboard(periodicLeaderboardFactory.build());

        await repo.incrementPoints("periodic", IDS.user, 3);
        await repo.recordTierChange("periodic", {
            userId: IDS.user,
            points: 1,
            from: null,
            to: SubmissionStatus.Bronze,
        });
        await repo.recordTierChange("periodic", {
            userId: IDS.user,
            points: 2,
            from: SubmissionStatus.Bronze,
            to: SubmissionStatus.Silver,
        });

        expect(await repo.getLeaderboard("periodic")).toMatchObject({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { bronze: 0, silver: 1 } },
        });
    });

    test("records a tier change in the pending period", async ({ repo }) => {
        // The period after the current one, which task events join once the current one is full
        const period = leaderboardPeriodFactory.build({
            eventIds: ["week-5"],
            startedAt: "2026-02-02T00:00:00.000Z",
            index: leaderboardPeriodFactory.build().index + 1,
        });
        await repo.createLeaderboard(
            periodicLeaderboardFactory.build({ pendingPeriod: { period, points: {}, tierCounts: {} } }),
        );

        await repo.recordTierChange(
            "periodic",
            { userId: IDS.user, points: 6, from: null, to: SubmissionStatus.Gold },
            "pendingPeriod",
        );

        expect(await repo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            pendingPeriod: { period, points: { [IDS.user]: 6 }, tierCounts: { [IDS.user]: { gold: 1 } } },
        });
    });

    test("rejects changes to a leaderboard that does not exist", async ({ repo }) => {
        await expect(repo.incrementPoints("periodic", IDS.user, 1)).rejects.toThrow();
        await expect(repo.updateLeaderboard("periodic", { points: {} })).rejects.toThrow();
    });
});
