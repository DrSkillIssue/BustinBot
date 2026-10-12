import { describe, test, expect } from "vitest";

import { TaskInstructions } from "../../../../src/modules/tasks/TaskInstructions.js";
import { TaskType } from "../../../../src/models/Task.js";

describe("TaskInstructions mapping", () => {
    test("provides instructions for every task type", () => {
        const types = Object.values(TaskType);
        for (const type of types) {
            expect(TaskInstructions[type]).toBeTruthy();
            expect(typeof TaskInstructions[type]).toBe("string");
        }
    });
});
