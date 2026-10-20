import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('vocal_worker', Path(__file__).parents[1] / 'scripts/vocal-worker.py')
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class VocalWorkerTests(unittest.TestCase):
    def test_overlapping_chunks_blend_smoothly_instead_of_jumping(self):
        import numpy as np
        output=np.zeros(60)
        total=np.zeros(60)
        for start,end,left,right in worker.chunk_ranges(60,30,3):
            weights=worker.overlap_weights(start,end,left,right,3)
            output[left:right]+=weights*(0 if start==0 else 1)
            total[left:right]+=weights
        output/=total
        self.assertTrue(np.all(total>0))
        self.assertLessEqual(np.max(np.abs(np.diff(output))), 1/6 + 1e-6)

    def test_flac_writer_preserves_samples_and_bounds_each_write(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as directory:
            samples = np.linspace(-0.5, 0.5, 200, dtype='float32').reshape(2,100)
            path = Path(directory)/'output.flac'
            worker.save_flac(path, samples, 44100, chunk=17)
            decoded, rate = sf.read(path, dtype='float32', always_2d=True)
            self.assertEqual(rate, 44100)
            np.testing.assert_allclose(decoded.T, samples, atol=2**-22)

    def test_extended_formats_decode_locally_and_leave_source_unchanged(self):
        import soundfile as sf
        source=Path(__file__).parent/'fixtures/tone.dsf'
        before=worker.source_digest(source)
        with tempfile.TemporaryDirectory() as directory:
            decoded=worker.convert_audio(source,Path(directory)/'decoded.flac')
            info=sf.info(decoded)
            self.assertEqual(info.samplerate,44100)
            self.assertEqual(info.channels,2)
            self.assertGreater(info.frames,0)
        self.assertEqual(worker.source_digest(source),before)

    def test_corrupt_model_is_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/'htdemucs.safetensors').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):
                worker.verify_model(Path(directory))

    def test_instrumental_excludes_vocals(self):
        import numpy as np
        stems = {name: np.full((2, 4), value) for name, value in [('vocals', 20), ('drums', 1), ('bass', 2), ('other', 3)]}
        np.testing.assert_array_equal(worker.instrumental(stems), np.full((2, 4), 6))

    def test_source_fingerprint_changes_when_content_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'song.flac'
            path.write_bytes(b'abcd')
            before = worker.source_digest(path)
            path.write_bytes(b'efgh')
            self.assertNotEqual(before, worker.source_digest(path))

    def test_output_cannot_overwrite_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'song.flac'
            path.write_bytes(b'original')
            with self.assertRaises(ValueError):
                worker.validate_paths(path, path)
            self.assertEqual(path.read_bytes(), b'original')

    def test_chunk_ranges_cover_every_sample_with_context(self):
        ranges = list(worker.chunk_ranges(100, 30, 5))
        self.assertEqual([(start, end) for start, end, _, _ in ranges], [(0,30),(30,60),(60,90),(90,100)])
        self.assertEqual(ranges[1], (30,60,25,65))


if __name__ == '__main__':
    unittest.main()
