const { WebSocketServer, WebSocket } = require('ws')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

/**
 * Standalone WebSocket Server for Plivo ↔ OpenAI Realtime API
 * Deploy this to Render.com or any Node.js hosting service
 */

const PORT = process.env.PORT || 3001
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const wss = new WebSocketServer({
    port: PORT,
    path: '/voice/stream'
})

console.log(`🎙️  WebSocket server running on port ${PORT}`)
console.log(`📡 Path: /voice/stream`)

wss.on('connection', async (plivoWs, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const leadId = url.searchParams.get('leadId')
    const campaignId = url.searchParams.get('campaignId')
    const callSid = url.searchParams.get('callSid')

    console.log(`[${callSid}] Plivo WebSocket connected`)

    try {
        // Get lead and campaign data
        const { data: lead } = await supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .single()

        const { data: campaign } = await supabase
            .from('campaigns')
            .select('*, organization:organizations(*)')
            .eq('id', campaignId)
            .single()

        if (!lead || !campaign) {
            console.error(`[${callSid}] Lead or campaign not found`)
            plivoWs.close(1008, 'Lead or campaign not found')
            return
        }

        // Create call log
        const { data: callLog } = await supabase
            .from('call_logs')
            .insert({
                campaign_id: campaignId,
                lead_id: leadId,
                call_sid: callSid,
                call_status: 'in_progress',
                call_timestamp: new Date().toISOString(),
                transferred: false
            })
            .select()
            .single()

        console.log(`[${callSid}] Call log created: ${callLog.id}`)

        // Connect to OpenAI Realtime API
        const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        })

        let conversationTranscript = ''

        openaiWs.on('open', () => {
            console.log(`[${callSid}] OpenAI Realtime API connected`)

            // Configure session
            const sessionConfig = {
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    instructions: `You are an AI sales assistant calling on behalf of ${campaign.organization.name}. 
You are speaking with ${lead.name}. 
Your goal: ${campaign.ai_script || 'Introduce our services and gauge interest.'}
Be professional, friendly, and concise. Keep the call under 1 minute.`,
                    voice: campaign.ai_voice || 'alloy',
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    input_audio_transcription: {
                        model: 'whisper-1'
                    },
                    turn_detection: {
                        type: 'server_vad',
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 500
                    },
                    temperature: 0.8
                }
            }

            openaiWs.send(JSON.stringify(sessionConfig))
            console.log(`[${callSid}] Session configured`)
        })

        // Forward Plivo audio to OpenAI
        plivoWs.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString())

                if (data.event === 'media' && data.media && data.media.payload) {
                    // Forward audio to OpenAI
                    const audioAppend = {
                        type: 'input_audio_buffer.append',
                        audio: data.media.payload // Already base64 μ-law from Plivo
                    }
                    openaiWs.send(JSON.stringify(audioAppend))
                } else if (data.event === 'start') {
                    console.log(`[${callSid}] Plivo stream started`)
                } else if (data.event === 'stop') {
                    console.log(`[${callSid}] Plivo stream stopped`)
                    openaiWs.close()
                }
            } catch (error) {
                console.error(`[${callSid}] Error processing Plivo message:`, error.message)
            }
        })

        // Forward OpenAI audio to Plivo
        openaiWs.on('message', (message) => {
            try {
                const event = JSON.parse(message.toString())

                if (event.type === 'response.audio.delta' && event.delta) {
                    // Forward audio to Plivo
                    const mediaMessage = {
                        event: 'media',
                        media: {
                            payload: event.delta // Already base64 μ-law from OpenAI
                        }
                    }
                    plivoWs.send(JSON.stringify(mediaMessage))
                } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
                    console.log(`[${callSid}] User: ${event.transcript}`)
                    conversationTranscript += `User: ${event.transcript}\n`
                } else if (event.type === 'response.audio_transcript.done') {
                    console.log(`[${callSid}] AI: ${event.transcript}`)
                    conversationTranscript += `AI: ${event.transcript}\n`
                } else if (event.type === 'error') {
                    console.error(`[${callSid}] OpenAI error:`, event.error)
                }
            } catch (error) {
                console.error(`[${callSid}] Error processing OpenAI message:`, error.message)
            }
        })

        // Handle errors
        openaiWs.on('error', (error) => {
            console.error(`[${callSid}] OpenAI WebSocket error:`, error.message)
        })

        plivoWs.on('error', (error) => {
            console.error(`[${callSid}] Plivo WebSocket error:`, error.message)
        })

        // Cleanup on close
        const cleanup = async () => {
            console.log(`[${callSid}] Cleaning up connections`)

            if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.close()
            }

            // Save transcript
            await supabase
                .from('call_logs')
                .update({
                    transcript: conversationTranscript,
                    call_status: 'completed'
                })
                .eq('id', callLog.id)

            console.log(`[${callSid}] Call completed, transcript saved`)
        }

        plivoWs.on('close', cleanup)
        openaiWs.on('close', cleanup)

    } catch (error) {
        console.error(`[${callSid}] WebSocket handler error:`, error)
        plivoWs.close(1011, 'Internal server error')
    }
})

wss.on('error', (error) => {
    console.error('WebSocket server error:', error)
})

// Health check endpoint for Render
const http = require('http')
const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
    } else {
        res.writeHead(404)
        res.end('Not Found')
    }
})

healthServer.listen(PORT + 1, () => {
    console.log(`🏥 Health check running on port ${PORT + 1}`)
})
