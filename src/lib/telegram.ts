import type { InlineButton } from "../types";

export class Telegram {
  constructor(private token: string) {}

  private async call<T = unknown>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T | null> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`telegram ${method} failed`, res.status, await res.text().catch(() => ""));
      return null;
    }
    const body = (await res.json()) as { ok: boolean; result?: T };
    return body.ok ? (body.result ?? null) : null;
  }

  sendMessage(chatId: number, text: string, keyboard?: InlineButton[][]) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineButton[][]) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call("answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text } : {}),
    });
  }

  setMyCommands(commands: Array<{ command: string; description: string }>) {
    return this.call("setMyCommands", { commands });
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
