# Polygon Reconstruct

**Version:** 1.0.2  
**Author:** VA  
**Year:** 2026

Polygon Reconstruct is an image reconstruction algorithm that recreates any input image using overlapping semi-transparent triangles. The algorithm employs **simulated annealing** with random mutations to iteratively find the optimal position, size, and color for each polygon.

---

## Overview

Given a target image, the algorithm builds a reconstruction by placing semi-transparent triangles one at a time. Each triangle is optimized through a simulated annealing process that explores the space of possible vertex positions and colors, accepting improvements and occasionally accepting worse configurations to escape local minima.

The result is a stylized, low-poly approximation of the original image — similar to the [low-poly art style](https://en.wikipedia.org/wiki/Low_poly), but generated algorithmically.

---

## Project Structure

```
PolyRecon/
├── polygonreconstruct.lpr    # Desktop CLI — fixed polygon count
├── polygonrecon_auto.lpr     # Desktop CLI — adaptive stopping (max failures)
├── PolygonWeb.lpr            # WebAssembly version — runs in the browser
├── polygonreconstruct.lpi    # Lazarus project file (desktop)
├── polyrecon_auto.lpi        # Lazarus project file (auto)
├── PolygonWeb.lpi            # Lazarus project file (web)
├── web/
│   ├── index.html            # Web interface
│   ├── PolygonWeb.js         # Compiled Pascal → JavaScript
│   ├── PolygonWeb.js.map     # Source map for debugging
│   ├── poly-gisa.head.png    # Header image
│   └── poly-gisa.logo.png    # Logo image
└── README.md                 # This file
```

---

## How It Works

### 1. Rasterization

Each triangle is rasterized into a binary mask using the **edge function** (signed area test). For every pixel inside the triangle's bounding box, the algorithm checks whether the pixel lies on the same side of all three edges — if so, the pixel is inside the triangle.

```pascal
function EdgeFn(ax, ay, bx, by, px, py: double): double; inline;
begin
  Result := (px - bx) * (ay - by) - (ax - bx) * (py - by);
end;
```

### 2. Optimal Color (Analytic)

Rather than searching over color space, the algorithm computes the **analytically optimal color** for a candidate polygon by solving for the color that minimizes the squared error between the current canvas and the target image, weighted by the polygon's alpha blend factor.

### 3. Simulated Annealing

Each polygon is optimized using a simulated annealing loop:

- **Temperature schedule**: Temperature and mutation step size (`Sigma`) decay exponentially from initial to final values.
- **Mutations**: Four mutation strategies are applied with equal probability:
  - **Single vertex jitter** (50%): Perturb one vertex with Gaussian noise.
  - **Global translation** (25%): Shift all vertices by a shared offset.
  - **Scaling** (12.5%): Scale all vertices away from or toward the centroid.
  - **Rotation** (12.5%): Rotate all vertices around the centroid.
- **Acceptance criterion**: A candidate is accepted if it improves the score, or with probability `exp(-ΔE / T)` if it does not.

### 4. Adaptive Schedule

The annealing schedule adapts based on reconstruction progress. As the error decreases, fewer steps and smaller mutation magnitudes are used, allowing the algorithm to fine-tune details in later stages.

### 5. Canvas Composition

Accepted polygons are **committed** to the canvas using alpha blending:

```
new_pixel = (1 - α) * current_pixel + α * polygon_color
```

The canvas is initialized to the **mean color** of the target image, providing a neutral starting point.

---

## Building

### Prerequisites

- [Lazarus IDE](https://www.lazarus-ide.org/) with Free Pascal Compiler (FPC)
- [BGRABitmap](https://github.com/bgrabitmap/bgrabitmap) library (for desktop versions)

### Desktop Versions

```bash
# Build the standard CLI version
lazbuild polygonreconstruct.lpi

# Build the auto-stopping CLI version
lazbuild polyrecon_auto.lpi
```

### Web Version

The web version is compiled from Pascal to JavaScript using the Lazarus Pas2Js toolchain. The compiled output is [`PolygonWeb.js`](web/PolygonWeb.js).

```bash
lazbuild PolygonWeb.lpi
```

---

## Usage

### Desktop CLI — `polygonreconstruct`

Reconstruct an image with a fixed number of polygons:

```bash
polygonreconstruct <input.jpg> <output.png> [max_size] [n_polygons] [n_steps] [save_every]
```

| Parameter      | Default | Description                                      |
|----------------|---------|--------------------------------------------------|
| `input.jpg`    | —       | Path to the input image                          |
| `output.png`   | —       | Path to save the reconstructed image             |
| `max_size`     | 256     | Maximum dimension (px) — image is scaled down    |
| `n_polygons`   | 300     | Number of polygons to attempt                    |
| `n_steps`      | 2000    | Simulated annealing steps per polygon            |
| `save_every`   | 0       | Save intermediate frames every N polygons (0 = off) |

**Example:**

```bash
polygonreconstruct photo.jpg result.png 512 500 3000 50
```

### Desktop CLI — `polyrecon_auto`

Reconstruct an image with adaptive stopping based on consecutive non-improvements:

```bash
polyrecon_auto <input.jpg> <output.png> [max_size] [max_failures] [n_steps] [save_every]
```

| Parameter        | Default | Description                                           |
|------------------|---------|-------------------------------------------------------|
| `input.jpg`      | —       | Path to the input image                               |
| `output.png`     | —       | Path to save the reconstructed image                  |
| `max_size`       | 256     | Maximum dimension (px)                                |
| `max_failures`   | 20      | Stop after N consecutive non-improving iterations     |
| `n_steps`        | 2000    | Simulated annealing steps per polygon                 |
| `save_every`     | 0       | Save intermediate frames every N committed polygons   |

**Example:**

```bash
polyrecon_auto photo.jpg output/result.png 512 30 3000 10
```

### Web Version

Open [`web/index.html`](web/index.html) in a modern web browser. The interface provides:

1. **Image upload** — Select any image file to reconstruct.
2. **Live preview** — Side-by-side view of the original and reconstruction.
3. **Annealing steps** — Slider to adjust mutation attempts per polygon (250–10,000).
4. **Consecutive non-improvement count** — Slider to set the stopping threshold (1–50).
5. **Stop button** — Immediately halt the reconstruction.

The web version runs entirely client-side using WebAssembly-compiled Pascal code.

---

## Algorithm Parameters

| Parameter        | Default | Range / Notes                          |
|------------------|---------|----------------------------------------|
| `Alpha`          | 0.5     | Polygon opacity (0 = invisible, 1 = solid) |
| `T_init`         | auto    | Initial temperature (calibrated per image) |
| `T_final`        | 1e-6    | Final temperature                      |
| `Sigma_init`     | 0.3     | Initial mutation magnitude (normalized) |
| `Sigma_final`    | 0.005   | Final mutation magnitude               |
| `N_steps`        | 2000    | Annealing iterations per polygon       |
| `Epsilon`        | -0.1    | Minimum score delta to accept a polygon |

> **Note:** `T_init` is automatically calibrated at the start of each run by measuring the typical uphill energy change during random mutations.

---

## Key Data Structures

| Type                  | Description                                      |
|-----------------------|--------------------------------------------------|
| [`TFloatColor`](polygonreconstruct.lpr:17)       | RGB color with `single` precision (0.0–1.0)      |
| [`TVertex`](polygonreconstruct.lpr:22)           | 2D point with `double` precision                  |
| [`TPolygon`](polygonreconstruct.lpr:27)          | Triangle defined by 3 vertices and a color        |
| [`TRasterizedPolygon`](polygonreconstruct.lpr:32)| Polygon + binary mask + bounding box + score delta |
| [`TAnnealingSchedule`](polygonreconstruct.lpr:40)| Temperature and sigma schedule for one polygon    |

---

## Dependencies

| Dependency       | Purpose                          | Required For        |
|------------------|----------------------------------|---------------------|
| Free Pascal      | Compiler                         | All                 |
| Lazarus IDE      | IDE / project management         | All                 |
| BGRABitmap       | Bitmap loading, scaling, saving  | Desktop versions    |
| Web / JS units   | Browser DOM and canvas access    | Web version         |

---

## License

© 2026 Polygon Reconstruct by VA. All rights reserved.
