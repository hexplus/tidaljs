"""
Builds Standard MIDI Files for the converter tests, with the standard library
only. Events are (tick, bytes) pairs; track() sorts them and writes the delta
times, optionally with running status.
"""

from __future__ import annotations

import struct
from typing import Iterable, List, Sequence, Tuple

Event = Tuple[int, bytes]


def varlen(n: int) -> bytes:
    out = [n & 0x7F]
    while n > 0x7F:
        n >>= 7
        out.insert(0, (n & 0x7F) | 0x80)
    return bytes(out)


def header(fmt: int, ntracks: int, division: int) -> bytes:
    return b"MThd" + struct.pack(">IHHH", 6, fmt, ntracks, division)


def smpte_division(fps: int, ticks_per_frame: int) -> int:
    return ((256 - fps) << 8) | ticks_per_frame


def chunk(kind: bytes, body: bytes) -> bytes:
    return kind + struct.pack(">I", len(body)) + body


def track(events: Iterable[Event], running: bool = False, end: int | None = None) -> bytes:
    """An MTrk chunk. `end` places the end-of-track event (default: right after the last event)."""
    body = b""
    last = 0
    status = None
    ordered = sorted(events, key=lambda e: e[0])
    for tick, message in ordered:
        if running and message[0] < 0xF0 and message[0] == status:
            message = message[1:]
        elif message[0] < 0xF0:
            status = message[0]
        body += varlen(tick - last) + message
        last = tick
    finish = max(last, end if end is not None else last)
    body += varlen(finish - last) + b"\xff\x2f\x00"
    return chunk(b"MTrk", body)


def midi(fmt: int, division: int, tracks: Sequence[bytes]) -> bytes:
    return header(fmt, len(tracks), division) + b"".join(tracks)


def tempo(tick: int, bpm: float) -> Event:
    return tick, b"\xff\x51\x03" + round(60e6 / bpm).to_bytes(3, "big")


def meter(tick: int, numerator: int, denominator: int) -> Event:
    return tick, bytes([0xFF, 0x58, 0x04, numerator, denominator.bit_length() - 1, 24, 8])


def name(text: str, tick: int = 0) -> Event:
    data = text.encode("utf-8")
    return tick, b"\xff\x03" + varlen(len(data)) + data


def program(tick: int, channel: int, number: int) -> Event:
    return tick, bytes([0xC0 | channel, number])


def control(tick: int, channel: int, number: int, value: int) -> Event:
    return tick, bytes([0xB0 | channel, number, value])


def bend(tick: int, channel: int, value: int = 0x2000) -> Event:
    return tick, bytes([0xE0 | channel, value & 0x7F, value >> 7])


def note(start: int, length: int, pitch: int, velocity: int = 100, channel: int = 0, off_as_on: bool = False) -> List[Event]:
    """A note-on and its note-off (or a note-on with velocity 0)."""
    off = bytes([0x90 | channel, pitch, 0]) if off_as_on else bytes([0x80 | channel, pitch, 64])
    return [(start, bytes([0x90 | channel, pitch, velocity])), (start + length, off)]


def notes(items: Iterable[Tuple[int, int, int, int]], channel: int = 0) -> List[Event]:
    """(start, length, pitch, velocity) tuples as note events."""
    out: List[Event] = []
    for start, length, pitch, velocity in items:
        out += note(start, length, pitch, velocity, channel)
    return out


def port(tick: int, number: int) -> Event:
    """The MIDI port meta event: the track's channel messages go to this port from here on."""
    return tick, bytes([0xFF, 0x21, 0x01, number])


def riff_chunk(kind: bytes, body: bytes) -> bytes:
    """A RIFF chunk: little-endian length, padded to an even length."""
    return kind + struct.pack("<I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")


def rmid(chunks: Sequence[bytes]) -> bytes:
    """An RMID file: a RIFF form of type RMID holding the given chunks (one of them "data", with the MIDI file)."""
    body = b"RMID" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body
