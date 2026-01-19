import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import pkg from 'wavefile';
const { WaveFile } = pkg;
import alawmulaw from 'alawmulaw';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Service to handle individual OpenAI components (Split Brain)
 */
export const OpenAIService = {
    /**
     * 1. STT: Transcribe Audio Buffer using Whisper
     * @param {Buffer} audioBuffer - Raw audio buffer (8000Hz, mulaw)
     */
    async transcribeAudio(audioBuffer) {
        let tempPath = null;
        try {
            // 1. Convert Mulaw (8000Hz_ -> PCM (16-bit, 8000Hz)
            // Whisper works best with 16kHz but 8kHz is okay if headers are right.
            const samples = alawmulaw.mulaw.decode(audioBuffer);

            // 2. Create WAV file with correct headers
            const wav = new WaveFile();
            wav.fromScratch(1, 8000, '16', samples);

            // 3. Write to temp file
            tempPath = path.join('/tmp', `input_${Date.now()}.wav`);
            // Ensure /tmp exists (platform dependent, on windows might be different)
            const tempDir = path.dirname(tempPath);
            if (!fs.existsSync(tempDir)) {
                // Fallback to local 'tmp' folder if system /tmp is not available or writeable
                tempPath = path.join(process.cwd(), 'tmp', `input_${Date.now()}.wav`);
                if (!fs.existsSync(path.dirname(tempPath))) fs.mkdirSync(path.dirname(tempPath));
            }

            fs.writeFileSync(tempPath, wav.toBuffer());

            // 4. Send to Whisper
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(tempPath),
                model: "whisper-1",
                language: "en", // Optimize for Hinglish if possible, or auto
            });

            return transcription.text;
        } catch (error) {
            console.error("STT Error:", error);
            return null;
        } finally {
            if (tempPath && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    },

    /**
     * 2. LLM: Generate Response using GPT-4o-mini
     */
    async generateResponse(systemPrompt, history, userText) {
        try {
            const messages = [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: userText }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                max_tokens: 150,
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error("LLM Error:", error);
            // Fallback response
            return "Sorry, I didn't catch that properly.";
        }
    },

    /**
     * 3. TTS: Generate Audio using OpenAI TTS
     * Returns Buffer in MP3 format (Client needs to convert to mulaw8k if streaming to Plivo directly)
     * OR we convert here.
     */
    async generateAudio(text) {
        try {
            const mp3 = await openai.audio.speech.create({
                model: "tts-1",
                voice: "shimmer",
                input: text,
                response_format: "mp3" // Use MP3 for stability, then decode -> resample -> encode
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            return buffer;
            // Note: This buffer is likely 24kHz/16bit PCM. 
            // Plivo needs 8kHz Mulaw. We will handle conversion in index.js or here.
        } catch (error) {
            console.error("TTS Error:", error);
            return null;
        }
    }
};
