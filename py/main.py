""""""
import base64
import uuid

from flask import Flask, request, render_template, jsonify
from flask_socketio import SocketIO, emit
import os
import json
import threading
import websocket
from dotenv import load_dotenv
import requests
import subprocess
import tempfile

SESSION_ENDPOINT = "https://api.openai.com/v1/realtime/sessions"
CLIENT_SECRET = None
SESSION_ID = None

load_dotenv()

app = Flask(__name__)

app.config['SECRET_KEY'] = 'your-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

# Global variable to store the WebSocketApp instance
ws_app = None
ws_thread = None

url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
headers = [
    "Authorization: Bearer " + OPENAI_API_KEY,
    "OpenAI-Beta: realtime=v1"
]

def on_open(ws):
    print("Connected to server.")

def on_message(ws, message):
    data = json.loads(message)
    print("Received event from OpenAI:", json.dumps(data, indent=2))
    # Forward specific events to the connected front-end clients
    socketio.emit('openai_event', data)

def run_websocket():
    global ws_app

    if CLIENT_SECRET is None:
        print("No client secret, cannot start WebSocket. Call /init_session first.")
        return

    realtime_url = f"wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
    headers = [
        "Authorization: Bearer " + CLIENT_SECRET,
        "OpenAI-Beta: realtime=v1"
    ]

    ws_app = websocket.WebSocketApp(
        realtime_url,
        header=headers,
        on_open=on_open,
        on_message=on_message,
    )
    ws_app.run_forever()

@app.route('/init_session', methods=['POST'])
def init_session():
    global CLIENT_SECRET, SESSION_ID

    payload = {
        "model": "gpt-4o-realtime-preview-2024-12-17",
        "modalities": ["text", "audio"],
        "instructions": "You are a helpful assistant.",
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm16",
        "input_audio_transcription": {"model": "whisper-1"}
    }

    response = requests.post(
        SESSION_ENDPOINT,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        json=payload
    )

    if response.status_code == 200:
        data = response.json()
        SESSION_ID = data.get("id")
        CLIENT_SECRET = data.get("client_secret", {}).get("value")

        if not CLIENT_SECRET:
            return "No client secret returned.", 500

        return jsonify({"session_id": SESSION_ID, "client_secret": CLIENT_SECRET})
    else:
        return f"Failed to create session: {response.text}", response.status_code

@app.route('/start', methods=['GET'])
def start():
    global ws_thread

    thread = threading.Thread(target=run_websocket)
    thread.daemon = True
    thread.start()
    return "WebSocket connection started!"

@app.route('/send', methods=['POST'])
def send_message():
    global ws_app

    if ws_app and ws_app.sock and ws_app.sock.connected:
        message = request.json.get('message', '')
        if message:
            ws_app.send(json.dumps({
                "type": "response.create",
                "response": {
                    "modalities": ["text"],
                    "instructions": message
                }
            }))
            return "Message sent!"
        else:
            return "No message provided.", 400
    else:
        return "WebSocket not connected.", 503

@app.route('/truncate_audio', methods=['POST'])
def truncate_audio():
    global ws_app

    if ws_app and ws_app.ws:
        truncate_event = request.get_json()
        # Expected structure:
        # {
        #   "event_id": "...",
        #   "type": "conversation.item.truncate",
        #   "item_id": "...",
        #   "content_index": 0,
        #   "audio_end_ms": ...
        # }

        if 'type' not in truncate_event or truncate_event['type'] != 'conversation.item.truncate':
            return "Invalid event type.", 400

        ws_app.send(json.dumps(truncate_event))
        return "Truncation event sent!"
    else:
        return "WebSocket not connected.", 503

@app.route('/conversation_item_create', methods=['POST'])
def conversation_item_create():
    global ws_app

    if 'audio' not in request.files:
        return "No audio file provided.", 400

    audio_file = request.files['audio']
    audio_data = audio_file.read()

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_in:
        temp_in.write(audio_data)
        input_path = temp_in.name

        ffmpeg_cmd = [
            "ffmpeg",
            "-i", input_path,
            "-ar", "24000",  # Resample to 24kHz
            "-ac", "1",  # Mono
            "-f", "s16le",  # Raw PCM16
            "pipe:1"  # Output to stdout
        ]

        process = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        pcm_data, err = process.communicate()

        if process.returncode != 0:
            print("ffmpeg error:", err.decode('utf-8'))
            return "Error processing audio", 500

        audio_b64 = base64.b64encode(pcm_data).decode('utf-8')

        event_id = str(uuid.uuid4()).replace('-', '')[:32]
        item_id = str(uuid.uuid4()).replace('-', '')[:32]

        event = {
            "event_id": event_id,
            "type": "conversation.item.create",
            "previous_item_id": None,
            "item": {
                "id": item_id,
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "audio": audio_b64
                    }
                ]
            }
        }

        if ws_app and ws_app.sock and ws_app.sock.connected:
            ws_app.send(json.dumps(event))
            return jsonify({"status": "ok", "event_id": event_id, "item_id": item_id})
        else:
            return "WebSocket not connected.", 503

@app.route('/')
def home():
    return render_template('index.html')

# ----------------------------
# Front-End WebSocket Handlers
# ----------------------------
@socketio.on('connect')
def handle_connect():
    print("Front-end client connected")
    emit("connect_response", {"message": "Connected to backend WebSocket!"})

@socketio.on('disconnect')
def handle_disconnect():
    print("Front-end client disconnected")

@socketio.on('client_event')
def handle_client_event(data):
    print("Received event from front-end:", data)
    # Process the data or even route it to OpenAI as needed.
    # For example, to send a message to OpenAI:
    if ws_app and ws_app.sock and ws_app.sock.connected:
        ws_app.send(json.dumps({
            "type": "response.create",
            "response": {
                "modalities": ["text"],
                "instructions": data.get('message', '')
            }
        }))
    emit("server_response", {"message": "Event processed"})


if __name__ == '__main__':
    socketio.run(app, debug=True, port=5659, allow_unsafe_werkzeug=True)
