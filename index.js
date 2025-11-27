import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder
} from "discord.js";
import axios from "axios";

// =========================================================
// ENV VARS (Render-safe neue Variable!)
// =========================================================
const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  APTIQ_BACKEND_URL_BOT,   // <— NEU!
  APTIQ_BOT_EMAIL,
  APTIQ_BOT_PASSWORD
} = process.env;

let aptiqToken = null;

// =========================================================
// LOGIN INS BACKEND
// =========================================================
async function loginToAptiQ() {
  try {
    const res = await axios.post(`${APTIQ_BACKEND_URL_BOT}/login`, {
      email: APTIQ_BOT_EMAIL,
      password: APTIQ_BOT_PASSWORD
    });

    aptiqToken = res.data.token;
    console.log("✔ AptiQ Bot erfolgreich eingeloggt");
  } catch (err) {
    console.error("❌ Fehler beim AptiQ Login:", err.response?.data || err);
  }
}

// =========================================================
// KI ANSPRECHEN
// =========================================================
async function callAptiQ(prompt) {
  if (!aptiqToken) {
    await loginToAptiQ();
  }

  try {
    const res = await axios.post(
      `${APTIQ_BACKEND_URL_BOT}/message`,
      { content: prompt },
      { headers: { Authorization: `Bearer ${aptiqToken}` } }
    );

    return res.data.reply || "Keine Antwort erhalten.";
  } catch (e) {
    if (e.response?.status === 401) {
      console.log("🔄 Token abgelaufen. Login erneut …");
      aptiqToken = null;
      return await callAptiQ(prompt);
    }

    console.error("❌ Fehler bei AptiQ:", e.response?.data || e);
    return "Fehler beim Abrufen der Antwort.";
  }
}

// =========================================================
// DISCORD CLIENT
// =========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Bot aktiv als ${client.user.tag}`);
});

// =========================================================
// HELPER – PROMPT AUS ERWÄHNUNG EXTRAHIEREN
// =========================================================
function extractPromptFromMessage(message) {
  const content = message.content
    .replace(`<@${client.user.id}>`, "")
    .replace(`<@!${client.user.id}>`, "")
    .trim();

  return content.length > 0 ? content : null;
}

// =========================================================
// PREMIUM THREAD + FOLLOW-UP
// =========================================================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDirectMention = message.mentions.has(client.user);
  const isThread = message.channel.isThread?.() || false;

  let prompt;

  // ------------------------------------------------------------------
  // 1) BOT WIRD IM NORMALEN CHANNEL ERWÄHNT → PREMIUM THREAD ERSTELLEN
  // ------------------------------------------------------------------
  if (!isThread && isDirectMention) {
    prompt = extractPromptFromMessage(message);

    if (!prompt) {
      return message.reply("Bitte schreibe eine Frage **nach** der Erwähnung 🙂");
    }

    try {
      await message.channel.sendTyping();

      const answer = await callAptiQ(prompt);

      // PREMIUM THREAD NAME
      const threadName =
        "💠 AptiQ — " + prompt.substring(0, 40).replace(/\n/g, " ") + "…";

      // THREAD ERSTELLEN
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 1440 // 24h
      });

      // PREMIUM EMBED
      const embed = new EmbedBuilder()
        .setColor(0x7f3cff)
        .setTitle("🔮 AptiQ – KI-Assistenz")
        .setDescription(answer)
        .addFields(
          { name: "📝 Frage", value: prompt },
          { name: "👤 Nutzer", value: message.author.tag }
        )
        .setFooter({ text: "NoCxAI · AptiQ" })
        .setTimestamp();

      const msg = await thread.send({ embeds: [embed] });

      await msg.pin(); // Erste Antwort pinnen
      return;
    } catch (err) {
      console.error("❌ Thread-Fehler:", err);
      return message.reply("⚠️ Beim Erstellen des KI-Threads ist etwas schiefgelaufen.");
    }
  }

  // ------------------------------------------------------------------
  // 2) FOLLOW-UP ANTWORTEN IM THREAD (OHNE ERWÄHNUNG)
  // ------------------------------------------------------------------
  if (isThread) {
    if (!message.channel.name.startsWith("💠 AptiQ")) return;

    prompt = message.content?.trim();
    if (!prompt) return;

    try {
      await message.channel.sendTyping();
      const answer = await callAptiQ(prompt);

      const embed = new EmbedBuilder()
        .setColor(0x7f3cff)
        .setTitle("🔮 AptiQ – Folgefrage")
        .setDescription(answer)
        .addFields({ name: "📝 Frage", value: prompt })
        .setFooter({ text: "NoCxAI · AptiQ" })
        .setTimestamp();

      return message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error("❌ Follow-up Fehler:", err);
      return message.channel.send("⚠️ Fehler bei der KI-Antwort.");
    }
  }
});

// =========================================================
// BOT STARTEN
// =========================================================
client.login(DISCORD_TOKEN);
