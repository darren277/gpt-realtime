const { WebSocket } = require("ws");
//import functions from "./functionHandlers";
const { encodeWAV } = require('./utils');

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

function handleModelConnection() {
    // If modelConn is already open, skip
    if (isOpen(session.modelConn)) return;
  
    session.modelConn = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );
  
    session.modelConn.on('open', () => {
      // Example: send session.update
      jsonSend(session.modelConn, {
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
      }, 'handleModelConnection');
      flushQueue(session.modelConn);
    });
  
    session.modelConn.on("error", (err) => {
        console.error("Error connecting to GPT WebSocket:", err);
      });
    
      session.modelConn.on("close", () => {
        console.log("GPT WebSocket closed.");
        closeModelConn();
      });
    
      session.modelConn.on("message", (data) => {
        const event = JSON.parse(data);
        // convert event to loggable event (replace event.delta with event.delta.length)
        let loggableEvent = { ...event };
        if (loggableEvent.delta) {
          loggableEvent.delta = loggableEvent.delta.length;
        }
        console.log("Received event from GPT:", loggableEvent);
        handleModelMessage(data);
      });
  }

function handleFrontendConnection(ws) {
    if (session.frontendConn) {
      console.warn('Frontend connection already exists. Cleaning up...');
      session.frontendConn.close();
    }
  
    session.frontendConn = ws;
  
    ws.on('message', (rawMsg) => {
      handleFrontendMessage(rawMsg);
    });
  
    ws.on('close', () => {
      console.log('Frontend WebSocket closed.');
      session.frontendConn = undefined;
    });
  
    ws.on('error', (err) => {
      console.error('Frontend WebSocket error:', err);
    });
}

function handleFrontendMessage(data) {
    const event = parseMessage(data);
    if (!event) return;
  
    // if (msg.type === 'input_audio_buffer.append') {
    //   console.log('Received audio chunk from frontend:', msg.audio?.length || 0, 'bytes');
  
    //   // Forward to GPT
    //   if (isOpen(session.modelConn)) {
    //     jsonSend(session.modelConn, {
    //       type: 'input_audio_buffer.append',
    //       audio: msg.audio,
    //     }, 'handleFrontendMessage');
    //   } else {
    //     console.warn('GPT connection not open. Could not forward audio.');
    //   }
    // }
    // Handle other frontend messages as needed
    switch (event.type) {
        case "response.audio.delta": {
            // If your session has some concept of "when the response started," track it here:
            if (session.responseStartTimestamp === undefined) {
              session.responseStartTimestamp = session.latestMediaTimestamp || 0;
            }
            if (event.item_id) {
              session.lastAssistantItem = event.item_id;
            }
    
            // Forward the base64 audio to the frontend:
            // This is base64 PCM or WAV, depending on your session config

            const pcmData = Buffer.from(event.delta, 'base64'); // Decode base64 to raw PCM
            const wavData = encodeWAV(pcmData);

            fs.writeFileSync('output.wav', wavData);

            jsonSend(session.frontendConn, {type: "audio_delta", delta: Buffer.from(wavData).toString('base64'), item_id: event.item_id}, 'FRONTEND_handleFrontendMessage_response.audio.delta');
            break;
          }
    }
  }

function handleModelMessage(data) {
  const event = parseMessage(data);
  if (!event) return;

  
  // convert event to loggable event (replace event.delta with event.delta.length)
  let loggableEvent = { ...event };
  if (loggableEvent.delta) {
    loggableEvent.delta = loggableEvent.delta.length;
  }

  console.log("?????????????? Received event from model:", loggableEvent);

  // Example function call scenario:
  if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
    handleFunctionCall(event.item);
  }

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      handleTruncation();
      break;
    
      case "input_audio_buffer.append": {
        // If your session has some concept of "when the audio started," track it here:
        if (session.latestMediaTimestamp === undefined) {
          session.latestMediaTimestamp = Date.now();
        }
        console.log(`Received audio chunk of size: ${event.data.audio.length}`);
        // Forward the base64 audio to the frontend:
        // This is base64 PCM or WAV, depending on your session config
        //jsonSend(session.frontendConn, {type: "audio_append", audio: event.audio});
        break;
      }

      case "response.audio.delta": {
        // If your session has some concept of "when the response started," track it here:
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) {
          session.lastAssistantItem = event.item_id;
        }

        // Forward the base64 audio to the frontend:
        // This is base64 PCM or WAV, depending on your session config
        const pcmData = Buffer.from(event.delta, 'base64'); // Decode base64 to raw PCM
        const wavData = encodeWAV(pcmData);

        //fs.writeFileSync('output.wav', wavData);

        jsonSend(session.frontendConn, {type: "audio_delta", delta: Buffer.from(wavData).toString('base64'), item_id: event.item_id}, 'FRONTEND_handleModelMessage_response.audio.delta');
        break;
      }
    
    case 'response.content_part.done': {
        // Example: handle content_part.done event
        // This event is sent for each part of a multipart response (e.g. a long text response or a response with multiple audio segments)
        // You can use this event to stream the response to the client or to perform other actions based on the response parts
        console.log("Received response content part:", event);

        // Example: send audio deltas to the client
        if (event.audio) {
          // Forward the base64 audio to the frontend:
          // This is base64 PCM or WAV, depending on your session config
          jsonSend(session.frontendConn, {type: "audio_delta", delta: event.audio, item_id: event.item_id}, 'FRONTEND_handleModelMessage_response.content_part.done');
        }
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
              jsonSend(session.modelConn, { type: "response.create" }, 'handleModelMessage_response.output_item.done');
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
    }, 'handleTruncation');
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

function jsonSend(ws, obj, source) {
    console.log("JSON SEND SOURCE:", source, "isOpen", isOpen(ws), "WS state", ws.readyState);
    //console.debug("WS", ws);
    //console.debug("obj", obj);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(`[${source}] WebSocket not open. Message not sent:`, obj);
    //messageQueue.push(obj);
    return;
  }
  if (!isOpen(ws)) return;
  // convert obj to loggable obj (replace obj.delta with obj.delta.length)
  let loggableObj = { ...obj };
  if (loggableObj.delta) {
    loggableObj.delta = loggableObj.delta.length;
  }
  console.log("Sending to ws:", isOpen(ws), loggableObj);
  ws.send(JSON.stringify(obj));
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
    handleModelConnection,
    handleFrontendConnection,
    closeAllConnections,
    jsonSend,
    isOpen,
};
