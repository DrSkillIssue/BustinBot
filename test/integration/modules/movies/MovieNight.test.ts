import { SnowflakeUtil } from "discord.js";
import cron from "node-cron";
import { DateTime } from "luxon";
import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, test, vi, type StoringFactories } from "../../../fixtures.js";
import type { ServiceContainer } from "../../../../src/core/services/ServiceContainer.js";
import type { DiscordHarness } from "../../../discord/harness.js";
import { createServiceContainer } from "../../../../src/core/services/ServiceFactory.js";
import {
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
    apiMember,
} from "../../../discord/payloads.js";
import { movieFactory, moviePollFactory } from "../../../factories.js";
import type { MovieEvent } from "../../../../src/models/MovieEvent.js";
import { startMovieScheduler, sweepMovieNight } from "../../../../src/modules/movies/MovieScheduler.js";

const VOICE = SnowflakeUtil.generate().toString();
const SUBMITTER = SnowflakeUtil.generate().toString();
const movieUsers = apiRole({ name: "Movie Night" });
const [present, joiner, leaver] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

// The guild's movie night set up as /moviesetup leaves it: the harness channel, a voice channel and a role to ping
async function setUpMovieNight(discord: DiscordHarness, services: ServiceContainer): Promise<void> {
    await discord.addChannel(apiVoiceChannel({ id: VOICE }));
    await discord.addRole(IDS.guild, movieUsers);
    await services.guilds.update(IDS.guild, {
        channels: { movieNight: IDS.channel, movieVC: VOICE },
        roles: { movieUser: movieUsers.id },
    });
}

async function storeNight(factories: StoringFactories, overrides: Partial<MovieEvent> = {}): Promise<MovieEvent> {
    return factories.movieEvent.create({
        movie: { id: "movie-2", title: "Arrival", addedBy: SUBMITTER, runtime: 30 },
        voiceChannelId: VOICE,
        ...overrides,
    });
}

