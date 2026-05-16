// ─── Tools de generación de imágenes ──────────────────────────────────────
// Genera con fal.ai → sube a R2 vía endpoint /api/admin/social/upload de JM
// → devuelve URL pública lista para usar en jm_create_social_draft

import { CONFIG } from "./config.js";
import type { Tool } from "./tools.js";

const FAL_BASE = "https://fal.run";

// Tamaños fal estándar
type FalImageSize = "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";

function aspectRatioToFalSize(ratio?: string): FalImageSize {
    switch (ratio) {
        case "1:1":  return "square_hd";
        case "4:5":
        case "3:4":  return "portrait_4_3";
        case "9:16": return "portrait_16_9";
        case "16:9": return "landscape_16_9";
        case "4:3":  return "landscape_4_3";
        default:     return "square_hd";
    }
}

// ─── Tool defs ─────────────────────────────────────────────────────────────
export const imageTools: Tool[] = [
    {
        type: "function",
        function: {
            name: "generate_image_flux",
            description:
                "Genera una imagen con fal.ai Flux schnell (rápido, ~5s, ~$0.003). Devuelve URL pública R2 lista para usar en jm_create_social_draft. Para imágenes con la estética Burton/Alice de Jardín Mental usa MEJOR generate_image_mj (Midjourney captura mejor el painterly cinematográfico).",
            parameters: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Prompt en inglés natural describiendo la imagen. Sé concreto: sujeto, estilo, paleta, iluminación, encuadre.",
                    },
                    aspect_ratio: {
                        type: "string",
                        enum: ["1:1", "3:4", "4:5", "9:16", "16:9", "4:3"],
                        description: "Aspect ratio. 1:1 single IG, 4:5 carrusel IG, 9:16 reel/story, 16:9 landscape.",
                    },
                    upload_to_r2: {
                        type: "boolean",
                        description: "Si true (default), sube la imagen a R2 y devuelve URL persistente. Si false, devuelve la URL temporal de fal.ai (que caduca en horas).",
                    },
                },
                required: ["prompt"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_image_kontext",
            description:
                "Genera una imagen con fal.ai Flux Kontext usando una imagen de referencia (ej: mockup 3D del ebook integrado en escena). Coste ~$0.04. Útil para crear ads de producto donde el ebook tiene que aparecer naturalmente en una escena fotorrealista.",
            parameters: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Prompt en inglés natural describiendo la escena. Describe entorno + iluminación + atmósfera; mantén el sujeto de referencia natural.",
                    },
                    reference_image_url: {
                        type: "string",
                        description: "URL pública de la imagen de referencia (mockup 3D del ebook, etc).",
                    },
                    aspect_ratio: {
                        type: "string",
                        enum: ["1:1", "3:4", "4:5", "9:16", "16:9", "4:3"],
                    },
                    upload_to_r2: {
                        type: "boolean",
                        description: "Default true.",
                    },
                },
                required: ["prompt", "reference_image_url"],
            },
        },
    },
];

// ─── Helper: subir buffer a R2 via JM ──────────────────────────────────────
async function uploadImageBufferToR2(buffer: ArrayBuffer, filename: string): Promise<string | null> {
    if (!CONFIG.JM_ADMIN_SECRET) {
        console.warn("[image] JM_ADMIN_SECRET no configurado — no se puede subir a R2");
        return null;
    }
    const base = CONFIG.JM_API_BASE_URL.replace(/\/+$/, "");
    const fd = new FormData();
    const blob = new Blob([buffer], { type: "image/jpeg" });
    fd.append("file", blob, filename);
    const r = await fetch(`${base}/api/admin/social/upload`, {
        method: "POST",
        headers: {
            "X-Admin-Secret": CONFIG.JM_ADMIN_SECRET,
        },
        body: fd,
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.urls?.length) {
        console.error("[image] upload to R2 failed:", r.status, j);
        return null;
    }
    return j.urls[0];
}

// ─── Helper: descargar URL temporal a buffer ────────────────────────────────
async function downloadImage(url: string): Promise<ArrayBuffer> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);
    return await r.arrayBuffer();
}

