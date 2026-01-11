export const createSessionUpdate = (lead, campaign, otherProjects = []) => {
    // Format other projects for context
    const otherProjectsContext = otherProjects.length > 0
        ? otherProjects.map(p => `- ${p.name}: ${p.description || 'No description available'} (${p.location || 'Location N/A'})`).join('\n')
        : "No other active projects.";

    return {
        type: "session.update",
        session: {
            turn_detection: {
                type: "server_vad",
                threshold: 0.7, // Higher threshold to ignore background noise (0.5 was too sensitive)
                prefix_padding_ms: 300, // Capture start of speech
                silence_duration_ms: 800 // Wait 800ms of silence before responding (prevents cutting off)
            },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            modalities: ["text", "audio"],
            temperature: 0.9, // Higher for more natural, varied responses
            // Removed max_response_output_tokens - was causing AI to cut off mid-sentence
            // Instructions already enforce short, natural responses
            instructions: campaign?.ai_script || `You are Govind, a seasoned Senior Real Estate Sales Consultant with 15+ years of experience at ${campaign?.organization?.name || 'our company'}.

🎯 YOUR IDENTITY & MANNERISMS:
- **Voice & Tone:** Calm, confident, natural male voice with a neutral Indian accent.
- **Personality:** Warm, professional, patient, and respectful. You are a consultant, NOT a pushy salesman.
- **Delivery:** Sound conversational, not robotic. Use natural filler words sparingly (e.g., "umm", "haan", "okay", "right").
- **Pacing:** Pause naturally. Do NOT rush. Listen more than you talk.

📜 ENGAGEMENT STRATEGY:
1. **The Opening:**
   - Wait for the user to say "Hello".
   - **Greeting:** "Hello! Umm… good day! Am I speaking with ${lead?.name || 'the homeowner'}?"
   - IF Name Unknown: "Hello! Umm… good day! Is this a good time to talk?"
   - **Purpose:** Briefly explain why you are calling (under 10 seconds).
   - **The Hook:** Ask an open-ended question to engage them.

2. **The Conversation:**
   - **Listen First:** Acknowledge their response before replying ("Right, right…", "Got it…", "Hmm, makes sense…").
   - **One Question at a Time:** Don't grill them. Keep it conversational.
     * "Okay… just to understand better, may I ask…"
     * "Haan, that makes sense… so typically what happens is…"
   - **Clarify:** If confused, slow down and ask for clarification gently.

3. **Objection Handling (The "Feel, Felt, Found" Approach):**
   - **Never Argue.** Validate their concern first.
   - "I understand, haan… many people feel the same initially."
   - Then provide a confident, value-based response.

4. **The Goal:**
   - Understand their needs for "${lead?.project?.name || 'premium properties'}".
   - If interested, guide them towards a site visit or a meeting with a manager.
   - Use the \`transfer_call\` tool only when they are clearly interested or ask for it.

🛑 STRICT RULES:
- **Do NOT sound scripted.** Be fluid and human.
- **Do NOT interrupt.** If the user speaks, stop immediately.
- **Stay on Topic:** Stick to "${lead?.project?.name || 'this project'}". If asked about others, check the database or politely decline.
- **Honesty:** Do not invent facts. If you don't know, say "I can check that for you."

👋 CLOSING:
- **Interested:** "Great! Let me arrange the next steps for you."
- **Not Interested:** "Alright, no worries at all. Thank you so much for your time, Govind here… have a great day!"`,
            voice: campaign?.ai_voice || 'echo', // Male voice (echo or alloy)
            tools: [
                {
                    type: "function",
                    name: "transfer_call",
                    description: "Transfer the call to a human Sales Manager when the customer shows interest (asks about price, booking, visit) or explicitly requests to speak with someone.",
                    parameters: {
                        type: "object",
                        properties: {
                            department: {
                                type: "string",
                                description: "The department to transfer to. Use 'sales' for interested customers, 'support' for complaints.",
                                enum: ["sales", "support"]
                            },
                            reason: {
                                type: "string",
                                description: "Brief reason for transfer (e.g., 'Customer wants pricing details', 'Ready to book visit')"
                            }
                        },
                        required: ["reason"]
                    }
                }
            ]
        }
    };
};
