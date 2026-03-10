import { Groq } from "groq-sdk";
import * as fs from "fs";
import { Communicate } from "edge-tts-universal";
import OpenAI from "openai";
import { CONFIG } from "./config.js";
import { toolsDefinitions } from "./tools.js";

const groq = new Groq({ apiKey: CONFIG.GROQ_API_KEY });
let openrouter: OpenAI | null = null;

if (CONFIG.OPENROUTER_API_KEY) {
    openrouter = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: CONFIG.OPENROUTER_API_KEY,
    });
}

export async function chatCompletion(messages: any[]) {
    try {
        // Try Groq first with llama-3.3-70b-versatile
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages,
            tools: toolsDefinitions,
            tool_choice: "auto",
        });
        return response.choices[0].message;
    } catch (error: any) {
        console.error("Groq API error:", error.message);
        console.log("Attempting OpenRouter fallback...");

        if (!openrouter) {
            throw new Error("Groq API failed and OpenRouter is not configured.");
        }

        try {
            const response = await openrouter.chat.completions.create({
                model: CONFIG.OPENROUTER_MODEL,
                messages,
                tools: toolsDefinitions as any, // OpenAI types might slightly differ but structure is same
                tool_choice: "auto",
            });
            return response.choices[0].message;
        } catch (orError: any) {
            console.error("OpenRouter API error:", orError.message);
            throw new Error(`Both Groq and OpenRouter failed.`);
        }
    }
}

export async function transcribeAudio(filePath: string): Promise<string> {
    try {
        console.log(`Transcribing audio: ${filePath}`);
        
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3",
        });
        
        console.log("Transcription result:", JSON.stringify(transcription));
        
        const text = transcription.text || (transcription as any).text;
        return text || "";
    } catch (error: any) {
        console.error("Groq Whisper API error details:", error);
        throw new Error(`Failed to transcribe audio message: ${error.message}`);
    }
}

export async function synthesizeSpeech(text: string, outputPath: string): Promise<void> {
    try {
        console.log(`Synthesizing speech with Edge TTS to: ${outputPath}`);
        
        const communicate = new Communicate(text, {
            voice: "es-ES-AlvaroNeural",
        });

        const writable = fs.createWriteStream(outputPath);
        
        for await (const chunk of communicate.stream()) {
            if (chunk.type === "audio" && chunk.data) {
                writable.write(chunk.data);
            }
        }
        
        writable.end();

        return new Promise((resolve, reject) => {
            writable.on("finish", resolve);
            writable.on("error", reject);
        });
    } catch (error: any) {
        console.error("Edge TTS error details:", error);
        throw new Error(`Failed to synthesize speech with Edge TTS: ${error.message}`);
    }
}
