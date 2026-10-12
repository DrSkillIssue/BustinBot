import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, apiUser, chatInputInteraction } from "../../../../discord/payloads.js";

// /setstreak for a member, as Discord delivers it with the user resolved
function setStreak(user: ReturnType<typeof apiUser>, streak: number) {
    return chatInputInteraction(
        "setstreak",
        [
            { type: ApplicationCommandOptionType.User, name: "user", value: user.id },
            { type: ApplicationCommandOptionType.Integer, name: "streak", value: streak },
        ],
        AS.taskAdmin,
        { users: { [user.id]: user } },
    );
}

describe("/setstreak", () => {
    test("sets the member's streak and raises their longest streak to match", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "streaker" });
        await factories.userStats.create({ userId: member.id, taskStreak: 2, longestTaskStreak: 3 });

        const command = await interact(setStreak(member, 5));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "✅ Updated task streak for **streaker** to **5**." }),
        ]);
        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 5,
            longestTaskStreak: 5,
        });
    });

    test("keeps a longer longest streak when lowering the current one", async ({ interact, services, factories }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString() });
        await factories.userStats.create({ userId: member.id, taskStreak: 4, longestTaskStreak: 9 });

        await interact(setStreak(member, 1));

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 1,
            longestTaskStreak: 9,
        });
    });

    test("creates stats for a member who has none", async ({ interact, services }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString() });

        await interact(setStreak(member, 3));

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 3,
            longestTaskStreak: 3,
        });
    });
});
