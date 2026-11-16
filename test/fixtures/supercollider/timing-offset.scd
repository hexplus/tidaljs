// Events moved by timingOffset keep their own length: the first Pbind's
// notes start half a beat late every other beat, the second one's half a beat
// early (so a step ends at an early next onset); each note lasts dur * legato.
(
Pbind(\degree, Pseq([0, 4], inf), \dur, 1, \timingOffset, Pseq([0.5, 0], inf)).play;
Pbind(\degree, Pseq([7, 9], inf), \dur, 1, \legato, 0.5, \timingOffset, Pseq([0, -0.5], inf)).play;
)
