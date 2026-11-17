#!/usr/bin/env python3
"""
midi2tidal: convert a Standard MIDI File (.mid) into TidalJS code.

    python tool/midi2tidal.py song.mid                 # prints the code
    python tool/midi2tidal.py song.mid -o song.js      # writes it to a file
    python tool/midi2tidal.py song.mid --grid 4 --velocity --drums dirt

How the code is laid out
  * One cycle is one bar of the first time signature at the first tempo
    (120 bpm and 4/4 until the file says otherwise): that sets setCPS().
  * Every track and channel (and every program used on it) becomes one or
    more lines of a stack([...]). Notes that overlap are split into voices, so
    each line is a monophonic sequence of notes and chords: note(...).sound(...).
  * Inside a line each bar is a [subsequence] on its own row, so the music
    reads bar by bar. Weights (@n) give the lengths, ~ the rests, and a bar
    repeated n times in a row is written once with !n. A note held across a
    bar line keeps the bars it spans together: [ ... ]@2 is two bars.
  * A bar that lasts longer or shorter than the first one (another time
    signature, another tempo) carries its length as a weight, so every note
    keeps the time it has in the file. The whole line is slowed to its length
    in bars with .slow(n).
  * General MIDI drums (channel 10) become one sound("bd ~ bd ~") line per
    drum. The program of a channel picks a built-in synth (superpiano, saw...).
  * --velocity keeps the dynamics with .amp(): amp = 0.4 * (velocity / 127)^2,
    so velocity 127 plays at the normal level (amp 0.4) and 64 about 12 dB lower.

Only the Python standard library is needed (Python 3.8 or newer). The tests,
which also evaluate the code in TidalJS with Node: python tool/tests/test_midi2tidal.py
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import re
import struct
import textwrap
import sys
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass, field
from functools import reduce
from typing import Callable, Deque, Dict, List, Optional, Sequence, Tuple

DEFAULT_TEMPO = 500000  # microseconds per quarter note: 120 bpm
DEFAULT_METER = (4, 4)
MAX_BARS = 10000

# ---------------------------------------------------------------- MIDI file


class MidiError(Exception):
    """A file that cannot be read or converted; the message says why."""


@dataclass
class Note:
    start: int  # ticks
    end: int  # ticks
    pitch: int
    velocity: int
    channel: int
    track: int
    program: Optional[int]  # the program of the channel when the note started


@dataclass
class Track:
    index: int
    name: str = ""
    end: int = 0  # tick of the end of the track: it keeps silence at the end of a song


@dataclass
class Song:
    format: int
    ppq: float  # ticks per quarter note (counted at the first tempo in an SMPTE file)
    smpte_rate: Optional[float]  # ticks per second in an SMPTE file, else None
    tracks: List[Track]
    notes: List[Note]
    tempos: List[Tuple[int, int]]  # (tick, microseconds per quarter note), from tick 0
    meters: List[Tuple[int, int, int]]  # (tick, numerator, denominator), from tick 0
    dropped: Dict[str, int] = field(default_factory=dict)  # expressive controls with no equivalent
    pedalled: int = 0  # notes the sustain pedal lengthened

    @property
    def end(self) -> int:
        return max([n.end for n in self.notes] + [t.end for t in self.tracks])


# A channel message: (tick, track, order in the track, status kind, channel, data 1, data 2)
RawEvent = Tuple[int, int, int, int, int, int, int]
# A meta event that matters for timing: (tick, track, order, payload)
Meta = Tuple[int, int, int, Tuple[int, ...]]


class _Reader:
    """Bytes of one chunk, read with errors that say where."""

    def __init__(self, data: bytes, where: str):
        self.data = data
        self.pos = 0
        self.where = where

    def fail(self, message: str) -> MidiError:
        return MidiError(f"{self.where}, byte {self.pos}: {message}")

    def byte(self) -> int:
        if self.pos >= len(self.data):
            raise self.fail("the event is cut off by the end of the track")
        value = self.data[self.pos]
        self.pos += 1
        return value

    def varlen(self) -> int:
        value = 0
        for _ in range(4):
            byte = self.byte()
            value = (value << 7) | (byte & 0x7F)
            if not byte & 0x80:
                return value
        raise self.fail("a variable-length number is longer than 4 bytes")

    def take(self, length: int) -> bytes:
        if self.pos + length > len(self.data):
            raise self.fail(f"an event declares {length} bytes but only {len(self.data) - self.pos} remain in the track")
        chunk = self.data[self.pos:self.pos + length]
        self.pos += length
        return chunk


def read_midi(data: bytes) -> Song:
    """Reads and checks a Standard MIDI File; raises MidiError for anything malformed."""
    if data[:4] == b"RIFF" and data[8:12] == b"RMID":  # RIFF-wrapped MIDI (.rmi)
        at = data.find(b"MThd")
        if at < 0:
            raise MidiError("a RIFF file without MIDI data")
        data = data[at:]
    if data[:4] != b"MThd":
        raise MidiError("not a Standard MIDI File (no MThd header)")
    if len(data) < 14:
        raise MidiError("the header is cut off")
    header_len = struct.unpack(">I", data[4:8])[0]
    if header_len < 6:
        raise MidiError(f"the header declares {header_len} bytes; it needs at least 6")
    if 8 + header_len > len(data):
        raise MidiError(f"the header declares {header_len} bytes but the file ends before")
    fmt, ntracks, division = struct.unpack(">HHH", data[8:14])
    if fmt not in (0, 1, 2):
        raise MidiError(f"unknown MIDI file format {fmt}")
    if ntracks == 0:
        raise MidiError("the header declares no tracks")
    if fmt == 0 and ntracks != 1:
        raise MidiError(f"a format 0 file has one track, but the header declares {ntracks}")
    if fmt == 2 and ntracks > 1:
        raise MidiError(f"format 2 (independent patterns, {ntracks} of them) is not supported: "
                        "each pattern has its own timeline; save the song as format 0 or 1")

    smpte_rate: Optional[float] = None
    if division & 0x8000:
        fps = 256 - (division >> 8)
        ticks_per_frame = division & 0xFF
        if fps not in (24, 25, 29, 30):
            raise MidiError(f"SMPTE timing at {fps} frames a second is not valid (24, 25, 29.97 or 30)")
        if ticks_per_frame == 0:
            raise MidiError("SMPTE timing with 0 ticks a frame")
        smpte_rate = (29.97 if fps == 29 else fps) * ticks_per_frame
    elif division == 0:
        raise MidiError("the header declares 0 ticks per quarter note")

    pos = 8 + header_len
    tracks: List[Track] = []
    events: List[RawEvent] = []
    tempos: List[Meta] = []
    meters: List[Meta] = []
    while pos < len(data):
        if pos + 8 > len(data):
            raise MidiError(f"byte {pos}: a chunk header is cut off by the end of the file")
        kind = data[pos:pos + 4]
        length = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        if pos + 8 + length > len(data):
            raise MidiError(f"byte {pos}: a chunk declares {length} bytes but only {len(data) - pos - 8} remain")
        chunk = data[pos + 8:pos + 8 + length]
        pos += 8 + length
        if kind != b"MTrk":
            continue  # unknown chunks are skipped, as the standard says
        track = Track(len(tracks))
        tracks.append(track)
        _read_track(_Reader(chunk, f"track {track.index + 1}"), track, events, tempos, meters)
    if len(tracks) != ntracks:
        raise MidiError(f"the header declares {ntracks} track{'s' if ntracks != 1 else ''} but the file has {len(tracks)}")

    initial_tempo = next((m[3][0] for m in sorted(tempos) if m[0] == 0), DEFAULT_TEMPO)
    ppq = smpte_rate * initial_tempo / 1e6 if smpte_rate else float(division)
    song = Song(fmt, ppq, smpte_rate, tracks, [], _tempo_map(tempos), _meter_map(meters))
    _play(song, events)
    return song


def _read_track(r: _Reader, track: Track, events: List[RawEvent], tempos: List[Meta], meters: List[Meta]) -> None:
    tick = 0
    status = 0
    order = 0
    while r.pos < len(r.data):
        tick += r.varlen()
        byte = r.byte()
        if byte & 0x80:
            if byte < 0xF0:
                status = byte  # running status covers channel messages only
        elif status == 0:
            raise r.fail(f"data byte 0x{byte:02X} with no status byte before it")
        else:
            r.pos -= 1  # running status: this byte is the first data byte
            byte = status
        order += 1

        if byte == 0xFF:  # meta event
            meta = r.byte()
            payload = r.take(r.varlen())
            if meta == 0x2F:
                break  # end of track: anything after it is ignored
            if meta == 0x51:
                if len(payload) != 3:
                    raise r.fail(f"a tempo event has {len(payload)} bytes instead of 3")
                tempo = (payload[0] << 16) | (payload[1] << 8) | payload[2]
                if tempo == 0:
                    raise r.fail("a tempo of 0 microseconds per quarter note")
                tempos.append((tick, track.index, order, (tempo,)))
            elif meta == 0x58:
                if len(payload) < 2:
                    raise r.fail(f"a time signature has {len(payload)} bytes instead of 4")
                if payload[0] == 0 or payload[1] > 6:
                    raise r.fail(f"a time signature of {payload[0]}/2^{payload[1]} is not valid")
                meters.append((tick, track.index, order, (payload[0], 2 ** payload[1])))
            elif meta == 0x03 and not track.name:
                track.name = _decode_text(payload)
            continue
        if byte in (0xF0, 0xF7):  # system exclusive
            r.take(r.varlen())
            continue
        if byte >= 0xF0:
            raise r.fail(f"system message 0x{byte:02X} cannot appear in a file")

        kind = byte & 0xF0
        data = [r.byte() for _ in range(1 if kind in (0xC0, 0xD0) else 2)]
        for value in data:
            if value & 0x80:
                raise r.fail(f"data byte 0x{value:02X} is out of range (0 to 127) in a 0x{kind:02X} message")
        events.append((tick, track.index, order, kind, byte & 0x0F, data[0], data[1] if len(data) > 1 else 0))
    track.end = tick


def _decode_text(payload: bytes) -> str:
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("latin-1")


def _tempo_map(metas: List[Meta]) -> List[Tuple[int, int]]:
    """Tempo changes from tick 0 (120 bpm until the first tempo event); a repeated tempo is no change."""
    changes: List[Tuple[int, int]] = [(0, DEFAULT_TEMPO)]
    for tick, _, _, (tempo,) in sorted(metas):
        if tick == changes[-1][0]:
            changes[-1] = (tick, tempo)  # the last of several at one tick wins
        else:
            changes.append((tick, tempo))
    return [c for i, c in enumerate(changes) if i == 0 or c[1] != changes[i - 1][1]]


def _meter_map(metas: List[Meta]) -> List[Tuple[int, int, int]]:
    """Time signatures from tick 0 (4/4 until the first one); a repeated one is no change."""
    changes: List[Tuple[int, int, int]] = [(0,) + DEFAULT_METER]
    for tick, _, _, (num, den) in sorted(metas):
        if tick == changes[-1][0]:
            changes[-1] = (tick, num, den)
        else:
            changes.append((tick, num, den))
    return [c for i, c in enumerate(changes) if i == 0 or c[1:] != changes[i - 1][1:]]


# Controllers that are not expression: bank select, data entry, (N)RPN, channel mode.
_SILENT_CONTROLLERS = {0, 32, 6, 38, 96, 97, 98, 99, 100, 101} | set(range(120, 128))
_CONTROLLER_NAMES = {1: "modulation", 2: "breath", 4: "foot controller", 5: "portamento time", 7: "volume",
                     8: "balance", 10: "pan", 11: "expression", 65: "portamento switch", 66: "sostenuto pedal",
                     67: "soft pedal", 68: "legato pedal", 71: "resonance", 74: "brightness",
                     91: "reverb send", 93: "chorus send"}


def _play(song: Song, events: List[RawEvent]) -> None:
    """
    Plays the channel messages of every track in time order, as a synth would:
    pairs note-ons with note-offs, holds released notes while the channel's
    sustain pedal (controller 64) is down, and gives every note the program its
    channel has at that moment. Counts the expressive messages that are dropped.
    """
    track_end = {t.index: t.end for t in song.tracks}
    programs: Dict[int, int] = {}
    pedal: Dict[int, bool] = {}
    sounding: Dict[Tuple[int, int], Deque[Tuple[int, int, int, Optional[int]]]] = defaultdict(deque)
    held: Dict[int, List[Tuple[int, int, int, int, Optional[int], int]]] = defaultdict(list)  # released under the pedal
    dropped: Dict[str, int] = defaultdict(int)

    def finish(channel: int, pitch: int, start: int, velocity: int, track: int, program: Optional[int], end: int) -> None:
        song.notes.append(Note(start, end, pitch, velocity, channel, track, program))

    def release_held(channel: int, tick: int, pitch: Optional[int] = None) -> None:
        keep = []
        for entry in held[channel]:
            p, start, velocity, track, program, off = entry
            if pitch is None or p == pitch:
                if tick > off:
                    song.pedalled += 1
                finish(channel, p, start, velocity, track, program, tick)
            else:
                keep.append(entry)
        held[channel] = keep

    for tick, track, _, kind, channel, a, b in sorted(events):
        if kind == 0x90 and b > 0:
            release_held(channel, tick, a)  # a key struck again ends its sustained note
            sounding[(channel, a)].append((tick, b, track, programs.get(channel)))
        elif kind in (0x80, 0x90):
            started = sounding.get((channel, a))
            if not started:
                continue  # a note-off with no note: nothing to end
            start, velocity, owner, program = started.popleft()  # first on, first off
            if pedal.get(channel):
                held[channel].append((a, start, velocity, owner, program, tick))
            else:
                finish(channel, a, start, velocity, owner, program, tick)
        elif kind == 0xB0 and a == 64:
            down = b >= 64
            if pedal.get(channel) and not down:
                release_held(channel, tick)
            pedal[channel] = down
        elif kind == 0xC0:
            programs[channel] = a
        elif kind == 0xB0:
            if a not in _SILENT_CONTROLLERS:
                dropped[_CONTROLLER_NAMES.get(a, f"controller {a}")] += 1
        elif kind == 0xE0:
            dropped["pitch bend"] += 1
        elif kind == 0xD0:
            dropped["channel pressure"] += 1
        elif kind == 0xA0:
            dropped["key pressure"] += 1
    # Notes never released end with their track.
    for (channel, pitch), started in sounding.items():
        for start, velocity, track, program in started:
            finish(channel, pitch, start, velocity, track, program, max(track_end[track], start))
    for channel, entries in held.items():
        for p, start, velocity, track, program, off in entries:
            end = max(track_end[track], off)
            if end > off:
                song.pedalled += 1
            finish(channel, p, start, velocity, track, program, end)
    song.notes.sort(key=lambda n: (n.start, -n.pitch))
    song.dropped = dict(dropped)


# ---------------------------------------------------------------- Time


class Clock:
    """Seconds at any tick: from the tempo map, or straight from the ticks in an SMPTE file."""

    def __init__(self, song: Song):
        self.song = song
        self.ticks: List[int] = []
        self.seconds: List[float] = []
        self.rates: List[float] = []  # seconds per tick from each change on
        elapsed = 0.0
        for i, (tick, tempo) in enumerate(song.tempos):
            if i:
                elapsed += (tick - self.ticks[-1]) * self.rates[-1]
            self.ticks.append(tick)
            self.seconds.append(elapsed)
            self.rates.append(tempo / 1e6 / song.ppq)

    def at(self, tick: float) -> float:
        if self.song.smpte_rate:
            return tick / self.song.smpte_rate
        i = bisect.bisect_right(self.ticks, tick) - 1
        return self.seconds[i] + (tick - self.ticks[i]) * self.rates[i]

    def steady(self, lo: float, hi: float) -> bool:
        """Whether the tempo stays the same from tick lo to tick hi."""
        if self.song.smpte_rate:
            return True
        return not any(lo < tick < hi for tick in self.ticks[1:])


@dataclass
class Bar:
    start: float  # ticks
    end: float  # ticks
    numerator: int
    denominator: int
    cut: bool = False  # ended early by a time signature that came in the middle of it


def bar_lines(song: Song, until: float) -> List[Bar]:
    """The bars from tick 0 until `until`, each in the time signature it starts in."""
    bars: List[Bar] = []
    changes = song.meters
    at = 0.0
    while at < until - 1e-6 or not bars:
        i = bisect.bisect_right([m[0] for m in changes], at + 1e-6) - 1
        _, num, den = changes[i]
        end = at + num * 4 / den * song.ppq
        cut = False
        if i + 1 < len(changes) and at + 1e-6 < changes[i + 1][0] < end - 1e-6:
            end, cut = float(changes[i + 1][0]), True
        bars.append(Bar(at, end, num, den, cut))
        if len(bars) > MAX_BARS:
            raise MidiError(f"the song is longer than {MAX_BARS} bars; --bars converts the first ones")
        at = end
    return bars


# ---------------------------------------------------------------- Sounds

GM_FAMILIES = [
    # (first program, family name, sound, extra controls)
    (0, "Piano", "superpiano", ""),
    (8, "Chromatic percussion", "superfm", ""),
    (16, "Organ", "superpwm", ""),
    (24, "Guitar", "arpy", ""),
    (32, "Bass", "saw", ".lpf(900)"),
    (40, "Strings", "supersaw", ".lpf(2500)"),
    (48, "Ensemble", "supersaw", ".lpf(2500)"),
    (56, "Brass", "supersquare", ".lpf(2500)"),
    (64, "Reed", "square", ".lpf(2000)"),
    (72, "Pipe", "tri", ""),
    (80, "Synth lead", "supersaw", ""),
    (88, "Synth pad", "superpwm", ""),
    (96, "Synth effects", "superzow", ""),
    (104, "Ethnic", "arpy", ""),
    (112, "Percussive", "superfm", ""),
    (120, "Sound effects", "sine", ""),
]


def gm_family(program: Optional[int]) -> Tuple[str, str, str]:
    if program is None:
        return GM_FAMILIES[0][1:]
    family = GM_FAMILIES[0]
    for entry in GM_FAMILIES:
        if program >= entry[0]:
            family = entry
    return family[1:]


# General MIDI drum keys -> (role, built-in synth, Dirt-Samples bank)
DRUMS: Dict[int, Tuple[str, str, str]] = {}
for keys, role, synth, dirt in [
    ((35, 36), "kick", "bd", "bd"),
    ((37,), "rim", "sn", "rm"),
    ((38, 40), "snare", "sn", "sn"),
    ((39,), "clap", "cp", "cp"),
    ((42,), "closed hi-hat", "hh", "hc"),
    ((44,), "pedal hi-hat", "hh", "hh"),
    ((46,), "open hi-hat", "oh", "ho"),
    ((41, 43), "low tom", "bd", "lt"),
    ((45, 47), "mid tom", "bd", "mt"),
    ((48, 50), "high tom", "bd", "ht"),
    ((49, 52, 55, 57), "crash", "cy", "cr"),
    ((51, 53, 59), "ride", "cy", "cr"),
    ((56,), "cowbell", "cp", "cb"),
]:
    for key in keys:
        DRUMS[key] = (role, synth, dirt)
OTHER_DRUM = ("percussion", "cp", "perc")
DRUM_ORDER = ["bd", "lt", "mt", "ht", "sn", "rm", "cp", "cb", "hh", "hc", "ho", "oh", "cy", "cr", "perc"]

NOTE_NAMES = ["c", "c#", "d", "eb", "e", "f", "f#", "g", "ab", "a", "bb", "b"]


def note_name(pitch: int) -> str:
    """c4 is middle C (MIDI 60), as TidalJS reads note names."""
    return NOTE_NAMES[pitch % 12] + str(pitch // 12 - 1)


def amp_of(velocity: int) -> float:
    """The amp for a MIDI velocity: 0.4 (TidalJS's normal level) at 127, falling with the square."""
    return 0.4 * (velocity / 127) ** 2


# ---------------------------------------------------------------- Grid

GRIDS = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96)
FINE = 24  # steps per quarter note: an automatic grid finer than this comes with a suggestion for --grid
EXACT = 1e-6  # ticks: a time this close to the grid is on it (float rounding, nothing a listener could hear)


