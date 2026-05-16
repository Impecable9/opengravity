import { bot } from "./bot.js";
import { webhookCallback } from "grammy";
import { onRequest } from "firebase-functions/v2/https";

console.log("Initializing OpenGravity Cloud Function...");

// Create a v2 HTTPS function to receive Telegram webhooks
export const opengravity = onRequest(
    {
        secrets: ["JM_ADMIN_SECRET", "JM_API_BASE_URL"],
        region: "us-central1",
    },
    webhookCallback(bot, "express")
);
