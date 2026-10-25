import { ApplicationCommandOptionType, InteractionResponseType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, type StoringFactories, storeWeeks, test } from "../fixtures.js";
import {
    AS,
    IDS,
    apiGuildMember,
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
    registerPeriodicTaskEvent,
} from "../../src/modules/tasks/TaskLeaderboards.js";
import { periodicLeaderboardFactory } from "../factories.js";

const [winner, runnerUp] = [SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString()];

async function storePeriodic(
    factories: StoringFactories,
    overrides: Parameters<StoringFactories["periodicLeaderboard"]["create"]>[0],
): Promise<void> {
    await factories.periodicLeaderboard.create(overrides);
    await factories.lifetimeLeaderboard.create();
}

describe("the weekly leaderboard update", () => {
    test("posts the current standings with the week of the period", async ({ discord, services, factories }) => {
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 1, days: 1 }), ["week-1", "week-2"]);
        await storePeriodic(factories, {
            points: { [winner]: 6, [runnerUp]: 6 },
            tierCounts: {
                [winner]: { bronze: 0, silver: 0, gold: 1 },
                [runnerUp]: { bronze: 0, silver: 2, gold: 0 },
            },
            period: { length: 4, eventIds: events },
        });
        for (const { id, name } of [
            { id: winner, name: "member1" },
            { id: runnerUp, name: "a-very-long-member-name" },
        ]) {
            discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id, username: name, global_name: name }) }));
        }
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const [posted] = discord.messagesSentTo(IDS.channel);
        const embed = posted?.embeds?.[0];
        expect(embed?.title).toBe("🏆 Current Leaderboard Standings");
        expect(embed?.fields).toEqual([
            {
                name: "Top 10",
                value: [
                    "```",
                    "Rank Name           Pts B S G",
                    "=🥇  member1          6 0 0 1",
                    "=🥇  a-very-long...   6 0 2 0",
                    "```",
                ].join("\n"),
            },
            { name: "Period Progress", value: "Week 2 of 4" },
        ]);
        expect(embed?.footer?.text).toBe("Task events elapsed: 1/4");
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
});

describe("TaskLeaderboards initialisation", () => {
    test("builds the lifetime leaderboard from stored user stats", async ({ services, factories }) => {
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
    test("replaces whole score maps on update so stale scores are cleared", async ({ services }) => {
        await services.repos.taskLeaderboardRepo.createLeaderboard(
            periodicLeaderboardFactory.build({ points: { [SnowflakeUtil.generate().toString()]: 6, [IDS.user]: 1 } }),
        );

        await services.repos.taskLeaderboardRepo.updateLeaderboard("periodic", {
            points: { [IDS.user]: 3 },
            pendingPeriod: null,
        });

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [IDS.user]: 3 });
        expect(stored?.pendingPeriod).toBeNull();
    });
});