def grid_candidates(ppq: float) -> List[int]:
    """Grids to try, coarsest first: the musical ones, and every whole division of the quarter note in ticks."""
    candidates = set(GRIDS)
    if abs(ppq - round(ppq)) < EXACT:
        whole = int(round(ppq))
        candidates |= {g for g in range(1, whole + 1) if whole % g == 0}
    return sorted(candidates)


def _on_grid(times: Sequence[float], step: float, tolerance: float) -> float:
    """The share of the times within `tolerance` of the grid of `step` ticks."""
    if not times:
        return 1.0
    return sum(1 for t in times if abs(t - round(t / step) * step) <= tolerance) / len(times)


def choose_grid(song: Song, notes: Sequence[Note]) -> Tuple[int, str]:
    """
    Steps per quarter note, and how well it fits: "exact" when every note start
    and end is on the grid (the coarsest such grid; with whole ticks per quarter
    note there always is one), "starts" when only the starts are (some lengths
    are rounded), "rounded" when nothing fits (see rounded_grid).
    """
    starts = [n.start for n in notes]
    ends = [n.end for n in notes if n.channel != 9]  # a drum hit is written without its length
    candidates = grid_candidates(song.ppq)
    for steps in candidates:
        if _on_grid(starts + ends, song.ppq / steps, EXACT) == 1:
            return steps, "exact"
    for steps in candidates:
        if _on_grid(starts, song.ppq / steps, EXACT) == 1:
            return steps, "starts"
    return rounded_grid(song, notes), "rounded"


