/**
 * index.js (FINAL)
 * Telegram Bot + MongoDB product search (polling)
 *
 * ✅ Fixes common issues:
 * - Proper /search parsing
 * - Safe regex (no crash on special chars)
 * - Clear logs on DB errors
 * - Handles 409 polling conflict gracefully (shows message + exits)
 * - Graceful shutdown (Ctrl+C / server stop)
 *
 * ENV required:
 * - BOT_TOKEN=xxxxxxxxxxxxxxxxxxxx
 * - MONGO_URI=mongodb+srv://...
 * - WEBSITE_URL=https://nearbycart.in   (optional)
 */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// -------------------- CONFIG --------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEBSITE_URL = process.env.WEBSITE_URL || "https://nearbycart-1p45.vercel.app?_vercel_share=rAWzzdIGwIGJGRDCWGYy1SKGNb1VodKO";

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
    await mongoose.connect(MONGO_URI, {
      // mongoose v7+ doesn't need many options; safe to keep minimal
    });
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

// -------------------- MODELS --------------------
// ✅ Make sure collection fields match your DB documents.
// If your schema is already in /models/Product.js, you can import it instead.
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

function formatProduct(p) {
  const price = typeof p.price === "number" ? `₹${p.price}` : "₹-";
  const qty = typeof p.quantity === "number" ? p.quantity : "-";
  return `• ${p.name} — ${price} (qty: ${qty})`;
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

    // If 409 conflict, it means another bot instance is polling
    // Best practice: stop this instance so it doesn't keep spamming errors.
    if (msg.includes("409") || msg.includes("Conflict")) {
      console.error(
        "🚫 409 Conflict: Another bot instance is running.\n" +
          "✅ Fix: Stop other running bot (local/railway/render) and keep only ONE instance."
      );
      // stop polling and exit so you immediately notice it
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
      "Tip: Use simple keywords (brand/item name).";
    return bot.sendMessage(chatId, text);
  });

  // ✅ /search (supports multi-word queries)
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
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      if (!products.length) {
        return bot.sendMessage(chatId, `No matches found for: ${userQuery}`);
      }

      const reply =
        `✅ Results for: "${userQuery}"\n\n` +
        products.map(formatProduct).join("\n") +
        "\n\n🔎 For full shop details, open website:";
      return bot.sendMessage(chatId, reply, {
        reply_markup: {
          inline_keyboard: [[{ text: "🌐 Open NearbyCart", url: WEBSITE_URL }]],
        },
      });
    } catch (err) {
      console.error("❌ Search error full:", err);
      return bot.sendMessage(chatId, "Error searching product ❌");
    }
  });

  // Optional: handle normal texts (when user doesn't type /search)
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    // ignore commands (handled above)
    if (!text || text.startsWith("/")) return;

    // simple friendly hint
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
