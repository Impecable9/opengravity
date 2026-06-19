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
    GITHUB_TOKEN: getEnvVar("GITHUB_TOKEN", false),
    GROQ_VISION_MODEL: getEnvVar("GROQ_VISION_MODEL", false) || "llama-3.2-90b-vision-preview",
    AZURETRADEHUB_URL: getEnvVar("AZURETRADEHUB_URL", false) || "https://azuretradehub.com",
    AZURETRADEHUB_API_KEY: getEnvVar("AZURETRADEHUB_API_KEY", false),
    ANTHROPIC_API_KEY: getEnvVar("ANTHROPIC_API_KEY", false),
    // Jardín Mental admin API — para crear drafts en /admin/claudework
    // Base apunta a menteraiz.vercel.app (admin del .com) porque .es tiene DISABLE_ADMIN=true
    JM_API_BASE_URL: getEnvVar("JM_API_BASE_URL", false) || "https://menteraiz.vercel.app",
    JM_ADMIN_SECRET: getEnvVar("JM_ADMIN_SECRET", false),
    // Image generation
    FAL_API_KEY: getEnvVar("FAL_API_KEY", false),
    MUAPI_API_KEY: getEnvVar("MUAPI_API_KEY", false),
};
