/**
 * index.js (FINAL UPDATED)
 * Telegram Bot + MongoDB product search (polling)
 *
 * ✅ Now includes FULL SHOP DETAILS in /search results:
 * - Product: name, price, quantity
 * - Shop: shopName, ownerName, phone, address
 * - Website button
 *
 * ENV required:
 * - BOT_TOKEN=xxxxxxxxxxxxxxxxxxxx
 * - MONGO_URI=mongodb+srv://...
 * - WEBSITE_URL=https://nearbycart.in (optional)
 */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// -------------------- CONFIG --------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEBSITE_URL =
  process.env.WEBSITE_URL ||
  "https://nearbycart-1p45.vercel.app?_vercel_share=rAWzzdIGwIGJGRDCWGYy1SKGNb1VodKO";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in .env");
  process.exit(1);
}
if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env");
  process.exit(1);
}

// -------------------- MONGODB CONNECT --------------------
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

// -------------------- MODELS --------------------
// NOTE: Ideally import your existing models from your backend repo.
// For bot-only repo, schemas are defined here.

// Shop schema (for populate)
// ⚠️ If your actual Shop fields are different, update these field names to match your DB.
const shopSchema = new mongoose.Schema(
  {
    shopName: { type: String, default: "" },
    ownerName: { type: String, default: "" },
    phone: { type: String, default: "" }, // or contactNumber/mobile in your DB
    address: { type: String, default: "" },
  },
  { timestamps: true }
);

const Shop = mongoose.models.Shop || mongoose.model("Shop", shopSchema);

// Product schema
const productSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop" },
    name: { type: String, required: true },
    category: { type: String, default: "general" },
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Product = mongoose.models.Product || mongoose.model("Product", productSchema);

// -------------------- HELPERS --------------------
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeText(v, fallback = "-") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatResultLine(p, idx) {
  const shop = p.shop || {};
  const productName = safeText(p.name);
  const price = safeNumber(p.price, 0);
  const qty = safeNumber(p.quantity, 0);

  const shopName = safeText(shop.shopName);
  const ownerName = safeText(shop.ownerName);
  const phone = safeText(shop.phone);
  const address = safeText(shop.address);

  return (
    `*${idx + 1}.* *${productName}*\n` +
    `💰 Price: ₹${price}\n` +
    `📦 Qty: ${qty}\n` +
    `🏪 Shop: ${shopName}\n` +
    `👤 Owner: ${ownerName}\n` +
    `📞 Contact: ${phone}\n` +
    `📍 Address: ${address}\n`
  );
}

function escapeMarkdown(text) {
  // Minimal escaping for Telegram Markdown (not MarkdownV2)
  // Avoids breaking on underscores and asterisks in names/addresses
  return String(text).replace(/([_*`[\]])/g, "\\$1");
}

// -------------------- BOT START --------------------
async function main() {
  await connectDB();

  // ✅ Start polling (ONLY ONE instance should run!)
  const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  console.log("🤖 Bot started (polling)");

  // -------------------- POLLING ERROR HANDLER --------------------
  bot.on("polling_error", (err) => {
    const msg = err?.message || "";
    console.error("❌ polling_error:", msg);

    if (msg.includes("409") || msg.includes("Conflict")) {
      console.error(
        "🚫 409 Conflict: Another bot instance is running.\n" +
          "✅ Fix: Stop other running bot (local/railway/render) and keep only ONE instance."
      );
      try {
        bot.stopPolling();
      } catch (e) {}
      process.exit(1);
    }
  });

  // -------------------- COMMANDS --------------------
  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;

    const text =
      "✅ Welcome to NearbyCart Bot!\n\n" +
      "Search products like:\n" +
      "👉 /search cetaphil\n\n" +
      "Or open website:";
    return bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🌐 Open NearbyCart", url: WEBSITE_URL }]],
      },
    });
  });

  bot.onText(/^\/help$/, async (msg) => {
    const chatId = msg.chat.id;
    const text =
      "🧾 Commands:\n" +
      "• /search <product-name>\n" +
      "  Example: /search cetaphil\n\n" +
      "You will get product + shop details.\n" +
      "Tip: Use simple keywords (brand/item name).";
    return bot.sendMessage(chatId, text);
  });

  bot.onText(/^\/search(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;

  try {
    const userQuery = (match?.[1] || "").trim();
    if (!userQuery) {
      return bot.sendMessage(chatId, "Use: /search <product>\nExample: /search cetaphil");
    }

    const safeQuery = escapeRegex(userQuery);

    const products = await Product.find({
      name: { $regex: safeQuery, $options: "i" },
    })
      .populate({
        path: "shop",
        select: "shopName category address openingTime",
        populate: {
          path: "shopkeeper",
          select: "name phone", // ⚠️ must exist in Shopkeeper schema
        },
      })
      .limit(10)
      .lean();

    if (!products.length) {
      return bot.sendMessage(chatId, `No matches found for: ${userQuery}`);
    }

    let message = `✅ Results for: "${userQuery}"\n\n`;

    products.forEach((p, i) => {
      const shop = p.shop || {};
      const keeper = shop.shopkeeper || {};

      message +=
        `*${i + 1}. ${p.name}*\n` +
        `💰 Price: ₹${p.price}\n` +
        `📦 Quantity: ${p.quantity}\n\n` +
        `🏪 Shop: ${shop.shopName || "-"}\n` +
        `📂 Category: ${shop.category || "-"}\n` +
        `📍 Address: ${shop.address || "-"}\n` +
        `⏰ Opens: ${shop.openingTime || "-"}\n\n` +
        `👤 Owner: ${keeper.name || "-"}\n` +
        `📞 Contact: ${keeper.phone || "-"}\n\n`;
    });

    return bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌐 Open NearbyCart", url: WEBSITE_URL }],
        ],
      },
    });
  } catch (err) {
    console.error("❌ Search error:", err);
    return bot.sendMessage(chatId, "Error searching product ❌");
  }
});


  // Optional: handle normal texts (when user doesn't type /search)
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    // ignore commands (handled above)
    if (!text || text.startsWith("/")) return;

    return bot.sendMessage(chatId, `Type: /search ${text}`);
  });

  // -------------------- GRACEFUL SHUTDOWN --------------------
  async function shutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down...`);
    try {
      await bot.stopPolling();
    } catch (e) {}
    try {
      await mongoose.connection.close();
    } catch (e) {}
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