def rounded_grid(song: Song, notes: Sequence[Note]) -> int:
    """The coarsest plain grid that holds nine starts in ten roughly, as for a recording never quantised; else sixteenths."""
    starts = [n.start for n in notes]
    for steps in (1, 2, 4, 3, 6, 8):
        if _on_grid(starts, song.ppq / steps, song.ppq / steps / 4) >= 0.9:
            return steps
    return 4


def _fit_bars(steps: int, bars: Sequence[Bar], ppq: float) -> int:
    """A finer grid when a whole bar is not a whole number of steps (7/16 needs eighths of a quarter)."""
    for _ in range(6):
        if all(abs((b.end - b.start) / ppq * steps - round((b.end - b.start) / ppq * steps)) < 1e-6 for b in bars if not b.cut):
            break
        steps *= 2
    return steps


def _grid_name(steps_per_quarter: int) -> str:
    names = {1: "quarter notes", 2: "eighth notes", 3: "eighth-note triplets", 4: "sixteenth notes",
             6: "sixteenth-note triplets", 8: "thirty-second notes", 12: "thirty-second-note triplets"}
    return names.get(steps_per_quarter, f"1/{steps_per_quarter} of a quarter note")


@dataclass
class Placed:
    """A note on the grid: start and end in steps."""
    note: Note
    start: int
    end: int


