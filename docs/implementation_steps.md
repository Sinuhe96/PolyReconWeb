# Steps to Enable N-Gon Support in PolyRecon

## Summary of Changes

To modify PolyRecon from triangle-only to supporting arbitrary N-gons, follow these steps:

### 1. Define Vertex Count Constant
```pascal
const
  NUM_VERTICES = 6; // 3=triangles, 4=quads, 6=hexagons, etc.
```

### 2. Update Type Definition
```pascal
type
  TPolyVertices = array[0..NUM_VERTICES-1] of TVertex;
```

### 3. Add Vertex Sorting Procedure
Implement `SortVertices` to arrange points by angle around centroid:
- Calculate centroid (average of all vertices)
- Compute angle of each vertex using ArcTan2
- Sort vertices by angle (bubble sort efficient for small N)

### 4. Generalize Rasterize Function
Replace hardcoded triangle logic with N-vertex loops:
- Precompute vertex coordinates in pixel space
- Loop through all edges using modulo arithmetic
- Maintain early-exit optimization
- Replace fixed edge checks (d1,d2,d3) with dynamic edge iteration

### 5. Update Supporting Functions
Modify these functions to use `NUM_VERTICES`:
- `BoundingBox`: Loop through all vertices
- `InitializePolygon`: Generate correct number of seed points
- `MutateVertices`: Apply mutations to all vertices, sort result

### 6. Ensure Proper Declaration Order
Place `const` section before `type` section so `NUM_VERTICES` is defined when used in type declarations.

## Verification
After implementation:
1. Both programs should compile successfully
2. Visual output should show polygons with specified vertex count
3. Higher vertex counts produce smoother, more rounded shapes
4. Lower vertex counts (3-4) produce more faceted, geometric appearances

## Configuration Values
- `NUM_VERTICES = 3`: Traditional triangle mode
- `NUM_VERTICES = 4`: Quadrilateral mode (blocky appearance)
- `NUM_VERTICES = 6`: Hexagonal mode (rounded, mosaic appearance)
- Values >6: Increasingly circular approximations