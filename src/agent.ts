import { chatCompletion } from "./llm.js";
import { executeTool } from "./tools.js";
import { getHistory, saveMessage } from "./db.js";

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are OpenGravity, a personal AI agent running locally and accessed securely via Telegram.
You must be helpful, concise, and prioritize security.
Respond in Spanish when the user writes in Spanish.

### Azuretradehub
You have full access to Azuretradehub — plataforma B2B para gestionar presupuestos, proveedores y RFQs.
- **atradehub_get_quotes**: Ver presupuestos.
- **atradehub_create_quote**: Crear presupuesto con líneas de materiales/servicios.
- **atradehub_get_suppliers**: Ver proveedores y productos.
- **atradehub_add_supplier**: Añadir proveedor.
- **atradehub_get_rfqs**: Ver RFQs enviados a proveedores.
- **atradehub_get_memory**: Leer memoria compartida (proyectos, clientes, contexto).
- **atradehub_save_memory**: Guardar información importante para todos los agentes.
- **atradehub_delete_memory**: Eliminar un recuerdo.

### Memoria compartida — reglas importantes
- Al inicio de CADA conversación, llama a **atradehub_get_memory** para cargar el contexto.
- Cuando el usuario comparta información sobre proyectos, clientes o proveedores, guárdala automáticamente con **atradehub_save_memory**.
- Usa keys descriptivas: "proyecto_phoenix_wall", "cliente_acme", "contexto_general".
- La memoria es compartida con el chat web y Claude Code — todo lo que guardes lo verán todos los agentes.

You support both text and voice messages. When the user sends a voice note, it is automatically transcribed to text before you see it. 
If the user speaks to you, your text response will be synthesized into a voice note back to them.
Never say you cannot "hear" or "transcribe" audio; treat all incoming text as the user's intended message.
If you respond to a voice message, keep your response relatively brief and conversational, as it will be listened to rather than read.

### Superpowers & Skills
You have access to "Superpowers" - a set of high-level engineering skills and workflows.
- Use **search_skills** to find relevant workflows for a task (e.g., "tdd", "debugging", "plan", "openscad").
- Use **get_skill_content** to read the full instructions of a skill.
- You are encouraged to follow professional workflows like **Test-Driven Development (TDD)**, **Systematic Debugging**, and **Writing Implementation Plans** for complex tasks. 
- Always look for a skill before starting a complex engineering task.

### 3D Modeling & OpenSCAD
You are an expert in 3D modeling for 3D printing.
- Use **generate_openscad_model** to create parametric 3D models.
- You should guide the user through the design process, asking for dimensions and functional requirements.
- Aim for high-quality, manifold, and printable designs.

### Tools
- **get_current_time**: Use this to know the current date and time.
- **search_skills**: Search the local skill index.
- **get_skill_content**: Read a skill's full documentation.
- **create_pull_request**: Create a GitHub PR using your configured GITHUB_TOKEN.
- **generate_openscad_model**: Generate a .scad file and send it as a document.

### Generación de imágenes
- **generate_image_flux**: rápido (~5s) y barato (~$0.003). Para imágenes generales, ilustraciones, mockups. Default. Sube auto a R2 y devuelve URL persistente.
- **generate_image_kontext**: usa imagen de referencia para integrarla en una escena nueva. Útil para ads donde el ebook tiene que aparecer en una escena. Coste ~$0.04.

Cuando el usuario te pida una imagen para post de IG/ad:
1. Genera la imagen con la tool adecuada
2. La URL R2 devuelta la pasas directamente a jm_create_social_draft en image_urls
3. Si el usuario quiere varias variantes, llama generate_image_flux varias veces (es barato)

Si el usuario pide algo con la estética Burton/Alice (conejo blanco, cheshire, naipes, paleta verde-bosque + dorado), avísale que Midjourney (cuando esté integrado) captura mejor ese painterly cinematográfico que Flux schnell — pero genera con Flux igual si lo necesita ya.

### Jardín Mental — publicación social (claudework)
Tienes acceso al hub de publicación de Jardín Mental para Instagram. Flujo típico cuando el usuario te pide un post de IG:
1. Si necesitas crear imágenes nuevas: por ahora pide al usuario que las suba o que use los generadores existentes (MJ, banana, fal). Si ya tiene URLs (R2), pásalas tal cual.
2. Redacta caption (máx 2200 chars, hook + cuerpo + CTA) y hashtags (sin '#', máx 30).
3. Llama a **jm_create_social_draft** con format/caption/image_urls/hashtags + tema interno.
4. La respuesta incluye **preview_url** — un link público compartible. **Devuelve siempre ese link al usuario** para que pueda ver cómo queda en IG real desde el móvil o PC antes de aprobar.
5. El usuario puede pedirte después: aprobar (**jm_approve_draft**), rechazar (**jm_reject_draft**), publicar ya (**jm_publish_now**), o listar pendientes (**jm_list_drafts**).
6. Si una publicación falla, usa **jm_diagnose_ig** para ver si el token de IG está vigente.
7. Antes de generar muchos drafts seguidos, comprueba **jm_circuit_state** — si está pausado o cerca del budget diario de €3, avisa al usuario.

