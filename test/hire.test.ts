import { describe, expect, it } from "bun:test";
import {
  leadDisplayName,
  leadNotificationText,
  nextStep,
  promptFor,
  resolveAdminChatId,
  sanitise,
} from "../src/handlers/hire";
import type { Env, TgUser } from "../src/types";

describe("hire flow", () => {
  it("runs exactly two questions", () => {
    expect(nextStep("use_case")).toBe("contact");
    expect(nextStep("contact")).toBe("done");
  });

  it("offers an exit in the first prompt", () => {
    expect(promptFor("use_case")).toContain("/cancel");
  });
});

describe("sanitise", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitise("  a\n\n  b  ", 50)).toBe("a b");
  });

  it("truncates to the cap", () => {
    expect(sanitise("x".repeat(200), 20).length).toBe(20);
  });

  it("yields an empty string for whitespace only", () => {
    expect(sanitise("   \n ", 50)).toBe("");
  });
});

describe("leadDisplayName", () => {
  it("prefers @username when present", () => {
    const from: TgUser = { id: 1, username: "asifur_test", first_name: "Asifur" };
    expect(leadDisplayName(from, 999)).toBe("@asifur_test");
  });

  it("falls back to first_name when there's no username", () => {
    const from: TgUser = { id: 1, first_name: "Asifur" };
    expect(leadDisplayName(from, 999)).toBe("Asifur");
  });

  it("falls back to a chat-id label when Telegram sent neither", () => {
    expect(leadDisplayName(undefined, 999)).toBe("chat 999");
    expect(leadDisplayName({ id: 1 }, 999)).toBe("chat 999");
  });
});

describe("resolveAdminChatId", () => {
  const baseEnv = {} as Env;

  it("returns the parsed chat id when configured", () => {
    expect(resolveAdminChatId({ ...baseEnv, ADMIN_CHAT_ID: "123456789" })).toBe(123456789);
  });

  it("returns null when unset, empty, non-numeric, or zero (mirrors alertAdmin's guard)", () => {
    expect(resolveAdminChatId({ ...baseEnv, ADMIN_CHAT_ID: "" })).toBeNull();
    expect(resolveAdminChatId({ ...baseEnv, ADMIN_CHAT_ID: "0" })).toBeNull();
    expect(resolveAdminChatId({ ...baseEnv, ADMIN_CHAT_ID: "not-a-number" })).toBeNull();
  });
});

describe("leadNotificationText", () => {
  it("includes who, what they want, how to reach them, and the chat id", () => {
    const text = leadNotificationText(
      "@asifur_test",
      "automate invoice exports",
      "asif@example.com",
      42,
    );
    expect(text).toContain("@asifur_test");
    expect(text).toContain("automate invoice exports");
    expect(text).toContain("asif@example.com");
    expect(text).toContain("<code>42</code>");
  });

  it("shows a placeholder when the use case is missing", () => {
    const text = leadNotificationText("chat 42", null, "asif@example.com", 42);
    expect(text).toContain("Wants:</b> —");
  });

  it("escapes HTML in every interpolated field", () => {
    const text = leadNotificationText("<script>x</script>", "<b>hack</b>", "<img src=x>", 42);
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<b>hack</b>");
    expect(text).not.toContain("<img");
  });
});
