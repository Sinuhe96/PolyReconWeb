program polygonreconstruct;

{$mode objfpc}{$H+}

uses
  {$IFDEF UNIX}
  cthreads,
  {$ENDIF}
  Interfaces,Classes
  { you can add units after this },
  SysUtils, Math, BGRABitmap, BGRABitmapTypes;

type
  TFloatColor = record
    r, g, b: Single;
  end;
  TFloatColorArray = array of TFloatColor;

  TVertex = record
    x, y: Double;
  end;
  TPolyVertices = array[0..2] of TVertex;

  TPolygon = record
    vertices: TPolyVertices;
    color: TFloatColor;
  end;

  TRasterizedPolygon = record
    poly: TPolygon;
    mask: array of Boolean;
    xi_min, xi_max, yi_min, yi_max: Integer;
    bh, bw: Integer;
    delta: Double;
  end;

  TAnnealingSchedule = record
    T_init, T_final: Double;
    Sigma_init, Sigma_final: Double;
    N_steps: Integer;
  end;

// ── Utils ────────────────────────────────────────────────────────────────────

// Box-Muller transform for standard normal distribution
function Randn: Double;
var
  u1, u2: Double;
begin
  u1 := Random;
  while u1 = 0.0 do u1 := Random; // Ensure > 0 for Ln()
  u2 := Random;
  Result := Sqrt(-2.0 * Ln(u1)) * Cos(2.0 * Pi * u2);
end;

procedure BoundingBox(const verts: TPolyVertices; out x_min, x_max, y_min, y_max: Double);
begin
  x_min := Min(verts[0].x, Min(verts[1].x, verts[2].x));
  x_max := Max(verts[0].x, Max(verts[1].x, verts[2].x));
  y_min := Min(verts[0].y, Min(verts[1].y, verts[2].y));
  y_max := Max(verts[0].y, Max(verts[1].y, verts[2].y));
end;

procedure ToPixelRange(x_min, x_max, y_min, y_max: Double; H, W: Integer;
                       out xi_min, xi_max, yi_min, yi_max: Integer);
begin
  xi_min := Max(0, Floor(x_min * W));
  xi_max := Min(W - 1, Ceil(x_max * W));
  yi_min := Max(0, Floor(y_min * H));
  yi_max := Min(H - 1, Ceil(y_max * H));
end;

function EdgeFn(ax, ay, bx, by, px, py: Double): Double; inline;
begin
  Result := (px - bx) * (ay - by) - (ax - bx) * (py - by);
end;

// ── Rasterizer ───────────────────────────────────────────────────────────────

procedure Rasterize(const poly: TPolygon; H, W: Integer; var rpoly: TRasterizedPolygon);
var
  x_min, x_max, y_min, y_max: Double;
  i, j, idx: Integer;
  px, py: Double;
  d1, d2, d3: Double;
  has_neg, has_pos: Boolean;
  ax, ay, bx, by, cx, cy: Double;
begin
  BoundingBox(poly.vertices, x_min, x_max, y_min, y_max);
  ToPixelRange(x_min, x_max, y_min, y_max, H, W, rpoly.xi_min, rpoly.xi_max, rpoly.yi_min, rpoly.yi_max);

  rpoly.bh := Max(0, rpoly.yi_max - rpoly.yi_min + 1);
  rpoly.bw := Max(0, rpoly.xi_max - rpoly.xi_min + 1);
  rpoly.poly := poly;
  rpoly.delta := 0.0;

  SetLength(rpoly.mask, rpoly.bh * rpoly.bw);
  if (rpoly.bh = 0) or (rpoly.bw = 0) then Exit;

  ax := poly.vertices[0].x * W;  ay := poly.vertices[0].y * H;
  bx := poly.vertices[1].x * W;  by := poly.vertices[1].y * H;
  cx := poly.vertices[2].x * W;  cy := poly.vertices[2].y * H;

  idx := 0;
  for i := 0 to rpoly.bh - 1 do
  begin
    py := rpoly.yi_min + i + 0.5;
    for j := 0 to rpoly.bw - 1 do
    begin
      px := rpoly.xi_min + j + 0.5;

      d1 := EdgeFn(ax, ay, bx, by, px, py);
      d2 := EdgeFn(bx, by, cx, cy, px, py);
      d3 := EdgeFn(cx, cy, ax, ay, px, py);

      has_neg := (d1 < 0) or (d2 < 0) or (d3 < 0);
      has_pos := (d1 > 0) or (d2 > 0) or (d3 > 0);

      rpoly.mask[idx] := not (has_neg and has_pos);
      Inc(idx);
    end;
  end;
