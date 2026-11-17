#!/usr/bin/env python3
"""
midi2tidal: convert a Standard MIDI File (.mid) into TidalJS code.

    python tool/midi2tidal.py song.mid                 # prints the code
    python tool/midi2tidal.py song.mid -o song.js      # writes it to a file
    python tool/midi2tidal.py song.mid --grid 4 --velocity --drums dirt

How the code is laid out
  * One cycle is one bar: setCPS() comes from the first tempo and time signature.
  * Every track (and, in a format 0 file, every channel) becomes one or more
    lines of a stack([...]). Notes that overlap are split into voices, so each
    line is a monophonic sequence of notes and chords: note(`...`).sound(...).
  * Inside a line, each bar is a [subsequence] on its own row, so you can read
    the music bar by bar. Weights (@n) give the lengths, ~ the rests, and a
    bar repeated n times in a row is written once with !n. A note held across
    a bar line keeps the bars it spans together: [ ... ]@2 is two bars.
  * The whole sequence is slowed to its number of bars with .slow(n).
  * General MIDI drums (channel 10) become one sound("bd ~ bd ~") line per
    drum. The program of a track picks a built-in synth (superpiano, saw...).

Only the Python standard library is needed (Python 3.8 or newer).
"""

from __future__ import annotations

import argparse
import math
import os
import struct
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from functools import reduce
from typing import Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------- MIDI file


class MidiError(Exception):
    pass


@dataclass
class Note:
    start: int  # ticks
    end: int  # ticks
    pitch: int
    velocity: int
    channel: int
    track: int


@dataclass
class Track:
    index: int
    name: str = ""
    # The first program change of each channel.
    programs: Dict[int, int] = field(default_factory=dict)
    end: int = 0  # tick of the end of the track: it keeps silence at the end of a song


@dataclass
class Song:
    ppq: int
    notes: List[Note]
    tracks: List[Track]
    tempos: List[Tuple[int, int]]  # (tick, microseconds per quarter note)
    time_signatures: List[Tuple[int, int, int]]  # (tick, numerator, denominator)
    format: int


def _varlen(data: bytes, pos: int) -> Tuple[int, int]:
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise MidiError("truncated variable-length number")
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise MidiError("variable-length number longer than 4 bytes")


