import { useState } from "react";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Avatar from "../components/Avatar.jsx";

function resizePicture(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/")) return reject(new Error("Choose a JPEG, PNG, or WebP image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not open the image."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 256;
        const crop = Math.min(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2,
          crop, crop, 0, 0, 256, 256);
        resolve(canvas.toDataURL("image/jpeg", .82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function ProfileSettings() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user.name || "",
    phone: user.phone || "",
    picture: user.picture || "",
    bio: user.bio || "",
    specialties: user.specialties || [],
    specialtiesText: (user.specialties || []).join(", "),
  });
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        phone: form.phone,
        picture: form.picture,
        ...(user.role === "instructor" ? {
          bio: form.bio,
          specialties: form.specialtiesText.split(",").map((item) => item.trim()).filter(Boolean),
        } : {}),
      };
      const { user: updated } = await api("/users/me", { method: "PATCH", body });
      setUser(updated);
      toast.success("Profile updated successfully.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  return <div className="page profile-page">
    <div className="page-head"><div><h1>Profile Settings</h1>
      <p>Update your personal details and profile picture.</p></div></div>
    <form className="record-card profile-form" onSubmit={save}>
      <div className="picture-picker">
        <Avatar src={form.picture} name={form.name} size={84} />
        <div><label className="btn ghost sm picture-button">Change picture
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
            try { setForm({ ...form, picture: await resizePicture(event.target.files?.[0]) }); }
            catch (error) { toast.error(error.message); }
          }} /></label>
          {form.picture && <button className="picture-remove" type="button"
            onClick={() => setForm({ ...form, picture: "" })}>Remove picture</button>}</div>
      </div>
      <div className="field"><label>Full name</label><input value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
      <div className="field"><label>Email address</label><input value={user.email} disabled />
        <small>Email changes must be verified by an Admin.</small></div>
      <div className="field"><label>Phone number</label><input type="tel" value={form.phone}
        onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
      {user.role === "instructor" && <>
        <div className="field"><label>Professional bio</label><textarea rows="4" value={form.bio}
          onChange={(event) => setForm({ ...form, bio: event.target.value })} /></div>
        <div className="field"><label>Specialties</label><input value={form.specialtiesText}
          onChange={(event) => setForm({ ...form, specialtiesText: event.target.value })}
          placeholder="Yoga, Mobility, Recovery" /></div>
      </>}
      <button className="btn" disabled={busy || !form.name.trim()}>
        {busy ? "Saving…" : "Save Profile"}
      </button>
    </form>
  </div>;
}
