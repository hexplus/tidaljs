// Two routines play one Pdef. The first (earlier in the file) plays it at
// beat 4 and again every 8 beats, for ever; the second starts it at beat 1.
// It plays from beat 1, once: the first routine's plays find it playing.
(
Pdef(\a, Pbind(\degree, Pseq([0, 1, 2, 3], inf), \dur, 0.5));
Routine({ 4.wait; Pdef(\a).play; loop { 8.wait; Pdef(\a).play } }).play;
Routine({ 1.wait; Pdef(\a).play }).play;
)
