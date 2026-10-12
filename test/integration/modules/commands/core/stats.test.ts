import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { apiUser, chatInputInteraction } from "../../../../discord/payloads.js";

describe("/stats", () => {
    test("shows a member's stats, with dates each viewer reads in their own timezone", async ({
        discord,
        interact,
        factories,
    }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "member" });
        const joinedAt = new Date("2026-02-03T04:05:06.000Z");
        const lastActiveAt = new Date("2026-03-04T05:06:07.000Z");
        await factories.userStats.create({
            userId: member.id,
            joinedAt,
            lastActiveAt,
            commandsRun: 12,
            moviesAdded: 3,
            tasksCompletedGold: 2,
            taskStreak: 4,
        });

        const command = await interact(
            chatInputInteraction(
                "stats",
                [{ type: ApplicationCommandOptionType.User, name: "user", value: member.id }],
                {},
                { users: { [member.id]: member } },
            ),
        );

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]).toMatchObject({ author: { name: "member's Stats" } });
        expect(reply?.embeds?.[0]?.fields?.slice(0, 3)).toEqual([
            { name: "🕧 First Active", value: `<t:${joinedAt.getTime() / 1000}:D>`, inline: true },
            { name: "💬 Last Active", value: `<t:${lastActiveAt.getTime() / 1000}:D>`, inline: true },
            { name: "🕹️ Commands Run", value: "12", inline: true },
        ]);
        expect(reply?.embeds?.[0]?.fields?.[3]?.value).toContain("🎞️ Movies Added: **3**");
        expect(reply?.embeds?.[0]?.fields?.[4]?.value).toContain("🥇 Gold Tasks: **2**");
        expect(reply?.embeds?.[0]?.fields?.[4]?.value).toContain("🔥 Current Task Streak: **4**");
    });

    test("says so when the member has no stats", async ({ discord, interact }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "member" });

        const command = await interact(
            chatInputInteraction(
                "stats",
                [{ type: ApplicationCommandOptionType.User, name: "user", value: member.id }],
                {},
                { users: { [member.id]: member } },
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "No stats found for member. They may not have interacted with me yet.",
            }),
        ]);
    });
});
