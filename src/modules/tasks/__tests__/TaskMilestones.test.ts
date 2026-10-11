import { describe, expect, test } from "vitest";
import { getHighestMilestone, getTotalTaskCompletions } from "../TaskMilestones.js";

const milestones = [
    { id: "participant", label: "Task Participant", roleId: "1", requiredSubmissions: 5, enabled: true },
    { id: "enthusiast", label: "Task Enthusiast", roleId: "2", requiredSubmissions: 25, enabled: true },
    { id: "expert", label: "Task Expert", roleId: "3", requiredSubmissions: 50, enabled: true },
];

describe("TaskMilestones helpers", () => {
    test("counts legacy completions toward totals", () => {
        expect(getTotalTaskCompletions({ tasksCompletedBronze: 2, tasksCompletedSilver: 1, tasksCompletedGold: 0, legacyTasksCompleted: 8 })).toBe(11);
    });

    test("returns the highest milestone reached", () => {
        expect(getHighestMilestone(milestones, 30)?.id).toBe("enthusiast");
    });

    test("skips disabled milestones", () => {
        expect(getHighestMilestone(milestones.map((milestone) => ({ ...milestone, enabled: milestone.id !== "enthusiast" })), 30)?.id).toBe("participant");
    });
});