end;

// ── Analytic Optimal Color ───────────────────────────────────────────────────

function OptimalColor(const rpoly: TRasterizedPolygon;
                      const Canvas, Target: TFloatColorArray;
                      W: Integer; Alpha: Single = 0.5): TFloatColor;
var
  i, j, idx, canvasIdx, n: Integer;
  accR, accG, accB: Double;
begin
  n := 0;
  for i := 0 to Length(rpoly.mask) - 1 do
    if rpoly.mask[i] then Inc(n);

  if n = 0 then
  begin
    Result.r := 0.5; Result.g := 0.5; Result.b := 0.5;
    Exit;
  end;

  accR := 0.0; accG := 0.0; accB := 0.0;
  idx := 0;
  for i := 0 to rpoly.bh - 1 do
  begin
    for j := 0 to rpoly.bw - 1 do
    begin
      if rpoly.mask[idx] then
      begin
        canvasIdx := (rpoly.yi_min + i) * W + (rpoly.xi_min + j);
        accR := accR + Target[canvasIdx].r - (1.0 - Alpha) * Canvas[canvasIdx].r;
        accG := accG + Target[canvasIdx].g - (1.0 - Alpha) * Canvas[canvasIdx].g;
        accB := accB + Target[canvasIdx].b - (1.0 - Alpha) * Canvas[canvasIdx].b;
      end;
      Inc(idx);
    end;
  end;

  Result.r := accR / (Alpha * n);
  Result.g := accG / (Alpha * n);
  Result.b := accB / (Alpha * n);

  if Result.r < 0.0 then Result.r := 0.0 else if Result.r > 1.0 then Result.r := 1.0;
  if Result.g < 0.0 then Result.g := 0.0 else if Result.g > 1.0 then Result.g := 1.0;
  if Result.b < 0.0 then Result.b := 0.0 else if Result.b > 1.0 then Result.b := 1.0;
end;

// ── Score Delta ──────────────────────────────────────────────────────────────

function ScoreDelta(const rpoly: TRasterizedPolygon;
                    const Canvas, Target: TFloatColorArray;
                    W: Integer; Alpha: Single = 0.5): Double;
var
  i, j, idx, canvasIdx: Integer;
  cvR, cvG, cvB, tvR, tvG, tvB, bvR, bvG, bvB: Double;
  colR, colG, colB: Double;
begin
  Result := 0.0;
  colR := rpoly.poly.color.r;
  colG := rpoly.poly.color.g;
  colB := rpoly.poly.color.b;

  idx := 0;
  for i := 0 to rpoly.bh - 1 do
  begin
    for j := 0 to rpoly.bw - 1 do
    begin
      if rpoly.mask[idx] then
      begin
        canvasIdx := (rpoly.yi_min + i) * W + (rpoly.xi_min + j);

        cvR := Canvas[canvasIdx].r; cvG := Canvas[canvasIdx].g; cvB := Canvas[canvasIdx].b;
        tvR := Target[canvasIdx].r; tvG := Target[canvasIdx].g; tvB := Target[canvasIdx].b;

        bvR := (1.0 - Alpha) * cvR + Alpha * colR;
        bvG := (1.0 - Alpha) * cvG + Alpha * colG;
        bvB := (1.0 - Alpha) * cvB + Alpha * colB;

        Result := Result + (Sqr(bvR - tvR) - Sqr(cvR - tvR)) +
                           (Sqr(bvG - tvG) - Sqr(cvG - tvG)) +
                           (Sqr(bvB - tvB) - Sqr(cvB - tvB));
      end;
      Inc(idx);
    end;
  end;
end;

// ── Polygon Initialization ───────────────────────────────────────────────────

