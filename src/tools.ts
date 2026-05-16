import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { jmTools, executeJmTool } from "./tools-jm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Tool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

const localTools: Tool[] = [
    {
        type: "function",
        function: {
            name: "get_current_time",
            description: "Gets the current date and time.",
            parameters: {
                type: "object",
                properties: {
                    timezone: {
                        type: "string",
                        description: "Optional timezone (e.g., 'America/New_York', 'Europe/Madrid'). Defaults to local timezone.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_skills",
            description: "Search for available AI agent skills (capabilities) in the local index.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query (e.g., 'pdf', 'git', 'auth').",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_pull_request",
            description: "Create a GitHub Pull Request for the current repository.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "PR title following conventions: <type>(<scope>): <summary>",
                    },
                    body: {
                        type: "string",
                        description: "Detailed description of changes and testing instructions.",
                    },
                    head: {
                        type: "string",
                        description: "The name of the branch where your changes are implemented.",
                    },
                    base: {
                        type: "string",
                        description: "The name of the branch you want to merge into (default: 'main').",
                    },
                },
                required: ["title", "body", "head"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_skill_content",
            description: "Retrieve the full content of a specific AI agent skill to follow its instructions.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: {
                        type: "string",
                        description: "The name of the skill (e.g., 'test-driven-development').",
                    },
                },
                required: ["skill_name"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_openscad_model",
            description: "Generate an OpenSCAD (.scad) file representing a 3D model based on a professional parametric design.",
            parameters: {
                type: "object",
                properties: {
                    scad_code: {
                        type: "string",
                        description: "The full OpenSCAD code to generate the model.",
                    },
                    filename: {
                        type: "string",
                        description: "The suggested filename for the model (e.g., 'gears.scad').",
                    },
                },
                required: ["scad_code", "filename"],
            },
        },
    },
];

// ─── Azuretradehub tools ──────────────────────────────────────────────────────
const azuretools: Tool[] = [
    {
        type: "function",
        function: {
            name: "atradehub_get_quotes",
            description: "Lista los presupuestos de Azuretradehub. Devuelve título, estado, cliente, coste total y líneas.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_create_quote",
            description: "Crea un nuevo presupuesto en Azuretradehub.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Título del presupuesto" },
                    clientName: { type: "string", description: "Nombre del cliente" },
                    notes: { type: "string", description: "Notas adicionales" },
                    lines: {
                        type: "array",
                        description: "Líneas del presupuesto",
                        items: {
                            type: "object",
                            properties: {
                                description: { type: "string" },
                                quantity: { type: "number" },
                                unit: { type: "string" },
                                unitCost: { type: "number" },
                                type: { type: "string", enum: ["BOM", "BOS"] },
                            },
                            required: ["description", "quantity", "unit"],
                        },
                    },
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_get_suppliers",
            description: "Lista los proveedores registrados con sus productos y precios.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_add_supplier",
            description: "Añade un nuevo proveedor a Azuretradehub.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Nombre del proveedor" },
                    email: { type: "string", description: "Email de contacto" },
                    phone: { type: "string" },
                    website: { type: "string" },
                    description: { type: "string" },
                },
                required: ["name", "email"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_get_rfqs",
            description: "Lista las solicitudes de presupuesto (RFQ) enviadas a proveedores y sus respuestas.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_get_memory",
            description: "Lee toda la memoria compartida: proyectos, clientes, contexto guardado por cualquier agente.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_save_memory",
            description: "Guarda o actualiza información importante en la memoria compartida para que todos los agentes la tengan. Úsala cuando el usuario comparta datos sobre proyectos, clientes, preferencias o cualquier contexto relevante.",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", description: "Identificador único del recuerdo (ej: 'proyecto_phoenix_wall', 'cliente_acme', 'proveedor_preferido_madera')" },
                    content: { type: "string", description: "Información completa a guardar en texto libre" },
                },
                required: ["key", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "atradehub_delete_memory",
            description: "Elimina un recuerdo de la memoria compartida.",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", description: "Identificador del recuerdo a eliminar" },
                },
                required: ["key"],
            },
        },
    },
];

export let toolsDefinitions: Tool[] = [
    ...localTools,
    ...(CONFIG.AZURETRADEHUB_API_KEY ? azuretools : []),
    ...(CONFIG.JM_ADMIN_SECRET ? jmTools : []),
];

