import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/taskperiod", () => {
    test("set saves the number of task events per period", async ({ discord, slash, services }) => {
        const command = await slash(
            "taskperiod",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "set",
                    options: [{ type: ApplicationCommandOptionType.Integer, name: "events", value: 8 }],
                },
            ],
            AS.taskAdmin,
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
        slash,
        services,
        factories,
    }) => {
        const leaderboard = await factories.periodicLeaderboard.create({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { gold: 1 } },
            period: { eventIds: ["week-1", "week-2"], index: 3 },
        });

        const command = await slash(
            "taskperiod",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "start" }],
            AS.taskAdmin,
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
            period: { eventIds: [], index: leaderboard.period!.index },
        });
    });
});
