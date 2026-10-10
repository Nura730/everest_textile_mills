import { useEffect, useRef, useState } from 'react';

/**
 * Draw-to-sign pad (mouse, pen or finger). Calls onChange with a PNG data URL after each stroke, or
 * null when cleared. Kept small (400×120) so the image stays well under the request size limit.
 */
export function SignaturePad({ onChange, disabled = false, label = 'Signature' }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  };

  function start(event) {
    if (disabled) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(event) {
    if (!drawing.current) return;
    const { x, y } = point(event);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="signature-canvas"
        aria-label={`${label}: draw with mouse, pen or finger`}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="signature-actions">
        <span className="cell-sub">{empty ? 'Sign in the box above.' : 'Signed.'}</span>
        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={clear} disabled={disabled || empty}>Clear</button>
      </div>
    </div>
  );
}