function InitializePolygon(const Canvas, Target: TFloatColorArray; H, W: Integer; Alpha: Single = 0.5): TRasterizedPolygon;
var
  ErrorMap: array of Double;
  TotalError, RndVal, Acc: Double;
  i, k: Integer;
  verts: TPolyVertices;
  poly: TPolygon;
begin
  SetLength(ErrorMap, H * W);
  TotalError := 0.0;

  for i := 0 to H * W - 1 do
  begin
    ErrorMap[i] := Sqr(Target[i].r - Canvas[i].r) + Sqr(Target[i].g - Canvas[i].g) + Sqr(Target[i].b - Canvas[i].b);
    TotalError := TotalError + ErrorMap[i];
  end;

  for k := 0 to 2 do
  begin
    RndVal := Random * TotalError;
    Acc := 0.0;
    verts[k].x := 0.5; // Fallback
    verts[k].y := 0.5;
    for i := 0 to H * W - 1 do
    begin
      Acc := Acc + ErrorMap[i];
      if Acc >= RndVal then
      begin
        verts[k].x := ((i mod W) + 0.5) / W;
        verts[k].y := ((i div W) + 0.5) / H;
        Break;
      end;
    end;
  end;

  poly.vertices := verts;
  poly.color.r := 0.5; poly.color.g := 0.5; poly.color.b := 0.5;

  Rasterize(poly, H, W, Result);
  poly.color := OptimalColor(Result, Canvas, Target, W, Alpha);
  Result.poly.color := poly.color;
  Result.delta := ScoreDelta(Result, Canvas, Target, W, Alpha);
end;

// ── Vertex Mutation ──────────────────────────────────────────────────────────

function MutateVertices(const verts: TPolyVertices; Sigma: Double): TPolyVertices;
var
  r, dx, dy, ScaleFactor: Double;
  i: Integer;
  centroid: TVertex;
  Theta, C, S: Double;
begin
  Result := verts;
  r := Random;

  if r < 0.50 then
  begin
    i := Random(3);
    Result[i].x := Result[i].x + Randn * Sigma;
    Result[i].y := Result[i].y + Randn * Sigma;
  end
  else if r < 0.75 then
  begin
    dx := Randn * Sigma;
    dy := Randn * Sigma;
    for i := 0 to 2 do
    begin
      Result[i].x := Result[i].x + dx;
      Result[i].y := Result[i].y + dy;
    end;
  end
  else if r < 0.875 then
  begin
    centroid.x := (Result[0].x + Result[1].x + Result[2].x) / 3.0;
    centroid.y := (Result[0].y + Result[1].y + Result[2].y) / 3.0;
    ScaleFactor := 1.0 + Randn * Sigma;
    for i := 0 to 2 do
    begin
      Result[i].x := centroid.x + (Result[i].x - centroid.x) * ScaleFactor;
      Result[i].y := centroid.y + (Result[i].y - centroid.y) * ScaleFactor;
    end;
  end
  else
  begin
    centroid.x := (Result[0].x + Result[1].x + Result[2].x) / 3.0;
    centroid.y := (Result[0].y + Result[1].y + Result[2].y) / 3.0;
    Theta := Randn * Sigma * Pi;
    C := Cos(Theta);
    S := Sin(Theta);
    for i := 0 to 2 do
    begin
      dx := Result[i].x - centroid.x;
      dy := Result[i].y - centroid.y;
      Result[i].x := centroid.x + dx * C - dy * S;
      Result[i].y := centroid.y + dx * S + dy * C;
    end;
  end;

  for i := 0 to 2 do
  begin
    if Result[i].x < 0.0 then Result[i].x := 0.0 else if Result[i].x > 1.0 then Result[i].x := 1.0;
    if Result[i].y < 0.0 then Result[i].y := 0.0 else if Result[i].y > 1.0 then Result[i].y := 1.0;
  end;
end;

// ── Annealing Schedule ───────────────────────────────────────────────────────

procedure Temperature(const sched: TAnnealingSchedule; Step: Integer; out T, Sigma: Double);
var
  Alpha: Double;
