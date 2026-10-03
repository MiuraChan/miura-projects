import unittest

import numpy as np

import local_voice


class LocalVoiceProsodyTests(unittest.TestCase):
    def test_sentences_get_short_bounded_pauses(self) -> None:
        phrases = local_voice.prepare_speech_phrases(
            "Ci sono, Miura. Da dove partiamo? Perfetto!",
            "it",
        )

        self.assertEqual(
            [phrase.text for phrase in phrases],
            ["Ci sono, Miura.", "Da dove partiamo?", "Perfetto!"],
        )
        self.assertAlmostEqual(phrases[0].pause_after_seconds, 0.18)
        self.assertAlmostEqual(phrases[1].pause_after_seconds, 0.19)
        self.assertEqual(phrases[-1].pause_after_seconds, 0.0)
        self.assertLessEqual(
            max(phrase.pause_after_seconds for phrase in phrases),
            0.28,
        )

    def test_paragraph_break_is_a_breath_not_a_dead_gap(self) -> None:
        phrases = local_voice.prepare_speech_phrases(
            "Prima controlliamo i dati.\nPoi scegliamo insieme.",
            "it",
        )

        self.assertEqual(len(phrases), 2)
        self.assertAlmostEqual(phrases[0].pause_after_seconds, 0.28)
        self.assertEqual(phrases[1].pause_after_seconds, 0.0)

    def test_prosody_varies_slightly_without_changing_identity(self) -> None:
        phrases = local_voice.prepare_speech_phrases(
            "Va bene. Vuoi provarci adesso? Questa volta ci siamo!",
            "it",
        )

        speeds = {round(phrase.speed, 3) for phrase in phrases}
        self.assertGreater(len(speeds), 1)
        self.assertTrue(all(0.92 <= phrase.speed <= 1.04 for phrase in phrases))
        self.assertGreater(phrases[-1].energy, phrases[0].energy)
        self.assertEqual(local_voice.VOICE_IDS["it"], local_voice.VOICE_IDS["en"])
        self.assertTrue(local_voice.VOICE_IDS["it"].startswith("if_"))

    def test_shape_audio_removes_long_model_silence_and_fades_edges(self) -> None:
        lead = np.zeros(int(local_voice.SAMPLE_RATE * 0.50), dtype=np.float32)
        tone = np.full(int(local_voice.SAMPLE_RATE * 0.20), 0.5, dtype=np.float32)
        tail = np.zeros(int(local_voice.SAMPLE_RATE * 0.80), dtype=np.float32)

        shaped = local_voice.shape_phrase_audio(
            np.concatenate([lead, tone, tail]),
            energy=1.2,
        )

        self.assertLess(shaped.size, int(local_voice.SAMPLE_RATE * 0.30))
        self.assertAlmostEqual(float(shaped[0]), 0.0, places=6)
        self.assertAlmostEqual(float(shaped[-1]), 0.0, places=6)
        self.assertLessEqual(float(np.max(np.abs(shaped))), 0.96001)


if __name__ == "__main__":
    unittest.main()
