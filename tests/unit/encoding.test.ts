import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards against Thai text being corrupted when a tool reads UTF-8 as Windows-874 (ANSI) and writes it back.
// Built from escapes so this file does not match itself.
const MOJIBAKE = new RegExp(
  [
    "(?:เธ.|เน.){3,}", // runs of "เธx"/"เนx" (each Thai UTF-8 byte pair misread)
    "เน€", // "เน€"
    "โ€", // "โ€" (a misread em dash / quote)
    "�", // replacement character
  ].join("|"),
);

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIRS = ["src", "db", "docs", "scripts", "tests"];
const EXT = /\.(ts|tsx|mts|js|mjs|sql|md|css|json)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : EXT.test(name) ? [p] : [];
  });
}

describe("text encoding", () => {
  it("no source file contains corrupted (mojibake) Thai text or a UTF-8 BOM", () => {
    const bad: string[] = [];
    // this file contains deliberate samples of corrupted text, so it is the one exception
    for (const f of DIRS.flatMap((d) => files(path.join(ROOT, d))).filter((f) => f !== import.meta.filename)) {
      const buf = readFileSync(f);
      const rel = path.relative(ROOT, f);
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bad.push(`${rel}: starts with a BOM`);
      const lines = buf.toString("utf8").split("\n");
      lines.forEach((l, i) => MOJIBAKE.test(l) && bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 60)}`));
    }
    expect(bad).toEqual([]);
  });

  it("detector catches the real corruption seen in production and ignores normal Thai", () => {
    const corrupted = Buffer.from("เจ้าของรีสอร์ท", "utf8").toString("latin1"); // stand-in check below uses real sample
    expect(corrupted).not.toBe("เจ้าของรีสอร์ท");
    const realSample = "เน€เธจเน้เธา"; // first chars of the broken owner name
    expect(MOJIBAKE.test(realSample)).toBe(true);
    for (const ok of ["เจ้าของรีสอร์ท", "เธอจองห้องพัก", "ราคาห้องพัก — รวม VAT", "ฟ้าทะเลรีสอร์ท"]) expect(MOJIBAKE.test(ok)).toBe(false);
  });
});
