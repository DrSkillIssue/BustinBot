import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags, PermissionFlagsBits, type APIEmbed } from "discord-api-types/v10";
import { DateTime } from "luxon";
import { describe, expect, test } from "../../../tests/fixtures.js";
import { buttonsIn } from "../../../tests/discord/harness.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, apiMember, apiMessage, apiUser, buttonInteraction, modalSubmitInteraction, stringSelectInteraction } from "../../../tests/discord/payloads.js";
import { buildMovie, buildMovieEvent, buildMoviePoll } from "../../../tests/fakes/builders.js";
import type { Movie } from "../../../models/Movie.js";
import { addMovieWithStats } from "../MovieService.js";

const SUBMITTER = SnowflakeUtil.generate().toString();
const VOICE = SnowflakeUtil.generate().toString();
const movieAdmin = { member: apiMember({ roles: [IDS.roles.movieAdmin] }) };
const pickMessage = apiMessage({ flags: MessageFlags.Ephemeral });

// The movie list, oldest first, so list numbers are 1, 2, 3
async function storeMovies(services: ServiceContainer, movies: Partial<Movie>[]): Promise<Movie[]> {
    const stored = movies.map((movie, index) => buildMovie({ id: `movie-${index + 1}`, addedBy: SUBMITTER, addedAt: new Date(Date.UTC(2026, 0, index + 1)), ...movie }));
    for (const movie of stored) await services.repos.movieRepo.upsertMovie(movie);
    return stored;
}

describe("a movie poll", () => {
    test("is posted with a button per movie, leaving out one watched since it was chosen, and stored", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        discord.acceptMessages(IDS.channel);
        await interact(stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2", "movie-3"], pickMessage, movieAdmin));

        const click = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, movieAdmin));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Poll confirmed and posted!" })]);
        const posted = discord.messagesSentTo(IDS.channel).find((message) => message.content?.startsWith("📊 **Vote for the next movie night pick!**"));
        expect(buttonsIn(posted?.components).map((button) => button.customId)).toEqual(["movie_vote_0", "movie_vote_1"]);
        expect(posted?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
        const poll = await services.repos.movieRepo.getActivePoll();
        expect(poll).toMatchObject({ isActive: true, channelId: IDS.channel, messageId: expect.any(String) });
        expect(poll?.options.map((movie) => movie.id)).toEqual(["movie-1", "movie-2"]);
    });

    test("needs at least two unwatched movies", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Heat", watched: true }]);
        await interact(stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"], pickMessage, movieAdmin));

        const click = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, movieAdmin));

        expect(discord.callbacks(click)).toEqual([{ type: InteractionResponseType.ChannelMessageWithSource, data: expect.objectContaining({ content: "You must select between 2 and 5 movies.", flags: MessageFlags.Ephemeral }) }]);
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
    });

    test("counts a member's vote once, lets them change it, and shows the counts", async ({ discord, interact, services }) => {
        const poll = buildMoviePoll();
        await services.repos.movieRepo.createPoll(poll);
        const pollMessage = apiMessage({ id: poll.messageId, embeds: [{ title: "Inception", footer: { text: "🗳️ 0 votes" } }, { title: "Arrival", footer: { text: "🗳️ 0 votes" } }] });
        discord.acceptMessageEdits(IDS.channel);

        const first = await interact(buttonInteraction("movie_vote_1", pollMessage));
        const changed = await interact(buttonInteraction("movie_vote_0", pollMessage));

        for (const click of [first, changed]) {
            expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thank you for your vote!" })]);
        }
        expect((await services.repos.movieRepo.getActivePoll())?.votes).toEqual({ [IDS.user]: "movie-1" });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ moviePollsVoted: 1 });
        const footers = (embeds: APIEmbed[] | undefined) => embeds?.map((embed) => embed.footer?.text);
        expect(footers(discord.messageEdits(IDS.channel, poll.messageId).at(-1)?.embeds)).toEqual([
            "🗳️ 1 vote | ⏱️ 148 mins | Option 1",
            "🗳️ 0 votes | ⏱️ 148 mins | Option 2",
        ]);
    });
});

