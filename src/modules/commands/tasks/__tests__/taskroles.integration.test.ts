import type { Firestore } from "firebase-admin/firestore";
import { ApplicationCommandOptionType, type APIApplicationCommandInteractionDataOption, type APIRole } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../tests/fixtures.js";
import { DiscordError, type DiscordHarness } from "../../../../tests/discord/harness.js";
import { IDS, apiGuild, apiGuildMember, apiRole, apiUser, chatInputInteraction, nextId, withRoles } from "../../../../tests/discord/payloads.js";
import { buildPeriodicLeaderboard, buildUserStats } from "../../../../tests/fakes/builders.js";
import { GuildRepository } from "../../../../core/database/GuildRepo.js";
import type { TaskMilestoneRole } from "../../../../models/Guild.js";

const taskAdmin = withRoles(IDS.roles.taskAdmin);
const member = nextId();
const NEUTRAL = 0x95a5a6;

function sub(name: string, options: APIApplicationCommandInteractionDataOption[] = []): APIApplicationCommandInteractionDataOption[] {
    return [{ type: ApplicationCommandOptionType.Subcommand, name, options } as APIApplicationCommandInteractionDataOption];
}
const text = (name: string, value: string) => ({ type: ApplicationCommandOptionType.String as const, name, value });
const number = (name: string, value: number) => ({ type: ApplicationCommandOptionType.Integer as const, name, value });
const flag = (name: string, value: boolean) => ({ type: ApplicationCommandOptionType.Boolean as const, name, value });

// The guild's roles as Discord lists them: the harness guild's own plus any a test adds
function serveRoles(discord: DiscordHarness, extra: APIRole[] = []): void {
    discord.guildRoles(IDS.guild, [...apiGuild().roles, ...extra]);
}

function milestone(role: APIRole, requiredSubmissions: number): TaskMilestoneRole {
    return { id: role.id, label: role.name, roleId: role.id, requiredSubmissions, enabled: true };
}

function storedGuild(db: Firestore) {
    return new GuildRepository(db).getGuild(IDS.guild);
}

describe("/taskroles list", () => {
    test("shows the milestone thresholds and which champion roles are set", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash("taskroles", sub("list"), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({
            embeds: [expect.objectContaining({
                title: "Task Roles",
                description: [
                    "**Milestone Roles** (Enabled)",
                    "- Task Participant — 5 submissions",
                    "- Task Enthusiast — 25 submissions",
                    "- Task Expert — 50 submissions",
                    "- Task Master — 100 submissions",
                    "",
                    "**Champion Roles** (Enabled)",
                    "- 1st — Not set",
                    "- 2nd — Not set",
                    "- 3rd — Not set",
                ].join("\n"),
            })],
        })]);
    });
});

