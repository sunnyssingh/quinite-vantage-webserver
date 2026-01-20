import { createClient } from '@supabase/supabase-js';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import plivo from 'plivo';
import { OpenAIService } from './services/openaiService.js';
import alawmulaw from 'alawmulaw';
import pkg from 'wavefile';
const { WaveFile } = pkg;

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = parseInt(process.env.PORT) || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Used in service, checking here
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('🚀 Starting WebSocket Server (Modular Pipeline Experiment)...');
console.log(`📡 Port: ${PORT}`);
console.log(`🔑 OpenAI API: ${OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`🗄️  Supabase URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`🌐 Next.js Site URL: ${process.env.NEXT_PUBLIC_SITE_URL || '❌ Missing (Critical for Webhooks)'}`);

// Health check
app.get('/', (req, res) => {
    console.log('📍 Health check requested');
    res.send('OK');
});

app.get('/health', (req, res) => {
    console.log('📍 Health check requested');
    res.send('OK');
});

// Handle Plivo Answer URL - Generates XML for Call Streaming
app.all('/answer', (req, res) => {
    const callUuid = req.body.CallUUID || req.query.CallUUID;
    const leadId = req.query.leadId || req.body.leadId;
    const campaignId = req.query.campaignId || req.body.campaignId;

    console.log(`\n📞 [${callUuid}] Received Answer URL request`);
    console.log(`   Lead ID: ${leadId}`);
    console.log(`   Campaign ID: ${campaignId}`);

    if (!leadId || !campaignId) {
        console.warn(`⚠️  [${callUuid}] Missing leadId or campaignId in Answer URL`);
    }

    const headers = req.headers;
    const host = headers.host;
    const protocol = headers['x-forwarded-proto'] === 'https' ? 'wss' : 'wss';
    const wsUrl = `${protocol}://${host}/voice/stream?leadId=${leadId}&campaignId=${campaignId}&callSid=${callUuid}`;
    const xmlWsUrl = wsUrl.replace(/&/g, '&amp;');

    // 8000Hz Mulaw stream
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
        ${xmlWsUrl}
    </Stream>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(xml.trim());
});

// WebSocket Upgrade Handler
server.on('upgrade', (request, socket, head) => {
    console.log(`🔄 Upgrade request received for: ${request.url}`);
    if (request.url.startsWith('/voice/stream')) {
        console.log('✅ Valid WebSocket path, handling upgrade...');
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log(`❌ Invalid WebSocket path: ${request.url}`);
        socket.destroy();
    }
});

