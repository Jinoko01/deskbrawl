$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not ('DeskBrawlAlpha' -as [type])) {
    Add-Type -TypeDefinition @'
public static class DeskBrawlAlpha {
    public static int Gutter(byte[] pixels, int stride, int width, int height, int target, bool vertical) {
        int length = vertical ? height : width;
        for (int distance = 0; distance <= 96; distance++) {
            foreach (int candidate in new int[] { target - distance, target + distance }) {
                bool clear = true;
                for (int position = 0; position < length && clear; position++) {
                    for (int line = candidate - 1; line <= candidate; line++) {
                        int x = vertical ? line : position;
                        int y = vertical ? position : line;
                        if (pixels[y * stride + x * 4 + 3] >= 128) { clear = false; break; }
                    }
                }
                if (clear) return candidate;
            }
        }
        throw new System.Exception("No clear gutter near " + target);
    }
    public static int[] Bounds(byte[] pixels, int stride, int left, int top, int right, int bottom) {
        int minX = right, minY = bottom, maxX = -1, maxY = -1;
        int visible = 0, transparent = 0, edge = 0;
        for (int y = top; y < bottom; y++) {
            for (int x = left; x < right; x++) {
                int alpha = pixels[y * stride + x * 4 + 3];
                if (alpha == 0) { transparent++; continue; }
                visible++;
                if (alpha < 128) continue;
                minX = System.Math.Min(minX, x); minY = System.Math.Min(minY, y);
                maxX = System.Math.Max(maxX, x); maxY = System.Math.Max(maxY, y);
                if (x == left || x == right - 1 || y == top || y == bottom - 1) edge++;
            }
        }
        // Retain a two-pixel fringe around the solid silhouette.
        return new int[] {
            System.Math.Max(left, minX - 2), System.Math.Max(top, minY - 2),
            System.Math.Min(right - 1, maxX + 2), System.Math.Min(bottom - 1, maxY + 2),
            visible, transparent, edge
        };
    }
}
'@
}

# Reads PNGs without resampling or changing their pixels. Generated atlas rectangles
# trim transparent margins; source placement aligns character feet across frames.
$assetRoot = Split-Path -Parent $PSScriptRoot
$characters = @(
    @{ id = 'mint'; name = '민트'; description = '민트 헤드폰'; color = '#64d5c1' },
    @{ id = 'sunny'; name = '써니'; description = '노란 비옷 탐험가'; color = '#f6c44c' },
    @{ id = 'coral'; name = '코랄'; description = '코랄 정비사'; color = '#f17e82' },
    @{ id = 'lumi'; name = '루미'; description = '보라빛 마법사'; color = '#b89aee' },
    @{ id = 'rusty'; name = '러스티'; description = '주황 여우 후드'; color = '#e6a366' },
    @{ id = 'byte'; name = '바이트'; description = '파란 미니 로봇'; color = '#75b7ef' },
    @{ id = 'berry'; name = '베리'; description = '분홍 토끼 후드'; color = '#f0a7ca' },
    @{ id = 'mochi'; name = '모찌'; description = '크림 곰 잠옷'; color = '#e7d7ae' }
)
$characterAnimations = [ordered]@{
    idle = @(0, 1, 2, 3)
    walk = @(4, 5, 6, 7)
    melee = @(8, 9, 10, 11)
    throw = @(12, 13)
    hit = @(14, 15)
}
$propNames = @(
    'squeaky-hammer', 'foam-baton', 'practice-sword', 'rubber-chicken',
    'foam-glove', 'fly-swatter', 'paper-roll', 'soft-mallet',
    'stone-gray-0', 'stone-gray-1', 'stone-gray-2', 'stone-gray-3',
    'stone-brown-0', 'stone-brown-1', 'stone-brown-2', 'stone-brown-3'
)
$effectAnimations = [ordered]@{
    swoosh = @(0, 1, 2, 3)
    impact = @(4, 5, 6, 7)
    stun = @(8, 9, 10, 11)
    dust = @(12, 13, 14, 15)
}
$preview = [ordered]@{ characters = $characters; sheets = [ordered]@{} }
$report = @()

