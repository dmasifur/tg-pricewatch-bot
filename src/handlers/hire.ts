import { escapeHtml, type Telegram } from "../lib/telegram";
import type { Env, InlineButton, TgUser } from "../types";

export type HireStep = "use_case" | "contact" | "done";

export function nextStep(current: HireStep): HireStep {
  return current === "use_case" ? "contact" : "done";
}

export function promptFor(step: HireStep): string {
  if (step === "use_case") {
    return "What would you want automated? One or two lines is plenty.\n\nSend /cancel to stop.";
  }
  return "How should I reach you? An email, or your Telegram handle if you'd rather I message you here.";
}

export function sanitise(input: string, max: number): string {
  return input.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function startHire(chatId: number, env: Env, tg: Telegram): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET pending_action = 'hire:use_case', hire_started_at = ? WHERE chat_id = ?",
  )
    .bind(new Date().toISOString(), chatId)
    .run();
  await tg.sendMessage(chatId, promptFor("use_case"));
}

export async function continueHire(
  chatId: number,
  step: HireStep,
  text: string,
  from: TgUser | undefined,
  env: Env,
  tg: Telegram,
): Promise<void> {
  const value = sanitise(text, step === "use_case" ? 500 : 120);

  if (value.length === 0) {
    await tg.sendMessage(chatId, promptFor(step));
    await env.DB.prepare("UPDATE users SET pending_action = ? WHERE chat_id = ?")
      .bind(`hire:${step}`, chatId)
      .run();
    return;
  }

  if (step === "use_case") {
    await env.DB.prepare(
      `INSERT INTO leads (chat_id, use_case, created_at) VALUES (?,?,?)
       ON CONFLICT(chat_id) DO UPDATE SET use_case = excluded.use_case`,
    )
      .bind(chatId, value, new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE users SET pending_action = 'hire:contact' WHERE chat_id = ?")
      .bind(chatId)
      .run();
    await tg.sendMessage(chatId, promptFor("contact"));
    return;
  }

  await env.DB.prepare(
    `INSERT INTO leads (chat_id, contact, username, created_at) VALUES (?,?,?,?)
     ON CONFLICT(chat_id) DO UPDATE SET contact = excluded.contact, username = excluded.username`,
  )
    .bind(chatId, value, from?.username ?? null, new Date().toISOString())
    .run();
  await env.DB.prepare("UPDATE users SET pending_action = NULL WHERE chat_id = ?")
    .bind(chatId)
    .run();

  await notifyAdminOfLead(chatId, value, from, env, tg);

  const keyboard: InlineButton[][] = [
    [{ text: "See my gigs", url: env.GIG_URL }],
    [{ text: "Portfolio", url: env.PORTFOLIO_URL }],
  ];

  await tg.sendMessage(
    chatId,
    `Got it — I'll be in touch at <b>${escapeHtml(value)}</b>.\n\n` +
      "Meanwhile, here's the same machinery packaged up. Anything stored here goes away with /forget.",
    keyboard,
  );
}

export function leadDisplayName(from: TgUser | undefined, chatId: number): string {
  return from?.username ? `@${from.username}` : (from?.first_name ?? `chat ${chatId}`);
}

export function leadNotificationText(
  who: string,
  useCase: string | null,
  contact: string,
  chatId: number,
): string {
  return (
    `💼 New lead from ${escapeHtml(who)}\n\n` +
    `<b>Wants:</b> ${escapeHtml(useCase ?? "—")}\n` +
    `<b>Reach them at:</b> ${escapeHtml(contact)}\n` +
    `<b>Chat ID:</b> <code>${chatId}</code>`
  );
}

export function resolveAdminChatId(env: Env): number | null {
  const adminId = Number(env.ADMIN_CHAT_ID);
  return Number.isFinite(adminId) && adminId !== 0 ? adminId : null;
}

// Doesn't go through alertAdmin (src/lib/ops.ts): its per-key cooldown would
// silently drop any lead arriving within the cooldown window of the last one.
async function notifyAdminOfLead(
  chatId: number,
  contact: string,
  from: TgUser | undefined,
  env: Env,
  tg: Telegram,
): Promise<void> {
  const adminId = resolveAdminChatId(env);
  if (adminId === null) return;

  const lead = await env.DB.prepare("SELECT use_case FROM leads WHERE chat_id = ?")
    .bind(chatId)
    .first<{ use_case: string | null }>();

  await tg.sendMessage(
    adminId,
    leadNotificationText(leadDisplayName(from, chatId), lead?.use_case ?? null, contact, chatId),
  );
}
