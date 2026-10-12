import { SnowflakeUtil, TimestampStyles, time } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test as base } from "../fixtures.js";
import { apiUser, chatInputInteraction, IDS } from "../discord/payloads.js";
import assert from "node:assert";
import { UserRepository } from "../../src/core/database/UserRepo.js";
import { userStatsFactory } from "../factories.js";
import { newUserStats } from "../../src/models/UserStats.js";

const test = base.extend("repo", ({ db }) => new UserRepository(db, IDS.guild));
const otherUser = SnowflakeUtil.generate().toString();
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
    test("stores users under the guild and reads them back", async ({ repo, db }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user, commandsRun: 3 }));

        expect(await repo.getUserById(IDS.user)).toMatchObject({ userId: IDS.user, commandsRun: 3 });
        expect(await repo.getAllUsers()).toEqual([expect.objectContaining({ userId: IDS.user })]);
        expect((await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get()).exists).toBe(true);
        expect(await repo.getUserById("missing")).toBeNull();
    });

    test("updates and deletes a user", async ({ repo }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user, commandsRun: 3 }));

        await repo.updateUser(IDS.user, { commandsRun: 4 });
        expect(await repo.getUserById(IDS.user)).toMatchObject({ commandsRun: 4 });

        await repo.deleteUser(IDS.user);
        expect(await repo.getUserById(IDS.user)).toBeNull();
    });

    test("increments a stat on an existing user", async ({ repo }) => {
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 1);
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 2);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 3, commandsRun: 0 });
    });

    test("counts every increment when several arrive at once for a user with no stats yet", async ({ repo }) => {
        await Promise.all([
            repo.incrementStat(IDS.user, "commandsRun", 1),
            repo.incrementStat(IDS.user, "commandsRun", 1),
            repo.incrementStat(IDS.user, "commandsRun", 1),
        ]);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ commandsRun: 3 });
    });

    test("starts a member's stats with their first increment, joined when the stats were created", async ({
        repo,
        db,
    }) => {
        await repo.incrementStat(IDS.user, "moviesAdded", 1);

        const { createTime } = await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get();
        assert(createTime);
        expect(await repo.getUserById(IDS.user)).toEqual({
            ...newUserStats(IDS.user, createTime.toDate()),
            moviesAdded: 1,
            lastActiveAt: expect.any(Date),
        });
    });

    test("moves one completion between tiers on an existing user", async ({ repo }) => {
        await repo.incrementStat(IDS.user, "tasksCompletedBronze", 1);

        await repo.updateTierStat(IDS.user, "tasksCompletedBronze", "tasksCompletedSilver");

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 0, tasksCompletedSilver: 1 });
    });

    test("keeps a tier move and an increment made at the same moment for a user with no stats yet", async ({
        repo,
    }) => {
        await Promise.all([
            repo.updateTierStat(IDS.user, "tasksCompletedBronze", "tasksCompletedSilver"),
            repo.incrementStat(IDS.user, "tasksCompletedGold", 1),
        ]);

        expect(await repo.getUserById(IDS.user)).toMatchObject({ tasksCompletedSilver: 1, tasksCompletedGold: 1 });
    });

    test("clears every user in the guild", async ({ repo }) => {
        await repo.createUser(userStatsFactory.build({ userId: IDS.user }));
        await repo.createUser(userStatsFactory.build({ userId: otherUser }));

        await repo.clearAllUsers();

        expect(await repo.getAllUsers()).toEqual([]);
    });

    test("reads a user back exactly as stored", async ({ repo }) => {
        const user = userStatsFactory.build({
            userId: IDS.user,
            commandsRun: 3,
            lastActiveAt: new Date("2026-01-07T00:00:00.000Z"),
        });
        await repo.createUser(user);

        expect(await repo.getUserById(IDS.user)).toEqual(user);
    });

    test("reads a member created by the legacy completion import as a full set of stats", async ({ repo, db }) => {
        // The shape src/scripts/importLegacySubmissions.ts wrote before it stored complete stats
        const importedAt = new Date("2025-10-29T00:00:00.000Z");
        await db
            .doc(`guilds/${IDS.guild}/userStats/${legacyUser}`)
            .set({ userId: legacyUser, legacyTasksCompleted: 12, createdAt: importedAt });

        expect(await repo.getUserById(legacyUser)).toEqual({
            ...newUserStats(legacyUser, importedAt),
            legacyTasksCompleted: 12,
        });
    });
});
