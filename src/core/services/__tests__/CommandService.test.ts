import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test as base, vi } from "vitest";
import { loadCommands } from "../CommandService.js";

// A real directory of command modules for the loader to read
const test = base.extend("commandsDir", async ({}, { onCleanup }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "commands-"));
    onCleanup(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
});

function writeModule(dir: string, relativePath: string, contents: string): void {
    const fullPath = path.join(dir, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents, "utf8");
}

const command = (name: string, extra = "") => `export default { name: "${name}", description: "${name}", ${extra} execute() {} };`;

describe("loadCommands", () => {
    test("loads command modules recursively and registers their aliases", async ({ commandsDir }) => {
        writeModule(commandsDir, "foo.js", command("foo", `aliases: ["f"],`));
        writeModule(commandsDir, "nested/bar.ts", command("bar"));

        const commands = await loadCommands(commandsDir);

        expect([...commands.keys()].sort()).toEqual(["bar", "f", "foo"]);
        expect(commands.get("f")).toBe(commands.get("foo"));
    });

    test("ignores test files, type declarations and anything under __tests__", async ({ commandsDir }) => {
        writeModule(commandsDir, "real.js", command("real"));
        writeModule(commandsDir, "real.test.js", command("from-test"));
        writeModule(commandsDir, "types.d.ts", "export {};");
        writeModule(commandsDir, "__tests__/helper.js", command("from-tests-dir"));

        expect([...(await loadCommands(commandsDir)).keys()]).toEqual(["real"]);
    });

    test("skips modules that are not commands and keeps loading after a broken one", async ({ commandsDir }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        writeModule(commandsDir, "empty.js", "export default {};");
        writeModule(commandsDir, "broken.js", `throw new Error("broken at import");`);
        writeModule(commandsDir, "working.js", command("working"));

        expect([...(await loadCommands(commandsDir)).keys()]).toEqual(["working"]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipped invalid command module"));
        expect(error).toHaveBeenCalledWith(expect.stringContaining("Failed to load command broken.js"), expect.any(Error));
    });

    test("returns an independent registry each time", async ({ commandsDir }) => {
        writeModule(commandsDir, "foo.js", command("foo"));
        const first = await loadCommands(commandsDir);

        const second = await loadCommands(commandsDir);
        second.delete("foo");

        expect(first.has("foo")).toBe(true);
    });
});
