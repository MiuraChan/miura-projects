import unittest
from types import SimpleNamespace
from unittest import mock

import local_stt


class FakeRequest:
    def __init__(self, audio: bytes, headers: dict[str, str]) -> None:
        self._audio = audio
        self.headers = headers

    async def body(self) -> bytes:
        return self._audio


class LocalTranscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_conversation_audio_is_not_filtered_by_a_second_vad(self) -> None:
        segment = SimpleNamespace(
            text="Sì, ti sento bene",
            no_speech_prob=0.05,
            avg_logprob=-0.15,
            compression_ratio=1.0,
        )
        info = SimpleNamespace(language_probability=0.98)
        recognizer = mock.Mock()
        recognizer.transcribe.return_value = ([segment], info)
        request = FakeRequest(
            b"fake-webm-audio",
            {
                "content-type": "audio/webm",
                "x-mei-language": "it-IT",
            },
        )

        with mock.patch.object(local_stt, "get_model", return_value=recognizer):
            payload = await local_stt.transcribe(request)

        self.assertEqual(payload["text"], "Sì, ti sento bene")
        self.assertEqual(payload["language"], "it")
        kwargs = recognizer.transcribe.call_args.kwargs
        self.assertIs(kwargs["vad_filter"], False)
        self.assertNotIn("vad_parameters", kwargs)


if __name__ == "__main__":
    unittest.main()
