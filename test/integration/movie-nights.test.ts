import { type MovieEvent } from "../../src/models/MovieEvent.js";
import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { type APIRole, InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, vi, type StoringFactories, test } from "../fixtures.js";
import { type DiscordHarness } from "../discord/harness.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import {
    AS,
    IDS,
    apiRole,
    apiVoiceChannel,
    modalSubmitInteraction,
    chatInputInteraction,
} from "../discord/payloads.js";
import { movieEventFactory } from "../factories.js";

const VOICE = SnowflakeUtil.generate().toString();
const SUBMITTER = SnowflakeUtil.generate().toString();

async function setUpMovieNight(discord: DiscordHarness, services: ServiceContainer): Promise<APIRole> {
    const movieUsers = apiRole({ name: "Movie Night" });
    await discord.addChannel(apiVoiceChannel({ id: VOICE }));
    await discord.addRole(IDS.guild, movieUsers);
    await services.guilds.update(IDS.guild, {
        channels: { movieNight: IDS.channel, movieVC: VOICE },
        roles: { movieUser: movieUsers.id },
    });
    return movieUsers;
}

async function storeNight(
    factories: StoringFactories,
    overrides: Parameters<StoringFactories["movieEvent"]["create"]>[0] = {},
): Promise<MovieEvent> {
    return factories.movieEvent.create({
        movie: { id: "movie-2", title: "Arrival", addedBy: SUBMITTER, runtime: 30 },
        voiceChannelId: VOICE,
        ...overrides,
    });
}

describe("scheduling a movie night", () => {
    test("announces it, stores it in place of the previous night, and ends the open poll an hour before", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        const date = "2026-03-07";
        const start = DateTime.fromISO(`${date}T20:30:00.000Z`);
        const movies = services.repos.movieRepo;
        await factories.movie.create({
            id: "old-pick",
            title: "Old Pick",
            selectedAt: now.minus({ hours: 2 }).toJSDate(),
        });
        await factories.movie.create({
            id: "latest-pick",
            title: "Latest Pick",
            selectedAt: now.minus({ hours: 1 }).toJSDate(),
        });
        await factories.movie.create({ id: "watched", title: "Watched", watched: true, selectedAt: now.toJSDate() });
        await storeNight(factories, { id: "previous" });
        await factories.moviePoll.create({ endsAt: start.plus({ hours: 1 }).toJSDate() });
        discord.acceptMessages(IDS.channel);

        const submit = await interact(modalSubmitInteraction(`movienight-time-${date}`, { "start-time": "20:30" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: expect.stringMatching(/^Movie night scheduled for \*\*.+\*\* at \*\*20:30\*\*\.$/),
            }),
        ]);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: `<@&${movieUsers.id}>`,
            embeds: [expect.objectContaining({ title: "Now showing: Latest Pick" })],
        });
        expect(announcement?.embeds?.[0]?.fields).toContainEqual(
            expect.objectContaining({
                name: "🎥 Start Time",
                value: expect.stringContaining("Reminders will be sent at"),
            }),
        );
        const events = await movies.getAllEvents();
        expect(events.find((event) => event.id === "previous")).toMatchObject({ completed: true });
        const night = await movies.getActiveEvent();
        assert(night);
        expect(night).toMatchObject({
            startTime: start.toJSDate(),
            voiceChannelId: VOICE,
            channelId: IDS.channel,
            announcementMessageId: expect.any(String),
            movie: { id: "latest-pick" },
        });
        expect((await movies.getActivePoll())?.endsAt).toEqual(start.minus({ hours: 1 }).toJSDate());
    });

    test("rejects a time that isn't HH:MM, scheduling nothing", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("movienight-time-2026-03-05", { "start-time": "8pm" }));

        expect(discord.callbacks(submit)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Invalid time format. Use 24-hour HH:MM format (e.g. 20:30)." }),
        ]);
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
    });

    test("asks for /setup when the guild has no configuration", async ({ discord, interact, db }) => {
        await db.doc(`guilds/${IDS.guild}`).delete();

        const submit = await interact(modalSubmitInteraction("movienight-time-2026-03-05", { "start-time": "20:30" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Guild configuration not found. Please run `/setup` first." }),
        ]);
    });
});

describe("/endmovie", () => {
    test("says so when no movie night is on", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No active movie event found to end." }),
        ]);
    });
});

describe("/closemoviepoll", () => {
    test("says so when no poll is open", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("closemoviepoll", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([expect.objectContaining({ content: "No active poll found." })]);
    });
});

describe("/currentmovie", () => {
    test("says so when no night is scheduled", async ({ discord, interact, factories }) => {
        await factories.movieEvent.create({ completed: true });

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie night is currently scheduled." }),
        ]);
    });
});

describe("MovieRepository events", () => {
    test("returns the active event with the latest start time, as dates", async ({ services }) => {
        await services.repos.movieRepo.createMovieEvent(
            movieEventFactory.build({ id: "early", startTime: new Date("2026-01-03T09:00:00.000Z") }),
        );
        await services.repos.movieRepo.createMovieEvent(
            movieEventFactory.build({ id: "late", startTime: new Date("2026-01-10T09:00:00.000Z") }),
        );
        await services.repos.movieRepo.createMovieEvent(movieEventFactory.build({ id: "done", completed: true }));

        const active = await services.repos.movieRepo.getActiveEvent();
        expect(active?.id).toBe("late");
        expect(active?.startTime).toEqual(new Date("2026-01-10T09:00:00.000Z"));
    });
});