describe("choosing the movie for movie night", () => {
    test("takes a list number or a close title, makes it the night's movie, posts it and tells who added it", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }]);
        await services.repos.movieRepo.createMovieEvent(buildMovieEvent({ startTime: DateTime.now().plus({ days: 1 }).toJSDate(), movie: buildMovie({ id: "TBD", title: "TBD" }) }));
        await services.guilds.update(IDS.guild, { channels: { movieVC: VOICE } });
        discord.acceptMessages(IDS.channel);
        discord.user(apiUser({ id: SUBMITTER }));
        const dm = discord.acceptDirectMessages(SUBMITTER);

        const byNumber = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "2" }));
        const byTitle = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "incepshun" }));

        expect(discord.originalEdits(byNumber)).toEqual([expect.objectContaining({ content: "**Arrival** has been selected and posted!" })]);
        expect(discord.originalEdits(byTitle)).toEqual([expect.objectContaining({ content: "**Inception** has been selected and posted!" })]);
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            "The following movie has been selected for movie night:",
            "The following movie has been selected for movie night:",
        ]);
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({ movie: { id: "movie-1", selectedBy: IDS.user }, voiceChannelId: VOICE });
        expect(discord.messagesSentTo(dm)).toHaveLength(2);
    });

    test("says so when nothing matches", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception" }]);

        const submit = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "Paddington" }));

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "No matching movie found." })]);
    });

    test("locks in a random pick, but never a movie already watched", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception", watched: true }, { title: "Arrival" }]);
        discord.acceptMessages(IDS.channel);
        discord.user(apiUser({ id: SUBMITTER }));
        discord.acceptDirectMessages(SUBMITTER);
        const randomPick = apiMessage({ embeds: [{ title: "🎲 Arrival" }] });

        const reroll = await interact(buttonInteraction("reroll_random_movie", randomPick));
        const lockWatched = await interact(buttonInteraction("confirm_random_movie_movie-1", randomPick));
        const lock = await interact(buttonInteraction("confirm_random_movie_movie-2", randomPick));

        expect(JSON.stringify(discord.callbacks(reroll))).toContain('"title":"🎲 Arrival"');
        expect(discord.originalEdits(lockWatched)).toEqual([expect.objectContaining({ content: "Could not find the selected movie in the active movie list." })]);
        expect(discord.originalEdits(lock)).toEqual([expect.objectContaining({ content: "Movie selected and posted!" })]);
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({ selectedBy: IDS.user, selectedAt: expect.any(Date) });
        expect((await services.repos.movieRepo.getMovieById("movie-1"))?.selectedAt).toBeUndefined();
    });
});

describe("/pickmovie", () => {
    test("offers its four ways to pick, each answered by the bot whenever it is pressed", async ({ discord, interact, slash, services }) => {
        await storeMovies(services, [{ title: "Inception" }]);
        const command = await slash("pickmovie", [], movieAdmin);
        const offered = buttonsIn(discord.originalEdits(command)[0]?.components).map((button) => button.customId);

        const choose = await interact(buttonInteraction("movie_pick_choose", pickMessage, movieAdmin));
        const random = await interact(buttonInteraction("movie_pick_random", pickMessage, movieAdmin));
        const pollRandom = await interact(buttonInteraction("movie_poll_random", pickMessage, movieAdmin));

        expect(offered).toEqual(["movie_pick_choose", "movie_pick_random", "movie_poll_random", "movie_poll_manual"]);
        expect(discord.modal(choose)?.custom_id).toBe("movie_pick_choose_modal");
        expect(discord.originalEdits(random)).toEqual([expect.objectContaining({ content: "A random movie has been selected:", embeds: [expect.objectContaining({ title: "🎲 Inception" })] })]);
        expect(JSON.stringify(discord.callbacks(pollRandom))).toContain('"custom_id":"movie_poll_random_count"');
    });

    test("builds a poll from the movies picked in the manual menu", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        discord.acceptMessages(IDS.channel);

        const open = await interact(buttonInteraction("movie_poll_manual", pickMessage, movieAdmin));
        const choose = await interact(stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"], pickMessage, movieAdmin));
        const confirm = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, movieAdmin));

        const menu = JSON.stringify(discord.originalEdits(open)[0]?.components);
        expect(menu).toContain('"label":"1. Inception"');
        expect(menu).not.toContain("Heat");
        expect(buttonsIn(discord.originalEdits(open)[0]?.components).find((button) => button.customId === "movie_poll_manual_confirm")).toMatchObject({ disabled: true });
        expect(buttonsIn(discord.originalEdits(choose)[0]?.components).find((button) => button.customId === "movie_poll_manual_confirm")).toMatchObject({ disabled: false });
        expect(discord.originalEdits(confirm)).toEqual([expect.objectContaining({ content: "Poll confirmed and posted!" })]);
        expect((await services.repos.movieRepo.getActivePoll())?.options.map((movie) => movie.id)).toEqual(["movie-1", "movie-2"]);
    });

    test("answers a menu choice when every movie has been watched", async ({ discord, interact, services }) => {
        await storeMovies(services, [{ title: "Inception", watched: true }]);

        const choose = await interact(stringSelectInteraction("movie_poll_manual_select", ["movie-1"], apiMessage({ flags: MessageFlags.Ephemeral }), movieAdmin));

        expect(discord.callbacks(choose)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.followUps(choose)).toEqual([
            expect.objectContaining({ content: "No active movies found." }),
        ]);
    });
});

