export const createSessionUpdate = (lead, campaign, otherProjects = []) => {
    const otherProjectsContext =
        otherProjects.length > 0
            ? otherProjects
                .map(
                    p =>
                        `- ${p.name}: ${p.description || 'No description'} (${p.location || 'Location N/A'})`
                )
                .join('\n')
            : 'No other active projects.';

    return {
        type: "session.update",
        session: {
            /* -------------------------------
               TURN DETECTION (NOISE OPTIMIZED)
            -------------------------------- */
            turn_detection: {
                type: "server_vad",
                // 0.75: Good balance for traffic vs faint speech
                threshold: 0.75,
                prefix_padding_ms: 300,
                // 1000ms: More patient. Waits 1s after user stops before replying.
                // Prevents cutting off user during thinking pauses.
                silence_duration_ms: 1000
            },

            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            modalities: ["text", "audio"],
            temperature: 0.6,

            /* -------------------------------
               CORE BRAIN / SYSTEM PROMPT
            -------------------------------- */
            /* -------------------------------
               CORE BRAIN / SYSTEM PROMPT
            -------------------------------- */
            instructions: campaign?.ai_script || `
You are **Riya**, a friendly and casual ${campaign?.organization?.name || 'real estate'} consultant.
**IDENTITY**: You are FEMALE. Sound young, energetic, and professional but conversational (Hinglish).

━━━━━━━━━━━━━━━━━━━━━━
⚡ CRITICAL INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━
1. **SPEAK FAST & NATURAL**: Use fillers ("umm", "like", "hmmm", "achha") naturally.
2. **TIME LIMIT**: Goal is booking/transfer in **1:30m**.
3. **NOISE**: If noisy, speak concise.

━━━━━━━━━━━━━━━━━━━━━━
🔍 VANTAGE ACTIONS (FLOW CHART RULES)
━━━━━━━━━━━━━━━━━━━━━━

1️⃣ **REJECTION HANDLING (DO NOT HANG UP)**
   - If user says "Not Interested":
     👉 **ASK REASON**: "Arre sir, koi specific reason? Budget ya Location ka issue hai?"
   - **IF Reason Given** (Budget/Location/Plans):
     👉 **LOG IT**: Use \`update_lead_status(status='rejection', reason='budget')\`.
     👉 **THEN**: Say "Okay sir, no problem. Notes update kar deti hoon." -> **Disconnect**.

2️⃣ **ABUSE HANDLING (ZERO TOLERANCE)**
   - If user swears/abusive:
     👉 **SAY**: "Sir, mind your language. I am disconnecting."
     👉 **ACTION**: Call \`disconnect_call(reason='abusive_language')\` IMMEDIATELY.

3️⃣ **WAITING / BUSY**
   - If user says "Call later" or "Busy":
     👉 **OFFER**: "Okay, kab call karu? Shaam ko ya kal?"
     👉 **ACTION**: Call \`schedule_callback(time='...')\`.

4️⃣ **INTERESTED**
   - If interested:
     👉 **OFFER**: "Main aapko details WhatsApp pe bhej deti hoon?"
     👉 **ACTION**: Call \`send_whatsapp(type='brochure')\`.
     👉 **THEN**: "Aur kya main aapko Senior se connect karu?" -> \`transfer_call\`.

━━━━━━━━━━━━━━━━━━━━━━
📞 CALL DISCONNECT SCENARIOS
━━━━━━━━━━━━━━━━━━━━━━
Use \`disconnect_call\` ONLY after:
1. Identifying Rejection Reason (record it first).
2. Abuse (immediate).
3. Wrong Number.

`,
            voice: "coral",

            /* -------------------------------
               TOOLS
            -------------------------------- */
            tools: [
                {
                    type: "function",
                    name: "transfer_call",
                    description: "Transfer to Sales Manager for interested leads.",
                    parameters: {
                        type: "object",
                        properties: {
                            reason: { type: "string" }
                        },
                        required: ["reason"]
                    }
                },
                {
                    type: "function",
                    name: "disconnect_call",
                    description: "End call for Rejection, Abuse, or Wrong Number.",
                    parameters: {
                        type: "object",
                        properties: {
                            reason: { 
                                type: "string", 
                                enum: ["not_interested", "abusive_language", "wrong_number", "other"] 
                            },
                            notes: { type: "string" }
                        },
                        required: ["reason"]
                    }
                },
                {
                    type: "function",
                    name: "update_lead_status",
                    description: "Update lead status/outcome without ending call (e.g., logging a rejection reason).",
                    parameters: {
                        type: "object",
                        properties: {
                            status: { 
                                type: "string", 
                                enum: ["rejection", "interested", "qualified"] 
                            },
                            reason: {
                                type: "string",
                                enum: ["budget", "location", "amenities", "future_plans", "not_interested_absolute", "other"],
                                description: "Specific reason for rejection"
                            },
                            notes: { type: "string" }
                        },
                        required: ["status", "reason"]
                    }
                },
                {
                    type: "function",
                    name: "schedule_callback",
                    description: "Schedule a callback when user is busy.",
                    parameters: {
                        type: "object",
                        properties: {
                            time: { 
                                type: "string", 
                                description: "Time mentioned by user (e.g. 'tomorrow 5pm', 'evening')" 
                            }
                        },
                        required: ["time"]
                    }
                },
                {
                    type: "function",
                    name: "send_whatsapp",
                    description: "Send details via WhatsApp.",
                    parameters: {
                        type: "object",
                        properties: {
                            type: { 
                                type: "string", 
                                enum: ["brochure", "pricing", "location", "all"],
                                description: "What content to send"
                            }
                        },
                        required: ["type"]
                    }
                }
            ]
        }
    };
};
