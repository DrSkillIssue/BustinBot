import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

const createMovieNightEmbed = vi.fn(() => ({ id: "embed" }));
vi.mock("../MovieEmbeds", () => ({
    createMovieNightEmbed,
}));

const scheduleActivePollClosure = vi.fn().mockResolvedValue(undefined);
vi.mock("../MoviePollScheduler", () => ({
    scheduleActivePollClosure,
}));

const scheduleMovieReminders = vi.fn().mockResolvedValue(undefined);
const getPendingReminders = vi.fn(() => []);
vi.mock("../MovieReminders", () => ({
    scheduleMovieReminders,
    getPendingReminders,
}));

const scheduleMovieAutoEnd = vi.fn();
const clearScheduledMovieAutoEnd = vi.fn();
vi.mock("../MovieLifecycle", () => ({
    scheduleMovieAutoEnd,
    clearScheduledMovieAutoEnd,
}));

const registerVoiceListeners = vi.fn();
vi.mock("../MovieAttendance", () => ({
    registerVoiceListeners,
}));

const movieScheduler = await import("../MovieScheduler.js");
const { initMovieScheduler, handleMovieNightDate, handleMovieNightTime } = movieScheduler;

describe("MovieScheduler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers voice listeners on init", () => {
        const client: any = { tag: "MovieBot" };
        initMovieScheduler(client);
        expect(registerVoiceListeners).toHaveBeenCalledWith(client);
    });

    it("shows time modal with timezone-aware label on date selection", async () => {
        const interaction: any = {
            values: ["2026-03-05"],
            guildId: "guild-1",
            showModal: vi.fn().mockResolvedValue(undefined),
        };
        const services: any = {
            guilds: {
                get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
            },
        };

        await handleMovieNightDate(interaction, services);

        expect(interaction.showModal).toHaveBeenCalledTimes(1);
        const modal = interaction.showModal.mock.calls[0]![0];
        const modalJson = modal.toJSON();

        expect(modalJson.custom_id).toBe("movienight-time-2026-03-05");
        expect(modalJson.title).toBe("Enter movie night time");
        expect(modalJson.components[0]!.components[0]!.label).toMatch(/^Start time \(UTC[+-]\d{1,2}(?::\d{2})?\)$/);
    });

    it("rejects invalid time input format", async () => {
        const movieRepo = {
            getActivePoll: vi.fn(),
            getAllMovies: vi.fn(),
            getAllEvents: vi.fn(),
            createMovieEvent: vi.fn(),
        };
        const interaction: any = {
            customId: "movienight-time-2026-03-05",
            guildId: "guild-1",
            fields: {
                getTextInputValue: vi.fn().mockReturnValue("8pm"),
            },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            client: {},
        };
        const services: any = {
            guildId: "guild-1",
            repos: { movieRepo },
            guilds: {
                requireConfig: vi.fn().mockResolvedValue({ channels: {}, roles: {} }),
                get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
            },
        };

        await handleMovieNightTime(interaction, services);

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 1 << 6 });
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Invalid time format") })
        );
        expect(movieRepo.getActivePoll).not.toHaveBeenCalled();
        expect(scheduleMovieReminders).not.toHaveBeenCalled();
    });

    it("rolls over old active events, adjusts poll end, and schedules runtime auto-end for selected movie", async () => {
        const channelSend = vi.fn().mockResolvedValue({ id: "announce-1", channelId: "movie-night-channel" });
        const movieChannel = {
            isTextBased: () => true,
            send: channelSend,
        };

        const movieRepo = {
            getActivePoll: vi.fn().mockResolvedValue({
                id: "poll-1",
                isActive: true,
                channelId: "poll-channel",
                endsAt: new Date("2026-03-05T22:00:00.000Z"),
            }),
            getAllMovies: vi.fn().mockResolvedValue([
                {
                    id: "movie-old",
                    title: "Old Pick",
                    addedBy: "user-1",
                    addedAt: new Date("2026-03-01T00:00:00.000Z"),
                    watched: false,
                    selectedAt: new Date("2026-03-04T10:00:00.000Z"),
                    runtime: 90,
                },
                {
                    id: "movie-new",
                    title: "Latest Pick",
                    addedBy: "user-2",
                    addedAt: new Date("2026-03-02T00:00:00.000Z"),
                    watched: false,
                    selectedAt: new Date("2026-03-04T11:00:00.000Z"),
                    runtime: 120,
                },
                {
                    id: "movie-watched",
                    title: "Already Watched",
                    addedBy: "user-3",
                    addedAt: new Date("2026-02-25T00:00:00.000Z"),
                    watched: true,
                    selectedAt: new Date("2026-03-04T12:00:00.000Z"),
                    runtime: 110,
                },
            ]),
            createPoll: vi.fn().mockResolvedValue(undefined),
            getAllEvents: vi.fn().mockResolvedValue([
                {
                    id: "event-active",
                    completed: false,
                    startTime: new Date("2026-03-01T00:00:00.000Z"),
                    movie: { id: "m", title: "M", addedBy: "u", addedAt: new Date(), watched: false },
                    channelId: "old-channel",
                    hostedBy: "host-1",
                },
                {
                    id: "event-complete",
                    completed: true,
                    startTime: new Date("2026-02-20T00:00:00.000Z"),
                    movie: { id: "n", title: "N", addedBy: "u", addedAt: new Date(), watched: true },
                    channelId: "old-channel-2",
                    hostedBy: "host-2",
                },
            ]),
            createMovieEvent: vi.fn().mockResolvedValue(undefined),
        };

        const interaction: any = {
            customId: "movienight-time-2026-03-05",
            guildId: "guild-1",
            channelId: "command-channel",
            user: { id: "host-1", username: "HostUser" },
            fields: {
                getTextInputValue: vi.fn().mockReturnValue("20:30"),
            },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            client: { tag: "MovieBot" },
            guild: {
                channels: {
                    fetch: vi.fn().mockResolvedValue(movieChannel),
                    cache: {
                        find: vi.fn(),
                    },
                },
                roles: {
                    cache: {
                        get: vi.fn().mockReturnValue({ id: "movie-role" }),
                    },
                },
            },
        };

        const services: any = {
            guildId: "guild-1",
            repos: { movieRepo },
            guilds: {
                requireConfig: vi.fn().mockResolvedValue({
                    channels: { movieNight: "movie-night-channel", movieVC: "voice-123" },
                    roles: { movieUser: "movie-role" },
                }),
                get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
            },
        };

        getPendingReminders.mockReturnValue([
            { label: "2 hours before", sendAt: DateTime.fromISO("2026-03-05T18:30:00.000Z") },
            { label: "start time", sendAt: DateTime.fromISO("2026-03-05T20:30:00.000Z") },
        ]);

        await handleMovieNightTime(interaction, services);

        expect(clearScheduledMovieAutoEnd).toHaveBeenCalledWith("guild-1");
        expect(movieRepo.createPoll).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "poll-1",
                endsAt: new Date("2026-03-05T19:30:00.000Z"),
            })
        );
        expect(scheduleActivePollClosure).toHaveBeenCalledWith(services, interaction.client);

        expect(createMovieNightEmbed).toHaveBeenCalledWith(
            expect.objectContaining({ id: "movie-new", title: "Latest Pick" }),
            expect.any(Number),
            expect.stringContaining("Reminders will be sent at"),
            "HostUser"
        );

        expect(movieRepo.createMovieEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "event-active",
                completed: true,
                completedAt: expect.any(Date),
            })
        );
        expect(movieRepo.createMovieEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                completed: false,
                hostedBy: "host-1",
                channelId: "movie-night-channel",
                announcementMessageId: "announce-1",
                voiceChannelId: "voice-123",
                movie: expect.objectContaining({ id: "movie-new", title: "Latest Pick" }),
            })
        );

        expect(scheduleMovieAutoEnd).toHaveBeenCalledWith(
            services,
            "2026-03-05T20:30:00.000Z",
            120,
            interaction.client
        );
        expect(scheduleMovieReminders).toHaveBeenCalledWith(
            services,
            expect.any(DateTime),
            interaction.client
        );
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Movie night scheduled") })
        );
    });

    it("uses poll state message and TBD event movie when no selected movie exists", async () => {
        const fallbackSend = vi.fn().mockResolvedValue({ id: "announce-2", channelId: "fallback-channel" });
        const fallbackChannel = {
            name: "movie-night",
            isTextBased: () => true,
            send: fallbackSend,
        };

        const movieRepo = {
            getActivePoll: vi.fn().mockResolvedValue({
                id: "poll-2",
                isActive: true,
                channelId: "poll-channel-xyz",
                endsAt: null,
            }),
            getAllMovies: vi.fn().mockResolvedValue([
                {
                    id: "movie-a",
                    title: "Unselected",
                    addedBy: "user-1",
                    addedAt: new Date(),
                    watched: false,
                },
            ]),
            createPoll: vi.fn(),
            getAllEvents: vi.fn().mockResolvedValue([]),
            createMovieEvent: vi.fn().mockResolvedValue(undefined),
        };

        const interaction: any = {
            customId: "movienight-time-2026-03-05",
            guildId: "guild-1",
            channelId: "command-channel",
            user: { id: "host-2", username: "HostUser2" },
            fields: {
                getTextInputValue: vi.fn().mockReturnValue("20:30"),
            },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            client: { tag: "MovieBot" },
            guild: {
                channels: {
                    fetch: vi.fn().mockResolvedValue(null),
                    cache: {
                        find: vi.fn().mockReturnValue(fallbackChannel),
                    },
                },
                roles: {
                    cache: {
                        get: vi.fn().mockReturnValue(null),
                    },
                },
            },
        };

        const services: any = {
            guildId: "guild-1",
            repos: { movieRepo },
            guilds: {
                requireConfig: vi.fn().mockResolvedValue({
                    channels: { movieNight: "missing-configured-channel" },
                    roles: {},
                }),
                get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
            },
        };

        getPendingReminders.mockReturnValue([]);

        await handleMovieNightTime(interaction, services);

        expect(createMovieNightEmbed).toHaveBeenCalledWith(
            null,
            expect.any(Number),
            expect.stringContaining("<#poll-channel-xyz>"),
            "HostUser2"
        );
        expect(movieRepo.createMovieEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: "fallback-channel",
                movie: expect.objectContaining({ id: "TBD", title: "TBD" }),
            })
        );
        expect(scheduleMovieAutoEnd).not.toHaveBeenCalled();
    });
});