foreach ($id in @($characters.id) + @('props', 'effects')) {
    $folder = if ($id -in @('props', 'effects')) { $id } else { 'characters' }
    $fileStem = "$id-v2"
    $relativeImage = "$folder/$fileStem.png"
    $imagePath = Join-Path $assetRoot $relativeImage
    $bitmap = [System.Drawing.Bitmap]::new($imagePath)
    try {
        $rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
        $locked = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            if ($locked.Stride -le 0) { throw 'Unsupported negative PNG row stride' }
            $stride = $locked.Stride
            $pixels = [byte[]]::new($stride * $bitmap.Height)
            [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $pixels, 0, $pixels.Length)
        } finally { $bitmap.UnlockBits($locked) }
        $frames = [ordered]@{}
        $animations = [ordered]@{}
        $frameNames = @()
        $xEdges = @(0)
        $yEdges = @(0)
        foreach ($division in 1..3) {
            $xEdges += [DeskBrawlAlpha]::Gutter($pixels, $stride, $bitmap.Width, $bitmap.Height, [int][Math]::Floor($division * $bitmap.Width / 4), $true)
            $yEdges += [DeskBrawlAlpha]::Gutter($pixels, $stride, $bitmap.Width, $bitmap.Height, [int][Math]::Floor($division * $bitmap.Height / 4), $false)
        }
        $xEdges += $bitmap.Width
        $yEdges += $bitmap.Height
        $largestCell = 0
        foreach ($cell in 0..3) {
            $largestCell = [Math]::Max($largestCell, [Math]::Max($xEdges[$cell + 1] - $xEdges[$cell], $yEdges[$cell + 1] - $yEdges[$cell]))
        }
        $sourceSize = $largestCell + 16
        $baseline = $sourceSize - 8
        $isCharacter = $folder -eq 'characters'
        for ($index = 0; $index -lt 16; $index++) {
            $column = $index % 4
            $row = [int][Math]::Floor($index / 4)
            $left = $xEdges[$column]
            $top = $yEdges[$row]
            $right = $xEdges[$column + 1]
            $bottom = $yEdges[$row + 1]
            $minX, $minY, $maxX, $maxY, $visiblePixels, $transparentPixels, $edgePixels = [DeskBrawlAlpha]::Bounds($pixels, $stride, $left, $top, $right, $bottom)
            if ($visiblePixels -eq 0) { throw "$id frame $index is empty" }
            if ($transparentPixels -eq 0) { throw "$id frame $index has no transparent pixels" }
            if ($edgePixels -gt 0) { throw "$id frame $index touches its cell boundary ($edgePixels pixels); review before publishing atlas" }
            $width = $maxX - $minX + 1
            $height = $maxY - $minY + 1
            $name = if ($id -eq 'props') { $propNames[$index] } else { "$id-$index" }
            $frameNames += $name
            $placementX = 8 + $minX - $left
            $placementY = if ($isCharacter) { $baseline - $height } else { 8 + $minY - $top }
            $frames[$name] = [ordered]@{
                frame = @{ x = $minX; y = $minY; w = $width; h = $height }
                rotated = $false
                trimmed = $true
                spriteSourceSize = @{ x = $placementX; y = $placementY; w = $width; h = $height }
                sourceSize = @{ w = $sourceSize; h = $sourceSize }
                anchor = @{ x = 0.5; y = $(if ($isCharacter) { $baseline / $sourceSize } else { 0.5 }) }
            }
            $report += [ordered]@{
                sheet = $id; frame = $name; width = $width; height = $height
                visiblePixels = $visiblePixels; transparentPixels = $transparentPixels; boundaryPixels = $edgePixels
            }
        }
        $animationIndices = if ($isCharacter) { $characterAnimations } elseif ($id -eq 'effects') { $effectAnimations } else {
            [ordered]@{ 'stone-gray' = @(8, 9, 10, 11); 'stone-brown' = @(12, 13, 14, 15) }
        }
        foreach ($entry in $animationIndices.GetEnumerator()) {
            $animations[$entry.Key] = @($entry.Value | ForEach-Object { $frameNames[$_] })
        }
        $atlas = [ordered]@{
            frames = $frames
            animations = $animations
            meta = [ordered]@{
                image = "$fileStem.png"
                format = 'RGBA8888'
                size = @{ w = $bitmap.Width; h = $bitmap.Height }
                scale = '1'
            }
        }
        $atlas | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $assetRoot "$folder/$fileStem.json") -Encoding utf8
        $preview.sheets[$id] = @{ image = $relativeImage; atlas = $atlas }
        Write-Output "$id : $($bitmap.Width)x$($bitmap.Height), 16 nonempty transparent frames, clear cell boundaries"
    } finally {
        $bitmap.Dispose()
    }
}
$previewJson = $preview | ConvertTo-Json -Depth 15 -Compress
Set-Content -LiteralPath (Join-Path $assetRoot 'preview-data.js') -Value "window.DESKBRAWL_ASSETS = $previewJson;" -Encoding utf8
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $assetRoot 'validation.json') -Encoding utf8
