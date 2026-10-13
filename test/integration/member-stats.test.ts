import { SnowflakeUtil, TimestampStyles, time } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { apiUser, chatInputInteraction, IDS } from "../discord/payloads.js";
import assert from "node:assert";
import { newUserStats } from "../../src/models/UserStats.js";

const legacyUser = SnowflakeUtil.generate().toString();

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
            { name: "🕧 First Active", value: time(joinedAt, TimestampStyles.LongDate), inline: true },
            { name: "💬 Last Active", value: time(lastActiveAt, TimestampStyles.LongDate), inline: true },
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

    test("counts itself, so a member's first command shows their stats", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("stats"));

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]?.fields).toContainEqual({ name: "🕹️ Commands Run", value: "1", inline: true });
    });
});

describe("UserRepository", () => {
    test("counts every increment when several arrive at once for a user with no stats yet", async ({ services }) => {
        await Promise.all([
            services.repos.userRepo.incrementStat(IDS.user, "commandsRun", 1),
            services.repos.userRepo.incrementStat(IDS.user, "commandsRun", 1),
            services.repos.userRepo.incrementStat(IDS.user, "commandsRun", 1),
        ]);

        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ commandsRun: 3 });
    });

    test("starts a member's stats with their first increment, joined when the stats were created", async ({
        services,
        db,
    }) => {
        await services.repos.userRepo.incrementStat(IDS.user, "moviesAdded", 1);

        const { createTime } = await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get();
        assert(createTime);
        expect(await services.repos.userRepo.getUserById(IDS.user)).toEqual({
            ...newUserStats(IDS.user, createTime.toDate()),
            moviesAdded: 1,
            lastActiveAt: expect.any(Date),
        });
    });

    test("keeps a tier move and an increment made at the same moment for a user with no stats yet", async ({
        services,
    }) => {
        await Promise.all([
            services.repos.userRepo.updateTierStat(IDS.user, "tasksCompletedBronze", "tasksCompletedSilver"),
            services.repos.userRepo.incrementStat(IDS.user, "tasksCompletedGold", 1),
        ]);

        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedSilver: 1,
            tasksCompletedGold: 1,
        });
    });

    test("reads a member created by the legacy completion import as a full set of stats", async ({ services, db }) => {
        // The shape src/scripts/importLegacySubmissions.ts wrote before it stored complete stats
        const importedAt = new Date("2025-10-29T00:00:00.000Z");
        await db
            .doc(`guilds/${IDS.guild}/userStats/${legacyUser}`)
            .set({ userId: legacyUser, legacyTasksCompleted: 12, createdAt: importedAt });

        expect(await services.repos.userRepo.getUserById(legacyUser)).toEqual({
            ...newUserStats(legacyUser, importedAt),
            legacyTasksCompleted: 12,
        });
    });
});