@dataclass
class GridReport:
    moved: int = 0  # note starts not where they were
    resized: int = 0  # notes whose length changed
    merged: int = 0  # attacks at different times that now start together
    separated: int = 0  # repeated notes of one pitch moved apart so each still sounds


def place(notes: Sequence[Note], part_of: Callable[[Note], tuple], step: float, tolerance: float) -> Tuple[List[Placed], GridReport]:
    """
    Rounds every note to the grid. A key struck again keeps its own attack: when
    rounding puts two notes of one pitch (in one part) at the same step, the
    later one moves to the next step, and the earlier one ends where it starts.
    """
    report = GridReport()
    placed: List[Placed] = []
    by_key: Dict[tuple, List[Placed]] = defaultdict(list)
    for n in notes:
        start = round(n.start / step)
        p = Placed(n, start, max(start + 1, round(n.end / step)))
        by_key[part_of(n) + (n.pitch,)].append(p)
    for same in by_key.values():
        same.sort(key=lambda p: (p.note.start, p.note.end))
        kept: List[Placed] = []
        for p in same:
            if kept and p.note.start == kept[-1].note.start:
                continue  # the same key twice at the same tick is one note
            if kept:
                prev = kept[-1]
                if p.start <= prev.start:
                    p.start = prev.start + 1
                    p.end = max(p.end, p.start + 1)
                    report.separated += 1
                if prev.end > p.start:
                    prev.end = p.start
            kept.append(p)
        placed.extend(kept)
    for p in placed:
        if abs(p.start * step - p.note.start) > tolerance:
            report.moved += 1
        drum = p.note.channel == 9  # drum hits are written without their length
        if not drum and abs((p.end - p.start) * step - (p.note.end - p.note.start)) > tolerance:
            report.resized += 1
    attacks: Dict[Tuple[tuple, int], set] = defaultdict(set)
    for p in placed:
        attacks[(part_of(p.note), p.start)].add(p.note.start)
    report.merged = sum(len(ticks) - 1 for ticks in attacks.values())
    placed.sort(key=lambda p: (p.start, -p.note.pitch))
    return placed, report


