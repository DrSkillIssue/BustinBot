import { ComponentType, MessageFlags, PermissionFlagsBits, type APIEmbed, type APIMessageTopLevelComponent } from "discord-api-types/v10";
import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { afterEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import {
    IDS,
    apiMember,
    apiMessage,
    apiUser,
    buttonInteraction,
    modalSubmitInteraction,
    stringSelectInteraction,
} from "../../../tests/discord/payloads.js";
import { buildMovie, buildMovieEvent, buildMoviePoll } from "../../../tests/fakes/builders.js";
import type { Movie } from "../../../models/Movie.js";
import { pollMovieWithList } from "../MoviePolls.js";
import { showMovieManualPollMenu } from "../MovieManualPoll.js";
import { addMovieWithStats } from "../MovieService.js";

const SUBMITTER = "100000000000000036";
const VOICE = "100000000000000080";
const DAY = 24 * 60 * 60 * 1000;

// The movie list, oldest first, so list numbers are 1, 2, 3
async function storeMovies(services: ServiceContainer, movies: Partial<Movie>[]): Promise<Movie[]> {
    const stored = movies.map((movie, index) => buildMovie({ id: `movie-${index + 1}`, addedBy: SUBMITTER, addedAt: new Date(Date.UTC(2026, 0, index + 1)), ...movie }));
    for (const movie of stored) await services.repos.movieRepo!.upsertMovie(movie);
    return stored;
}

function buttonIds(components: APIMessageTopLevelComponent[] | null | undefined): string[] {
    return (components ?? []).flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
        .flatMap((button) => ("custom_id" in button ? [button.custom_id] : []));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("a movie poll", () => {
    test("is posted with a button per movie, leaving out watched ones, and stored", async ({ discord, services }) => {
        const movies = await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        discord.acceptMessages(IDS.channel);
        const click = await discord.dispatch(buttonInteraction("movie_poll_manual_confirm")) as ButtonInteraction;

        await pollMovieWithList(services, click, movies);

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Poll confirmed and posted!" })]);
        const posted = discord.messagesSentTo(IDS.channel).find((message) => message.content?.startsWith("📊 **Vote for the next movie night pick!**"));
        expect(buttonIds(posted?.components)).toEqual(["movie_vote_0", "movie_vote_1"]);
        expect(posted?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
        const poll = await services.repos.movieRepo!.getActivePoll();
        expect(poll).toMatchObject({ isActive: true, channelId: IDS.channel, messageId: expect.any(String) });
        expect(poll?.options.map((movie) => movie.id)).toEqual(["movie-1", "movie-2"]);
    });

    test("needs at least two unwatched movies", async ({ discord, services }) => {
        const movies = await storeMovies(services, [{ title: "Inception" }, { title: "Heat", watched: true }]);
        const click = await discord.dispatch(buttonInteraction("movie_poll_manual_confirm")) as ButtonInteraction;

        await pollMovieWithList(services, click, movies);

        expect(discord.callbacks(click)).toEqual([{ type: 4, data: expect.objectContaining({ content: "You must select between 2 and 5 movies.", flags: MessageFlags.Ephemeral }) }]);
        expect(await services.repos.movieRepo!.getActivePoll()).toBeNull();
    });

    test("counts a member's vote once, lets them change it, and shows the counts", async ({ discord, interact, services }) => {
        const poll = buildMoviePoll();
        await services.repos.movieRepo!.createPoll(poll);
        const pollMessage = apiMessage({ id: poll.messageId, embeds: [{ title: "Inception", footer: { text: "🗳️ 0 votes" } }, { title: "Arrival", footer: { text: "🗳️ 0 votes" } }] });
        discord.acceptMessageEdits(IDS.channel);

        const first = await interact(buttonInteraction("movie_vote_1", pollMessage));
        const changed = await interact(buttonInteraction("movie_vote_0", pollMessage));

        for (const click of [first, changed]) {
            expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thank you for your vote!" })]);
        }
        expect((await services.repos.movieRepo!.getActivePoll())?.votes).toEqual({ [IDS.user]: "movie-1" });
        expect(await services.repos.userRepo!.getUserById(IDS.user)).toMatchObject({ moviePollsVoted: 1 });
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
        await services.repos.movieRepo!.createMovieEvent(buildMovieEvent({ startTime: new Date(Date.now() + DAY), movie: buildMovie({ id: "TBD", title: "TBD" }) }));
        await services.guilds.update(IDS.guild, { channels: { ...(await services.guilds.get(IDS.guild))!.channels, movieVC: VOICE } });
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
        expect(await services.repos.movieRepo!.getActiveEvent()).toMatchObject({ movie: { id: "movie-1", selectedBy: IDS.user }, voiceChannelId: VOICE });
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
        expect(await services.repos.movieRepo!.getMovieById("movie-2")).toMatchObject({ selectedBy: IDS.user, selectedAt: expect.any(Date) });
        expect((await services.repos.movieRepo!.getMovieById("movie-1"))?.selectedAt).toBeUndefined();
    });
});

describe("the manual poll menu", () => {
    test("lists the unwatched movies and enables Confirm once two are selected", async ({ discord, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        const command = await discord.dispatch(buttonInteraction("movie_poll_manual")) as ButtonInteraction;
        await command.deferReply({ flags: MessageFlags.Ephemeral });

        await showMovieManualPollMenu(services, command);
        const select = await discord.dispatch(stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"])) as StringSelectMenuInteraction;
        const { updateManualPollSelection } = await import("../MovieManualPoll.js");
        updateManualPollSelection(IDS.user, select.values);
        await showMovieManualPollMenu(services, select);

        const [menu] = discord.originalEdits(command);
        expect(JSON.stringify(menu?.components)).toContain('"label":"1. Inception"');
        expect(JSON.stringify(menu?.components)).not.toContain("Heat");
        expect(JSON.stringify(menu?.components)).toMatch(/"custom_id":"movie_poll_manual_confirm","label":"Confirm","style":3,"disabled":true/);
        expect(JSON.stringify(discord.callbacks(select))).toMatch(/"custom_id":"movie_poll_manual_confirm","label":"Confirm","style":3,"disabled":false/);
    });

    test("says there is nothing to poll when every movie has been watched", async ({ discord, services }) => {
        await storeMovies(services, [{ title: "Inception", watched: true }]);
        const command = await discord.dispatch(buttonInteraction("movie_poll_manual")) as ButtonInteraction;
        await command.deferReply({ flags: MessageFlags.Ephemeral });

        await showMovieManualPollMenu(services, command);

        expect(discord.requests().filter((request) => request.method === "POST" && request.path.includes("/webhooks/"))).toEqual([
            expect.objectContaining({ body: expect.objectContaining({ content: "No active movies found." }) }),
        ]);
    });
});

describe("the movie list", () => {
    test("lets members remove their own movies and admins remove anyone's", async ({ discord, slash, services }) => {
        await storeMovies(services, [{ title: "Inception" }, { title: "Arrival" }]);
        const someoneElse = { member: apiMember({ user: apiUser({ id: "100000000000000099" }) }) };
        const admin = { member: apiMember({ user: apiUser({ id: "100000000000000098" }), permissions: String(PermissionFlagsBits.Administrator) }) };

        const refused = await slash("removemovie", [{ type: 3, name: "title", value: "Inception" }], someoneElse);
        const byAdmin = await slash("removemovie", [{ type: 3, name: "title", value: "Inception" }], admin);
        const byOwner = await slash("removemovie", [{ type: 3, name: "title", value: "Arrival" }], { member: apiMember({ user: apiUser({ id: SUBMITTER }) }) });

        expect(discord.originalEdits(refused)).toEqual([expect.objectContaining({ content: "You can only remove movies you have added." })]);
        for (const removal of [byAdmin, byOwner]) {
            expect(discord.originalEdits(removal)).toEqual([expect.objectContaining({ content: expect.stringMatching(/^Movie \*\*.+\*\* has been removed from the list\.$/) })]);
        }
        expect(await services.repos.movieRepo!.getAllMovies()).toEqual([]);
    });

    test("counts each movie a member adds", async ({ services }) => {
        await addMovieWithStats(buildMovie({ id: "movie-1", addedBy: SUBMITTER }), services);

        expect(await services.repos.movieRepo!.getMovieById("movie-1")).toMatchObject({ addedBy: SUBMITTER });
        expect(await services.repos.userRepo!.getUserById(SUBMITTER)).toMatchObject({ moviesAdded: 1 });
    });
});
