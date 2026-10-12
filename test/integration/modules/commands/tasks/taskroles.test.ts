import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, type APIRole } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { DiscordError, type DiscordHarness } from "../../../../discord/harness.js";
import { milestoneRoleFactory } from "../../../../factories.js";
import {
    IDS,
    apiGuild,
    apiGuildMember,
    apiRole,
    apiUser,
    chatInputInteraction,
    apiMember,
} from "../../../../discord/payloads.js";

const taskAdmin = { member: apiMember({ roles: [IDS.roles.taskAdmin] }) };
const member = SnowflakeUtil.generate().toString();
const NEUTRAL = 0x95a5a6;

// The guild's roles as Discord lists them: the harness guild's own plus any a test adds
function serveRoles(discord: DiscordHarness, extra: APIRole[] = []): void {
    discord.guildRoles(IDS.guild, [...apiGuild().roles, ...extra]);
}

describe("/taskroles list", () => {
    test("shows the milestone thresholds and which champion roles are set", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash(
            "taskroles",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "list" }],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
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
                    }),
                ],
            }),
        ]);
    });
});

describe("/taskroles add", () => {
    test("creates a milestone role that doesn't exist yet and saves its threshold", async ({
        discord,
        slash,
        services,
    }) => {
        serveRoles(discord);
        const legend = apiRole({ name: "Task Legend" });
        discord.roleCreated(IDS.guild, legend);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "add",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Task Legend" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 200 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Added milestone role **Task Legend** (200)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toContainEqual(
            milestoneRoleFactory.build({ roleId: legend.id, label: legend.name, requiredSubmissions: 200 }),
        );
    });

    test("rejects a milestone threshold of zero without creating a role", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "add",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Task Legend" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 0 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Milestone thresholds must be greater than 0." }),
        ]);
        expect(discord.rolesCreated(IDS.guild)).toEqual([]);
    });

    test("sets an existing role as a champion role", async ({ discord, slash, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "add",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 1 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Set 1st place champion role to **Gold Champion**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles.taskChampionFirst).toBe(gold.id);
    });

    test("rejects a champion placement other than 1 to 3 without creating a role", async ({ discord, slash }) => {
        serveRoles(discord);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "add",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Fourth Place" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 4 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Champion placement must be 1, 2, or 3." }),
        ]);
        expect(discord.rolesCreated(IDS.guild)).toEqual([]);
    });
});

describe("/taskroles edit", () => {
    test("renames a milestone role and changes its threshold", async ({ discord, slash, services }) => {
        const expert = apiRole({ name: "Task Expert" });
        serveRoles(discord, [expert]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                ],
            },
        });
        discord.roleEdited(IDS.guild, { ...expert, name: "Task Pro" });

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "edit",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${expert.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "newrole", value: "Task Pro" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 60 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Updated milestone role **Task Pro** (60)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toEqual([
            {
                ...milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 60 }),
                label: "Task Pro",
            },
        ]);
    });

    test("moves a champion role to another placement", async ({ discord, slash, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "edit",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "newrole", value: "Gold Champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 2 },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Updated champion role **Gold Champion** to 2nd place." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles).toMatchObject({
            taskChampionFirst: "",
            taskChampionSecond: gold.id,
        });
    });
});

describe("/taskroles delete", () => {
    test("removes a milestone role from the settings and deletes it from the server", async ({
        discord,
        slash,
        services,
    }) => {
        const expert = apiRole({ name: "Task Expert" });
        const master = apiRole({ name: "Task Master" });
        serveRoles(discord, [expert, master]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                    milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
                ],
            },
        });
        discord.roleDeleted(IDS.guild, expert.id);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "delete",
                    options: [{ type: ApplicationCommandOptionType.String, name: "role", value: `<@&${expert.id}>` }],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Deleted milestone role **Task Expert**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toEqual([
            milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
        ]);
    });

    test("says so when Discord won't delete the role it stopped using", async ({ discord, slash, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        discord.refuse("DELETE", `/guilds/${IDS.guild}/roles/${gold.id}`, DiscordError.missingPermissions);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "delete",
                    options: [{ type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` }],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content:
                    "Removed champion role **Gold Champion** (1st). It is no longer a task role, but I couldn't delete it from the server. Check my permissions, or delete it yourself.",
            }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            "[TaskRoles] Failed to delete task role:",
            expect.objectContaining({ code: 50013 }),
        );
    });
});

describe("/taskroles toggle", () => {
    test("disables milestone roles", async ({ discord, slash, services }) => {
        serveRoles(discord);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "toggle",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Boolean, name: "enabled", value: false },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Disabled milestone roles." }),
        ]);
        expect(
            (await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles?.every(
                (role) => !role.enabled,
            ),
        ).toBe(true);
    });

    test("disables champion roles and takes them off the current champions", async ({
        discord,
        slash,
        services,
        factories,
    }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        await factories.periodicLeaderboard.create({ champions: { first: [member] } });
        discord.member(
            IDS.guild,
            apiGuildMember({ user: apiUser({ id: member, username: "champ" }), roles: [gold.id] }),
        );
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await slash(
            "taskroles",
            [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "toggle",
                    options: [
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Boolean, name: "enabled", value: false },
                    ],
                },
            ],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Disabled champion roles." }),
        ]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([`${member}:${gold.id}`]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.championRoles).toEqual({
            first: false,
            second: false,
            third: false,
        });
    });
});

describe("/taskroles grant", () => {
    test("gives a member a role", async ({ discord, interact }) => {
        const gold = apiRole({ name: "Gold Champion" });
        serveRoles(discord, [gold]);
        const target = apiUser({ id: member, username: "champ" });
        discord.member(IDS.guild, apiGuildMember({ user: target }));
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    {
                        type: ApplicationCommandOptionType.Subcommand,
                        name: "grant",
                        options: [
                            { type: ApplicationCommandOptionType.User, name: "user", value: member },
                            { type: ApplicationCommandOptionType.Role, name: "role", value: gold.id },
                        ],
                    },
                ],
                taskAdmin,
                { users: { [member]: target }, roles: { [gold.id]: gold } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Granted **Gold Champion** to champ." }),
        ]);
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${gold.id}`]);
    });
});

describe("/taskroles init", () => {
    test("creates the missing task roles and gives members the milestone role they have earned", async ({
        discord,
        slash,
        services,
        factories,
    }) => {
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
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member, username: "regular" }) }));
        discord.acceptMemberRoleChanges(IDS.guild, member);

        const interaction = await slash(
            "taskroles",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "init" }],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Task roles synced and granted to eligible users." }),
        ]);
        expect(discord.rolesCreated(IDS.guild).map((role) => [role.name, role.colors?.primary_color])).toEqual([
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
        const stored = await services.repos.guildRepo.getGuild(IDS.guild);
        expect(stored?.taskSettings?.milestoneRoles?.map((role) => role.roleId)).toEqual(
            created.slice(0, 4).map((role) => role.id),
        );
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

        const interaction = await slash(
            "taskroles",
            [{ type: ApplicationCommandOptionType.Subcommand, name: "rename" }],
            taskAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Unknown taskroles option." }),
        ]);
    });
});
