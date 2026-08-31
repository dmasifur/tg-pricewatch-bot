// Own module so commands.ts and callbacks.ts don't need to import from each other.
export const GUIDE_TEXT =
  "<b>Adding a product to watch</b>\n\n" +
  "1. <b>Copy the link.</b> In the Amazon/Daraz/Bikroy app, tap Share → Copy Link. On desktop, copy it " +
  "from the address bar. Long tracking links (with <code>?spm=</code> or <code>?pvid=</code> in them) are fine — I strip what I don't need.\n\n" +
  "2. <b>Paste it here.</b> Just send the link as a message, no command needed.\n\n" +
  "3. <b>I'll read the page</b> and confirm the price I found, then ask how you want to be notified — " +
  "any price drop, or a target price — and how often to check.\n\n" +
  '4. <b>If I ask "which one is it?"</b> — some pages show several numbers (bundles, related items). Tap the ' +
  "right one and I'll remember exactly where to look on that page from then on.\n\n" +
  "<b>Where this works well:</b> Amazon, Daraz, Bikroy, and most Shopify or WooCommerce stores. A few sites " +
  "(Walmart, Taobao) actively block automated price checks, so I can't watch those.";
