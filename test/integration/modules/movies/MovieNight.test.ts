import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import cron from "node-cron";
import { DateTime } from "luxon";
import type { APIRole } from "discord-api-types/v10";
import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test, vi, type StoringFactories } from "../../../fixtures.js";
import type { ServiceContainer } from "../../../../src/core/services/ServiceContainer.js";
import type { DiscordHarness } from "../../../discord/harness.js";
import { createServiceContainer } from "../../../../src/core/services/ServiceFactory.js";
import {
    AS,
    IDS,
    apiGuild,
    apiMessage,
    apiRole,
    apiTextChannel,
    apiUser,
    apiVoiceChannel,
    apiVoiceState,
    modalSubmitInteraction,
    stringSelectInteraction,
    chatInputInteraction,
} from "../../../discord/payloads.js";
import { movieFactory, moviePollFactory } from "../../../factories.js";
import type { MovieEvent } from "../../../../src/models/MovieEvent.js";
import { startMovieScheduler, sweepMovieNight } from "../../../../src/modules/movies/MovieScheduler.js";

const VOICE = SnowflakeUtil.generate().toString();
const SUBMITTER = SnowflakeUtil.generate().toString();
const [present, joiner, leaver] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

// The guild's movie night set up as /moviesetup leaves it: the harness channel, a voice channel and a role to ping
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

async function storeNight(factories: StoringFactories, overrides: Partial<MovieEvent> = {}): Promise<MovieEvent> {
    return factories.movieEvent.create({
        movie: { id: "movie-2", title: "Arrival", addedBy: SUBMITTER, runtime: 30 },
        voiceChannelId: VOICE,
        ...overrides,
    });
}

