# 🎵 TidalJS

**Live Coding Music in Your Browser**

A JavaScript implementation of [Tidal Cycles](https://tidalcycles.org/) for web browsers, bringing the power of algorithmic music composition and live coding to the web platform.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Phase 1](https://img.shields.io/badge/Phase%201-100%25%20Complete-brightgreen.svg)](#phase-1-complete)
[![Live Demo](https://img.shields.io/badge/Live-Demo-blue.svg)](#demo)

## ✨ Features

### 🏆 **Phase 1 Complete - Professional Live Coding System**

- **🎼 Pattern Creation**: Sound patterns, mini-notation, arrays, and functions
- **⏰ Time Transformations**: `every()`, `sometimes()`, `fast()`, `slow()`, `density()`, `rev()`
- **🎛️ Audio Effects**: Filters (`lpf`, `hpf`, `bpf`), `reverb`, `delay`, `distortion`, `vowel` filters
- **🎵 Musical Functions**: Notes, frequencies, transposition, MIDI support
- **🔧 Composition Tools**: `stack()`, `append()`, `overlay()`, `superimpose()`, `cat()`
- **🎚️ Real-time Control**: Dynamic pattern switching, live parameter tweaking
- **🔊 Web Audio**: High-quality synthesis using Web Audio API

### 🚀 **All Core TidalCycles Functions (34/34)**

```javascript
// Pattern Fundamentals
sound("bd sn bd sn").note("c e g").up("0 12")

// Time Transformations  
sound("hh hh hh hh").every(4, x => x.fast(2)).sometimes(x => x.rev())

// Audio Effects
sound("arpy").lpf(800).reverb(0.3).vowel("a")

// Composition
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"), 
  sound("hh hh hh hh").gain(0.3)
])

// Advanced Layering
sound("bd sn").superimpose(x => x.fast(2).up(12)).overlay("hh*4")
```

## 🚀 Quick Start

### Basic HTML Setup

```html
<!DOCTYPE html>
<html>
<head>
    <title>TidalJS Live Coding</title>
</head>
<body>
    <script src="tidal.js"></script>
    <script>
        // Initialize TidalJS
        const tidal = new TidalJS();
        
        async function start() {
            await tidal.init();
            
            // Start live coding!
            sound("bd sn bd sn").play();
        }
        
        // Click to start (required for browser audio policy)
        document.addEventListener('click', start, { once: true });
    </script>
</body>
</html>
```

### Live Coding Interface

For a complete live coding environment, use the included HTML interface:

```bash
# Clone the repository
git clone https://github.com/hexplus/tidaljs.git
cd tidaljs

# Open the live coding interface
open index.html
```

## 📖 Usage Examples

### Basic Patterns

```javascript
// Simple drum pattern
sound("bd sn bd sn")

// With effects
sound("bd sn bd sn").lpf(600).reverb(0.3)

// Mini-notation with subdivisions
sound("bd*2 sn bd sn*3")
```

### Time Transformations

```javascript
// Every 4 cycles, make it fast
sound("bd sn bd sn").every(4, x => x.fast(2))

// Random variations
sound("hh hh hh hh").sometimes(x => x.gain(0.3)).rarely(x => x.rev())

// Change density without pitch change
sound("arpy arpy arpy").density(1.5)
```

### Musical Patterns

```javascript
// Musical notes
sound("arpy").note("c e g c")

// Transposition
sound("arpy").note("c e g").up("0 12 7")

// Frequency control
sound("sine").freq("440 554 659")
```

### Advanced Composition

```javascript
// Layer multiple patterns
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"),
  sound("hh hh hh hh").gain(0.3)
])

// Sequential patterns
cat([
  sound("bd sn"),
  sound("hh cp")
])

// Superimpose transformations
sound("bd sn").superimpose(x => x.fast(2).up(12))
```

### Creative Effects

```javascript
// Vowel filters for vocal sounds
sound("saw").note("c e g").vowel("a")

// Bit crushing and distortion
sound("arpy*4").crush(4).distortion(5)

// Complex effect chains
sound("bd sn bd sn")
  .every(8, x => x.rev())
  .sometimes(x => x.lpf(600))
  .delay(0.25)
  .reverb(0.4)
```

## 🎹 API Reference

### Core Functions

| Function | Description | Example |
|----------|-------------|---------|
| `sound()` | Create sound pattern | `sound("bd sn bd sn")` |
| `stack()` | Layer patterns | `stack([sound("bd"), sound("hh")])` |
| `cat()` | Concatenate patterns | `cat([sound("bd"), sound("sn")])` |

### Time Transformations

| Function | Description | Example |
|----------|-------------|---------|
| `fast(n)` | Speed up by factor | `.fast(2)` |
| `slow(n)` | Slow down by factor | `.slow(0.5)` |
| `every(n, fn)` | Transform every N cycles | `.every(4, x => x.fast(2))` |
| `sometimes(fn)` | Random 50% transformation | `.sometimes(x => x.rev())` |
| `density(n)` | Change timing density | `.density(1.5)` |

### Audio Effects

| Function | Description | Example |
|----------|-------------|---------|
| `gain(n)` | Volume (0-2) | `.gain(0.8)` |
| `pan(n)` | Stereo pan (-1 to 1) | `.pan(-0.5)` |
| `lpf(freq)` | Low-pass filter | `.lpf(800)` |
| `reverb(amt)` | Reverb effect | `.reverb(0.3)` |
| `delay(time)` | Delay effect | `.delay(0.25)` |
| `vowel(vowel)` | Vowel filter | `.vowel("a")` |

### Musical Functions

| Function | Description | Example |
|----------|-------------|---------|
| `note(pattern)` | Musical notes | `.note("c e g")` |
| `up(pattern)` | Transpose semitones | `.up("0 12 7")` |
| `freq(pattern)` | Direct frequency | `.freq("440 554")` |
| `n(pattern)` | Sample variation | `.n("0 1 2")` |

## 🎛️ Global Controls

```javascript
// Tempo control
setCPS(0.8)        // Cycles per second
setTempo(120)      // BPM

// Stop everything
stopAll()

// Utility functions
choose(["bd", "sn", "cp"])    // Random choice
cycleChoose(["a", "e", "i"])  // Cycle through options
```

## 🎼 Mini-Notation

TidalJS supports Tidal's mini-notation syntax:

```javascript
sound("bd sn bd sn")    // Basic sequence
sound("bd*2 sn")        // Subdivisions with *
sound("bd ~ sn ~")      // Rests with ~
sound("[bd sn]*2")      // Grouping (Phase 2)
sound("bd?")            // Probability (Phase 2)
```

## 🔧 Development Status

### ✅ Phase 1: Complete (34/34 functions)
- All core TidalCycles functions implemented
- Professional live coding capabilities
- Production-ready audio synthesis
- Complete documentation

### 🎯 Phase 2: Planned
- Advanced mini-notation (`[bd sn]`, `<bd sn>`, `{bd, sn}`)
- Complex transformations (`chunk`, `chop`, `scramble`)
- Advanced effects (`cutoff`, `resonance`, `room`)

See the complete [roadmap](ROADMAP.md) for details.

## 🤝 Contributing

We welcome contributions! TidalJS is an open-source project built for the live coding community.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-function`
3. **Make your changes** with tests and documentation
4. **Submit a pull request**

### Development Setup

```bash
# Clone the repo
git clone https://github.com/hexplus/tidaljs.git
cd tidaljs

# Open in your editor
code .

# Test in browser
open index.html
```

### Areas for Contribution

- **Phase 2 functions** (mini-notation, transformations)
- **Sample library** expansion
- **Documentation** and tutorials
- **Performance** optimizations
- **Mobile** compatibility
- **Visual** pattern editors

## 📚 Resources

- **[Live TidalJS Editor](https://hexplus.github.io/tidaljs/)** - Live TidalJS Editor
- **[TidalCycles Documentation](https://tidalcycles.org/docs/)** - Original Haskell version
- **[Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)** - Browser audio technology
- **[Live Coding Community](https://toplap.org/)** - TOPLAP organization

## 🎵 Community

- **Discussions**: Use GitHub Discussions for questions and ideas
- **Issues**: Report bugs and request features via GitHub Issues
- **Live Coding**: Share your TidalJS performances and patterns

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Alex McLean** and the Tidal Cycles community for the original vision
- **The live coding community** for inspiration and feedback
- **Web Audio API developers** for making browser audio possible
- **Contributors** who help make TidalJS better

## 🚀 Get Started Now!

```javascript
// Initialize TidalJS
const tidal = new TidalJS();
await tidal.init();

// Create your first pattern
sound("bd sn bd sn")
  .every(4, x => x.fast(2))
  .sometimes(x => x.lpf(600)).play();
  

// Welcome to live coding! 🎵
```

---

**Made with ❤️ for the live coding community**

*Start live coding music in your browser today!*