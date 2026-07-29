from __future__ import annotations

import os
import tempfile
import threading

from fastapi import FastAPI, HTTPException, Request
from faster_whisper import WhisperModel


MODEL_NAME = os.getenv("MEI_STT_MODEL", "Systran/faster-whisper-small")
MAX_AUDIO_BYTES = 8 * 1024 * 1024

app = FastAPI(title="Mei Ling Local STT", docs_url=None, redoc_url=None)
model: WhisperModel | None = None
model_lock = threading.Lock()


def get_model() -> WhisperModel:
    global model
    if model is None:
        model = WhisperModel(
            MODEL_NAME,
            device="cpu",
            compute_type="int8",
            cpu_threads=min(8, os.cpu_count() or 4),
        )
    return model


def warm_default_model() -> None:
    import wave

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_path = temp_file.name
        with wave.open(temp_path, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16_000)
            wav_file.writeframes(b"\x00\x00" * 8_000)
        with model_lock:
            recognizer = get_model()
            segments, _ = recognizer.transcribe(
                temp_path,
                language="it",
                beam_size=1,
                vad_filter=False,
                condition_on_previous_text=False,
            )
            list(segments)
    except Exception:
        pass
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@app.on_event("startup")
def start_model_warmup() -> None:
    threading.Thread(target=warm_default_model, daemon=True).start()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "device": "cpu",
        "model": MODEL_NAME,
        "model_loaded": model is not None,
    }


@app.post("/transcribe")
async def transcribe(request: Request) -> dict[str, object]:
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "Audio is required")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio exceeds 8 MB")

    content_type = request.headers.get("content-type", "")
    suffix = ".wav" if "wav" in content_type else ".ogg" if "ogg" in content_type else ".webm"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio)
            temp_path = temp_file.name

        with model_lock:
            segments, info = get_model().transcribe(
                temp_path,
                language=None,
                task="transcribe",
                beam_size=3,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 450},
                condition_on_previous_text=False,
                multilingual=True,
                hotwords="Miura Mei Ling Twitch YouTube Instagram Kojima FromSoftware",
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()

        language = info.language if info.language in {"it", "en"} else "it"
        return {
            "text": text,
            "language": language,
            "language_probability": round(float(info.language_probability or 0.0), 4),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, f"Transcription failed: {type(error).__name__}") from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=5180, log_level="info", workers=1)
