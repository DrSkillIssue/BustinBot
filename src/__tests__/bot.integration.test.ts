import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, test, vi } from "../tests/fixtures.js";
import { startBot } from "../bot.js";
import { DiscordHarness } from "../tests/discord/harness.js";
import { chatInputInteraction } from "../tests/discord/payloads.js";

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
