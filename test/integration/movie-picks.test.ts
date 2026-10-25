import { SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandOptionType,
    InteractionResponseType,
    MessageFlags,
    PermissionFlagsBits,
    type APIEmbed,
} from "discord-api-types/v10";
import { describe, expect, type StoringFactories, test } from "../fixtures.js";
import {
    AS,
    IDS,
    apiMember,
    apiMessage,
    apiUser,
    buttonInteraction,
    modalSubmitInteraction,
    stringSelectInteraction,
    chatInputInteraction,
} from "../discord/payloads.js";
import { moviePollFactory } from "../factories.js";
import { type Movie } from "../../src/models/Movie.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";

const SUBMITTER = SnowflakeUtil.generate().toString();
const pickMessage = apiMessage({ flags: MessageFlags.Ephemeral });

async function storeMovies(factories: StoringFactories, movies: Partial<Movie>[]): Promise<Movie[]> {
    const stored: Movie[] = [];
    for (const [index, movie] of movies.entries()) {
        stored.push(
            await factories.movie.create({
                id: `movie-${index + 1}`,
                addedBy: SUBMITTER,
                addedAt: new Date(Date.UTC(2026, 0, index + 1)),
                ...movie,
            }),
        );
    }
    return stored;
}

describe("a movie poll", () => {
    test("needs at least two unwatched movies", async ({ discord, interact, services, factories }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Heat", watched: true }]);
        await interact(
            stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"], pickMessage, AS.movieAdmin),
        );

        const click = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, AS.movieAdmin));

        expect(discord.callbacks(click)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You must select between 2 and 5 movies.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
    });

    test("counts a member's vote once, lets them change it, and shows the counts", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await factories.moviePoll.create();
        const pollMessage = apiMessage({
            id: poll.messageId,
            embeds: [
                { title: "Inception", footer: { text: "🗳️ 0 votes" } },
                { title: "Arrival", footer: { text: "🗳️ 0 votes" } },
            ],
        });
        discord.acceptMessageEdits(IDS.channel);

        const first = await interact(buttonInteraction("movie_vote_1", pollMessage));
        const changed = await interact(buttonInteraction("movie_vote_0", pollMessage));

        for (const click of [first, changed]) {
            expect(discord.originalEdits(click)).toEqual([
                expect.objectContaining({ content: "Thank you for your vote!" }),
            ]);
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
    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await storeMovies(factories, [{ title: "Inception" }]);

        const submit = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "Paddington" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "No matching movie found." }),
        ]);
    });

    test("locks in a random pick, but never a movie already watched", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception", watched: true }, { title: "Arrival" }]);
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));
        const randomPick = apiMessage({ embeds: [{ title: "🎲 Arrival" }] });

        const reroll = await interact(buttonInteraction("reroll_random_movie", randomPick));
        const lockWatched = await interact(buttonInteraction("confirm_random_movie_movie-1", randomPick));
        const lock = await interact(buttonInteraction("confirm_random_movie_movie-2", randomPick));

        expect(discord.callbacks(reroll)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ embeds: [expect.objectContaining({ title: "🎲 Arrival" })] }),
            }),
        ]);
        expect(discord.originalEdits(lockWatched)).toEqual([
            expect.objectContaining({ content: "Could not find the selected movie in the active movie list." }),
        ]);
        expect(discord.originalEdits(lock)).toEqual([
            expect.objectContaining({ content: "Movie selected and posted!" }),
        ]);
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            selectedBy: IDS.user,
            selectedAt: expect.any(Date),
        });
        expect((await services.repos.movieRepo.getMovieById("movie-1"))?.selectedAt).toBeUndefined();
    });
});

describe("/listmovies", () => {
    test("says the queue is empty when every movie has been watched", async ({ discord, interact, factories }) => {
        await factories.movie.create({ watched: true });

        const command = await interact(chatInputInteraction("listmovies"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "No unwatched movies are currently queued. Add a new one with `/addmovie`!",
            }),
        ]);
    });
});

describe("the movie list", () => {
    test("lets members remove their own movies and admins remove anyone's", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Arrival" }]);
        const someoneElse = { member: apiMember({ user: apiUser({ id: SnowflakeUtil.generate().toString() }) }) };
        const admin = {
            member: apiMember({
                user: apiUser({ id: SnowflakeUtil.generate().toString() }),
                permissions: String(PermissionFlagsBits.Administrator),
            }),
        };

        const refused = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }],
                someoneElse,
            ),
        );
        const byAdmin = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }],
                admin,
            ),
        );
        const byOwner = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Arrival" }],
                { member: apiMember({ user: apiUser({ id: SUBMITTER }) }) },
            ),
        );

        expect(discord.originalEdits(refused)).toEqual([
            expect.objectContaining({ content: "You can only remove movies you have added." }),
        ]);
        for (const removal of [byAdmin, byOwner]) {
            expect(discord.originalEdits(removal)).toEqual([
                expect.objectContaining({
                    content: expect.stringMatching(/^Movie \*\*.+\*\* has been removed from the list\.$/),
                }),
            ]);
        }
        expect(await services.repos.movieRepo.getAllMovies()).toEqual([]);
    });
});

describe("MovieRepository polls", () => {
    test("returns the most recently created active poll", async ({ services }) => {
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "older", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        );
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "newer", createdAt: new Date("2026-01-05T00:00:00.000Z") }),
        );
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "closed", createdAt: new Date("2026-01-09T00:00:00.000Z"), isActive: false }),
        );

        const active = await services.repos.movieRepo.getActivePoll();
        expect(active?.id).toBe("newer");
        expect(active?.createdAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
        expect(active?.endsAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    });

    test(
        "counts every vote when voters vote at the same time",
        async ({ services }) => {
            const poll = moviePollFactory.build();
            await services.repos.movieRepo.createPoll(poll);

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    services.repos.movieRepo.voteInPollOnce(poll.id, SnowflakeUtil.generate().toString(), "movie-1"),
                ),
            );

            expect(Object.keys((await services.repos.movieRepo.getActivePoll())?.votes ?? {})).toHaveLength(5);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );
});
