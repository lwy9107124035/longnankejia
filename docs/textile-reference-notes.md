# Textile model reference notes

The six display models use crops from the photographs in `3D模型参考原图/`. The texture builder rectifies only photographed cloth areas; it does not paint or invent textile motifs. Run `scripts/build_textile_textures.py` with the project Python runtime to regenerate the JPGs in `assets/model-textures/`.

## Photo mapping

| Item | Photo evidence and crop | Model treatment |
| --- | --- | --- |
| Flower hat 219 | `花帽/微信图片_20260928203744_219_964.jpg`. The tiger patch uses source bounds x=.20–.89, y=.32–.58. The upper crown crop spans x=.025–.975, y=.115–.345 so the white ground, red braid and magenta piping remain together. The drape uses x=.08–.90, y=.60–.78. | The crown panel tapers with the dome and follows the photographed broad band. The tiger patch is curved over the black crown; the lower red floral cloth hangs as its own wavy panel. The brim piping lies flat in the horizontal plane. The chosen crops are from the visible front; the rear construction is not shown by this photo. |
| Ribbon 255 | `织带/微信图片_20260928203852_255_964.jpg`. Eight neighboring perspective crops rectify the full photographed blue band into 1600×96 while retaining the actual woven lettering and motifs. | One narrow long strip and a small yarn tassel. The photo supports the visible band and lettering; the tassel form is simplified. |
| Winter head cloth 235 | `冬头帕/微信图片_20260928203827_235_964.jpg`. The four corners are (.253,.265), (.539,.275), (.547,.644), (.259,.651), producing a square cloth crop. | Square 1.58×1.58 cloth with small surface ripples. The entire photographic panel sits ahead of the backing, so the lower embroidery stays visible. |
| Jacket 230 | `大襟衫/微信图片_20260928203812_230_964.jpg`. The blue fabric crop is restricted to x=.355–.580, y=.250–.515, excluding the adjacent sleeve, mannequin and background. The cuff and diagonal braid have separate four-corner crops recorded in the builder. | The full front follows the shoulder and hem outline with shallow cloth folds. Rounded open sleeves slope outward toward the wrist, widen at their ends and carry the actual woven texture and cuff bands. The curved standing collar and diagonal overlap continue into the side braid. The single front photograph does not establish the back or exact garment thickness. |
| Grandchild pouch 199 | `子孙袋/微信图片_20260928203727_199_964.jpg`. The crop starts at y=.315 to leave out the loose plaid cloth folded above the pouch, and follows the visible body down to y≈.745. | The front panel and thin backing use proportions close to the corrected crop (900×990); no handle is modeled. Soft edge piping is only a simplified seam cue. The photo is oblique, so the pouch depth is approximate. |
| Neck cloth 193 | `脖围/微信图片_20260928203716_193_964.jpg`. The 1200×1200 crop preserves all four quarters. The opening center is approximately (.48,.416) measured from the photo's top-left, with a radius near 120 px; Three.js UV v is .584. | Four quarter meshes leave a real through-hole. Inner/outer radius is .164/.78≈.21. UVs place the opening over the photo's off-center hole and map its radius to about .10 of the crop; the side wall and flat torus seams finish the cloth edge. |

## Evidence limits

The photographs document the visible surfaces and motifs, not complete 3D scans. Curvature, folds, thickness, hidden backs, and seam depth are therefore display approximations. The source textures preserve the actual photographed embroidery and lettering; geometry adds no unsupported animal features or invented textile patterns.
