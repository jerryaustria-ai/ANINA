import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { api } from "../api.js";

const blankSection = (type = "content") => ({
  type, title: "New Section", visible: true,
  content: { headline: "", text: "" },
});

export default function LandingCms() {
  const [draft, setDraft] = useState(null);
  const [published, setPublished] = useState(null);
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await api("/super-admin/cms/landing");
    setDraft(data.draft);
    setPublished(data.published);
    setVersions(data.versions || []);
  };
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);

  const orderedSections = useMemo(() =>
    [...(draft?.sections || [])].sort((a, b) => a.order - b.order), [draft]);

  const save = async () => {
    setBusy(true);
    try {
      const data = await api("/super-admin/cms/landing/draft", { method: "PUT", body: draft });
      setDraft(data.draft);
      toast.success("Landing page draft saved.");
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true);
    try {
      await save();
      await api("/super-admin/cms/landing/publish", { method: "POST" });
      await load();
      toast.success("Landing page published.");
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };
  const addSection = async () => {
    try {
      const data = await api("/super-admin/cms/landing/sections", {
        method: "POST", body: blankSection(),
      });
      setDraft(data.draft);
      toast.success("Section added to the draft.");
    } catch (error) { toast.error(error.message); }
  };
  const updateSection = (key, patch) => setDraft((current) => ({
    ...current,
    sections: current.sections.map((section) => section.key === key ? { ...section, ...patch } : section),
  }));
  const moveSection = (key, direction) => {
    const items = [...orderedSections];
    const index = items.findIndex((section) => section.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        const position = items.findIndex((item) => item.key === section.key);
        return { ...section, order: (position + 1) * 10 };
      }),
    }));
  };
  const removeSection = async (key) => {
    if (!window.confirm("Remove this section from the current draft?")) return;
    try {
      const data = await api(`/super-admin/cms/landing/sections/${key}`, { method: "DELETE" });
      setDraft(data.draft);
      toast.success("Section removed.");
    } catch (error) { toast.error(error.message); }
  };
  const restore = async (version) => {
    if (!window.confirm(`Restore version ${version} as a new draft?`)) return;
    try {
      const data = await api(`/super-admin/cms/landing/restore/${version}`, { method: "POST" });
      setDraft(data.draft);
      await load();
      toast.success(`Version ${version} restored as a new draft.`);
    } catch (error) { toast.error(error.message); }
  };

  if (!draft) return <div className="spinner">Loading Landing Page CMS…</div>;
  return <div className="cms-page">
    <div className="cms-heading">
      <div><h1>Landing Page CMS</h1><p>Draft changes stay private until you publish them.</p></div>
      <div className="cms-actions">
        <button className="btn" onClick={() => setPreview((value) => !value)}>{preview ? "Close Preview" : "Preview"}</button>
        <button className="btn" disabled={busy} onClick={save}>Save Draft</button>
        <button className="btn primary" disabled={busy} onClick={publish}>Publish</button>
      </div>
    </div>
    <div className="cms-status">
      <span>Draft v{draft.version}</span>
      <span>{published ? `Published v${published.version}` : "No custom version published"}</span>
    </div>

    {preview && <div className="cms-preview">
      <p>{draft.hero?.kicker}</p>
      <h2>{draft.hero?.headline}</h2>
      <p>{draft.hero?.description}</p>
      {orderedSections.filter((section) => section.visible).map((section) =>
        <article key={section.key}><strong>{section.title}</strong><p>{section.content?.headline || section.content?.text}</p></article>)}
    </div>}

    <section className="cms-card">
      <h2>Hero Banner</h2>
      <div className="cms-grid">
        <label>Kicker<input value={draft.hero?.kicker || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, kicker: event.target.value } })} /></label>
        <label>Image or video URL<input value={draft.hero?.image || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, image: event.target.value } })} /></label>
        <label className="wide">Headline<textarea value={draft.hero?.headline || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, headline: event.target.value } })} /></label>
        <label className="wide">Description<textarea value={draft.hero?.description || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, description: event.target.value } })} /></label>
        <label>Primary button label<input value={draft.hero?.primaryLabel || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, primaryLabel: event.target.value } })} /></label>
        <label>Primary button URL<input value={draft.hero?.primaryUrl || ""} onChange={(event) =>
          setDraft({ ...draft, hero: { ...draft.hero, primaryUrl: event.target.value } })} /></label>
      </div>
    </section>

    <section className="cms-card">
      <div className="cms-card-title"><h2>Page Sections</h2><button className="btn" onClick={addSection}>Create Section</button></div>
      <div className="cms-section-list">
        {orderedSections.map((section, index) => <article key={section.key}>
          <div className="cms-section-toolbar">
            <label className="cms-visible"><input type="checkbox" checked={section.visible}
              onChange={(event) => updateSection(section.key, { visible: event.target.checked })} />Visible</label>
            <span>{section.type}</span>
            <button onClick={() => moveSection(section.key, -1)} disabled={!index}>↑</button>
            <button onClick={() => moveSection(section.key, 1)} disabled={index === orderedSections.length - 1}>↓</button>
            <button className="danger-link" onClick={() => removeSection(section.key)}>Remove</button>
          </div>
          <label>Section title<input value={section.title} onChange={(event) =>
            updateSection(section.key, { title: event.target.value })} /></label>
          <label>Headline<input value={section.content?.headline || ""} onChange={(event) =>
            updateSection(section.key, { content: { ...section.content, headline: event.target.value } })} /></label>
          <label>Text<textarea value={section.content?.text || ""} onChange={(event) =>
            updateSection(section.key, { content: { ...section.content, text: event.target.value } })} /></label>
        </article>)}
      </div>
    </section>

    <section className="cms-card">
      <h2>Contact, Business Hours, and Social Links</h2>
      <div className="cms-grid">
        <label>Email<input value={draft.contact?.email || ""} onChange={(event) =>
          setDraft({ ...draft, contact: { ...draft.contact, email: event.target.value } })} /></label>
        <label>Address<input value={draft.contact?.address || ""} onChange={(event) =>
          setDraft({ ...draft, contact: { ...draft.contact, address: event.target.value } })} /></label>
        <label className="wide">Business hours<input value={draft.businessHours || ""} onChange={(event) =>
          setDraft({ ...draft, businessHours: event.target.value })} /></label>
        <label>Facebook URL<input value={draft.socialLinks?.facebook || ""} onChange={(event) =>
          setDraft({ ...draft, socialLinks: { ...draft.socialLinks, facebook: event.target.value } })} /></label>
        <label>Instagram URL<input value={draft.socialLinks?.instagram || ""} onChange={(event) =>
          setDraft({ ...draft, socialLinks: { ...draft.socialLinks, instagram: event.target.value } })} /></label>
        <label>Terms URL<input value={draft.legalLinks?.terms || ""} onChange={(event) =>
          setDraft({ ...draft, legalLinks: { ...draft.legalLinks, terms: event.target.value } })} /></label>
        <label>Privacy URL<input value={draft.legalLinks?.privacy || ""} onChange={(event) =>
          setDraft({ ...draft, legalLinks: { ...draft.legalLinks, privacy: event.target.value } })} /></label>
      </div>
    </section>

    <section className="cms-card">
      <h2>SEO and Social Sharing</h2>
      <div className="cms-grid">
        <label>SEO title<input value={draft.seo?.title || ""} onChange={(event) =>
          setDraft({ ...draft, seo: { ...draft.seo, title: event.target.value } })} /></label>
        <label>Social image URL<input value={draft.seo?.socialImage || ""} onChange={(event) =>
          setDraft({ ...draft, seo: { ...draft.seo, socialImage: event.target.value } })} /></label>
        <label className="wide">SEO description<textarea value={draft.seo?.description || ""} onChange={(event) =>
          setDraft({ ...draft, seo: { ...draft.seo, description: event.target.value } })} /></label>
      </div>
    </section>

    <section className="cms-card">
      <h2>Version History</h2>
      <div className="cms-version-list">{versions.map((version) =>
        <div key={version.version}><span>Version {version.version} · {version.status}</span>
          <button className="btn" onClick={() => restore(version.version)}>Restore as Draft</button></div>)}</div>
    </section>
  </div>;
}

