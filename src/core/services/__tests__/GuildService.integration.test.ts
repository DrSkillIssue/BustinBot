import { describe, expect, test as base } from "../../../tests/fixtures.js";
import { GuildService } from "../GuildService.js";
import { GuildRepository } from "../../database/GuildRepo.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { buildGuild } from "../../../tests/fakes/builders.js";

const test = base
    .extend("repo", ({ db }) => new GuildRepository(db))
    .extend("guilds", ({ repo }) => new GuildService(repo));

const guildId = IDS.guild;

describe("GuildService", () => {
    test("serves a guild from its cache after the first read", async ({ repo, guilds, db }) => {
        await repo.initGuild(guildId, buildGuild({ timezone: "UTC" }));
        await guilds.get(guildId);

        await db.doc(`guilds/${guildId}`).update({ timezone: "Europe/London" });

        expect((await guilds.get(guildId))?.timezone).toBe("UTC");
        expect((await guilds.refresh(guildId))?.timezone).toBe("Europe/London");
    });

    test("merges an update onto the stored guild when it is not cached", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, buildGuild());

        await guilds.update(guildId, { timezone: "Australia/Melbourne" });

        expect(await repo.getGuild(guildId)).toMatchObject({
            timezone: "Australia/Melbourne",
            roles: buildGuild().roles,
            channels: buildGuild().channels,
            setupComplete: buildGuild().setupComplete,
        });
    });

    test("keeps every other toggle and setting when one toggle changes", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, buildGuild({
            toggles: { taskScheduler: false, leaguesEnabled: true, taskLeaderboard: false },
            timezone: "Australia/Melbourne",
        }));
        await guilds.get(guildId);

        await guilds.updateToggle(guildId, "toggles.taskScheduler", true, "admin-1");

        const expected = { toggles: { taskScheduler: true, leaguesEnabled: true, taskLeaderboard: false }, timezone: "Australia/Melbourne" };
        expect(await guilds.get(guildId)).toMatchObject({ ...expected, updatedBy: "admin-1" });
        expect(await repo.getGuild(guildId)).toMatchObject(expected);
    });

    test("keeps existing toggles when other settings are updated", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, buildGuild({ toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false } }));

        await guilds.update(guildId, { timezone: "Europe/London" });

        expect((await repo.getGuild(guildId))?.toggles).toEqual({ taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false });
    });

    test("loads every guild into the cache", async ({ repo, guilds, db }) => {
        await repo.initGuild(IDS.guild, buildGuild({ id: IDS.guild }));
        await repo.initGuild(IDS.otherGuild, buildGuild({ id: IDS.otherGuild }));

        expect((await guilds.getAll()).map((guild) => guild.id).sort()).toEqual([IDS.guild, IDS.otherGuild]);
        await db.doc(`guilds/${IDS.guild}`).delete();
        expect(await guilds.get(IDS.guild)).toMatchObject({ id: IDS.guild });
    });

    test("creates a guild record only when one does not exist", async ({ repo, guilds }) => {
        await guilds.ensureExists("new-guild", "admin-1");
        expect(await repo.getGuild("new-guild")).toMatchObject({ id: "new-guild", updatedBy: "admin-1", setupComplete: { core: false } });

        await repo.initGuild(guildId, buildGuild({ timezone: "Australia/Melbourne" }));
        await guilds.ensureExists(guildId, "someone-else");
        expect(await repo.getGuild(guildId)).toMatchObject({ timezone: "Australia/Melbourne", setupComplete: { core: true } });
    });
});
