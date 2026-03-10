import { bot } from "../src/bot.js";

const WEBHOOK_URL = process.argv[2];

if (!WEBHOOK_URL) {
    console.error("Usage: npx tsx scripts/set-webhook.ts <your_firebase_function_url>");
    process.exit(1);
}

async function setWebhook() {
    try {
        console.log(`Setting webhook to: ${WEBHOOK_URL}`);
        await bot.api.setWebhook(WEBHOOK_URL);
        console.log("Webhook successfully set!");
        process.exit(0);
    } catch (error) {
        console.error("Failed to set webhook:", error);
        process.exit(1);
    }
}

setWebhook();
