"""
Tests for tool/midi2tidal.py. Each test builds a MIDI file with the standard
library (tool/tests/midifile.py), runs the converter's command line on it and,
where it plays, evaluates the code in TidalJS (tool/tests/evaluate.mjs, which
needs Node) to compare the notes: counts, pitches, onsets, lengths and levels.

    python tool/tests/test_midi2tidal.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCRIPT = ROOT / "tool" / "midi2tidal.py"
EVALUATE = HERE / "evaluate.mjs"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tool"))

import midifile as mf  # noqa: E402
import midi2tidal  # noqa: E402

PPQ = 96
BAR = 4 * PPQ
NODE = shutil.which("node")


def seconds_at(tick: float, tempos: Sequence[Tuple[int, float]], ppq: int = PPQ) -> float:
    """Elapsed seconds at a tick, from (tick, bpm) changes that start at tick 0 (computed apart from the converter)."""
    elapsed = 0.0
    for i, (at, bpm) in enumerate(tempos):
        until = tempos[i + 1][0] if i + 1 < len(tempos) else float("inf")
        if tick <= at:
            break
        elapsed += (min(tick, until) - at) * 60 / bpm / ppq
    return elapsed


class ConverterTest(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    # -- helpers

    def cli(self, data: Optional[bytes], *args: str, name: str = "song.mid", cwd: Optional[Path] = None) -> subprocess.CompletedProcess:
        path = self.tmp / name
        if data is not None:
            path.write_bytes(data)
        return subprocess.run([sys.executable, str(SCRIPT), str(path) if cwd is None else name, *args],
                              capture_output=True, text=True, encoding="utf-8", cwd=cwd)

    def convert(self, data: bytes, *args: str, name: str = "song.mid") -> str:
        run = self.cli(data, *args, name=name)
        self.assertEqual(run.returncode, 0, run.stderr)
        return run.stdout

    def fails(self, data: Optional[bytes], expected: str, *args: str) -> str:
        run = self.cli(data, *args)
        self.assertEqual(run.returncode, 1, run.stdout)
        self.assertIn(expected, run.stderr)
        self.assertTrue(run.stderr.startswith("midi2tidal: "), run.stderr)
        self.assertNotIn("Traceback", run.stderr)
        return run.stderr

    def evaluate(self, code: str, cycles: float) -> dict:
        if not NODE:
            self.skipTest("Node is needed to evaluate the code in TidalJS")
        path = self.tmp / "code.js"
        path.write_text(code, encoding="utf-8")
        run = subprocess.run([NODE, str(EVALUATE), str(path), repr(cycles)], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["success"], result["error"])
        return result

    def played(self, code: str, cycles: float) -> List[Tuple[float, float, Optional[int]]]:
        """(onset in seconds, length in seconds, MIDI note) of every pitched event, in order."""
        result = self.evaluate(code, cycles)
        cps = result["cps"]
        return [(e["begin"] / cps, (e["end"] - e["begin"]) / cps, e["note"]) for e in result["events"] if e["note"] is not None]

    def assertPlays(self, played, expected, places: int = 3) -> None:
        self.assertEqual(len(played), len(expected), f"{played} vs {expected}")
        for (onset, length, pitch), (x_onset, x_length, x_pitch) in zip(sorted(played, key=lambda e: (round(e[0], 6), e[2])),
                                                                         sorted(expected, key=lambda e: (round(e[0], 6), e[2]))):
            self.assertEqual(pitch, x_pitch, f"{played} vs {expected}")
            self.assertAlmostEqual(onset, x_onset, places=places, msg=f"onset of {pitch}")
            self.assertAlmostEqual(length, x_length, places=places, msg=f"length of {pitch}")

    def header(self, code: str) -> str:
        """The comment lines at the top, with wrapped notes joined back into one line each."""
        text = "\n".join(line for line in code.splitlines() if line.startswith("//"))
        return text.replace("\n//   ", " ")

    # -- 1. Safe JavaScript

    def test_names_become_single_line_comments_and_strings_are_json(self) -> None:
        title = "Lead\nalert('x')\r//   next  */ \"q\" ‮\x85end"
        data = mf.midi(1, PPQ, [mf.track([mf.name(title)] + mf.notes([(0, PPQ, 60, 100), (PPQ, PPQ, 64, 100)]))])
        code = self.convert(data, name="two lines.mid")
        for bad in ("\r", " ", " ", "‮", "\x85"):
            self.assertNotIn(bad, code)
        for line in code.splitlines():
            if "Lead" in line or "lines.mid" in line:
                self.assertTrue(line.lstrip().startswith("//"), line)
        self.assertIn('.sound("superpiano")', code)
        result = self.evaluate(code, 1)
        self.assertFalse(result["injected"])
        self.assertEqual([e["note"] for e in result["events"]], [60, 64])
        # A sound name is a name: anything that could end the string is refused before any code is made.
        run = self.cli(data, "--sound", 'superpiano"); globalThis.injected = 1; ("')
        self.assertEqual(run.returncode, 2)
        self.assertIn("--sound takes a sound name", run.stderr)
        self.assertIn('.sound("bd:3")', self.convert(data, "--sound", "bd:3"))
        # The helpers themselves.
        self.assertEqual(midi2tidal.comment("a\nb c d\re\tf​g"), "a b c d e f g")
        self.assertEqual(midi2tidal.js('a"b\n '), '"a\\"b\\n\\u2028"')

    def test_rows_stay_readable(self) -> None:
        bar = [(0, PPQ, 60, 100), (PPQ, PPQ, 62, 100), (2 * PPQ, 2 * PPQ, 64, 100)]
        items = [(s + b * BAR, n, p, v) for b in range(3) for s, n, p, v in bar] + [(3 * BAR, BAR, 67, 100)]
        code = self.convert(mf.midi(0, PPQ, [mf.track(mf.notes(items))]))
        self.assertIn('    "[c4 d4 e4@2]!3\\n" +\n    "g4"\n  ).slow(4)', code)
        self.assertPlays(self.played(code, 4), [(s * 0.5 / PPQ, n * 0.5 / PPQ, p) for s, n, p, _ in items])

    # -- 2. The grid keeps starts and ends

    def test_automatic_grid_keeps_every_start_and_end(self) -> None:
        items = [(0, 72, 60, 100), (72, 20, 62, 100), (96, 32, 64, 100), (128, 32, 65, 100), (160, 32, 67, 100),
                 (192, 168, 69, 100), (384, 9, 72, 100)]
        code = self.convert(mf.midi(0, PPQ, [mf.track(mf.notes(items))]))
        header = self.header(code)
        for word in ("moved", "changed", "merged", "rounded"):
            self.assertNotIn(word, header)
        self.assertPlays(self.played(code, 2), [(s * 0.5 / PPQ, n * 0.5 / PPQ, p) for s, n, p, _ in items], places=6)

    def test_explicit_grid_reports_what_it_changes_and_keeps_repeats(self) -> None:
        # c4 twice a sixteenth apart, then e4 and g4 off the eighth-note grid.
        items = [(0, 24, 60, 100), (24, 24, 60, 100), (36, 30, 64, 100), (48, 40, 67, 100)]
        code = self.convert(mf.midi(0, PPQ, [mf.track(mf.notes(items))]), "--grid", "2")
        header = self.header(code)
        self.assertIn("note starts moved to the grid", header)
        self.assertIn("note lengths changed by the grid", header)
        self.assertIn("attacks merged with another", header)
        self.assertIn("1 repeated note moved one step later", header)
        played = self.played(code, 1)
        self.assertEqual(sorted(p for _, _, p in played), [60, 60, 64, 67])
        c4 = sorted((onset, length) for onset, length, p in played if p == 60)
        self.assertEqual(c4, [(0.0, 0.25), (0.25, 0.25)], "each c4 keeps its own attack, one after the other")

    # -- 3. Velocity is audible

    def test_velocity_sets_the_level_of_each_note_even_inside_a_chord(self) -> None:
        items = [(0, PPQ, 60, 127), (0, PPQ, 64, 64), (0, PPQ, 67, 100), (PPQ, PPQ, 72, 32), (2 * PPQ, PPQ, 72, 127)]
        data = mf.midi(0, PPQ, [mf.track(mf.notes(items))])
        result = self.evaluate(self.convert(data, "--velocity"), 1)
        levels = {(round(e["begin"], 6), e["note"]): e["level"] for e in result["events"]}
        self.assertEqual(len(levels), 5)
        for start, _, pitch, velocity in items:
            self.assertAlmostEqual(levels[(start / BAR, pitch)], (velocity / 127) ** 2, places=4, msg=f"note {pitch}")
        self.assertAlmostEqual(midi2tidal.amp_of(127), 0.4)
        self.assertAlmostEqual(midi2tidal.amp_of(64) / midi2tidal.amp_of(127), (64 / 127) ** 2)
        # Without --velocity the chord stays one chord, at the normal level.
        plain = self.convert(data)
        self.assertIn("[c4,e4,g4]", plain)
        self.assertEqual({e["level"] for e in self.evaluate(plain, 1)["events"]}, {1})

    # -- 4. Timing at the original positions

    def test_tempo_and_time_signature_changes_keep_every_note_time(self) -> None:
        tempos = [(0, 120), (BAR, 90), (2 * BAR + 2 * PPQ, 150)]
        beats = [(b * PPQ, PPQ // 2, 60 + b % 12, 100) for b in range(12)]  # three bars of 4/4
        beats += [(3 * BAR + b * PPQ, PPQ // 2, 72 + b % 6, 100) for b in range(6)]  # two bars of 3/4
        conductor = mf.track([mf.tempo(t, bpm) for t, bpm in tempos] + [mf.meter(0, 4, 4), mf.meter(3 * BAR, 3, 4)])
        data = mf.midi(1, PPQ, [conductor, mf.track(mf.notes(beats))])
        code = self.convert(data)
        header = self.header(code)
        self.assertIn("the tempo changes 2 times", header)
        self.assertIn("the time signature changes 1 time", header)
        end = seconds_at(3 * BAR + 6 * PPQ, tempos)
        expected = [(seconds_at(s, tempos), seconds_at(s + n, tempos) - seconds_at(s, tempos), p) for s, n, p, _ in beats]
        self.assertPlays(self.played(code, end * 0.5 - 1e-9), expected)

    def test_defaults_hold_until_the_first_tempo_and_meter(self) -> None:
        tempos = [(0, 120), (BAR, 100)]  # nothing at tick 0: 120 bpm and 4/4 until the event
        items = [(b * PPQ, PPQ, 60 + b, 100) for b in range(8)]
        data = mf.midi(1, PPQ, [mf.track([mf.tempo(BAR, 100)]), mf.track(mf.notes(items))])
        code = self.convert(data)
        self.assertIn("setCPS(0.5)", code)
        expected = [(seconds_at(s, tempos), seconds_at(s + n, tempos) - seconds_at(s, tempos), p) for s, n, p, _ in items]
        self.assertPlays(self.played(code, seconds_at(2 * BAR, tempos) * 0.5 - 1e-9), expected)

    def test_smpte_ticks_stay_tied_to_the_clock(self) -> None:
        # 25 frames of 40 ticks: 1000 ticks a second. Tempo events do not move SMPTE time.
        items = [(0, 250, 60, 100), (500, 250, 62, 100), (1000, 250, 64, 100), (1500, 250, 65, 100), (2250, 500, 67, 100)]
        events = [mf.tempo(0, 60), mf.tempo(1000, 240)] + mf.notes(items)
        code = self.convert(mf.midi(0, mf.smpte_division(25, 40), [mf.track(events)]))
        self.assertIn("SMPTE timing (1000 ticks a second)", self.header(code))
        self.assertPlays(self.played(code, 2.75 * 0.25 - 1e-9), [(s / 1000, n / 1000, p) for s, n, p, _ in items])

    def test_format_2_is_rejected(self) -> None:
        data = mf.midi(2, PPQ, [mf.track(mf.notes([(0, PPQ, 60, 100)])), mf.track(mf.notes([(0, PPQ, 64, 100)]))])
        self.fails(data, "format 2 (independent patterns, 2 of them) is not supported")

    # -- 5. Pedal, programs and dropped controls

    def test_sustain_pedal_and_program_changes_at_event_time(self) -> None:
        events = [mf.program(0, 0, 0), mf.control(0, 0, 64, 127), mf.control(0, 0, 7, 100),
                  mf.control(5, 0, 11, 90), mf.control(6, 0, 11, 80), mf.bend(10, 0, 0x2100)]
        events += mf.notes([(0, 48, 60, 100), (48, 48, 64, 100), (0, 24, 67, 100), (96, 24, 67, 100)])
        events += [mf.control(192, 0, 64, 0), mf.program(BAR, 0, 48)] + mf.notes([(BAR, PPQ, 69, 100)])
        code = self.convert(mf.midi(0, PPQ, [mf.track(events)]))
        header = self.header(code)
        self.assertIn("the sustain pedal lengthens 4 notes", header)
        self.assertIn("2 expression messages", header)
        self.assertIn("1 pitch bend message", header)
        self.assertIn("1 volume message", header)
        self.assertIn('.sound("superpiano")', code)
        self.assertIn('.sound("supersaw")', code)
        s = 0.5 / PPQ
        self.assertPlays(self.played(code, 2 - 1e-9), [
            (0, 192 * s, 60),  # held by the pedal until it lifts
            (48 * s, 144 * s, 64),
            (0, 96 * s, 67),  # struck again under the pedal: the first one ends there
            (96 * s, 96 * s, 67),
            (BAR * s, PPQ * s, 69),  # after the program change, on its own line
        ])

    # -- 6. Malformed input and output

    def test_malformed_files_give_clear_errors(self) -> None:
        def one_track(body: bytes, division: int = PPQ) -> bytes:
            return mf.header(0, 1, division) + mf.chunk(b"MTrk", body)

        on = b"\x00\x90\x3c\x40"
        cases = [
            (b"hello world, not midi", "not a Standard MIDI File"),
            (b"MThd\x00\x00", "the header is cut off"),
            (b"MThd" + b"\x00\x00\x00\x04" + b"\x00" * 10, "it needs at least 6"),
            (mf.header(3, 1, PPQ) + mf.track([]), "unknown MIDI file format 3"),
            (mf.header(1, 0, PPQ), "the header declares no tracks"),
            (mf.header(0, 2, PPQ) + mf.track([]) + mf.track([]), "a format 0 file has one track"),
            (mf.header(1, 2, PPQ) + mf.track(mf.notes([(0, 1, 60, 1)])), "declares 2 tracks but the file has 1"),
            (mf.header(0, 1, PPQ) + b"MTrk\x00\x00\x00\x64" + on, "a chunk declares 100 bytes but only 4 remain"),
            (mf.header(0, 1, PPQ) + b"MTr", "a chunk header is cut off"),
            (one_track(b"\x00\xff\x03\x10ab"), "an event declares 16 bytes but only 2 remain"),
            (one_track(b"\x00\xff\x51\x02\x07\xa1"), "a tempo event has 2 bytes instead of 3"),
            (one_track(b"\x00\xff\x51\x03\x00\x00\x00"), "a tempo of 0 microseconds"),
            (one_track(b"\x00\xff\x58\x04\x00\x02\x18\x08"), "a time signature of 0/2^2 is not valid"),
            (one_track(on, division=0), "0 ticks per quarter note"),
            (one_track(on, division=mf.smpte_division(23, 40)), "SMPTE timing at 23 frames a second"),
            (one_track(b"\x00\x40\x40"), "with no status byte before it"),
            (one_track(b"\x00\x90\x3c\x90"), "data byte 0x90 is out of range"),
            (one_track(b"\x00\x90\x3c"), "the event is cut off by the end of the track"),
            (one_track(b"\x81\x81\x81\x81\x00\x90\x3c\x40"), "longer than 4 bytes"),
            (one_track(b"\x00\xf8"), "system message 0xF8 cannot appear"),
            (mf.midi(0, PPQ, [mf.track([mf.tempo(0, 120)])]), "the file has no notes"),
        ]
        for data, expected in cases:
            with self.subTest(expected=expected):
                self.fails(data, expected)

    def test_output_paths(self) -> None:
        data = mf.midi(0, PPQ, [mf.track(mf.notes([(0, PPQ, 60, 100)]))])
        song = self.tmp / "song.mid"
        song.write_bytes(data)
        (self.tmp / "sub").mkdir()
        aliases = [str(song), "./sub/../song.mid"]
        if os.name == "nt":
            aliases.append("SONG.MID")
        try:
            os.link(song, self.tmp / "hard.mid")
            aliases.append("hard.mid")
        except (OSError, AttributeError):
            pass
        try:
            os.symlink(song, self.tmp / "soft.mid")
            aliases.append("soft.mid")
        except (OSError, NotImplementedError):
            pass
        for alias in aliases:
            with self.subTest(alias=alias):
                run = self.cli(None, "-o", alias, cwd=self.tmp)
                self.assertEqual(run.returncode, 1)
                self.assertIn("the output would overwrite the input", run.stderr)
                self.assertEqual(song.read_bytes(), data)
        self.fails(data, "cannot write", "-o", str(self.tmp / "missing" / "out.js"))
        run = subprocess.run([sys.executable, str(SCRIPT), str(self.tmp / "nothing.mid")], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("cannot read", run.stderr)
        out = self.tmp / "out.js"
        run = self.cli(data, "-o", str(out))
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("note(", out.read_text(encoding="utf-8"))

    # -- Drums and several tracks

    def test_drums_and_tracks(self) -> None:
        drums = []
        for b in range(2):
            for i in range(8):
                drums += mf.note(b * BAR + i * 48, 10, 42, 90, channel=9)
            drums += mf.note(b * BAR, 10, 36, 100, channel=9) + mf.note(b * BAR + 2 * PPQ, 10, 38, 100, channel=9)
        bass = mf.notes([(0, BAR, 36, 100), (BAR, BAR, 43, 100)], channel=1)
        data = mf.midi(1, PPQ, [mf.track([mf.tempo(0, 120)]), mf.track([mf.name("Kit")] + drums),
                                mf.track([mf.name("Bass"), mf.program(0, 1, 33)] + bass)])
        code = self.convert(data)
        self.assertIn('sound("bd!2").slow(2)', code)
        self.assertIn('sound("[~ sn]!2").slow(2)', code)
        self.assertIn('sound("[hh hh hh hh hh hh hh hh]!2").slow(2)', code)
        result = self.evaluate(code, 2 - 1e-9)
        hits = [(round(e["begin"] * 8), e["s"]) for e in result["events"] if e["note"] is None]
        self.assertEqual(sorted(hits), sorted([(b * 8 + i, "hh") for b in range(2) for i in range(8)]
                                              + [(b * 8 + k, s) for b in range(2) for k, s in ((0, "bd"), (4, "sn"))]))
        self.assertPlays([(e["begin"] / result["cps"], (e["end"] - e["begin"]) / result["cps"], e["note"])
                          for e in result["events"] if e["note"] is not None], [(0, 2, 36), (2, 2, 43)])


if __name__ == "__main__":
    unittest.main()
