# Polygon Support in PolyRecon

This document explains the changes made to extend PolyRecon from supporting only triangles to supporting arbitrary N-gons (polygons with any number of vertices).

## Overview

The original implementation was hardcoded to work exclusively with triangles (3 vertices). This limitation was overcome by:

1. Making the vertex count configurable via a constant
2. Adding a vertex sorting mechanism to ensure convex polygons
3. Generalizing all polygon-related functions to work with N vertices

## Key Changes

### 1. Configurable Vertex Count

Added a constant to control the number of vertices:
```pascal
const
  NUM_VERTICES = 6; // Set to 3 for triangles, 4 for quads, 6 for hexagons, etc.
```

### 2. Dynamic Array Type

Changed the vertex array type from fixed-size to dynamic:
```pascal
type
  TPolyVertices = array[0..NUM_VERTICES-1] of TVertex;
```

### 3. Vertex Sorting Mechanism

Added `SortVertices` procedure to ensure vertices form a convex polygon:
- Calculates centroid of all vertices
- Computes angle of each vertex relative to centroid
- Sorts vertices by angle using bubble sort (efficient for small N)
- Prevents self-intersecting "bowtie" shapes

### 4. Generalized Rasterization

Updated `Rasterize` function to work with N vertices:
- Precomputes vertex coordinates in pixel space
- Iterates through all edges dynamically
- Maintains early-exit optimization for performance
- Uses modulo arithmetic to wrap from last vertex to first

### 5. Updated Supporting Functions

Modified all polygon-related functions:
- `BoundingBox`: Iterates through all vertices
- `InitializePolygon`: Generates correct number of random points
- `MutateVertices`: Applies mutations to all vertices and sorts result

## Configuration

To change the polygon type, simply modify the `NUM_VERTICES` constant:
- `3` = Triangles (default, original behavior)
- `4` = Quadrilaterals (blocky, cubist appearance)
- `5` = Pentagons
- `6` = Hexagons (honeycomb-like, rounded appearance)
- Higher values = More circular approximations

## Mathematical Foundation

The implementation leverages two key insights:

1. **Half-Space Intersection**: The rasterization algorithm determines if a point is inside a polygon by checking if it's on the same side of all edges. This works for any convex polygon.

2. **Convexity Through Sorting**: While N random points often form self-intersecting polygons, sorting them by angle around their centroid guarantees a convex polygon (assuming no duplicate points).

## Performance Considerations

- The sorting algorithm uses bubble sort which is O(N²) but acceptable since N is typically small (3-10)
- The rasterization algorithm maintains its early-exit optimization
- Memory usage scales linearly with vertex count
- Higher vertex counts provide smoother approximations but require more processing

## Usage Examples

See the main programs for usage:
- `polygonreconstruct.lpr`: Standard reconstruction mode
- `polyrecon_auto.lpr`: Automatic reconstruction with early termination

Both programs accept the same command-line parameters and will automatically use whatever `NUM_VERTICES` value is set in the source code.