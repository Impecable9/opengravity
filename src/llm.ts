import { Groq } from "groq-sdk";
import Anthropic from "@anthropic-ai/sdk";
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

// Convierte tools de formato OpenAI a formato Anthropic
function toAnthropicTools(tools: any[]): Anthropic.Tool[] {
    return tools
        .filter(t => t.type === "function")
        .map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
        }));
}

// Convierte historial OpenAI → Anthropic manejando tool calls y tool results
function toAnthropicMessages(messages: any[]): { system: string; msgs: Anthropic.MessageParam[] } {
    const system = messages.find(m => m.role === "system")?.content ?? "";
    const msgs: Anthropic.MessageParam[] = [];

    for (const m of messages) {
        if (m.role === "system") continue;

        if (m.role === "user") {
            msgs.push({ role: "user", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
        } else if (m.role === "assistant") {
            if (m.tool_calls?.length) {
                // Mensaje de assistant con tool call
                msgs.push({
                    role: "assistant",
                    content: m.tool_calls.map((tc: any) => ({
                        type: "tool_use",
                        id: tc.id,
                        name: tc.function.name,
                        input: JSON.parse(tc.function.arguments || "{}"),
                    })),
                });
            } else {
                msgs.push({ role: "assistant", content: m.content ?? "" });
            }
        } else if (m.role === "tool") {
            // Resultado de tool — va como mensaje user con tool_result
            msgs.push({
                role: "user",
                content: [{
                    type: "tool_result",
                    tool_use_id: m.tool_call_id,
                    content: m.content,
                }],
            });
        }
    }

    return { system, msgs };
}

async function claudeCompletion(messages: any[]): Promise<any> {
    const client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
    const { system, msgs } = toAnthropicMessages(messages);

    const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system,
        messages: msgs,
        tools: toAnthropicTools(toolsDefinitions),
    });

    // Convertir respuesta Anthropic → formato OpenAI que espera agent.ts
    if (response.stop_reason === "tool_use") {
        const toolUse = response.content.find((b: any) => b.type === "tool_use") as any;
        return {
            content: null,
            tool_calls: [{
                id: toolUse.id,
                type: "function",
                function: {
                    name: toolUse.name,
                    arguments: JSON.stringify(toolUse.input),
                },
            }],
        };
    }

    const text = response.content.find((b: any) => b.type === "text") as any;
    return { content: text?.text ?? "", tool_calls: null };
}

export async function chatCompletion(messages: any[]) {
    const hasImage = messages.some(m =>
        Array.isArray(m.content) && m.content.some((c: any) => c.type === "image_url")
    );

    // 1. Primary: Groq (fast, free)
    if (!hasImage) {
        try {
            const model = "llama-3.3-70b-versatile";
            console.log(`[LLM] Using Groq: ${model}`);
            const response = await groq.chat.completions.create({
                model,
                messages,
                tools: toolsDefinitions,
                tool_choice: "auto",
            });
            return response.choices[0].message;
        } catch (groqError: any) {
            console.error("[LLM] Groq failed:", groqError.message);

            // 2. Fallback: Claude (if configured)
            if (CONFIG.ANTHROPIC_API_KEY) {
                try {
                    console.log("[LLM] Falling back to Claude claude-3-5-sonnet-20241022");
                    return await claudeCompletion(messages);
                } catch (claudeError: any) {
                    console.error("[LLM] Claude failed:", claudeError.message);
                }
            }

            // 3. Last resort: OpenRouter
            if (openrouter) {
                try {
                    console.log(`[LLM] Falling back to OpenRouter: ${CONFIG.OPENROUTER_MODEL}`);
                    const response = await openrouter.chat.completions.create({
                        model: CONFIG.OPENROUTER_MODEL,
                        messages,
                        tools: toolsDefinitions as any,
                        tool_choice: "auto",
                    });
                    return response.choices[0].message;
                } catch (orError: any) {
                    throw new Error(`All LLMs failed. Groq: ${groqError.message}. OpenRouter: ${orError.message}`);
                }
            }

            throw new Error(`All LLMs failed. Groq: ${groqError.message}`);
        }
    }

    // For images: use Groq vision model
    try {
        const model = CONFIG.GROQ_VISION_MODEL;
        console.log(`[LLM] Using Groq Vision: ${model}`);
        const response = await groq.chat.completions.create({
            model,
            messages,
            tools: toolsDefinitions,
            tool_choice: "auto",
        });
        return response.choices[0].message;
    } catch (error: any) {
        throw new Error(`Groq Vision failed: ${error.message}`);
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

// ─── ElevenLabs TTS (primary) ─────────────────────────────────────────────
async function synthesizeWithElevenLabs(text: string, outputPath: string): Promise<void> {
    const voiceId = CONFIG.ELEVENLABS_VOICE_ID;
    const apiKey = CONFIG.ELEVENLABS_API_KEY;

    console.log(`Synthesizing speech with ElevenLabs voice ${voiceId} to: ${outputPath}`);

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`, {
        method: "POST",
        headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.2,
                use_speaker_boost: true,
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "(no body)");
        throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 300)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuf));
}

// ─── Edge TTS (fallback gratis) ───────────────────────────────────────────
async function synthesizeWithEdgeTTS(text: string, outputPath: string): Promise<void> {
    console.log(`[fallback] Synthesizing with Edge TTS (Alvaro) to: ${outputPath}`);

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
    await new Promise<void>((resolve, reject) => {
        writable.on("finish", () => resolve());
        writable.on("error", reject);
    });
}

export async function synthesizeSpeech(text: string, outputPath: string): Promise<void> {
    // Primary: ElevenLabs (mejor calidad, voz Jarvis configurable via ELEVENLABS_VOICE_ID)
    if (CONFIG.ELEVENLABS_API_KEY && CONFIG.ELEVENLABS_VOICE_ID) {
        try {
            await synthesizeWithElevenLabs(text, outputPath);
            return;
        } catch (err: any) {
            console.error("[TTS] ElevenLabs failed, falling back to Edge TTS:", err.message);
        }
    }

    // Fallback: Edge TTS (Microsoft, gratis)
    try {
        await synthesizeWithEdgeTTS(text, outputPath);
    } catch (err: any) {
        console.error("Edge TTS error details:", err);
        throw new Error(`Both TTS providers failed. Last error: ${err.message}`);
    }
}
