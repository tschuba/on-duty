type Addr = { street?: string | null; houseNumber?: string | null; zip?: string | null; city?: string | null };

// „Straße Nr., PLZ Ort“: bricht nur zwischen den beiden Teilen um, nie mitten in einem.
export function Address({ p }: { p: Addr }) {
  const line1 = [p.street, p.houseNumber].filter(Boolean).join(" ");
  const line2 = [p.zip, p.city].filter(Boolean).join(" ");
  if (!line1 && !line2) return <>—</>;
  return (
    <>
      {line1 && <span class="inline-block">{line1}{line2 && ","}</span>}
      {line1 && line2 && " "}
      {line2 && <span class="inline-block">{line2}</span>}
    </>
  );
}
