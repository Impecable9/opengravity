import { bot } from "./bot.js";
import { webhookCallback } from "grammy";
import { onRequest } from "firebase-functions/v2/https";

console.log("Initializing OpenGravity Cloud Function...");

// Create a v2 HTTPS function to receive Telegram webhooks
export const opengravity = onRequest(
    {
        // JM_ADMIN_SECRET es realmente secreto → Secret Manager.
        // JM_API_BASE_URL es público (URL admin) → variable de entorno normal (.env).
        secrets: ["JM_ADMIN_SECRET"],
        region: "us-central1",
    },
    webhookCallback(bot, "express")
);
