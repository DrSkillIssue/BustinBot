import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, apiUser, chatInputInteraction } from "../../../../discord/payloads.js";

describe("/setstreak", () => {
    test("sets the member's streak and raises their longest streak to match", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "streaker" });
        await factories.userStats.create({ userId: member.id, taskStreak: 2, longestTaskStreak: 3 });

        const command = await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 5 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

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

        await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 1 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 1,
            longestTaskStreak: 9,
        });
    });

    test("creates stats for a member who has none", async ({ interact, services }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString() });

        await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 3 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 3,
            longestTaskStreak: 3,
        });
    });
});
