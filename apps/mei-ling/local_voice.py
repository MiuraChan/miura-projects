from __future__ import annotations

import io
import os
import re
import threading
import traceback
from dataclasses import dataclass
from typing import Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field


MODEL_ID = "hexgrad/Kokoro-82M"
VOICE_ID = os.getenv("MEI_KOKORO_VOICE", "if_sara")
SAMPLE_RATE = 24_000
SPEED = float(os.getenv("MEI_KOKORO_SPEED", "0.97"))
LANG_CODES = {"it": "i", "en": "a"}
VOICE_IDS = {
    "it": os.getenv("MEI_KOKORO_VOICE_IT", VOICE_ID),
    # Keeping one timbre across languages makes Mei Ling sound like the same
    # person. The English pipeline still supplies English pronunciation.
    "en": os.getenv("MEI_KOKORO_VOICE_EN", VOICE_ID),
}
LANGUAGE_SPEEDS = {
    "it": float(os.getenv("MEI_KOKORO_SPEED_IT", str(SPEED))),
    "en": float(os.getenv("MEI_KOKORO_SPEED_EN", str(min(SPEED + 0.01, 1.04)))),
}

_SENTENCE_BOUNDARY = re.compile(r'([.!?\u2026]+["\u201d\u2019\u00bb)\]]*)\s+')
_WORD = re.compile(r"[\w\u00c0-\u024f]+(?:['\u2019][\w\u00c0-\u024f]+)?", re.UNICODE)


@dataclass(frozen=True)
class SpeechPhrase:
    text: str
    speed: float
    pause_after_seconds: float
    energy: float

app = FastAPI(title="Mei Ling Local Voice", docs_url=None, redoc_url=None)
pipelines: dict[str, object] = {}
model_lock = threading.Lock()
state_lock = threading.Lock()
ready_languages: set[str] = set()
warming_languages: set[str] = set()
language_errors: dict[str, str] = {}


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: Literal["it", "en"] = "it"


def get_pipeline(language: str) -> object:
    pipeline = pipelines.get(language)
    if pipeline is None:
        from kokoro import KPipeline

        pipeline = KPipeline(
            lang_code=LANG_CODES[language],
            repo_id=MODEL_ID,
            device="cpu",
        )
        pipelines[language] = pipeline
    return pipeline


def as_numpy(audio: object) -> np.ndarray:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)


def _sentence_parts(paragraph: str) -> list[str]:
    marked = _SENTENCE_BOUNDARY.sub(lambda match: f"{match.group(1)}\n", paragraph)
    return [part.strip() for part in marked.splitlines() if part.strip()]


def _ending_kind(text: str) -> str:
    ending = text.rstrip('"\u201d\u2019\u00bb)] ')
    if ending.endswith("?"):
        return "question"
    if ending.endswith("!"):
        return "exclamation"
    if ending.endswith("\u2026") or ending.endswith("..."):
        return "ellipsis"
    if ending.endswith("."):
        return "statement"
    return "open"


def _phrase_speed(text: str, language: str, kind: str) -> float:
    speed = LANGUAGE_SPEEDS[language]
    word_count = len(_WORD.findall(text))

    # Small, deterministic changes keep consecutive sentences from sounding
    # mechanically identical without pretending to infer an emotion.
    if word_count <= 4:
        speed -= 0.018
    elif word_count >= 22:
        speed += 0.018
    if kind == "question":
        speed -= 0.006
    elif kind == "exclamation":
        speed += 0.012
    elif kind == "ellipsis":
        speed -= 0.010
    return float(np.clip(speed, 0.92, 1.04))


def _pause_after(kind: str, paragraph_break: bool) -> float:
    if paragraph_break:
        return 0.28
    return {
        "question": 0.19,
        "exclamation": 0.15,
        "ellipsis": 0.22,
        "statement": 0.18,
        "open": 0.12,
    }[kind]


def prepare_speech_phrases(text: str, language: str) -> list[SpeechPhrase]:
    clean_text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    paragraphs = [
        re.sub(r"[ \t]+", " ", paragraph).strip()
        for paragraph in re.split(r"\n+", clean_text)
        if paragraph.strip()
    ]
    phrases: list[SpeechPhrase] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        parts = _sentence_parts(paragraph)
        for part_index, part in enumerate(parts):
            kind = _ending_kind(part)
            last_in_paragraph = part_index == len(parts) - 1
            paragraph_break = (
                last_in_paragraph and paragraph_index < len(paragraphs) - 1
            )
            energy = 1.035 if kind == "exclamation" else 1.012 if kind == "question" else 1.0
            phrases.append(
                SpeechPhrase(
                    text=part,
                    speed=_phrase_speed(part, language, kind),
                    pause_after_seconds=_pause_after(kind, paragraph_break),
                    energy=energy,
                )
            )
    if phrases:
        final_phrase = phrases[-1]
        phrases[-1] = SpeechPhrase(
            text=final_phrase.text,
            speed=final_phrase.speed,
            pause_after_seconds=0.0,
            energy=final_phrase.energy,
        )
    return phrases


