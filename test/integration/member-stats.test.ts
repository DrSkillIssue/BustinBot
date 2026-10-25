import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { apiUser, chatInputInteraction } from "../discord/payloads.js";

describe("/stats", () => {
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
