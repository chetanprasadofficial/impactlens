'use client';

import { useEffect, useRef, useState } from 'react';

type Project = {
  id: string;
  name: string;
  slug: string;
  sector: string | null;
};

type Analysis = {
  caption: string;
  activities: string[];
  scene: string;
  confidence: number;
  visible_issues: string[];
};

type Asset = {
  id: string;
  original_url: string;
  phase: string;
  uploaded_at: string;
  cloudinary_public_id: string;
  cloudinary_asset_id: string;
  version: string;
  verified?: boolean;
  location_name?: string | null;
  captured_at?: string | null;
  asset_analysis: Analysis[] | Analysis | null;
};

type SearchResult = {
  asset: Asset;
  analysis: Analysis | null;
  score: number;
  matchedBecause: string;
};

type AuditEvent = {
  id: string;
  action: string;
  details: any;
  created_at: string;
};

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

const inputStyle = {
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  color: '#111',
} as const;

const buttonStyle = {
  padding: '8px 16px',
  background: '#111',
  color: '#fff',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
} as const;

const sectionStyle = {
  marginBottom: 32,
  padding: 20,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  color: '#111',
} as const;

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState('other');
  const [creating, setCreating] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [phase, setPhase] = useState('unknown');
  const [locationName, setLocationName] = useState('');
  const [capturedDate, setCapturedDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const [filterPhase, setFilterPhase] = useState('all');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [compareBeforeId, setCompareBeforeId] = useState('');
  const [compareAfterId, setCompareAfterId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<{ changes: string[]; confidence: number } | null>(null);
  const [compareError, setCompareError] = useState('');
  const [sliderPos, setSliderPos] = useState(50);

  const [openProvenance, setOpenProvenance] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const latestAudit = useRef('');

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadAssets(selectedProject);
      setSearchResults(null);
      setSearchQuery('');
      setCompareResult(null);
      setCompareError('');
      setCompareBeforeId('');
      setCompareAfterId('');
      setFilterPhase('all');
      setOpenProvenance(null);
    }
  }, [selectedProject]);

  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects || []);
      if (data.projects?.length && !selectedProject) {
        setSelectedProject(data.projects[0].id);
      }
    } catch {
      setProjects([]);
    }
  }

  async function loadAssets(projectId: string) {
    try {
      const res = await fetch(`/api/assets?project=${projectId}`);
      if (!res.ok) {
        setAssets([]);
        return;
      }
      const data = await res.json();
      setAssets(data.assets || []);
    } catch {
      setAssets([]);
    }
  }

  async function createProject() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, sector: newSector }),
    });
    const data = await res.json();
    setCreating(false);
    setNewName('');
    await loadProjects();
    if (data.project) setSelectedProject(data.project.id);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    setUploading(true);
    setUploadStatus('Uploading to Cloudinary...');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', UPLOAD_PRESET!);

      const cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      );
      const cloudData = await cloudRes.json();

      if (!cloudRes.ok) throw new Error(cloudData.error?.message || 'Cloudinary upload failed');

      setUploadStatus('Running AI analysis...');

      const ingestRes = await fetch('/api/assets/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject,
          cloudinaryPublicId: cloudData.public_id,
          cloudinaryAssetId: cloudData.asset_id,
          version: cloudData.version,
          originalUrl: cloudData.secure_url,
          width: cloudData.width,
          height: cloudData.height,
          phase,
          locationName,
          capturedAt: capturedDate,
        }),
      });

      if (!ingestRes.ok) {
        const err = await ingestRes.json();
        throw new Error(err.error || 'Analysis save failed');
      }

      setUploadStatus('Done!');
      await loadAssets(selectedProject);
    } catch (err: any) {
      setUploadStatus(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
      setTimeout(() => setUploadStatus(''), 3000);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, projectId: selectedProject }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
  }

  async function handleCompare() {
    if (!compareBeforeId || !compareAfterId || compareBeforeId === compareAfterId) return;
    setComparing(true);
    setCompareError('');
    setCompareResult(null);
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beforeAssetId: compareBeforeId, afterAssetId: compareAfterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Comparison failed');
      setCompareResult(data.comparison);
    } catch (err: any) {
      setCompareError(err.message);
    } finally {
      setComparing(false);
    }
  }

  async function toggleProvenance(assetId: string) {
    if (openProvenance === assetId) {
      setOpenProvenance(null);
      return;
    }
    setOpenProvenance(assetId);
    setAuditEvents([]);
    setLoadingAudit(true);
    latestAudit.current = assetId;
    try {
      const res = await fetch(`/api/audit?entity_id=${assetId}`);
      const data = await res.json();
      if (latestAudit.current === assetId) setAuditEvents(data.events || []);
    } catch (err) {
      if (latestAudit.current === assetId) setAuditEvents([]);
    } finally {
      if (latestAudit.current === assetId) setLoadingAudit(false);
    }
  }

  function getAnalysis(asset: Asset): Analysis | null {
    if (!asset.asset_analysis) return null;
    return Array.isArray(asset.asset_analysis) ? asset.asset_analysis[0] : asset.asset_analysis;
  }

  async function toggleVerify(assetId: string, current: boolean) {
    const next = !current;
    try {
      const res = await fetch(`/api/assets/${assetId}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: next }),
      });
      if (!res.ok) return;
      setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, verified: next } : a)));
      setSearchResults((prev) =>
        prev
          ? prev.map((r) =>
              r.asset.id === assetId ? { ...r, asset: { ...r.asset, verified: next } } : r
            )
          : prev
      );
    } catch {}
  }

  const filteredAssets =
    filterPhase === 'all' ? assets : assets.filter((a) => a.phase === filterPhase);

  const beforeAsset = assets.find((a) => a.id === compareBeforeId);
  const afterAsset = assets.find((a) => a.id === compareAfterId);
  const sameSelected = !!compareBeforeId && compareBeforeId === compareAfterId;
  const selectedSlug = projects.find((p) => p.id === selectedProject)?.slug;

  function renderCard(asset: Asset, analysis: Analysis | null, matchedBecause?: string) {
    const isOpen = openProvenance === asset.id;
    return (
      <div
        key={asset.id}
        style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', background: '#fff', color: '#111' }}
      >
        <img
          src={asset.original_url}
          alt={analysis?.caption || 'Uploaded evidence photo'}
          style={{ width: '100%', height: 160, objectFit: 'cover' }}
        />
        <div style={{ padding: 12 }}>
          <p style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>
            {analysis?.caption || 'Analyzing...'}
          </p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {analysis?.activities?.map((a) => (
              <span key={a} style={{ fontSize: 11, background: '#eee', color: '#111', padding: '2px 8px', borderRadius: 12 }}>
                {a.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {matchedBecause && (
            <p style={{ fontSize: 11, color: '#0a7', marginBottom: 8 }}>Matched: {matchedBecause}</p>
          )}
          {(asset.location_name || asset.captured_at) && (
            <p style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
              {asset.location_name ? `📍 ${asset.location_name}` : ''}
              {asset.location_name && asset.captured_at ? ' · ' : ''}
              {asset.captured_at ? asset.captured_at.slice(0, 10) : ''}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', marginBottom: 8 }}>
            <span>{asset.phase}{asset.verified ? ' · ✔ verified' : ''}</span>
            {analysis && (
              <span>
                {analysis.confidence < 0.6 ? 'needs review' : `${Math.round(analysis.confidence * 100)}% confident`}
              </span>
            )}
          </div>
          <button
            onClick={() => toggleVerify(asset.id, !!asset.verified)}
            style={{
              fontSize: 11,
              background: asset.verified ? '#e6f7ee' : '#fff',
              color: '#111',
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              width: '100%',
              marginBottom: 6,
            }}
          >
            {asset.verified ? '✔ Verified (click to undo)' : 'Verify this photo'}
          </button>
          <button
            onClick={() => toggleProvenance(asset.id)}
            style={{
              fontSize: 11,
              background: '#fff',
              color: '#111',
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            {isOpen ? 'Hide provenance' : 'View provenance'}
          </button>
          {isOpen && (
            <div style={{ marginTop: 8, padding: 8, background: '#f7f7f7', borderRadius: 4, fontSize: 11, color: '#222' }}>
              <p><strong>Asset ID:</strong> {asset.id}</p>
              <p><strong>Cloudinary public ID:</strong> {asset.cloudinary_public_id}</p>
              <p><strong>Version:</strong> {asset.version}</p>
              <p><strong>Location:</strong> {asset.location_name || 'unknown'}</p>
              <p><strong>Captured:</strong> {asset.captured_at ? asset.captured_at.slice(0, 10) : 'not set'}</p>
              <p style={{ wordBreak: 'break-all' }}><strong>Original URL:</strong> {asset.original_url}</p>
              <p style={{ marginTop: 8 }}><strong>Audit trail:</strong></p>
              {loadingAudit ? (
                <p>Loading...</p>
              ) : auditEvents.length === 0 ? (
                <p>No events recorded.</p>
              ) : (
                auditEvents.map((ev) => (
                  <p key={ev.id}>
                    {ev.action} — {new Date(ev.created_at).toLocaleString()}
                  </p>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        padding: '40px 20px',
        fontFamily: 'system-ui, sans-serif',
        background: '#fff',
        color: '#111',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>ImpactLens</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>From field photos to verified impact stories.</p>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Create a project</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name (e.g. Lake Restoration)"
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
          />
          <select value={newSector} onChange={(e) => setNewSector(e.target.value)} style={inputStyle}>
            <option value="plantation">Plantation</option>
            <option value="cleanup">Cleanup</option>
            <option value="water">Water</option>
            <option value="energy">Energy</option>
            <option value="other">Other</option>
          </select>
          <button onClick={createProject} disabled={creating} style={buttonStyle}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </section>

      {projects.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Upload evidence</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} style={inputStyle}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} style={inputStyle}>
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
              <option value="unknown">Unspecified</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="Location (e.g. Lake Road, Patna)"
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />
            <label style={{ fontSize: 13, color: '#555' }}>
              Date taken{' '}
              <input
                type="date"
                value={capturedDate}
                onChange={(e) => setCapturedDate(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
          </div>
          <p style={{ marginTop: 6, fontSize: 11, color: '#777' }}>
            Fill in location and date before choosing a file. Both are optional.
          </p>
          {uploadStatus && <p style={{ marginTop: 8, color: '#555' }}>{uploadStatus}</p>}
          {selectedSlug && (
            <p style={{ marginTop: 8, fontSize: 13 }}>
              <a
                href={`/report/${selectedSlug}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#06c', textDecoration: 'underline' }}
              >
                View impact report →
              </a>
            </p>
          )}
        </section>
      )}

      {projects.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Search evidence</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. flooded streets, planted saplings, murky water"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleSearch} disabled={searching} style={buttonStyle}>
              {searching ? 'Searching...' : 'Search'}
            </button>
            {searchResults !== null && (
              <button
                onClick={clearSearch}
                style={{ ...buttonStyle, background: '#eee', color: '#111' }}
              >
                Clear
              </button>
            )}
          </div>
        </section>
      )}

      {assets.length >= 2 && (
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Compare before &amp; after</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select
              value={compareBeforeId}
              onChange={(e) => {
                setCompareBeforeId(e.target.value);
                setCompareResult(null);
                setCompareError('');
              }}
              style={inputStyle}
            >
              <option value="">Select "before" photo</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === compareAfterId}>
                  {a.id} ({a.phase})
                </option>
              ))}
            </select>
            <select
              value={compareAfterId}
              onChange={(e) => {
                setCompareAfterId(e.target.value);
                setCompareResult(null);
                setCompareError('');
              }}
              style={inputStyle}
            >
              <option value="">Select "after" photo</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === compareBeforeId}>
                  {a.id} ({a.phase})
                </option>
              ))}
            </select>
            <button
              onClick={handleCompare}
              disabled={comparing || !compareBeforeId || !compareAfterId || sameSelected}
              style={buttonStyle}
            >
              {comparing ? 'Comparing...' : 'Compare'}
            </button>
          </div>

          {sameSelected && (
            <p style={{ color: '#c60', marginBottom: 12, fontSize: 13 }}>
              Pick two different photos to compare.
            </p>
          )}
          {compareError && <p style={{ color: '#c00', marginBottom: 12 }}>{compareError}</p>}

          {beforeAsset && afterAsset && !sameSelected && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 600,
                  height: 320,
                  overflow: 'hidden',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                }}
              >
                <img
                  src={afterAsset.original_url}
                  alt="After"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)`,
                  }}
                >
                  <img
                    src={beforeAsset.original_url}
                    alt="Before"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${sliderPos}%`,
                    width: 2,
                    background: '#fff',
                    transform: 'translateX(-1px)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${sliderPos}%`,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#fff',
                    border: '2px solid #111',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
                <span style={{ position: 'absolute', top: 8, left: 8, background: '#000a', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>
                  BEFORE
                </span>
                <span style={{ position: 'absolute', top: 8, right: 8, background: '#000a', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>
                  AFTER
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                style={{ width: '100%', maxWidth: 600, marginTop: 8 }}
              />
              <p style={{ fontSize: 11, color: '#666' }}>
                Before: {compareBeforeId} · After: {compareAfterId}
              </p>
            </div>
          )}

          {compareResult && (
            <div style={{ padding: 12, background: '#f7f7f7', color: '#111', borderRadius: 4 }}>
              <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                AI change summary ({Math.round(compareResult.confidence * 100)}% confident):
              </p>
              <ul style={{ paddingLeft: 20, fontSize: 13, color: '#222' }}>
                {compareResult.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111' }}>
            {searchResults !== null ? `Search results (${searchResults.length})` : 'Gallery'}
          </h2>
          {searchResults === null && (
            <select
              value={filterPhase}
              onChange={(e) => setFilterPhase(e.target.value)}
              style={{ ...inputStyle, padding: 6, fontSize: 13 }}
            >
              <option value="all">All phases</option>
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
              <option value="unknown">Unspecified</option>
            </select>
          )}
        </div>

        {searchResults !== null ? (
          <>
            {searchResults.length === 0 && <p style={{ color: '#666' }}>No matches found.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {searchResults.map((r) => renderCard(r.asset, r.analysis, r.matchedBecause))}
            </div>
          </>
        ) : (
          <>
            {filteredAssets.length === 0 && <p style={{ color: '#666' }}>No assets yet. Upload one above.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {filteredAssets.map((asset) => renderCard(asset, getAnalysis(asset)))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}