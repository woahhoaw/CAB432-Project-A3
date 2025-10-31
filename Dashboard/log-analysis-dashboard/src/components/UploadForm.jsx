import { useState } from "react";
import { apiFetch } from "../api";

export default function UploadForm() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return setMsg("Choose a file first.");

    try {
      setBusy(true);
      setMsg("Requesting pre-signed URL...");

      // 1) Ask API for pre-signed S3 PUT URL
      const { logId, key, url } = await apiFetch("/logs/upload-url");

      // 2) PUT the file directly to S3 using the pre-signed URL
      setMsg("Uploading to S3...");
      const putRes = await fetch(url, {
        method: "PUT",
        body: file,
        // don't set application/json here; browser will set appropriate headers
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => "");
        throw new Error(`S3 upload failed: ${putRes.status} ${t}`);
      }

      // 3) Tell API the upload is done (register metadata in DynamoDB)
      setMsg("Registering upload...");
      await apiFetch("/logs/register-upload", {
        method: "POST",
        body: {
          logId,
          key,                      // returned from /logs/upload-url
          filename: file.name,      // REQUIRED by your backend
          size: file.size || null,  // optional
        },
      });

      setMsg(`Uploaded! logId=${logId}`);
    } catch (err) {
      console.error(err);
      setMsg(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleUpload}>
      <input
        type="file"
        accept=".log,text/plain"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={busy}
      />
      <button type="submit" disabled={!file || busy}>
        {busy ? "Working..." : "Upload"}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  );
}
