program PolygonWeb;

{$mode objfpc}
{$modeswitch externalclass}

uses
  JS,
  Web,
  Math,
  weborworker,
  SysUtils;

const
  MaxSize: integer = 512;  // pixels
  Epsilon = -0.1;  // epsilon for improvement
  NonImprovementThreshold: integer = 20;

var
  StopRequested: boolean;

type
  //// Explicitly bind the browser's native ImageData object
  //TJSImageData = class external name 'ImageData' (TJSObject)
  //public
  //  width: Integer;
  //  height: Integer;
  //  data: TJSUint8ClampedArray;
  //end;

  TFloatColor = record
    r, g, b: double;
  end;
  TFloatColorArray = array of TFloatColor;

  TVertex = record
    x, y: double;
  end;
  TPolyVertices = array[0..2] of TVertex;

  TPolygon = record
    vertices: TPolyVertices;
    color: TFloatColor;
  end;

  TRasterizedPolygon = record
    poly: TPolygon;
    mask: array of boolean;
    xi_min, xi_max, yi_min, yi_max: integer;
    bh, bw: integer;
    delta: double;
  end;

  TAnnealingSchedule = record
    T_init, T_final: double;
    Sigma_init, Sigma_final: double;
    N_steps: integer;
  end;

  // ── Utils ────────────────────────────────────────────────────────────────────

  // Box-Muller transform for standard normal distribution
  function Randn: double;
  var
    u1, u2: double;
  begin
    u1 := Random;
    while u1 = 0.0 do u1 := Random; // Ensure > 0 for Ln()
    u2 := Random;
    Result := Sqrt(-2.0 * Ln(u1)) * Cos(2.0 * Pi * u2);
  end;

  procedure BoundingBox(const verts: TPolyVertices; out x_min, x_max, y_min, y_max: double);
  begin
    x_min := Min(verts[0].x, Min(verts[1].x, verts[2].x));
    x_max := Max(verts[0].x, Max(verts[1].x, verts[2].x));
    y_min := Min(verts[0].y, Min(verts[1].y, verts[2].y));
    y_max := Max(verts[0].y, Max(verts[1].y, verts[2].y));
  end;

  procedure ToPixelRange(x_min, x_max, y_min, y_max: double; H, W: integer; out xi_min, xi_max, yi_min, yi_max: integer);
  begin
    xi_min := Max(0, Floor(x_min * W));
    xi_max := Min(W - 1, Ceil(x_max * W));
    yi_min := Max(0, Floor(y_min * H));
    yi_max := Min(H - 1, Ceil(y_max * H));
  end;

  function EdgeFn(ax, ay, bx, by, px, py: double): double; inline;
  begin
    Result := (px - bx) * (ay - by) - (ax - bx) * (py - by);
  end;

  // ── Rasterizer ───────────────────────────────────────────────────────────────

  procedure Rasterize(const poly: TPolygon; H, W: integer; var rpoly: TRasterizedPolygon);
  var
    x_min, x_max, y_min, y_max: double;
    i, j, idx: integer;
    px, py: double;
    d1, d2, d3: double;
    has_neg, has_pos: boolean;
    ax, ay, bx, by, cx, cy: double;
  begin
    BoundingBox(poly.vertices, x_min, x_max, y_min, y_max);
    ToPixelRange(x_min, x_max, y_min, y_max, H, W, rpoly.xi_min, rpoly.xi_max, rpoly.yi_min, rpoly.yi_max);

    rpoly.bh := Max(0, rpoly.yi_max - rpoly.yi_min + 1);
    rpoly.bw := Max(0, rpoly.xi_max - rpoly.xi_min + 1);
    rpoly.poly := poly;
    rpoly.delta := 0.0;

    SetLength(rpoly.mask, rpoly.bh * rpoly.bw);
    if (rpoly.bh = 0) or (rpoly.bw = 0) then Exit;

    ax := poly.vertices[0].x * W;
    ay := poly.vertices[0].y * H;
    bx := poly.vertices[1].x * W;
    by := poly.vertices[1].y * H;
    cx := poly.vertices[2].x * W;
    cy := poly.vertices[2].y * H;

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

  function OptimalColor(const rpoly: TRasterizedPolygon; const Canvas, Target: TFloatColorArray;
    W: integer; Alpha: double = 0.5): TFloatColor;
  var
    i, j, idx, canvasIdx, n: integer;
    accR, accG, accB: double;
  begin
    n := 0;
    for i := 0 to Length(rpoly.mask) - 1 do
      if rpoly.mask[i] then Inc(n);

    if n = 0 then
    begin
      Result.r := 0.5;
      Result.g := 0.5;
      Result.b := 0.5;
      Exit;
    end;

    accR := 0.0;
    accG := 0.0;
    accB := 0.0;
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

    if Result.r < 0.0 then Result.r := 0.0
    else if Result.r > 1.0 then Result.r := 1.0;
    if Result.g < 0.0 then Result.g := 0.0
    else if Result.g > 1.0 then Result.g := 1.0;
    if Result.b < 0.0 then Result.b := 0.0
    else if Result.b > 1.0 then Result.b := 1.0;
  end;

  // ── Score Delta ──────────────────────────────────────────────────────────────

  function ScoreDelta(const rpoly: TRasterizedPolygon; const Canvas, Target: TFloatColorArray;
    W: integer; Alpha: double = 0.5): double;
  var
    i, j, idx, canvasIdx: integer;
    cvR, cvG, cvB, tvR, tvG, tvB, bvR, bvG, bvB: double;
    colR, colG, colB: double;
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

          cvR := Canvas[canvasIdx].r;
          cvG := Canvas[canvasIdx].g;
          cvB := Canvas[canvasIdx].b;
          tvR := Target[canvasIdx].r;
          tvG := Target[canvasIdx].g;
          tvB := Target[canvasIdx].b;

          bvR := (1.0 - Alpha) * cvR + Alpha * colR;
          bvG := (1.0 - Alpha) * cvG + Alpha * colG;
          bvB := (1.0 - Alpha) * cvB + Alpha * colB;

          Result := Result + (Sqr(bvR - tvR) - Sqr(cvR - tvR)) + (Sqr(bvG - tvG) - Sqr(cvG - tvG)) +
            (Sqr(bvB - tvB) - Sqr(cvB - tvB));
        end;
        Inc(idx);
      end;
    end;
  end;

  // ── Polygon Initialization ───────────────────────────────────────────────────

  function InitializePolygon(const Canvas, Target: TFloatColorArray; H, W: integer; Alpha: double = 0.5): TRasterizedPolygon;
  var
    ErrorMap: array of double;
    TotalError, RndVal, Acc: double;
    i, k: integer;
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
    poly.color.r := 0.5;
    poly.color.g := 0.5;
    poly.color.b := 0.5;

    Rasterize(poly, H, W, Result);
    poly.color := OptimalColor(Result, Canvas, Target, W, Alpha);
    Result.poly.color := poly.color;
    Result.delta := ScoreDelta(Result, Canvas, Target, W, Alpha);
  end;

  // ── Vertex Mutation ──────────────────────────────────────────────────────────

  function MutateVertices(const verts: TPolyVertices; Sigma: double): TPolyVertices;
  var
    r, dx, dy, ScaleFactor: double;
    i: integer;
    centroid: TVertex;
    Theta, C, S: double;
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
      if Result[i].x < 0.0 then Result[i].x := 0.0
      else if Result[i].x > 1.0 then Result[i].x := 1.0;
      if Result[i].y < 0.0 then Result[i].y := 0.0
      else if Result[i].y > 1.0 then Result[i].y := 1.0;
    end;
  end;

  // ── Annealing Schedule ───────────────────────────────────────────────────────

  procedure Temperature(const sched: TAnnealingSchedule; Step: integer; out T, Sigma: double);
  var
    Alpha: double;
  begin
    Alpha := Step / sched.N_steps;
    T := sched.T_init * Power(sched.T_final / sched.T_init, Alpha);
    Sigma := sched.Sigma_init * Power(sched.Sigma_final / sched.Sigma_init, Alpha);
  end;

  function AdaptiveSchedule(const base: TAnnealingSchedule; Progress: double): TAnnealingSchedule;
  begin
    // Progress is 0.0 at the start, and approaches 1.0 as the reconstruction improves
    Result := base;
    Result.N_steps := Round(base.N_steps * (0.5 + Progress));
    Result.Sigma_init := base.Sigma_init * (1.0 - 0.8 * Progress);
  end;

  // ── Core Evaluators ──────────────────────────────────────────────────────────

  function CalibrateTInit(const Canvas, Target: TFloatColorArray; H, W: integer; Alpha: double): double;
  var
    rpoly, cand_r: TRasterizedPolygon;
    i, count_uphill: integer;
    cand_poly: TPolygon;
    DeltaE, sum_uphill, mean_uphill: double;
  begin
    rpoly := InitializePolygon(Canvas, Target, H, W, Alpha);
    sum_uphill := 0.0;
    count_uphill := 0;

    for i := 0 to 199 do
    begin
      cand_poly.vertices := MutateVertices(rpoly.poly.vertices, 0.3);
      cand_poly.color.r := 0.5;
      cand_poly.color.g := 0.5;
      cand_poly.color.b := 0.5;

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

    if count_uphill > 0 then mean_uphill := sum_uphill / 200.0
    else
      mean_uphill := 0.0;
    if mean_uphill = 0.0 then Result := 0.01
    else
      Result := -mean_uphill / Ln(0.8);
  end;

  function FitPolygon(const Canvas, Target: TFloatColorArray; const Sched: TAnnealingSchedule;
    H, W: integer; Alpha: double): TRasterizedPolygon;
  var
    rpoly, best_rpoly, cand_r: TRasterizedPolygon;
    current_delta, best_delta, cand_delta, DeltaE, T, Sigma: double;
    step: integer;
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
      cand_poly.color.r := 0.5;
      cand_poly.color.g := 0.5;
      cand_poly.color.b := 0.5;

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

  procedure CommitPolygon(var Canvas: TFloatColorArray; const rpoly: TRasterizedPolygon; W: integer; Alpha: double);
  var
    i, j, idx, canvasIdx: integer;
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

  function TotalScore(const Canvas, Target: TFloatColorArray): double;
  var
    i: integer;
  begin
    Result := 0.0;
    for i := 0 to Length(Canvas) - 1 do
      Result := Result + Sqr(Canvas[i].r - Target[i].r) + Sqr(Canvas[i].g - Target[i].g) + Sqr(Canvas[i].b - Target[i].b);
  end;

  procedure InitCanvas(const Target: TFloatColorArray; var Canvas: TFloatColorArray);
  var
    i, TotalPixels: integer;
    sumR, sumG, sumB: double;
    meanR, meanG, meanB: double;
  begin
    TotalPixels := Length(Target);
    sumR := 0;
    sumG := 0;
    sumB := 0;
    for i := 0 to TotalPixels - 1 do
    begin
      sumR := sumR + Target[i].r;
      sumG := sumG + Target[i].g;
      sumB := sumB + Target[i].b;
    end;
    meanR := sumR / TotalPixels;
    meanG := sumG / TotalPixels;
    meanB := sumB / TotalPixels;

    for i := 0 to TotalPixels - 1 do
    begin
      Canvas[i].r := meanR;
      Canvas[i].g := meanG;
      Canvas[i].b := meanB;
    end;
  end;

  // ── Web-specific functions ───────────────────────────────────────────────────

