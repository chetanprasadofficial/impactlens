'use client';

import { useEffect, useState } from 'react';

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
  asset_analysis: Analysis[] | Analysis | null;
};

type SearchResult = {
  asset: Asset;
  analysis: Analysis | null;
  score: number;
  matchedBecause: string;
};

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState('other');
  const [creating, setCreating] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [phase, setPhase] = useState('unknown');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const [filterPhase, setFilterPhase] = useState('all');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadAssets(selectedProject);
      setSearchResults(null);
      setSearchQuery('');
    }
  }, [selectedProject]);

  async function loadProjects() {
    const res = await fetch('/api/projects');
    const data = await res.json();
    setProjects(data.projects || []);
    if (data.projects?.length && !selectedProject) {
      setSelectedProject(data.projects[0].id);
    }
  }

  async function loadAssets(projectId: string) {
    const res = await fetch(`/api/assets?project=${projectId}`);
    const data = await res.json();
    setAssets(data.assets || []);
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

  function getAnalysis(asset: Asset): Analysis | null {
    if (!asset.asset_analysis) return null;
    return Array.isArray(asset.asset_analysis) ? asset.asset_analysis[0] : asset.asset_analysis;
  }

  const filteredAssets =
    filterPhase === 'all' ? assets : assets.filter((a) => a.phase === filterPhase);

  function renderCard(asset: Asset, analysis: Analysis | null, matchedBecause?: string) {
    return (
      <div key={asset.id} style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <img src={asset.original_url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />
        <div style={{ padding: 12 }}>
          <p style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>
            {analysis?.caption || 'Analyzing...'}
          </p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {analysis?.activities?.map((a) => (
              <span key={a} style={{ fontSize: 11, background: '#eee', padding: '2px 8px', borderRadius: 12 }}>
                {a.replace('_', ' ')}
              </span>
            ))}
          </div>
          {matchedBecause && (
            <p style={{ fontSize: 11, color: '#0a7', marginBottom: 8 }}>Matched: {matchedBecause}</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888' }}>
            <span>{asset.phase}</span>
            {analysis && (
              <span>
                {analysis.confidence < 0.6 ? 'needs review' : `${Math.round(analysis.confidence * 100)}% confident`}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>ImpactLens</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>From field photos to verified impact stories.</p>

      <section style={{ marginBottom: 32, padding: 20, border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Create a project</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name (e.g. Lake Restoration)"
            style={{ flex: 1, minWidth: 200, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <select
            value={newSector}
            onChange={(e) => setNewSector(e.target.value)}
            style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          >
            <option value="plantation">Plantation</option>
            <option value="cleanup">Cleanup</option>
            <option value="water">Water</option>
            <option value="energy">Energy</option>
            <option value="other">Other</option>
          </select>
          <button
            onClick={createProject}
            disabled={creating}
            style={{ padding: '8px 16px', background: '#111', color: '#fff', borderRadius: 4, border: 'none', cursor: 'pointer' }}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </section>

      {projects.length > 0 && (
        <section style={{ marginBottom: 32, padding: 20, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Upload evidence</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
            >
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
              <option value="unknown">Unspecified</option>
            </select>
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
          </div>
          {uploadStatus && <p style={{ marginTop: 8, color: '#555' }}>{uploadStatus}</p>}
        </section>
      )}

      {projects.length > 0 && (
        <section style={{ marginBottom: 32, padding: 20, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Search evidence</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. flooded streets, planted saplings, murky water"
              style={{ flex: 1, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              style={{ padding: '8px 16px', background: '#111', color: '#fff', borderRadius: 4, border: 'none', cursor: 'pointer' }}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
            {searchResults !== null && (
              <button
                onClick={clearSearch}
                style={{ padding: '8px 16px', background: '#eee', borderRadius: 4, border: 'none', cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        </section>
      )}

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            {searchResults !== null ? `Search results (${searchResults.length})` : 'Gallery'}
          </h2>
          {searchResults === null && (
            <select
              value={filterPhase}
              onChange={(e) => setFilterPhase(e.target.value)}
              style={{ padding: 6, border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
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
            {searchResults.length === 0 && <p style={{ color: '#888' }}>No matches found.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {searchResults.map((r) => renderCard(r.asset, r.analysis, r.matchedBecause))}
            </div>
          </>
        ) : (
          <>
            {filteredAssets.length === 0 && <p style={{ color: '#888' }}>No assets yet. Upload one above.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {filteredAssets.map((asset) => renderCard(asset, getAnalysis(asset)))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
