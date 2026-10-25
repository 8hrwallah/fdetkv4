const validThemes = ["midnight", "obsidian", "slate", "light"];
const validAccents = ["violet", "ice", "silver"];
const maxCrxBytes = 20 * 1024 * 1024;

export function findCrxZipOffset(bytes) {
  if (bytes.length < 16) throw new Error("This file is too small to be a CRX package.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== "Cr24") throw new Error("The selected file does not have a valid CRX header.");
  const version = view.getUint32(4, true);
  let zipOffset;
  if (version === 2) {
    const publicKeyLength = view.getUint32(8, true);
    const signatureLength = view.getUint32(12, true);
    zipOffset = 16 + publicKeyLength + signatureLength;
  } else if (version === 3) {
    if (bytes.length < 12) throw new Error("The CRX3 header is incomplete.");
    zipOffset = 12 + view.getUint32(8, true);
  } else {
    throw new Error(`CRX version ${version} is not supported for inspection.`);
  }
  if (zipOffset >= bytes.length || bytes[zipOffset] !== 0x50 || bytes[zipOffset + 1] !== 0x4b) {
    throw new Error("The CRX package does not contain a readable ZIP archive.");
  }
  return { version, zipOffset };
}

async function readZipManifest(bytes, zipOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(zipOffset, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Could not find the CRX ZIP directory.");

  const totalEntries = view.getUint16(endOffset + 10, true);
  const directoryOffset = zipOffset + view.getUint32(endOffset + 16, true);
  if (totalEntries > 10_000) throw new Error("The CRX contains too many files to inspect safely.");
  let cursor = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("The CRX ZIP directory is malformed.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = zipOffset + view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === "manifest.json") {
      if (uncompressedSize > 256 * 1024) throw new Error("The extension manifest is too large to inspect.");
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error("The extension manifest entry is malformed.");
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) throw new Error("The extension manifest data is truncated.");
      const payload = bytes.subarray(dataStart, dataEnd);
      let manifestText;
      if (method === 0) {
        manifestText = new TextDecoder().decode(payload);
      } else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const reader = stream.getReader();
        const chunks = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > 256 * 1024) {
            await reader.cancel();
            throw new Error("The extension manifest is too large to inspect.");
          }
          chunks.push(value);
        }
        const manifestBytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          manifestBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        manifestText = new TextDecoder().decode(manifestBytes);
      } else {
        throw new Error("This extension manifest uses an unsupported compression method.");
      }
      if (manifestText.length > 256 * 1024) throw new Error("The extension manifest is too large to inspect.");
      const manifest = JSON.parse(manifestText);
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("The extension manifest is not a JSON object.");
      }
      return manifest;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("No root manifest.json was found in this extension package.");
}

export async function inspectCrxFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".crx")) {
    throw new Error("Choose a file with the .crx extension.");
  }
  if (file.size <= 0 || file.size > maxCrxBytes) {
    throw new Error("CRX files must be between 1 byte and 20 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { version, zipOffset } = findCrxZipOffset(bytes);
  const manifest = await readZipManifest(bytes, zipOffset);
  return {
    crxVersion: version,
    name: typeof manifest.name === "string" ? manifest.name : "Unnamed extension",
    version: typeof manifest.version === "string" ? manifest.version : "Unknown",
    manifestVersion: Number.isInteger(manifest.manifest_version) ? manifest.manifest_version : null,
    permissionCount: Array.isArray(manifest.permissions) ? manifest.permissions.length : 0,
  };
}

function setMessage(node, message, error = false) {
  node.textContent = message;
  node.dataset.state = error ? "error" : "success";
}

function initializeSettings() {
  const mode = document.getElementById("interface-mode");
  const saveMode = document.getElementById("save-interface-mode");
  const modeStatus = document.getElementById("interface-mode-status");
  const themeRadios = [...document.querySelectorAll('input[name="tabbed-theme"]')];
  const accentRadios = [...document.querySelectorAll('input[name="tabbed-accent"]')];
  const addonInput = document.getElementById("crx-upload");
  const addonStatus = document.getElementById("crx-status");
  if (!mode || !saveMode || !modeStatus || !addonInput || !addonStatus) return;

  try {
    mode.value = localStorage.getItem("interfaceMode") === "tabbed" ? "tabbed" : "casual";
    const savedTheme = localStorage.getItem("tabbedTheme");
    const savedAccent = localStorage.getItem("tabbedAccent");
    const theme = validThemes.includes(savedTheme) ? savedTheme : "midnight";
    const accent = validAccents.includes(savedAccent) ? savedAccent : "violet";
    const selectedTheme = themeRadios.find((radio) => radio.value === theme);
    const selectedAccent = accentRadios.find((radio) => radio.value === accent);
    if (selectedTheme) selectedTheme.checked = true;
    if (selectedAccent) selectedAccent.checked = true;
    document.documentElement.dataset.tabbedTheme = theme;
    document.documentElement.dataset.tabbedAccent = accent;
  } catch (error) {
    setMessage(modeStatus, `Could not read saved preferences: ${error.message}`, true);
  }

  saveMode.addEventListener("click", () => {
    try {
      const selected = mode.value === "tabbed" ? "tabbed" : "casual";
      localStorage.setItem("interfaceMode", selected);
      setMessage(modeStatus, `Saved ${selected === "tabbed" ? "Tabbed" : "Casual"} mode. Opening the home page…`);
      window.setTimeout(() => location.assign("/"), 250);
    } catch (error) {
      setMessage(modeStatus, `Could not save interface mode: ${error.message}`, true);
    }
  });

  for (const radio of themeRadios) {
    radio.addEventListener("change", () => {
      if (!radio.checked || !validThemes.includes(radio.value)) return;
      try {
        localStorage.setItem("tabbedTheme", radio.value);
        document.documentElement.dataset.tabbedTheme = radio.value;
      } catch (error) {
        setMessage(modeStatus, `Could not save Tabbed theme: ${error.message}`, true);
      }
    });
  }
  for (const radio of accentRadios) {
    radio.addEventListener("change", () => {
      if (!radio.checked || !validAccents.includes(radio.value)) return;
      try {
        localStorage.setItem("tabbedAccent", radio.value);
        document.documentElement.dataset.tabbedAccent = radio.value;
      } catch (error) {
        setMessage(modeStatus, `Could not save accent color: ${error.message}`, true);
      }
    });
  }

  addonInput.addEventListener("change", async () => {
    const file = addonInput.files?.[0];
    if (!file) return;
    setMessage(addonStatus, "Inspecting locally…");
    try {
      const metadata = await inspectCrxFile(file);
      setMessage(
        addonStatus,
        `Inspected only — not installed or running. ${metadata.name} · version ${metadata.version} · manifest ${metadata.manifestVersion ?? "unknown"} · ${metadata.permissionCount} declared permission(s).`,
      );
    } catch (error) {
      setMessage(addonStatus, error instanceof Error ? error.message : "Could not inspect this CRX file.", true);
    } finally {
      addonInput.value = "";
    }
  });
}

if (typeof document !== "undefined") initializeSettings();