def shape_phrase_audio(audio: np.ndarray, energy: float = 1.0) -> np.ndarray:
    waveform = np.nan_to_num(
        np.asarray(audio, dtype=np.float32).reshape(-1),
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )
    if not waveform.size:
        return waveform

    peak = float(np.max(np.abs(waveform)))
    if peak <= 1e-7:
        return waveform

    # Kokoro may include variable amounts of silence around punctuation. Trim it
    # and put back a short, explicit breath so a full stop never becomes a long
    # dead gap.
    threshold = max(0.0008, peak * 0.012)
    active = np.flatnonzero(np.abs(waveform) >= threshold)
    if active.size:
        lead = int(SAMPLE_RATE * 0.028)
        tail = int(SAMPLE_RATE * 0.045)
        start = max(0, int(active[0]) - lead)
        stop = min(waveform.size, int(active[-1]) + tail + 1)
        waveform = waveform[start:stop].copy()
    else:
        waveform = waveform.copy()

    shaped_peak = float(np.max(np.abs(waveform)))
    if shaped_peak > 1e-7:
        waveform *= min(energy, 0.96 / shaped_peak)

    fade_in = min(int(SAMPLE_RATE * 0.007), waveform.size // 2)
    fade_out = min(int(SAMPLE_RATE * 0.012), waveform.size // 2)
    if fade_in:
        waveform[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    if fade_out:
        waveform[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    return waveform


def _render_phrase(pipeline: object, phrase: SpeechPhrase, language: str) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for result in pipeline(
        phrase.text,
        voice=VOICE_IDS[language],
        speed=phrase.speed,
        split_pattern=None,
    ):
        audio = result.audio if hasattr(result, "audio") else result[2]
        chunk = as_numpy(audio)
        if chunk.size:
            chunks.append(chunk)

    if not chunks:
        return np.empty(0, dtype=np.float32)
    if len(chunks) == 1:
        rendered = chunks[0]
    else:
        internal_pause = np.zeros(int(SAMPLE_RATE * 0.07), dtype=np.float32)
        pieces: list[np.ndarray] = []
        for index, chunk in enumerate(chunks):
            if index:
                pieces.append(internal_pause)
            pieces.append(chunk)
        rendered = np.concatenate(pieces)
    return shape_phrase_audio(rendered, phrase.energy)


def generate_waveform(text: str, language: str) -> np.ndarray:
    pipeline = get_pipeline(language)
    phrases = prepare_speech_phrases(text, language)
    segments: list[np.ndarray] = []
    for phrase in phrases:
        segment = _render_phrase(pipeline, phrase, language)
        if not segment.size:
            continue
        segments.append(segment)
        if phrase.pause_after_seconds:
            segments.append(
                np.zeros(
                    int(SAMPLE_RATE * phrase.pause_after_seconds),
                    dtype=np.float32,
                )
            )

    if not segments:
        raise RuntimeError("Kokoro returned no audio")
    return np.concatenate(segments)


def set_language_state(
    language: str,
    *,
    ready: bool | None = None,
    warming: bool | None = None,
    error: Exception | None = None,
) -> None:
    with state_lock:
        if ready is True:
            ready_languages.add(language)
            language_errors.pop(language, None)
        elif ready is False:
            ready_languages.discard(language)
        if warming is True:
            warming_languages.add(language)
        elif warming is False:
            warming_languages.discard(language)
        if error is not None:
            language_errors[language] = type(error).__name__


def warm_default_voice() -> None:
    set_language_state("it", warming=True)
    try:
        with model_lock:
            generate_waveform("Pronta.", "it")
        set_language_state("it", ready=True)
    except Exception as error:
        set_language_state("it", ready=False, error=error)
        traceback.print_exc()
    finally:
        set_language_state("it", warming=False)


@app.on_event("startup")
def start_voice_warmup() -> None:
    threading.Thread(target=warm_default_voice, daemon=True).start()


@app.get("/health")
def health() -> JSONResponse:
    with state_lock:
        ready = "it" in ready_languages
        warming = sorted(warming_languages)
        errors = dict(language_errors)
        ready_snapshot = sorted(ready_languages)
    payload = {
        "ok": ready,
        "ready": ready,
        "backend": "Kokoro-82M",
        "device": "cpu",
        "model_loaded": bool(pipelines),
        "loaded_languages": sorted(pipelines),
        "ready_languages": ready_snapshot,
        "warming_languages": warming,
        "errors": errors,
        "voice": VOICE_ID,
        "voices": dict(VOICE_IDS),
        "languages": sorted(LANG_CODES),
        "speed": SPEED,
        "speeds": dict(LANGUAGE_SPEEDS),
        "prosody": "punctuation-aware-v2",
    }
    return JSONResponse(payload, status_code=200 if ready else 503)


@app.post("/speech")
def speech(payload: SpeechRequest) -> Response:
    try:
        with model_lock:
            waveform = generate_waveform(payload.text, payload.language)
        set_language_state(payload.language, ready=True)

        output = io.BytesIO()
        sf.write(output, waveform, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return Response(output.getvalue(), media_type="audio/wav")
    except Exception as error:
        set_language_state(payload.language, ready=False, error=error)
        traceback.print_exc()
        raise HTTPException(
            500,
            f"Voice generation failed: {type(error).__name__}",
        ) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("MEI_VOICE_PORT", "5179")), log_level="info")
