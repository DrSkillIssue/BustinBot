import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test, type StoringFactories } from "../../../../fixtures.js";
import { DiscordError } from "../../../../discord/harness.js";
import { AS, IDS, apiMessage, apiUser, chatInputInteraction } from "../../../../discord/payloads.js";
import { movieFactory } from "../../../../factories.js";

const SUBMITTER = SnowflakeUtil.generate().toString();
const ANNOUNCEMENT = SnowflakeUtil.generate().toString();

async function storeTonight(factories: StoringFactories, overrides = {}) {
    const movie = await factories.movie.create({
        id: "movie-2",
        title: "Arrival",
        addedBy: SUBMITTER,
        selectedAt: new Date(),
    });
    await factories.movieEvent.create({
        startTime: DateTime.now().minus({ hours: 1 }).toJSDate(),
        movie,
        ...overrides,
    });
}

describe("/endmovie", () => {
    test("ends tonight's movie night, archives the movie and thanks everyone in the movie night channel", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeTonight(factories);
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "The movie night for **Arrival** has ended and been archived." }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "🎞️ Movie night has ended. Thanks for watching **Arrival**!" }),
        ]);
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({ watched: true });
    });

    test("says so when no movie night is on", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No active movie event found to end." }),
        ]);
    });
});

describe("/closemoviepoll", () => {
    test("closes the poll and announces the winner in the movie night channel", async ({
        discord,
        interact,
        factories,
    }) => {
        const poll = await factories.moviePoll.create({
            options: [
                movieFactory.build({ id: "movie-1", addedBy: SUBMITTER }),
                movieFactory.build({ id: "movie-2", title: "Arrival", addedBy: SUBMITTER }),
            ],
            votes: {
                [SnowflakeUtil.generate().toString()]: "movie-2",
                [SnowflakeUtil.generate().toString()]: "movie-2",
            },
        });
        discord.message(apiMessage({ id: poll.messageId }));
        discord.acceptMessageEdits(IDS.channel);
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        const command = await interact(chatInputInteraction("closemoviepoll", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "✅ Movie poll closed successfully.\nPoll closed successfully. Arrival won with 2 votes.",
            }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "🏆 Movie poll closed!" })] }),
        ]);
    });

    test("says so when no poll is open", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("closemoviepoll", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([expect.objectContaining({ content: "No active poll found." })]);
    });
});

describe("/cancelmovie", () => {
    test("closes the poll, ends the night, unpicks its movie and marks both posts cancelled", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await factories.moviePoll.create({ endsAt: DateTime.now().plus({ days: 1 }).toJSDate() });
        await storeTonight(factories, {
            startTime: DateTime.now().plus({ days: 1 }).toJSDate(),
            announcementMessageId: ANNOUNCEMENT,
        });
        for (const id of [poll.messageId, ANNOUNCEMENT]) discord.message(apiMessage({ id }));
        discord.acceptMessageEdits(IDS.channel);

        const command = await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)[0]?.content).toBe(
            "Movie night cancelled successfully.\n\nActions taken:\n" +
                [
                    "- Active movie poll set inactive",
                    "- Poll message updated to show cancellation",
                    "- Movie night event marked as cancelled",
                    "- Movie night announcement updated to show cancellation",
                    '- Unpicked movie "Arrival"',
                ].join("\n"),
        );
        expect(discord.messageEdits(IDS.channel, poll.messageId)).toEqual([
            expect.objectContaining({ content: `❌ This movie poll was cancelled by <@${IDS.user}>.`, components: [] }),
        ]);
        expect(discord.messageEdits(IDS.channel, ANNOUNCEMENT)).toEqual([
            expect.objectContaining({ content: `❌ Movie night has been cancelled by <@${IDS.user}>.` }),
        ]);
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
        expect((await services.repos.movieRepo.getMovieById("movie-2"))?.selectedAt).toBeUndefined();
    });

    test("posts the cancellation in the movie night channel when its announcement is gone", async ({
        discord,
        interact,
        factories,
    }) => {
        await storeTonight(factories, {
            startTime: DateTime.now().plus({ days: 1 }).toJSDate(),
            announcementMessageId: ANNOUNCEMENT,
        });
        discord.refuse("GET", `/channels/${IDS.channel}/messages/${ANNOUNCEMENT}`, DiscordError.unknownMessage);
        discord.acceptMessages(IDS.channel);

        await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));

        expect(
            discord
                .requests()
                .filter((request) => request.path === `/channels/${IDS.channel}/messages/${ANNOUNCEMENT}`),
        ).toHaveLength(1);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: `❌ Movie night has been cancelled by <@${IDS.user}>.` }),
        ]);
    });
});
