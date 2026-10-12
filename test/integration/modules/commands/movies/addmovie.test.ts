import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, type StoringFactories } from "../../../../fixtures.js";
import {
    AS,
    IDS,
    apiMember,
    apiMessage,
    apiUser,
    buttonInteraction,
    chatInputInteraction,
} from "../../../../discord/payloads.js";
import { tmdbMovie, tmdbSearch } from "../../../../tmdb.js";

const matrix = { id: 603, title: "The Matrix", release_date: "1999-03-31", overview: "A hacker learns the truth." };
const reloaded = { id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15", overview: "Neo returns." };
const resultsMessage = apiMessage({ flags: MessageFlags.Ephemeral });

// The most movies a member may have in the list, added by them
async function storeFullList(factories: StoringFactories, userId: string): Promise<void> {
    for (let i = 0; i < 3; i++)
        await factories.movie.create({ id: `${userId}-${i}`, tmdbId: 900 + i, addedBy: userId });
}

describe("/addmovie", () => {
    test("shows TMDb's results and adds the one the member picks", async ({
        discord,
        slash,
        interact,
        services,
        http,
    }) => {
        tmdbSearch(http, "The Matrix", [matrix, reloaded]);
        tmdbMovie(http, matrix, 136, "Lana Wachowski");

        const command = await slash("addmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
        ]);
        const [results] = discord.originalEdits(command);
        const pick = await interact(buttonInteraction("addmovie|select|603", resultsMessage));

        expect(results?.embeds?.map((embed) => embed.title)).toEqual([
            "The Matrix (1999)",
            "The Matrix Reloaded (2003)",
        ]);
        expect(JSON.stringify(results?.components)).toContain('"custom_id":"addmovie|select|604"');
        expect(discord.callbacks(pick)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(pick)).toEqual([
            expect.objectContaining({
                embeds: [expect.objectContaining({ title: "Added: The Matrix" })],
                components: [],
            }),
        ]);
        const [added] = await services.repos.movieRepo.getAllMovies();
        expect(added).toMatchObject({
            tmdbId: 603,
            title: "The Matrix",
            releaseDate: 1999,
            runtime: 136,
            director: "Lana Wachowski",
            cast: ["Keanu Reeves"],
            addedBy: IDS.user,
            watched: false,
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ moviesAdded: 1 });
    });

    test("refuses a movie already in the list, but not one already watched", async ({
        discord,
        interact,
        http,
        factories,
    }) => {
        const lister = SnowflakeUtil.generate().toString();
        await factories.movie.create({ id: "listed", tmdbId: 603, title: "The Matrix", addedBy: lister });
        await factories.movie.create({ id: "seen", tmdbId: 604, title: "The Matrix Reloaded", watched: true });
        tmdbMovie(http, reloaded, 138, "Lana Wachowski");

        const duplicate = await interact(buttonInteraction("addmovie|select|603", resultsMessage));
        const rewatch = await interact(buttonInteraction("addmovie|select|604", resultsMessage));

        expect(discord.followUps(duplicate)).toEqual([
            expect.objectContaining({
                content: `**The Matrix** is already in the movie list (added by <@${lister}>). Please choose a different result.`,
            }),
        ]);
        expect(discord.originalEdits(rewatch)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added: The Matrix Reloaded" })] }),
        ]);
    });

    test("stops a member at three movies in the list, unless they are a movie admin or the server owner", async ({
        discord,
        slash,
        http,
        factories,
    }) => {
        await storeFullList(factories, IDS.user);
        await storeFullList(factories, IDS.owner);
        tmdbSearch(http, "The Matrix", [matrix]);
        tmdbSearch(http, "The Matrix", [matrix]);

        const member = await slash("addmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
        ]);
        const admin = await slash(
            "addmovie",
            [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
            AS.movieAdmin,
        );
        const owner = await slash(
            "addmovie",
            [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
            { member: apiMember({ user: apiUser({ id: IDS.owner }) }) },
        );

        expect(discord.originalEdits(member)).toEqual([
            expect.objectContaining({
                content:
                    "You have reached the maximum of 3 active movies. Remove one or wait for a movie night to conclude before adding more.",
            }),
        ]);
        expect(discord.originalEdits(admin)[0]?.embeds).toHaveLength(1);
        expect(discord.originalEdits(owner)[0]?.embeds).toHaveLength(1);
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({
        discord,
        interact,
        uncachedGuild,
        http,
        factories,
    }) => {
        // Interactions from a guild discord.js hasn't cached carry the member as raw data, roles as ids
        await storeFullList(factories, IDS.user);
        tmdbSearch(http, "The Matrix", [matrix]);

        const command = await interact(
            chatInputInteraction(
                "addmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
                { ...uncachedGuild, ...AS.movieAdmin },
            ),
        );

        expect(discord.originalEdits(command)[0]?.embeds).toHaveLength(1);
    });

    test("can be cancelled", async ({ discord, interact }) => {
        const cancel = await interact(buttonInteraction("addmovie|cancel", resultsMessage));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: "Cancelled movie selection.", components: [] }),
            },
        ]);
    });

    test("is refused until the bot is set up", async ({ discord, slash, db }) => {
        await db.doc(`guilds/${IDS.guild}`).delete();

        const command = await slash("addmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
        ]);

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "The bot has not been set up yet. Please run `/setup` first to configure the core channels.",
                }),
            },
        ]);
    });
});