def read_midi(data: bytes) -> Song:
    if data[:4] == b"RIFF" and data[8:12] == b"RMID":  # RIFF-wrapped MIDI (.rmi)
        at = data.find(b"MThd")
        if at < 0:
            raise MidiError("RIFF file without MIDI data")
        data = data[at:]
    if data[:4] != b"MThd":
        raise MidiError("not a Standard MIDI File (no MThd header)")
    header_len = struct.unpack(">I", data[4:8])[0]
    fmt, ntracks, division = struct.unpack(">HHH", data[8:14])
    if division & 0x8000:
        # SMPTE time: ticks per second. Read it as 120 bpm, so a quarter note is half a second.
        fps = 256 - (division >> 8)
        ppq = max(1, (fps * (division & 0xFF)) // 2)
    else:
        ppq = division
    if ppq <= 0:
        raise MidiError("the file has no ticks per quarter note")

    pos = 8 + header_len
    notes: List[Note] = []
    tracks: List[Track] = []
    tempos: List[Tuple[int, int]] = []
    signatures: List[Tuple[int, int, int]] = []
    index = 0
    while pos + 8 <= len(data) and index < ntracks:
        kind = data[pos:pos + 4]
        length = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 8 + length
        if kind != b"MTrk":
            continue  # unknown chunk: skip it, as the standard says
        track = Track(index)
        tracks.append(track)
        _read_track(chunk, track, notes, tempos, signatures)
        index += 1
    if not tracks:
        raise MidiError("the file has no tracks")
    tempos.sort()
    signatures.sort()
    notes.sort(key=lambda n: (n.start, -n.pitch))
    return Song(ppq, notes, tracks, tempos, signatures, fmt)


def _read_track(chunk: bytes, track: Track, notes: List[Note], tempos, signatures) -> None:
    pos = 0
    tick = 0
    status = 0
    sounding: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)  # (channel, pitch) -> [(start, velocity)]
    while pos < len(chunk):
        delta, pos = _varlen(chunk, pos)
        tick += delta
        if pos >= len(chunk):
            break
        byte = chunk[pos]
        if byte & 0x80:
            pos += 1
            if byte < 0xF0:
                status = byte  # running status covers channel messages only
        elif status == 0:
            raise MidiError(f"track {track.index + 1}: data byte without a status byte")
        else:
            byte = status  # running status: this byte is the first data byte

        if byte == 0xFF:  # meta event
            meta = chunk[pos]
            length, pos = _varlen(chunk, pos + 1)
            payload = chunk[pos:pos + length]
            pos += length
            if meta == 0x51 and length == 3:
                tempos.append((tick, (payload[0] << 16) | (payload[1] << 8) | payload[2]))
            elif meta == 0x58 and length >= 2:
                signatures.append((tick, payload[0], 2 ** payload[1]))
            elif meta == 0x03 and not track.name:
                track.name = payload.decode("latin-1").strip()
            elif meta == 0x2F:
                break
            continue
        if byte in (0xF0, 0xF7):  # system exclusive
            length, pos = _varlen(chunk, pos)
            pos += length
            continue
        if byte >= 0xF0:  # other system messages do not appear in files; skip their data
            pos += {0xF1: 1, 0xF2: 2, 0xF3: 1}.get(byte, 0)
            continue

        kind = byte & 0xF0
        channel = byte & 0x0F
        size = 1 if kind in (0xC0, 0xD0) else 2
        args = chunk[pos:pos + size]
        pos += size
        if len(args) < size:
            break
        if kind == 0x90 and args[1] > 0:
            sounding[(channel, args[0])].append((tick, args[1]))
        elif kind == 0x80 or kind == 0x90:
            started = sounding.get((channel, args[0]))
            if started:
                start, velocity = started.pop(0)  # first on, first off
                notes.append(Note(start, tick, args[0], velocity, channel, track.index))
        elif kind == 0xC0:
            track.programs.setdefault(channel, args[0])
    track.end = tick
    # Notes never switched off end with the track.
    for (channel, pitch), started in sounding.items():
        for start, velocity in started:
            notes.append(Note(start, max(tick, start + 1), pitch, velocity, channel, track.index))


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


# ---------------------------------------------------------------- Timing


def exact_tolerance(ppq: int) -> float:
    """How far (in ticks) a start may be from the grid and still be on it: rounding, not playing."""
    return max(1.0, ppq / 96)


def choose_grid(song: Song, notes: Sequence[Note]) -> Tuple[int, bool]:
    """
    Steps per quarter note: the coarsest grid that holds every note start.
    Returns (steps, fits). When no grid holds them all, as in a recording that
    was never quantised, fits is False and the grid is the coarsest that holds
    nine starts in ten roughly (sixteenths if none does).
    """
    starts = [n.start for n in notes]
    if not starts:
        return 4, True

    def share(steps: int, tolerance: float) -> float:
        step = song.ppq / steps
        return sum(1 for s in starts if abs(s - round(s / step) * step) <= tolerance) / len(starts)

    for steps in (1, 2, 4, 3, 6, 8, 12, 16, 24):
        if share(steps, exact_tolerance(song.ppq)) == 1:
            return steps, True
    for steps in (1, 2, 4, 3, 6, 8):
        if share(steps, song.ppq / steps / 4) >= 0.9:
            return steps, False
    return 4, False


def bar_quarters(numerator: int, denominator: int) -> float:
    return numerator * 4 / denominator


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