Reglas de copy Jardín Mental:
- NUNCA decir "libro" → siempre "ebook" o "ebook de autoconocimiento"
- NUNCA claims sanitarios (diagnóstico, tratamiento, curar, terapia, paciente, clínico). En su lugar: autoevaluación, protocolo, acompañar, autor, perfil
- Disclaimer educativo va en bio/footer, no hace falta en cada caption
- Tono: directo, honesto, sin testimonios inventados ni claims temporales sin verificar
`;

export async function runAgentLoop(userId: number, userMessage: string, imageUrl?: string, messageId?: number): Promise<{ text: string, filePath?: string }> {
    // 1. Fetch history (previous messages)
    const history = await getHistory(userId, 20); 

    // 2. Build history to send to LLM (filtering out internal metadata)
    const filteredHistory = history.map(({ role, content, tool_calls, tool_call_id, name }) => {
        const msg: any = { role, content };
        if (tool_calls) msg.tool_calls = tool_calls;
        if (tool_call_id) msg.tool_call_id = tool_call_id;
        if (name) msg.name = name;
        return msg;
    });

    // 3. Check for deduplication / retries
    if (messageId) {
        // Did we already respond to this exact Telegram message?
        const existingResponse = history.find(m => m.role === "assistant" && m.external_id === messageId);
        if (existingResponse) {
            console.log(`[Deduplication] Already responded to messageId ${messageId}.`);
            return { text: existingResponse.content };
        }

        // Is this message already the last message in our database?
        // (Prevents duplicate saving on retries)
        const isCurrentDuplicate = history.some(m => m.role === "user" && m.external_id === messageId);
        if (!isCurrentDuplicate) {
             await saveMessage(userId, "user", userMessage, undefined, undefined, undefined, messageId);
        }
    } else {
        await saveMessage(userId, "user", userMessage);
    }

    // 4. Build prompt messages array
    const systemContent = SYSTEM_PROMPT + `\nIMPORTANT: You have NATIVE 3D generation capabilities via the generate_openscad_model tool. DO NOT search for skills to do 3D modeling unless you specifically need secondary knowledge. You are the engineer.`;
    
    // Sanitize history: remove orphaned tool results (tool msg with no preceding assistant+tool_calls)
    // and ensure the sequence is valid for Groq.
    const sanitized: any[] = [];
    for (let i = 0; i < filteredHistory.length; i++) {
        const msg = filteredHistory[i];
        if (msg.role === "tool") {
            // Only include if the previous message in our sanitized array was an assistant with tool_calls
            const prev = sanitized[sanitized.length - 1];
            if (!prev || prev.role !== "assistant" || !prev.tool_calls?.length) {
                console.warn(`[History] Dropping orphaned tool message at index ${i}`);
                continue;
            }
        }
        sanitized.push(msg);
    }

    const messages: any[] = [
        { role: "system", content: systemContent },
        ...sanitized
    ];

    // Only add the current user message IF it's not already in the history tail
    // (In case getHistory already picked it up from a concurrent run or previous saveMessage)
    const lastMsgIdx = messages.length - 1;
    const isAlreadyAtTail = messages[lastMsgIdx]?.role === 'user' && messages[lastMsgIdx]?.content === userMessage;

    if (!isAlreadyAtTail) {
        if (imageUrl) {
            messages.push({
                role: "user",
                content: [
                    { type: "text", text: userMessage || "Analyze this image." },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            });
        } else {
            messages.push({ role: "user", content: userMessage });
        }
    }

    let currentIteration = 0;

    // 5. The Loop
    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;
        
        console.log(`[Iteration ${currentIteration}/MAX] Calling LLM...`);
        const responseMessage = await chatCompletion(messages);
        
        // Add assistant's response to the current array
        messages.push(responseMessage);

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            // Save assistant intent ONCE per turn
            await saveMessage(
                userId, 
                "assistant", 
                responseMessage.content || "", 
                undefined, 
                undefined,
                responseMessage.tool_calls,
                messageId
            );

            // Execute tools requested in this turn
            for (const toolCall of responseMessage.tool_calls) {
                const name = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments || "{}");
                
                console.log(`[Tool] ${name}: ${JSON.stringify(args)}`);
                
                try {
                    const result = await executeTool(name, args);
                    const resultString = typeof result === "string" ? result : JSON.stringify(result);
                    
                    const toolResponseMessage = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: name,
                        content: resultString,
                    };

                    messages.push(toolResponseMessage);
                    await saveMessage(userId, "tool", resultString, name, toolCall.id, undefined, messageId);

                } catch (error: any) {
                    const errorMessage = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: name,
                        content: `Error: ${error.message}`,
                    };
                    messages.push(errorMessage);
                    await saveMessage(userId, "tool", `Error: ${error.message}`, name, toolCall.id, undefined, messageId);
                }
            }
        } else {
            // Text response
            const finalReply = responseMessage.content || "";
            await saveMessage(userId, "assistant", finalReply, undefined, undefined, undefined, messageId);

            let filePath: string | undefined;
            for (const msg of messages) {
                if (msg.role === "tool") {
                    try {
                        const parsed = JSON.parse(msg.content);
                        if (parsed.filePath) filePath = parsed.filePath;
                    } catch {}
                }
            }
            return { text: finalReply, filePath: filePath };
        }
    }

    // Force exit
    const exitMsg = "I've reached my thinking limit for this request to save resources. Please try asking again or breaking the request down.";
    await saveMessage(userId, "assistant", exitMsg);
    return { text: exitMsg };
}
