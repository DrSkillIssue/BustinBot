import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "../fixtures.js";
import { startBot } from "../../src/bot.js";
import { DiscordHarness } from "../discord/harness.js";
import { IDS } from "../discord/payloads.js";
import { taskFactory, userStatsFactory } from "../factories.js";
import { createServiceContainer } from "../../src/core/services/ServiceFactory.js";
import { BotStatsService } from "../../src/core/services/BotStatsService.js";
import { BotRepository } from "../../src/core/database/BotRepo.js";

const commandsDir = path.join(import.meta.dirname, "../../src/modules/commands");

const run = promisify(execFile);

describe("startBot", () => {
    test("refuses to start when no guild is configured and no fallback is given", async ({
        db,
        http,
        onTestFinished,
    }) => {
        const discord = DiscordHarness.create(http);
        onTestFinished(() => discord.destroy());

        await expect(
            startBot(discord.client, { db, commandsDir, fallbackGuildId: null, commandSync: null }),
        ).rejects.toThrow("No guild ID available");
    });
});

describe("entry point", () => {
    const entry = path.join(import.meta.dirname, "../../src/index.ts");
    const options = {
        cwd: import.meta.dirname,
        env: { PATH: process.env.PATH, DOTENV_CONFIG_QUIET: "true", TMDB_API_KEY: "test" },
    };

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

describe("createServiceContainer", () => {
    test("scopes every repository to its guild and shares the bot-wide stats", async ({ db }) => {
        const botStats = new BotStatsService(new BotRepository(db));
        const first = createServiceContainer(db, IDS.guild, botStats);
        const second = createServiceContainer(db, IDS.otherGuild, botStats);

        await first.repos.taskRepo.createTask(taskFactory.build({ id: "PVM001" }));
        await first.repos.userRepo.createUser(userStatsFactory.build({ userId: IDS.user }));

        expect(first.guildId).toBe(IDS.guild);
        expect((await db.doc(`guilds/${IDS.guild}/tasks/PVM001`).get()).exists).toBe(true);
        expect((await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get()).exists).toBe(true);
        expect(await second.repos.taskRepo.getTaskById("PVM001")).toBeNull();
        expect(second.botStats).toBe(first.botStats);
    });
});
