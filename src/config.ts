import dotenv from "dotenv";

dotenv.config();

function getEnvVar(key: string, required = true): string {
    const value = process.env[key];
    if (!value && required) {
        throw new Error(`Environment variable ${key} is missing.`);
    }
    return value || "";
}

export const CONFIG = {
    TELEGRAM_BOT_TOKEN: getEnvVar("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_ALLOWED_USER_IDS: getEnvVar("TELEGRAM_ALLOWED_USER_IDS")
        .split(",")
        .map(id => parseInt(id.trim(), 10))
        .filter(id => !isNaN(id)),
    GROQ_API_KEY: getEnvVar("GROQ_API_KEY"),
    OPENROUTER_API_KEY: getEnvVar("OPENROUTER_API_KEY", false),
    OPENROUTER_MODEL: getEnvVar("OPENROUTER_MODEL", false) || "openrouter/free",
    DB_PATH: getEnvVar("DB_PATH", false) || "./memory.db",
    GOOGLE_APPLICATION_CREDENTIALS: getEnvVar("GOOGLE_APPLICATION_CREDENTIALS", false),
    ELEVENLABS_API_KEY: getEnvVar("ELEVENLABS_API_KEY", false),
    ELEVENLABS_VOICE_ID: getEnvVar("ELEVENLABS_VOICE_ID", false) || "pNInz6obpgDQGcFmaJgB",
};
