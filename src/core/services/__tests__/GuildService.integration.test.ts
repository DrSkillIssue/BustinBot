import { SnowflakeUtil } from "discord.js";
import { describe, expect, test as base } from "../../../tests/fixtures.js";
import { GuildService } from "../GuildService.js";
import { GuildRepository } from "../../database/GuildRepo.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { guildFactory } from "../../../tests/factories.js";

const test = base
    .extend("repo", ({ db }) => new GuildRepository(db))
    .extend("guilds", ({ repo }) => new GuildService(repo));

const guildId = IDS.guild;
const admin = SnowflakeUtil.generate().toString();
const newGuild = SnowflakeUtil.generate().toString();

describe("GuildService", () => {
    test("serves a guild from its cache after the first read", async ({ repo, guilds, db }) => {
        await repo.initGuild(guildId, guildFactory.build({ timezone: "UTC" }));
        await guilds.get(guildId);

        await db.doc(`guilds/${guildId}`).update({ timezone: "Europe/London" });

        expect((await guilds.get(guildId))?.timezone).toBe("UTC");
        expect((await guilds.refresh(guildId))?.timezone).toBe("Europe/London");
    });

    test("merges an update onto the stored guild when it is not cached", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, guildFactory.build());

        await guilds.update(guildId, { timezone: "Australia/Melbourne" });

        expect(await repo.getGuild(guildId)).toMatchObject({
            timezone: "Australia/Melbourne",
            roles: guildFactory.build().roles,
            channels: guildFactory.build().channels,
            setupComplete: guildFactory.build().setupComplete,
        });
    });

    test("keeps every other toggle and setting when one toggle changes", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, guildFactory.build({
            toggles: { taskScheduler: false, leaguesEnabled: true, taskLeaderboard: false },
            timezone: "Australia/Melbourne",
        }));
        await guilds.get(guildId);

        await guilds.updateToggle(guildId, "toggles.taskScheduler", true, admin);

        const expected = { toggles: { taskScheduler: true, leaguesEnabled: true, taskLeaderboard: false }, timezone: "Australia/Melbourne" };
        expect(await guilds.get(guildId)).toMatchObject({ ...expected, updatedBy: admin });
        expect(await repo.getGuild(guildId)).toMatchObject(expected);
    });

    test("keeps existing toggles when other settings are updated", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, guildFactory.build({ toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false } }));

        await guilds.update(guildId, { timezone: "Europe/London" });

        expect((await repo.getGuild(guildId))?.toggles).toEqual({ taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false });
    });

    test("loads every guild into the cache", async ({ repo, guilds, db }) => {
        await repo.initGuild(IDS.guild, guildFactory.build({ id: IDS.guild }));
        await repo.initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild }));

        expect((await guilds.getAll()).map((guild) => guild.id).sort()).toEqual([IDS.guild, IDS.otherGuild]);
        await db.doc(`guilds/${IDS.guild}`).delete();
        expect(await guilds.get(IDS.guild)).toMatchObject({ id: IDS.guild });
    });

    test("creates a guild record only when one does not exist", async ({ repo, guilds }) => {
        await guilds.ensureExists(newGuild, admin);
        expect(await repo.getGuild(newGuild)).toMatchObject({ id: newGuild, updatedBy: admin, setupComplete: { core: false } });

        await repo.initGuild(guildId, guildFactory.build({ timezone: "Australia/Melbourne" }));
        await guilds.ensureExists(guildId, IDS.user);
        expect(await repo.getGuild(guildId)).toMatchObject({ timezone: "Australia/Melbourne", setupComplete: { core: true } });
    });
});
