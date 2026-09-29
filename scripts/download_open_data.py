import os
import urllib.request
from loguru import logger
from pathlib import Path

# OpenFlights URLs
OPENFLIGHTS_BASE = "https://raw.githubusercontent.com/jpatokal/openflights/master/data"
DATASETS = {
    "airlines.dat": f"{OPENFLIGHTS_BASE}/airlines.dat",
    "airports.dat": f"{OPENFLIGHTS_BASE}/airports.dat",
    "routes.dat": f"{OPENFLIGHTS_BASE}/routes.dat",
}

KAGGLE_DATASET = "shubhambathwal/flight-price-prediction"

def download_openflights(raw_dir: Path):
    logger.info("Downloading OpenFlights datasets...")
    for filename, url in DATASETS.items():
        file_path = raw_dir / filename
        if not file_path.exists():
            logger.info(f"Downloading {filename}...")
            urllib.request.urlretrieve(url, file_path)
            logger.info(f"Saved {filename}")
        else:
            logger.info(f"{filename} already exists, skipping.")

def download_kaggle(raw_dir: Path):
    logger.info("Downloading Kaggle Flight Prices dataset...")
    # Kaggle API expects kaggle.json to be at ~/.kaggle/kaggle.json
    try:
        import kaggle
        kaggle.api.authenticate()
        kaggle.api.dataset_download_files(KAGGLE_DATASET, path=str(raw_dir), unzip=True)
        logger.info("Successfully downloaded and extracted Kaggle dataset.")
    except Exception as e:
        logger.error(f"Failed to download Kaggle dataset. Please ensure you have your kaggle.json in ~/.kaggle/kaggle.json")
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    raw_dir = Path("data/raw")
    raw_dir.mkdir(parents=True, exist_ok=True)
    
    download_openflights(raw_dir)
    download_kaggle(raw_dir)
    logger.info("Data download step complete.")
