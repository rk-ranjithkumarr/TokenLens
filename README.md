# TokenLens — LLM Observability Studio

TokenLens is a local-first dashboard for exploring LLM token usage, request latency, and estimated API cost. It includes a responsive dark UI, prompt playground, request history, SQLite persistence, and a chart view.

## Features

- Overview cards for requests, tokens, estimated spend, and average latency.
- Prompt lab with selectable model and output-token limit.
- Demo mode works without an API key. It uses a transparent characters/4 token estimate and a sample response; it does **not** call an LLM.
- Live mode uses the OpenAI Chat Completions API when `OPENAI_API_KEY` is configured. Token counts come from provider usage metadata when available.
- Request history saved locally in `tokenlens.db`.
- Input/output token chart and cost split visualization.
- Responsive CSS for desktop, tablet, and mobile.
- Clear local history action.

## Requirements

- Python 3.10 or newer recommended.
- Internet connection to install packages.
- Optional: OpenAI API key and available API billing/quota for live requests.

## Run on Windows (step by step)

1. Download and extract `TokenLens.zip`.
2. Open the extracted `TokenLens` folder.
3. In File Explorer, click the address bar, type `cmd`, and press Enter.
4. Create a virtual environment:

   ```bat
   py -m venv .venv
   ```

5. Activate it:

   ```bat
   .venv\Scripts\activate
   ```

6. Install dependencies:

   ```bat
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

7. Start in demo mode (no API key required):

   ```bat
   python app.py
   ```

8. Open `http://127.0.0.1:5000` in your browser.
9. Enter a prompt and click **Analyze prompt**. The dashboard metrics and request history should update.

### Enable real OpenAI requests (optional)

1. Stop the server with `Ctrl+C`.
2. Copy `.env.example` to a new file named `.env` in the project root.
3. Open `.env` in Notepad and set your own key:

   ```env
   OPENAI_API_KEY=your_api_key_here
   OPENAI_MODEL=gpt-4o-mini
   PORT=5000
   ```

4. Save the file and restart with `python app.py`.
5. The notice disappears after the first successful live request.

**Security:** Keep `.env` private. Do not commit it, share it, or paste your API key into the browser. The key is read only by the local Python server.

## Run on macOS / Linux

```bash
cd TokenLens
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000`.

## How metrics work

- **Input/output tokens:** Exact provider usage counts in live mode when returned by the API. Demo mode estimates tokens as roughly one token per four characters; actual tokenization varies.
- **Latency:** Time measured around the model request (live mode) or local demo processing (demo mode). Demo latency is not representative of real inference latency.
- **Cost:** Computed from the model rate table in `app.py` using USD per million input/output tokens. Rates are illustrative defaults and may change. Verify current provider pricing and update `MODEL_PRICING` before relying on costs.
- **History:** Last 100 request records are displayed in the dashboard; records are stored locally in SQLite. Clear history removes records from the database.

## Troubleshooting

- `py` is not recognized: install Python from the official Python website and enable “Add Python to PATH”; alternatively use `python` instead of `py`.
- `pip install` fails: check internet access and try `python -m pip install -r requirements.txt`.
- Port 5000 is busy: set `PORT=5001` in `.env`, restart, then open `http://127.0.0.1:5001`.
- Live API call fails: verify the key, model access, account quota/billing, and network. The error is shown in the dashboard.
- `ModuleNotFoundError`: confirm the virtual environment is activated and run `pip install -r requirements.txt`.

## Project structure

```text
TokenLens/
├── app.py
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
├── templates/
│   └── index.html
└── static/
    ├── style.css
    └── app.js
```

## Important notes

This is a development/demo application. Do not expose the Flask development server publicly as-is. Add authentication, rate limits, secure secret management, and production deployment controls before using it in a shared environment.