export async function executeTool(name: string, args: any): Promise<any> {
    // Try local tools first
    if (name === "get_current_time") {
        const { timezone } = args;
        try {
            const date = new Date();
            if (timezone) {
                return date.toLocaleString("en-US", { timeZone: timezone });
            }
            return date.toLocaleString();
        } catch (error: any) {
            return `Error getting time: ${error.message}`;
        }
    }
    if (name === "search_skills") {
        const { query } = args;
        try {
            const indexPath = path.join(__dirname, "assets", "skill-index.json");
            const indexData = JSON.parse(fs.readFileSync(indexPath, "utf8"));
            const skills = indexData.skills || [];
            
            const results = skills.filter((s: any) => 
                s.name.toLowerCase().includes(query.toLowerCase()) || 
                s.description.toLowerCase().includes(query.toLowerCase())
            ).slice(0, 5);

            if (results.length === 0) return "No skills found matching your query.";

            return results.map((s: any) => `- **${s.name}**: ${s.description} (Source: ${s.repository})`).join("\n");
        } catch (error: any) {
            return `Error searching skills: ${error.message}`;
        }
    }

    if (name === "create_pull_request") {
        const { title, body, head, base = "main" } = args;
        if (!CONFIG.GITHUB_TOKEN) return "Error: GITHUB_TOKEN is not configured.";

        try {
            const repoFullName = "Impecable9/opengravity"; // Hardcoded for now based on context
            const response = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
                method: "POST",
                headers: {
                    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json",
                },
                body: JSON.stringify({
                    title,
                    body,
                    head,
                    base,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                return `GitHub API error: ${response.status} - ${JSON.stringify(errorData)}`;
            }

            const data = await response.json();
            return `Pull Request created successfully: ${data.html_url}`;
        } catch (error: any) {
            return `Error creating PR: ${error.message}`;
        }
    }

    if (name === "get_skill_content") {
        const { skill_name } = args;
        try {
            // First look in superpowers folder
            const superpowerPath = path.join(__dirname, "assets", "superpowers", skill_name, "SKILL.md");
            if (fs.existsSync(superpowerPath)) {
                return fs.readFileSync(superpowerPath, "utf8");
            }
            
            // Fallback: search in skill-index to find the path
            const indexPath = path.join(__dirname, "assets", "skill-index.json");
            const indexData = JSON.parse(fs.readFileSync(indexPath, "utf8"));
            const skill = indexData.skills.find((s: any) => s.name === skill_name);
            
            if (skill) {
                return `Skill found but content is not local. Source: ${skill.source}, Path: ${skill.path}. Please ask the user to provide the content if needed. Currently, only Superpowers are available locally.`;
            }

            return `Skill '${skill_name}' not found.`;
        } catch (error: any) {
            return `Error retrieving skill content: ${error.message}`;
        }
    }

    if (name === "generate_openscad_model") {
        const { scad_code, filename } = args;
        const os = await import("os");
        const path = await import("path");
        const fs = await import("fs");

        try {
            const tempDir = os.tmpdir();
            const safeFilename = filename.endsWith(".scad") ? filename : `${filename}.scad`;
            const filePath = path.join(tempDir, safeFilename);
            
            fs.writeFileSync(filePath, scad_code);
            
            return {
                status: "success",
                message: `OpenSCAD model generated successfully.`,
                filePath: filePath,
                info: "Sending file to user now..."
            };
        } catch (error: any) {
            return `Error generating OpenSCAD model: ${error.message}`;
        }
    }
    // ─── Azuretradehub tools ────────────────────────────────────────────────
    const azureBase = CONFIG.AZURETRADEHUB_URL;
    const azureKey = CONFIG.AZURETRADEHUB_API_KEY;
    const azureHeaders = { "x-api-key": azureKey, "Content-Type": "application/json" };

    if (name === "atradehub_get_quotes") {
        const res = await fetch(`${azureBase}/api/v1/quotes`, { headers: azureHeaders });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        const quotes = data.quotes ?? [];
        if (quotes.length === 0) return "No hay presupuestos aún.";
        return quotes.map((q: any) =>
            `📄 ${q.title} | ${q.status} | ${q.clientName ?? "sin cliente"} | ${q.totalCost ? q.totalCost + "€" : "sin precio"}`
        ).join("\n");
    }

    if (name === "atradehub_create_quote") {
        const res = await fetch(`${azureBase}/api/v1/quotes`, {
            method: "POST",
            headers: azureHeaders,
            body: JSON.stringify(args),
        });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        return `✅ Presupuesto creado: "${data.quote.title}" (ID: ${data.quote.id})`;
    }

    if (name === "atradehub_get_suppliers") {
        const res = await fetch(`${azureBase}/api/v1/suppliers`, { headers: azureHeaders });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        const suppliers = data.suppliers ?? [];
        if (suppliers.length === 0) return "No hay proveedores registrados.";
        return suppliers.map((s: any) =>
            `🏭 ${s.name} (${s.email}) — ${s.products?.length ?? 0} productos`
        ).join("\n");
    }

    if (name === "atradehub_add_supplier") {
        const res = await fetch(`${azureBase}/api/v1/suppliers`, {
            method: "POST",
            headers: azureHeaders,
            body: JSON.stringify(args),
        });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        return `✅ Proveedor añadido: ${data.supplier.name} (${data.supplier.email})`;
    }

    if (name === "atradehub_get_rfqs") {
        const res = await fetch(`${azureBase}/api/v1/rfq`, { headers: azureHeaders });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        const rfqs = data.rfqs ?? [];
        if (rfqs.length === 0) return "No hay RFQs enviados.";
        return rfqs.map((r: any) =>
            `📨 RFQ a ${r.supplierEmail} | ${r.status} | ${r.responses?.length ?? 0} respuestas`
        ).join("\n");
    }

    if (name === "atradehub_get_memory") {
        const res = await fetch(`${azureBase}/api/v1/memory`, { headers: azureHeaders });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        const memories = data.memories ?? [];
        if (memories.length === 0) return "La memoria compartida está vacía.";
        return memories.map((m: any) => `📝 [${m.key}]:\n${m.content}`).join("\n\n");
    }

    if (name === "atradehub_save_memory") {
        const res = await fetch(`${azureBase}/api/v1/memory`, {
            method: "POST",
            headers: azureHeaders,
            body: JSON.stringify({ key: args.key, content: args.content, source: "telegram" }),
        });
        const data = await res.json();
        if (!res.ok) return `Error: ${JSON.stringify(data)}`;
        return `✅ Guardado en memoria compartida: [${args.key}]`;
    }

    if (name === "atradehub_delete_memory") {
        const res = await fetch(`${azureBase}/api/v1/memory`, {
            method: "DELETE",
            headers: azureHeaders,
            body: JSON.stringify({ key: args.key }),
        });
        if (!res.ok) return `Error al eliminar`;
        return `🗑️ Eliminado de memoria: [${args.key}]`;
    }

    // ─── Jardín Mental tools (claudework) ──────────────────────────────────
    if (name.startsWith("jm_")) {
        return await executeJmTool(name, args);
    }

    throw new Error(`Unknown tool: ${name}`);
}