begin
  Alpha := Step / sched.N_steps;
  T := sched.T_init * Power(sched.T_final / sched.T_init, Alpha);
  Sigma := sched.Sigma_init * Power(sched.Sigma_final / sched.Sigma_init, Alpha);
end;

function AdaptiveSchedule(const base: TAnnealingSchedule; i, n_polygons: Integer): TAnnealingSchedule;
var
  Progress: Double;
begin
  Result := base;
  Progress := i / n_polygons;
  Result.N_steps := Round(base.N_steps * (0.5 + Progress));
  Result.Sigma_init := base.Sigma_init * (1.0 - 0.8 * Progress);
  //Result.T_init := base.T_init;
  //Result.T_final := base.T_final;
  //Result.Sigma_final := base.Sigma_final;
end;

// ── Core Evaluators ──────────────────────────────────────────────────────────

function CalibrateTInit(const Canvas, Target: TFloatColorArray; H, W: Integer; Alpha: Single): Double;
var
  rpoly, cand_r: TRasterizedPolygon;
  i, count_uphill: Integer;
  cand_poly: TPolygon;
  DeltaE, sum_uphill, mean_uphill: Double;
begin
  rpoly := InitializePolygon(Canvas, Target, H, W, Alpha);
  sum_uphill := 0.0;
  count_uphill := 0;

  for i := 0 to 199 do
  begin
    cand_poly.vertices := MutateVertices(rpoly.poly.vertices, 0.3);
    cand_poly.color.r := 0.5; cand_poly.color.g := 0.5; cand_poly.color.b := 0.5;

    Rasterize(cand_poly, H, W, cand_r);
    cand_poly.color := OptimalColor(cand_r, Canvas, Target, W, Alpha);
    cand_r.poly.color := cand_poly.color;

    DeltaE := ScoreDelta(cand_r, Canvas, Target, W, Alpha) - rpoly.delta;
    if DeltaE > 0.0 then
    begin
      sum_uphill := sum_uphill + DeltaE;
      Inc(count_uphill);
    end;
  end;

  if count_uphill > 0 then mean_uphill := sum_uphill / 200.0 else mean_uphill := 0.0;
  if mean_uphill = 0.0 then Result := 0.01 else Result := -mean_uphill / Ln(0.8);
end;

function FitPolygon(const Canvas, Target: TFloatColorArray;
                    const Sched: TAnnealingSchedule;
                    H, W: Integer; Alpha: Single): TRasterizedPolygon;
var
  rpoly, best_rpoly, cand_r: TRasterizedPolygon;
  current_delta, best_delta, cand_delta, DeltaE, T, Sigma: Double;
  step: Integer;
  cand_poly: TPolygon;
begin
  rpoly := InitializePolygon(Canvas, Target, H, W, Alpha);
  current_delta := rpoly.delta;
  best_rpoly := rpoly;
  best_rpoly.mask := Copy(rpoly.mask); // Unique snapshot of mask for the safest keep
  best_delta := current_delta;

  for step := 1 to Sched.N_steps do
  begin
    Temperature(Sched, step, T, Sigma);

    cand_poly.vertices := MutateVertices(rpoly.poly.vertices, Sigma);
    cand_poly.color.r := 0.5; cand_poly.color.g := 0.5; cand_poly.color.b := 0.5;

    Rasterize(cand_poly, H, W, cand_r);
    cand_poly.color := OptimalColor(cand_r, Canvas, Target, W, Alpha);
    cand_r.poly.color := cand_poly.color;
    cand_delta := ScoreDelta(cand_r, Canvas, Target, W, Alpha);

    DeltaE := cand_delta - current_delta;

    if (DeltaE < 0) or (Random < Exp(-DeltaE / T)) then
    begin
      rpoly := cand_r;
      rpoly.mask := Copy(cand_r.mask); // Copy ref to avoid overwrite mutation
      rpoly.delta := cand_delta;
      current_delta := cand_delta;

      if current_delta < best_delta then
      begin
        best_rpoly := rpoly;
        best_rpoly.mask := Copy(rpoly.mask);
        best_delta := current_delta;
      end;
    end;
  end;

  Result := best_rpoly;
end;

procedure CommitPolygon(var Canvas: TFloatColorArray; const rpoly: TRasterizedPolygon; W: Integer; Alpha: Single);
var
  i, j, idx, canvasIdx: Integer;
