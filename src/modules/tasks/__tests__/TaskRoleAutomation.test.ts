import { describe, expect, it, vi } from "vitest";
import { applyTaskMilestoneRoles } from "../TaskMilestones.js";
import { awardTaskChampionRoles } from "../TaskLeaderboards.js";

const makeGuildWithRoles = (roles: Array<{ id: string; name: string }>) => {
    const roleMap = new Map<string, any>();
    roles.forEach((role) => {
        roleMap.set(role.id, {
            id: role.id,
            name: role.name,
        });
    });

    const membersMap = new Map<string, any>();

    const createMember = (id: string, roleIds: string[] = []) => {
        const roleSet = new Set(roleIds);
        const member = {
            id,
            roles: {
                cache: {
                    has: (roleId: string) => roleSet.has(roleId),
                },
                add: vi.fn(async (roleId: string) => {
                    roleSet.add(roleId);
                }),
                remove: vi.fn(async (roleId: string) => {
                    roleSet.delete(roleId);
                }),
            },
        };
        membersMap.set(id, member);
        return member;
    };

    const guild: any = {
        roles: {
            cache: {
                get: (id: string) => roleMap.get(id) ?? null,
                find: (fn: (role: any) => boolean) => {
                    for (const role of roleMap.values()) {
                        if (fn(role)) return role;
                    }
                    return null;
                },
            },
        },
        members: {
            fetch: vi.fn(async (id: string) => {
                const member = membersMap.get(id);
                if (!member) throw new Error("Member not found");
                return member;
            }),
        },
    };

    return { guild, createMember };
};

describe("Task role automation", () => {
    it("applies highest milestone role and removes lower ones", async () => {
        const { guild, createMember } = makeGuildWithRoles([
            { id: "role-participant", name: "Task Participant" },
            { id: "role-expert", name: "Task Expert" },
        ]);
        const member = createMember("user-1", ["role-participant"]);

        const client: any = {
            guilds: { fetch: vi.fn(async () => guild) },
        };

        const services: any = {
            guildId: "guild-1",
            guilds: {
                get: vi.fn(async () => ({
                    taskSettings: {
                        milestoneRoles: [
                            {
                                id: "role-participant",
                                label: "Task Participant",
                                roleId: "role-participant",
                                requiredSubmissions: 5,
                                enabled: true,
                            },
                            {
                                id: "role-expert",
                                label: "Task Expert",
                                roleId: "role-expert",
                                requiredSubmissions: 50,
                                enabled: true,
                            },
                        ],
                    },
                })),
            },
            repos: {
                userRepo: {
                    getUserById: vi.fn(async () => ({
                        userId: "user-1",
                        tasksCompletedBronze: 60,
                        tasksCompletedSilver: 0,
                        tasksCompletedGold: 0,
                        legacyTasksCompleted: 0,
                    })),
                },
            },
        };

        await applyTaskMilestoneRoles(client as any, services, "user-1");

        expect(member.roles.add).toHaveBeenCalledWith("role-expert");
        expect(member.roles.remove).toHaveBeenCalledWith("role-participant");
    });

    it("assigns champion roles and increments stats on period end", async () => {
        const { guild, createMember } = makeGuildWithRoles([
            { id: "champ-1", name: "Task Champion (1st)" },
            { id: "champ-2", name: "Task Champion (2nd)" },
        ]);
        const member1 = createMember("winner-1");
        const member2 = createMember("winner-2");

        const client: any = {
            guilds: { fetch: vi.fn(async () => guild) },
        };

        const services: any = {
            guildId: "guild-1",
            guilds: {
                get: vi.fn(async () => ({
                    roles: {
                        taskChampionFirst: "champ-1",
                        taskChampionSecond: "champ-2",
                    },
                    taskSettings: {
                        championRoles: { first: true, second: true, third: true },
                    },
                })),
            },
            repos: {
                taskLeaderboardRepo: {
                    getLeaderboard: vi.fn(async () => ({ id: "periodic", points: {}, createdAt: "", updatedAt: "" })),
                    updateLeaderboard: vi.fn(async () => undefined),
                },
                userRepo: {
                    incrementStat: vi.fn(async () => undefined),
                },
            },
        };

        const placements = {
            first: [{ userId: "winner-1", points: 10 }],
            second: [{ userId: "winner-2", points: 8 }],
            third: [],
            winners: [{ userId: "winner-1", points: 10 }, { userId: "winner-2", points: 8 }],
        };

        await awardTaskChampionRoles(client as any, services, placements);

        expect(member1.roles.add).toHaveBeenCalledWith("champ-1");
        expect(member2.roles.add).toHaveBeenCalledWith("champ-2");
        expect(services.repos.userRepo.incrementStat).toHaveBeenCalledWith("winner-1", "taskChampionFirsts", 1);
        expect(services.repos.userRepo.incrementStat).toHaveBeenCalledWith("winner-2", "taskChampionSeconds", 1);
        expect(services.repos.taskLeaderboardRepo.updateLeaderboard).toHaveBeenCalled();
    });
});