describe("/listmovies", () => {
    test("pages through the unwatched movies with buttons that keep working", async ({ discord, interact, slash, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat" }, { title: "Alien" }, { title: "Jaws", watched: true }]);

        const command = await slash("listmovies");
        const [firstPage] = discord.originalEdits(command);
        const next = await interact(buttonInteraction("listmovies|next|1", apiMessage({ flags: MessageFlags.Ephemeral })));

        expect(firstPage?.embeds?.map((embed) => embed.title)).toEqual(["1. Inception", "2. Arrival", "3. Heat"]);
        expect(buttonsIn(firstPage?.components).map((button) => button.customId)).toEqual(["listmovies|start|0", "listmovies|prev|-1", "listmovies|next|1", "listmovies|end|1"]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.map((embed) => embed.title)).toEqual(["4. Alien"]);
        expect(buttonsIn(secondPage?.components).find((button) => button.customId === "listmovies|end|1")).toMatchObject({ disabled: true });
        expect(buttonsIn(secondPage?.components).find((button) => button.customId === "listmovies|prev|0")).toMatchObject({ disabled: false });
    });
});

describe("the movie list", () => {
    test("lets members remove their own movies and admins remove anyone's", async ({ discord, slash, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }]);
        const someoneElse = { member: apiMember({ user: apiUser({ id: SnowflakeUtil.generate().toString() }) }) };
        const admin = { member: apiMember({ user: apiUser({ id: SnowflakeUtil.generate().toString() }), permissions: String(PermissionFlagsBits.Administrator) }) };

        const refused = await slash("removemovie", [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }], someoneElse);
        const byAdmin = await slash("removemovie", [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }], admin);
        const byOwner = await slash("removemovie", [{ type: ApplicationCommandOptionType.String, name: "title", value: "Arrival" }], { member: apiMember({ user: apiUser({ id: SUBMITTER }) }) });

        expect(discord.originalEdits(refused)).toEqual([expect.objectContaining({ content: "You can only remove movies you have added." })]);
        for (const removal of [byAdmin, byOwner]) {
            expect(discord.originalEdits(removal)).toEqual([expect.objectContaining({ content: expect.stringMatching(/^Movie \*\*.+\*\* has been removed from the list\.$/) })]);
        }
        expect(await services.repos.movieRepo.getAllMovies()).toEqual([]);
    });

    test("counts each movie a member adds", async ({ services }) => {
        await addMovieWithStats(buildMovie({ id: "movie-1", addedBy: SUBMITTER }), services);

        expect(await services.repos.movieRepo.getMovieById("movie-1")).toMatchObject({ addedBy: SUBMITTER });
        expect(await services.repos.userRepo.getUserById(SUBMITTER)).toMatchObject({ moviesAdded: 1 });
    });
});
