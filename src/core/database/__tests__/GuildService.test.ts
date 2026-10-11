import { describe, it, beforeEach, expect, vi } from "vitest";

// 👇 Must come before imports that use Firestore
vi.mock("../../database/firestore", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
      })),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    })),
  },
}));

// Mock the repo itself
vi.mock("../GuildRepo", () => {
  const getGuild = vi.fn();
  const updateGuild = vi.fn();
  const updateToggle = vi.fn();
  const getAllGuilds = vi.fn();

  return {
    GuildRepository: vi.fn().mockImplementation(function () {
      return {
        getGuild,
        updateGuild,
        updateToggle,
        getAllGuilds,
      };
    }),
  };
});

import { GuildRepository } from "../GuildRepo.js";
import { GuildService } from "../../services/GuildService.js";
import type { Guild } from "../../../models/Guild.js";

describe("GuildService", () => {
  let repo: any;
  let service: GuildService;

  const baseGuild: Guild = {
    id: "123",
    toggles: { taskScheduler: false, leaguesEnabled: false },
    roles: {
      admin: "Admin",
      movieAdmin: "MovieAdmin",
      movieUser: "MovieUser",
      taskAdmin: "TaskAdmin",
      taskUser: "TaskUser",
    },
    channels: {
      taskChannel: "111",
      taskVerification: "222",
      movieNight: "333",
      movieVC: "444",
    },
    setupComplete: { core: true, movie: true, task: true },
    updatedBy: "tester",
    updatedAt: new Date() as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new GuildRepository();
    service = new GuildService(repo);
  });

  it("caches a guild after first fetch", async () => {
    repo.getGuild.mockResolvedValue(baseGuild);

    const g1 = await service.get("123");
    const g2 = await service.get("123");

    expect(g1).toEqual(baseGuild);
    expect(g2).toEqual(baseGuild);
    expect(repo.getGuild).toHaveBeenCalledTimes(1);
  });

  it("updates guild data and merges into cache", async () => {
    service["cache"].set("123", baseGuild);

    await service.update("123", {
      toggles: { taskScheduler: true, leaguesEnabled: false },
      updatedBy: "adminUser",
    });

    const cached = service["cache"].get("123");
    expect(cached?.toggles.taskScheduler).toBe(true);
    expect(cached?.roles.admin).toBe("Admin");
    expect(repo.updateGuild).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({
        toggles: expect.objectContaining({ taskScheduler: true, leaguesEnabled: false }),
        updatedBy: "adminUser",
      })
    );
  });

  it("toggles scheduler and updates cache", async () => {
    service["cache"].set("123", baseGuild);

    await service.toggleScheduler("123", true, "adminUser");

    const cached = service["cache"].get("123");
    expect(cached?.toggles.taskScheduler).toBe(true);
    expect(cached?.updatedBy).toBe("adminUser");
    expect(repo.updateToggle).toHaveBeenCalledWith("123", "toggles.taskScheduler", true, "adminUser");
  });

  it("keeps other toggles and settings in the cache when one toggle changes", async () => {
    service["cache"].set("123", {
      ...baseGuild,
      toggles: { taskScheduler: false, leaguesEnabled: true, taskLeaderboard: false },
      timezone: "Australia/Melbourne",
    });

    await service.updateToggle("123", "toggles.taskScheduler", true, "adminUser");

    const cached = service["cache"].get("123");
    expect(cached?.toggles).toEqual({ taskScheduler: true, leaguesEnabled: true, taskLeaderboard: false });
    expect(cached?.timezone).toBe("Australia/Melbourne");
    expect(cached?.roles).toEqual(baseGuild.roles);
    expect(cached?.channels).toEqual(baseGuild.channels);
  });

  it("loads the stored guild after toggling one that was not cached", async () => {
    repo.getGuild.mockResolvedValue({
      ...baseGuild,
      toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false },
    });

    await service.updateToggle("123", "toggles.taskScheduler", true, "adminUser");

    expect(service["cache"].has("123")).toBe(false);
    const loaded = await service.get("123");
    expect(repo.getGuild).toHaveBeenCalledWith("123");
    expect(loaded?.roles).toEqual(baseGuild.roles);
    expect(loaded?.toggles.taskLeaderboard).toBe(false);
  });

  it("keeps existing toggles when updating other fields", async () => {
    service["cache"].set("123", {
      ...baseGuild,
      toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false },
    });

    await service.update("123", { timezone: "Europe/London" });

    expect(repo.updateGuild).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({
        timezone: "Europe/London",
        toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false },
      })
    );
    expect(service["cache"].get("123")?.toggles.taskLeaderboard).toBe(false);
  });

  it("loads all guilds and caches them", async () => {
    repo.getAllGuilds.mockResolvedValue([baseGuild]);

    const guilds = await service.getAll();
    expect(guilds).toHaveLength(1);
    expect(service["cache"].has("123")).toBe(true);
  });
});
