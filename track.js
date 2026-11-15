// Gabber kick + hoover: the TidalJS version of track.txt (SuperCollider).
// 210 BPM. The kick figure lasts 7 beats, so one cycle = 7 beats:
// 210 / 60 / 7 = 0.5 cycles per second.
setCPS(0.5)

// As SuperCollider: the sound goes out as it is, without TidalJS's master
// volume (0.8) and limiter. Turn it down if it clips.
setOutput(1, false)

// The kick figure in beats, as in the SuperCollider code.
const durations = [1, 1, 1, 1, 3/4, 1/4, 1/2, 3/4, 1/4, 1/2]

// One step per kick, d * 4 quarter beats long; f(d, i) gives each step's value.
const steps = (f) => durations.map((d, i) => f(d, i) + "@" + d * 4).join(" ")

// ffreq: Pseq((0..39).normalize, inf).linexp(0, 1, 100, 4000), one value per kick.
const ffreq = fit(10, Array.from({ length: 40 }, (_, i) => 100 * 40 ** (i / 39)), steps((d, i) => i))

// bend: kicks shorter than half a beat fall 0.4 of the 48 semitones.
const bend = steps((d) => (d < 1/2 ? 0.4 : 1) * 48)

// \gabberkick: supergabber is the same SynthDef (a saw falling to 60 Hz over
// Env.perc(0.001, 0.08, curve: -1), the tanh distortion, the chorused high
// band and Env.asr(0.001, 1, 0.05)). The filters after it are effects here.
const gabber = sound("supergabber").struct(steps(() => "x"))
  .freq(60).legato(0.8)
  .penv(bend)                           // freq * (Env.perc(...) * 48 * \bend).midiratio
  .lpf(7000)                            // RLPF.ar(snd, 7000, 2): resonance is SuperDirt's 0..1
  .resonance(Math.log10(1 / 2) / 3)     //   (rq = 1000^-resonance), so rq 2 is log10(1/2)/3
  .peak(ffreq).peakq(2).peakgain(15)    // BPeakEQ.ar(snd, \ffreq, 0.5, 15)
  .peakenv(-0.322).peakattack(0.3)      // ... * XLine.kr(1, 0.8, 0.3): log2(0.8) octaves;
  .peakrelease(60)                      //   XLine does not come back (60 s: not in this note)
  .amp(10 ** (-23 / 20))                // -23.dbamp

// \hoover: superhoover is the same SynthDef (20 voices of two detuned saws,
// randomly delayed, splayed and atan-saturated, the -5 > +6 > 0 pitch scoop,
// Env.asr(0.01, 1, 1), FreeVerb2(mix 0.3, room 0.9), then Env.asr(0, 1, 4, 6)).
const hoover = sound("superhoover").midinote(74)
  .legato(0.5)                          // sustain: 7 of its 14 beats
  .amp(10 ** (-20 / 20))                // -20.dbamp
  .slow(2)                              // dur: durations.sum * 2 = 14 beats

stack([gabber, hoover])
