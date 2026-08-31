#!/usr/bin/env bun

import { USER_AGENT } from "../src/lib/fetcher";

const url = process.argv[2];
if (url === undefined) {
  console.error("usage: bun scripts/capture-fixture.ts <url>");
  process.exit(1);
}

const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
const html = await response.text();
const slug = new URL(url).hostname.replace(/[^a-z0-9]/gi, "-");
const path = `test/fixtures/live/${slug}-${Date.now()}.html`;

await Bun.write(path, html);
console.log(`${response.status} · ${(html.length / 1024).toFixed(0)}kb → ${path}`);