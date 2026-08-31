import { describe, expect, it } from "bun:test";
import { COMMANDS, closestCommand, commandMenu } from "../src/handlers/commands";

describe("COMMANDS registry", () => {
  it("includes every user-facing command referenced elsewhere in the bot", () => {
    const names = COMMANDS.map((c) => c.command);
    for (const expected of [
      "start",
      "list",
      "guide",
      "demo",
      "about",
      "hire",
      "forget",
      "help",
      "cancel",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("has no duplicate command names", () => {
    const names = COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("commandMenu", () => {
  it("excludes hidden commands (e.g. /stats) from the Telegram menu", () => {
    const menu = commandMenu();
    expect(menu.some((c) => c.command === "stats")).toBe(false);
    expect(menu.some((c) => c.command === "start")).toBe(true);
  });

  it("every entry has a non-empty description (Telegram rejects blank ones)", () => {
    for (const c of commandMenu()) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("closestCommand", () => {
  it("suggests the intended command for a small typo", () => {
    expect(closestCommand("hlp")).toBe("help");
    expect(closestCommand("liist")).toBe("list");
  });

  it("never suggests a hidden command, even when it's the nearest match", () => {
    // "stat" is 1 edit from hidden "stats", which would otherwise win.
    expect(closestCommand("stat")).not.toBe("stats");
    expect(closestCommand("stat")).not.toBeNull();
  });

  it("returns null for something unrelated to any command", () => {
    expect(closestCommand("xyzzyplugh")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(closestCommand("")).toBeNull();
  });
});
