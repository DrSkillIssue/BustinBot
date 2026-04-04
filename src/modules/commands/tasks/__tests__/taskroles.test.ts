import { describe, expect, it, beforeEach, vi } from "vitest";
import taskroles from "../taskroles.js";

const makeMockGuild = (initialRoles: Array<{ id: string; name: string; color?: number }> = []) => {
    const rolesMap = new Map<string, any>();

    const createRole = (id: string, name: string, color = 0) => {
        const members = new Map<string, any>();
        const role = {
            id,
            name,
            color,
            members: {
                values: () => members.values(),
            },
            _members: members,
            setColor: vi.fn(async (newColor: number) => {
                role.color = newColor;
                return role;
            }),
            setName: vi.fn(async (newName: string) => {
                role.name = newName;
                return role;
            }),
            delete: vi.fn(async () => {
                rolesMap.delete(id);
            }),
        };
        rolesMap.set(id, role);
        return role;
    };

    initialRoles.forEach((role) => {
        createRole(role.id, role.name, role.color ?? 0);
    });

    const rolesCache = {
        get: (id: string) => rolesMap.get(id) ?? null,
        filter: (fn: (role: any) => boolean) => {
            const filtered = Array.from(rolesMap.values()).filter(fn);
            return {
                size: filtered.length,
                first: () => filtered[0] ?? null,
                values: () => filtered.values(),
            };
        },
    };

    const membersMap = new Map<string, any>();
    const createMember = (id: string, roleIds: string[] = []) => {
        const roleSet = new Set<string>(roleIds);
        const member = {
            id,
            roles: {
                cache: {
                    has: (roleId: string) => roleSet.has(roleId),
                },
                add: vi.fn(async (roleId: string) => {
                    roleSet.add(roleId);
                    const role = rolesMap.get(roleId);
                    if (role) role._members.set(id, member);
                }),
                remove: vi.fn(async (roleId: string) => {
                    roleSet.delete(roleId);
                    const role = rolesMap.get(roleId);
                    if (role) role._members.delete(id);
                }),
            },
        };
        membersMap.set(id, member);
        roleIds.forEach((roleId) => {
            const role = rolesMap.get(roleId);
            if (role) role._members.set(id, member);
        });
        return member;
    };

    const guild: any = {
        id: "guild-1",
        roles: {
            cache: rolesCache,
            fetch: vi.fn(async () => undefined),
            create: vi.fn(async ({ name, color }: { name: string; color?: number }) => {
                const id = `role-${rolesMap.size + 1}`;
                return createRole(id, name, color ?? 0);
            }),
        },
        members: {
            fetch: vi.fn(async (id: string) => {
                const member = membersMap.get(id);
                if (!member) {
                    const err: any = new Error("Unknown Member");
                    err.code = 10007;
                    throw err;
                }
                return member;
            }),
        },
    };

    return { guild, rolesMap, membersMap, createRole, createMember };
};

const buildInteraction = (guild: any, subcommand: string, options: Record<string, any>) => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    const interaction: any = {
        guild,
        guildId: guild.id,
        user: { id: "user-1", tag: "User#0001" },
        options: {
            getSubcommand: () => subcommand,
            getString: (name: string) => options[name] ?? null,
            getInteger: (name: string) => options[name] ?? null,
            getBoolean: (name: string) => options[name] ?? null,
            getUser: (name: string) => options[name] ?? null,
            getRole: (name: string) => options[name] ?? null,
        },
        reply,
        deferReply,
        editReply,
    };

    return { interaction, reply, deferReply, editReply };
};

