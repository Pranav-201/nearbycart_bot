/**
 * index.js (FINAL FIXED)
 * Telegram Bot + MongoDB product search (polling)
 *
 * ✅ Shows FULL DETAILS:
 * - Product: name, price, quantity
 * - Shop: shopName, category, address, openingTime
 * - Shopkeeper: name, phone (or mobile/contactNumber)
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
// ✅ Minimal Shopkeeper schema (adjust keys to match your real Shopkeeper model)
const shopkeeperSchema = new mongoose.Schema(
  {
    // change these if your Shopkeeper schema uses different names
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    mobile: { type: String, default: "" },
    contactNumber: { type: String, default: "" },
  },
  { timestamps: true }
);
const Shopkeeper =
  mongoose.models.Shopkeeper || mongoose.model("Shopkeeper", shopkeeperSchema);

// ✅ Your real Shop schema (same structure as backend)
const shopSchema = new mongoose.Schema(
  {
    shopkeeper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shopkeeper",
      required: true,
      unique: true,
    },
    shopName: { type: String, required: true },
    category: { type: String, required: true },
    address: { type: String, required: true },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    openingTime: { type: String },
  },
  { timestamps: true }
);
shopSchema.index({ location: "2dsphere" });

const Shop = mongoose.models.Shop || mongoose.model("Shop", shopSchema);

// ✅ Product schema
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

function escapeMarkdown(text) {
  // Telegram Markdown (not V2)
  return String(text).replace(/([_*`[\]])/g, "\\$1");
}

function getKeeperName(keeper) {
  return safeText(keeper?.name || keeper?.fullName || keeper?.ownerName, "-");
}

function getKeeperPhone(keeper) {
  return safeText(keeper?.phone || keeper?.mobile || keeper?.contactNumber, "-");
}

function formatResultLine(p, idx) {
  const shop = p.shop || {};
  const keeper = shop.shopkeeper || {};

  const productName = safeText(p.name);
  const price = safeNumber(p.price, 0);
  const qty = safeNumber(p.quantity, 0);

  const shopName = safeText(shop.shopName);
  const category = safeText(shop.category);
  const address = safeText(shop.address);
  const openingTime = safeText(shop.openingTime);

  const ownerName = getKeeperName(keeper);
  const phone = getKeeperPhone(keeper);

  return (
    `*${idx + 1}.* *${escapeMarkdown(productName)}*\n` +
    `💰 Price: ₹${price}\n` +
    `📦 Qty: ${qty}\n\n` +
    `🏪 Shop: ${escapeMarkdown(shopName)}\n` +
    `📂 Category: ${escapeMarkdown(category)}\n` +
    `📍 Address: ${escapeMarkdown(address)}\n` +
    `⏰ Opens: ${escapeMarkdown(openingTime)}\n` +
    `👤 Owner: ${escapeMarkdown(ownerName)}\n` +
    `📞 Contact: ${escapeMarkdown(phone)}\n`
  );
}

// -------------------- BOT START --------------------
async function main() {
  await connectDB();

  const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  console.log("🤖 Bot started (polling)");

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

  // /start
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

  // /help
  bot.onText(/^\/help$/, async (msg) => {
    const chatId = msg.chat.id;
    const text =
      "🧾 Commands:\n" +
      "• /search <product-name>\n" +
      "  Example: /search cetaphil\n\n" +
      "You will get product + shop + owner details.";
    return bot.sendMessage(chatId, text);
  });

  // /search
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
          select: "shopName category address openingTime shopkeeper",
          populate: {
            path: "shopkeeper",
            // ✅ Adjust if your Shopkeeper uses different field names
            select: "name phone mobile contactNumber fullName ownerName",
          },
        })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      if (!products.length) {
        return bot.sendMessage(chatId, `No matches found for: ${userQuery}`);
      }

      const header = `✅ Results for: "${escapeMarkdown(userQuery)}"\n\n`;
      const body = products.map((p, idx) => formatResultLine(p, idx)).join("\n");
      const footer = "\n🔎 For full details, open website:";

      return bot.sendMessage(chatId, header + body + footer, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🌐 Open NearbyCart", url: WEBSITE_URL }]],
        },
      });
    } catch (err) {
      console.error("❌ Search error:", err);
      return bot.sendMessage(chatId, "Error searching product ❌");
    }
  });

  // normal text → hint
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    if (!text || text.startsWith("/")) return;
    return bot.sendMessage(chatId, `Type: /search ${text}`);
  });

  // graceful shutdown
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