# ---------------------------------------------------------------- Lines


@dataclass
class Event:
    start: int  # steps
    end: int  # steps
    token: str
    velocity: int
    top: int = 0  # the highest pitch, so the top line becomes voice 1


@dataclass
class Line:
    comment: str
    events: List[Event]
    sound: str = ""  # pitched lines: the synth; drum lines: empty (the tokens are sounds)
    extra: str = ""


def split_voices(events: List[Event]) -> List[List[Event]]:
    """Events into monophonic voices: each goes to the first voice that is free by its start."""
    voices: List[List[Event]] = []
    for event in sorted(events, key=lambda e: (e.start, -e.top)):
        for voice in voices:
            if voice[-1].end <= event.start:
                voice.append(event)
                break
        else:
            voices.append([event])
    return voices


def chord_token(pitches: List[int]) -> str:
    names = [note_name(p) for p in sorted(set(pitches))]
    return names[0] if len(names) == 1 else "[" + ",".join(names) + "]"


class Timeline:
    """Bars in steps, and the length of any span as a weight: the steps, or the time when the tempo changes."""

    def __init__(self, bars: List[Bar], step: float, clock: Clock, reference: float):
        self.step = step
        self.clock = clock
        self.reference = reference  # seconds of one cycle: a bar of the first time signature at the first tempo
        edges = [round(bars[0].start / step)] + [round(b.end / step) for b in bars]
        self.edges = [e for i, e in enumerate(edges) if i == 0 or e > edges[i - 1]]  # no empty bars
        # Each bar's length in cycles, rounded as written, so the rows of every line add up alike.
        self.index = {edge: i for i, edge in enumerate(self.edges)}
        self.before = [0.0]  # cycles before each edge
        for lo, hi in zip(self.edges, self.edges[1:]):
            self.before.append(self.before[-1] + float(_number(self.seconds(lo, hi) / reference)))

    @property
    def total(self) -> int:
        return self.edges[-1]

    @property
    def length(self) -> float:
        """The whole song in cycles."""
        return self.before[-1]

    def seconds(self, lo: int, hi: int) -> float:
        return self.clock.at(hi * self.step) - self.clock.at(lo * self.step)

    def steady(self, lo: int, hi: int) -> bool:
        return self.clock.steady(lo * self.step, hi * self.step)

    def weight(self, lo: int, hi: int) -> str:
        """The length in cycles of a row from bar edge lo to bar edge hi, as a weight ("" for one cycle)."""
        weight = _number(self.before[self.index[hi]] - self.before[self.index[lo]])
        return "" if weight == "1" else weight


