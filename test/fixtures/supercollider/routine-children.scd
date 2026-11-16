// A routine that ends after 3 beats. The melody it starts plays on when the
// routine ends (in SuperCollider a routine's end does not stop the patterns it
// started); the bass is stopped by the routine at beat 3.
(
Routine({
    var bass;
    Pbind(\degree, Pseq([0, 2, 4], inf), \dur, 0.25).play;
    bass = Pbind(\degree, 0, \octave, 4, \dur, 1).play;
    3.wait;
    bass.stop;
}).play;
)
