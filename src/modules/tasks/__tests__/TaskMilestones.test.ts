import { describe, expect, it } from "vitest";
import { getHighestMilestone, getTotalTaskCompletions } from "../TaskMilestones.js";

describe("TaskMilestones helpers", () => {
    it("counts legacy completions toward totals", () => {
        const total = getTotalTaskCompletions({
            tasksCompletedBronze: 2,
            tasksCompletedSilver: 1,
            tasksCompletedGold: 0,
            legacyTasksCompleted: 8,
        });

        expect(total).toBe(11);
    });

    it("returns the highest eligible milestone", () => {
        const milestones = [
            { id: "participant", label: "Task Participant", roleId: "1", requiredSubmissions: 5, enabled: true },
            { id: "enthusiast", label: "Task Enthusiast", roleId: "2", requiredSubmissions: 25, enabled: true },
            { id: "expert", label: "Task Expert", roleId: "3", requiredSubmissions: 50, enabled: true },
        ];

        const highest = getHighestMilestone(milestones as any, 30);
        expect(highest?.id).toBe("enthusiast");
    });

    it("skips disabled milestones", () => {
        const milestones = [
            { id: "participant", label: "Task Participant", roleId: "1", requiredSubmissions: 5, enabled: true },
            { id: "enthusiast", label: "Task Enthusiast", roleId: "2", requiredSubmissions: 25, enabled: false },
            { id: "expert", label: "Task Expert", roleId: "3", requiredSubmissions: 50, enabled: true },
        ];

        const highest = getHighestMilestone(milestones as any, 30);
        expect(highest?.id).toBe("participant");
    });
});
