/**
 * TidalJS - Live Coding Music Library
 * A JavaScript implementation of Tidal Cycles for web browsers
 * 
 * Features all Phase 1 core functions for professional live coding:
 * - Pattern fundamentals (sound, note, up, freq, etc.)
 * - Time transformations (every, sometimes, density, etc.)
 * - Audio effects (lpf, reverb, delay, vowel, etc.)
 * - Composition functions (stack, append, superimpose, etc.)
 * 
 * Usage:
 * const tidal = new TidalJS();
 * await tidal.init();
 * sound("bd sn bd sn").every(4, x => x.fast(2)).play();
 */

class TidalJS {
    constructor() {
        this.audioContext = null;
        this.cps = 0.8; // cycles per second (tempo)
        this.startTime = 0; // when audio started
        this.channels = new Map(); // active pattern channels
        this.isPlaying = false; // global play state
        this.samples = new Map(); // sample definitions
        this.channelCounter = 0; // unique channel IDs
        this.masterGain = null; // master volume control
        this.currentCycle = 0; // current cycle number
        this.lastScheduledTime = 0; // timing reference
        this.impulseCache = new Map(); // cached reverb impulses
        
        this.initSamples();
    }
    
    /**
     * Creates a deep copy of an object to prevent mutation bugs
     * Handles dates, arrays, and nested objects properly
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        return cloned;
    }
    
    /**
     * Validates parameter types and logs warnings for incorrect usage
     * Returns true if type matches, false otherwise
     */
    validateType(value, expectedType, paramName = 'parameter') {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== expectedType) {
            console.warn(`Type validation failed: ${paramName} expected ${expectedType}, got ${actualType}`);
            return false;
        }
        return true;
    }
    
    /**
     * Converts note names to MIDI note numbers
     * Supports formats like: c, c4, c#, cs, db, etc.
     * Returns 60 (middle C) as fallback for invalid notes
     */
    noteToMidi(noteName) {
        if (!this.validateType(noteName, 'string', 'noteName')) {
            return 60; // Middle C fallback
        }
        
        const noteMap = {
            'c': 0, 'cs': 1, 'c#': 1, 'db': 1, 'd': 2, 'ds': 3, 'd#': 3, 'eb': 3, 
            'e': 4, 'f': 5, 'fs': 6, 'f#': 6, 'gb': 6, 'g': 7, 'gs': 8, 'g#': 8, 
            'ab': 8, 'a': 9, 'as': 10, 'a#': 10, 'bb': 10, 'b': 11
        };
        
        const match = noteName.toLowerCase().match(/^([a-g][sb#]?)(\d*)$/);
        if (!match) {
            console.warn(`Invalid note format: ${noteName}, using C4`);
            return 60;
        }
        
        const notePart = match[1];
        const octave = match[2] ? Math.max(0, Math.min(9, parseInt(match[2]))) : 4;
        
        const noteValue = noteMap[notePart];
        if (noteValue === undefined) {
            console.warn(`Unknown note: ${notePart}, using C4`);
            return 60;
        }
        
        const midiNote = (octave * 12) + noteValue;
        return Math.max(0, Math.min(127, midiNote)); // Clamp to valid MIDI range
    }
    
    /**
     * Converts MIDI note number to frequency in Hz
     * Uses standard tuning: A4 = 440 Hz
     */
    midiToFreq(midiNote) {
        const validMidi = Math.max(0, Math.min(127, midiNote));
        return 440 * Math.pow(2, (validMidi - 69) / 12);
    }
    
    /**
     * Calculates the current cycle number based on elapsed time
     * Used for timing-dependent functions like every() and whenmod()
     */
    getCurrentCycle() {
        if (!this.audioContext || !this.isPlaying) return 0;
        const elapsed = this.audioContext.currentTime - this.startTime;
        return Math.floor(elapsed * this.cps);
    }
    
    /**
     * Initializes the audio system and sets up global functions
     * Must be called before using any audio features
     * Returns true on success, false on failure
     */
    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Resume if suspended (browser autoplay policy)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Create master gain for global volume control
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
            
            this.startTime = this.audioContext.currentTime;
            this.lastScheduledTime = this.startTime;
            this.isPlaying = true;
            
            this.setupGlobalFunctions();
            
            console.log('TidalJS initialized successfully');
            return true;
        } catch (error) {
            console.error('Audio initialization failed:', error);
            return false;
        }
    }
    
    /**
     * Sets up global functions available in the window scope
     * Includes sound(), stack(), cat(), layer(), and utility functions
     */
    setupGlobalFunctions() {
        window.tidal = this;
        
        // Creates a new sound pattern
        window.sound = (pattern) => {
            try {
                const builder = new PatternBuilder(this);
                builder.channelId = this.channelCounter++;
                return builder.sound(pattern);
            } catch (error) {
                console.error('Error in sound():', error);
                return new PatternBuilder(this);
            }
        };
        
        // Layers multiple patterns simultaneously
        window.stack = (patterns) => {
            try {
                if (!Array.isArray(patterns)) {
                    patterns = Array.from(arguments);
                }
                
                const builder = new PatternBuilder(this);
                builder.channelId = this.channelCounter++;
                
                const allEvents = [];
                
                for (const pattern of patterns) {
                    if (pattern instanceof PatternBuilder) {
                        const processedEvents = pattern.applyTransforms();
                        allEvents.push(...this.deepClone(processedEvents));
                    } else if (typeof pattern === 'string') {
                        const events = this.parseMiniNotation(pattern);
                        allEvents.push(...this.deepClone(events));
                    } else {
                        console.warn('Invalid pattern type in stack:', typeof pattern);
                    }
                }
                
                builder.pattern = allEvents;
                return builder;
            } catch (error) {
                console.error('Error in stack():', error);
                return new PatternBuilder(this);
            }
        };
        
        // Concatenates patterns sequentially in time
        window.cat = (patterns) => {
            try {
                if (!Array.isArray(patterns)) {
                    patterns = Array.from(arguments);
                }
                
                const builder = new PatternBuilder(this);
                builder.channelId = this.channelCounter++;
                return builder.cat(patterns);
            } catch (error) {
                console.error('Error in cat():', error);
                return new PatternBuilder(this);
            }
        };
        
        // Alias for stack() - layers multiple patterns
        window.layer = (patterns) => {
            try {
                if (!Array.isArray(patterns)) {
                    patterns = Array.from(arguments);
                }
                return window.stack(patterns);
            } catch (error) {
                console.error('Error in layer():', error);
                return new PatternBuilder(this);
            }
        };
        
        // Applies a rhythmic structure to a sound pattern
        window.struct = (structPattern, soundPattern) => {
            try {
                const builder = new PatternBuilder(this);
                builder.channelId = this.channelCounter++;
                return builder.struct(structPattern, soundPattern);
            } catch (error) {
                console.error('Error in struct():', error);
                return new PatternBuilder(this);
            }
        };
        
        // Sets the tempo in cycles per second
        window.setCPS = (newCPS) => {
            if (this.validateType(newCPS, 'number', 'CPS')) {
                this.cps = Math.max(0.1, Math.min(10, parseFloat(newCPS)));
            }
        };
        
        // Sets the tempo in beats per minute
        window.setTempo = (bpm) => {
            if (this.validateType(bpm, 'number', 'BPM')) {
                this.cps = Math.max(20, Math.min(300, bpm)) / 240;
            }
        };
        
        // Stops all currently playing patterns
        window.stopAll = () => this.stopAll();
        
        // Test function for basic audio functionality
        window.testAudio = () => {
            console.log('🧪 Testing direct audio...');
            try {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                
                osc.connect(gain);
                gain.connect(this.audioContext.destination);
                
                osc.frequency.value = 440;
                osc.type = 'sine';
                
                gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                gain.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
                
                osc.start(this.audioContext.currentTime);
                osc.stop(this.audioContext.currentTime + 0.5);
                
                console.log('🔊 Direct audio test scheduled - you should hear a 440Hz tone');
            } catch (error) {
                console.error('❌ Direct audio test failed:', error);
            }
        };
        
        // Test function for TidalJS audio chain
        window.testTidalDirect = () => {
            console.log('🧪 Testing TidalJS audio chain...');
            try {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                
                osc.connect(gain);
                gain.connect(this.masterGain);
                
                osc.frequency.value = 440;
                osc.type = 'sine';
                
                gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                gain.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
                
                osc.start(this.audioContext.currentTime);
                osc.stop(this.audioContext.currentTime + 0.5);
                
                console.log('🔊 TidalJS chain test - should hear 440Hz through masterGain');
                console.log(`🎛️ Master gain value: ${this.masterGain.gain.value}`);
            } catch (error) {
                console.error('❌ TidalJS chain test failed:', error);
            }
        };
        
        // Selects a random element from an array
        window.choose = (options) => {
            if (!Array.isArray(options) || options.length === 0) {
                console.warn('choose() requires non-empty array');
                return null;
            }
            return options[Math.floor(Math.random() * options.length)];
        };
        
        // Selects an element based on current cycle
        window.cycleChoose = (options) => {
            if (!Array.isArray(options) || options.length === 0) {
                console.warn('cycleChoose() requires non-empty array');
                return null;
            }
            const cycle = this.getCurrentCycle();
            return options[cycle % options.length];
        };
    }
    
    /**
     * Initializes the built-in sample definitions
     * Each sample has a type, frequency, decay time, and number of variations
     */
    initSamples() {
        const sampleDefs = {
            'bd': { type: 'kick', freq: 60, decay: 0.5, variations: 3 },
            'sn': { type: 'snare', freq: 200, decay: 0.2, variations: 4 },
            'hh': { type: 'hihat', freq: 8000, decay: 0.1, variations: 2 },
            'cp': { type: 'clap', freq: 1000, decay: 0.15, variations: 2 },
            'oh': { type: 'openhat', freq: 8000, decay: 0.3, variations: 2 },
            'ch': { type: 'closedhat', freq: 10000, decay: 0.05, variations: 2 },
            'cy': { type: 'cymbal', freq: 5000, decay: 0.8, variations: 3 },
            'arpy': { type: 'arp', freq: 440, decay: 0.3, variations: 5 },
            'sine': { type: 'sine', freq: 440, decay: 0.5, variations: 1 },
            'saw': { type: 'saw', freq: 440, decay: 0.5, variations: 1 },
            'square': { type: 'square', freq: 440, decay: 0.5, variations: 1 }
        };
        
        for (const [name, def] of Object.entries(sampleDefs)) {
            this.samples.set(name, def);
        }
    }

    /**
     * Creates an impulse response buffer for reverb effects
     * Generates noise with exponential decay for realistic reverb
     */
    createImpulseResponse(context, duration = 2.0, decay = 2.0) {
        const rate = context.sampleRate;
        const length = rate * duration;
        const impulse = context.createBuffer(2, length, rate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
    
        return impulse;
    }

    /**
     * Creates a bit-crushing curve for the WaveShaper
     * Reduces bit depth to create digital distortion effects
     */
    makeBitCrushCurve(bits) {
        const samples = 65536;
        const curve = new Float32Array(samples);
        const step = Math.pow(0.5, bits);
        
        for (let i = 0; i < samples; i++) {
            const x = (i - samples/2) / (samples/2);
            curve[i] = Math.round(x / step) * step;
        }
        return curve;
    }
    
    /**
     * Creates a vowel filter using multiple bandpass filters
     * Simulates human vocal tract formants for vowel sounds
     */
    createVowelFilter(context, vowelFormants) {
        try {
            const vowelChain = [];
            
            // Create bandpass filters for each formant frequency
            vowelFormants.forEach((freq, index) => {
                const filter = context.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = Math.max(20, Math.min(20000, freq));
                
                // Different Q values for different formants (F1, F2, F3)
                const qValues = [8, 4, 2]; // Lower formants get higher Q (narrower)
                filter.Q.value = qValues[index] || 2;
                
                vowelChain.push(filter);
            });
            
            // Connect filters in parallel for authentic vowel sound
            const inputGain = context.createGain();
            const outputGain = context.createGain();
            
            // Mix the formants with different gains
            const formantGains = [0.8, 0.6, 0.4]; // F1 strongest, F3 weakest
            
            vowelChain.forEach((filter, index) => {
                const formantGain = context.createGain();
                formantGain.gain.value = formantGains[index] || 0.3;
                
                inputGain.connect(filter);
                filter.connect(formantGain);
                formantGain.connect(outputGain);
            });
            
            return {
                type: 'vowel',
                input: inputGain,
                output: outputGain,
                filters: vowelChain
            };
        } catch (error) {
            console.error('Error creating vowel filter:', error);
            return null;
        }
    }
    
    /**
     * Creates a chain of audio effects in the proper order
     * Handles filters, distortion, delay, reverb, and panning
     */
    createFilterChain(effects = {}) {
        const chain = [];
        const context = this.audioContext;
        
        try {
            // Filters first (order matters for audio quality)
            if (typeof effects.lpf === 'number' && effects.lpf > 0) {
                const lpf = context.createBiquadFilter();
                lpf.type = 'lowpass';
                lpf.frequency.value = Math.max(20, Math.min(20000, effects.lpf));
                lpf.Q.value = 1;
                chain.push(lpf);
            }

            if (typeof effects.hpf === 'number' && effects.hpf > 0) {
                const hpf = context.createBiquadFilter();
                hpf.type = 'highpass';
                hpf.frequency.value = Math.max(20, Math.min(20000, effects.hpf));
                hpf.Q.value = 1;
                chain.push(hpf);
            }

            if (typeof effects.bpf === 'number' && effects.bpf > 0) {
                const bpf = context.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.value = Math.max(20, Math.min(20000, effects.bpf));
                bpf.Q.value = 1;
                chain.push(bpf);
            }

            // Vowel filter
            if (Array.isArray(effects.vowel) && effects.vowel.length > 0) {
                const vowelFilter = this.createVowelFilter(context, effects.vowel);
                if (vowelFilter) {
                    chain.push(vowelFilter);
                }
            }

            // Distortion
            if (typeof effects.distortion === 'number' && effects.distortion > 0) {
                const waveShaper = context.createWaveShaper();
                waveShaper.curve = this.makeDistortionCurve(Math.max(1, effects.distortion));
                waveShaper.oversample = '4x';
                chain.push(waveShaper);
            }

            // Bit crusher
            if (typeof effects.crush === 'number') {
                const bits = Math.floor(Math.max(1, Math.min(16, effects.crush)));
                const waveShaper = context.createWaveShaper();
                waveShaper.curve = this.makeBitCrushCurve(bits);
                waveShaper.oversample = 'none';
                chain.push(waveShaper);
            }

            // Delay with feedback
            if (typeof effects.delay === 'number' && effects.delay > 0) {
                const delayTime = Math.max(0.001, Math.min(2.0, effects.delay));
                const delayNode = context.createDelay(2.0);
                const feedbackGain = context.createGain();
                const wetGain = context.createGain();
                const dryGain = context.createGain();
                const outputMixer = context.createGain();
                
                delayNode.delayTime.value = delayTime;
                feedbackGain.gain.value = 0.3; // Feedback amount
                wetGain.gain.value = 0.5;     // Wet signal
                dryGain.gain.value = 0.7;     // Dry signal
                
                // Create feedback loop
                delayNode.connect(feedbackGain);
                feedbackGain.connect(delayNode);
                delayNode.connect(wetGain);
                wetGain.connect(outputMixer);
                dryGain.connect(outputMixer);
                
                chain.push({
                    type: 'delay',
                    input: delayNode,
                    dryInput: dryGain,
                    output: outputMixer
                });
            }

            // Reverb with impulse response caching
            if (typeof effects.reverb === 'number' && effects.reverb > 0) {
                const convolver = context.createConvolver();
                const duration = Math.max(0.1, Math.min(5.0, effects.reverb));
                const key = `reverb_${duration.toFixed(2)}`;
                
                if (!this.impulseCache.has(key)) {
                    this.impulseCache.set(key, this.createImpulseResponse(context, duration, 2.0));
                }
                
                convolver.buffer = this.impulseCache.get(key);
                chain.push(convolver);
            }

            // Pan (prevent conflicts with other panApplied markers)
            if (typeof effects.pan === 'number' && !effects.panApplied) {
                const panner = context.createStereoPanner();
                panner.pan.value = Math.max(-1, Math.min(1, effects.pan));
                chain.push(panner);
                effects.panApplied = true;
            }
            
        } catch (error) {
            console.error('Error creating filter chain:', error);
        }
        
        return chain;
    }

    /**
     * Creates a distortion curve for the WaveShaper
     * Uses arc tangent-based formula for smooth distortion
     */
    makeDistortionCurve(amount) {
        const k = amount;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
    
    /**
     * Connects audio nodes through an effects chain
     * Handles complex nodes like delay and vowel filters
     */
    connectWithEffects(source, destination, effects = {}) {
        try {
            const chain = this.createFilterChain(effects);
            
            if (chain.length === 0) {
                source.connect(destination);
                return;
            }
            
            let currentNode = source;
            
            for (const filter of chain) {
                if (filter.type === 'delay') {
                    // Handle complex delay node with dry/wet mixing
                    currentNode.connect(filter.input);
                    currentNode.connect(filter.dryInput);
                    currentNode = filter.output;
                } else if (filter.type === 'vowel') {
                    // Handle complex vowel filter with parallel formants
                    currentNode.connect(filter.input);
                    currentNode = filter.output;
                } else {
                    // Handle simple nodes
                    currentNode.connect(filter);
                    currentNode = filter;
                }
            }
            
            currentNode.connect(destination);
        } catch (error) {
            console.error('Error in connectWithEffects:', error);
            // Fallback: direct connection
            try {
                source.connect(destination);
            } catch (fallbackError) {
                console.error('Fallback connection also failed:', fallbackError);
            }
        }
    }
    
    /**
     * Plays a sample by name with specified parameters
     * Handles timing, effects, and musical transformations
     */
    async playSample(name, gain = 0.7, effects = {}, musical = {}, exactTime = null) {
        // Verify AudioContext is ready
        if (!this.audioContext || this.audioContext.state !== 'running') {
            console.warn('AudioContext not ready for playback, state:', this.audioContext?.state);
            return;
        }
        
        // Skip silence events
        if (!name || name === '~') {
            return;
        }
        
        const sampleDef = this.samples.get(name);
        if (!sampleDef) {
            console.warn(`Sample '${name}' not found`);
            return;
        }
        
        // Use precise AudioContext timing
        const startTime = exactTime !== null ? exactTime : this.audioContext.currentTime;
        const safeGain = Math.max(0, Math.min(1, gain || 0.7));
        
        console.log(`🔊 Attempting to play sample "${name}" at time ${startTime.toFixed(3)}, gain: ${safeGain}`);
        
        // Calculate final frequency with musical transformations
        let finalFreq = sampleDef.freq;
        
        if (typeof musical.freq === 'number') {
            finalFreq = Math.max(20, Math.min(20000, musical.freq));
        } else if (typeof musical.midinote === 'number') {
            finalFreq = this.midiToFreq(musical.midinote);
        } else if (typeof musical.note === 'string') {
            const midiNote = this.noteToMidi(musical.note);
            finalFreq = this.midiToFreq(midiNote);
        }
        
        if (typeof musical.up === 'number') {
            const semitones = Math.max(-48, Math.min(48, musical.up));
            finalFreq = finalFreq * Math.pow(2, semitones / 12);
        }
        
        // Calculate sample variation
        let sampleVariation = 0;
        if (typeof musical.n === 'number' && sampleDef.variations) {
            sampleVariation = Math.abs(Math.floor(musical.n)) % sampleDef.variations;
        }
        
        console.log(`🎵 Playing ${sampleDef.type} at ${finalFreq.toFixed(1)}Hz, variation: ${sampleVariation}`);
        
        try {
            // Route to appropriate synthesis method
            switch (sampleDef.type) {
                case 'kick':
                    this.playKick(startTime, safeGain, effects, finalFreq, sampleVariation);
                    break;
                case 'snare':
                    this.playSnare(startTime, safeGain, effects, finalFreq, sampleVariation);
                    break;
                case 'hihat':
                case 'openhat':
                case 'closedhat':
                    this.playHihat(startTime, safeGain, sampleDef.decay, effects, finalFreq, sampleVariation);
                    break;
                case 'clap':
                    this.playClap(startTime, safeGain, effects, finalFreq, sampleVariation);
                    break;
                case 'sine':
                case 'saw':
                case 'square':
                    this.playSynth(startTime, sampleDef.type, finalFreq, sampleDef.decay, safeGain, effects);
                    break;
                default:
                    this.playTone(startTime, finalFreq, sampleDef.decay, safeGain, effects);
            }
            console.log(`✅ Successfully scheduled ${name}`);
        } catch (error) {
            console.error(`❌ Error playing sample ${name}:`, error);
        }
    }
    
    /**
     * Synthesizes basic waveforms (sine, saw, square)
     * Used for melodic content and basic synthesis
     */
    playSynth(startTime, waveType, freq, decay, gain = 0.4, effects = {}) {
        try {
            const osc = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            this.connectWithEffects(osc, gainNode, effects);
            gainNode.connect(this.masterGain);

            osc.frequency.value = freq;
            osc.type = waveType;

            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.001);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + decay);

            osc.start(startTime);
            osc.stop(startTime + decay);
        } catch (error) {
            console.error('Error in playSynth:', error);
        }
    }
    
    /**
     * Synthesizes kick drum sounds using pitched oscillator
     * Sweeps from high to low frequency with exponential decay
     */
    playKick(startTime, gain = 0.8, effects = {}, freq = 60, variation = 0) {
        try {
            console.log(`🥁 Creating kick: gain=${gain}, freq=${freq}, startTime=${startTime.toFixed(3)}`);
            
            const osc = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            // Use effects chain or direct connection
            if (Object.keys(effects).length === 0) {
                console.log('🔌 Direct connection: osc → gainNode → masterGain');
                osc.connect(gainNode);
                gainNode.connect(this.masterGain);
            } else {
                console.log('🔌 Effect chain connection: osc → effects → gainNode → masterGain');
                this.connectWithEffects(osc, gainNode, effects);
                gainNode.connect(this.masterGain);
            }

            const baseFreq = freq + (variation * 10);
            const targetFreq = Math.max(20, baseFreq * 0.3);

            osc.frequency.setValueAtTime(baseFreq, startTime);
            osc.frequency.exponentialRampToValueAtTime(targetFreq, startTime + 0.1);
            osc.type = 'sine';

            const decayTime = Math.max(0.1, 0.3 + (variation * 0.1));

            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.001);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);

            osc.start(startTime);
            osc.stop(startTime + decayTime);
            
            console.log(`✅ Kick scheduled: ${baseFreq}→${targetFreq}Hz, ${decayTime.toFixed(3)}s decay`);
            console.log(`🔊 Master volume: ${this.masterGain.gain.value}, Audio state: ${this.audioContext.state}`);
        } catch (error) {
            console.error('❌ Error in playKick:', error);
        }
    }
    
    /**
     * Synthesizes snare drum sounds using filtered noise
     * Creates white noise and filters it through a bandpass filter
     */
    playSnare(startTime, gain = 0.6, effects = {}, freq = 200, variation = 0) {
        try {
            const bufferSize = this.audioContext.sampleRate * 0.1;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const output = buffer.getChannelData(0);

            // Generate white noise
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            const noise = this.audioContext.createBufferSource();
            const filter = this.audioContext.createBiquadFilter();
            const gainNode = this.audioContext.createGain();

            noise.buffer = buffer;
            this.connectWithEffects(noise, filter, effects);
            filter.connect(gainNode);
            gainNode.connect(this.masterGain);

            filter.type = 'bandpass';
            filter.frequency.value = Math.max(100, freq + (variation * 200));
            filter.Q.value = Math.max(0.5, 1 + (variation * 0.5));

            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.001);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

            noise.start(startTime);
            noise.stop(startTime + 0.1);
        } catch (error) {
            console.error('Error in playSnare:', error);
        }
    }
    
    /**
     * Synthesizes hi-hat sounds using filtered high-frequency noise
     * Short decay time creates crisp percussive sound
     */
    playHihat(startTime, gain = 0.4, decay = 0.05, effects = {}, freq = 8000, variation = 0) {
        try {
            const safeDuration = Math.max(0.01, decay * 2);
            const bufferSize = this.audioContext.sampleRate * safeDuration;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const output = buffer.getChannelData(0);
            
            // Generate white noise
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            
            const noise = this.audioContext.createBufferSource();
            const filter = this.audioContext.createBiquadFilter();
            const gainNode = this.audioContext.createGain();
            
            noise.buffer = buffer;
            this.connectWithEffects(noise, filter, effects);
            filter.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            filter.type = 'highpass';
            filter.frequency.value = Math.max(1000, freq + (variation * 1000));
            
            const finalDecay = Math.max(0.01, decay + (variation * 0.02));
            
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.001);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + finalDecay);
            
            noise.start(startTime);
            noise.stop(startTime + finalDecay);
        } catch (error) {
            console.error('Error in playHihat:', error);
        }
    }
    
    /**
     * Synthesizes clap sounds using multiple delayed snare hits
     * Creates the characteristic flam sound of hand claps
     */
    playClap(startTime, gain = 0.5, effects = {}, freq = 1000, variation = 0) {
        try {
            const delays = [0, 0.01, 0.02];
            const gains = [0.8, 0.6, 0.4];
            
            for (let i = 0; i < delays.length; i++) {
                this.playSnare(startTime + delays[i], gain * gains[i], effects, freq, variation);
            }
        } catch (error) {
            console.error('Error in playClap:', error);
        }
    }
    
    /**
     * Synthesizes generic tonal sounds using sawtooth waves
     * Used for samples not specifically implemented
     */
    playTone(startTime, freq, decay, gain = 0.4, effects = {}) {
        try {
            const osc = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            this.connectWithEffects(osc, gainNode, effects);
            gainNode.connect(this.masterGain);

            osc.frequency.value = freq;
            osc.type = 'sawtooth';

            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.001);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + decay);

            osc.start(startTime);
            osc.stop(startTime + decay);
        } catch (error) {
            console.error('Error in playTone:', error);
        }
    }
    
    /**
     * Parses mini-notation strings into event arrays
     * Supports basic patterns, rests (~), and subdivisions (*)
     */
    parseMiniNotation(notation) {
        if (!this.validateType(notation, 'string', 'notation')) {
            return [];
        }
        
        try {
            const events = [];
            const tokens = notation.trim().split(/\s+/).filter(token => token.length > 0);
            
            if (tokens.length === 0) return events;
            
            let time = 0;
            const stepDuration = 1 / tokens.length;
            
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                
                // Handle rests
                if (token === '~' || token === '') {
                    time += stepDuration;
                    continue;
                }
                
                // Handle subdivisions (e.g., bd*4)
                if (token.includes('*')) {
                    const [sample, countStr] = token.split('*');
                    const count = Math.max(1, parseInt(countStr) || 1);
                    const subDuration = stepDuration / count;
                    
                    for (let j = 0; j < count; j++) {
                        if (sample && sample !== '~') {
                            events.push({
                                sample: sample,
                                time: time + j * subDuration,
                                duration: subDuration
                            });
                        }
                    }
                } else {
                    if (token && token !== '~') {
                        events.push({
                            sample: token,
                            time: time,
                            duration: stepDuration
                        });
                    }
                }
                
                time += stepDuration;
            }
            
            return events;
        } catch (error) {
            console.error('Error parsing mini-notation:', error);
            return [];
        }
    }
    
    /**
     * Schedules a pattern to play on a specific channel
     * Handles multi-cycle patterns, timing, and dynamic transforms
     */
    schedulePattern(pattern, channelId = 0) {
        if (!pattern || !this.audioContext) return;

        try {
            // Stop any existing pattern on this channel
            this.stopChannel(channelId);

            this.channels.set(channelId, {
                pattern: this.deepClone(pattern),
                scheduler: null,
                isPlaying: true,
                startCycle: this.getCurrentCycle()
            });

            const channel = this.channels.get(channelId);
            
            const scheduleNext = () => {
                // Check if channel is still active
                if (!channel.isPlaying || !this.channels.has(channelId)) return;

                try {
                    const cycleDuration = 1 / this.cps;
                    const currentCycle = this.getCurrentCycle();

                    let processedPattern = this.deepClone(pattern);

                    // Process dynamic transforms (every, sometimes, whenmod)
                    processedPattern = processedPattern.map((event) => {
                        let processedEvent = this.deepClone(event);
        
                        // Apply every() transforms
                        if (event.everyTransform) {
                            const { n, fn } = event.everyTransform;
                            if (typeof n === 'number' && typeof fn === 'function' && currentCycle % n === 0) {
                                try {
                                    const tempBuilder = new PatternBuilder(this);
                                    tempBuilder.pattern = [processedEvent];
                                    const transformed = fn(tempBuilder);
                                    if (transformed?.pattern?.[0]) {
                                        processedEvent = { ...processedEvent, ...transformed.applyTransforms()[0] };
                                    }
                                } catch (transformError) {
                                    console.error('Error in every transform:', transformError);
                                }
                            }
                        }
        
                        // Apply sometimes() transforms
                        if (event.sometimesTransform) {
                            const { fn, prob } = event.sometimesTransform;
                            if (typeof fn === 'function' && typeof prob === 'number' && Math.random() < prob) {
                                try {
                                    const tempBuilder = new PatternBuilder(this);
                                    tempBuilder.pattern = [processedEvent];
                                    const transformed = fn(tempBuilder);
                                    if (transformed?.pattern?.[0]) {
                                        processedEvent = { ...processedEvent, ...transformed.applyTransforms()[0] };
                                    }
                                } catch (transformError) {
                                    console.error('Error in sometimes transform:', transformError);
                                }
                            }
                        }
        
                        // Apply whenmod() transforms
                        if (event.whenmodTransform) {
                            const { n, offset, fn } = event.whenmodTransform;
                            if (typeof n === 'number' && typeof offset === 'number' && typeof fn === 'function' && currentCycle % n === offset) {
                                try {
                                    const tempBuilder = new PatternBuilder(this);
                                    tempBuilder.pattern = [processedEvent];
                                    const transformed = fn(tempBuilder);
                                    if (transformed?.pattern?.[0]) {
                                        processedEvent = { ...processedEvent, ...transformed.applyTransforms()[0] };
                                    }
                                } catch (transformError) {
                                    console.error('Error in whenmod transform:', transformError);
                                }
                            }
                        }
        
                        return processedEvent;
                    });
        
                    // Handle multi-cycle patterns
                    const cycleStartTime = this.startTime + (currentCycle / this.cps);
                    
                    // Find the total length of the pattern in cycles
                    let patternLengthInCycles = 1;
                    if (processedPattern.length > 0) {
                        const maxTime = Math.max(...processedPattern.map(e => e.time + (e.duration || 0)));
                        patternLengthInCycles = Math.max(1, Math.ceil(maxTime));
                    }
                    
                    // Which cycle we're in within this pattern
                    const cycleInPattern = currentCycle % patternLengthInCycles;
                    
                    console.log(`Cycle ${currentCycle}, pattern cycle ${cycleInPattern}/${patternLengthInCycles}`);
                    
                    // Schedule events for the current cycle
                    for (const event of processedPattern) {
                        if (event && typeof event.time === 'number' && event.sample && event.sample !== '~') {
                            // Which cycle does this event belong to?
                            const eventCycle = Math.floor(event.time);
                            const timeWithinCycle = event.time - eventCycle;
                            
                            // Only play events that belong to the current cycle in the pattern
                            if (eventCycle === cycleInPattern) {
                                const eventTime = cycleStartTime + (timeWithinCycle * cycleDuration);
                                
                                console.log(`Playing ${event.sample} at cycle ${eventCycle}, time ${timeWithinCycle}`);
                                
                                // Check timing for scheduling
                                const currentTime = this.audioContext.currentTime;
                                const timeDiff = eventTime - currentTime;
                                console.log(`🕐 Event time: ${eventTime.toFixed(3)}, Current time: ${currentTime.toFixed(3)}, Diff: ${timeDiff.toFixed(3)}s`);
                                
                                // Allow events slightly in the past (scheduling tolerance)
                                if (eventTime >= currentTime - 0.1) {
                                    console.log(`✅ Scheduling ${event.sample} for playback`);
                                    this.playSample(
                                        event.sample,
                                        event.gain ?? 0.7,
                                        event.effects ?? {},
                                        event.musical ?? {},
                                        Math.max(currentTime, eventTime)
                                    );
                                } else {
                                    console.log(`❌ Event ${event.sample} too far in past, skipping`);
                                }
                            }
                        }
                    }
        
                    // Schedule next cycle with precise timing
                    const nextCycleTime = this.startTime + ((currentCycle + 1) / this.cps);
                    const delay = (nextCycleTime - this.audioContext.currentTime) * 1000;
                    
                    channel.scheduler = setTimeout(scheduleNext, Math.max(0, delay));
                } catch (scheduleError) {
                    console.error('Error in schedule cycle:', scheduleError);
                    // Try to reschedule with exponential backoff
                    if (channel.isPlaying) {
                        const backoffTime = Math.min(1000, 100 * Math.pow(2, (channel.errorCount || 0)));
                        channel.errorCount = (channel.errorCount || 0) + 1;
                        if (channel.errorCount < 5) {
                            channel.scheduler = setTimeout(scheduleNext, backoffTime);
                        } else {
                            console.error('Too many scheduling errors, stopping channel');
                            this.stopChannel(channelId);
                        }
                    }
                }
            };

            scheduleNext();
        } catch (error) {
            console.error('Error in schedulePattern:', error);
        }
    }
    
    /**
     * Stops a specific channel and cleans up its resources
     */
    stopChannel(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (channel) {
                channel.isPlaying = false;
                if (channel.scheduler) {
                    clearTimeout(channel.scheduler);
                }
                this.channels.delete(channelId);
            }
        } catch (error) {
            console.error('Error stopping channel:', error);
        }
    }
    
    /**
     * Stops all active patterns and resets the channel counter
     */
    stopAll() {
        try {
            for (const [channelId] of this.channels) {
                this.stopChannel(channelId);
            }
            this.channelCounter = 0;
        } catch (error) {
            console.error('Error in stopAll:', error);
        }
    }
    
    /**
     * Sets the global tempo in cycles per second
     */
    setCPS(newCPS) {
        if (this.validateType(newCPS, 'number', 'CPS')) {
            this.cps = Math.max(0.1, Math.min(10, parseFloat(newCPS)));
        }
    }
    
    /**
     * Evaluates code strings and automatically plays resulting patterns
     * Handles preprocessing, statement parsing, and error recovery
     */
    eval(code) {
        try {
            this.stopAll();
            
            const preprocessedCode = this.preprocessCode(code);
            const statements = this.parseStatements(preprocessedCode);
            let activePatterns = 0;
            
            statements.forEach((statement, index) => {
                try {
                    const result = eval(statement);
                    if (result && result instanceof PatternBuilder) {
                        result.play();
                        activePatterns++;
                    } else if (result && typeof result.play === 'function') {
                        result.play();
                        activePatterns++;
                    }
                } catch (lineError) {
                    console.error(`Error in statement ${index + 1}:`, lineError);
                }
            });
            
            return {
                success: true,
                activePatterns: activePatterns
            };
            
        } catch (error) {
            console.error('Error executing patterns:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Preprocesses code for proper statement boundary detection
     * Handles comments, brackets, and method chaining across lines
     */
    preprocessCode(code) {
        if (!this.validateType(code, 'string', 'code')) {
            return '';
        }
        
        try {
            let lines = code.split('\n');
            
            // Remove comments
            lines = lines.map(line => {
                const commentIndex = line.indexOf('//');
                if (commentIndex !== -1) {
                    return line.substring(0, commentIndex);
                }
                return line;
            });
            
            const processedLines = [];
            let currentStatement = '';
            let bracketCount = 0;
            let parenCount = 0;
            let braceCount = 0;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                if (line.length === 0) {
                    if (currentStatement.trim().length > 0 && 
                        bracketCount === 0 && parenCount === 0 && braceCount === 0) {
                        processedLines.push(currentStatement.trim());
                        currentStatement = '';
                    }
                    continue;
                }
                
                // Count brackets for proper statement detection
                for (let char of line) {
                    switch (char) {
                        case '[': bracketCount++; break;
                        case ']': bracketCount--; break;
                        case '(': parenCount++; break;
                        case ')': parenCount--; break;
                        case '{': braceCount++; break;
                        case '}': braceCount--; break;
                    }
                }
                
                // Handle method chaining and bracket continuation
                if (line.startsWith('.') || line.startsWith(')') || line.startsWith(']') || line.startsWith('}')) {
                    currentStatement += ' ' + line;
                } else if (currentStatement.trim().length > 0 && 
                           (bracketCount > 0 || parenCount > 0 || braceCount > 0)) {
                    currentStatement += ' ' + line;
                } else {
                    if (currentStatement.trim().length > 0 && 
                        bracketCount === 0 && parenCount === 0 && braceCount === 0) {
                        processedLines.push(currentStatement.trim());
                        currentStatement = line;
                    } else {
                        if (currentStatement.trim().length === 0) {
                            currentStatement = line;
                        } else {
                            currentStatement += ' ' + line;
                        }
                    }
                }
            }
            
            if (currentStatement.trim().length > 0) {
                processedLines.push(currentStatement.trim());
            }
            
            return processedLines.join('\n');
        } catch (error) {
            console.error('Error preprocessing code:', error);
            return code;
        }
    }
    
    /**
     * Splits preprocessed code into individual statements for execution
     */
    parseStatements(code) {
        try {
            return code.split('\n').filter(line => line.trim().length > 0);
        } catch (error) {
            console.error('Error parsing statements:', error);
            return [];
        }
    }
    
    /**
     * Returns the current position within a cycle (0.0 to 1.0)
     */
    getCycleProgress() {
        if (!this.audioContext) return 0;
        
        const currentTime = this.audioContext.currentTime;
        const cycleTime = (currentTime - this.startTime) * this.cps;
        return cycleTime % 1;
    }
    
    /**
     * Returns true if any patterns are currently playing
     */
    isPlayingAny() {
        return this.channels.size > 0;
    }
}

/**
 * PatternBuilder Class
 * Handles pattern creation, transformations, and effects
 * Each instance represents a single pattern with its associated properties
 */
class PatternBuilder {
    constructor(tidal) {
        this.tidal = tidal; // Reference to TidalJS instance
        this.pattern = null; // Array of events
        this.transforms = []; // Array of transform functions
        this.effects = {}; // Audio effects parameters
        this.musical = {}; // Musical parameters (note, freq, etc.)
        this.channelId = 0; // Unique channel identifier
    }
    
    /**
     * Creates a sound pattern from various input types
     * Supports strings (mini-notation), arrays, and functions
     */
    sound(pattern) {
        try {
            if (typeof pattern === 'string') {
                this.pattern = this.tidal.parseMiniNotation(pattern);
            } else if (Array.isArray(pattern)) {
                this.pattern = this.parseArrayPattern(pattern);
            } else if (typeof pattern === 'function') {
                this.pattern = this.parseFunctionPattern(pattern);
            } else {
                console.warn('Invalid pattern type in sound():', typeof pattern);
                this.pattern = [];
            }
        } catch (error) {
            console.error('Error in sound():', error);
            this.pattern = [];
        }
        return this;
    }
    
    /**
     * Applies a rhythmic structure to a sound pattern
     * Structure defines when sounds play, sound pattern defines what plays
     */
    struct(structPattern, soundPattern) {
        try {
            const structure = this.tidal.parseMiniNotation(structPattern);
            
            let sounds;
            if (typeof soundPattern === 'string') {
                sounds = this.tidal.parseMiniNotation(soundPattern);
            } else if (Array.isArray(soundPattern)) {
                sounds = this.parseArrayPattern(soundPattern);
            } else if (soundPattern instanceof PatternBuilder) {
                sounds = soundPattern.applyTransforms();
            } else {
                console.warn('Invalid sound pattern in struct():', typeof soundPattern);
                sounds = [];
            }
            
            this.pattern = this.applyStructure(structure, sounds);
        } catch (error) {
            console.error('Error in struct():', error);
            this.pattern = [];
        }
        return this;
    }
    
    /**
     * Concatenates patterns sequentially in time
     * Each pattern gets equal time within a cycle
     */
    cat(patterns) {
        try {
            if (!Array.isArray(patterns)) {
                console.warn('cat() expects an array');
                this.pattern = [];
                return this;
            }
            
            const allEvents = [];
            let currentTime = 0;
            const totalPatterns = patterns.length;
            
            if (totalPatterns === 0) {
                this.pattern = [];
                return this;
            }
            
            const patternDuration = 1 / totalPatterns;
            
            patterns.forEach((pattern, index) => {
                let patternEvents = [];
                
                try {
                    if (pattern instanceof PatternBuilder) {
                        patternEvents = this.tidal.deepClone(pattern.applyTransforms());
                    } else if (typeof pattern === 'string') {
                        patternEvents = this.tidal.parseMiniNotation(pattern);
                    } else if (Array.isArray(pattern)) {
                        patternEvents = this.parseArrayPattern(pattern);
                    } else {
                        console.warn('Invalid pattern type in cat():', typeof pattern);
                        return;
                    }
                    
                    // Scale and offset events to fit in their time slot
                    const adjustedEvents = patternEvents.map(event => ({
                        ...this.tidal.deepClone(event),
                        time: currentTime + (event.time * patternDuration),
                        duration: event.duration * patternDuration
                    }));
                    
                    allEvents.push(...adjustedEvents);
                } catch (patternError) {
                    console.error(`Error processing pattern ${index} in cat():`, patternError);
                }
                
                currentTime += patternDuration;
            });
            
            this.pattern = allEvents;
        } catch (error) {
            console.error('Error in cat():', error);
            this.pattern = [];
        }
        return this;
    }
    
    /**
     * Converts an array to a pattern
     * Each element becomes an event at the corresponding time step
     */
    parseArrayPattern(arr) {
        try {
            if (!Array.isArray(arr)) return [];
            
            const events = [];
            const stepDuration = arr.length > 0 ? 1 / arr.length : 1;
            
            arr.forEach((item, i) => {
                if (item !== null && item !== undefined && item !== '~') {
                    events.push({
                        sample: item.toString(),
                        time: i * stepDuration,
                        duration: stepDuration
                    });
                }
            });
            
            return events;
        } catch (error) {
            console.error('Error parsing array pattern:', error);
            return [];
        }
    }
    
    /**
     * Converts a function to a pattern
     * Function receives time (0-1) and returns sample name or null
     */
    parseFunctionPattern(fn) {
        try {
            if (typeof fn !== 'function') return [];
            
            const steps = 16;
            const events = [];
            const stepDuration = 1 / steps;
            
            for (let i = 0; i < steps; i++) {
                try {
                    const value = fn(i / steps);
                    if (value && value !== '~') {
                        events.push({
                            sample: value.toString(),
                            time: i * stepDuration,
                            duration: stepDuration
                        });
                    }
                } catch (fnError) {
                    console.error(`Error in function pattern at step ${i}:`, fnError);
                }
            }
            
            return events;
        } catch (error) {
            console.error('Error parsing function pattern:', error);
            return [];
        }
    }
    
    /**
     * Applies a structure pattern to sound events
     * Structure events with 'x' or '*' trigger the next sound
     */
    applyStructure(structure, sounds) {
        try {
            const result = [];
            let soundIndex = 0;
            
            for (const structEvent of structure) {
                if (structEvent.sample === 'x' || structEvent.sample === '*') {
                    if (sounds.length > 0) {
                        const sound = sounds[soundIndex % sounds.length];
                        result.push({
                            sample: sound.sample,
                            time: structEvent.time,
                            duration: structEvent.duration
                        });
                        soundIndex++;
                    }
                }
            }
            
            return result;
        } catch (error) {
            console.error('Error applying structure:', error);
            return [];
        }
    }
    
    // TIME TRANSFORMATION METHODS
    
    /**
     * Makes the pattern faster by dividing event times
     */
    fast(factor) {
        if (this.tidal.validateType(factor, 'number', 'fast factor')) {
            this.transforms.push({type: 'fast', value: Math.max(0.1, factor)});
        }
        return this;
    }
    
    /**
     * Makes the pattern slower by multiplying event times
     */
    slow(factor) {
        if (this.tidal.validateType(factor, 'number', 'slow factor')) {
            this.transforms.push({type: 'slow', value: Math.max(0.1, factor)});
        }
        return this;
    }
    
    /**
     * Changes pattern density (same as fast)
     */
    density(factor) {
        if (this.tidal.validateType(factor, 'number', 'density factor')) {
            this.transforms.push({type: 'density', value: Math.max(0.1, factor)});
        }
        return this;
    }
    
    /**
     * Reverses the pattern in time
     */
    rev() {
        this.transforms.push({type: 'rev'});
        return this;
    }
    
    /**
     * Applies a transformation every N cycles
     */
    every(n, transformFn) {
        if (this.tidal.validateType(n, 'number', 'every n') && 
            this.tidal.validateType(transformFn, 'function', 'every function')) {
            this.transforms.push({type: 'every', value: Math.max(1, Math.floor(n)), fn: transformFn});
        }
        return this;
    }
    
    /**
     * Applies a transformation randomly (50% chance by default)
     */
    sometimes(transformFn, prob = 0.5) {
        if (this.tidal.validateType(transformFn, 'function', 'sometimes function')) {
            const safeProbability = Math.max(0, Math.min(1, prob));
            this.transforms.push({type: 'sometimes', fn: transformFn, prob: safeProbability});
        }
        return this;
    }
    
    /**
     * Applies a transformation often (75% chance)
     */
    often(fn) {
        return this.sometimes(fn, 0.75);
    }

    /**
     * Applies a transformation rarely (25% chance)
     */
    rarely(fn) {
        return this.sometimes(fn, 0.25);
    }

    /**
     * Applies a transformation almost never (10% chance)
     */
    almostNever(fn) {
        return this.sometimes(fn, 0.1);
    }

    /**
     * Applies a transformation almost always (90% chance)
     */
    almostAlways(fn) {
        return this.sometimes(fn, 0.9);
    }

    /**
     * Applies a transformation when (cycle % n) equals offset
     */
    whenmod(n, offset, fn) {
        if (this.tidal.validateType(n, 'number', 'whenmod n') && 
            this.tidal.validateType(offset, 'number', 'whenmod offset') &&
            this.tidal.validateType(fn, 'function', 'whenmod function')) {
            this.transforms.push({ 
                type: 'whenmod', 
                n: Math.max(1, Math.floor(n)), 
                offset: Math.max(0, Math.floor(offset)), 
                fn 
            });
        }
        return this;
    }
    
    // AUDIO EFFECT METHODS
    
    /**
     * Sets the gain/volume (0.0 to 2.0)
     */
    gain(value) {
        if (this.tidal.validateType(value, 'number', 'gain')) {
            this.effects.gain = Math.max(0, Math.min(2, value));
        }
        return this;
    }
    
    /**
     * Sets the stereo pan position (-1.0 to 1.0)
     */
    pan(value) {
        if (this.tidal.validateType(value, 'number', 'pan')) {
            this.effects.pan = Math.max(-1, Math.min(1, value));
        }
        return this;
    }
    
    /**
     * Applies low-pass filtering (removes high frequencies)
     */
    lpf(cutoff) {
        if (this.tidal.validateType(cutoff, 'number', 'lpf')) {
            this.effects.lpf = Math.max(20, Math.min(20000, cutoff));
        }
        return this;
    }

    /**
     * Applies high-pass filtering (removes low frequencies)
     */
    hpf(cutoff) {
        if (this.tidal.validateType(cutoff, 'number', 'hpf')) {
            this.effects.hpf = Math.max(20, Math.min(20000, cutoff));
        }
        return this;
    }

    /**
     * Applies band-pass filtering (keeps only middle frequencies)
     */
    bpf(cutoff) {
        if (this.tidal.validateType(cutoff, 'number', 'bpf')) {
            this.effects.bpf = Math.max(20, Math.min(20000, cutoff));
        }
        return this;
    }

    /**
     * Adds delay/echo effect
     */
    delay(time) {
        if (this.tidal.validateType(time, 'number', 'delay')) {
            this.effects.delay = Math.max(0.001, Math.min(2.0, time));
        }
        return this;
    }

    /**
     * Adds reverb effect
     */
    reverb(amount) {
        if (this.tidal.validateType(amount, 'number', 'reverb')) {
            this.effects.reverb = Math.max(0.1, Math.min(5.0, amount));
        }
        return this;
    }

    /**
     * Adds distortion effect
     */
    distortion(amount) {
        if (this.tidal.validateType(amount, 'number', 'distortion')) {
            this.effects.distortion = Math.max(1, Math.min(100, amount));
        }
        return this;
    }

    /**
     * Adds bit-crushing effect (reduces bit depth)
     */
    crush(bits) {
        if (this.tidal.validateType(bits, 'number', 'crush')) {
            this.effects.crush = Math.max(1, Math.min(16, Math.floor(bits)));
        }
        return this;
    }

    /**
     * Applies vowel formant filtering
     * Simulates human vocal tract for vowel sounds (a, e, i, o, u)
     */
    vowel(formant) {
        if (this.tidal.validateType(formant, 'string', 'vowel formant')) {
            // Formant frequencies for each vowel (F1, F2, F3)
            const vowelFreqs = {
                'a': [730, 1090, 2440],   // Open vowel - bright, forward
                'e': [270, 2290, 3010],   // Mid-front vowel - clear, present  
                'i': [300, 2320, 3200],   // High-front vowel - bright, thin
                'o': [570, 840, 2410],    // Mid-back vowel - warm, round
                'u': [440, 1020, 2240]    // High-back vowel - dark, muffled
            };
            
            const freqs = vowelFreqs[formant.toLowerCase()] || vowelFreqs['a'];
            this.effects.vowel = freqs;
            
            console.log(`Applied vowel filter "${formant}" with formants:`, freqs);
        } else {
            console.warn('vowel() expects a string (a, e, i, o, u)');
        }
        return this;
    }

    /**
     * Layers a transformed version on top of the original pattern
     * One of the most powerful functions in live coding
     */
    superimpose(transformFn) {
        try {
            if (!this.tidal.validateType(transformFn, 'function', 'superimpose function')) {
                console.warn('superimpose() expects a function that transforms a pattern');
                return this;
            }
            
            if (!this.pattern || this.pattern.length === 0) {
                console.warn('No pattern to superimpose - create a pattern first');
                return this;
            }
            
            // Create a complete copy of the current PatternBuilder
            const copy = new PatternBuilder(this.tidal);
            copy.pattern = this.tidal.deepClone(this.pattern);
            copy.transforms = this.tidal.deepClone(this.transforms);
            copy.effects = this.tidal.deepClone(this.effects);
            copy.musical = this.tidal.deepClone(this.musical);
            copy.channelId = this.tidal.channelCounter++;
            
            // Apply the transformation function to the copy
            let transformedCopy;
            try {
                transformedCopy = transformFn(copy);
                
                if (!(transformedCopy instanceof PatternBuilder)) {
                    console.warn('superimpose function must return a PatternBuilder');
                    return this;
                }
            } catch (transformError) {
                console.error('Error in superimpose transform function:', transformError);
                return this;
            }
            
            // Get the fully processed events from the transformed copy
            const transformedEvents = transformedCopy.applyTransforms();
            
            // Combine original and transformed events
            const originalEvents = this.tidal.deepClone(this.pattern);
            const combinedEvents = [...originalEvents, ...this.tidal.deepClone(transformedEvents)];
            
            this.pattern = combinedEvents;
            
            console.log(`Superimposed pattern: ${originalEvents.length} original + ${transformedEvents.length} transformed = ${combinedEvents.length} total events`);
            
        } catch (error) {
            console.error('Error in superimpose():', error);
        }
        return this;
    }

    /**
     * Adds another pattern sequentially after the current pattern
     * Extends the pattern in time (multi-cycle)
     */
    append(pattern) {
        try {
            if (!this.pattern || this.pattern.length === 0) {
                console.warn('No base pattern to append to - create a pattern first');
                return this;
            }
            
            let appendEvents = [];
            
            // Parse the pattern to append based on its type
            if (pattern instanceof PatternBuilder) {
                appendEvents = this.tidal.deepClone(pattern.applyTransforms());
            } else if (typeof pattern === 'string') {
                appendEvents = this.tidal.parseMiniNotation(pattern);
            } else if (Array.isArray(pattern)) {
                appendEvents = this.parseArrayPattern(pattern);
            } else {
                console.warn('append() expects a string, array, or PatternBuilder');
                return this;
            }
            
            if (appendEvents.length === 0) {
                console.warn('Nothing to append - pattern is empty');
                return this;
            }
            
            // Find where the current pattern ends
            let maxEndTime = 0;
            for (const event of this.pattern) {
                const eventEnd = event.time + (event.duration || 0);
                if (eventEnd > maxEndTime) {
                    maxEndTime = eventEnd;
                }
            }
            
            const nextCycleStart = Math.ceil(maxEndTime);
            
            console.log(`Current pattern ends at time ${maxEndTime}, appending at cycle ${nextCycleStart}`);
            
            // Shift append events to start at the next cycle
            const shiftedEvents = appendEvents.map(event => {
                const newEvent = {
                    ...this.tidal.deepClone(event),
                    time: event.time + nextCycleStart,
                    duration: event.duration
                };
                console.log(`Shifting event "${event.sample}" from time ${event.time} to ${newEvent.time}`);
                return newEvent;
            });
            
            this.pattern = [...this.pattern, ...shiftedEvents];
            
            console.log(`Pattern now has ${this.pattern.length} events spanning ${Math.ceil(Math.max(...this.pattern.map(e => e.time + e.duration)))} cycles`);
            console.log('Complete pattern:', this.pattern.map(e => `${e.sample}@${e.time}`));
            
        } catch (error) {
            console.error('Error in append():', error);
        }
        return this;
    }

    /**
     * Layers another pattern on top in the same time space
     * Combines patterns simultaneously (not sequentially like append)
     */
    overlay(pattern) {
        try {
            if (!this.pattern || this.pattern.length === 0) {
                console.warn('No base pattern to overlay - create a pattern first');
                return this;
            }
            
            let overlayEvents = [];
            
            // Parse the pattern to overlay based on its type
            if (pattern instanceof PatternBuilder) {
                overlayEvents = this.tidal.deepClone(pattern.applyTransforms());
            } else if (typeof pattern === 'string') {
                overlayEvents = this.tidal.parseMiniNotation(pattern);
            } else if (Array.isArray(pattern)) {
                overlayEvents = this.parseArrayPattern(pattern);
            } else {
                console.warn('overlay() expects a string, array, or PatternBuilder');
                return this;
            }
            
            if (overlayEvents.length === 0) {
                console.warn('Nothing to overlay - pattern is empty');
                return this;
            }
            
            // Overlay events stay in the same time space (0-1 cycle)
            const clonedOverlayEvents = this.tidal.deepClone(overlayEvents);
            
            this.pattern = [...this.pattern, ...clonedOverlayEvents];
            
            console.log(`Overlayed ${overlayEvents.length} events. Pattern now has ${this.pattern.length} total events`);
            console.log('Overlay events:', overlayEvents.map(e => `${e.sample}@${e.time}`));
            
        } catch (error) {
            console.error('Error in overlay():', error);
        }
        return this;
    }
    
    // MUSICAL PARAMETER METHODS
    
    /**
     * Sets sample number/variation
     */
    n(pattern) {
        this.musical.n = pattern;
        return this;
    }
    
    /**
     * Sets musical note (c, d, e, f, g, a, b with optional # or b)
     */
    note(pattern) {
        this.musical.note = pattern;
        return this;
    }
    
    /**
     * Transposes by semitones
     */
    up(pattern) {
        this.musical.up = pattern;
        return this;
    }
    
    /**
     * Sets frequency directly in Hz
     */
    freq(pattern) {
        this.musical.freq = pattern;
        return this;
    }
    
    /**
     * Sets MIDI note number (0-127)
     */
    midinote(pattern) {
        this.musical.midinote = pattern;
        return this;
    }
    
    /**
     * Sets the global tempo in cycles per second
     */
    setCPS(cps) {
        this.tidal.setCPS(cps);
        return this;
    }
    
    /**
     * Sets the global tempo in beats per minute
     */
    setTempo(bpm) {
        this.tidal.setCPS(bpm / 240);
        return this;
    }
    
    /**
     * Applies musical patterns to events with automatic pattern expansion
     * Handles cases where musical patterns are longer than sound patterns
     */
    applyMusicalPatterns() {
        if (!this.pattern) return [];
        
        try {
            let pattern = this.tidal.deepClone(this.pattern);
            
            // Determine if we need pattern expansion
            let needsExpansion = false;
            let maxPatternLength = pattern.length;
            
            // Check all musical patterns to find the maximum length
            for (const [musicalType, musicalPattern] of Object.entries(this.musical)) {
                if (musicalPattern !== undefined) {
                    let values = [];
                    
                    if (typeof musicalPattern === 'string') {
                        const musicEvents = this.tidal.parseMiniNotation(musicalPattern);
                        values = musicEvents.map(e => e.sample).filter(s => s && s !== '~');
                    } else if (Array.isArray(musicalPattern)) {
                        values = musicalPattern.filter(v => v !== undefined && v !== null && v !== '~');
                    } else if (musicalPattern instanceof PatternBuilder) {
                        const patternEvents = musicalPattern.applyTransforms();
                        values = patternEvents.map(e => e.sample).filter(s => s && s !== '~');
                    } else {
                        values = [musicalPattern];
                    }
                    
                    if (values.length > maxPatternLength) {
                        maxPatternLength = values.length;
                        needsExpansion = true;
                    }
                }
            }
            
            // Expand base pattern if needed
            if (needsExpansion && maxPatternLength > pattern.length) {
                const expandedPattern = [];
                for (let i = 0; i < maxPatternLength; i++) {
                    const sourceEvent = pattern[i % pattern.length];
                    const eventTime = i / maxPatternLength;
                    const eventDuration = 1 / maxPatternLength;
                    
                    expandedPattern.push({
                        ...this.tidal.deepClone(sourceEvent),
                        time: eventTime,
                        duration: eventDuration
                    });
                }
                pattern = expandedPattern;
            }
            
            // Apply musical patterns to the (possibly expanded) pattern
            for (const [musicalType, musicalPattern] of Object.entries(this.musical)) {
                if (musicalPattern !== undefined) {
                    let values = [];
                    
                    try {
                        if (typeof musicalPattern === 'string') {
                            const musicEvents = this.tidal.parseMiniNotation(musicalPattern);
                            values = musicEvents.map(e => e.sample).filter(s => s && s !== '~');
                        } else if (Array.isArray(musicalPattern)) {
                            values = musicalPattern.filter(v => v !== undefined && v !== null && v !== '~');
                        } else if (musicalPattern instanceof PatternBuilder) {
                            const patternEvents = musicalPattern.applyTransforms();
                            values = patternEvents.map(e => e.sample).filter(s => s && s !== '~');
                        } else {
                            values = [musicalPattern];
                        }
                        
                        if (values.length === 0) continue;
                        
                        pattern = pattern.map((event, i) => {
                            // Skip applying musical patterns to silence events
                            if (!event.sample || event.sample === '~') {
                                return event;
                            }
                            
                            const value = values[i % values.length];
                            let numericValue = value;
                            
                            try {
                                if (musicalType === 'note') {
                                    if (typeof value === 'string' && value.match(/^[a-g][sb#]?\d*$/i)) {
                                        numericValue = value;
                                    } else {
                                        return event;
                                    }
                                } else if (musicalType === 'n' || musicalType === 'up' || musicalType === 'midinote') {
                                    const parsed = parseInt(value);
                                    numericValue = isNaN(parsed) ? 0 : parsed;
                                } else if (musicalType === 'freq') {
                                    const parsed = parseFloat(value);
                                    numericValue = isNaN(parsed) ? 440 : parsed;
                                }
                                
                                return {
                                    ...event,
                                    musical: {
                                        ...event.musical,
                                        [musicalType]: numericValue
                                    }
                                };
                            } catch (conversionError) {
                                console.error('Error converting musical value:', conversionError);
                                return event;
                            }
                        });
                    } catch (musicalError) {
                        console.error(`Error processing musical pattern ${musicalType}:`, musicalError);
                    }
                }
            }
            
            return pattern;
        } catch (error) {
            console.error('Error in applyMusicalPatterns:', error);
            return this.pattern || [];
        }
    }
    
    /**
     * Applies all transforms and effects to create the final pattern
     * This is where the pattern gets processed before playback
     */
    applyTransforms() {
        try {
            let pattern = this.applyMusicalPatterns();
            
            // Apply each transform in order
            for (const transform of this.transforms) {
                try {
                    switch (transform.type) {
                        case 'fast':
                        case 'density':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                time: event.time / transform.value,
                                duration: event.duration / transform.value
                            }));
                            break;
                        case 'slow':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                time: event.time * transform.value,
                                duration: event.duration * transform.value
                            }));
                            break;
                        case 'rev':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                time: Math.max(0, 1 - event.time - event.duration)
                            })).reverse();
                            break;
                        case 'every':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                everyTransform: { n: transform.value, fn: transform.fn }
                            }));
                            break;
                        case 'sometimes':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                sometimesTransform: { fn: transform.fn, prob: transform.prob }
                            }));
                            break;
                        case 'whenmod':
                            pattern = pattern.map(event => ({
                                ...this.tidal.deepClone(event),
                                whenmodTransform: { n: transform.n, offset: transform.offset, fn: transform.fn }
                            }));
                            break;
                        default:
                            console.warn('Unknown transform type:', transform.type);
                    }
                } catch (transformError) {
                    console.error(`Error applying transform ${transform.type}:`, transformError);
                }
            }
            
            // Apply effects to all events
            pattern = pattern.map(event => ({
                ...this.tidal.deepClone(event),
                gain: this.effects.gain ?? event.gain,
                pan: this.effects.pan ?? event.pan,
                effects: { ...event.effects, ...this.effects }
            }));
            
            return pattern;
        } catch (error) {
            console.error('Error in applyTransforms:', error);
            return this.pattern || [];
        }
    }
    
    /**
     * Starts playing the pattern
     * Processes all transforms and schedules the pattern for playback
     */
    play() {
        try {
            if (this.pattern) {
                const finalPattern = this.applyTransforms();
                if (finalPattern.length > 0) {
                    this.tidal.schedulePattern(finalPattern, this.channelId);
                } else {
                    console.warn('No events to play in pattern');
                }
            } else {
                console.warn('No pattern to play');
            }
        } catch (error) {
            console.error('Error in play():', error);
        }
        return this;
    }
}

// Export for use in modules or direct inclusion
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TidalJS, PatternBuilder };
}