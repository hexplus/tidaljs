// A Pdef started by one routine and stopped then played again by another
// routine (earlier in the file): it stops at beat 4.5 and starts again, from
// its first note, on the beat after the second play (beat 6).
(
Pdef(\a, Pbind(\degree, Pseq([0, 2, 4], inf), \dur, 1));
Routine({ 4.5.wait; Pdef(\a).stop; 1.wait; Pdef(\a).play }).play;
Routine({ 1.wait; Pdef(\a).play }).play;
)
