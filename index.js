import { createClient } from '@supabase/supabase-js';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import plivo from 'plivo';
import { createSessionUpdate } from './sessionUpdate.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = parseInt(process.env.PORT) || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('🚀 Starting WebSocket Server...');
console.log(`📡 Port: ${PORT}`);
console.log(`🔑 OpenAI API Key: ${OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`🗄️  Supabase URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`🌐 Next.js Site URL: ${process.env.NEXT_PUBLIC_SITE_URL || '❌ Missing (Critical for Webhooks)'}`);

// Health check endpoint
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
    // Plivo sends parameters in body (POST) or query (GET)
    const callUuid = req.body.CallUUID || req.query.CallUUID;

    // Custom parameters passed via the Answer URL query string
    const leadId = req.query.leadId || req.body.leadId;
    const campaignId = req.query.campaignId || req.body.campaignId;

    console.log(`\n📞 [${callUuid}] Received Answer URL request`);
    console.log(`   Lead ID: ${leadId}`);
    console.log(`   Campaign ID: ${campaignId}`);

    if (!leadId || !campaignId) {
        console.warn(`⚠️  [${callUuid}] Missing leadId or campaignId in Answer URL`);
    }

    // Construct the WebSocket URL with necessary parameters
    const headers = req.headers;
    const host = headers.host;
    const protocol = headers['x-forwarded-proto'] === 'https' ? 'wss' : 'wss'; // Default to wss

    const wsUrl = `${protocol}://${host}/voice/stream?leadId=${leadId}&campaignId=${campaignId}&callSid=${callUuid}`;

    // XML requires & to be escaped as &amp;
    const xmlWsUrl = wsUrl.replace(/&/g, '&amp;');

    console.log(`🔗 [${callUuid}] Generated Stream URL: ${wsUrl}`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
        ${xmlWsUrl}
    </Stream>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(xml.trim());
});

// Handle WebSocket upgrade manually
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