describe("/taskroles subcommands", () => {
    const guilds = {
        get: vi.fn(),
        update: vi.fn(),
    };

    const baseServices: any = {
        guilds,
        repos: {
            userRepo: {
                getAllUsers: vi.fn(),
            },
            taskLeaderboardRepo: {
                getLeaderboard: vi.fn(),
            },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("adds a milestone role and creates it when missing", async () => {
        const { guild } = makeMockGuild();
        guilds.get.mockResolvedValue({ taskSettings: {}, roles: {} });

        const { interaction } = buildInteraction(guild, "add", {
            role: "Task Legend",
            type: "milestone",
            value: 50,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(guild.roles.create).toHaveBeenCalledWith({ name: "Task Legend" });
        expect(guilds.update).toHaveBeenCalledWith(
            "guild-1",
            expect.objectContaining({
                taskSettings: expect.objectContaining({
                    milestoneRoles: expect.arrayContaining([
                        expect.objectContaining({
                            label: "Task Legend",
                            requiredSubmissions: 50,
                            roleId: expect.any(String),
                        }),
                    ]),
                }),
            })
        );
    });

    it("adds a champion role when role exists", async () => {
        const { guild, createRole } = makeMockGuild();
        const role = createRole("champion-1", "Champion Gold");
        guilds.get.mockResolvedValue({ taskSettings: {}, roles: {} });

        const { interaction } = buildInteraction(guild, "add", {
            role: role.name,
            type: "champion",
            value: 1,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(guilds.update).toHaveBeenCalledWith("guild-1", {
            roles: { taskChampionFirst: "champion-1" },
        });
    });

    it("edits a milestone role (rename + threshold)", async () => {
        const { guild, createRole } = makeMockGuild([{ id: "milestone-1", name: "Task Starter" }]);
        const role = createRole("milestone-1", "Task Starter");

        guilds.get.mockResolvedValue({
            taskSettings: {
                milestoneRoles: [
                    {
                        id: "milestone-1",
                        label: "Task Starter",
                        roleId: "milestone-1",
                        requiredSubmissions: 5,
                        enabled: true,
                    },
                ],
            },
            roles: {},
        });

        const { interaction } = buildInteraction(guild, "edit", {
            role: "Task Starter",
            newrole: "Task Pro",
            value: 10,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(role.setName).toHaveBeenCalledWith("Task Pro");
        expect(guilds.update).toHaveBeenCalledWith(
            "guild-1",
            expect.objectContaining({
                taskSettings: {
                    milestoneRoles: [
                        expect.objectContaining({
                            label: "Task Pro",
                            requiredSubmissions: 10,
                        }),
                    ],
                },
            })
        );
    });

    it("edits a champion role and moves placement", async () => {
        const { guild, createRole } = makeMockGuild([{ id: "champ-1", name: "Champion" }]);
        const role = createRole("champ-1", "Champion");
        guilds.get.mockResolvedValue({
            taskSettings: {},
            roles: { taskChampionFirst: "champ-1" },
        });

        const { interaction } = buildInteraction(guild, "edit", {
            role: "Champion",
            newrole: "Champion",
            value: 2,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(role.setName).not.toHaveBeenCalled();
        expect(guilds.update).toHaveBeenCalledWith("guild-1", {
            roles: { taskChampionSecond: "champ-1", taskChampionFirst: "" },
        });
    });

    it("deletes a milestone role and removes it from config", async () => {
        const { guild, createRole } = makeMockGuild([{ id: "milestone-1", name: "Task Starter" }]);
        const role = createRole("milestone-1", "Task Starter");
        guilds.get.mockResolvedValue({
            taskSettings: {
                milestoneRoles: [
                    {
                        id: "milestone-1",
                        label: "Task Starter",
                        roleId: "milestone-1",
                        requiredSubmissions: 5,
                        enabled: true,
                    },
                ],
            },
            roles: {},
        });

        const { interaction } = buildInteraction(guild, "delete", {
            role: "Task Starter",
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(role.delete).toHaveBeenCalled();
        expect(guilds.update).toHaveBeenCalledWith("guild-1", {
            taskSettings: { milestoneRoles: [] },
        });
    });

    it("toggles champion roles off and removes roles from holders", async () => {
        const { guild, createRole, createMember } = makeMockGuild([
            { id: "champ-1", name: "Champion 1" },
        ]);
        const role = createRole("champ-1", "Champion 1");
        const member = createMember("user-1", ["champ-1"]);

        baseServices.repos.taskLeaderboardRepo.getLeaderboard.mockResolvedValue({
            champions: { first: ["user-1"], second: [], third: [] },
        });

        guilds.get.mockResolvedValue({
            taskSettings: {},
            roles: { taskChampionFirst: "champ-1" },
        });

        const { interaction } = buildInteraction(guild, "toggle", {
            type: "champion",
            enabled: false,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(member.roles.remove).toHaveBeenCalledWith("champ-1");
        expect(guilds.update).toHaveBeenCalledWith("guild-1", {
            taskSettings: {
                championRoles: { first: false, second: false, third: false },
            },
        });
    });

    it("grants a role to a user", async () => {
        const { guild, createRole, createMember } = makeMockGuild([{ id: "role-1", name: "Tasker" }]);
        const role = createRole("role-1", "Tasker");
        const member = createMember("user-2");

        guilds.get.mockResolvedValue({ taskSettings: {}, roles: {} });

        const { interaction } = buildInteraction(guild, "grant", {
            user: { id: "user-2", tag: "Target#0002" },
            role,
        });

        await taskroles.execute({ interaction, services: baseServices });

        expect(member.roles.add).toHaveBeenCalledWith("role-1");
    });

    it("initialises roles and grants milestone roles to eligible users", async () => {
        const { guild, createMember } = makeMockGuild();
        createMember("user-1");
        createMember("user-2");

        guilds.get.mockResolvedValue({
            taskSettings: {
                milestoneRoles: [
                    {
                        id: "milestone-a",
                        label: "Task Participant",
                        roleId: "",
                        requiredSubmissions: 5,
                        enabled: true,
                    },
                    {
                        id: "milestone-b",
                        label: "Task Expert",
                        roleId: "",
                        requiredSubmissions: 50,
                        enabled: true,
                    },
                ],
            },
            roles: {},
        });

        baseServices.repos.userRepo.getAllUsers.mockResolvedValue([
            { userId: "user-1", tasksCompletedBronze: 5, tasksCompletedSilver: 0, tasksCompletedGold: 0, legacyTasksCompleted: 0 },
            { userId: "user-2", tasksCompletedBronze: 60, tasksCompletedSilver: 0, tasksCompletedGold: 0, legacyTasksCompleted: 0 },
        ]);

        const { interaction, deferReply, editReply } = buildInteraction(guild, "init", {});

        await taskroles.execute({ interaction, services: baseServices });

        expect(deferReply).toHaveBeenCalled();
        expect(editReply).toHaveBeenCalledWith({ content: "Task roles synced and granted to eligible users." });
        expect(guild.roles.create).toHaveBeenCalled();
    });
});