def render(events: List[Event], timeline: Timeline, value: Callable[[Event], str], drums: bool = False) -> List[str]:
    """
    The rows of one line: one per bar (or per group of bars a held note joins),
    lengths as weights. `value` maps an event to the text written for it (the
    note or sound; a level for an .amp() pattern). Drum hits have no length:
    a drum row is a row of equal steps, "[bd ~ ~ bd]".
    """
    events = sorted(events, key=lambda e: e.start)
    if drums:
        events = [Event(e.start, e.start + 1, e.token, e.velocity) for e in events]
    edges = timeline.edges
    crossed = set()
    for event in events:
        for i in range(bisect.bisect_right(edges, event.start), len(edges)):
            if edges[i] >= event.end:
                break
            crossed.add(i)
    groups: List[Tuple[int, int]] = []
    begin = 0
    for i in range(1, len(edges)):
        if i == len(edges) - 1 or i not in crossed:
            groups.append((edges[begin], edges[i]))
            begin = i

    rows: List[Tuple[str, str]] = []  # (text, weight)
    k = 0
    for lo, hi in groups:
        inside = []
        while k < len(events) and events[k].start < hi:
            inside.append(events[k])
            k += 1
        steady = timeline.steady(lo, hi)
        text = _drum_steps(inside, lo, hi, value) if drums and steady else None
        rows.append((text or _group(inside, lo, hi, value, timeline, steady), timeline.weight(lo, hi)))

    # A bar repeated in a row is written once, with !n (only bars of one cycle).
    counted: List[List] = []
    for text, weight in rows:
        if counted and not weight and not counted[-1][1] and counted[-1][0] == text:
            counted[-1][2] += 1
        else:
            counted.append([text, weight, 1])
    return [text + ("@" + weight if weight else "") + ("!" + str(count) if count > 1 else "") for text, weight, count in counted]


MAX_DRUM_STEPS = 16


