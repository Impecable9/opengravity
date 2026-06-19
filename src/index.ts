import { bot } from "./bot.js";
import { webhookCallback } from "grammy";
import { onRequest } from "firebase-functions/v2/https";

console.log("Initializing OpenGravity Cloud Function...");

// Telegram permite hasta 60s antes de reintentar el webhook. Cloud Functions
// Gen 2 permite hasta 540s. Lo importante es alinear ambos límites con el de
// Grammy (que por defecto es 10s — demasiado bajo para nuestro flujo voz→LLM→TTS).
const HANDLER_TIMEOUT_MS = 120_000;

export const opengravity = onRequest(
    {
        secrets: ["JM_ADMIN_SECRET", "FAL_API_KEY"],
        region: "us-central1",
        // 512MiB / 1 vCPU — suficiente para LLM + TTS y dentro del free tier
        memory: "512MiB",
        cpu: 1,
        // 120s para dar margen a transcribir + LLM (con tool calls) + sintetizar voz
        timeoutSeconds: 120,
        // Cold starts ocasionales aceptables. Mantener minInstances=0 (default) para
        // estar dentro del free tier — keep-warm cuesta ~$50/mes que no necesitamos
        concurrency: 10,
    },
    webhookCallback(bot, "express", { timeoutMilliseconds: HANDLER_TIMEOUT_MS })
);
