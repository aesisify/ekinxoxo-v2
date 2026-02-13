# ekinxoxo

Browser-based cyclic voltammetry (CV) data analysis tool with a fully custom-built math engine. Upload electrochemical data files, visualize voltammograms, and extract scientifically accurate peak parameters — all client-side, no server required.

## Features

- **File parsing** — Tab-delimited `.txt`/`.csv` with auto-detection of Potential, Current, Time, Applied Potential, Scan, Q+, and Q− columns
- **Cycle splitting** — Instrument Scan column preferred; falls back to heuristic switching-point detection. Multi-cycle selector in the UI
- **Savitzky-Golay smoothing** — Configurable window sizes (5, 9, 15, 21) with quality validation (noise reduction, amplitude preservation, artifact detection)
- **Three baseline methods**
  - **Rubberband** — Morphological opening (iterative erosion/dilation), direction-aware
  - **Linear** — Least-squares regression on anchor regions at scan endpoints
  - **ASLS** — Asymmetric Least Squares Smoothing (Eilers & Boelens, 2005) with pentadiagonal banded Cholesky solver
- **Peak detection** — Prominence-based with configurable threshold, nearby-peak merging, parabolic interpolation for sub-index peak potential precision
- **Charge calculation** — Simpson's 1/3 rule / trapezoidal integration with Richardson error estimation; reports in Coulombs (∫I·dt) when time data is available, V·A (∫I·dE) otherwise
- **Electrochemical parameters** — ΔEp, E½, |Ipa/Ipc| from paired peaks; iR drop (mean/max) when applied potential is available; instrument-reported Q+/Q− when present
- **Interactive D3 chart** — Raw scatter, smoothed line, baseline, derivative (dI/dE), and peak markers (shaded area + height line) with toggleable layers and tooltips
- **Fully configurable** — All algorithm parameters (λ, p, iterations, window size, anchor fraction, prominence threshold) exposed in the UI with a one-click reset
- **Deployment** — GitHub Pages via GitHub Actions (build + deploy on push to `main`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 5.9 |
| Build | Vite 7 |
| Styling | TailwindCSS 4 + shadcn/ui (radix-mira style, zinc base) |
| Charting | D3.js v7 (SVG, imperative rendering in useEffect) |
| Icons | Lucide React |
| Font | Inter Variable |
| Math | Custom engine (zero external math/stats libraries) |

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/
├── math/                          # Custom math engine (no external dependencies)
│   ├── cv-analysis.ts             # Pipeline entry point: smooth → derivative → baseline → peaks
│   ├── baseline-fitting.ts        # Rubberband, linear, and ASLS baseline methods
│   ├── smoothing-pipeline.ts      # Savitzky-Golay smoothing with quality validation
│   ├── derivative-pipeline.ts     # SG first derivative (dI/dE) with potential spacing scaling
│   ├── integration.ts             # Trapezoidal + Simpson's 1/3 rule with Richardson error estimation
│   ├── convolution.ts             # 1D convolution with edge handling (mirror/constant/extend)
│   └── savitzky-golay-kernels.ts  # Hardcoded SG coefficients for windows 5/9/11/15/21 (order 2)
├── lib/
│   ├── data-parser.ts             # File parsing, column auto-detection, scan rate detection
│   ├── cycle-splitter.ts          # Forward/reverse scan separation (instrument or heuristic)
│   └── utils.ts                   # Tailwind class merge utility (cn)
├── components/
│   ├── electrochemical-chart.tsx   # D3-based interactive voltammogram with tooltips
│   ├── control-panel.tsx           # Smoothing, baseline, and peak detection parameter controls
│   ├── display-options.tsx         # Layer visibility toggles (icon buttons)
│   ├── file-uploader.tsx           # Drag-and-drop .txt/.csv file upload
│   └── ui/                        # 13 shadcn/ui primitives
├── App.tsx                         # Main orchestrator (zero math logic)
└── types.ts                        # Core interfaces (DataPoint, AnalysisConfig, CVPairParameters, CycleData)
```

## Data Format

Expects tab-delimited text files with a header row. The parser auto-detects columns by name:

| Column | Required | Example Header | Purpose |
|--------|----------|---------------|---------|
| Potential | Yes | `WE(1).Potential (V)` | Measured potential at working electrode |
| Current | Yes | `WE(1).Current (A)` | Current value |
| Time | No | `Time (s)` | Enables charge in Coulombs + scan rate auto-detection |
| Applied Potential | No | `WE(1).Applied Potential (V)` | Enables iR drop estimation |
| Scan | No | `Scan` | Instrument cycle number for reliable cycle splitting |
| Q+ | No | `Q+` | Instrument-reported anodic charge |
| Q− | No | `Q-` | Instrument-reported cathodic charge |

When a Time column is present, charge is calculated in Coulombs (∫I·dt) and scan rate is auto-detected. Without it, charge is reported in V·A (∫I·dE).

## Analysis Pipeline

```
File Upload → Parse → Split Cycles → Per-Scan Analysis:
  1. Savitzky-Golay smoothing (optional)
  2. First derivative (dI/dE)
  3. Baseline fitting (rubberband / linear / ASLS)
  4. Baseline correction
  5. Peak detection by prominence + nearby-peak merging
  6. Parabolic peak potential interpolation
  7. Peak boundary detection (zero-crossing walk)
  8. Simpson's / trapezoidal charge integration
  9. ΔEp, E½, |Ipa/Ipc| from paired peaks
```

## License

MIT
