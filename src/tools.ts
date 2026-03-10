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

export const toolsDefinitions: Tool[] = [
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
];

export async function executeTool(name: string, args: any): Promise<any> {
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
    
    throw new Error(`Unknown tool: ${name}`);
}
