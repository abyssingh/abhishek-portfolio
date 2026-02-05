import os
from pathlib import Path

import faiss
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer


load_dotenv()

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
NO_INFO_RESPONSE = "I don’t have that information."
MODEL_NAME = os.getenv("OPENAI_MODEL", "llama-3.3-70b-versatile")
DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str


def chunk_markdown(content: str) -> list[str]:
    sections = []
    current = []
    for line in content.splitlines():
        if line.startswith("## "):
            if current:
                sections.append("\n".join(current).strip())
                current = []
        current.append(line)
    if current:
        sections.append("\n".join(current).strip())
    return [section for section in sections if section]


def load_knowledge() -> list[dict]:
    documents = []
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            continue
        for section in chunk_markdown(content):
            documents.append({"path": path.name, "content": section})
    return documents


def normalize_vectors(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


model = SentenceTransformer("all-MiniLM-L6-v2")
knowledge_documents = load_knowledge()

if knowledge_documents:
    embeddings = model.encode(
        [doc["content"] for doc in knowledge_documents],
        convert_to_numpy=True,
        show_progress_bar=False
    )
    embeddings = normalize_vectors(embeddings)
    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(embeddings)
else:
    embeddings = np.array([])
    index = None


def build_context(results: list[tuple[float, dict]]) -> str:
    sections = []
    for score, doc in results:
        sections.append(f"Source: {doc['path']}\n{doc['content']}")
    return "\n\n".join(sections)


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")

    if not knowledge_documents or index is None:
        return ChatResponse(answer=NO_INFO_RESPONSE)

    query_embedding = model.encode([question], convert_to_numpy=True, show_progress_bar=False)
    query_embedding = normalize_vectors(query_embedding)

    scores, indices = index.search(query_embedding, k=min(4, len(knowledge_documents)))
    scored_results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue
        scored_results.append((float(score), knowledge_documents[idx]))

    if not scored_results or max(score for score, _ in scored_results) < 0.25:
        return ChatResponse(answer=NO_INFO_RESPONSE)

    context = build_context(scored_results)

    api_key = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY (or OPENAI_API_KEY) is not set."
        )

    base_url = os.getenv("OPENAI_BASE_URL", DEFAULT_GROQ_BASE_URL)
    client = OpenAI(api_key=api_key, base_url=base_url)

    system_prompt = (
        "You are an AI assistant for a personal portfolio. "
        "Answer the user only using the provided context. "
        "If the answer is not explicitly stated in the context, respond exactly with: "
        f"{NO_INFO_RESPONSE}"
    )

    user_prompt = (
        "Context:\n"
        f"{context}\n\n"
        "User question:\n"
        f"{question}"
    )

    completion = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2
    )

    answer = completion.choices[0].message.content.strip()
    if not answer:
        answer = NO_INFO_RESPONSE

    return ChatResponse(answer=answer)