describe("scheduling a movie night", () => {
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
        await setUpMovieNight(discord, services);
        const date = DateTime.utc().plus({ days: 2 }).toISODate()!;
        const start = DateTime.fromISO(`${date}T20:30:00.000Z`);
        const movies = services.repos.movieRepo;
        await factories.movie.create({
            id: "old-pick",
            title: "Old Pick",
            selectedAt: DateTime.now().minus({ hours: 2 }).toJSDate(),
        });
        await factories.movie.create({
            id: "latest-pick",
            title: "Latest Pick",
            selectedAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });
        await factories.movie.create({ id: "watched", title: "Watched", watched: true, selectedAt: new Date() });
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
        expect(night).toMatchObject({
            startTime: start.toJSDate(),
            voiceChannelId: VOICE,
            channelId: IDS.channel,
            announcementMessageId: expect.any(String),
            movie: { id: "latest-pick" },
        });
        expect((await movies.getActivePoll())?.endsAt).toEqual(start.minus({ hours: 1 }).toJSDate());
        // Attendance starts at the start time, not when the night is scheduled
        expect(services.movieAttendance.isTracking(night!.id)).toBe(false);
    });

    test("points members at the running poll and stores a placeholder movie when none is chosen yet", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await setUpMovieNight(discord, services);
        const date = DateTime.utc().plus({ days: 2 }).toISODate()!;
        const pollChannel = SnowflakeUtil.generate().toString();
        await factories.moviePoll.create({
            endsAt: DateTime.now().plus({ hours: 1 }).toJSDate(),
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
        await setUpMovieNight(discord, services);
        const start = DateTime.now().plus({ hours: 3 });
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        for (const sweepAt of [
            start.minus({ hours: 2 }).toJSDate(),
            start.minus({ hours: 2 }).plus({ minutes: 1 }).toJSDate(),
            start.minus({ minutes: 30 }).toJSDate(),
            start.toJSDate(),
            start.plus({ minutes: 1 }).toJSDate(),
        ]) {
            await sweepMovieNight(discord.client, services, sweepAt);
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
        await setUpMovieNight(discord, services);
        const start = DateTime.now().plus({ hours: 1 });
        const night = await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await sweepMovieNight(discord.client, services, start.minus({ minutes: 20 }).toJSDate());
        await sweepMovieNight(discord.client, services, start.plus({ minutes: 20 }).toJSDate());

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
        await setUpMovieNight(discord, services);
        await services.guilds.update(IDS.guild, { channels: { movieNight: "" } });
        const start = DateTime.now().plus({ minutes: 30 });
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await sweepMovieNight(discord.client, services, start.minus({ minutes: 30 }).toJSDate());
        await services.guilds.update(IDS.guild, { channels: { movieNight: IDS.channel } });
        await sweepMovieNight(discord.client, services, start.minus({ minutes: 29 }).toJSDate());

        expect(warn).toHaveBeenCalledWith(
            `[MovieChannel] Movie night channel (not set) not found for guild ${IDS.guild}.`,
        );
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **29 minutes**"),
        ]);
    });

    test("keeps working from what is stored after a restart", async ({ discord, services, db, factories }) => {
        await setUpMovieNight(discord, services);
        const start = DateTime.now().plus({ minutes: 30 });
        await storeNight(factories, { startTime: start.toJSDate(), remindersSent: ["2 hours before"] });
        discord.acceptMessages(IDS.channel);
        // A new container, as the bot builds after restarting: nothing carried over in memory
        const restarted = createServiceContainer(db, IDS.guild, services.botStats);

        await sweepMovieNight(discord.client, restarted, start.minus({ minutes: 30 }).toJSDate());

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **30 minutes**"),
        ]);
    });

    test("closes the poll once its time is up, picks the winner and announces it once", async ({
        discord,
        services,
        factories,
    }) => {
        await setUpMovieNight(discord, services);
        const poll = await factories.moviePoll.create({
            options: [
                movieFactory.build({ id: "movie-1", addedBy: SUBMITTER }),
                movieFactory.build({ id: "movie-2", title: "Arrival", addedBy: SUBMITTER }),
            ],
            endsAt: DateTime.now().minus({ minutes: 1 }).toJSDate(),
            votes: { [present]: "movie-2", [joiner]: "movie-2", [leaver]: "movie-1" },
        });
        await storeNight(factories, {
            startTime: DateTime.now().plus({ hours: 3 }).toJSDate(),
            movie: movieFactory.build({ id: "TBD", title: "TBD" }),
        });
        discord.message(apiMessage({ id: poll.messageId }));
        discord.acceptMessageEdits(IDS.channel);
        discord.acceptMessages(IDS.channel);
        discord.user(apiUser({ id: SUBMITTER }));
        const dm = discord.acceptDirectMessages(SUBMITTER);

        await sweepMovieNight(discord.client, services, new Date());
        await sweepMovieNight(discord.client, services, new Date());

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
        await setUpMovieNight(discord, services);
        const start = DateTime.now().minus({ minutes: 10 });
        // Its reminders have gone out; this is about the night itself
        const night = await storeNight(factories, {
            startTime: start.toJSDate(),
            remindersSent: ["2 hours before", "30 mins before", "start time"],
        });
        await factories.movie.create(night.movie);
        for (const userId of [present, leaver]) await voice(apiVoiceState(userId, VOICE));
        discord.acceptMessages(IDS.channel);
        discord.user(apiUser({ id: SUBMITTER }));
        const dm = discord.acceptDirectMessages(SUBMITTER);
        await factories.userStats.create({ userId: present });

        await sweepMovieNight(discord.client, services, start.minus({ minutes: 5 }).toJSDate());
        expect(services.movieAttendance.isTracking(night.id)).toBe(false);

        await sweepMovieNight(discord.client, services, start.toJSDate());
        // Ten minutes in: one member leaves for good and another arrives
        await voice(apiVoiceState(leaver, null));
        await voice(apiVoiceState(joiner, VOICE));
        // The movie runs 30 minutes, and the night ends 30 minutes after that
        await sweepMovieNight(discord.client, services, start.plus({ minutes: 60 }).toJSDate());
        await sweepMovieNight(discord.client, services, start.plus({ minutes: 61 }).toJSDate());

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

    test("sends nothing more for a night that was cancelled", async ({ discord, services, slash, factories }) => {
        await setUpMovieNight(discord, services);
        const start = DateTime.now().plus({ hours: 1 });
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await slash("cancelmovie", [], { member: apiMember({ roles: [IDS.roles.movieAdmin] }) });
        await sweepMovieNight(discord.client, services, start.minus({ minutes: 30 }).toJSDate());
        await sweepMovieNight(discord.client, services, start.toJSDate());

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `❌ Movie night has been cancelled by <@${IDS.user}>.`,
        ]);
    });

    test("keeps each guild's movie night to itself", async ({ discord, services, otherGuild, factories }) => {
        await discord.addGuild(
            apiGuild({
                id: IDS.otherGuild,
                channels: [apiTextChannel({ id: IDS.otherGuildChannel, guild_id: IDS.otherGuild })],
            }),
        );
        const duePoll = moviePollFactory.build({
            endsAt: DateTime.now().minus({ minutes: 1 }).toJSDate(),
            votes: { [present]: "movie-2" },
            messageId: "",
            channelId: IDS.otherGuildChannel,
        });
        await otherGuild.repos.movieRepo.createPoll(duePoll);
        await factories.moviePoll.create({ endsAt: DateTime.now().plus({ hours: 1 }).toJSDate() });
        discord.acceptMessages(IDS.otherGuildChannel);
        discord.user(apiUser());
        discord.acceptDirectMessages(IDS.user);

        for (const guild of [services, otherGuild]) await sweepMovieNight(discord.client, guild, new Date());

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
