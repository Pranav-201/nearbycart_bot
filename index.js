require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// Load environment vars
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// Create bot with polling
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Connect to MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Bot: MongoDB Connected"))
  .catch((err) =>
    console.error("Bot: MongoDB connection error:", err.message)
  );

// Define product schema matching your NearbyCart DB
const productSchema = new mongoose.Schema({
  productName: String,
  storeName: String,
  price: Number,           // optional
  location: String,        // optional
});

const Product = mongoose.model("Product", productSchema);

// Welcome & help commands
bot.onText(/\/start/, (msg) => {
  const text = `👋 Welcome to NearbyCart Bot!
Type like this:
search <product name>
Example: search cetaphil`;
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/help/, (msg) => {
  const text = `🛠 How to use:
• search <product name>
Example:
search cetaphil`;
  bot.sendMessage(msg.chat.id, text);
});

// Main message listener
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Only process if text actually starts with "search "
  if (!text || !text.toLowerCase().startsWith("search ")) return;

  const parts = text.split("search ");
  if (parts.length < 2 || !parts[1]) {
    bot.sendMessage(chatId, "Please type a product after `search`");
    return;
  }

  const query = parts[1].trim();

  // Now safely search in DB
  try {
    const results = await Product.find({
      productName: { $regex: query, $options: "i" },
    });

    if (!results || results.length === 0) {
      bot.sendMessage(chatId, `❌ No results found for "${query}"`);
      return;
    }

    let reply = `📍 Stores with *${query}*\n\n`;
    results.forEach((item, i) => {
      reply += `${i + 1}. ${item.storeName}\n`;
    });

    bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });

    const websiteUrl = `https://nearbycart.com/search?query=${encodeURIComponent(
      query
    )}`;
    bot.sendMessage(chatId, `🔗 More details: ${websiteUrl}`);
  } catch (err) {
    console.error("Search error:", err);
    bot.sendMessage(chatId, "⚠ Error searching products.");
  }
});
