import path from "node:path";
import cron from "node-cron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "../tests/fixtures.js";
import { startBot } from "../bot.js";
import { DiscordError, DiscordHarness } from "../tests/discord/harness.js";
import { IDS, apiAttachment, apiGuild, apiTextChannel, chatInputInteraction, directMessage } from "../tests/discord/payloads.js";
import { GuildRepository } from "../core/database/GuildRepo.js";
import { TaskRepository } from "../core/database/TaskRepo.js";
import { buildGuild, buildTaskEvent } from "../tests/fakes/builders.js";
import { getNextPollDate } from "../modules/tasks/TaskScheduler.js";

const commandsDir = path.join(import.meta.dirname, "../modules/commands");

const run = promisify(execFile);

describe("startBot", () => {
    test("answers slash commands that arrive through the gateway", async ({ db, http, services, onTestFinished }) => {
        const discord = DiscordHarness.create(http);

        onTestFinished(await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null }));
        await discord.connect();
        const interaction = await discord.dispatch(chatInputInteraction("bustin"));

        expect(await discord.originalEdit(interaction)).toEqual(expect.objectContaining({ content: "Bustin makes me feel good!" }));
        expect(services.guildId).toBe(interaction.guildId);
    });

    test("syncs each slash command once to the primary guild when sync is enabled", async ({ db, http, services, commands, onTestFinished }) => {
        const discord = DiscordHarness.create(http);
        discord.acceptCommandSync(IDS.guild);

        onTestFinished(await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: { token: "sync-token", clientId: IDS.application } }));

        const [synced] = discord.guildCommandUpdates(IDS.guild);
        const names = synced!.map((command) => command.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.sort()).toEqual([...new Set([...commands.values()].map((command) => command.name))].sort());
        expect(services.guildId).toBe(IDS.guild);
    });

    test("keeps starting when Discord rejects the command sync", async ({ db, http, services, onTestFinished }) => {
        const discord = DiscordHarness.create(http);
        discord.refuse("PUT", `/applications/${IDS.application}/guilds/${IDS.guild}/commands`, DiscordError.missingAccess);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        onTestFinished(await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: { token: "sync-token", clientId: IDS.application } }));
        await discord.connect();
        const interaction = await discord.dispatch(chatInputInteraction("bustin"));

        expect(error).toHaveBeenCalledWith("Failed to sync guild slash commands:", expect.objectContaining({ status: 403 }));
        expect(await discord.originalEdit(interaction)).toEqual(expect.objectContaining({ content: "Bustin makes me feel good!" }));
        expect(services.guildId).toBe(IDS.guild);
    });

    test("reports bot-wide praise counts the same in every guild", async ({ db, http, services, onTestFinished }) => {
        const otherGuild = "100000000000000011";
        const otherChannel = "100000000000000021";
        await new GuildRepository(db).initGuild(otherGuild, buildGuild({ id: otherGuild, channels: { announcements: otherChannel } }));
        const discord = DiscordHarness.create(http);

        onTestFinished(await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null }));
        await discord.connect();
        await discord.addGuild(apiGuild({ id: otherGuild, channels: [apiTextChannel({ id: otherChannel, guild_id: otherGuild })] }));
        const inOtherGuild = {
            guild_id: otherGuild,
            channel_id: otherChannel,
            channel: { id: otherChannel, type: 0 as const, guild_id: otherGuild, name: "general" },
        };
        // The other guild is already in use before anyone praises the bot
        await discord.originalEdit(await discord.dispatch(chatInputInteraction("bustin", [], inOtherGuild)));
        await discord.originalEdit(await discord.dispatch(chatInputInteraction("goodbot")));
        const second = await discord.dispatch(chatInputInteraction("goodbot", [], inOtherGuild));

        expect(await discord.originalEdit(second)).toEqual(expect.objectContaining({ content: expect.stringContaining("good bot 2 times") }));
        expect(services.guildId).toBe(IDS.guild);
    });

    test("stops every scheduled job and disconnects when shut down", async ({ db, http }) => {
        await new GuildRepository(db).initGuild(IDS.guild, buildGuild({ toggles: { taskScheduler: true, leaguesEnabled: false } }));
        vi.spyOn(console, "log").mockImplementation(() => {});
        const discord = DiscordHarness.create(http);

        const shutdown = await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null });
        await discord.connect();
        // Shutting down waits for the startup work begun on ready, so everything below is final
        await shutdown();

        expect(getNextPollDate()).not.toBeNull();
        expect(cron.getTasks().size).toBe(0);
        expect(discord.client.isReady()).toBe(false);
    });

    test("lets a command that is already running finish when shut down", async ({ db, http, services }) => {
        const discord = DiscordHarness.create(http);
        const shutdown = await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null });
        await discord.connect();

        // Delivered and being handled, but not finished, when the bot is told to stop
        const interaction = await discord.dispatch(chatInputInteraction("bustin"));
        await shutdown();

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Bustin makes me feel good!" })]);
        expect(await services.repos.userRepo.getUserById(interaction.user.id)).toMatchObject({ commandsRun: 1 });
    });

    test("takes screenshots DMed after a restart for the guild where the member last clicked Submit", async ({ db, http, services }) => {
        const otherGuild = "100000000000000011";
        const otherChannel = "100000000000000021";
        await new GuildRepository(db).initGuild(otherGuild, buildGuild({ id: otherGuild, channels: { taskVerification: otherChannel } }));
        const otherTasks = new TaskRepository(db, otherGuild);
        const event = buildTaskEvent({ endTime: new Date(Date.now() + 24 * 60 * 60 * 1000) });
        await otherTasks.createTaskEvent(event);
        // Clicked Submit in the primary guild, then later in the other one, before the bot restarted
        await services.repos.taskRepo.saveSubmissionDraft({ userId: IDS.user, taskEventId: "older", createdAt: new Date(Date.now() - 60_000) });
        await otherTasks.saveSubmissionDraft({ userId: IDS.user, taskEventId: event.id, createdAt: new Date() });
        const discord = DiscordHarness.create(http);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.acceptMessages(otherChannel);
        discord.acceptMessages(IDS.dm);

        const shutdown = await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null });
        await discord.connect();
        await discord.addGuild(apiGuild({ id: otherGuild, channels: [apiTextChannel({ id: otherChannel, guild_id: otherGuild })] }));
        await discord.sendMessage(directMessage("", { attachments: [screenshot] }));
        // Shutting down lets the DM being handled finish
        await shutdown();

        expect(discord.messagesSentTo(IDS.dm)).toEqual([expect.objectContaining({ content: expect.stringContaining("received with 1 screenshot and sent for review!") })]);
        expect(await otherTasks.getSubmissionsByUser(IDS.user)).toEqual([expect.objectContaining({ taskEventId: event.id })]);
        expect(discord.messagesSentTo(otherChannel)).toHaveLength(2);
        expect(await services.repos.taskRepo.getSubmissionDraft(IDS.user)).toMatchObject({ taskEventId: "older" });
    });

    test("refuses to start when no guild is configured and no fallback is given", async ({ db, http, onTestFinished }) => {
        const discord = DiscordHarness.create(http);
        onTestFinished(() => discord.destroy());

        await expect(startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null }))
            .rejects.toThrow("No guild ID available");
    });
});

describe("entry point", () => {
    const entry = path.join(import.meta.dirname, "../index.ts");
    // A clean environment and an empty working directory, so no .env file is picked up
    const options = { cwd: import.meta.dirname, env: { PATH: process.env.PATH, DOTENV_CONFIG_QUIET: "true", TMDB_API_KEY: "test" } };

    test("loads every command and stops in dry-run mode", async () => {
        const { stdout } = await run("npx", ["tsx", entry, "--dry-run"], options);

        expect(stdout).toMatch(/Loaded \d+ commands\./);
        expect(stdout).toContain("[DryRun] Startup preflight passed.");
    }, 30_000);

    test("exits with an error when the TMDb API key is missing", async () => {
        const { TMDB_API_KEY: _, ...withoutTmdb } = options.env;
        await expect(run("npx", ["tsx", entry, "--dry-run"], { ...options, env: withoutTmdb })).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("TMDB_API_KEY is not set"),
        });
    }, 30_000);

    test("exits with an error when no bot token is configured", async () => {
        await expect(run("npx", ["tsx", entry], options)).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("No Discord bot token available"),
        });
    }, 30_000);
});
