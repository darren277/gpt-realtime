""""""
import uuid

def update():
    event_id = str(uuid.uuid4()).replace('-', '')[:32]

    return {
        "event_id": event_id,
        "type": "session.update",
        "session": {
            "modalities": ["text", "audio"],
            "instructions": "You are a helpful assistant.",
            "voice": "sage",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "input_audio_transcription": {
                "model": "whisper-1"
            },
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500,
                "create_response": True
            },
            "tools": [
                {
                    "type": "function",
                    "name": "get_weather",
                    "description": "Get the current weather...",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": { "type": "string" }
                        },
                        "required": ["location"]
                    }
                }
            ],
            "tool_choice": "auto",
            "temperature": 0.8,
            "max_response_output_tokens": "inf"
        }
    }

def create_item(msg: str):
    event_id = str(uuid.uuid4()).replace('-', '')[:32]
    msg_id = str(uuid.uuid4()).replace('-', '')[:32]

    return {
        "event_id": event_id,
        "type": "conversation.item.create",
        "previous_item_id": None,
        "item": {
            "id": "msg_001",
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": msg
                }
            ]
        }
    }

def create_response():
    event_id = str(uuid.uuid4()).replace('-', '')[:32]

    return {
        "event_id": event_id,
        "type": "response.create",
        "response": {
            "modalities": ["text", "audio"],
            "instructions": "Please assist the user.",
            "voice": "sage",
            "output_audio_format": "pcm16",
            "tools": [
                {
                    "type": "function",
                    "name": "calculate_sum",
                    "description": "Calculates the sum of two numbers.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "a": {"type": "number"},
                            "b": {"type": "number"}
                        },
                        "required": ["a", "b"]
                    }
                }
            ],
            "tool_choice": "auto",
            "temperature": 0.8,
            "max_output_tokens": 1024
        }
    }

def truncate(audio_end_ms: int):
    event_id = str(uuid.uuid4()).replace('-', '')[:32]

    return {
        "event_id": event_id,
        "type": "conversation.item.truncate",
        "item_id": "msg_002",
        "content_index": 0,
        #"audio_end_ms": 1500
        "audio_end_ms": audio_end_ms
    }
