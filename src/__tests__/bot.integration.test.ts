import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatInputCommandInteraction } from "discord.js";
import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "../tests/fixtures.js";
import { server } from "../tests/setup.js";
import { startBot } from "../bot.js";
import { DiscordHarness } from "../tests/discord/harness.js";
import { IDS, chatInputInteraction } from "../tests/discord/payloads.js";

const commandsDir = path.join(import.meta.dirname, "../modules/commands");
const run = promisify(execFile);

describe("startBot", () => {
    test("answers slash commands that arrive through the gateway", async ({ db, services, onTestFinished }) => {
        const discord = DiscordHarness.create();
        onTestFinished(() => discord.destroy());

        await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null });
        discord.connect();
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("bustin"));

        await vi.waitFor(() => expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]));
        expect(services.guildId).toBe(interaction.guildId);
    });

    test("syncs each slash command once to the primary guild when sync is enabled", async ({ db, services, commands, onTestFinished }) => {
        const discord = DiscordHarness.create();
        onTestFinished(() => discord.destroy());

        await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: { token: "sync-token", clientId: IDS.application } });

        const [synced] = discord.guildCommandUpdates(IDS.guild) as { name: string }[][];
        const names = synced!.map((command) => command.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.sort()).toEqual([...new Set([...commands.values()].map((command) => command.name))].sort());
        expect(services.guildId).toBe(IDS.guild);
    });

    test("keeps starting when Discord rejects the command sync", async ({ db, services, onTestFinished }) => {
        const discord = DiscordHarness.create();
        onTestFinished(() => discord.destroy());
        server.use(http.put("https://discord.com/api/v10/applications/:applicationId/guilds/:guildId/commands", () =>
            HttpResponse.json({ code: 50001, message: "Missing Access" }, { status: 403 })
        ));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: { token: "sync-token", clientId: IDS.application } });
        discord.connect();
        const interaction = await discord.dispatch<ChatInputCommandInteraction>(chatInputInteraction("bustin"));

        expect(error).toHaveBeenCalledWith("Failed to sync guild slash commands:", expect.objectContaining({ status: 403 }));
        await vi.waitFor(() => expect(discord.originalEdits(interaction)).toHaveLength(1));
        expect(services.guildId).toBe(IDS.guild);
    });

    test("refuses to start when no guild is configured and no fallback is given", async ({ db, onTestFinished }) => {
        const discord = DiscordHarness.create();
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
