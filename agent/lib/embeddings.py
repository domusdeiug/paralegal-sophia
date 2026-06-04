import os
from google.cloud import aiplatform
from vertexai.language_models import TextEmbeddingModel

_model: TextEmbeddingModel | None = None


def _get_model() -> TextEmbeddingModel:
    global _model
    if _model is None:
        aiplatform.init(
            project=os.environ["GOOGLE_CLOUD_PROJECT"],
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
        _model = TextEmbeddingModel.from_pretrained(
            os.environ.get("EMBEDDING_MODEL", "text-embedding-004")
        )
    return _model


def embed_text(text: str) -> list[float]:
    """Embed text using Vertex AI text-embedding-004 (768-dim)."""
    model = _get_model()
    embeddings = model.get_embeddings([text])
    return embeddings[0].values