def _drum_steps(events: List[Event], lo: int, hi: int, value) -> Optional[str]:
    """
    A bar of drum hits as equal steps, as coarse as the hits allow:
    "[bd ~ ~ bd ~ ~ bd ~]". None when that takes more than 16 steps (then the
    hits are written with weights instead).
    """
    if not events:
        return "~"
    unit = reduce(math.gcd, (e.start - lo for e in events), hi - lo)
    count = (hi - lo) // unit
    if count > MAX_DRUM_STEPS:
        return None
    steps = ["~"] * count
    for e in events:
        steps[(e.start - lo) // unit] = value(e)
    return steps[0] if count == 1 else "[" + " ".join(steps) + "]"


def _group(events: List[Event], lo: int, hi: int, value, timeline: Timeline, steady: bool) -> str:
    spans: List[Tuple[str, int, int]] = []
    at = lo
    for event in events:
        if event.start > at:
            spans.append(("~", at, event.start))
        end = min(event.end, hi)
        spans.append((value(event), event.start, end))
        at = end
    if at < hi:
        spans.append(("~", at, hi))
    # Rests in a row are one rest.
    joined: List[Tuple[str, int, int]] = []
    for token, a, b in spans:
        if joined and token == "~" and joined[-1][0] == "~":
            joined[-1] = ("~", joined[-1][1], b)
        else:
            joined.append((token, a, b))
    if len(joined) == 1:  # one note, chord or rest for the whole group needs no brackets
        return joined[0][0]
    if steady:
        unit = reduce(math.gcd, (b - a for _, a, b in joined))
        weights = [_number((b - a) / unit) for _, a, b in joined]
    else:
        # The tempo changes inside: each part lasts the time it takes, in steps at the tempo the row starts with.
        step_seconds = timeline.seconds(lo, lo + 1)
        weights = [_number(timeline.seconds(a, b) / step_seconds) for _, a, b in joined]
    return "[" + " ".join(token + ("" if w == "1" else "@" + w) for (token, _, _), w in zip(joined, weights)) + "]"


# ---------------------------------------------------------------- Conversion


@dataclass
class Options:
    grid: Optional[int] = None
    velocity: bool = False
    drums: str = "synth"
    sound: Optional[str] = None
    max_bars: Optional[int] = None


def comment(text: str, limit: Optional[int] = 120) -> str:
    """Text safe for a // comment: one line, no control or invisible formatting characters."""
    cleaned = "".join(" " if unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp", "Zs") else ch for ch in str(text))
    cleaned = " ".join(cleaned.split())
    return cleaned[:limit - 3] + "..." if limit and len(cleaned) > limit else cleaned


def js(text: str) -> str:
    """A JavaScript string literal (JSON, ASCII only)."""
    return json.dumps(text, ensure_ascii=True)


def convert(song: Song, source_name: str, options: Options) -> str:
    if not song.notes:
        raise MidiError("the file has no notes")
    clock = Clock(song)
    all_bars = bar_lines(song, song.end)
    bars = all_bars[:options.max_bars] if options.max_bars else all_bars
    limit = bars[-1].end
    notes = [n for n in song.notes if n.start < limit - 1e-9]
    if not notes:
        raise MidiError(f"no notes start in the first {len(bars)} bars")
    notes = [Note(n.start, min(n.end, int(math.ceil(limit))), n.pitch, n.velocity, n.channel, n.track, n.program) for n in notes]

    if options.grid:
        steps_per_quarter, fit = options.grid, "chosen"
    else:
        steps_per_quarter, fit = choose_grid(song, notes)
    steps_per_quarter = _fit_bars(steps_per_quarter, bars, song.ppq)
    step = song.ppq / steps_per_quarter

    first_tempo = song.tempos[0][1]
    num0, den0 = song.meters[0][1:]
    reference = num0 * 4 / den0 * first_tempo / 1e6  # seconds of one cycle
    timeline = Timeline(bars, step, clock, reference)

    def part_of(n: Note) -> tuple:
        return (n.track, n.channel) if n.channel == 9 else (n.track, n.channel, n.program)

    placed, report = place(notes, part_of, step, EXACT)
    total = timeline.total
    placed = [p for p in placed if p.start < total]
    for p in placed:
        p.end = min(p.end, total)

    tracks = {t.index: t for t in song.tracks}
    parts: Dict[tuple, List[Placed]] = defaultdict(list)
    for p in placed:
        parts[part_of(p.note)].append(p)
    programs_of: Dict[Tuple[int, int], set] = defaultdict(set)
    for key in parts:
        if len(key) == 3:
            programs_of[key[:2]].add(key[2])

    lines: List[Line] = []
    tom_hits = 0
    for key in sorted(parts, key=lambda k: tuple(-1 if x is None else x for x in k)):
        items = parts[key]
        track = tracks[key[0]]
        channel = key[1]
        name = comment(track.name)
        where = f"track {key[0] + 1}, channel {channel + 1}"
        if channel == 9:
            by_sound: Dict[str, Dict[int, int]] = defaultdict(dict)  # sound -> start -> velocity
            for p in items:
                role, synth, dirt = DRUMS.get(p.note.pitch, OTHER_DRUM)
                sound = dirt if options.drums == "dirt" else synth
                if options.drums != "dirt" and "tom" in role:
                    tom_hits += 1
                by_sound[sound][p.start] = max(p.note.velocity, by_sound[sound].get(p.start, 0))
            for sound in sorted(by_sound, key=lambda s: DRUM_ORDER.index(s) if s in DRUM_ORDER else 99):
                events = [Event(s, s + 1, sound, v) for s, v in sorted(by_sound[sound].items())]
                lines.append(Line(f"{name or 'Drums'}: {sound} ({where})", events))
            continue

        program = key[2]
        family, synth, extra = gm_family(program)
        if len(programs_of[key[:2]]) > 1:
            where += f", program {program + 1 if program is not None else 1} ({family})"
        if options.sound:
            synth, extra = options.sound, ""
        # Notes that start and end together are one chord (with --velocity, only at one velocity).
        chords: Dict[tuple, List[Note]] = defaultdict(list)
        for p in items:
            chords[(p.start, p.end) + ((p.note.velocity,) if options.velocity else ())].append(p.note)
        events = [
            Event(k[0], k[1], chord_token([n.pitch for n in group]), max(n.velocity for n in group), max(n.pitch for n in group))
            for k, group in chords.items()
        ]
        voices = split_voices(events)
        for i, voice in enumerate(voices):
            label = f"{name or family} ({where})" + (f", voice {i + 1} of {len(voices)}" if len(voices) > 1 else "")
            lines.append(Line(label, voice, synth, extra))

    cycles = timeline.length
    bpm = 60e6 / first_tempo
    grid = _grid_name(steps_per_quarter)

    notes_about: List[str] = []
    if song.smpte_rate:
        notes_about.append(f"SMPTE timing ({_number(song.smpte_rate)} ticks a second): every note keeps its time on the clock; "
                           f"beats are counted at {bpm:.4g} bpm")
    tempo_changes = len(song.tempos) - 1
    if tempo_changes and not song.smpte_rate:
        bpms = sorted({60e6 / t for _, t in song.tempos})
        notes_about.append(f"the tempo changes {tempo_changes} time{'s' if tempo_changes != 1 else ''} "
                           f"({bpms[0]:.4g} to {bpms[-1]:.4g} bpm): bars at another tempo carry their length as a weight")
    meter_changes = len(song.meters) - 1
    if meter_changes:
        notes_about.append(f"the time signature changes {meter_changes} time{'s' if meter_changes != 1 else ''}: "
                           "bars of another length carry it as a weight")
    cut = sum(1 for b in bars if b.cut)
    if cut:
        notes_about.append(f"{cut} bar{'s end' if cut != 1 else ' ends'} early, where a time signature starts in the middle of it")
    if fit == "rounded":
        notes_about.append(f"the timing is not on a grid (a live recording?): it is rounded to {grid}; --grid picks another grid")
    elif fit == "starts":
        notes_about.append(f"no grid holds every note end; the grid of {grid} holds the starts")
    if fit in ("exact", "starts") and steps_per_quarter > FINE:
        plain = rounded_grid(song, notes)
        notes_about.append(f"keeping every note time exactly takes this fine grid; --grid {plain} rounds to {_grid_name(plain)} "
                           "(and says what it moves)")
    if report.moved:
        notes_about.append(f"{_count(report.moved, 'note start')} moved to the grid")
    if report.resized:
        notes_about.append(f"{_count(report.resized, 'note length')} changed by the grid")
    if report.merged:
        notes_about.append(f"{_count(report.merged, 'attack')} merged with another that now starts at the same step")
    if report.separated:
        notes_about.append(f"{_count(report.separated, 'repeated note')} moved one step later, so each repeat still sounds")
    if song.pedalled:
        notes_about.append(f"the sustain pedal lengthens {_count(song.pedalled, 'note')}")
    if song.dropped:
        dropped = ", ".join(_count(count, f"{name} message") for name, count in sorted(song.dropped.items(), key=lambda x: (-x[1], x[0])))
        notes_about.append(f"dropped, with no equivalent here: {dropped}")
    if tom_hits:
        hits = "1 tom hit plays" if tom_hits == 1 else f"{tom_hits} tom hits play"
        notes_about.append(f"there is no built-in tom: {hits} bd (--drums dirt plays lt, mt and ht)")
    if options.velocity:
        notes_about.append("velocities play as amp = 0.4 * (velocity / 127)^2: 127 is the normal level")

    out: List[str] = []
    out.append(f"// {comment(os.path.basename(source_name))}, converted by tool/midi2tidal.py")
    out.append(f"// {bpm:.4g} bpm, {num0}/{den0}, {len(bars)} bar{'s' if len(bars) != 1 else ''}, "
               f"a cycle is one bar of {num0}/{den0}, grid of {grid}")
    for line in notes_about:
        for i, part in enumerate(textwrap.wrap(comment(line, None), 100)):
            out.append(("// Note: " if i == 0 else "//   ") + part)
    if options.drums == "dirt" and any(not line.sound for line in lines):
        out.append(f"samples({js('github:tidalcycles/dirt-samples')})")
    out.append(f"setCPS({_number(1 / reference)})")
    out.append("")
    out.append("stack([")
    for i, line in enumerate(lines):
        out.append(f"  // {comment(line.comment)}")
        out.append("  " + _pattern(line, timeline, cycles, options) + ("," if i < len(lines) - 1 else ""))
    out.append("])")
    return "\n".join(out) + "\n"


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'s' if n != 1 else ''}"


def _pattern(line: Line, timeline: Timeline, cycles: float, options: Options) -> str:
    drums = not line.sound
    code = ("sound(" if drums else "note(") + _mini(render(line.events, timeline, lambda e: e.token, drums)) + ")"
    if options.velocity:
        # The same shape as the notes, so each note takes the level written in its place.
        velocities = {e.velocity for e in line.events}
        if len(velocities) == 1:
            code += f".amp({_number(amp_of(velocities.pop()), 6)})"
        elif velocities:
            code += ".amp(" + _mini(render(line.events, timeline, lambda e: _number(amp_of(e.velocity), 6), drums)) + ")"
    # .amp() comes before .slow(): both texts are laid out over the same bars.
    slow = _number(cycles)
    if slow != "1":
        code += f".slow({slow})"
    if not drums:
        code += f".sound({js(line.sound)}).legato(1){line.extra}"
    return code


def _mini(rows: List[str]) -> str:
    """The rows as a JavaScript string argument: one JSON string per bar, joined with +."""
    if len(rows) == 1:
        return js(_unwrap(rows[0]))
    return "\n    " + " +\n    ".join(js(row + ("\n" if i < len(rows) - 1 else "")) for i, row in enumerate(rows)) + "\n  "


def _unwrap(text: str) -> str:
    """A single bar needs no brackets: "[bd ~ sn ~]" is "bd ~ sn ~"."""
    if not text.startswith("["):
        return text
    depth = 0
    for i, ch in enumerate(text):
        depth += {"[": 1, "]": -1}.get(ch, 0)
        if depth == 0:
            return text[1:-1] if i == len(text) - 1 else text
    return text


def _number(x: float, places: int = 4) -> str:
    text = f"{x:.{places}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


# ---------------------------------------------------------------- Command line


SOUND_NAME = re.compile(r"[A-Za-z0-9_.:-]{1,64}")


def _same_file(a: str, b: str) -> bool:
    """Whether two paths name one file: the same path spelled differently, a link, or a hard link."""
    try:
        if os.path.exists(b) and os.path.samefile(a, b):
            return True
    except OSError:
        pass
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="midi2tidal",
        description="Convert a Standard MIDI File (.mid) into TidalJS code: one bar per cycle, a stack of note() and sound() lines.",
    )
    parser.add_argument("midi", help="the .mid file to convert")
    parser.add_argument("-o", "--output", help="write the code to this file (default: print it)")
    parser.add_argument("--grid", type=int, metavar="STEPS",
                        help="steps per quarter note to round the timing to: 4 for sixteenths, 3 or 6 for triplets "
                             "(default: the coarsest grid that holds every note start and end)")
    parser.add_argument("--velocity", action="store_true", help="keep the dynamics: add .amp() patterns")
    parser.add_argument("--drums", choices=["synth", "dirt"], default="synth",
                        help="synth: built-in drum synths (bd, sn, hh...); dirt: Dirt-Samples banks, loaded from GitHub (default: synth)")
    parser.add_argument("--sound", metavar="NAME", help="play every pitched line with this sound instead of one picked by the MIDI program")
    parser.add_argument("--bars", type=int, metavar="N", help="convert only the first N bars")
    args = parser.parse_args(argv)

    if args.grid is not None and not 1 <= args.grid <= 384:
        parser.error("--grid must be from 1 to 384")
    if args.bars is not None and args.bars < 1:
        parser.error("--bars must be at least 1")
    if args.sound is not None and not SOUND_NAME.fullmatch(args.sound):
        parser.error("--sound takes a sound name: letters, digits, _ - . and : (a bank and its file, as in bd:3)")
    if args.output and _same_file(args.midi, args.output):
        print(f"midi2tidal: {args.output}: the output would overwrite the input", file=sys.stderr)
        return 1
    try:
        with open(args.midi, "rb") as f:
            data = f.read()
    except OSError as error:
        print(f"midi2tidal: cannot read {args.midi}: {error.strerror or error}", file=sys.stderr)
        return 1
    try:
        code = convert(read_midi(data), args.midi, Options(args.grid, args.velocity, args.drums, args.sound, args.bars))
    except MidiError as error:
        print(f"midi2tidal: {args.midi}: {error}", file=sys.stderr)
        return 1
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8", newline="\n") as f:
                f.write(code)
        except OSError as error:
            print(f"midi2tidal: cannot write {args.output}: {error.strerror or error}", file=sys.stderr)
            return 1
        print(f"midi2tidal: wrote {args.output}", file=sys.stderr)
    else:
        try:
            sys.stdout.write(code)
            sys.stdout.flush()
        except OSError as error:
            print(f"midi2tidal: cannot write the output: {error.strerror or error}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
