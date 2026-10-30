import os
import time
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
# Load .env from this project folder, independent of the CMD working directory.
load_dotenv(dotenv_path=BASE_DIR / ".env", override=False)
DB_PATH = BASE_DIR / "tokenlens.db"

app = Flask(__name__)

# Approximate USD pricing per 1 million tokens. Update these values from the
# provider's official pricing page before using for financial reporting.
MODEL_PRICING = {
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
}
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                latency_ms REAL NOT NULL,
                cost_usd REAL NOT NULL,
                prompt_preview TEXT NOT NULL,
                response_preview TEXT NOT NULL
            )
        """)


def estimate_tokens(text):
    # Demo-mode approximation only. Tokenization varies by model and language.
    return max(1, (len(text) + 3) // 4) if text else 0


def price_for(model, input_tokens, output_tokens):
    rates = MODEL_PRICING.get(model, MODEL_PRICING["gpt-4o-mini"])
    return (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000


def save_record(model, mode, prompt_tokens, completion_tokens, latency_ms, cost, prompt, answer):
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with db() as conn:
        cur = conn.execute("""
            INSERT INTO requests
            (created_at, model, mode, prompt_tokens, completion_tokens, total_tokens,
             latency_ms, cost_usd, prompt_preview, response_preview)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            created_at, model, mode, prompt_tokens, completion_tokens,
            prompt_tokens + completion_tokens, latency_ms, cost,
            prompt[:220], answer[:280]
        ))
        record_id = cur.lastrowid
    return {
        "id": record_id, "created_at": created_at, "model": model, "mode": mode,
        "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "latency_ms": round(latency_ms, 2), "cost_usd": round(cost, 8),
        "prompt_preview": prompt[:220], "response_preview": answer[:280]
    }


@app.get("/")
def index():
    return render_template("index.html", default_model=DEFAULT_MODEL)


@app.get("/api/status")
def status():
    # Never return the secret itself; only report whether it is configured.
    configured = bool(os.getenv("OPENAI_API_KEY", "").strip())
    return jsonify({"api_key_configured": configured, "model": DEFAULT_MODEL})


@app.get("/api/summary")
def summary():
    with db() as conn:
        rows = conn.execute("SELECT * FROM requests ORDER BY id DESC LIMIT 100").fetchall()
    records = [dict(r) for r in rows]
    total_tokens = sum(r["total_tokens"] for r in records)
    total_cost = sum(r["cost_usd"] for r in records)
    avg_latency = sum(r["latency_ms"] for r in records) / len(records) if records else 0
    return jsonify({
        "records": records,
        "metrics": {
            "requests": len(records), "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 8),
            "avg_latency_ms": round(avg_latency, 2)
        },
        "pricing": MODEL_PRICING
    })


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    model = (payload.get("model") or DEFAULT_MODEL).strip()
    max_output_tokens = int(payload.get("max_output_tokens") or 180)
    max_output_tokens = min(max(max_output_tokens, 16), 1200)

    if not prompt:
        return jsonify({"error": "Enter a prompt before running analysis."}), 400
    if len(prompt) > 12000:
        return jsonify({"error": "Prompt is too long. Keep it under 12,000 characters."}), 400

    start = time.perf_counter()
    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    fallback_note = None
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            completion = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_output_tokens,
            )
            latency_ms = (time.perf_counter() - start) * 1000
            answer = completion.choices[0].message.content or ""
            usage = completion.usage
            prompt_tokens = int(usage.prompt_tokens) if usage else estimate_tokens(prompt)
            completion_tokens = int(usage.completion_tokens) if usage else estimate_tokens(answer)
            # If provider pricing for a selected model is not listed, this falls
            # back to the gpt-4o-mini rates and is clearly labelled in the UI.
            cost = price_for(model, prompt_tokens, completion_tokens)
            mode = "live"
        except Exception as exc:
            # A zero API credit balance cannot be fixed by retrying. Fall back
            # transparently to the local demo so the dashboard remains usable.
            error_text = str(exc).lower()
            error_code = str(getattr(exc, "code", "") or "").lower()
            if "credit_balance_exhausted" in error_text or "insufficient_quota" in error_text or error_code in {"credit_balance_exhausted", "insufficient_quota"}:
                prompt_tokens = estimate_tokens(prompt)
                answer = (
                    "DEMO RESPONSE — your OpenAI API account has no credits remaining, "
                    "so no live model response was generated. This is a sample response "
                    "for testing the TokenLens dashboard. Add API credits to enable live responses. "
                    f"Your prompt contains about {prompt_tokens} input tokens by the characters/4 estimate."
                )
                completion_tokens = estimate_tokens(answer)
                latency_ms = (time.perf_counter() - start) * 1000
                cost = price_for(model, prompt_tokens, completion_tokens)
                mode = "demo"
                fallback_note = "Demo fallback: OpenAI API credits are exhausted. Token counts and cost are estimates; this is not a live model response."
            else:
                return jsonify({
                    "error": "The live model request failed. Check your API key, model name, network, and provider quota.",
                    "details": str(exc)[:350]
                }), 502
    else:
        # Local demo mode: no external API call is made and no live model response
        # is generated. It creates a transparent sample response for UI testing.
        prompt_tokens = estimate_tokens(prompt)
        answer = (
            "DEMO RESPONSE — no LLM API was called. Token counts are approximate. "
            "Configure OPENAI_API_KEY in .env to measure a real model response. "
            f"Your prompt contains about {prompt_tokens} input tokens by the characters/4 estimate."
        )
        completion_tokens = estimate_tokens(answer)
        latency_ms = (time.perf_counter() - start) * 1000
        cost = price_for(model, prompt_tokens, completion_tokens)
        mode = "demo"

    record = save_record(
        model, mode, prompt_tokens, completion_tokens, latency_ms, cost, prompt, answer
    )
    record["response"] = answer
    record["pricing_note"] = fallback_note or (
        "Estimated from the built-in rate table; verify current provider pricing."
        if model in MODEL_PRICING else
        "Model not found in rate table: gpt-4o-mini rates were used as a fallback."
    )
    return jsonify(record)


@app.delete("/api/history")
def clear_history():
    with db() as conn:
        conn.execute("DELETE FROM requests")
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=False)
