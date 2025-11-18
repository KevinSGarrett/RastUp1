# orchestrator/blueprints.py
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

import numpy as np  # pip install numpy

from .llm_client import LLMClient


@dataclass
class BlueprintChunk:
    id: str
    doc_type: str            # "non-tech" or "tech"
    source_file: str
    heading_path: List[str]  # reserved for future use
    index: int
    char_start: int
    char_end: int
    text: str
    summary: Optional[str] = None
    embedding: Optional[List[float]] = None


def run_pandoc(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["pandoc", str(src), "-o", str(dest)]
    print(f"[blueprints] Running pandoc: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def _chunk_markdown(
    text: str,
    doc_type: str,
    source_file: str,
    id_prefix: str,
    max_chars: int = 4000,
    overlap: int = 400,
) -> List[BlueprintChunk]:
    """
    Simple char-based chunking with overlap.
    We *don't* treat document section numbers as execution order.
    """
    chunks: List[BlueprintChunk] = []
    n = len(text)
    start = 0
    i = 0
    while start < n:
        end = min(start + max_chars, n)
        chunk_text = text[start:end]
        chunk_id = f"{id_prefix}-{i:04d}"
        chunks.append(
            BlueprintChunk(
                id=chunk_id,
                doc_type=doc_type,
                source_file=source_file,
                heading_path=[],
                index=i,
                char_start=start,
                char_end=end,
                text=chunk_text,
            )
        )
        if end == n:
            break
        start = max(0, end - overlap)
        i += 1
    return chunks


def build_blueprint_index(
    repo_root: Path,
    non_tech_src: Path,
    tech_src: Path,
    llm: LLMClient,
) -> Path:
    """
    Convert the two master docs to markdown, chunk, summarise, embed,
    and write a single JSON index with everything.
    """
    docs_root = repo_root / "docs" / "blueprints"
    docs_root.mkdir(parents=True, exist_ok=True)

    # 1) Convert to markdown via pandoc
    non_tech_md = docs_root / "non_tech_source.md"
    tech_md = docs_root / "tech_source.md"

    run_pandoc(non_tech_src, non_tech_md)
    run_pandoc(tech_src, tech_md)

    non_tech_text = non_tech_md.read_text(encoding="utf-8")
    tech_text = tech_md.read_text(encoding="utf-8")

    # 2) Chunk
    non_chunks = _chunk_markdown(
        non_tech_text,
        doc_type="non-tech",
        source_file=str(non_tech_src.relative_to(repo_root)),
        id_prefix="NT",
    )
    tech_chunks = _chunk_markdown(
        tech_text,
        doc_type="tech",
        source_file=str(tech_src.relative_to(repo_root)),
        id_prefix="TD",
    )
    all_chunks: List[BlueprintChunk] = non_chunks + tech_chunks
    total = len(all_chunks)
    print(f"[blueprints] Created {total} chunks ({len(non_chunks)} non-tech, {len(tech_chunks)} tech)")

    # 3) Summarise each chunk with OpenAI, with progress output
    print("[blueprints] Summarising chunks with OpenAI (this is a one-time cost)...")
    for idx, ch in enumerate(all_chunks, start=1):
        print(f"[blueprints]  - Summarising chunk {idx}/{total} ({ch.id}, {ch.doc_type})")
        prompt = (
            "You are documenting a large product blueprint.\n"
            "Summarise the following chunk in <= 50 words, preserving each distinct requirement.\n"
            "Do NOT drop edge cases or constraints. Use 1-2 sentences.\n\n"
            f"CHUNK ID: {ch.id}\n"
            "TEXT:\n"
            f"{ch.text}\n"
        )
        ch.summary = llm.chat_openai(
            messages=[
                {"role": "system", "content": "You are a meticulous technical product summariser."},
                {"role": "user", "content": prompt},
            ]
        ).strip()

    # 4) Embed all chunks (full text, not just summary)
    print("[blueprints] Creating embeddings for all chunks...")
    batch_size = 96
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i : i + batch_size]
        print(f"[blueprints]  - Embedding batch {i+1}..{i+len(batch)} of {total}")
        vectors = llm.embed([c.text for c in batch])
        for c, v in zip(batch, vectors):
            c.embedding = v

    # 5) Write per-chunk anchored markdown (for human inspection / Cursor context)
    print("[blueprints] Writing chunk markdown files...")
    for ch in all_chunks:
        folder = docs_root / ("non-tech" if ch.doc_type == "non-tech" else "tech")
        folder.mkdir(parents=True, exist_ok=True)
        out_path = folder / f"{ch.id}.md"
        header = (
            f"<!-- id: {ch.id} | source: {ch.source_file} | "
            f"range: {ch.char_start}-{ch.char_end} -->\n\n"
        )
        out_path.write_text(header + ch.text, encoding="utf-8")

    # 6) Write JSON index
    index_path = docs_root / "blueprint_index.json"
    serialisable: List[Dict[str, Any]] = []
    for ch in all_chunks:
        d = asdict(ch)
        if d["embedding"] is not None:
            d["embedding"] = list(d["embedding"])  # ensure JSON-serialisable
        serialisable.append(d)

    index_path.write_text(json.dumps(serialisable, indent=2), encoding="utf-8")
    print(f"[blueprints] Wrote index to {index_path}")
    return index_path


def load_blueprint_index(repo_root: Path) -> Tuple[List[Dict[str, Any]], np.ndarray]:
    docs_root = repo_root / "docs" / "blueprints"
    index_path = docs_root / "blueprint_index.json"
    data: List[Dict[str, Any]] = json.loads(index_path.read_text(encoding="utf-8"))
    matrix = np.array([row["embedding"] for row in data], dtype="float32")
    return data, matrix


def search_blueprints(
    repo_root: Path,
    llm: LLMClient,
    query: str,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    meta, mat = load_blueprint_index(repo_root)
    q_vec = np.array(llm.embed([query])[0], dtype="float32")
    norms = np.linalg.norm(mat, axis=1) * np.linalg.norm(q_vec)
    scores = mat @ q_vec / norms
    order = np.argsort(scores)[::-1][:top_k]
    return [meta[int(i)] for i in order]
