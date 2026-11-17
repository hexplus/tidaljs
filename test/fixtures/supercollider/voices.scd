// Two synths started at the same instant in a routine, each with its own
// pitch, filter, level and length (each is released at its own time).
(
SynthDef(\pad, { |out = 0, freq = 440, amp = 0.1, cutoff = 2000, gate = 1|
    var sig = Saw.ar(freq) * Env.asr(0.01, 1, 0.1).kr(2, gate);
    Out.ar(out, Pan2.ar(LPF.ar(sig, cutoff) * amp));
}).add;
)
(
Routine({
    loop {
        var a, b;
        a = Synth(\pad, [\freq, 200, \cutoff, 800]);
        b = Synth(\pad, [\freq, 500, \cutoff, 3000, \amp, 0.05]);
        0.25.wait;
        a.release;
        0.25.wait;
        b.release;
        0.5.wait;
    }
}).play;
)
