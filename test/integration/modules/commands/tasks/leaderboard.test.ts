import { SnowflakeUtil } from "discord.js";
import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import {
    apiMember,
    apiMessage,
    apiUser,
    buttonInteraction,
    chatInputInteraction,
} from "../../../../discord/payloads.js";

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
