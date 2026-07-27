import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { toast } from "react-toastify";
import { api } from "../api.js";

export default function CheckInScanner() {
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const [scannerKey, setScannerKey] = useState(0);
  const [manualToken, setManualToken] = useState("");
  const [result, setResult] = useState(null);

  async function submitToken(token) {
    const value = String(token || "").trim();
    if (!value || processingRef.current) return;
    processingRef.current = true;
    try {
      const response = await api("/check-in/scan", { method: "POST", body: { token: value } });
      setResult(response.checkIn);
      toast.success(response.message);
      await scannerRef.current?.clear().catch(() => {});
    } catch (error) {
      toast.error(error.message);
      processingRef.current = false;
    }
  }

  useEffect(() => {
    const scanner = new Html5QrcodeScanner("anina-qr-reader", {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      rememberLastUsedCamera: true,
    }, false);
    scannerRef.current = scanner;
    scanner.render(
      (decodedText) => submitToken(decodedText),
      () => {},
    );
    return () => {
      scannerRef.current = null;
      scanner.clear().catch(() => {});
    };
  }, [scannerKey]);

  function scanAnother() {
    processingRef.current = false;
    setResult(null);
    setManualToken("");
    setScannerKey((value) => value + 1);
  }

  return <div className="page check-in-page">
    <div className="page-head"><div><h1>QR Check-in</h1>
      <p>Scan a client’s single-use booking QR code to validate payment and record attendance.</p></div></div>
    {result ? <section className="record-card check-in-success">
      <div className="status-notice success"><strong>Check-in successful</strong></div>
      <dl className="record-grid">
        <div><dt>Client</dt><dd>{result.clientName}</dd></div>
        <div><dt>Class</dt><dd>{result.className}</dd></div>
        <div><dt>Attendance</dt><dd>{result.attendanceStatus}</dd></div>
        <div><dt>Check-in time</dt><dd>{new Date(result.checkedInAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
      </dl>
      <button className="btn" onClick={scanAnother}>Scan another QR code</button>
    </section> : <>
      <section className="record-card qr-scanner-card">
        <div id="anina-qr-reader" key={scannerKey} />
      </section>
      <section className="record-card manual-check-in">
        <h2>Manual token entry</h2>
        <p className="meta-line">Use this fallback only when the camera cannot read the QR code.</p>
        <div className="field"><label>Secure check-in token</label>
          <input value={manualToken} onChange={(event) => setManualToken(event.target.value)} autoComplete="off" /></div>
        <button className="btn" disabled={!manualToken.trim()} onClick={() => submitToken(manualToken)}>Validate check-in</button>
      </section>
    </>}
  </div>;
}