// --- MODULAR PIPELINE LOGIC (STT -> LLM -> TTS) ---
const startModularConnection = async (plivoWS, leadId, campaignId, callSid) => {
    console.log(`\n🎯 [${callSid}] ===== STARTING MODULAR PIPELINE =====`);

    // 1. Fetch Context
    let lead, campaign, otherProjects = [];
    try {
        const [leadResult, campaignResult] = await Promise.all([
            supabase.from('leads').select('*, project:projects(*)').eq('id', leadId).single(),
            supabase.from('campaigns').select('*, organization:organizations(*)').eq('id', campaignId).single()
        ]);

        if (leadResult.error) throw new Error(`Lead fetch failed: ${leadResult.error.message}`);
        if (campaignResult.error) throw new Error(`Campaign fetch failed: ${campaignResult.error.message}`);

        lead = leadResult.data;
        campaign = campaignResult.data;

        // Fetch projects context
        const projectsResult = await supabase
            .from('projects')
            .select('name, description, status, location')
            .eq('organization_id', campaign.organization_id)
            .eq('status', 'active');
        otherProjects = projectsResult.data || [];

    } catch (err) {
        console.error("Context Fetch Error:", err);
        return; // Connection might close here
    }

    console.log(`✅ [${callSid}] Context Loaded: ${lead.name} / ${campaign.name}`);

    // 2. Build System Prompt & Tools from Session Logic
    const { createSessionUpdate } = await import('./sessionUpdate.js');
    const sessionConfig = createSessionUpdate(lead, campaign, otherProjects);

    // Use instructions from the robust file
    const systemPrompt = sessionConfig.session.instructions;
    const tools = sessionConfig.session.tools;

    console.log(`✅ [${callSid}] System Prompt & Tools Loaded`);

    // 3. Audio Buffer & VAD State
    let audioBuffer = Buffer.alloc(0);
    let silenceStart = null;
    let history = []; // Chat history for LLM
    let isProcessing = false;
    let isSpeaking = false;

    // ... VAD Init Code (lines 144-182) kept roughly same, implied ...

    // Greeting
    // ...

    // --- Helper: Process Turn ---
    const processTurn = async () => {
        if (audioBuffer.length < 4000) return;

        if (isProcessing) return;
        isProcessing = true;

        console.log(`🛑 [${callSid}] Silence detected. Processing Turn...`);

        // A. STT
        const transcript = await OpenAIService.transcribeAudio(audioBuffer);
        audioBuffer = Buffer.alloc(0); // Clear buffer immediately

        if (!transcript || transcript.trim().length < 2) {
            console.log(`⚠️ [${callSid}] Empty/Short transcript, ignoring.`);
            isProcessing = false;
            return;
        }
        console.log(`👤 [${callSid}] User: "${transcript}"`);
        history.push({ role: "user", content: transcript });

        // B. LLM with Tools
        const message = await OpenAIService.generateResponse(systemPrompt, history, transcript, tools);

        history.push(message); // Add assistant message to history

        // Handle Tool Calls
        if (message.tool_calls && message.tool_calls.length > 0) {
            console.log(`🔧 [${callSid}] Handling Tool Calls: ${message.tool_calls.length}`);

            for (const toolCall of message.tool_calls) {
                const fnName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`   -> Executing ${fnName}`, args);

                if (fnName === 'disconnect_call') {
                    // Update DB if reason provided
                    if (args.reason) {
                        const updateData = {
                            call_status: 'completed',
                            lead_status: args.reason === 'not_interested' ? 'not_interested' : args.reason === 'abusive_language' ? 'abusive' : 'wrong_number',
                            // New fields (schema update required)
                            abuse_flag: args.reason === 'abusive_language',
                            rejection_reason: args.reason === 'not_interested' ? args.notes : null, // If notes has detail
                            abuse_details: args.reason === 'abusive_language' ? args.notes : null
                        };

                        await supabase.from('leads').update(updateData).eq('id', leadId);
                        console.log(`   -> Lead Status Updated: ${updateData.lead_status}`);
                    }

                    // Announce disconnection? Maybe just hangup.
                    // Generate polite signoff if not abusive?
                    if (args.reason !== 'abusive_language') {
                        const signoff = await OpenAIService.generateAudio("Okay, thank you. Bye!");
                        if (signoff) sendAudioToPlivo(signoff);
                    } else {
                        // Abusive: immediate cut
                        const signoff = await OpenAIService.generateAudio("Disconnecting.");
                        if (signoff) sendAudioToPlivo(signoff);
                    }

                    setTimeout(() => {
                        plivoWS.close(1000, 'AI Requested Disconnect');
                    }, 2000);
                    return; // Stop processing further
                }

                if (fnName === 'update_lead_status') {
                    // args: status, reason, notes
                    const updateData = {
                        rejection_reason: args.reason, // e.g., 'budget'
                        lead_status: args.status,
                    };
                    await supabase.from('leads').update(updateData).eq('id', leadId);
                    console.log(`   -> Lead Status Updated via Tool: ${JSON.stringify(updateData)}`);
                }

                if (fnName === 'schedule_callback') {
                    // args: time
                    // In real app, use AI to parse time to ISO. For now, store text string or try basic Date
                    const updateData = {
                        waiting_status: 'callback_scheduled',
                        callback_time: new Date().toISOString() // Placeholder, ideally specific time
                    };
                    await supabase.from('leads').update(updateData).eq('id', leadId);
                    console.log(`   -> Callback Scheduled`);
                }

                if (fnName === 'send_whatsapp') {
                    console.log(`   -> 📲 Mock WhatsApp Sent: ${args.type}`);
                    // Trigger WA API here
                }
            }
        }

        // C. TTS (Generate Audio if content exists)
        if (message.content) {
            console.log(`🤖 [${callSid}] AI: "${message.content}"`);
            const audioMp3 = await OpenAIService.generateAudio(message.content);
            if (audioMp3) {
                sendAudioToPlivo(audioMp3);
            }
        }

        isProcessing = false;
    };


    // 4. Handle Incoming Audio
    plivoWS.on('message', async (msg) => {
        const data = JSON.parse(msg);
        if (data.event === 'media') {
            const chunk = Buffer.from(data.media.payload, 'base64');

            // 1. Decode Mu-Law to PCM-16 (8kHz)
            const pcmSamples = alawmulaw.mulaw.decode(chunk);
            const pcmBuffer = Buffer.from(pcmSamples.buffer);
            audioBuffer = Buffer.concat([audioBuffer, pcmBuffer]);

            // VAD Processing
            let isSpeechDetected = false;

            if (vadSession) {
                // Silero VAD (Experimental)
                // Convert Int16 -> Float32
                const float32Samples = new Float32Array(pcmSamples.length);
                for (let i = 0; i < pcmSamples.length; i++) {
                    float32Samples[i] = pcmSamples[i] / 32768.0;
                }

                try {
                    const vadResult = await vadSession.process(float32Samples);
                    // Support both API styles just in case
                    if (vadResult && (vadResult.isSpeech || vadResult === true)) {
                        isSpeechDetected = true;
                    }
                } catch (e) {
                    // console.error("VAD Process Error", e);
                }
            }

            // Fallback: Energy
            if (!isSpeechDetected) {
                let maxVal = 0;
                for (let i = 0; i < pcmSamples.length; i++) {
                    const val = Math.abs(pcmSamples[i]) / 32768;
                    if (val > maxVal) maxVal = val;
                }
                if (maxVal > SILENCE_THRESHOLD) isSpeechDetected = true;
            }

            // Pipeline Logic
            if (isSpeechDetected) {
                // SPEECH DETECTED
                if (isSpeaking) {
                    console.log(`⚡ [${callSid}] Interruption Detected! Stopping AI.`);
                    isSpeaking = false;
                    plivoWS.send(JSON.stringify({ event: 'clearAudio' }));
                }

                if (silenceStart) {
                    silenceStart = null;
                }
            } else {
                // SILENCE
                if (!silenceStart) silenceStart = Date.now();
                else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
                    // Trigger Turn
                    if (audioBuffer.length > 4000) { // Min 0.5s audio
                        processTurn();
                        silenceStart = null;
                    }
                }
            }
        }

        if (data.event === 'stop') {
            console.log(`[${callSid}] Call Stream Stopped.`);
        }
    });


    plivoWS.on('close', () => console.log(`[${callSid}] Plivo Disconnected`));
    plivoWS.on('error', (e) => console.error(`[${callSid}] Plivo Error`, e));
};

// Handle WebSocket connections from Plivo
wss.on('connection', async (plivoWS, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const leadId = url.searchParams.get('leadId');
    const campaignId = url.searchParams.get('campaignId');
    const callSid = url.searchParams.get('callSid');

    console.log(`\n🔔 [${callSid}] ===== NEW MODULAR CONNECTION =====`);

    if (!leadId || !campaignId || !callSid) {
        plivoWS.close(1008, 'Missing Params');
        return;
    }

    // Start Modular Logic
    startModularConnection(plivoWS, leadId, campaignId, callSid);
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

server.listen(PORT, () => {
    console.log(`\n✅ ========================================`);
    console.log(`✅ Modular Experiment Server Running!`);
    console.log(`✅ Port: ${PORT}`);
    console.log(`✅ Mode: OpenAI STT -> LLM -> TTS`);
    console.log(`✅ ========================================\n`);
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});
