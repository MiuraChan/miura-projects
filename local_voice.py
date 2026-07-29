from __future__ import annotations

import io
import os
import threading
import traceback
from typing import Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


MODEL_ID = "hexgrad/Kokoro-82M"
VOICE_ID = os.getenv("MEI_KOKORO_VOICE", "if_sara")
SAMPLE_RATE = 24_000
SPEED = float(os.getenv("MEI_KOKORO_SPEED", "0.92"))
LANG_CODES = {"it": "i", "en": "a"}

app = FastAPI(title="Mei Ling Local Voice", docs_url=None, redoc_url=None)
pipelines: dict[str, object] = {}
model_lock = threading.Lock()


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


def warm_default_voice() -> None:
    try:
        with model_lock:
            get_pipeline("it")
    except Exception:
        traceback.print_exc()


@app.on_event("startup")
def start_voice_warmup() -> None:
    threading.Thread(target=warm_default_voice, daemon=True).start()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "backend": "Kokoro-82M",
        "device": "cpu",
        "model_loaded": bool(pipelines),
        "loaded_languages": sorted(pipelines),
        "voice": VOICE_ID,
        "languages": sorted(LANG_CODES),
        "speed": SPEED,
    }


@app.post("/speech")
def speech(payload: SpeechRequest) -> Response:
    try:
        with model_lock:
            pipeline = get_pipeline(payload.language)
            segments: list[np.ndarray] = []
            for result in pipeline(
                payload.text.strip(),
                voice=VOICE_ID,
                speed=SPEED,
                split_pattern=r"\n+",
            ):
                audio = result.audio if hasattr(result, "audio") else result[2]
                segment = as_numpy(audio)
                if segment.size:
                    segments.append(segment)

            if not segments:
                raise RuntimeError("Kokoro returned no audio")

            if len(segments) == 1:
                waveform = segments[0]
            else:
                pause = np.zeros(int(SAMPLE_RATE * 0.12), dtype=np.float32)
                joined: list[np.ndarray] = []
                for index, segment in enumerate(segments):
                    if index:
                        joined.append(pause)
                    joined.append(segment)
                waveform = np.concatenate(joined)

        output = io.BytesIO()
        sf.write(output, waveform, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return Response(output.getvalue(), media_type="audio/wav")
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(
            500,
            f"Voice generation failed: {type(error).__name__}",
        ) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=5179, log_level="info")