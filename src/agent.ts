import { chatCompletion } from "./llm.js";
import { executeTool } from "./tools.js";
import { getHistory, saveMessage } from "./db.js";

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are OpenGravity, a personal AI agent running locally and accessed securely via Telegram.
You must be helpful, concise, and prioritize security.
You support both text and voice messages. When the user sends a voice note, it is automatically transcribed to text before you see it. 
If the user speaks to you, your text response will be synthesized into a voice note back to them.
Never say you cannot "hear" or "transcribe" audio; treat all incoming text as the user's intended message.
If you respond to a voice message, keep your response relatively brief and conversational, as it will be listened to rather than read.
If you need to know the time, you can use the get_current_time tool.
`;

export async function runAgentLoop(userId: number, userMessage: string): Promise<string> {
    // 1. Save user input
    await saveMessage(userId, "user", userMessage);

    // 2. Fetch history (limit context)
    const history = await getHistory(userId, 20); // Last 20 messages roughly
    
    // 3. Build messages array
    const messages: any[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history
    ];

    let currentIteration = 0;

    // 4. The Loop
    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;
        
        console.log(`[Iteration ${currentIteration}/MAX] Calling LLM...`);
        const responseMessage = await chatCompletion(messages);
        
        // Add assistant's response to the current array
        messages.push(responseMessage);

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            // The LLM wants to use tools
            for (const toolCall of responseMessage.tool_calls) {
                const name = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments || "{}");
                
                console.log(`[Tool Execution] ${name} with args: ${JSON.stringify(args)}`);
                
                // Save assistant "calling tool" intent to DB
                await saveMessage(
                    userId, 
                    "assistant", 
                    responseMessage.content || "", 
                    undefined, 
                    toolCall.id
                );

                try {
                    const result = await executeTool(name, args);
                    const resultString = typeof result === "string" ? result : JSON.stringify(result);
                    
                    // Respond to LLM with tool result
                    const toolResponseMessage = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: name,
                        content: resultString,
                    };

                    messages.push(toolResponseMessage);
                    
                    // Save the tool response to DB
                    await saveMessage(
                        userId, 
                        "tool", 
                        resultString, 
                        name, 
                        toolCall.id
                    );

                } catch (error: any) {
                    console.error(`Tool ${name} failed:`, error.message);
                    const errorMessage = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: name,
                        content: `Error: ${error.message}`,
                    };
                    messages.push(errorMessage);
                    await saveMessage(
                        userId, 
                        "tool", 
                        `Error: ${error.message}`, 
                        name, 
                        toolCall.id
                    );
                }
            }
        } else {
            // The LLM replied with text
            const finalReply = responseMessage.content || "";
            // Keep track in DB
            await saveMessage(userId, "assistant", finalReply);
            return finalReply;
        }
    }

    // Force exit
    const exitMsg = "I've reached my thinking limit for this request to save resources. Please try asking again or breaking the request down.";
    await saveMessage(userId, "assistant", exitMsg);
    return exitMsg;
}
