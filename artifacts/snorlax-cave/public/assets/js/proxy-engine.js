export function resolveProxyEngine(selection) {
  if (selection === "titan") {
    throw new Error(
      "Titan is not yet an independent proxy engine. Select Ultraviolet or Scramjet in Settings.",
    );
  }

  return selection === "uv" ? "uv" : "scramjet";
}
