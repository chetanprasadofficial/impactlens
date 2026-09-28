"use client";
export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="border rounded px-3 py-1 bg-black text-white">
      Download PDF
    </button>
  );
}