import { UNPICKED_MOVIE_ID } from "../../../../../src/models/MovieEvent.js";
import { SnowflakeUtil, TimestampStyles, time } from "discord.js";
import { describe, expect, test } from "../../../../fixtures.js";
import { apiUser, chatInputInteraction } from "../../../../discord/payloads.js";

describe("/currentmovie", () => {
    test("shows the scheduled night's movie, start time and host", async ({ discord, interact, factories }) => {
        const host = apiUser({ id: SnowflakeUtil.generate().toString(), username: "host" });
        discord.user(host);
        const night = await factories.movieEvent.create({
            movie: { title: "Arrival", overview: "Linguists meet visitors." },
            hostedBy: host.id,
        });
        const start = night.startTime;

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Now showing: Arrival",
                        fields: expect.arrayContaining([
                            {
                                name: "🎥 Start Time",
                                value: `${time(start, TimestampStyles.LongDateTime)} (${time(start, TimestampStyles.RelativeTime)})\n\n🎬 We will be watching **Arrival**!`,
                                inline: false,
                            },
                        ]),
                        footer: { text: "Scheduled by host • Powered by TMDb" },
                    }),
                ],
            }),
        ]);
    });

    test("says no movie is picked yet when the night was scheduled before one was", async ({
        discord,
        interact,
        factories,
    }) => {
        const host = apiUser({ id: SnowflakeUtil.generate().toString(), username: "host" });
        discord.user(host);
        // A night scheduled with no movie picked stores this placeholder until one is
        const night = await factories.movieEvent.create({
            movie: { id: UNPICKED_MOVIE_ID, title: "TBD" },
            hostedBy: host.id,
        });
        const start = night.startTime;

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🎞️ Upcoming Movie Night!",
                        description: `${time(start, TimestampStyles.LongDateTime)} (${time(start, TimestampStyles.RelativeTime)})\n\n📭 No movie has been selected yet.`,
                        footer: { text: "Scheduled by host" },
                    }),
                ],
            }),
        ]);
    });

    test("says so when no night is scheduled", async ({ discord, interact, factories }) => {
        await factories.movieEvent.create({ completed: true });

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie night is currently scheduled." }),
        ]);
    });
});
