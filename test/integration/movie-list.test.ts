import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../discord/payloads.js";
import { tmdbSearch } from "../tmdb.js";
import { movieFactory } from "../factories.js";

describe("/addmovie", () => {
    test("is refused until the bot is set up", async ({ discord, interact, db }) => {
        await db.doc(`guilds/${IDS.guild}`).delete();

        const command = await interact(
            chatInputInteraction("addmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
            ]),
        );

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

describe("/viewmovie", () => {
    test("shows the closest match to a misspelt title, with who added it", async ({ discord, interact, factories }) => {
        const submitter = SnowflakeUtil.generate().toString();
        await factories.movie.create({ id: "movie-1", title: "Inception" });
        await factories.movie.create({
            id: "movie-2",
            title: "Arrival",
            overview: "Linguists meet visitors.",
            addedBy: submitter,
        });

        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "arival" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🎬 Arrival",
                        description: `Linguists meet visitors.\n\n*Added by <@${submitter}>*`,
                    }),
                ],
            }),
        ]);
    });

    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await factories.movie.create({ title: "Inception" });

        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "Godfather" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No matching movie found for **Godfather**." }),
        ]);
    });

    test("says so when the list is empty", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "Inception" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movies are currently in the watchlist." }),
        ]);
    });
});

describe("/testmovie", () => {
    test("says so when TMDb finds nothing", async ({ discord, interact, http }) => {
        tmdbSearch(http, "zzzz", []);

        const command = await interact(
            chatInputInteraction(
                "testmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "zzzz" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie found for **zzzz**." }),
        ]);
    });
});

describe("MovieRepository movies", () => {
    test("stores a movie whose optional TMDb details are missing", async ({ services }) => {
        await services.repos.movieRepo.upsertMovie(
            movieFactory.build({
                id: "arrival",
                title: "Arrival",
                director: undefined,
                runtime: undefined,
                posterUrl: undefined,
            }),
        );

        expect(await services.repos.movieRepo.getMovieById("arrival")).toMatchObject({ title: "Arrival" });
    });
});
