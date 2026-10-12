import { SnowflakeUtil } from "discord.js";
import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import type { MockAgent } from "undici";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { GuildRepository } from "../../../core/database/GuildRepo.js";
import { IDS, apiGuild, apiMember, apiMessage, apiUser, buttonInteraction, chatInputInteraction, withRoles } from "../../../tests/discord/payloads.js";
import { buildGuild, buildMovie } from "../../../tests/fakes/builders.js";

const JSON_RESPONSE = { headers: { "content-type": "application/json" } };
const matrix = { id: 603, title: "The Matrix", release_date: "1999-03-31", overview: "A hacker learns the truth." };
const reloaded = { id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15", overview: "Neo returns." };
const title = (value: string) => ({ type: 3, name: "title", value });
const resultsMessage = apiMessage({ flags: MessageFlags.Ephemeral });

// TMDb answering a search
function tmdbSearch(http: MockAgent, query: string, results: object[]): void {
    http.get("https://api.themoviedb.org")
        .intercept({ path: `/3/search/movie?api_key=test-key&query=${encodeURIComponent(query)}`, method: "GET" })
        .reply(200, { results }, JSON_RESPONSE);
}

// TMDb answering for one movie's details and credits
function tmdbMovie(http: MockAgent, movie: typeof matrix, runtime: number, director: string): void {
    const tmdb = http.get("https://api.themoviedb.org");
    tmdb.intercept({ path: `/3/movie/${movie.id}?api_key=test-key&language=en-US`, method: "GET" })
        .reply(200, { ...movie, runtime, vote_average: 8.2, genres: [{ id: 1, name: "Action" }] }, JSON_RESPONSE);
    tmdb.intercept({ path: `/3/movie/${movie.id}/credits?api_key=test-key&language=en-US`, method: "GET" })
        .reply(200, { cast: [{ name: "Keanu Reeves", order: 0 }], crew: [{ job: "Director", name: director }] }, JSON_RESPONSE);
}

// The most movies a member may have in the list, added by them
async function storeFullList(services: ServiceContainer, userId: string): Promise<void> {
    for (let i = 0; i < 3; i++) await services.repos.movieRepo.upsertMovie(buildMovie({ id: `${userId}-${i}`, tmdbId: 900 + i, addedBy: userId }));
}

beforeEach(() => {
    vi.stubEnv("TMDB_API_KEY", "test-key");
});

describe("/addmovie", () => {
    test("shows TMDb's results and adds the one the member picks", async ({ discord, slash, interact, services, http }) => {
        tmdbSearch(http, "The Matrix", [matrix, reloaded]);
        tmdbMovie(http, matrix, 136, "Lana Wachowski");

        const command = await slash("addmovie", [title("The Matrix")]);
        const [results] = discord.originalEdits(command);
        const pick = await interact(buttonInteraction("addmovie|select|603", resultsMessage));

        expect(results?.embeds?.map((embed) => embed.title)).toEqual(["The Matrix (1999)", "The Matrix Reloaded (2003)"]);
        expect(JSON.stringify(results?.components)).toContain('"custom_id":"addmovie|select|604"');
        expect(discord.callbacks(pick)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(pick)).toEqual([expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added: The Matrix" })], components: [] })]);
        const [added] = await services.repos.movieRepo.getAllMovies();
        expect(added).toMatchObject({ tmdbId: 603, title: "The Matrix", releaseDate: 1999, runtime: 136, director: "Lana Wachowski", cast: ["Keanu Reeves"], addedBy: IDS.user, watched: false });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ moviesAdded: 1 });
    });

    test("refuses a movie already in the list, but not one already watched", async ({ discord, interact, services, http }) => {
        const lister = SnowflakeUtil.generate().toString();
        await services.repos.movieRepo.upsertMovie(buildMovie({ id: "listed", tmdbId: 603, title: "The Matrix", addedBy: lister }));
        await services.repos.movieRepo.upsertMovie(buildMovie({ id: "seen", tmdbId: 604, title: "The Matrix Reloaded", watched: true }));
        tmdbMovie(http, reloaded, 138, "Lana Wachowski");

        const duplicate = await interact(buttonInteraction("addmovie|select|603", resultsMessage));
        const rewatch = await interact(buttonInteraction("addmovie|select|604", resultsMessage));

        expect(discord.followUps(duplicate)).toEqual([
            expect.objectContaining({ content: `**The Matrix** is already in the movie list (added by <@${lister}>). Please choose a different result.` }),
        ]);
        expect(discord.originalEdits(rewatch)).toEqual([expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added: The Matrix Reloaded" })] })]);
    });

    test("stops a member at three movies in the list, unless they are a movie admin or the server owner", async ({ discord, slash, services, http }) => {
        await storeFullList(services, IDS.user);
        await storeFullList(services, IDS.owner);
        tmdbSearch(http, "The Matrix", [matrix]);
        tmdbSearch(http, "The Matrix", [matrix]);

        const member = await slash("addmovie", [title("The Matrix")]);
        const admin = await slash("addmovie", [title("The Matrix")], withRoles(IDS.roles.movieAdmin));
        const owner = await slash("addmovie", [title("The Matrix")], { member: apiMember({ user: apiUser({ id: IDS.owner }) }) });

        expect(discord.originalEdits(member)).toEqual([expect.objectContaining({
            content: "You have reached the maximum of 3 active movies. Remove one or wait for a movie night to conclude before adding more.",
        })]);
        expect(discord.originalEdits(admin)[0]?.embeds).toHaveLength(1);
        expect(discord.originalEdits(owner)[0]?.embeds).toHaveLength(1);
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({ discord, interact, services, db, http }) => {
        // Interactions from a guild discord.js hasn't cached carry the member as raw data, roles as ids
        await new GuildRepository(db).initGuild(IDS.uncachedGuild, buildGuild({ id: IDS.uncachedGuild }));
        discord.guild(apiGuild({ id: IDS.uncachedGuild }));
        await storeFullList(services, IDS.user);
        tmdbSearch(http, "The Matrix", [matrix]);

        const command = await interact(chatInputInteraction("addmovie", [title("The Matrix")], {
            guild_id: IDS.uncachedGuild,
            ...withRoles(IDS.roles.movieAdmin),
        }));

        expect(discord.originalEdits(command)[0]?.embeds).toHaveLength(1);
    });

    test("can be cancelled", async ({ discord, interact }) => {
        const cancel = await interact(buttonInteraction("addmovie|cancel", resultsMessage));

        expect(discord.callbacks(cancel)).toEqual([{ type: InteractionResponseType.UpdateMessage, data: expect.objectContaining({ content: "Cancelled movie selection.", components: [] }) }]);
    });

    test("is refused until the bot is set up", async ({ discord, slash, db }) => {
        await db.doc(`guilds/${IDS.guild}`).delete();

        const command = await slash("addmovie", [title("The Matrix")]);

        expect(discord.callbacks(command)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: "The bot has not been set up yet. Please run `/setup` first to configure the core channels." }),
        }]);
    });
});
