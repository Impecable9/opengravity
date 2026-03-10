import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CONFIG } from "./config.js";
import * as fs from "fs";
import * as path from "path";

// Check if credentials exist
const saPath = CONFIG.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath || !fs.existsSync(saPath)) {
    console.error(`Firebase Service Account missing at: ${saPath}`);
    process.exit(1);
}

// Initialize Firebase Admin
initializeApp({
    credential: cert(saPath)
});

const db = getFirestore();

interface MessageRow {
    userId: number;
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name: string | null;
    toolCallId: string | null;
    timestamp: number;
}

export async function saveMessage(userId: number, role: MessageRow["role"], content: string, name?: string, toolCallId?: string) {
    const messagesRef = db.collection('messages');
    await messagesRef.add({
        userId,
        role,
        content,
        name: name || null,
        toolCallId: toolCallId || null,
        timestamp: Date.now()
    });
}

export async function getHistory(userId: number, limit = 50): Promise<Array<{role: string, content: string, name?: string, tool_call_id?: string}>> {
    const messagesRef = db.collection('messages');
    const snapshot = await messagesRef
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
        
    const rows: MessageRow[] = [];
    snapshot.forEach(doc => {
        rows.push(doc.data() as MessageRow);
    });
    
    // Return in chronological order
    return rows.reverse().map(row => {
        const msg: any = { role: row.role, content: row.content };
        if (row.name) msg.name = row.name;
        if (row.toolCallId) msg.tool_call_id = row.toolCallId;
        return msg;
    });
}
