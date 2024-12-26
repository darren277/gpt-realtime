const { WebSocket } = require("ws");
//import functions from "./functionHandlers";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required.");
  process.exit(1);
}

/*
interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
}
*/

let session = {
    frontendConn: undefined,
    modelConn: undefined,
    // other session-level data...
};

function handleFrontendConnection(ws) {
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", handleFrontendMessage);
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
    if (!session.modelConn) session = {};
  });
}

async function handleFunctionCall(item) {
  console.log("Handling function call:", item);
  const fnDef = functions.find((f) => f.schema.name === item.name);
  if (!fnDef) {
    throw new Error(`No handler found for function: ${item.name}`);
  }

  let args;
  try {
    args = JSON.parse(item.arguments);
  } catch {
    return JSON.stringify({
      error: "Invalid JSON arguments for function call.",
    });
  }

  try {
    console.log("Calling function:", fnDef.schema.name, args);
    const result = await fnDef.handler(args);
    return result;
  } catch (err) {
    console.error("Error running function:", err);
    return JSON.stringify({
      error: `Error running function ${item.name}: ${err.message}`,
    });
  }
}

function handleFrontendMessage(data) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }

  if (msg.type === "input_audio_buffer.append") {
    console.log("Forwarding audio to GPT:", msg.audio.length, "bytes");

    if (isOpen(session.modelConn)) {
      jsonSend(session.modelConn, {
        type: "input_audio_buffer.append",
        audio: msg.audio, // Base64-encoded audio from frontend
      });
    } else {
      console.error("GPT WebSocket is not open. Cannot forward audio.");
    }
  }
}

function handleModelConnection() {
    // If modelConn is already open, skip
    if (isOpen(session.modelConn)) return;
  
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );
  
    ws.on('open', () => {
      // Example: send session.update
      jsonSend(ws, {
        type: "session.update",
        session: {
            modalities: ["text", "audio"],
            turn_detection: { type: "server_vad" },
            voice: "ash",
            input_audio_transcription: { model: "whisper-1" },
            //input_audio_format: "g711_ulaw",
            //output_audio_format: "g711_ulaw",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
        },
      });
      flushQueue(ws);
    });
  
    ws.on("error", (err) => {
        console.error("Error connecting to GPT WebSocket:", err);
      });
    
      ws.on("close", () => {
        console.log("GPT WebSocket closed.");
        closeModelConn();
      });
    
      ws.on("message", (data) => {
        const event = JSON.parse(data);
        console.log("Received event from GPT:", event);
        handleModelMessage(data);
      });
  
    session.modelConn = ws;
  }

function handleModelMessage(data) {
  const event = parseMessage(data);
  if (!event) return;

  console.log("?????????????? Received event from model:", event);

  // Always forward events to the frontend
  jsonSend(session.frontendConn, event);

  // Example function call scenario:
  if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
    handleFunctionCall(event.item);
  }

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      handleTruncation();
      break;

      case "response.audio.delta": {
        // If your session has some concept of "when the response started," track it here:
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) {
          session.lastAssistantItem = event.item_id;
        }
      
        // Forward the base64 audio to the frontend:
        if (isOpen(session.frontendConn)) {
          jsonSend(session.frontendConn, {
            type: "audio_delta",
            delta: event.delta, // This is base64 PCM or WAV, depending on your session config
            item_id: event.item_id,
          });
        }


        jsonSend(session.twilioConn, {
          event: "mark",
          streamSid: session.streamSid,
        });
        break;
      }

    case "response.output_item.done": {
      const { item } = event;
      if (item?.type === "function_call") {
        handleFunctionCall(item)
          .then((output) => {
            if (session.modelConn) {
              jsonSend(session.modelConn, {
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: item.call_id,
                  output: JSON.stringify(output),
                },
              });
              jsonSend(session.modelConn, { type: "response.create" });
            }
          })
          .catch((err) => {
            console.error("Error handling function call:", err);
          });
      }
      break;
    }
  }
}

function handleTruncation() {
  if (!session.lastAssistantItem || session.responseStartTimestamp === undefined) {
    return;
  }

  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  // Send conversation.item.truncate to GPT
  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  // Reset session audio tracking
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}


function closeModelConn() {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  if (!session.twilioConn && !session.frontendConn) session = {};
}

function closeAllConnections() {
  if (session.twilioConn) {
    session.twilioConn.close();
    session.twilioConn = undefined;
  }
  if (session.modelConn) {
    session.modelConn.close();
    session.modelConn = undefined;
  }
  if (session.frontendConn) {
    session.frontendConn.close();
    session.frontendConn = undefined;
  }
  session.streamSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
  session.saved_config = undefined;
}

function cleanupConnection(ws) {
  if (isOpen(ws)) ws.close();
}

function parseMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

let messageQueue = [];

function jsonSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not open. Message not sent:", obj);
    messageQueue.push(obj);
    return;
  }
  console.log("Sending to ws:", isOpen(ws), obj);
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));

  // Send any queued messages
//   while (messageQueue.length > 0) {
//     const queuedMessage = messageQueue.shift();
//     console.log("Sending queued message:", queuedMessage);
//     ws.send(JSON.stringify(queuedMessage));
//   }
}

// Flush queued messages on WebSocket open
function flushQueue(ws) {
    while (messageQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const queuedMessage = messageQueue.shift();
      console.log("Flushing queued message:", queuedMessage);
      ws.send(JSON.stringify(queuedMessage));
    }
}

function isOpen(ws) {
  console.log("WebSocket state:", ws ? ws.readyState : "No WebSocket");
  return !!ws && ws.readyState === WebSocket.OPEN;
}

module.exports = {
    session,
    handleFrontendConnection,
    handleModelConnection,
    closeAllConnections,
    jsonSend,
    isOpen,
};
