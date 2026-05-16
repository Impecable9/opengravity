// ─── Tools para Jardín Mental — admin API de claudework ────────────────────
// Llaman a menteraiz.vercel.app/api/admin/social/* con X-Admin-Secret bypass

import { CONFIG } from "./config.js";
import type { Tool } from "./tools.js";

const BASE = () => CONFIG.JM_API_BASE_URL.replace(/\/+$/, "");
const SECRET = () => CONFIG.JM_ADMIN_SECRET;

function jmHeaders() {
    if (!SECRET()) throw new Error("JM_ADMIN_SECRET no está configurado en el .env de OPENGRAVITY");
    return {
        "Content-Type": "application/json",
        "X-Admin-Secret": SECRET(),
    };
}

// ─── Tool definitions ─────────────────────────────────────────────────────
export const jmTools: Tool[] = [
    {
        type: "function",
        function: {
            name: "jm_create_social_draft",
            description: "Crea un borrador (draft) en /admin/claudework de Jardín Mental para Instagram. Genera además el preview link público compartible (URL que el usuario abre desde el móvil o PC para ver cómo queda el post real). Devuelve { draft_id, preview_url, expires }. Úsalo después de generar imágenes y copy para un post de IG.",
            parameters: {
                type: "object",
                properties: {
                    format: {
                        type: "string",
                        enum: ["single-image", "carousel", "reel", "story"],
                        description: "Formato IG. Carousel necesita 2-10 imágenes; los demás 1.",
                    },
                    topic: { type: "string", description: "Tema interno corto, ej: 'ansiedad-silenciosa-señal-1'" },
                    caption: { type: "string", description: "Caption completa del post (sin hashtags, máx 2200 chars). Incluye hook, cuerpo y CTA." },
                    hashtags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Hashtags sin el símbolo '#'. Máx 30. Ejemplo: ['ansiedad', 'saludmental']",
                    },
                    image_urls: {
                        type: "array",
                        items: { type: "string" },
                        description: "URLs públicas (R2) de las imágenes ya subidas. Para single-image y reel: 1 imagen. Carousel: 2-10.",
                    },
                    video_url: { type: "string", description: "URL del vídeo si es reel (opcional)." },
                    scheduled_for: {
                        type: "string",
                        description: "Fecha ISO 8601 cuándo publicar (ej '2026-05-17T09:00:00.000Z'). Si no se especifica, se programa mañana a las 09:00 Madrid.",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Tags jm-taste (taxonomía interna). Ej: ['rabbit', 'verde-profundo', 'dorado']",
                    },
                    product_slug: { type: "string", description: "Slug del ebook que promociona, si aplica. Ej: 'ansiedad-silenciosa'." },
                    generation_cost_eur: { type: "number", description: "Coste total de las imágenes + APIs en EUR. Se descuenta del budget diario." },
                },
                required: ["format", "caption", "image_urls"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_get_preview_link",
            description: "Regenera o consulta el preview link público de un draft existente. Caduca a los 7 días.",
            parameters: {
                type: "object",
                properties: {
                    draft_id: { type: "string", description: "ID del draft" },
                    regenerate: { type: "boolean", description: "Si true, fuerza un nuevo token (revoca el anterior)." },
                },
                required: ["draft_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_list_drafts",
            description: "Lista los drafts de claudework. Por defecto los pendientes de revisión. Devuelve también el estado del circuit breaker (budget diario, si está pausado).",
            parameters: {
                type: "object",
                properties: {
                    status: {
                        type: "string",
                        enum: ["all", "draft", "pending-review", "approved", "publishing", "published", "rejected", "failed"],
                        description: "Filtrar por estado. 'all' devuelve todos.",
                    },
                    limit: { type: "number", description: "Máx resultados (default 20)" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_approve_draft",
            description: "Aprueba un draft de claudework (lo marca approved y queda programado para publicación según scheduled_for).",
            parameters: {
                type: "object",
                properties: {
                    draft_id: { type: "string" },
                    scheduled_for: { type: "string", description: "Opcional: nueva fecha ISO si quieres reprogramar al aprobar." },
                },
                required: ["draft_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_reject_draft",
            description: "Rechaza un draft de claudework. Suma a 'consecutive_rejections' del circuit breaker.",
            parameters: {
                type: "object",
                properties: {
                    draft_id: { type: "string" },
                    reason: { type: "string", description: "Motivo del rechazo (opcional pero recomendado)." },
                },
                required: ["draft_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_publish_now",
            description: "Publica un draft inmediatamente en Instagram (salta la programación). Solo funciona si el draft está en pending-review o approved. Requiere que el token IG esté vigente.",
            parameters: {
                type: "object",
                properties: {
                    draft_id: { type: "string" },
                },
                required: ["draft_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_diagnose_ig",
            description: "Verifica el estado de conexión con Instagram: token vigente, scopes, cuenta vinculada. Útil cuando una publicación falla.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "jm_circuit_state",
            description: "Devuelve el estado del circuit breaker de claudework: si está pausado, budget gastado hoy, último error.",
            parameters: { type: "object", properties: {} },
        },
    },
];

// ─── Helpers de scheduling ────────────────────────────────────────────────
function defaultScheduledFor(): string {
    // Mañana a las 09:00 hora Madrid (CET/CEST)
    const d = new Date();
    d.setDate(d.getDate() + 1);
    // Madrid es UTC+1 (invierno) o UTC+2 (verano). Marcamos 09:00 Madrid → 07:00/08:00 UTC.
    // Sencillo: 08:00 UTC siempre (mañana) — son las 09:00 o 10:00 Madrid según DST.
    d.setUTCHours(8, 0, 0, 0);
    return d.toISOString();
}

// ─── Executor ─────────────────────────────────────────────────────────────
export async function executeJmTool(name: string, args: any): Promise<any> {
    if (!CONFIG.JM_ADMIN_SECRET) {
        return "Error: JM_ADMIN_SECRET no está configurado. Añádelo al .env de OPENGRAVITY (debe coincidir con el ADMIN_SECRET del proyecto Vercel jardinmental.com).";
    }

    if (name === "jm_create_social_draft") {
        const body = {
            format: args.format,
            topic: args.topic ?? `${args.format} jarvis`,
            caption: args.caption,
            hashtags: (args.hashtags ?? []).map((h: string) => h.replace(/^#/, "")),
            image_urls: args.image_urls ?? [],
            video_url: args.video_url ?? null,
            tags: args.tags ?? [],
            product_slug: args.product_slug ?? null,
            scheduled_for: args.scheduled_for ?? defaultScheduledFor(),
            generation_cost_eur: args.generation_cost_eur ?? 0,
            created_by: "system",
        };

        const r = await fetch(`${BASE()}/api/admin/social`, {
            method: "POST",
            headers: jmHeaders(),
            body: JSON.stringify(body),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error creando draft: ${j.error ?? r.status}`;
        const draftId = j.draft?.id;
        if (!draftId) return `Draft creado pero sin id en la respuesta: ${JSON.stringify(j)}`;

        // Genera preview link
        const linkRes = await fetch(`${BASE()}/api/admin/social/${draftId}/preview-link`, {
            method: "POST",
            headers: jmHeaders(),
        });
        const linkJson: any = await linkRes.json().catch(() => ({}));
        if (!linkRes.ok) {
            return `Draft creado (id: ${draftId}) pero falló el preview link: ${linkJson.error ?? linkRes.status}`;
        }

        return {
            draft_id: draftId,
            preview_url: linkJson.url,
            expires: linkJson.expires,
            status: j.draft.status,
            scheduled_for: j.draft.scheduled_for,
            summary: `✅ Draft ${draftId.slice(0, 8)} creado · ${args.format} · ${args.image_urls?.length ?? 0} imagen(es)\n🔗 Preview: ${linkJson.url}`,
        };
    }

    if (name === "jm_get_preview_link") {
        const { draft_id, regenerate } = args;
        const method = regenerate ? "POST" : "GET";
        const r = await fetch(`${BASE()}/api/admin/social/${draft_id}/preview-link`, {
            method,
            headers: jmHeaders(),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error: ${j.error ?? r.status}`;
        if (!j.url) return `El draft no tiene preview link activo (expirado o nunca generado). Usa regenerate=true para crear uno nuevo.`;
        return { preview_url: j.url, expires: j.expires };
    }

    if (name === "jm_list_drafts") {
        const status = args.status && args.status !== "all" ? args.status : undefined;
        const url = status
            ? `${BASE()}/api/admin/social?status=${encodeURIComponent(status)}`
            : `${BASE()}/api/admin/social`;
        const r = await fetch(url, { headers: jmHeaders() });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error: ${j.error ?? r.status}`;
        const limit = args.limit ?? 20;
        const drafts = (j.drafts ?? []).slice(0, limit);
        const compact = drafts.map((d: any) => ({
            id: d.id,
            status: d.status,
            format: d.format,
            topic: d.topic,
            caption_preview: (d.caption ?? "").slice(0, 80) + ((d.caption ?? "").length > 80 ? "..." : ""),
            scheduled_for: d.scheduled_for,
            has_preview_link: !!d.public_preview_token,
        }));
        return { drafts: compact, total: drafts.length, circuit: j.circuit };
    }

    if (name === "jm_approve_draft") {
        const { draft_id, scheduled_for } = args;
        const body: any = { action: "approve" };
        if (scheduled_for) body.scheduled_for = scheduled_for;
        const r = await fetch(`${BASE()}/api/admin/social/${draft_id}`, {
            method: "PATCH",
            headers: jmHeaders(),
            body: JSON.stringify(body),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error aprobando: ${j.error ?? r.status}`;
        return `✅ Draft ${draft_id.slice(0, 8)} aprobado. Estado: ${j.draft.status} · publicará: ${j.draft.scheduled_for}`;
    }

    if (name === "jm_reject_draft") {
        const { draft_id, reason } = args;
        const r = await fetch(`${BASE()}/api/admin/social/${draft_id}`, {
            method: "PATCH",
            headers: jmHeaders(),
            body: JSON.stringify({ action: "reject", reason: reason ?? "" }),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error rechazando: ${j.error ?? r.status}`;
        return `❌ Draft ${draft_id.slice(0, 8)} rechazado.`;
    }

    if (name === "jm_publish_now") {
        const { draft_id } = args;
        const r = await fetch(`${BASE()}/api/admin/social/${draft_id}`, {
            method: "PATCH",
            headers: jmHeaders(),
            body: JSON.stringify({ action: "publish-now" }),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error publicando: ${j.error ?? r.status}`;
        return `🚀 Publicado en IG. media_id: ${j.draft.ig_media_id ?? "—"}`;
    }

    if (name === "jm_diagnose_ig") {
        const r = await fetch(`${BASE()}/api/admin/social/diagnose`, { headers: jmHeaders() });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error diagnose: ${j.error ?? r.status}`;
        return {
            verdict: j.verdict,
            ok: j.ok,
            account: j.ig?.account?.username,
            token_expires: j.token?.expires_at,
            missing_scopes: j.token?.missing_scopes,
        };
    }

    if (name === "jm_circuit_state") {
        const r = await fetch(`${BASE()}/api/admin/social`, { headers: jmHeaders() });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return `Error: ${j.error ?? r.status}`;
        return j.circuit;
    }

    throw new Error(`Unknown JM tool: ${name}`);
}
