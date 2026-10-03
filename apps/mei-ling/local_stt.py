from __future__ import annotations

import os
import re
import tempfile
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


MODEL_NAME = os.getenv("MEI_STT_MODEL", "Systran/faster-whisper-small")
WAKE_MODEL_NAME = os.getenv(
    "MEI_WAKE_STT_MODEL", "Systran/faster-whisper-tiny"
)
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_WAKE_AUDIO_BYTES = 2 * 1024 * 1024
DEFAULT_TRANSCRIPTION_LANGUAGE = "it"
SUPPORTED_TRANSCRIPTION_LANGUAGES = {"it", "en"}


class WakeModelUnavailable(RuntimeError):
    pass


app = FastAPI(title="Mei Ling Local STT", docs_url=None, redoc_url=None)
model: WhisperModel | None = None
model_lock = threading.Lock()
wake_model: WhisperModel | None = None
wake_model_lock = threading.Lock()
wake_state_lock = threading.Lock()
wake_model_attempted = False
wake_model_error: str | None = None
state_lock = threading.Lock()
model_ready = False
model_warming = False
model_error: str | None = None
KNOWN_HALLUCINATIONS = {
    "grazie per aver guardato",
    "grazie per la visione",
    "sottotitoli creati dalla comunità amara org",
    "sottotitoli e revisione a cura di",
    "thanks for watching",
    "thank you for watching",
    "www mooji org",
    "miura mei ling twitch youtube instagram kojima fromsoftware",
}


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


def get_wake_model() -> WhisperModel:
    """Load a small wake model from the local cache without network access."""
    global wake_model, wake_model_attempted, wake_model_error
    with wake_state_lock:
        if wake_model is not None:
            return wake_model
        if wake_model_attempted:
            raise WakeModelUnavailable(wake_model_error or "wake model unavailable")
        wake_model_attempted = True

    try:
        loaded_model = WhisperModel(
            WAKE_MODEL_NAME,
            device="cpu",
            compute_type="int8",
            cpu_threads=min(4, os.cpu_count() or 2),
            local_files_only=True,
        )
    except Exception as error:
        with wake_state_lock:
            wake_model_error = type(error).__name__
        raise WakeModelUnavailable("wake model unavailable") from error

    with wake_state_lock:
        wake_model = loaded_model
        wake_model_error = None
        return wake_model


def set_model_state(
    *,
    ready: bool | None = None,
    warming: bool | None = None,
    error: Exception | None = None,
) -> None:
    global model_ready, model_warming, model_error
    with state_lock:
        if ready is not None:
            model_ready = ready
            if ready:
                model_error = None
        if warming is not None:
            model_warming = warming
        if error is not None:
            model_error = type(error).__name__


def normalize_transcript_text(value: str) -> str:
    return re.sub(r"[^\w]+", " ", value.casefold(), flags=re.UNICODE).strip()


def is_known_hallucination(value: str) -> bool:
    normalized = normalize_transcript_text(value)
    if not normalized:
        return True
    if normalized in KNOWN_HALLUCINATIONS:
        return True
    return any(
        known in normalized and len(normalized) <= len(known) + 24
        for known in KNOWN_HALLUCINATIONS
    )


def requested_transcription_language(request: Request) -> str:
    """Resolve the conversational language without trusting arbitrary headers."""
    raw_language = request.headers.get("x-mei-language", "").strip().casefold()
    language = raw_language.replace("_", "-").split("-", 1)[0]
    if language in SUPPORTED_TRANSCRIPTION_LANGUAGES:
        return language
    return DEFAULT_TRANSCRIPTION_LANGUAGE


def is_low_confidence_segment(segment: object) -> bool:
    no_speech_probability = float(getattr(segment, "no_speech_prob", 0.0) or 0.0)
    average_log_probability = float(getattr(segment, "avg_logprob", 0.0) or 0.0)
    compression_ratio = float(getattr(segment, "compression_ratio", 0.0) or 0.0)
    # Reject only decisive silence or decoding failures. Conversational Italian
    # can have a moderately low log-probability because of names and anglicisms.
    if no_speech_probability >= 0.9:
        return True
    if average_log_probability <= -2.0:
        return True
    if no_speech_probability >= 0.65 and average_log_probability <= -0.8:
        return True
    return compression_ratio >= 2.6 and average_log_probability <= -0.65


def warm_default_model() -> None:
    import wave

    temp_path = ""
    set_model_state(warming=True)
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
                best_of=1,
                temperature=0.0,
                vad_filter=False,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            list(segments)
        set_model_state(ready=True)
    except Exception as error:
        set_model_state(ready=False, error=error)
    finally:
        set_model_state(warming=False)
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@app.on_event("startup")
def start_model_warmup() -> None:
    threading.Thread(target=warm_default_model, daemon=True).start()


