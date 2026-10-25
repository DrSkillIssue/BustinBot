import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { describe, expect, test } from "../fixtures.js";
import { type DiscordHarness } from "../discord/harness.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import { IDS, apiGuildMember, apiRole, apiUser, AS, chatInputInteraction } from "../discord/payloads.js";
import { milestoneRoleFactory } from "../factories.js";
import { applyTaskMilestoneRoles } from "../../src/modules/tasks/TaskMilestones.js";

const member = SnowflakeUtil.generate().toString();
async function setUpMilestoneRoles(discord: DiscordHarness, services: ServiceContainer) {
    const participant = apiRole({ name: "Task Participant" });
    const enthusiast = apiRole({ name: "Task Enthusiast" });
    const expert = apiRole({ name: "Task Expert" });
    for (const role of [participant, enthusiast, expert]) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, {
        taskSettings: {
            milestoneRoles: [
                milestoneRoleFactory.build({ roleId: participant.id, label: participant.name, requiredSubmissions: 5 }),
                milestoneRoleFactory.build({ roleId: enthusiast.id, label: enthusiast.name, requiredSubmissions: 25 }),
                milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
            ],
        },
    });
    return { participant, enthusiast, expert };
}

const NEUTRAL = 0x95a5a6;

describe("milestone roles", () => {
    test("give a member the highest milestone they have reached, take the lower one away and tell them", async ({
        discord,
        services,
        factories,
    }) => {
        const { participant, enthusiast } = await setUpMilestoneRoles(discord, services);
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member }), roles: [participant.id] }));
        const dm = discord.acceptDirectMessages(apiUser({ id: member }));

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${enthusiast.id}`]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([`${member}:${participant.id}`]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: "You have earned the **Task Enthusiast** role for completing 25 tasks!",
            }),
        ]);
    });
});

describe("/taskroles list", () => {
    test("shows the milestone thresholds and which champion roles are set", async ({ discord, interact }) => {
        discord.guildRoles();

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "list" }],
                AS.taskAdmin,
            ),
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
        interact,
        services,
    }) => {
        discord.guildRoles();
        const legend = apiRole({ name: "Task Legend" });
        discord.roleCreated(IDS.guild, legend);

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Added milestone role **Task Legend** (200)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toContainEqual(
            milestoneRoleFactory.build({ roleId: legend.id, label: legend.name, requiredSubmissions: 200 }),
        );
    });

    test("sets an existing role as a champion role", async ({ discord, interact, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.guildRoles([gold]);

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Set 1st place champion role to **Gold Champion**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles.taskChampionFirst).toBe(gold.id);
    });
});

describe("/taskroles edit", () => {
    test("renames a milestone role and changes its threshold", async ({ discord, interact, services }) => {
        const expert = apiRole({ name: "Task Expert" });
        discord.guildRoles([expert]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                ],
            },
        });
        discord.roleEdited(IDS.guild, { ...expert, name: "Task Pro" });

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
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

    test("moves a champion role to another placement", async ({ discord, interact, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.guildRoles([gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
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
        interact,
        services,
    }) => {
        const expert = apiRole({ name: "Task Expert" });
        const master = apiRole({ name: "Task Master" });
        discord.guildRoles([expert, master]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                    milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
                ],
            },
        });
        discord.roleDeleted(IDS.guild, expert.id);

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    {
                        type: ApplicationCommandOptionType.Subcommand,
                        name: "delete",
                        options: [
                            { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${expert.id}>` },
                        ],
                    },
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Deleted milestone role **Task Expert**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toEqual([
            milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
        ]);
    });
});

describe("/taskroles toggle", () => {
    test("disables milestone roles", async ({ discord, interact, services }) => {
        discord.guildRoles();

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
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
        interact,
        services,
        factories,
    }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.guildRoles([gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        await factories.periodicLeaderboard.create({ champions: { first: [member] } });
        discord.member(
            IDS.guild,
            apiGuildMember({ user: apiUser({ id: member, username: "champ" }), roles: [gold.id] }),
        );

        const interaction = await interact(
            chatInputInteraction(
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
                AS.taskAdmin,
            ),
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
        discord.guildRoles([gold]);
        const target = apiUser({ id: member, username: "champ" });
        discord.member(IDS.guild, apiGuildMember({ user: target }));

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
                AS.taskAdmin,
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
        interact,
        services,
        factories,
    }) => {
        discord.guildRoles();
        const enthusiast = apiRole({ name: "Task Enthusiast" });
        const milestones = [
            apiRole({ name: "Task Participant" }),
            enthusiast,
            apiRole({ name: "Task Expert" }),
            apiRole({ name: "Task Master" }),
        ];
        const champions = {
            first: apiRole({ name: "Task Champion (1st)" }),
            second: apiRole({ name: "Task Champion (2nd)" }),
            third: apiRole({ name: "Task Champion (3rd)" }),
        };
        const created = [...milestones, champions.first, champions.second, champions.third];
        for (const role of created) discord.roleCreated(IDS.guild, role);
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.member(IDS.guild, apiGuildMember({ user: apiUser({ id: member, username: "regular" }) }));

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "init" }],
                AS.taskAdmin,
            ),
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
        expect(discord.memberRoleChanges("PUT")).toEqual([`${member}:${enthusiast.id}`]);
        const stored = await services.repos.guildRepo.getGuild(IDS.guild);
        expect(stored?.taskSettings?.milestoneRoles?.map((role) => role.roleId)).toEqual(
            milestones.map((role) => role.id),
        );
        expect(stored?.roles).toMatchObject({
            taskChampionFirst: champions.first.id,
            taskChampionSecond: champions.second.id,
            taskChampionThird: champions.third.id,
        });
    });
});