describe("/taskroles add", () => {
    test("creates a milestone role that doesn't exist yet and saves its threshold", async ({ discord, slash, db }) => {
        serveRoles(discord);
        const legend = apiRole({ name: "Task Legend" });
        discord.roleCreated(IDS.guild, legend);

        const interaction = await slash("taskroles", sub("add", [text("role", "Task Legend"), text("type", "milestone"), number("value", 200)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Added milestone role **Task Legend** (200)." })]);
        expect((await storedGuild(db))?.taskSettings?.milestoneRoles).toContainEqual(milestone(legend, 200));
    });

    test("rejects a milestone threshold of zero without creating a role", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash("taskroles", sub("add", [text("role", "Task Legend"), text("type", "milestone"), number("value", 0)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Milestone thresholds must be greater than 0." })]);
        expect(discord.requests().filter((request) => request.method === "POST" && request.path.endsWith("/roles"))).toEqual([]);
    });

    test("sets an existing role as a champion role", async ({ discord, slash, db }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);

        const interaction = await slash("taskroles", sub("add", [text("role", `<@&${gold.id}>`), text("type", "champion"), number("value", 1)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Set 1st place champion role to **Gold Champion**." })]);
        expect((await storedGuild(db))?.roles.taskChampionFirst).toBe(gold.id);
    });

    test("rejects a champion placement other than 1 to 3 without creating a role", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash("taskroles", sub("add", [text("role", "Fourth Place"), text("type", "champion"), number("value", 4)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Champion placement must be 1, 2, or 3." })]);
        expect(discord.requests().filter((request) => request.method === "POST" && request.path.endsWith("/roles"))).toEqual([]);
    });
});

describe("/taskroles edit", () => {
    test("renames a milestone role and changes its threshold", async ({ discord, slash, services, db }) => {
        const expert = apiRole({ name: "Task Expert" });
        serveRoles(discord, [expert]);
        await services.guilds.update(IDS.guild, { taskSettings: { milestoneRoles: [milestone(expert, 50)] } });
        discord.roleEdited(IDS.guild, { ...expert, name: "Task Pro" });

        const interaction = await slash("taskroles", sub("edit", [text("role", `<@&${expert.id}>`), text("newrole", "Task Pro"), number("value", 60)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Updated milestone role **Task Pro** (60)." })]);
        expect((await storedGuild(db))?.taskSettings?.milestoneRoles).toEqual([{ ...milestone(expert, 60), label: "Task Pro" }]);
    });

    test("moves a champion role to another placement", async ({ discord, slash, services, db }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });

        const interaction = await slash("taskroles", sub("edit", [text("role", `<@&${gold.id}>`), text("newrole", "Gold Champion"), number("value", 2)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Updated champion role **Gold Champion** to 2nd place." })]);
        expect((await storedGuild(db))?.roles).toMatchObject({ taskChampionFirst: "", taskChampionSecond: gold.id });
    });
});

describe("/taskroles delete", () => {
    test("removes a milestone role from the settings and deletes it from the server", async ({ discord, slash, services, db }) => {
        const expert = apiRole({ name: "Task Expert" });
        const master = apiRole({ name: "Task Master" });
        serveRoles(discord, [expert, master]);
        await services.guilds.update(IDS.guild, { taskSettings: { milestoneRoles: [milestone(expert, 50), milestone(master, 100)] } });
        discord.roleDeleted(IDS.guild, expert.id);

        const interaction = await slash("taskroles", sub("delete", [text("role", `<@&${expert.id}>`)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Deleted milestone role **Task Expert**." })]);
        expect((await storedGuild(db))?.taskSettings?.milestoneRoles).toEqual([milestone(master, 100)]);
    });

    test("says so when Discord won't delete the role it stopped using", async ({ discord, slash, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        discord.refuse("DELETE", `/guilds/${IDS.guild}/roles/${gold.id}`, DiscordError.missingPermissions);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const interaction = await slash("taskroles", sub("delete", [text("role", `<@&${gold.id}>`)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({
            content: "Removed champion role **Gold Champion** (1st). It is no longer a task role, but I couldn't delete it from the server. Check my permissions, or delete it yourself.",
        })]);
        expect(warn).toHaveBeenCalledWith("[TaskRoles] Failed to delete task role:", expect.objectContaining({ code: 50013 }));
    });
});

describe("/taskroles toggle", () => {
    test("disables milestone roles", async ({ discord, slash, db }) => {
        serveRoles(discord);

        const interaction = await slash("taskroles", sub("toggle", [text("type", "milestone"), flag("enabled", false)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Disabled milestone roles." })]);
        expect((await storedGuild(db))?.taskSettings?.milestoneRoles?.every((role) => !role.enabled)).toBe(true);
    });

    test("disables champion roles and takes them off the current champions", async ({ discord, slash, services, db }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        await services.repos.taskLeaderboardRepo.createLeaderboard(buildPeriodicLeaderboard({ champions: { first: [member] } }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member, username: "champ" }), roles: [gold.id] }));
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await slash("taskroles", sub("toggle", [text("type", "champion"), flag("enabled", false)]), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Disabled champion roles." })]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([`${member}:${gold.id}`]);
        expect((await storedGuild(db))?.taskSettings?.championRoles).toEqual({ first: false, second: false, third: false });
    });
});

describe("/taskroles grant", () => {
    test("gives a member a role", async ({ discord, interact }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        const target = apiUser({ id: member, username: "champ" });
        discord.member(IDS.guild, apiGuildMember({ user: target }));
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await interact(chatInputInteraction(
            "taskroles",
            sub("grant", [
                { type: ApplicationCommandOptionType.User, name: "user", value: member },
                { type: ApplicationCommandOptionType.Role, name: "role", value: gold.id },
            ]),
            taskAdmin,
            { users: { [member]: target }, roles: { [gold.id]: gold } },
        ));

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Granted **Gold Champion** to champ." })]);
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${gold.id}`]);
    });
});

describe("/taskroles init", () => {
    test("creates the missing task roles and gives members the milestone role they have earned", async ({ discord, slash, services, db }) => {
        serveRoles(discord);
        const created = [
            apiRole({ name: "Task Participant" }),
            apiRole({ name: "Task Enthusiast" }),
            apiRole({ name: "Task Expert" }),
            apiRole({ name: "Task Master" }),
            apiRole({ name: "Task Champion (1st)" }),
            apiRole({ name: "Task Champion (2nd)" }),
            apiRole({ name: "Task Champion (3rd)" }),
        ];
        for (const role of created) discord.roleCreated(IDS.guild, role);
        await services.repos.userRepo.createUser(buildUserStats({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 }));
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member, username: "regular" }) }));
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await slash("taskroles", sub("init"), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Task roles synced and granted to eligible users." })]);
        expect(discord.requests().filter((request) => request.method === "POST" && request.path.endsWith("/roles")).map((request) => [request.body.name, request.body.colors?.primary_color])).toEqual([
            ["Task Participant", NEUTRAL],
            ["Task Enthusiast", NEUTRAL],
            ["Task Expert", NEUTRAL],
            ["Task Master", NEUTRAL],
            ["Task Champion (1st)", 0xffd700],
            ["Task Champion (2nd)", 0xc0c0c0],
            ["Task Champion (3rd)", 0xcd7f32],
        ]);
        // 30 completions earn the 25-submission milestone
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${created[1]!.id}`]);
        const stored = await storedGuild(db);
        expect(stored?.taskSettings?.milestoneRoles?.map((role) => role.roleId)).toEqual(created.slice(0, 4).map((role) => role.id));
        expect(stored?.roles).toMatchObject({
            taskChampionFirst: created[4]!.id,
            taskChampionSecond: created[5]!.id,
            taskChampionThird: created[6]!.id,
        });
    });
});

describe("/taskroles with an option it doesn't know", () => {
    test("answers instead of leaving the reply pending", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash("taskroles", sub("rename"), taskAdmin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Unknown taskroles option." })]);
    });
});
