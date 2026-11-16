// One Pbind whose events take turns between two SynthDefs with different
// filters, envelopes and routing (\high goes through a reverb on a bus).
(
~verb = Bus.audio(s, 2);
SynthDef(\low, { |out = 0, freq = 440, amp = 0.1|
    var sig = RLPF.ar(Saw.ar(freq), 600, 0.5) * Env.perc(0.005, 0.3).ar(2);
    Out.ar(out, Pan2.ar(sig * amp, -0.5));
}).add;
SynthDef(\high, { |out = 0, freq = 440, amp = 0.1|
    var sig = HPF.ar(Pulse.ar(freq), 2500) * Env.perc(0.05, 0.8).ar(2);
    Out.ar(~verb, Pan2.ar(sig * amp, 0.5));
}).add;
SynthDef(\verb, { |in|
    Out.ar(0, FreeVerb.ar(In.ar(in, 2), 0.4, 0.8));
}).add;
)
(
Synth(\verb, [\in, ~verb]);
Pbind(\instrument, Pseq([\low, \high, \low], inf), \degree, Pseq([0, 4, 7], inf), \dur, 0.5).play;
)
