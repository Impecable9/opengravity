import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { CONFIG } from "./config.js";
import * as fs from "fs";

// Initialize Firebase Admin once.
// - In Cloud Functions / Cloud Run: use Application Default Credentials (ADC)
//   provided automatically by the runtime — NO need for a service-account.json.
// - Locally (dev): fall back to the file at CONFIG.GOOGLE_APPLICATION_CREDENTIALS
//   so `npm run dev` keeps working.
if (!getApps().length) {
    const inCloud = !!process.env.K_SERVICE || !!process.env.FUNCTION_TARGET || !!process.env.GOOGLE_CLOUD_PROJECT;
    const saPath = CONFIG.GOOGLE_APPLICATION_CREDENTIALS;

    if (inCloud) {
        initializeApp({ credential: applicationDefault() });
    } else if (saPath && fs.existsSync(saPath)) {
        initializeApp({ credential: cert(saPath) });
    } else {
        // Last resort: try ADC anyway (lets the user set GOOGLE_APPLICATION_CREDENTIALS via env if they want)
        initializeApp();
    }
}

const db = getFirestore();

// Subcollection structure: users/{userId}/messages/{docId}
// No composite index needed — only single-field index on 'timestamp' (auto-created)
function getUserMessagesRef(userId: number) {
    return db.collection("users").doc(String(userId)).collection("messages");
}

// Distributed lock: prevents duplicate processing of the same Telegram message
// across multiple Cloud Function invocations (Telegram webhook retries)
const locksRef = db.collection("processing_locks");

/**
 * Tries to acquire a distributed lock for a given messageId.
 * Returns true if the lock was acquired (first invocation).
 * Returns false if already locked (Telegram retry — should be ignored).
 */
export async function acquireLock(messageId: number): Promise<boolean> {
    const lockDoc = locksRef.doc(String(messageId));
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(lockDoc);
            if (snap.exists) {
                throw new Error("ALREADY_LOCKED");
            }
            tx.set(lockDoc, {
                createdAt: FieldValue.serverTimestamp(),
                // Auto-expire after 5 minutes (TTL cleanup handled separately or via Cloud Scheduler)
                expiresAt: Date.now() + 5 * 60 * 1000
            });
        });
        return true; // Lock acquired
    } catch (err: any) {
        if (err.message === "ALREADY_LOCKED") {
            return false; // Already being processed
        }
        // If Firestore itself is down, allow processing (fail open)
        console.error("[Lock] Firestore lock error, proceeding anyway:", err.message);
        return true;
    }
}

/**
 * Releases the distributed lock for a given messageId.
 */
export async function releaseLock(messageId: number): Promise<void> {
    try {
        await locksRef.doc(String(messageId)).delete();
    } catch (err: any) {
        console.error("[Lock] Failed to release lock:", err.message);
    }
}

export async function saveMessage(
    userId: number,
    role: "system" | "user" | "assistant" | "tool",
    content: string,
    name?: string,
    toolCallId?: string,
    toolCalls?: any[],
    externalId?: number
) {
    const messagesRef = getUserMessagesRef(userId);
    await messagesRef.add({
        role,
        content: content || "",
        name: name || null,
        toolCallId: toolCallId || null,
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
        externalId: externalId || null,
        timestamp: Date.now()
    });
}

export async function getHistory(
    userId: number,
    limit = 50
): Promise<Array<{
    role: string;
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: any[];
    external_id?: number;
}>> {
    try {
        const messagesRef = getUserMessagesRef(userId);
        const snapshot = await messagesRef
            .orderBy("timestamp", "desc")
            .limit(limit)
            .get();

        const rows: any[] = [];
        snapshot.forEach(doc => rows.push(doc.data()));

        // Return in chronological order
        return rows.reverse().map(row => {
            const msg: any = { role: row.role, content: row.content };
            if (row.name) msg.name = row.name;
            if (row.toolCallId) msg.tool_call_id = row.toolCallId;
            if (row.externalId) msg.external_id = row.externalId;
            if (row.toolCalls) {
                try {
                    msg.tool_calls = JSON.parse(row.toolCalls);
                } catch {
                    console.error("[DB] Failed to parse toolCalls");
                }
            }
            return msg;
        });
    } catch (error: any) {
        // Don't crash the bot if history fetch fails — just return empty
        console.error("[DB] getHistory failed:", error.message);
        return [];
    }
}

export async function clearHistory(userId: number): Promise<void> {
    const messagesRef = getUserMessagesRef(userId);
    const snapshot = await messagesRef.limit(500).get();
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[DB] Cleared history for user ${userId}`);
}
