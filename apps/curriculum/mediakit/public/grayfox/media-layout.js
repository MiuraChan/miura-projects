(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.GrayfoxMediaLayout = api;
})(typeof window !== "undefined" ? window : null, function () {
  function profile(preset) {
    if (preset === "story-vertical") return { width: 1080, height: 1920, label: "1080 × 1920 · 9:16" };
    if (preset === "youtube-hd") return { width: 1920, height: 1080, label: "1920 × 1080 · 16:9" };
    return null;
  }
  function sourceRect(width, height, aspect = "full") {
    let cropWidth = width, cropHeight = height;
    const ratio = aspect === "32:9" ? 32 / 9 : (aspect === "21:9" ? 21 / 9 : null);
    if (ratio) {
      if (width / height < ratio) cropHeight = width / ratio;
      else cropWidth = height * ratio;
    }
    return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
  }
  function fitRect(width, height, targetWidth, targetHeight, fill = false) {
    const scale = fill ? Math.max(targetWidth / width, targetHeight / height) : Math.min(targetWidth / width, targetHeight / height);
    return { x: (targetWidth - width * scale) / 2, y: (targetHeight - height * scale) / 2, width: width * scale, height: height * scale };
  }
  function ffmpegFilter({ outputPreset, framing = "fit", sourceAspect = "full" } = {}) {
    const target = profile(outputPreset);
    if (!target) return "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1";
    const ratio = sourceAspect === "32:9" ? 32 / 9 : (sourceAspect === "21:9" ? 21 / 9 : null);
    const crop = ratio ? `crop=w='trunc(min(iw,ih*${ratio})/2)*2':h='trunc(min(ih,iw/${ratio})/2)*2':x='(iw-ow)/2':y='(ih-oh)/2',` : "";
    const { width: w, height: h } = target;
    if (framing === "crop") return `${crop}scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-ow)/2:(ih-oh)/2,setsar=1`;
    if (outputPreset === "story-vertical") {
      return `${crop}split[layoutBg][layoutFg];[layoutBg]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},boxblur=24:2[layoutBlur];[layoutFg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[layoutFit];[layoutBlur][layoutFit]overlay=(W-w)/2:(H-h)/2,setsar=1`;
    }
    return `${crop}scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
  }
  return Object.freeze({ profile, sourceRect, fitRect, ffmpegFilter });
});