@app.get("/health")
def health() -> JSONResponse:
    with state_lock:
        ready = model_ready
        warming = model_warming
        error = model_error
    with wake_state_lock:
        wake_loaded = wake_model is not None
        wake_attempted = wake_model_attempted
        wake_error = wake_model_error
    payload = {
        "ok": ready,
        "ready": ready,
        "device": "cpu",
        "model": MODEL_NAME,
        "model_loaded": model is not None,
        "warming": warming,
        "error": error,
        "wake": {
            "model": WAKE_MODEL_NAME,
            "model_loaded": wake_loaded,
            "load_attempted": wake_attempted,
            "error": wake_error,
        },
    }
    return JSONResponse(payload, status_code=200 if ready else 503)


@app.post("/transcribe")
async def transcribe(request: Request) -> dict[str, object]:
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "Audio is required")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio exceeds 8 MB")

    preferred_language = requested_transcription_language(request)
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
                language=preferred_language,
                task="transcribe",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=False,
                condition_on_previous_text=False,
                multilingual=False,
                without_timestamps=True,
            )
            candidates = list(segments)

        accepted = [
            segment.text.strip()
            for segment in candidates
            if segment.text.strip()
            and not is_known_hallucination(segment.text)
            and not is_low_confidence_segment(segment)
        ]
        text = " ".join(accepted).strip()
        set_model_state(ready=True)

        return {
            "text": text,
            "language": preferred_language,
            "language_probability": round(float(info.language_probability or 0.0), 4),
            "segments_total": len(candidates),
            "segments_accepted": len(accepted),
            "segments_filtered": len(candidates) - len(accepted),
        }
    except HTTPException:
        raise
    except Exception as error:
        if model is None:
            set_model_state(ready=False, error=error)
        raise HTTPException(500, f"Transcription failed: {type(error).__name__}") from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@app.post("/wake/transcribe")
async def transcribe_wake_phrase(request: Request) -> dict[str, object]:
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "Audio is required")
    if len(audio) > MAX_WAKE_AUDIO_BYTES:
        raise HTTPException(413, "Wake audio exceeds 2 MB")

    content_type = request.headers.get("content-type", "")
    preferred_language = requested_transcription_language(request)
    suffix = ".wav" if "wav" in content_type else ".ogg" if "ogg" in content_type else ".webm"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio)
            temp_path = temp_file.name

        with wake_model_lock:
            try:
                recognizer = get_wake_model()
            except WakeModelUnavailable as error:
                raise HTTPException(
                    503,
                    "Wake model is not installed locally; set MEI_WAKE_STT_MODEL "
                    "to an installed faster-whisper model or local model path",
                ) from error

            segments, info = recognizer.transcribe(
                temp_path,
                language=preferred_language,
                task="transcribe",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 250},
                condition_on_previous_text=False,
                multilingual=False,
                without_timestamps=True,
                initial_prompt="Hey Mei Ling, ci sei? Ehi Mei Ling, ci sei?",
                hotwords="Hey Mei Ling Meiling ci sei",
            )
            candidates = list(segments)

        accepted = [
            segment.text.strip()
            for segment in candidates
            if segment.text.strip()
            and not is_known_hallucination(segment.text)
            and not is_low_confidence_segment(segment)
        ]
        text = " ".join(accepted).strip()
        language = preferred_language
        return {
            "text": text,
            "language": language,
            "language_probability": round(float(info.language_probability or 0.0), 4),
            "segments_total": len(candidates),
            "segments_accepted": len(accepted),
            "segments_filtered": len(candidates) - len(accepted),
            "model": WAKE_MODEL_NAME,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            500, f"Wake transcription failed: {type(error).__name__}"
        ) from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@app.post("/fast/transcribe")
async def transcribe_fast(request: Request) -> dict[str, object]:
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

        with wake_model_lock:
            try:
                recognizer = get_wake_model()
            except WakeModelUnavailable as error:
                raise HTTPException(
                    503,
                    "Fast model is not installed locally; set MEI_WAKE_STT_MODEL "
                    "to an installed faster-whisper model or local model path",
                ) from error

            segments, info = recognizer.transcribe(
                temp_path,
                language=None,
                task="transcribe",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
                condition_on_previous_text=False,
                multilingual=True,
                without_timestamps=True,
            )
            candidates = list(segments)

        accepted = [
            segment.text.strip()
            for segment in candidates
            if segment.text.strip()
            and not is_known_hallucination(segment.text)
            and not is_low_confidence_segment(segment)
        ]
        text = " ".join(accepted).strip()
        language = info.language if info.language in {"it", "en"} else "it"
        return {
            "text": text,
            "language": language,
            "language_probability": round(float(info.language_probability or 0.0), 4),
            "segments_total": len(candidates),
            "segments_accepted": len(accepted),
            "segments_filtered": len(candidates) - len(accepted),
            "model": WAKE_MODEL_NAME,
            "fast": True,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            500, f"Fast transcription failed: {type(error).__name__}"
        ) from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("MEI_STT_PORT", "5180")), log_level="info", workers=1)