def render(events: List[Event], total_steps: int, bar_steps: int, value=None, drums: bool = False) -> str:
    """
    The mini-notation of one line: a row per bar (or per group of bars a held
    note joins), lengths as weights. `value` maps an event to the text written
    for it (the token by default; a velocity for a velocity pattern).
    Drum hits have no length: a drum row is a row of equal steps, "bd ~ ~ bd".
    """
    value = value or (lambda e: e.token)
    events = sorted(events, key=lambda e: e.start)
    if drums:
        events = [Event(e.start, e.start + 1, e.token, e.velocity) for e in events]
    bars = total_steps // bar_steps
    # A bar line is kept unless a note sounds across it.
    crossed = set()
    for event in events:
        first = event.start // bar_steps + 1
        last = (event.end - 1) // bar_steps
        crossed.update(range(first, last + 1))
    groups: List[Tuple[int, int]] = []
    begin = 0
    for bar in range(1, bars + 1):
        if bar == bars or bar not in crossed:
            groups.append((begin, bar))
            begin = bar

    rows: List[Tuple[str, int]] = []  # (text, bars it spans)
    k = 0
    for first_bar, last_bar in groups:
        lo, hi = first_bar * bar_steps, last_bar * bar_steps
        inside = []
        while k < len(events) and events[k].start < hi:
            inside.append(events[k])
            k += 1
        nbars = last_bar - first_bar
        text = _drum_steps(inside, lo, hi, value) if drums else None
        rows.append((text or _group(inside, lo, hi, nbars, value), nbars))

    # A bar repeated in a row is written once, with !n (a group of bars, ending in @n, is not).
    counted: List[List] = []
    for row, span in rows:
        if counted and span == 1 and counted[-1][0] == row:
            counted[-1][1] += 1
        else:
            counted.append([row, 1])
    return "\n".join(row + ("!" + str(count) if count > 1 else "") for row, count in counted)


MAX_DRUM_STEPS = 16