// ─── Executor ──────────────────────────────────────────────────────────────
export async function executeImageTool(name: string, args: any): Promise<any> {
    if (!CONFIG.FAL_API_KEY) {
        return "Error: FAL_API_KEY no está configurada. Añádela como secret en Firebase Functions (firebase functions:secrets:set FAL_API_KEY).";
    }

    if (name === "generate_image_flux") {
        const { prompt, aspect_ratio, upload_to_r2 = true } = args;
        const image_size = aspectRatioToFalSize(aspect_ratio);

        console.log(`[flux] generating: ${prompt.slice(0, 80)}... (${image_size})`);
        const r = await fetch(`${FAL_BASE}/fal-ai/flux/schnell`, {
            method: "POST",
            headers: {
                "Authorization": `Key ${CONFIG.FAL_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt,
                image_size,
                num_images: 1,
                num_inference_steps: 4,
                enable_safety_checker: true,
            }),
        });

        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error fal.ai Flux: ${r.status} — ${JSON.stringify(j).slice(0, 200)}`;
        const tempUrl = j.images?.[0]?.url;
        if (!tempUrl) return `fal.ai respondió sin imagen: ${JSON.stringify(j).slice(0, 200)}`;

        if (!upload_to_r2) {
            return { image_url: tempUrl, model: "flux-schnell", note: "URL temporal — caduca en horas. Sube a R2 con upload_to_r2=true." };
        }

        try {
            const buf = await downloadImage(tempUrl);
            const filename = `jarvis-flux-${Date.now()}.jpg`;
            const r2url = await uploadImageBufferToR2(buf, filename);
            if (!r2url) return { image_url: tempUrl, warning: "Generada pero subida a R2 falló. Usa la URL temporal pronto." };
            return {
                image_url: r2url,
                model: "flux-schnell",
                aspect_ratio: aspect_ratio ?? "1:1",
                cost_eur: 0.003,
                summary: `✅ Imagen generada (Flux schnell)\n🔗 ${r2url}`,
            };
        } catch (e: any) {
            return { image_url: tempUrl, warning: `Subida R2 falló: ${e?.message ?? e}. URL temporal disponible.` };
        }
    }

    if (name === "generate_image_kontext") {
        const { prompt, reference_image_url, aspect_ratio, upload_to_r2 = true } = args;

        console.log(`[kontext] generating with ref: ${reference_image_url.slice(0, 80)}...`);
        const r = await fetch(`${FAL_BASE}/fal-ai/flux-pro/kontext`, {
            method: "POST",
            headers: {
                "Authorization": `Key ${CONFIG.FAL_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt,
                image_url: reference_image_url,
                aspect_ratio: aspect_ratio ?? "1:1",
                num_images: 1,
                guidance_scale: 4,
                safety_tolerance: "5",
            }),
        });

        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error fal.ai Kontext: ${r.status} — ${JSON.stringify(j).slice(0, 300)}`;
        const tempUrl = j.images?.[0]?.url;
        if (!tempUrl) return `Kontext respondió sin imagen: ${JSON.stringify(j).slice(0, 200)}`;

        if (!upload_to_r2) {
            return { image_url: tempUrl, model: "flux-kontext" };
        }

        try {
            const buf = await downloadImage(tempUrl);
            const filename = `jarvis-kontext-${Date.now()}.jpg`;
            const r2url = await uploadImageBufferToR2(buf, filename);
            if (!r2url) return { image_url: tempUrl, warning: "Generada pero subida R2 falló." };
            return {
                image_url: r2url,
                model: "flux-kontext",
                aspect_ratio: aspect_ratio ?? "1:1",
                cost_eur: 0.04,
                summary: `✅ Imagen generada (Flux Kontext)\n🔗 ${r2url}`,
            };
        } catch (e: any) {
            return { image_url: tempUrl, warning: `Subida R2 falló: ${e?.message ?? e}` };
        }
    }

    throw new Error(`Unknown image tool: ${name}`);
}