begin
  idx := 0;
  for i := 0 to rpoly.bh - 1 do
  begin
    for j := 0 to rpoly.bw - 1 do
    begin
      if rpoly.mask[idx] then
      begin
        canvasIdx := (rpoly.yi_min + i) * W + (rpoly.xi_min + j);
        Canvas[canvasIdx].r := (1.0 - Alpha) * Canvas[canvasIdx].r + Alpha * rpoly.poly.color.r;
        Canvas[canvasIdx].g := (1.0 - Alpha) * Canvas[canvasIdx].g + Alpha * rpoly.poly.color.g;
        Canvas[canvasIdx].b := (1.0 - Alpha) * Canvas[canvasIdx].b + Alpha * rpoly.poly.color.b;
      end;
      Inc(idx);
    end;
  end;
end;

function TotalScore(const Canvas, Target: TFloatColorArray): Double;
var
  i: Integer;
begin
  Result := 0.0;
  for i := 0 to Length(Canvas) - 1 do
    Result := Result + Sqr(Canvas[i].r - Target[i].r) + Sqr(Canvas[i].g - Target[i].g) + Sqr(Canvas[i].b - Target[i].b);
end;

// ── BGRABitmap Integration ───────────────────────────────────────────────────

function LoadAndScale(const Path: string; MaxSize: Integer; out W, H: Integer): TBGRABitmap;
var
  Img: TBGRABitmap;
  Resampled: TBGRACustomBitmap;
  Scale: Double;
begin
  Img := TBGRABitmap.Create(Path);
  Scale := MaxSize / Max(Img.Height, Img.Width);
  W := Round(Img.Width * Scale);
  H := Round(Img.Height * Scale);

  Resampled := Img.Resample(W, H);
  Result := TBGRABitmap.Create(W, H);
  Result.PutImage(0, 0, Resampled, dmSet);

  Resampled.Free;
  Img.Free;
end;

procedure BitmapToFloatArray(Bmp: TBGRABitmap; var Arr: TFloatColorArray);
var
  x, y, idx: Integer;
  p: PBGRAPixel;
begin
  idx := 0;
  for y := 0 to Bmp.Height - 1 do
  begin
    p := Bmp.Scanline[y];
    for x := 0 to Bmp.Width - 1 do
    begin
      Arr[idx].r := p^.red / 255.0;
      Arr[idx].g := p^.green / 255.0;
      Arr[idx].b := p^.blue / 255.0;
      Inc(p); Inc(idx);
    end;
  end;
end;

procedure FloatArrayToBitmap(const Arr: TFloatColorArray; Bmp: TBGRABitmap);
var
  x, y, idx: Integer;
  p: PBGRAPixel;

  function ClampByte(v: Double): Byte; inline;
  begin
    if v < 0.0 then Result := 0 else if v > 1.0 then Result := 255 else Result := Round(v * 255.0);
  end;
begin
  idx := 0;
  for y := 0 to Bmp.Height - 1 do
  begin
    p := Bmp.Scanline[y];
    for x := 0 to Bmp.Width - 1 do
    begin
      p^.red := ClampByte(Arr[idx].r);
      p^.green := ClampByte(Arr[idx].g);
      p^.blue := ClampByte(Arr[idx].b);
      p^.alpha := 255;
      Inc(p); Inc(idx);
    end;
  end;
  Bmp.InvalidateBitmap;
end;

procedure InitCanvas(const Target: TFloatColorArray; var Canvas: TFloatColorArray);
var
  i, TotalPixels: Integer;
  sumR, sumG, sumB: Double;
  meanR, meanG, meanB: Single;
begin
  TotalPixels := Length(Target);
  sumR := 0; sumG := 0; sumB := 0;
  for i := 0 to TotalPixels - 1 do
  begin
    sumR := sumR + Target[i].r; sumG := sumG + Target[i].g; sumB := sumB + Target[i].b;
  end;
  meanR := sumR / TotalPixels; meanG := sumG / TotalPixels; meanB := sumB / TotalPixels;

  for i := 0 to TotalPixels - 1 do
  begin
    Canvas[i].r := meanR; Canvas[i].g := meanG; Canvas[i].b := meanB;
  end;
