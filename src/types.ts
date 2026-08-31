import type { D1Database } from "@cloudflare/workers-types";
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  PORTFOLIO_URL: string;
  GIG_URL: string;
  MAX_ACTIVE_WATCHES: string;
  WATCH_TTL_DAYS: string;
  MIN_INTERVAL_MINUTES: string;
  MAX_REGISTRATIONS_PER_HOUR: string;
  MAX_BODY_BYTES: string;
  ADMIN_CHAT_ID: string;
  STATS_PUBLIC: string;
}

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
