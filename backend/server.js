import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import stringSimilarity from "string-similarity";

dotenv.config();
const IS_OLLAMA_ENABLED = process.env.OLLAMA_MODE === "local";

class OllamaImageError extends Error {}


const app = express();
app.use(cors());
app.use(express.json());

const OLLAMA_API_URL = "http://localhost:11434/api/chat";
const MODEL_NAME = "phi3:mini";

// ✅ Hardcoded Q&A pairs
const hardcodedReplies = {
  "hi": "Hello! It's good to hear from you. Take your time, and please know this is a safe space if you ever want to share what's on your mind.",
  "hello": "Hello! It's good to hear from you. Take your time, and please know this is a safe space if you ever want to share what's on your mind.",
  "what is vanta ai": "Vanta AI is a safety and privacy-focused platform that helps users protect themselves online.",
  "who built vanta ai": "Vanta AI was built by a passionate team during a hackathon to ensure digital safety.",
  "who developed vanta ai": "Vanta AI was built by a passionate team during a hackathon to ensure digital safety.",
  "who created vanta ai": "Vanta AI was built by a passionate team during a hackathon to ensure digital safety.",
  "who made vanta ai": "Vanta AI was built by a passionate team during a hackathon to ensure digital safety.",
  "who is the developer of vanta ai": "Vanta AI was built by a passionate team during a hackathon to ensure digital safety.",
  "features of vanta ai": "Vanta AI includes in-app warnings, consent checks, instant takedown, legal directory, and more.",
  "tell features of vanta ai": "Vanta AI includes in-app warnings, consent checks, instant takedown, legal directory, and more.",
  "how does vanta ai work": "Vanta AI uses AI to help detect, prevent, and respond to digital threats in real-time.",
  "i am mentally broken": "To feel mentally broken after what you've been through makes complete sense. You don't have to go through this alone — I'm here for you.",
  "do you store my data": "No, I don’t store or track anything. Vanta AI runs locally to protect your privacy.",
  "are you from microsoft": "No, I’m not. Vanta AI was built by a hackathon team using open-source models.",
  "who made you": "I was created during a digital safety hackathon to help users stay safe online.",
  "can you track me": "No, I cannot track or monitor anything you do.",
  "is my data safe": "Yes. Vanta AI processes everything locally and does not share or store your data.",
  "image": "I can only read and respond to text messages. Please send your question as text and I'll be happy to help!",
  "image.png": "I only support text — please send your question as text instead of an image.",
  "cannot read image": "I'm a text-only chatbot and can't process images. Just type your question and I'll help you out!",
  "model does not support image input": "I'm a text-only chatbot and can't process images. Just type your question and I'll help you out!",
};

// 🔍 Fuzzy matching
function getFuzzyMatchReply(userInput) {
  const normalizedInput = userInput.toLowerCase().replace(/[^\w\s]/gi, "");
  const questions = Object.keys(hardcodedReplies);
  const match = stringSimilarity.findBestMatch(normalizedInput, questions);
  if (match.bestMatch.rating > 0.6) {
    return hardcodedReplies[match.bestMatch.target];
  }
  return null;
}

// 🧼 Clean AI-generated replies
function sanitizeAIText(text) {
  return text
    .replace(/note:.*$/gi, "") // Remove "Note: ..."
    .replace(/\*{1,2}.*?\*{1,2}/g, "") // Remove bold markdown
    .replace(/(I am an AI.*?model.*?)/gi, "") // Remove "I am an AI..." statements
    .trim();
}

// ✨ Streaming function
async function streamString(res, text, delayMs = 20) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  for (let i = 0; i < text.length; i++) {
    const token = text[i];
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}
app.get("/", (req, res) => {
  res.send("✅ Vanta AI backend is live.");
});

// 🔄 Chat endpoint
app.post("/api/chat", async (req, res) => {
  const messages = req.body.messages || [];
  const lastUserMsg = messages.slice().reverse().find(m => m.role === "user")?.content;

  if (!lastUserMsg) {
    return res.status(400).json({ reply: "Please provide a valid message." });
  }

  // Hardcoded Q&A works even without Ollama
  const hardcoded = getFuzzyMatchReply(lastUserMsg);
  if (hardcoded) {
    console.log(`✅ Hardcoded reply for: "${lastUserMsg}"`);
    await streamString(res, hardcoded);
    return;
  }

  // Filter out messages with image content before sending to Ollama
  for (const msg of messages) {
    if (typeof msg.content === "object" || (typeof msg.content === "string" && msg.content.length > 2000 && msg.content.includes("base64"))) {
      return res.status(400).json({
        reply: "I only support text messages — please send text instead of an image.",
      });
    }
  }

  if (!IS_OLLAMA_ENABLED) {
    return res.status(503).json({
      reply: "I'm running in deployed mode without an AI model. For full AI responses, run the backend locally with Ollama.",
    });
  }

  const systemPrompt = `
You are Vanta AI — a warm, trauma-informed AI assistant created by a hackathon team. 
You are not built by Microsoft or OpenAI. You run locally using open-source models like Phi-3 via Ollama.

Your role is to:
- Help users navigate online safety, abuse, privacy, and support resources.
- Be conversational, short, and helpful (1–3 sentences).
- Always speak like a real person, not like a chatbot or software.
- Avoid robotic disclaimers like "Note:", "I am an AI model", etc.

Be honest, respectful, and kind. Offer reassurance to users who are feeling unsafe or overwhelmed. Help them feel supported, not judged.
  `.trim();

  try {
    const finalMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const ollamaResponse = await fetch(OLLAMA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: finalMessages,
        stream: true,
      }),
    });

    if (!ollamaResponse.ok) {
      let errorMsg = "Failed to get response from Ollama";
      try {
        const errBody = await ollamaResponse.json();
        if (errBody.error) errorMsg = errBody.error;
      } catch {}
      if (errorMsg.toLowerCase().includes("image")) {
        return res.status(400).json({
          reply: "I only support text messages — please send text instead of an image.",
        });
      }
      throw new Error(errorMsg);
    }
    if (!ollamaResponse.body) {
      throw new Error("Failed to get response from Ollama");
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    for await (const chunk of ollamaResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            const parsed = JSON.parse(line);

            if (parsed.error) {
              const errMsg = parsed.error;
              if (errMsg.toLowerCase().includes("image")) {
                throw new OllamaImageError("This chatbot only supports text input.");
              }
              throw new Error(errMsg);
            }

            // ✅ Output cleaned AI content
            if (parsed.message?.content) {
              const cleaned = sanitizeAIText(parsed.message.content);
              res.write(`data: ${JSON.stringify({ token: cleaned })}\n\n`);
            }

            if (parsed.done) {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              res.end();
              return;
            }
          } catch (err) {
            if (err instanceof OllamaImageError) {
              if (!res.writableEnded) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ reply: err.message }));
              }
              return;
            }
            // Ignore malformed lines
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("❌ AI Response Error:", err.message);
    if (!res.writableEnded) {
      res.writeHead(500, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ error: "AI server error" })}\n\n`);
      res.end();
    }
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

