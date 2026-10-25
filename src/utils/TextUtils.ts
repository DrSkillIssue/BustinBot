import { unzip } from "es-toolkit";

export function truncate(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

export function textTable(rows: string[][], align: ("l" | "r")[], gap: string): string {
    const columns = unzip(rows).map((cells, column) => {
        const width = Math.max(...cells.map((cell) => cell.length));
        return cells.map((cell) => (align[column] === "r" ? cell.padStart(width) : cell.padEnd(width)));
    });
    return unzip(columns)
        .map((row) => row.join(gap))
        .join("\n");
}