var
  TargetArray, CanvasArray: TFloatColorArray;
  TargetCtx, ReconstructCtx: TJSCanvasRenderingContext2D;
  CanvasData: TJSImageData;
  ImgWidth, ImgHeight: integer;

  // State variables for the loop
  BaseSched: TAnnealingSchedule;
  Iteration, PolygonsCommitted, FailCount: integer;
  InitialScore, CurrentScore: double;
  IsRunning: boolean;

  procedure UpdateScreen;
  var
    i, p: integer;
  begin
    p := 0;
    for i := 0 to (ImgWidth * ImgHeight) - 1 do
    begin
      CanvasData.Data[p] := Round(CanvasArray[i].r * 255);
      CanvasData.Data[p + 1] := Round(CanvasArray[i].g * 255);
      CanvasData.Data[p + 2] := Round(CanvasArray[i].b * 255);
      CanvasData.Data[p + 3] := 255; // Alpha
      Inc(p, 4);
    end;
    ReconstructCtx.putImageData(CanvasData, 0, 0);
  end;

  procedure DoNextFrame(Time: double);
  var
    Progress: double;
    Sched: TAnnealingSchedule;
    rpoly: TRasterizedPolygon;
  begin
    if not IsRunning then Exit;

    Inc(Iteration);
    Progress := -Ln(CurrentScore / InitialScore) / 4.60517;
    if Progress < 0 then Progress := 0;
    if Progress > 1 then Progress := 1;

    Sched := AdaptiveSchedule(BaseSched, Progress);
    rpoly := FitPolygon(CanvasArray, TargetArray, Sched, ImgHeight, ImgWidth, 0.5);

    if rpoly.delta < Epsilon then
    begin
      CommitPolygon(CanvasArray, rpoly, ImgWidth, 0.5);
      Inc(PolygonsCommitted);
      CurrentScore := TotalScore(CanvasArray, TargetArray);
      FailCount := 0;

      // Draw the new array to the HTML canvas
      UpdateScreen;
      document.getElementById('statusText').innerHTML :=
        'Polygons: ' + IntToStr(PolygonsCommitted) + ' | Progress: ' + IntToStr(Round(Progress * 100)) + '%';
    end
    else
      Inc(FailCount);

    if not StopRequested and (FailCount < NonImprovementThreshold) then
      window.requestAnimationFrame(@DoNextFrame) // Schedule next frame
    else
    begin
      IsRunning := False;
      if StopRequested then
        document.getElementById('finalText').innerHTML := 'User requested stop.'
      else
        document.getElementById('finalText').innerHTML := 'Finished!';
    end;

  end;

  procedure StartReconstruction;
  begin
    InitialScore := TotalScore(CanvasArray, TargetArray);
    CurrentScore := InitialScore;

    BaseSched.T_init := CalibrateTInit(CanvasArray, TargetArray, ImgHeight, ImgWidth, 0.5);
    BaseSched.T_final := 1e-6;
    BaseSched.Sigma_init := 0.3;
    BaseSched.Sigma_final := 0.005;
    BaseSched.N_steps := 2000;

    Iteration := 0;
    FailCount := 0;
    PolygonsCommitted := 0;
    IsRunning := True;
    StopRequested := false;
    document.getElementById('finalText').innerHTML := '';
    TJSHTMLButtonElement(document.getElementById('stopBtn')).Disabled := False; // Disable button after clicking

    // Kick off the animation loop
    window.requestAnimationFrame(@DoNextFrame);
  end;

  function OnImageLoaded(Event: TJSEvent): boolean;
  var
    ImgElement: TJSHTMLImageElement;
    ImgData: TJSImageData;
    i, p: integer;
    Scale: double;
  begin
    ImgElement := TJSHTMLImageElement(Event.Target);

    // 1. Calculate the scaling factor while maintaining the aspect ratio
    Scale := MaxSize / Max(ImgElement.Width, ImgElement.Height);

    // (Optional) If the image is already smaller than MaxSize, don't upscale it
    if Scale > 1.0 then Scale := 1.0;

    ImgWidth := Round(ImgElement.Width * Scale);
    ImgHeight := Round(ImgElement.Height * Scale);

    // 2. Resize the HTML canvases to the new scaled dimensions
    TJSHTMLCanvasElement(document.getElementById('targetCanvas')).Width := ImgWidth;
    TJSHTMLCanvasElement(document.getElementById('targetCanvas')).Height := ImgHeight;
    TJSHTMLCanvasElement(document.getElementById('reconstructCanvas')).Width := ImgWidth;
    TJSHTMLCanvasElement(document.getElementById('reconstructCanvas')).Height := ImgHeight;

    TargetCtx := TJSCanvasRenderingContext2D(TJSHTMLCanvasElement(document.getElementById('targetCanvas')).getContext('2d'));
    ReconstructCtx := TJSCanvasRenderingContext2D(TJSHTMLCanvasElement(document.getElementById('reconstructCanvas')).getContext('2d'));

    // 3. Draw the image using the 5-parameter signature: (Image, X, Y, NewWidth, NewHeight)
    // The browser automatically resamples and anti-aliases the image to fit this box!
    TargetCtx.drawImage(ImgElement, 0, 0, ImgWidth, ImgHeight);

    // 4. Extract the scaled pixels
    ImgData := TargetCtx.getImageData(0, 0, ImgWidth, ImgHeight);

    SetLength(TargetArray, ImgWidth * ImgHeight);
    SetLength(CanvasArray, ImgWidth * ImgHeight);

    // 5. Convert browser RGBA array to our Float array
    p := 0;
    for i := 0 to (ImgWidth * ImgHeight) - 1 do
    begin
      TargetArray[i].r := ImgData.Data[p] / 255.0;
      TargetArray[i].g := ImgData.Data[p + 1] / 255.0;
      TargetArray[i].b := ImgData.Data[p + 2] / 255.0;
      Inc(p, 4);
    end;

    InitCanvas(TargetArray, CanvasArray);   // init Canvas with average color
    CanvasData := ReconstructCtx.createImageData(ImgWidth, ImgHeight);

    // Kick off the reconstruction
    StartReconstruction;

    Result := True;
  end;


  procedure OnFileSelected(Event: TJSEvent);
  var
    Input: TJSHTMLInputElement;
    FileObj: TJSHTMLFile;
    Img: TJSHTMLImageElement;
  begin
    Input := TJSHTMLInputElement(Event.Target);
    if Input.Files.Length > 0 then
    begin
      FileObj := TJSHTMLFile(Input.Files[0]);
      Img := TJSHTMLImageElement(document.createElement('img'));
      Img.OnLoad := @OnImageLoaded;

      // Creates a temporary browser URL for the uploaded file
      Img.Src := TJSURL.createObjectURL(FileObj);
    end;
  end;

  function OnStopClicked(Event: TJSEvent): boolean;
  begin
    StopRequested := True;
    TJSHTMLButtonElement(Event.Target).Disabled := True; // Disable button after clicking
    Result := True;
  end;

  function OnAnneallingStepsSliderInput(Event: TJSEvent): boolean;
  var
    Slider: TJSHTMLInputElement;
    NewSteps: integer;
  begin
    Slider := TJSHTMLInputElement(Event.Target);
    NewSteps := StrToIntDef(Slider.Value, 2000);

    // Update the schedule dynamically!
    BaseSched.N_steps := NewSteps;

    // Update the text label on the screen
    //document.getElementById('stepDisplay').innerHTML := IntToStr(NewSteps);

    Result := True;
  end;

  function OnNonImprovementSliderInput(Event: TJSEvent): boolean;
  var
    Slider: TJSHTMLInputElement;
    NewNonImprovement: integer;
  begin
    Slider := TJSHTMLInputElement(Event.Target);
    NewNonImprovement := StrToIntDef(Slider.Value, 20);

    // Update the schedule dynamically!
    NonImprovementThreshold := NewNonImprovement;

    // Update the text label on the screen
    //document.getElementById('nonImprovementCount').innerHTML := IntToStr(NewNonImprovement);

    Result := True;
  end;



begin
  StopRequested := False;
  // Bind the file input event when the script starts
  document.getElementById('imageUpload').addEventListener('change', @OnFileSelected);
  document.getElementById('annealSteps').addEventListener('input', @OnAnneallingStepsSliderInput);
  document.getElementById('nonImprovementCount').addEventListener('input', @OnNonImprovementSliderInput);
  document.getElementById('stopBtn').addEventListener('click', @OnStopClicked);
end.