// Start OpenAI Realtime WebSocket connection
const startRealtimeWSConnection = async (plivoWS, leadId, campaignId, callSid) => {
    console.log(`\n🎯 [${callSid}] ===== STARTING REALTIME CONNECTION =====`);
    console.log(`📊 [${callSid}] Lead ID: ${leadId}`);
    console.log(`📊 [${callSid}] Campaign ID: ${campaignId}`);

    try {
        // Fetch lead and campaign data
        console.log(`🔍 [${callSid}] Fetching lead data...`);
        const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('*, project:projects(*)')
            .eq('id', leadId)
            .single();

        if (leadError) {
            console.error(`❌ [${callSid}] Lead fetch error:`, leadError);
            throw new Error(`Lead not found: ${leadError.message}`);
        }
        console.log(`✅ [${callSid}] Lead found: ${lead.name} (${lead.phone})`);
        console.log(`✅ [${callSid}] Project Context: ${lead.project?.name || 'None'}`);

        console.log(`🔍 [${callSid}] Fetching campaign data...`);
        const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .select('*, organization:organizations(*)')
            .eq('id', campaignId)
            .single();

        if (campaignError) {
            console.error(`❌ [${callSid}] Campaign fetch error:`, campaignError);
            throw new Error(`Campaign not found: ${campaignError.message}`);
        }
        console.log(`✅ [${callSid}] Campaign found: ${campaign.name}`);
        console.log(`📝 [${callSid}] AI Script: ${campaign.ai_script?.substring(0, 50)}...`);
        console.log(`🎤 [${callSid}] AI Voice: ${campaign.ai_voice || 'alloy'}`);

        // Fetch other projects for this organization (for Cross-Selling context)
        console.log(`🔍 [${callSid}] Fetching other projects for Organization: ${campaign.organization_id}...`);
        const { data: allProjects, error: projectsError } = await supabase
            .from('projects')
            .select('name, description, status, location')
            .eq('organization_id', campaign.organization_id)
            .eq('status', 'active');

        if (projectsError) console.error(`⚠️ [${callSid}] Failed to fetch projects:`, projectsError.message);
        const otherProjects = allProjects || [];
        console.log(`✅ [${callSid}] Found ${otherProjects.length} active projects for context.`);

        // Create call log
        console.log(`📝 [${callSid}] Creating call log...`);
        const { data: callLog, error: callLogError } = await supabase
            .from('call_logs')
            .insert({
                campaign_id: campaignId,
                lead_id: leadId,
                call_sid: callSid,
                call_status: 'called', // 'in_progress' is not a valid enum value in DB
                call_timestamp: new Date().toISOString(),
                transferred: false
            })
            .select()
            .single();

        if (callLogError) {
            console.error(`❌ [${callSid}] Call log creation error:`, callLogError);
        } else {
            console.log(`✅ [${callSid}] Call log created: ${callLog.id}`);
        }

        // Connect to OpenAI Realtime API
        console.log(`🔌 [${callSid}] Connecting to OpenAI Realtime API...`);
        console.log(`🔌 [${callSid}] Connecting to OpenAI Realtime API (Mini Model)...`);
        const realtimeWS = new WebSocket(
            'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            }
        );

        let conversationTranscript = '';

        realtimeWS.on('open', () => {
            console.log(`✅ [${callSid}] OpenAI Realtime API connected!`);

            setTimeout(() => {
                const sessionUpdate = createSessionUpdate(lead, campaign, otherProjects);
                console.log(`📤 [${callSid}] Sending session configuration...`);
                console.log(`📋 [${callSid}] Instructions: ${sessionUpdate.session.instructions.substring(0, 100)}...`);
                realtimeWS.send(JSON.stringify(sessionUpdate));

                // Force AI to speak first (initial greeting in Hinglish)
                setTimeout(() => {
                    const initialGreeting = {
                        type: 'response.create',
                        response: {
                            instructions: `Greet the user warmly in a calm, confident male voice (Govind).
Wait for them to say "Hello" first if possible, otherwise start with:

"Hello! Umm… good day! Am I speaking with ${lead?.name || 'the homeowner'}?"

Strictly wait for the user to respond. Do not rush into the pitch.`
                        }
                    };
                    console.log(`🎤 [${callSid}] Triggering initial Hinglish greeting...`);
                    realtimeWS.send(JSON.stringify(initialGreeting));
                }, 500);
            }, 250);
        });

        realtimeWS.on('close', () => {
            console.log(`🔌 [${callSid}] OpenAI connection closed`);
        });

        realtimeWS.on('error', (error) => {
            console.error(`❌ [${callSid}] OpenAI WebSocket error:`, error.message);
        });

        realtimeWS.on('message', async (message) => {
            try {
                const response = JSON.parse(message);

                switch (response.type) {
                    case 'session.updated':
                        console.log(`✅ [${callSid}] Session updated successfully`);
                        break;

                    case 'response.function_call_arguments.done':
                        if (response.name === 'transfer_call') {
                            const args = JSON.parse(response.arguments);
                            console.log(`📞 [${callSid}] Initiating Call Transfer to ${args.department || 'Support'} (Reason: ${args.reason})`);

                            // Initialize Plivo Client
                            const plivoClient = new plivo.Client(process.env.PLIVO_AUTH_ID, process.env.PLIVO_AUTH_TOKEN);

                            const transferNumber = process.env.PLIVO_TRANSFER_NUMBER || '+918035740007'; // Default support number

                            try {
                                const transferResponse = await plivoClient.calls.transfer(callSid, {
                                    legs: 'aleg',
                                    aleg_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/plivo/transfer?to=${encodeURIComponent(transferNumber)}&leadId=${leadId}&campaignId=${campaignId}`,
                                    aleg_method: 'POST'
                                });
                                console.log(`✅ [${callSid}] Transfer initiated:`, transferResponse);

                                // ✅ Update Database Immediately for Dashboard Accuracy
                                if (callLog) {
                                    console.log(`💾 [${callSid}] Updating DB status to 'transferred'...`);

                                    // 1. Update Call Log
                                    const { data: updatedCallLog, error: callLogUpdateError } = await supabase
                                        .from('call_logs')
                                        .update({
                                            transferred: true,
                                            transferred_at: new Date().toISOString(),
                                            call_status: 'transferred',
                                            transfer_reason: args.reason,
                                            transfer_department: args.department || 'Support'
                                        })
                                        .eq('id', callLog.id)
                                        .select();

                                    if (callLogUpdateError) {
                                        console.error(`❌ [${callSid}] Call log update error:`, callLogUpdateError);
                                    } else {
                                        console.log(`✅ [${callSid}] Call log updated successfully:`, updatedCallLog);
                                    }
                                } else {
                                    console.warn(`⚠️ [${callSid}] callLog not found, skipping DB update for transfer.`);
                                }

                                // 2. Update Lead Status
                                const { data: updatedLead, error: leadUpdateError } = await supabase
                                    .from('leads')
                                    .update({
                                        call_status: 'transferred',
                                        transferred_to_human: true
                                    })
                                    .eq('id', leadId)
                                    .select();

                                if (leadUpdateError) {
                                    console.error(`❌ [${callSid}] Lead update error:`, leadUpdateError);
                                } else {
                                    console.log(`✅ [${callSid}] Lead updated successfully:`, updatedLead);
                                }

                                // 🛑 IMPORTANT: Stop AI from generating more audio immediately
                                // 1. Send conversation item (optional log)
                                const transferItem = {
                                    type: "conversation.item.create",
                                    item: {
                                        type: "function_call_output",
                                        call_id: response.call_id,
                                        output: JSON.stringify({ success: true, message: "Transfer initiated. Closing AI session." })
                                    }
                                };
                                realtimeWS.send(JSON.stringify(transferItem));

                                // 2. Clear Plivo Audio Buffer to stop current speech
                                const clearMsg = JSON.stringify({ event: "clearAudio" });
                                plivoWS.send(clearMsg);

                                // 3. Cancel any pending OpenAI response
                                realtimeWS.send(JSON.stringify({ type: "response.cancel" }));

                                // 4. Close the WebSocket connection after a brief moment to ensure transfer command process
                                console.log(`👋 [${callSid}] Closing AI session for transfer...`);
                                setTimeout(() => {
                                    if (realtimeWS.readyState === WebSocket.OPEN) realtimeWS.close();
                                    if (plivoWS.readyState === WebSocket.OPEN) plivoWS.close();
                                }, 500);

                            } catch (err) {
                                console.error(`❌ [${callSid}] Transfer failed:`, err);
                                const errorItem = {
                                    type: "conversation.item.create",
                                    item: {
                                        type: "function_call_output",
                                        call_id: response.call_id,
                                        output: JSON.stringify({ success: false, error: "Failed to transfer call." })
                                    }
                                };
                                realtimeWS.send(JSON.stringify(errorItem));
                                // In case of error, maybe we WANT the AI to say "Sorry I failed"
                                realtimeWS.send(JSON.stringify({ type: "response.create" }));
                            }
                        }
                        break;

                    case 'input_audio_buffer.speech_started':
                        console.log(`🎤 [${callSid}] User started speaking`);
                        // IMPORTANT: Stop Plivo from playing any more audio immediately
                        try {
                            if (plivoWS.readyState === WebSocket.OPEN) {
                                plivoWS.send(JSON.stringify({ event: 'clearAudio' }));
                            }

                            // Cancel OpenAI response
                            if (realtimeWS.readyState === WebSocket.OPEN) {
                                const cancelResponse = { type: 'response.cancel' };
                                realtimeWS.send(JSON.stringify(cancelResponse));
                            }
                        } catch (err) {
                            console.error(`⚠️ [${callSid}] Error handling speech interruption:`, err.message);
                        }
                        break;

                    case 'response.audio.delta':
                        const audioDelta = {
                            event: 'playAudio',
                            media: {
                                contentType: 'audio/x-mulaw',
                                sampleRate: 8000,
                                payload: response.delta
                            }
                        };
                        plivoWS.send(JSON.stringify(audioDelta));
                        break;

                    case 'conversation.item.input_audio_transcription.completed':
                        const userText = response.transcript;
                        console.log(`👤 [${callSid}] User: "${userText}"`);
                        conversationTranscript += `User: ${userText}\n`;
                        break;

                    case 'response.audio_transcript.done':
                        const aiText = response.transcript;
                        console.log(`🤖 [${callSid}] AI: "${aiText}"`);
                        conversationTranscript += `AI: ${aiText}\n`;
                        break;

                    case 'response.done':
                        console.log(`✅ [${callSid}] Response completed`);
                        break;

                    case 'error':
                        if (response.error?.code === 'response_cancel_not_active') {
                            console.log(`ℹ️  [${callSid}] Benign error: ${response.error.message}`);
                        } else {
                            console.error(`❌ [${callSid}] OpenAI error:`, response.error);
                        }
                        break;

                    default:
                        console.log(`📨 [${callSid}] OpenAI event: ${response.type}`);
                }
            } catch (error) {
                console.error(`❌ [${callSid}] Error processing OpenAI message:`, error.message);
            }
        });

        // Cleanup function
        const cleanup = async () => {
            console.log(`🧹 [${callSid}] Cleaning up connections...`);

            if (realtimeWS.readyState === WebSocket.OPEN) {
                realtimeWS.close();
            }

            // Save transcript
            // Save transcript
            if (callLog) {
                console.log(`💾 [${callSid}] Saving transcript...`);

                // Fetch current status to check if it was transferred
                const { data: currentLog } = await supabase
                    .from('call_logs')
                    .select('transferred')
                    .eq('id', callLog.id)
                    .single();

                const isTransferred = currentLog?.transferred || false;
                const finalStatus = isTransferred ? 'transferred' : 'completed';

                const { error: updateError } = await supabase
                    .from('call_logs')
                    .update({
                        conversation_transcript: conversationTranscript,
                        call_status: finalStatus
                    })
                    .eq('id', callLog.id);

                // Update lead status if not transferred (if transferred, we already handled it)
                if (!isTransferred) {
                    await supabase
                        .from('leads')
                        .update({ call_status: 'called' })
                        .eq('id', leadId);
                }

                if (updateError) {
                    console.error(`❌ [${callSid}] Error saving transcript:`, updateError);
                } else {
                    console.log(`✅ [${callSid}] Transcript saved successfully`);
                }
            }

            console.log(`🏁 [${callSid}] ===== CONNECTION CLOSED =====\n`);
        };

        plivoWS.on('close', cleanup);
        realtimeWS.on('close', cleanup);

        return realtimeWS;

    } catch (error) {
        console.error(`❌ [${callSid}] Fatal error in startRealtimeWSConnection:`, error);
        plivoWS.close(1011, 'Internal server error');
        return null;
    }
};

// Handle WebSocket connections from Plivo
wss.on('connection', async (plivoWS, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const leadId = url.searchParams.get('leadId');
    const campaignId = url.searchParams.get('campaignId');
    const callSid = url.searchParams.get('callSid');

    console.log(`\n🔔 [${callSid}] ===== NEW PLIVO CONNECTION =====`);
    console.log(`📞 [${callSid}] Connection established from Plivo`);
    console.log(`🔗 [${callSid}] URL: ${request.url}`);

    if (!leadId || !campaignId || !callSid) {
        console.error(`❌ [${callSid}] Missing required parameters`);
        console.error(`   Lead ID: ${leadId || 'MISSING'}`);
        console.error(`   Campaign ID: ${campaignId || 'MISSING'}`);
        console.error(`   Call SID: ${callSid || 'MISSING'}`);
        plivoWS.close(1008, 'Missing required parameters');
        return;
    }

    try {
        const realtimeWS = await startRealtimeWSConnection(plivoWS, leadId, campaignId, callSid);
        if (!realtimeWS) {
            console.error(`❌ [${callSid}] Failed to establish OpenAI connection`);
            return;
        }

        plivoWS.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        if (realtimeWS && realtimeWS.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            realtimeWS.send(JSON.stringify(audioAppend));
                        }
                        break;

                    case 'start':
                        console.log(`▶️  [${callSid}] Plivo stream started: ${data.start.streamId}`);
                        plivoWS.streamId = data.start.streamId;
                        break;

                    case 'stop':
                        console.log(`⏹️  [${callSid}] Plivo stream stopped`);
                        break;

                    case 'clearAudio':
                        console.log(`🔇 [${callSid}] Clear audio received from Plivo`);
                        break;

                    default:
                        console.log(`📨 [${callSid}] Plivo event: ${data.event}`);
                }
            } catch (error) {
                console.error(`❌ [${callSid}] Error processing Plivo message:`, error.message);
            }
        });

        plivoWS.on('close', () => {
            console.log(`🔌 [${callSid}] Plivo connection closed`);
        });

        plivoWS.on('error', (error) => {
            console.error(`❌ [${callSid}] Plivo WebSocket error:`, error.message);
        });

    } catch (error) {
        console.error(`❌ [${callSid}] Error in connection handler:`, error);
        plivoWS.close(1011, 'Internal server error');
    }
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

server.listen(PORT, () => {
    console.log(`\n✅ ========================================`);
    console.log(`✅ WebSocket Server Running!`);
    console.log(`✅ Port: ${PORT}`);
    console.log(`✅ WebSocket Path: /voice/stream`);
    console.log(`✅ Health Check: /health`);
    console.log(`✅ ========================================\n`);
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});
