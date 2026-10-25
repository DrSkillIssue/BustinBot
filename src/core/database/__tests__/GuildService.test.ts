import { describe, it, beforeEach, expect, vi, type Mocked } from "vitest";
import { GuildService } from "../../services/GuildService.js";
import type { IGuildRepository } from "../interfaces/IGuildRepo.js";
import type { Guild } from "../../../models/Guild.js";

function createGuildRepo(): Mocked<IGuildRepository> {
  return {
    getGuild: vi.fn(),
    initGuild: vi.fn(),
    updateGuild: vi.fn(),
    updateToggle: vi.fn(),
    getAllGuilds: vi.fn(),
  };
}

describe("GuildService", () => {
  let repo: Mocked<IGuildRepository>;
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
  };

  beforeEach(() => {
    repo = createGuildRepo();
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

  it("loads all guilds and caches them", async () => {
    repo.getAllGuilds.mockResolvedValue([baseGuild]);

    const guilds = await service.getAll();
    expect(guilds).toHaveLength(1);
    expect(service["cache"].has("123")).toBe(true);
  });
});