describe("scheduling a movie night", () => {
    test("/movienight offers the next 14 days, by the guild's calendar", async ({ discord, interact, services }) => {
        await services.guilds.update(IDS.guild, { timezone: "Pacific/Kiritimati" });
        // Noon UTC on 5 March, when it is already 6 March in Kiribati
        vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));

        const command = await interact(chatInputInteraction("movienight", [], AS.movieAdmin));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "📆 Choose a date for the next movie night:",
                    components: [
                        expect.objectContaining({
                            components: [
                                expect.objectContaining({
                                    custom_id: "movienight-select-date",
                                    options: [
                                        { label: "Fri, 6 Mar", value: "2026-03-06" },
                                        { label: "Sat, 7 Mar", value: "2026-03-07" },
                                        { label: "Sun, 8 Mar", value: "2026-03-08" },
                                        { label: "Mon, 9 Mar", value: "2026-03-09" },
                                        { label: "Tue, 10 Mar", value: "2026-03-10" },
                                        { label: "Wed, 11 Mar", value: "2026-03-11" },
                                        { label: "Thu, 12 Mar", value: "2026-03-12" },
                                        { label: "Fri, 13 Mar", value: "2026-03-13" },
                                        { label: "Sat, 14 Mar", value: "2026-03-14" },
                                        { label: "Sun, 15 Mar", value: "2026-03-15" },
                                        { label: "Mon, 16 Mar", value: "2026-03-16" },
                                        { label: "Tue, 17 Mar", value: "2026-03-17" },
                                        { label: "Wed, 18 Mar", value: "2026-03-18" },
                                        { label: "Thu, 19 Mar", value: "2026-03-19" },
                                    ],
                                }),
                            ],
                        }),
                    ],
                }),
            },
        ]);
    });

    test("asks for a start time in the guild's timezone once a date is picked", async ({ discord, interact }) => {
        const pick = await interact(stringSelectInteraction("movienight-select-date", ["2026-03-05"]));

        const form = discord.modal(pick);
        expect(form).toMatchObject({ custom_id: "movienight-time-2026-03-05", title: "Enter movie night time" });
        expect(JSON.stringify(form?.components)).toContain('"label":"Start time (UTC+0)"');
    });

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
        expect(JSON.stringify(announcement?.embeds)).toContain("Reminders will be sent at");
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
        // Attendance starts at the start time, not when the night is scheduled
        expect(services.movieAttendance.isTracking(night.id)).toBe(false);
    });

    test("points members at the running poll and stores a placeholder movie when none is chosen yet", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await setUpMovieNight(discord, services);
        const date = "2026-03-07";
        const pollChannel = SnowflakeUtil.generate().toString();
        await factories.moviePoll.create({
            endsAt: now.plus({ hours: 1 }).toJSDate(),
            channelId: pollChannel,
        });
        discord.acceptMessages(IDS.channel);

        await interact(modalSubmitInteraction(`movienight-time-${date}`, { "start-time": "21:00" }));

        expect(JSON.stringify(discord.messagesSentTo(IDS.channel)[0]?.embeds)).toContain(
            `A poll is currently running in <#${pollChannel}>`,
        );
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({ movie: { id: "TBD", title: "TBD" } });
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

describe("the movie night sweep", () => {
    test("sends each reminder once when it comes due", async ({ discord, services, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 3 }).toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        for (const sweepAt of [
            start.minus({ hours: 2 }),
            start.minus({ hours: 2 }).plus({ minutes: 1 }),
            start.minus({ minutes: 30 }),
            start,
            start.plus({ minutes: 1 }),
        ]) {
            vi.setSystemTime(sweepAt.toJSDate());
            await sweepMovieNight(discord.client, services);
        }

        const startsAt = `<t:${start.toUnixInteger()}:t>`;
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `<@&${movieUsers.id}> Movie night starts in **2 hours** (at ${startsAt})! We will be watching **Arrival**!`,
            `<@&${movieUsers.id}> Movie night starts in **30 minutes** (at ${startsAt})! We will be watching **Arrival**!`,
            `<@&${movieUsers.id}> Movie night is starting **now**! Join us in <#${VOICE}> 🎬\nWe will be watching **Arrival**!`,
        ]);
    });

    test("sends only the latest reminder that came due while the bot was down, and none once it is too late", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 1 }).toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        const night = await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        vi.setSystemTime(start.minus({ minutes: 20 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.plus({ minutes: 20 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `<@&${movieUsers.id}> Movie night starts in **20 minutes** (at <t:${start.toUnixInteger()}:t>)! We will be watching **Arrival**!`,
        ]);
        expect(warn).toHaveBeenCalledWith(
            `[MovieReminders] Skipped the "start time" reminder for ${night.id}: it came due while the bot was down.`,
        );
    });

    test("holds a reminder while the movie night channel can't be reached, and sends it once it can", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await setUpMovieNight(discord, services);
        await services.guilds.update(IDS.guild, { channels: { movieNight: "" } });
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await sweepMovieNight(discord.client, services);
        await services.guilds.update(IDS.guild, { channels: { movieNight: IDS.channel } });
        vi.setSystemTime(start.minus({ minutes: 29 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[MovieChannel] Movie night channel (not set) not found for guild ${IDS.guild}.`,
        );
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **29 minutes**"),
        ]);
    });

    test("keeps working from what is stored after a restart", async ({ discord, services, db, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate(), remindersSent: ["2 hours before"] });
        discord.acceptMessages(IDS.channel);
        // A new container, as the bot builds after restarting: nothing carried over in memory
        const restarted = createServiceContainer(db, IDS.guild, services.botStats);

        await sweepMovieNight(discord.client, restarted);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **30 minutes**"),
        ]);
    });

    test("closes the poll once its time is up, picks the winner and announces it once", async ({
        discord,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await setUpMovieNight(discord, services);
        const poll = await factories.moviePoll.create({
            options: [
                movieFactory.build({ id: "movie-1", addedBy: SUBMITTER }),
                movieFactory.build({ id: "movie-2", title: "Arrival", addedBy: SUBMITTER }),
            ],
            endsAt: now.minus({ minutes: 1 }).toJSDate(),
            votes: { [present]: "movie-2", [joiner]: "movie-2", [leaver]: "movie-1" },
        });
        await storeNight(factories, {
            startTime: now.plus({ hours: 3 }).toJSDate(),
            movie: movieFactory.build({ id: "TBD", title: "TBD" }),
        });
        discord.message(apiMessage({ id: poll.messageId }));
        discord.acceptMessageEdits(IDS.channel);
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        await sweepMovieNight(discord.client, services);
        await sweepMovieNight(discord.client, services);

        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            selectedBy: "Scheduler",
            selectedAt: expect.any(Date),
        });
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({ movie: { id: "movie-2" } });
        const announcements = discord
            .messagesSentTo(IDS.channel)
            .filter((message) => message.embeds?.[0]?.title === "🏆 Movie poll closed!");
        expect(announcements).toHaveLength(1);
        expect(announcements[0]?.embeds?.[0]?.description).toContain("**Arrival**");
        expect(discord.messageEdits(IDS.channel, poll.messageId)[0]?.content).toContain("**Arrival** was selected!");
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("Your movie **Arrival** has been chosen") }),
        ]);
    });

    test("counts attendance from the start time and ends the night once its movie has run", async ({
        discord,
        services,
        voice,
        factories,
    }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 10 }).toJSDate());
        await setUpMovieNight(discord, services);
        // Its reminders have gone out; this is about the night itself
        const night = await storeNight(factories, {
            startTime: start.toJSDate(),
            remindersSent: ["2 hours before", "30 mins before", "start time"],
        });
        await factories.movie.create(night.movie);
        for (const userId of [present, leaver]) await voice(apiVoiceState(userId, VOICE));
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));
        await factories.userStats.create({ userId: present });

        vi.setSystemTime(start.minus({ minutes: 5 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        expect(services.movieAttendance.isTracking(night.id)).toBe(false);

        vi.setSystemTime(start.toJSDate());
        await sweepMovieNight(discord.client, services);
        // Ten minutes in: one member leaves for good and another arrives
        vi.setSystemTime(start.plus({ minutes: 10 }).toJSDate());
        await voice(apiVoiceState(leaver, null));
        await voice(apiVoiceState(joiner, VOICE));
        // The movie runs 30 minutes, and the night ends 30 minutes after that
        vi.setSystemTime(start.plus({ minutes: 60 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.plus({ minutes: 61 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(await services.repos.userRepo.getUserById(present)).toMatchObject({ moviesAttended: 1 });
        expect(await services.repos.userRepo.getUserById(joiner)).toMatchObject({ moviesAttended: 1 });
        expect(await services.repos.userRepo.getUserById(leaver)).toBeNull();
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            watched: true,
            watchedAt: start.plus({ minutes: 60 }).toJSDate(),
        });
        expect(
            discord.messagesSentTo(IDS.channel).filter((message) => message.content?.includes("has finished")),
        ).toEqual([
            expect.objectContaining({
                content:
                    "🎞️ **Arrival** has finished and has now been archived from the active list. Thanks for watching!",
            }),
        ]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("your movie **Arrival** has been watched") }),
        ]);
    });

    test("sends nothing more for a night that was cancelled", async ({ discord, interact, services, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 1 }).toJSDate());
        await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `❌ Movie night has been cancelled by <@${IDS.user}>.`,
        ]);
    });

    test("keeps each guild's movie night to itself", async ({ discord, services, otherGuild, factories }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await discord.addGuild(
            apiGuild({
                id: IDS.otherGuild,
                channels: [apiTextChannel({ id: IDS.otherGuildChannel, guild_id: IDS.otherGuild })],
            }),
        );
        const duePoll = moviePollFactory.build({
            endsAt: now.minus({ minutes: 1 }).toJSDate(),
            votes: { [present]: "movie-2" },
            messageId: "",
            channelId: IDS.otherGuildChannel,
        });
        await otherGuild.repos.movieRepo.createPoll(duePoll);
        await factories.moviePoll.create({ endsAt: now.plus({ hours: 1 }).toJSDate() });
        discord.acceptMessages(IDS.otherGuildChannel);
        discord.acceptDirectMessages(apiUser());

        for (const guild of [services, otherGuild]) await sweepMovieNight(discord.client, guild);

        expect(discord.messagesSentTo(IDS.otherGuildChannel)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "🏆 Movie poll closed!" })] }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
        expect(await services.repos.movieRepo.getActivePoll()).not.toBeNull();
    });

    test("runs every minute as one job that node-cron's shutdown stops", async ({ discord }) => {
        const task = startMovieScheduler(discord.client, () => []);
        try {
            expect([...cron.getTasks().values()].map((job) => job.name)).toContain("movieScheduler:sweep");
        } finally {
            await task.destroy();
        }
    });
});
