# TravelMind ✈️

TravelMind is a production-grade AI travel negotiation system. It aggregates flights from multiple suppliers (GDS, LCC, OTA) by normalizing disparate schemas into a canonical `FareRecord`. It then uses a RAG pipeline (ChromaDB + BGE-M3) and a LangChain ReAct Agent to search, compare, clarify, and negotiate flight prices directly through natural language.

## Architecture

```text
User Query → FastAPI → ReAct Agent → [Tools: Search | Negotiate | Clarify | Compare]
                                          ↓
                                   RAG Pipeline (ChromaDB + BGE-M3)
                                          ↓
                              Normalized Supplier Fare Data
                          (SupplierA/GDS, SupplierB/LCC, SupplierC/OTA)
```

## Quick Start

### 1. Backend Setup

Open a terminal and set up the Python environment:

```bash
cd travel-rag-agent
python -m venv venv
# Windows:
.\venv\Scripts\Activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Environment Variables

Create a `.env` file from the example:
```bash
cp .env.example .env
```
Ensure you add your `GOOGLE_API_KEY` (Gemini) inside the `.env` file.

### 3. Data Pipeline

You need Kaggle credentials (`~/.kaggle/kaggle.json`) to download the flight prices dataset automatically.
If you don't have it, the script will generate a fallback mock dataset.

```bash
# 1. Download OpenFlights and Kaggle Data
python scripts/download_open_data.py

# 2. Build Supplier Records (Simulate GDS, LCC, OTA)
python scripts/build_supplier_records.py

# 3. Normalize and Index into ChromaDB
python scripts/index_data.py
```

### 4. Run the API

```bash
uvicorn src.api.main:app --reload
```
The API docs will be available at [http://localhost:8000/docs](http://localhost:8000/docs).

### 5. Run the Frontend UI

Open a new terminal:
```bash
cd travel-rag-agent/frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser to chat with TravelMind!

### 6. Run Evaluations

To run the automated agent evaluations:
```bash
python -m src.evals.run_evals
```
