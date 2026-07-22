// Round avatar: shows the photo when present, otherwise initials on a tinted
// circle. Used wherever we surface a person (instructor, client).
export default function Avatar({ src, name = "", size = 40 }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  const style = { width: size, height: size, borderRadius: "50%", flex: "0 0 auto" };
  if (src) return <img src={src} alt={name} style={{ ...style, objectFit: "cover" }} />;
  return (
    <span style={{
      ...style, display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--sage)", color: "#fff", fontWeight: 600, fontSize: size * 0.4,
    }}>
      {initials || "?"}
    </span>
  );
}
