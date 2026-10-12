import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { IDS, buttonInteraction } from "../../../../discord/payloads.js";

describe("/leaderboard", () => {
    test("shows the all-time leaderboard with the member's rank, and switches to the period's", async ({
        discord,
        interact,
        slash,
        factories,
    }) => {
        await factories.userStats.create({
            userId: IDS.user,
            tasksCompletedBronze: 2,
            tasksCompletedGold: 1,
            taskStreak: 3,
            longestTaskStreak: 3,
        });

        const command = await slash("leaderboard");
        const periodic = await interact(buttonInteraction("task-leaderboard|periodic"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🏆 Task Leaderboard - All Time 🏆",
                        fields: [
                            {
                                name: "Top 10",
                                value: ["```", "Rank Name   Pts B S G Str", "🥇   Tester   8 2 0 1  3*", "```"].join(
                                    "\n",
                                ),
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