def _drum_steps(events: List[Event], lo: int, hi: int, value) -> Optional[str]:
    """
    A bar of drum hits as equal steps, as coarse as the hits allow:
    "[bd ~ ~ bd ~ ~ bd ~]". None when that takes more than 16 steps (then the
    hits are written with weights instead, each lasting until the next).
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


def _group(events: List[Event], lo: int, hi: int, nbars: int, value) -> str:
    parts: List[Tuple[str, int]] = []
    at = lo
    for event in events:
        if event.start > at:
            parts.append(("~", event.start - at))
        end = min(event.end, hi)
        parts.append((value(event), end - event.start))
        at = end
    if at < hi:
        parts.append(("~", hi - at))
    # Rests in a row are one rest.
    joined: List[Tuple[str, int]] = []
    for token, weight in parts:
        if joined and token == "~" and joined[-1][0] == "~":
            joined[-1] = ("~", joined[-1][1] + weight)
        else:
            joined.append((token, weight))
    span = "@" + str(nbars) if nbars > 1 else ""
    if len(joined) == 1:  # one note, chord or rest for the whole group needs no brackets
        return joined[0][0] + span
    unit = reduce(math.gcd, (w for _, w in joined))
    body = " ".join(token + ("@" + str(w // unit) if w != unit else "") for token, w in joined)
    return "[" + body + "]" + span


# ---------------------------------------------------------------- Conversion


@dataclass
class Options:
    grid: Optional[int] = None
    velocity: bool = False
    drums: str = "synth"
    sound: Optional[str] = None
    max_bars: Optional[int] = None


def convert(song: Song, source_name: str, options: Options) -> str:
    notes = song.notes
    if not notes:
        raise MidiError("the file has no notes")
    tempo = song.tempos[0][1] if song.tempos else 500000
    numerator, denominator = song.time_signatures[0][1:] if song.time_signatures else (4, 4)
    quarters = bar_quarters(numerator, denominator)

    if options.grid:
        steps_per_quarter, fits = options.grid, True
    else:
        steps_per_quarter, fits = choose_grid(song, notes)
    # A bar must be a whole number of steps (7/16 needs eighths of a quarter...).
    while abs(quarters * steps_per_quarter - round(quarters * steps_per_quarter)) > 1e-9:
        steps_per_quarter *= 2
    bar_steps = round(quarters * steps_per_quarter)
    step_ticks = song.ppq / steps_per_quarter

    moved = 0
    quantised: List[Tuple[Note, int, int]] = []
    for n in notes:
        start = round(n.start / step_ticks)
        end = max(start + 1, round(n.end / step_ticks))
        if abs(start * step_ticks - n.start) > exact_tolerance(song.ppq):
            moved += 1
        quantised.append((n, start, end))
    # The song lasts until its last note ends, or until its tracks end if that is later.
    total_steps = max(max(end for _, _, end in quantised), round(max(t.end for t in song.tracks) / step_ticks))
    bars = max(1, math.ceil(total_steps / bar_steps))
    if options.max_bars:
        bars = min(bars, options.max_bars)
        limit = bars * bar_steps
        quantised = [(n, s, min(e, limit)) for n, s, e in quantised if s < limit]
    total_steps = bars * bar_steps

    tracks = {t.index: t for t in song.tracks}
    parts: Dict[Tuple[int, int], List[Tuple[Note, int, int]]] = defaultdict(list)
    for item in quantised:
        parts[(item[0].track, item[0].channel)].append(item)

    lines: List[Line] = []
    notes_about: List[str] = []
    tom_hits = 0
    for (track_index, channel), items in sorted(parts.items()):
        track = tracks[track_index]
        where = f"track {track_index + 1}, channel {channel + 1}"
        if channel == 9:
            by_sound: Dict[str, Dict[int, int]] = defaultdict(dict)  # sound -> start -> velocity
            for n, start, _ in items:
                role, synth, dirt = DRUMS.get(n.pitch, OTHER_DRUM)
                name = dirt if options.drums == "dirt" else synth
                if options.drums != "dirt" and "tom" in role:
                    tom_hits += 1
                by_sound[name][start] = max(n.velocity, by_sound[name].get(start, 0))
            title = track.name or "Drums"
            for name in sorted(by_sound, key=lambda s: DRUM_ORDER.index(s) if s in DRUM_ORDER else 99):
                events = [Event(s, s + 1, name, v) for s, v in sorted(by_sound[name].items())]
                lines.append(Line(f"{title}: {name} ({where})", events))
            continue

        family, synth, extra = gm_family(track.programs.get(channel))
        if options.sound:
            synth, extra = options.sound, ""
        # Notes that start and end together are one chord.
        chords: Dict[Tuple[int, int], List[Note]] = defaultdict(list)
        for n, start, end in items:
            chords[(start, end)].append(n)
        events = [
            Event(start, end, chord_token([n.pitch for n in group]), max(n.velocity for n in group), max(n.pitch for n in group))
            for (start, end), group in chords.items()
        ]
        voices = split_voices(events)
        title = track.name or family
        for i, voice in enumerate(voices):
            label = f"{title} ({where})" + (f", voice {i + 1} of {len(voices)}" if len(voices) > 1 else "")
            lines.append(Line(label, voice, synth, extra))

    bpm = 60e6 / tempo
    cps = (1e6 / tempo) / quarters
    grid_name = _grid_name(steps_per_quarter)
    if len({t for _, t in song.tempos}) > 1:
        notes_about.append(f"the tempo changes {len(song.tempos) - 1} times; only the first, {bpm:g} bpm, is kept")
    if len({(n_, d) for _, n_, d in song.time_signatures}) > 1:
        notes_about.append(f"the time signature changes; every bar here is {numerator}/{denominator}")
    if not fits:
        notes_about.append(f"the timing is not on a grid (a live recording?): {moved} note starts were rounded "
                           f"to the nearest {grid_name}; --grid picks another grid")
    elif moved:
        notes_about.append(f"{moved} note starts were moved to the nearest {grid_name}")
    if tom_hits:
        hits = "1 tom hit plays" if tom_hits == 1 else f"{tom_hits} tom hits play"
        notes_about.append(f"there is no built-in tom: {hits} bd (--drums dirt plays lt, mt and ht)")

    out: List[str] = []
    out.append(f"// {os.path.basename(source_name)}, converted by tool/midi2tidal.py")
    out.append(f"// {bpm:.4g} bpm, {numerator}/{denominator}, {bars} bar{'s' if bars != 1 else ''}, one bar per cycle, grid of {grid_name}s")
    for line in notes_about:
        out.append("// Note: " + line)
    if options.drums == "dirt" and any(not line.sound for line in lines):
        out.append('samples("github:tidalcycles/dirt-samples")')
    out.append(f"setCPS({_number(cps)})")
    out.append("")
    out.append("stack([")
    for i, line in enumerate(lines):
        out.append(f"  // {line.comment}")
        out.append("  " + _pattern(line, total_steps, bar_steps, bars, options) + ("," if i < len(lines) - 1 else ""))
    out.append("])")
    return "\n".join(out) + "\n"


def _pattern(line: Line, total_steps: int, bar_steps: int, bars: int, options: Options) -> str:
    drums = not line.sound
    text = render(line.events, total_steps, bar_steps, drums=drums)
    code = ("sound(" if drums else "note(") + _quote(text) + ")"
    if options.velocity:
        # The same shape as the notes, so each note takes the velocity written in its place.
        velocities = {e.velocity for e in line.events}
        if len(velocities) == 1:
            code += f".velocity({_number(round(velocities.pop() / 127, 2))})"
        elif velocities:
            pattern = render(line.events, total_steps, bar_steps, value=lambda e: _number(round(e.velocity / 127, 2)), drums=drums)
            code += ".velocity(" + _quote(pattern) + ")"
    # .velocity() comes before .slow(): both texts are laid out over the same bars.
    if bars > 1:
        code += f".slow({bars})"
    if not drums:
        code += f'.sound("{line.sound}").legato(1){line.extra}'
    return code


def _quote(text: str) -> str:
    if "\n" not in text:
        return '"' + _unwrap(text) + '"'
    return "`" + text.replace("\n", "\n    ") + "`"


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


def _number(x: float) -> str:
    return f"{x:.4f}".rstrip("0").rstrip(".") or "0"


def _grid_name(steps_per_quarter: int) -> str:
    names = {1: "quarter note", 2: "eighth note", 3: "eighth-note triplet", 4: "sixteenth note",
             6: "sixteenth-note triplet", 8: "thirty-second note", 12: "thirty-second-note triplet"}
    return names.get(steps_per_quarter, f"1/{steps_per_quarter} of a quarter note")


# ---------------------------------------------------------------- Command line


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="midi2tidal",
        description="Convert a Standard MIDI File (.mid) into TidalJS code: one bar per cycle, a stack of note() and sound() lines.",
    )
    parser.add_argument("midi", help="the .mid file to convert")
    parser.add_argument("-o", "--output", help="write the code to this file (default: print it)")
    parser.add_argument("--grid", type=int, metavar="STEPS",
                        help="steps per quarter note to round the timing to: 4 for sixteenths, 3 or 6 for triplets "
                             "(default: the coarsest grid that fits the notes)")
    parser.add_argument("--velocity", action="store_true", help="keep the dynamics: add .velocity() patterns")
    parser.add_argument("--drums", choices=["synth", "dirt"], default="synth",
                        help="synth: built-in drum synths (bd, sn, hh...); dirt: Dirt-Samples banks, loaded from GitHub (default: synth)")
    parser.add_argument("--sound", metavar="NAME", help="play every pitched line with this sound instead of one picked by the MIDI program")
    parser.add_argument("--bars", type=int, metavar="N", help="convert only the first N bars")
    args = parser.parse_args(argv)

    if args.grid is not None and args.grid < 1:
        parser.error("--grid must be at least 1")
    if args.bars is not None and args.bars < 1:
        parser.error("--bars must be at least 1")
    try:
        with open(args.midi, "rb") as f:
            song = read_midi(f.read())
        code = convert(song, args.midi, Options(args.grid, args.velocity, args.drums, args.sound, args.bars))
    except OSError as error:
        print(f"midi2tidal: {error.filename}: {error.strerror}", file=sys.stderr)
        return 1
    except MidiError as error:
        print(f"midi2tidal: {args.midi}: {error}", file=sys.stderr)
        return 1
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as f:
            f.write(code)
        print(f"midi2tidal: wrote {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(code)
    return 0


if __name__ == "__main__":
    sys.exit(main())