end;

// ── Main Controller ──────────────────────────────────────────────────────────

procedure RunReconstruction(const ImagePath, OutputPath: string; MaxSize, NPolygons, NSteps: Integer; Alpha: Single; SaveEvery: Integer);
var
  TargetBmp, CanvasBmp: TBGRABitmap;
  W, H, i, PolygonsCommitted: Integer;
  Target, Canvas: TFloatColorArray;
  BaseSched, Sched: TAnnealingSchedule;
  TInit, CurrentScore: Double;
  rpoly: TRasterizedPolygon;
  FileName: string;
begin
  WriteLn('Loading image: ', ImagePath);
  TargetBmp := LoadAndScale(ImagePath, MaxSize, W, H);
  WriteLn(Format('Scaled to %dx%d px', [W, H]));

  SetLength(Target, W * H);
  SetLength(Canvas, W * H);

  BitmapToFloatArray(TargetBmp, Target);
  InitCanvas(Target, Canvas);

  WriteLn('Calibrating T_init...');
  TInit := CalibrateTInit(Canvas, Target, H, W, Alpha);
  WriteLn(Format('  T_init = %.4f', [TInit]));

  BaseSched.T_init := TInit; BaseSched.T_final := 1e-6;
  BaseSched.Sigma_init := 0.3; BaseSched.Sigma_final := 0.005;
  BaseSched.N_steps := NSteps;

  PolygonsCommitted := 0;

  for i := 1 to NPolygons do
  begin
    Sched := AdaptiveSchedule(BaseSched, i, NPolygons);
    rpoly := FitPolygon(Canvas, Target, Sched, H, W, Alpha);

    if rpoly.delta < 0.0 then
    begin
      CommitPolygon(Canvas, rpoly, W, Alpha);
      Inc(PolygonsCommitted);
    end;

    CurrentScore := TotalScore(Canvas, Target);
    WriteLn(Format('Polygon %4d | score: %.6f | polygons committed: %d', [i, CurrentScore, PolygonsCommitted]));

    if (SaveEvery > 0) and (i mod SaveEvery = 0) then
    begin
      CanvasBmp := TBGRABitmap.Create(W, H);
      FloatArrayToBitmap(Canvas, CanvasBmp);
      FileName := Format('frame_%04d.png', [i]);
      CanvasBmp.SaveToFile(FileName);
      CanvasBmp.Free;
    end;
  end;

  CanvasBmp := TBGRABitmap.Create(W, H);
  FloatArrayToBitmap(Canvas, CanvasBmp);
  CanvasBmp.SaveToFile(OutputPath);
  CanvasBmp.Free;
  TargetBmp.Free;

  WriteLn('Saved -> ', OutputPath);
end;

// ── Entry Point ──────────────────────────────────────────────────────────────

var
  ImagePath: string = 'photo.jpg';
  OutputPath: string = 'result.png';
  MaxSize: Integer = 256;
  NPolygons: Integer = 300;
  NSteps: Integer = 2000;
  SaveEvery: Integer = 0;
  Alpha: Single = 0.5;

begin
  Randomize;

  if ParamCount >= 1 then ImagePath := ParamStr(1);
  if ParamCount >= 2 then OutputPath := ParamStr(2);
  if ParamCount >= 3 then MaxSize := StrToIntDef(ParamStr(3), 256);
  if ParamCount >= 4 then NPolygons := StrToIntDef(ParamStr(4), 300);
  if ParamCount >= 5 then NSteps := StrToIntDef(ParamStr(5), 2000);
  if ParamCount >= 6 then SaveEvery := StrToIntDef(ParamStr(6), 0);

  if not FileExists(ImagePath) then
  begin
    WriteLn('Usage: PolygonReconstruct <input.jpg> <output.png> [max_size] [n_polygons] [n_steps] [save_every]');
    WriteLn('Error: Input file "', ImagePath, '" not found.');
    Exit;
  end;

  RunReconstruction(ImagePath, OutputPath, MaxSize, NPolygons, NSteps, Alpha, SaveEvery);
end.
