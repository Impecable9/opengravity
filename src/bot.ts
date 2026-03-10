import { Bot, Context, InputFile } from "grammy";
import { hydrateFiles, FileFlavor } from "@grammyjs/files";
import { CONFIG } from "./config.js";
import { runAgentLoop } from "./agent.js";
import { transcribeAudio, synthesizeSpeech } from "./llm.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

type MyContext = FileFlavor<Context>;

// Initialize the bot
export const bot = new Bot<MyContext>(CONFIG.TELEGRAM_BOT_TOKEN);

// Enable Grammy files plugin (gives Telegram API URL for downloads)
bot.api.config.use(hydrateFiles(bot.token));

// Security Middleware: Whitelist allowed users
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !CONFIG.TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
        if (userId) {
            console.warn(`Unauthorized access attempt from user ID: ${userId}`);
        }
        // Silently drop the message
        return;
    }
    // They are whitelisted, continue
    await next();
});

bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    try {
        await ctx.replyWithChatAction("typing");
        const finalReply = await runAgentLoop(userId, userMessage);
        await ctx.reply(finalReply);
    } catch (error: any) {
        console.error("Agent error:", error);
        await ctx.reply("Sorry, I encountered an error while processing your request.");
    }
});

// Handle Voice Messages
bot.on("message:voice", async (ctx) => {
    const userId = ctx.from.id;
    let tempPath: string | null = null;
    
    try {
        await ctx.replyWithChatAction("typing");
        
        // 1. Get the file from Telegram servers
        const voiceFile = await ctx.getFile();
        
        // 2. Download the voice file to an OS temporary path
        tempPath = path.join(os.tmpdir(), `${voiceFile.file_id}.ogg`);
        await voiceFile.download(tempPath);
        
        // 3. Transcribe with Whisper
        const transcribedText = await transcribeAudio(tempPath);
        console.log(`User ${userId} voice note transcribed: "${transcribedText}"`);
        
        if (!transcribedText || !transcribedText.trim()) {
            await ctx.reply("No pude entender el audio o está vacío.");
            return;
        }

        // 4. Pass the text to our standard Agent Loop
        const finalReply = await runAgentLoop(userId, transcribedText);
        
        // 5. Synthesize the agent's reply back to voice
        const responseAudioPath = path.join(os.tmpdir(), `reply_${voiceFile.file_id}.mp3`);
        await synthesizeSpeech(finalReply, responseAudioPath);
        
        // 6. Send voice reply
        await ctx.replyWithVoice(new InputFile(responseAudioPath));
        
        // Clean up response audio
        if (fs.existsSync(responseAudioPath)) {
            fs.unlinkSync(responseAudioPath);
        }
        
    } catch (error: any) {
        console.error("Voice processing error:", error.message);
        await ctx.reply("Sorry, error processing the voice message.");
    } finally {
        // Always clean up the local temp file to avoid taking up disk space
        if (tempPath && fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
});

// Setup error handler
bot.catch((err) => {
    console.error("Bot error:", err);
});
